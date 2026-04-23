require('dotenv').config(); // 🔐 0. CARGA LAS VARIABLES DE ENTORNO DESDE EL ARCHIVO .env
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const admin = require('firebase-admin');
const stripeKey = process.env.STRIPE_SECRET_KEY || 'sk_test_mock';
const stripe = require('stripe')(stripeKey); // Stripe

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
const http = require('http');
const { Server } = require('socket.io');
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());

// ==========================================
// 💳 WEBHOOKS DE PAGOS (STRIPE)
// Debe ir ANTES de express.json() para recibir el raw body
// ==========================================
app.post('/api/webhooks/stripe', express.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error(`🚨 Webhook Error: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // ✅ Pago completado → Activar plan
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const email = session.customer_email;
        const planAdquirido = session.metadata?.plan || 'BASICO'; 
        
        try {
            await db.query('UPDATE Entrenadores SET plan_actual = ?, stripe_customer_id = ? WHERE email = ?', [planAdquirido, session.customer, email]);
            console.log(`✅ Plan de suscripción actualizado a ${planAdquirido} para ${email}`);
        } catch (error) {
            console.error("🚨 Error actualizando plan en DB:", error);
        }
    }

    // 🚨 Suscripción cancelada → Degradar a TRIAL
    if (event.type === 'customer.subscription.deleted') {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        
        try {
            await db.query('UPDATE Entrenadores SET plan_actual = ? WHERE stripe_customer_id = ?', ['TRIAL', customerId]);
            console.log(`⚠️ Suscripción cancelada para customer ${customerId}. Plan degradado a TRIAL.`);
        } catch (error) {
            console.error("🚨 Error degradando plan:", error);
        }
    }

    res.json({received: true});
});

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
// 🛡️ MIDDLEWARE OPCIONAL (Para rutas semi-públicas)
// ==========================================
async function obtenerUsuarioOpcional(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return next();
    
    const token = authHeader.split('Bearer ')[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        const emailSeguro = decodedToken.email; 
        if (!emailSeguro) return next();
        
        const [entrenadores] = await db.query('SELECT id FROM Entrenadores WHERE email = ?', [emailSeguro]);
        if (entrenadores.length > 0) {
            req.usuarioId = entrenadores[0].id;
            req.rol = 'entrenador';
        }
    } catch (e) {}
    next();
}

// ==========================================
// 🛡️ MIDDLEWARE DE PLAN (Verifica nivel de suscripción)
// ==========================================
function verificarPlan(planMinimo) {
    return async (req, res, next) => {
        try {
            const [entrenadorData] = await db.query('SELECT plan_actual FROM Entrenadores WHERE id = ?', [req.usuarioId]);
            const plan = (entrenadorData[0] && entrenadorData[0].plan_actual) ? entrenadorData[0].plan_actual : 'TRIAL';
            const jerarquia = { TRIAL: 0, BASICO: 1, PRO: 2 };
            if ((jerarquia[plan] || 0) < (jerarquia[planMinimo] || 0)) {
                return res.status(403).json({ error: `Función exclusiva del plan ${planMinimo}. Tu plan actual: ${plan}` });
            }
            req.planActual = plan;
            next();
        } catch (error) {
            return res.status(500).json({ error: 'Error verificando plan' });
        }
    };
}

// ==========================================
// 🛡️ HELPER: Verificar que un cliente pertenece al entrenador
// ==========================================
async function verificarPropiedadCliente(req, res, next) {
    const clienteId = req.params.cliente_id || req.params.id;
    if (!clienteId) return next();
    try {
        if (req.rol === 'entrenador') {
            const [check] = await db.query('SELECT id FROM Clientes WHERE id = ? AND entrenador_id = ?', [clienteId, req.usuarioId]);
            if (check.length === 0) return res.status(403).json({ error: 'Este cliente no te pertenece' });
        } else if (req.rol === 'cliente') {
            if (parseInt(clienteId) !== req.usuarioId) return res.status(403).json({ error: 'Acceso denegado' });
        }
        next();
    } catch (error) {
        return res.status(500).json({ error: 'Error de verificación' });
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

        // 3. EL MURO DE PAGO (PAYWALL DE 3 CLIENTES)
        if (planActual === 'TRIAL' && totalClientes >= 3) {
            return res.status(402).json({ 
                error: 'Límite alcanzado', 
                mensaje: 'Has alcanzado el límite de 3 clientes en tu plan Starter Gratuito. Actualiza al Plan Básico o Pro para clientes ilimitados.' 
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

app.post('/api/rutinas/clonar-masivo', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores' });
    const { plantilla_id, cliente_ids } = req.body;
    if (!cliente_ids || !Array.isArray(cliente_ids) || cliente_ids.length === 0) return res.status(400).json({ error: 'Se requiere una lista de cliente_ids' });
    
    try {
        for (const c_id of cliente_ids) {
            const [resultRutina] = await db.query(`INSERT INTO Rutinas (nombre, descripcion, nivel, es_plantilla, cliente_id, entrenador_id) SELECT nombre, descripcion, nivel, 0, ?, entrenador_id FROM Rutinas WHERE id = ?`, [c_id, plantilla_id]);
            const nuevaRutinaId = resultRutina.insertId;
            await db.query(`INSERT INTO Rutina_Ejercicios (rutina_id, ejercicio_id, series_objetivo, reps_objetivo, rir_objetivo, notas_entrenador, dia_nombre, orden, grupo_superserie, tempo, es_unilateral, segundos_objetivo) SELECT ?, ejercicio_id, series_objetivo, reps_objetivo, rir_objetivo, notas_entrenador, dia_nombre, orden, grupo_superserie, tempo, es_unilateral, segundos_objetivo FROM Rutina_Ejercicios WHERE rutina_id = ?`, [nuevaRutinaId, plantilla_id]);
        }
        res.status(201).json({ message: 'Rutinas clonadas masivamente' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// 🏋️‍♂️ EJERCICIOS Y PRESCRIPCIÓN PRO
// ==========================================
app.get('/api/ejercicios', obtenerUsuarioOpcional, async (req, res) => {
    try {
        const query = 'SELECT * FROM Ejercicios WHERE entrenador_id IS NULL OR entrenador_id = ?';
        const [resultados] = await db.query(query, [req.usuarioId || null]);
        res.json(resultados);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/ejercicios', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores' });
    const { nombre, grupo_muscular, tipo_metrica } = req.body;
    try {
        const [resultado] = await db.query('INSERT INTO Ejercicios (nombre, grupo_muscular, tipo_metrica, entrenador_id) VALUES (?, ?, ?, ?)', [nombre, grupo_muscular, tipo_metrica || 'reps', req.usuarioId]);
        res.status(201).json({ id: resultado.insertId, nombre, grupo_muscular, tipo_metrica, entrenador_id: req.usuarioId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/ejercicios/:id', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores' });
    const { nombre, grupo_muscular, tipo_metrica } = req.body;
    try {
        await db.query('UPDATE Ejercicios SET nombre = ?, grupo_muscular = ?, tipo_metrica = ? WHERE id = ? AND entrenador_id = ?', [nombre, grupo_muscular, tipo_metrica, req.params.id, req.usuarioId]);
        res.json({ message: 'Ejercicio actualizado' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/ejercicios/:id', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores' });
    try {
        await db.query('DELETE FROM Ejercicios WHERE id = ? AND entrenador_id = ?', [req.params.id, req.usuarioId]);
        res.json({ message: 'Ejercicio eliminado' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/rutina-ejercicios/:rutina_id', verificarUsuario, async (req, res) => {
    try {
        // Verificar que la rutina pertenece al entrenador o al cliente
        const [rutina] = await db.query('SELECT * FROM Rutinas WHERE id = ?', [req.params.rutina_id]);
        if (rutina.length === 0) return res.status(404).json({ error: 'Rutina no encontrada' });

        if (req.rol === 'entrenador' && rutina[0].entrenador_id !== req.usuarioId) {
            return res.status(403).json({ error: 'Esta rutina no te pertenece' });
        }
        if (req.rol === 'cliente' && rutina[0].cliente_id !== req.usuarioId) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

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

app.post('/api/rutina-ejercicios', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores' });
    const { rutina_id, ejercicios } = req.body;
    
    try {
        // Obtenemos el plan del entrenador para saber si bloqueamos opciones Pro
        const [entrenadorData] = await db.query('SELECT plan_actual FROM Entrenadores WHERE id = ?', [req.usuarioId]);
        const planActual = (entrenadorData[0] && entrenadorData[0].plan_actual) ? entrenadorData[0].plan_actual : 'TRIAL';
        const esPro = (planActual === 'PRO');

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
            // --- SEGURIDAD PRO --- Si no es PRO, se guardan como NULL / false
            esPro ? (e.tempo || null) : null,
            esPro ? (e.es_unilateral ? 1 : 0) : 0,
            esPro ? (e.segundos_objetivo || null) : null
        ]);
        
        await db.query(`INSERT INTO Rutina_Ejercicios (rutina_id, ejercicio_id, series_objetivo, reps_objetivo, dia_nombre, rir_objetivo, notas_entrenador, orden, grupo_superserie, tempo, es_unilateral, segundos_objetivo) VALUES ?`, [values]);
        res.status(201).json({ message: 'Guardados', plan: planActual });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// 📊 PROGRESO, MÉTRICAS Y NOTAS
// ==========================================
app.get('/api/feedback-cliente/:cliente_id', verificarUsuario, verificarPropiedadCliente, async (req, res) => {
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

app.get('/api/metricas/volumen/:cliente_id', verificarUsuario, verificarPropiedadCliente, async (req, res) => {
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
        
        // Semáforo de Fatiga
        const resultadosConSemaforo = resultados.map(r => {
            let estado = 'Verde';
            if (r.total_series > 10 && r.total_series <= 20) estado = 'Amarillo';
            if (r.total_series > 20) estado = 'Rojo';
            return { ...r, semaforo: estado };
        });

        res.json(resultadosConSemaforo);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/metricas/radar/:cliente_id', verificarUsuario, verificarPropiedadCliente, async (req, res) => {
    try {
        const query = `
            SELECT e.grupo_muscular, COUNT(rp.id) as total_series 
            FROM Registro_Progreso rp
            JOIN Ejercicios e ON rp.ejercicio_id = e.id
            WHERE rp.cliente_id = ? AND rp.fecha >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            GROUP BY e.grupo_muscular
        `;
        const [resultados] = await db.query(query, [req.params.cliente_id]);
        res.json(resultados);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/metricas/radar-detalle/:cliente_id/:grupo_muscular', verificarUsuario, verificarPropiedadCliente, async (req, res) => {
    try {
        const query = `
            SELECT e.nombre as ejercicio, COUNT(rp.id) as total_series 
            FROM Registro_Progreso rp
            JOIN Ejercicios e ON rp.ejercicio_id = e.id
            WHERE rp.cliente_id = ? AND e.grupo_muscular = ? AND rp.fecha >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            GROUP BY e.id, e.nombre
        `;
        const [resultados] = await db.query(query, [req.params.cliente_id, req.params.grupo_muscular]);
        res.json(resultados);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/metricas/comparativa/:cliente_id', verificarUsuario, verificarPropiedadCliente, async (req, res) => {
    try {
        // Se aceptan mes1 y mes2 en formato YYYY-MM
        const { mes1, mes2 } = req.query;
        if (!mes1 || !mes2) return res.status(400).json({error: "Se requieren mes1 y mes2"});
        
        const query = `
            SELECT 
                e.grupo_muscular, 
                SUM(CASE WHEN DATE_FORMAT(rp.fecha, '%Y-%m') = ? THEN 1 ELSE 0 END) as series_mes1,
                SUM(CASE WHEN DATE_FORMAT(rp.fecha, '%Y-%m') = ? THEN 1 ELSE 0 END) as series_mes2
            FROM Registro_Progreso rp
            JOIN Ejercicios e ON rp.ejercicio_id = e.id
            WHERE rp.cliente_id = ? 
            AND (DATE_FORMAT(rp.fecha, '%Y-%m') = ? OR DATE_FORMAT(rp.fecha, '%Y-%m') = ?)
            GROUP BY e.grupo_muscular
        `;
        const [resultados] = await db.query(query, [mes1, mes2, req.params.cliente_id, mes1, mes2]);
        res.json(resultados);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/metricas/1rm/:cliente_id/:ejercicio_id', verificarUsuario, verificarPropiedadCliente, async (req, res) => {
    try {
        // Fórmula Brzycki / Epley para estimar el 1RM
        const query = `
            SELECT fecha, peso_kg, repeticiones, 
                   ROUND(peso_kg * (1 + (repeticiones / 30)), 2) AS estimado_1rm
            FROM Registro_Progreso 
            WHERE cliente_id = ? AND ejercicio_id = ? AND repeticiones > 0
            ORDER BY fecha ASC
        `;
        const [resultados] = await db.query(query, [req.params.cliente_id, req.params.ejercicio_id]);
        res.json(resultados);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/notas/:cliente_id', verificarUsuario, verificarPropiedadCliente, async (req, res) => {
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

app.get('/api/progreso/:cliente_id/:rutina_id', verificarUsuario, verificarPropiedadCliente, async (req, res) => {
    try {
        const [resultados] = await db.query(`SELECT r.*, e.nombre as ejercicio_nombre FROM Registro_Progreso r JOIN Ejercicios e ON r.ejercicio_id = e.id WHERE r.cliente_id = ? AND r.rutina_id = ? ORDER BY r.fecha DESC, r.ejercicio_id, r.serie_numero`, [req.params.cliente_id, req.params.rutina_id]);
        res.json(resultados);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/progreso-global/:cliente_id', verificarUsuario, verificarPropiedadCliente, async (req, res) => {
    try {
        const query = `
            SELECT rp.fecha, rp.rutina_id, r.nombre as rutina_nombre
            FROM Registro_Progreso rp
            LEFT JOIN Rutinas r ON rp.rutina_id = r.id
            WHERE rp.cliente_id = ?
            GROUP BY rp.fecha, rp.rutina_id, r.nombre
            ORDER BY rp.fecha DESC
            LIMIT 5
        `;
        const [resultados] = await db.query(query, [req.params.cliente_id]);
        res.json(resultados);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// 📸 FOTOS DE PROGRESO
// ==========================================
app.get('/api/fotos/:cliente_id', verificarUsuario, verificarPropiedadCliente, async (req, res) => {
    try {
        const [resultados] = await db.query('SELECT * FROM Fotos_Progreso WHERE cliente_id = ? ORDER BY fecha_captura DESC', [req.params.cliente_id]);
        res.json(resultados);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/fotos', verificarUsuario, async (req, res) => {
    const { cliente_id, url_foto, peso_kg } = req.body;
    // Si es cliente, validar que solo pueda subir sus propias fotos
    if (req.rol === 'cliente' && req.usuarioId !== parseInt(cliente_id)) {
        return res.status(403).json({ error: 'No puedes subir fotos para otro cliente' });
    }
    // TODO: Verificar límite de plan (Básico vs Pro)
    try {
        await db.query('INSERT INTO Fotos_Progreso (cliente_id, url_foto, fecha_captura, peso_kg) VALUES (?, ?, NOW(), ?)', [cliente_id, url_foto, peso_kg || null]);
        res.json({ message: 'Foto guardada correctamente' });
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
// 🌟 REGISTRO Y PERFIL DE ENTRENADORES
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

app.get('/api/entrenadores/perfil', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores' });
    try {
        const [entrenadorData] = await db.query('SELECT plan_actual FROM Entrenadores WHERE id = ?', [req.usuarioId]);
        const planActual = (entrenadorData[0] && entrenadorData[0].plan_actual) ? entrenadorData[0].plan_actual : 'TRIAL';
        res.json({ plan_actual: planActual });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 🔐 SOLO PARA DESARROLLO — Eliminar en producción (Temporalmente activado para que puedas cambiar planes libremente)
app.put('/api/entrenadores/test-plan', verificarUsuario, async (req, res) => {
    // if (process.env.NODE_ENV === 'production') return res.status(403).json({ error: 'Endpoint deshabilitado en producción' });
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores' });
    const { nuevo_plan } = req.body; // 'TRIAL', 'BASICO', 'PRO'
    try {
        await db.query('UPDATE Entrenadores SET plan_actual = ? WHERE id = ?', [nuevo_plan, req.usuarioId]);
        res.json({ message: 'Plan actualizado exitosamente (Modo Prueba)' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// 💳 CHECKOUT DE STRIPE (Crear sesión de pago)
// ==========================================
app.post('/api/crear-sesion-pago', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores' });
    const { plan } = req.body; // 'BASICO' o 'PRO'
    
    if (!plan || !['BASICO', 'PRO'].includes(plan)) {
        return res.status(400).json({ error: 'Plan inválido. Debe ser BASICO o PRO' });
    }

    // Los Price IDs se configuran en el dashboard de Stripe
    const preciosPorPlan = {
        BASICO: process.env.STRIPE_PRICE_BASICO,
        PRO: process.env.STRIPE_PRICE_PRO
    };

    const precioId = preciosPorPlan[plan];
    if (!precioId) {
        return res.status(500).json({ error: 'Price ID no configurado para este plan. Configura STRIPE_PRICE_BASICO y STRIPE_PRICE_PRO en las variables de entorno.' });
    }

    try {
        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            payment_method_types: ['card'],
            customer_email: req.emailSeguro,
            line_items: [{ price: precioId, quantity: 1 }],
            metadata: { plan },
            success_url: `${process.env.FRONTEND_URL || 'https://tu-web.com'}/planes?resultado=exito`,
            cancel_url: `${process.env.FRONTEND_URL || 'https://tu-web.com'}/planes?resultado=cancelado`,
        });
        
        res.json({ url: session.url, sessionId: session.id });
    } catch (err) {
        console.error('🚨 Error creando sesión de Stripe:', err.message);
        res.status(500).json({ error: 'Error al crear sesión de pago: ' + err.message });
    }
});

// ==========================================
// 💳 PORTAL DE CLIENTES STRIPE (Gestionar suscripción)
// ==========================================
app.post('/api/portal-suscripcion', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores' });
    try {
        const [entrenadorData] = await db.query('SELECT stripe_customer_id FROM Entrenadores WHERE id = ?', [req.usuarioId]);
        const customerId = entrenadorData[0]?.stripe_customer_id;
        
        if (!customerId) {
            return res.status(400).json({ error: 'No tienes una suscripción activa para gestionar' });
        }

        const portalSession = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: `${process.env.FRONTEND_URL || 'https://tu-web.com'}/planes`,
        });
        
        res.json({ url: portalSession.url });
    } catch (err) {
        res.status(500).json({ error: 'Error al crear portal: ' + err.message });
    }
});

// ==========================================
// 📡 COACHBOARD LIVE (SOCKET.IO)
// ==========================================
io.on('connection', (socket) => {
    console.log('🔗 Cliente conectado a Coachboard Live:', socket.id);

    // Entrenador se une a su canal privado
    socket.on('unirse_como_coach', (coachId) => {
        socket.join(`coach_${coachId}`);
        console.log(`👨‍🏫 Coach ${coachId} listo para monitorear en vivo`);
    });

    // Cliente inicia rutina
    socket.on('iniciar_entrenamiento', (data) => {
        // data: { coachId, clienteId, clienteNombre, rutinaNombre }
        io.to(`coach_${data.coachId}`).emit('cliente_entrenando', data);
    });

    // Cliente actualiza una serie (escribe peso/reps)
    socket.on('actualizar_serie', (data) => {
        // data: { coachId, clienteId, ejercicio, set, peso, reps }
        io.to(`coach_${data.coachId}`).emit('progreso_en_vivo', data);
    });

    // Cliente termina rutina
    socket.on('terminar_entrenamiento', (data) => {
        io.to(`coach_${data.coachId}`).emit('cliente_termino', data);
    });

    socket.on('disconnect', () => {
        console.log('🔴 Cliente desconectado de Coachboard Live:', socket.id);
    });
});

// 🚂 ENCENDIDO DEL MOTOR
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`🚂 Servidor backend V3 (Live + Pago) volando en el puerto ${PORT}`); });