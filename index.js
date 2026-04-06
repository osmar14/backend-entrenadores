require('dotenv').config(); // 🔐 0. CARGA LAS VARIABLES DE ENTORNO DESDE EL ARCHIVO .env
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

// 🗄️ 2. CONEXIÓN A LA BASE DE DATOS (BLINDADA)
const db = mysql.createPool({
  host: process.env.DB_HOST, 
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 14373 
});

// ==========================================
// 🛡️ MIDDLEWARE INTELIGENTE (BLINDADO CON JWT)
// ==========================================
async function verificarUsuario(req, res, next) {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Acceso denegado: Falta el Token de Seguridad' });
    }

    const token = authHeader.split('Bearer ')[1];

    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        const emailSeguro = decodedToken.email; 

        if (!emailSeguro) return res.status(401).json({ error: 'Token inválido o sin correo asociado' });

        const [entrenadores] = await db.query('SELECT id FROM Entrenadores WHERE email = ?', [emailSeguro]);
        if (entrenadores.length > 0) {
            req.usuarioId = entrenadores[0].id;
            req.rol = 'entrenador';
            req.emailSeguro = emailSeguro; 
            return next();
        }

        const [clientes] = await db.query('SELECT id, entrenador_id FROM Clientes WHERE email = ?', [emailSeguro]);
        if (clientes.length > 0) {
            req.usuarioId = clientes[0].id;
            req.entrenadorId = clientes[0].entrenador_id; 
            req.rol = 'cliente';
            req.emailSeguro = emailSeguro;
            return next();
        }

        return res.status(404).json({ error: 'Usuario no encontrado en la base de datos' });
    } catch (error) {
        console.error("🚨 Intento de acceso bloqueado / Token inválido:", error.message);
        return res.status(401).json({ error: 'Token expirado, inválido o manipulado' });
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
// 👥 CLIENTES (CON LÓGICA DE NEGOCIO VIP)
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
        // 1. OBTENER ESTADO DE SUSCRIPCIÓN DEL ENTRENADOR
        const [entrenadorData] = await db.query('SELECT plan_actual FROM Entrenadores WHERE id = ?', [req.usuarioId]);
        // Si no existe la columna o el valor, asumimos 'TRIAL'
        const planActual = (entrenadorData[0] && entrenadorData[0].plan_actual) ? entrenadorData[0].plan_actual : 'TRIAL';

        // 2. CONTAR SUS CLIENTES ACTUALES
        const [conteo] = await db.query('SELECT COUNT(*) as total FROM Clientes WHERE entrenador_id = ?', [req.usuarioId]);
        const totalClientes = conteo[0].total;

        // 3. EL MURO DE PAGO (PAYWALL DE 4 CLIENTES)
        if (planActual === 'TRIAL' && totalClientes >= 4) {
            return res.status(402).json({ 
                error: 'Límite alcanzado', 
                mensaje: 'Has alcanzado el límite de 4 clientes de prueba. Actualiza a Pro para crecer tu negocio.' 
            });
        }

        // 4. CREAR EL CLIENTE (is_vip activado si es TRIAL o PRO)
        const isVip = (planActual === 'PRO' || planActual === 'TRIAL') ? 1 : 0;
        const contraseñaTemporal = 'Entrena123!';
        
        const userRecord = await admin.auth().createUser({ email: email, password: contraseñaTemporal, displayName: nombre });
        
        const [resultado] = await db.query(
            'INSERT INTO Clientes (nombre, email, objetivo, entrenador_id, dias_entrenamiento, firebase_uid, is_vip) VALUES (?, ?, ?, ?, ?, ?, ?)', 
            [nombre, email, objetivo, req.usuarioId, dias_entrenamiento || '', userRecord.uid, isVip]
        );
        
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

app.put('/api/rutinas/:id', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores' });
    const { nombre, descripcion, nivel } = req.body;
    try {
        await db.query('UPDATE Rutinas SET nombre = ?, descripcion = ?, nivel = ? WHERE id = ? AND entrenador_id = ?', 
        [nombre, descripcion, nivel || 'Principiante', req.params.id, req.usuarioId]);
        res.json({ message: 'Rutina actualizada' });
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
        // Clonación actualizada con los campos Pro
        await db.query(`INSERT INTO Rutina_Ejercicios (rutina_id, ejercicio_id, series_objetivo, reps_objetivo, rir_objetivo, notas_entrenador, dia_nombre, orden, grupo_superserie, tempo, es_unilateral, segundos_objetivo) SELECT ?, ejercicio_id, series_objetivo, reps_objetivo, rir_objetivo, notas_entrenador, dia_nombre, orden, grupo_superserie, tempo, es_unilateral, segundos_objetivo FROM Rutina_Ejercicios WHERE rutina_id = ?`, [nuevaRutinaId, plantilla_id]);
        res.status(201).json({ message: 'Rutina clonada', nuevaRutinaId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// 🏋️‍♂️ EJERCICIOS Y PRESCRIPCIÓN PRO
// ==========================================
app.get('/api/ejercicios', async (req, res) => {
    try {
        const [resultados] = await db.query('SELECT * FROM Ejercicios');
        res.json(resultados);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/rutina-ejercicios/:rutina_id', async (req, res) => {
    try {
        const [resultados] = await db.query(`
            SELECT re.*, e.nombre, e.grupo_muscular, e.tipo_metrica 
            FROM Rutina_Ejercicios re 
            JOIN Ejercicios e ON re.ejercicio_id = e.id 
            WHERE re.rutina_id = ?
            ORDER BY re.dia_nombre ASC, re.orden ASC, re.id ASC
        `, [req.params.rutina_id]);
        res.json(resultados);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/rutina-ejercicios', async (req, res) => {
    const { rutina_id, ejercicios } = req.body;
    try {
        await db.query('DELETE FROM Rutina_Ejercicios WHERE rutina_id = ?', [rutina_id]);
        if (!ejercicios || ejercicios.length === 0) return res.json({ message: 'Vaciado' });
        
        const values = ejercicios.map((e, index) => [
            rutina_id, 
            e.id || e.ejercicio_id, 
            e.series_objetivo, 
            e.reps_objetivo, 
            e.dia_nombre, 
            e.rir_objetivo || null, 
            e.notas_entrenador || '',
            e.orden !== undefined ? e.orden : index,
            e.grupo_superserie || null,
            // --- CAMPOS PRO INTEGRADOS ---
            e.tempo || null,
            e.es_unilateral ? 1 : 0,
            e.segundos_objetivo || null
        ]);
        
        await db.query(`INSERT INTO Rutina_Ejercicios (rutina_id, ejercicio_id, series_objetivo, reps_objetivo, dia_nombre, rir_objetivo, notas_entrenador, orden, grupo_superserie, tempo, es_unilateral, segundos_objetivo) VALUES ?`, [values]);
        res.status(201).json({ message: 'Guardados con parámetros Pro' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// 📊 PROGRESO, MÉTRICAS Y NOTAS
// ==========================================
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/metricas/volumen/:cliente_id', async (req, res) => {
    try {
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
    } catch (err) { res.status(500).json({ error: err.message }); }
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
        const email = req.emailSeguro; 
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
        const [existe] = await db.query('SELECT id FROM Entrenadores WHERE email = ?', [email]);
        
        if (existe.length === 0) {
            const nombre = email.split('@')[0];
            await db.query('INSERT INTO Entrenadores (nombre, email, plan_actual) VALUES (?, ?, ?)', [nombre, email, 'TRIAL']);
        }
        res.status(200).json({ message: "Entrenador verificado/creado" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 🚂 ENCENDIDO DEL MOTOR
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`🚂 Servidor backend V2 volando en el puerto ${PORT}`); });