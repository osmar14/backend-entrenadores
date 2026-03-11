const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const admin = require('firebase-admin');

// 🔐 1. INICIALIZAR EL PODER DE ADMINISTRADOR DE FIREBASE (Modo Inteligente)
let serviceAccount;
if (process.env.FIREBASE_CREDENTIALS) {
  // Si estamos en Railway, lee la llave secreta de las variables de entorno
  serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
} else {
  // Si estamos en tu compu local, lee el archivo
  serviceAccount = require('./firebase-secret.json');
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const app = express();
app.use(cors());
app.use(express.json());


// 🗄️ 2. CONEXIÓN A LA BASE DE DATOS MYSQL
const db = mysql.createPool({
  host: 'crossover.proxy.rlwy.net', 
  user: 'root',
  password: 'ZCwKXEEmhdNENCbvuqhPAHhCGlywgQEh',
  database: 'railway',
  port: 14373 
});

// ==========================================
// 🛡️ MIDDLEWARE INTELIGENTE: ¿QUIÉN ERES?
// ==========================================
async function verificarUsuario(req, res, next) {
    // Aceptamos ambos headers para no romper tu app web actual de golpe
    const email = req.headers['usuario-email'] || req.headers['entrenador-email']; 
    if (!email) return res.status(401).json({ error: 'Falta identificación' });

    try {
        // 1. ¿Es un Entrenador?
        const [entrenadores] = await db.query('SELECT id FROM Entrenadores WHERE email = ?', [email]);
        if (entrenadores.length > 0) {
            req.usuarioId = entrenadores[0].id;
            req.rol = 'entrenador';
            return next();
        }

        // 2. ¿Es un Cliente?
        const [clientes] = await db.query('SELECT id, entrenador_id FROM Clientes WHERE email = ?', [email]);
        if (clientes.length > 0) {
            req.usuarioId = clientes[0].id;
            req.entrenadorId = clientes[0].entrenador_id; // Guardamos quién es su jefe
            req.rol = 'cliente';
            return next();
        }

        return res.status(404).json({ error: 'Usuario no encontrado en la base de datos' });
    } catch (error) {
        res.status(500).json({ error: 'Error verificando al usuario' });
    }
}

// ==========================================
// 👥 RUTAS DE CLIENTES (LA MAGIA DE FIREBASE)
// ==========================================
app.get('/api/clientes', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Acceso denegado' });
    
    try {
        const [resultados] = await db.query('SELECT * FROM Clientes WHERE entrenador_id = ?', [req.usuarioId]);
        res.json(resultados);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/clientes', verificarUsuario, async (req, res) => {
    // Solo los entrenadores pueden crear clientes
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores pueden crear clientes' });

    const { nombre, email, objetivo, dias_entrenamiento } = req.body;
    if (!email) return res.status(400).json({ error: 'El correo del cliente es obligatorio' });

    try {
        // 🌟 MAGIA: Le creamos la cuenta en Firebase automáticamente
        const contraseñaTemporal = 'Entrena123!';
        const userRecord = await admin.auth().createUser({
            email: email,
            password: contraseñaTemporal,
            displayName: nombre
        });

        // 🌟 MAGIA: Lo guardamos en MySQL vinculado a su nuevo Firebase UID
        const query = 'INSERT INTO Clientes (nombre, email, objetivo, entrenador_id, dias_entrenamiento, firebase_uid) VALUES (?, ?, ?, ?, ?, ?)';
        const [resultado] = await db.query(query, [nombre, email, objetivo, req.usuarioId, dias_entrenamiento || '', userRecord.uid]);
        
        res.status(201).json({ 
            message: 'Cliente creado con éxito',
            id: resultado.insertId, 
            nombre, 
            email,
            password_temporal: contraseñaTemporal 
        });
    } catch (err) {
        // Si el correo ya existe en Firebase, mandamos un error claro
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 📋 RUTAS DE RUTINAS Y EJERCICIOS (Adaptadas para Entrenador y Cliente)
// ==========================================
app.get('/api/rutinas', verificarUsuario, async (req, res) => {
    try {
        let query;
        let params;

        if (req.rol === 'entrenador') {
            // El entrenador ve todas sus plantillas y las de sus clientes
            query = 'SELECT * FROM Rutinas WHERE entrenador_id = ?';
            params = [req.usuarioId];
        } else {
            // El cliente SOLO ve las rutinas asignadas a él (NO plantillas)
            query = 'SELECT * FROM Rutinas WHERE cliente_id = ? AND es_plantilla = 0 AND activa = 1';
            params = [req.usuarioId];
        }

        const [resultados] = await db.query(query, params);
        res.json(resultados);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// (Aquí conservamos la ruta de clonar rutinas tal como estaba)
app.post('/api/rutinas/clonar', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores' });
    const { plantilla_id, cliente_id } = req.body;
    try {
        const queryClonarRutina = `INSERT INTO Rutinas (nombre, descripcion, nivel, es_plantilla, cliente_id, entrenador_id) SELECT nombre, descripcion, nivel, 0, ?, entrenador_id FROM Rutinas WHERE id = ?`;
        const [resultRutina] = await db.query(queryClonarRutina, [cliente_id, plantilla_id]);
        
        const nuevaRutinaId = resultRutina.insertId;
        // 🚀 AHORA INCLUYE EL RIR Y NOTAS DEL ENTRENADOR
        const queryClonarEjercicios = `INSERT INTO Rutina_Ejercicios (rutina_id, ejercicio_id, series_objetivo, reps_objetivo, rir_objetivo, notas_entrenador, dia_nombre) SELECT ?, ejercicio_id, series_objetivo, reps_objetivo, rir_objetivo, notas_entrenador, dia_nombre FROM Rutina_Ejercicios WHERE rutina_id = ?`;
        await db.query(queryClonarEjercicios, [nuevaRutinaId, plantilla_id]);
        
        res.status(201).json({ message: 'Rutina clonada', nuevaRutinaId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Guardar progreso con RIR y Notas del cliente
app.post('/api/progreso', verificarUsuario, async (req, res) => {
    const { rutina_id, registros } = req.body;
    const clienteId = req.rol === 'cliente' ? req.usuarioId : req.body.cliente_id;

    if (!registros || registros.length === 0) return res.status(400).json({ message: 'No hay registros' });
    
    try {
        const values = registros.map(r => [
            clienteId, rutina_id, r.ejercicio_id, r.serie_numero, 
            r.peso || 0, r.reps || 0, r.rir || null, r.tipo_serie || 'Normal', r.notas_cliente || ''
        ]);
        
        await db.query('INSERT INTO Registro_Progreso (cliente_id, rutina_id, ejercicio_id, serie_numero, peso_kg, repeticiones, rir, tipo_serie, notas_cliente) VALUES ?', [values]);
        res.status(201).json({ message: 'Progreso guardado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// (Omití las rutas get de dashboard y notas por brevedad, usa las que ya tenías, seguirán funcionando)

// 🚂 ENCENDIDO DEL MOTOR
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚂 Servidor backend V2 volando en el puerto ${PORT}`);
});