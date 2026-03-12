const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const admin = require('firebase-admin');

// 🔐 1. INICIALIZAR EL PODER DE ADMINISTRADOR DE FIREBASE
let serviceAccount;
if (process.env.FIREBASE_CREDENTIALS) {
  serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
} else {
  serviceAccount = require('./firebase-secret.json');
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const app = express();
app.use(cors());
app.use(express.json());

// 🗄️ 2. CONEXIÓN A LA BASE DE DATOS
const db = mysql.createPool({
  host: 'crossover.proxy.rlwy.net', 
  user: 'root',
  password: 'ZCwKXEEmhdNENCbvuqhPAHhCGlywgQEh',
  database: 'railway',
  port: 14373 
});

// ==========================================
// 🛡️ MIDDLEWARE INTELIGENTE
// ==========================================
async function verificarUsuario(req, res, next) {
    const email = req.headers['usuario-email'] || req.headers['entrenador-email']; 
    if (!email) return res.status(401).json({ error: 'Falta identificación' });

    try {
        const [entrenadores] = await db.query('SELECT id FROM Entrenadores WHERE email = ?', [email]);
        if (entrenadores.length > 0) {
            req.usuarioId = entrenadores[0].id;
            req.rol = 'entrenador';
            return next();
        }

        const [clientes] = await db.query('SELECT id, entrenador_id FROM Clientes WHERE email = ?', [email]);
        if (clientes.length > 0) {
            req.usuarioId = clientes[0].id;
            req.entrenadorId = clientes[0].entrenador_id; 
            req.rol = 'cliente';
            return next();
        }

        return res.status(404).json({ error: 'Usuario no encontrado' });
    } catch (error) {
        res.status(500).json({ error: 'Error verificando al usuario' });
    }
}

// ==========================================
// 🏠 DASHBOARD
// ==========================================
app.get('/api/dashboard', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores' });
    try {
        const [notas] = await db.query(`SELECT n.*, c.nombre as cliente_nombre FROM Notas_Clientes n JOIN Clientes c ON n.cliente_id = c.id WHERE c.entrenador_id = ? ORDER BY n.fecha_creacion DESC LIMIT 10`, [req.usuarioId]);
        const [progresos] = await db.query(`SELECT rp.fecha, c.nombre as cliente_nombre, rut.nombre as rutina_nombre FROM Registro_Progreso rp JOIN Clientes c ON rp.cliente_id = c.id JOIN Rutinas rut ON rp.rutina_id = rut.id WHERE c.entrenador_id = ? GROUP BY rp.fecha, c.nombre, rut.nombre ORDER BY rp.fecha DESC LIMIT 5`, [req.usuarioId]);
        res.json({ notasRecientes: notas, actividadReciente: progresos });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// 👥 CLIENTES
// ==========================================
app.get('/api/clientes', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Acceso denegado' });
    try {
        const [resultados] = await db.query('SELECT * FROM Clientes WHERE entrenador_id = ?', [req.usuarioId]);
        res.json(resultados);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/clientes', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores' });
    const { nombre, email, objetivo, dias_entrenamiento } = req.body;
    if (!email) return res.status(400).json({ error: 'El correo es obligatorio' });

    try {
        const contraseñaTemporal = 'Entrena123!';
        const userRecord = await admin.auth().createUser({ email: email, password: contraseñaTemporal, displayName: nombre });
        const [resultado] = await db.query('INSERT INTO Clientes (nombre, email, objetivo, entrenador_id, dias_entrenamiento, firebase_uid) VALUES (?, ?, ?, ?, ?, ?)', [nombre, email, objetivo, req.usuarioId, dias_entrenamiento || '', userRecord.uid]);
        res.status(201).json({ id: resultado.insertId, nombre, email, password_temporal: contraseñaTemporal });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/clientes/:id', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores' });
    const { dias_entrenamiento } = req.body;
    try {
        await db.query('UPDATE Clientes SET dias_entrenamiento = ? WHERE id = ? AND entrenador_id = ?', [dias_entrenamiento, req.params.id, req.usuarioId]);
        res.json({ message: 'Actualizado' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// 📋 RUTAS DE RUTINAS Y CLONACIÓN
// ==========================================
app.get('/api/rutinas', verificarUsuario, async (req, res) => {
    try {
        const query = req.rol === 'entrenador' ? 'SELECT * FROM Rutinas WHERE entrenador_id = ?' : 'SELECT * FROM Rutinas WHERE cliente_id = ? AND es_plantilla = 0 AND activa = 1';
        const [resultados] = await db.query(query, [req.usuarioId]);
        res.json(resultados);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/rutinas', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores' });
    const { nombre, descripcion, nivel, es_plantilla, cliente_id } = req.body;
    try {
        const [resultado] = await db.query('INSERT INTO Rutinas (nombre, descripcion, nivel, es_plantilla, cliente_id, entrenador_id) VALUES (?, ?, ?, ?, ?, ?)', [nombre, descripcion, nivel, es_plantilla !== undefined ? es_plantilla : 1, cliente_id || null, req.usuarioId]);
        res.status(201).json({ id: resultado.insertId, nombre });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/rutinas/:id', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores' });
    try {
        await db.query('DELETE FROM Rutinas WHERE id = ? AND entrenador_id = ?', [req.params.id, req.usuarioId]);
        res.json({ message: 'Eliminado' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/rutinas/clonar', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores' });
    const { plantilla_id, cliente_id } = req.body;
    try {
        const [resultRutina] = await db.query(`INSERT INTO Rutinas (nombre, descripcion, nivel, es_plantilla, cliente_id, entrenador_id) SELECT nombre, descripcion, nivel, 0, ?, entrenador_id FROM Rutinas WHERE id = ?`, [cliente_id, plantilla_id]);
        const nuevaRutinaId = resultRutina.insertId;
        await db.query(`INSERT INTO Rutina_Ejercicios (rutina_id, ejercicio_id, series_objetivo, reps_objetivo, rir_objetivo, notas_entrenador, dia_nombre) SELECT ?, ejercicio_id, series_objetivo, reps_objetivo, rir_objetivo, notas_entrenador, dia_nombre FROM Rutina_Ejercicios WHERE rutina_id = ?`, [nuevaRutinaId, plantilla_id]);
        res.status(201).json({ message: 'Rutina clonada', nuevaRutinaId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// 🏋️‍♂️ EJERCICIOS, PROGRESO Y NOTAS
// ==========================================
app.get('/api/ejercicios', async (req, res) => {
    try {
        const [resultados] = await db.query('SELECT * FROM Ejercicios');
        res.json(resultados);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/rutina-ejercicios/:rutina_id', async (req, res) => {
    try {
        const [resultados] = await db.query(`SELECT re.*, e.nombre, e.grupo_muscular FROM Rutina_Ejercicios re JOIN Ejercicios e ON re.ejercicio_id = e.id WHERE re.rutina_id = ?`, [req.params.rutina_id]);
        res.json(resultados);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/rutina-ejercicios', async (req, res) => {
    const { rutina_id, ejercicios } = req.body;
    try {
        await db.query('DELETE FROM Rutina_Ejercicios WHERE rutina_id = ?', [rutina_id]);
        if (!ejercicios || ejercicios.length === 0) return res.json({ message: 'Vaciado' });
        const values = ejercicios.map(e => [rutina_id, e.id, e.series_objetivo, e.reps_objetivo, e.dia_nombre, e.rir_objetivo || null, e.notas_entrenador || '']);
        await db.query('INSERT INTO Rutina_Ejercicios (rutina_id, ejercicio_id, series_objetivo, reps_objetivo, dia_nombre, rir_objetivo, notas_entrenador) VALUES ?', [values]);
        res.status(201).json({ message: 'Guardados' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 🗣️ MÉTRICA: Extraer todo el feedback y notas del cliente
app.get('/api/feedback-cliente/:cliente_id', async (req, res) => {
    try {
        const query = `
            SELECT rp.fecha, rp.notas_cliente, e.nombre as ejercicio_nombre 
            FROM Registro_Progreso rp
            JOIN Ejercicios e ON rp.ejercicio_id = e.id
            WHERE rp.cliente_id = ? AND rp.notas_cliente IS NOT NULL AND rp.notas_cliente != ''
            ORDER BY rp.fecha DESC
            LIMIT 20
        `;
        const [resultados] = await db.query(query, [req.params.cliente_id]);
        res.json(resultados);
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

// 📊 MÉTRICA AVANZADA: Volumen Semanal por Grupo Muscular
app.get('/api/metricas/volumen/:cliente_id', async (req, res) => {
    try {
        // Cuenta las series hechas en los últimos 7 días agrupadas por músculo
        const query = `
            SELECT e.grupo_muscular, COUNT(rp.id) as total_series 
            FROM Registro_Progreso rp
            JOIN Ejercicios e ON rp.ejercicio_id = e.id
            WHERE rp.cliente_id = ? AND rp.fecha >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
            GROUP BY e.grupo_muscular
            ORDER BY total_series DESC
        `;
        const [resultados] = await db.query(query, [req.params.cliente_id]);
        res.json(resultados);
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.get('/api/notas/:cliente_id', async (req, res) => {
    try {
        const [resultados] = await db.query('SELECT * FROM Notas_Clientes WHERE cliente_id = ? ORDER BY fecha_creacion DESC', [req.params.cliente_id]);
        res.json(resultados);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/notas', verificarUsuario, async (req, res) => {
    const { cliente_id, categoria, mensaje } = req.body;
    try {
        // Obtenemos el email para guardarlo en la nota (compatibilidad hacia atrás)
        const email = req.headers['usuario-email'] || req.headers['entrenador-email'];
        const [resultado] = await db.query('INSERT INTO Notas_Clientes (cliente_id, entrenador_email, categoria, mensaje) VALUES (?, ?, ?, ?)', [cliente_id, email, categoria, mensaje]);
        res.status(201).json({ id: resultado.insertId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/progreso/:cliente_id/:rutina_id', async (req, res) => {
    try {
        const [resultados] = await db.query(`SELECT r.*, e.nombre as ejercicio_nombre FROM Registro_Progreso r JOIN Ejercicios e ON r.ejercicio_id = e.id WHERE r.cliente_id = ? AND r.rutina_id = ? ORDER BY r.fecha DESC, r.ejercicio_id, r.serie_numero`, [req.params.cliente_id, req.params.rutina_id]);
        res.json(resultados);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/progreso', verificarUsuario, async (req, res) => {
    const { rutina_id, registros } = req.body;
    const clienteId = req.rol === 'cliente' ? req.usuarioId : req.body.cliente_id;
    if (!registros || registros.length === 0) return res.status(400).json({ message: 'Vacío' });
    try {
        const values = registros.map(r => [clienteId, rutina_id, r.ejercicio_id, r.serie_numero, r.peso || 0, r.reps || 0, r.rir || null, r.tipo_serie || 'Normal', r.notas_cliente || '']);
        await db.query('INSERT INTO Registro_Progreso (cliente_id, rutina_id, ejercicio_id, serie_numero, peso_kg, repeticiones, rir, tipo_serie, notas_cliente) VALUES ?', [values]);
        res.status(201).json({ message: 'Progreso guardado' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// 🌟 REGISTRO DE ENTRENADORES NUEVOS
// ==========================================
app.post('/api/entrenadores/registro', async (req, res) => {
    try {
        const { email } = req.body;
        // Revisamos si ya existe
        const [existe] = await db.query('SELECT id FROM Entrenadores WHERE email = ?', [email]);
        
        if (existe.length === 0) {
            // Si no existe, lo insertamos en la base de datos de Railway
            const nombre = email.split('@')[0]; // Tomamos la primera parte del correo como nombre temporal
            await db.query('INSERT INTO Entrenadores (nombre, email) VALUES (?, ?)', [nombre, email]);
        }
        res.status(200).json({ message: "Entrenador verificado/creado" });
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

// 🚂 ENCENDIDO DEL MOTOR
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`🚂 Servidor backend V2 volando en el puerto ${PORT}`); });