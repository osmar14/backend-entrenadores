const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');

const app = express();

app.use(cors());
app.use(express.json());

// 🗄️ CONEXIÓN A LA BASE DE DATOS
const db = mysql.createPool({
  host: 'crossover.proxy.rlwy.net', // Red pública temporal para pruebas locales
  user: 'root',
  password: 'ZCwKXEEmhdNENCbvuqhPAHhCGlywgQEh',
  database: 'railway',
  port: 14373 
});

// Prueba de conexión
db.getConnection()
  .then(connection => {
    console.log('✅ ¡Base de datos conectada exitosamente!');
    connection.release();
  })
  .catch(err => console.error('❌ Error conectando a BD:', err));

// ==========================================
// 🛡️ MIDDLEWARE: EL GUARDIA DE SEGURIDAD
// ==========================================
async function verificarEntrenador(req, res, next) {
    const email = req.headers['entrenador-email']; 
    if (!email) return res.status(401).json({ error: 'Falta identificación (Email/Token)' });

    try {
        const [entrenadores] = await db.query('SELECT id FROM Entrenadores WHERE email = ?', [email]);
        if (entrenadores.length === 0) {
            return res.status(404).json({ error: 'Entrenador no encontrado en la base de datos' });
        }
        req.entrenadorId = entrenadores[0].id;
        next(); 
    } catch (error) {
        res.status(500).json({ error: 'Error verificando al entrenador' });
    }
}

// ==========================================
// 🏠 DASHBOARD (INICIO Y ALERTAS)
// ==========================================
app.get('/api/dashboard', verificarEntrenador, async (req, res) => {
    try {
        const queryNotas = `
            SELECT n.*, c.nombre as cliente_nombre 
            FROM Notas_Clientes n 
            JOIN Clientes c ON n.cliente_id = c.id 
            WHERE c.entrenador_id = ? 
            ORDER BY n.fecha_creacion DESC LIMIT 10
        `;
        const [notas] = await db.query(queryNotas, [req.entrenadorId]);

        const queryProgreso = `
            SELECT rp.fecha, c.nombre as cliente_nombre, rut.nombre as rutina_nombre
            FROM Registro_Progreso rp
            JOIN Clientes c ON rp.cliente_id = c.id
            JOIN Rutinas rut ON rp.rutina_id = rut.id
            WHERE c.entrenador_id = ?
            GROUP BY rp.fecha, c.nombre, rut.nombre
            ORDER BY rp.fecha DESC LIMIT 5
        `;
        const [progresos] = await db.query(queryProgreso, [req.entrenadorId]);

        res.json({ notasRecientes: notas, actividadReciente: progresos });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 👥 RUTAS DE CLIENTES
// ==========================================
app.get('/api/clientes', verificarEntrenador, (req, res) => {
    const query = 'SELECT * FROM Clientes WHERE entrenador_id = ?';
    db.query(query, [req.entrenadorId])
        .then(([resultados]) => res.json(resultados))
        .catch(err => res.status(500).json({ error: err.message }));
});

app.post('/api/clientes', verificarEntrenador, (req, res) => {
    const { nombre, objetivo, dias_entrenamiento } = req.body;
    const query = 'INSERT INTO Clientes (nombre, objetivo, entrenador_id, dias_entrenamiento) VALUES (?, ?, ?, ?)';
    db.query(query, [nombre, objetivo, req.entrenadorId, dias_entrenamiento || ''])
        .then(([resultado]) => res.status(201).json({ id: resultado.insertId, nombre, objetivo, entrenador_id: req.entrenadorId, dias_entrenamiento }))
        .catch(err => res.status(500).json({ error: err.message }));
});

app.put('/api/clientes/:id', verificarEntrenador, (req, res) => {
    const { id } = req.params;
    const { dias_entrenamiento } = req.body;
    const query = 'UPDATE Clientes SET dias_entrenamiento = ? WHERE id = ? AND entrenador_id = ?';
    db.query(query, [dias_entrenamiento, id, req.entrenadorId])
        .then(() => res.json({ message: 'Agenda actualizada' }))
        .catch(err => res.status(500).json({ error: err.message }));
});

// ==========================================
// 📋 RUTAS DE RUTINAS
// ==========================================
app.get('/api/rutinas', verificarEntrenador, (req, res) => {
    const query = 'SELECT * FROM Rutinas WHERE entrenador_id = ?';
    db.query(query, [req.entrenadorId])
        .then(([resultados]) => res.json(resultados))
        .catch(err => res.status(500).json({ error: err.message }));
});

app.post('/api/rutinas', verificarEntrenador, (req, res) => {
    const { nombre, descripcion, nivel, es_plantilla, cliente_id } = req.body;
    const plantillaValue = es_plantilla !== undefined ? es_plantilla : 1;
    const query = 'INSERT INTO Rutinas (nombre, descripcion, nivel, es_plantilla, cliente_id, entrenador_id) VALUES (?, ?, ?, ?, ?, ?)';
    db.query(query, [nombre, descripcion, nivel, plantillaValue, cliente_id || null, req.entrenadorId])
        .then(([resultado]) => res.status(201).json({ id: resultado.insertId, nombre }))
        .catch(err => res.status(500).json({ error: err.message }));
});

app.delete('/api/rutinas/:id', verificarEntrenador, (req, res) => {
    const { id } = req.params;
    db.query('DELETE FROM Rutinas WHERE id = ? AND entrenador_id = ?', [id, req.entrenadorId])
        .then(() => res.json({ message: 'Plan eliminado' }))
        .catch(err => res.status(500).json({ error: err.message }));
});

// 🔄 RUTA CORREGIDA: Clonar rutina usando entrenador_id en lugar de email
app.post('/api/rutinas/clonar', verificarEntrenador, (req, res) => {
    const { plantilla_id, cliente_id } = req.body;
    const queryClonarRutina = `INSERT INTO Rutinas (nombre, descripcion, nivel, es_plantilla, cliente_id, entrenador_id) SELECT nombre, descripcion, nivel, 0, ?, entrenador_id FROM Rutinas WHERE id = ?`;
    db.query(queryClonarRutina, [cliente_id, plantilla_id])
        .then(([resultRutina]) => {
            const nuevaRutinaId = resultRutina.insertId;
            const queryClonarEjercicios = `INSERT INTO Rutina_Ejercicios (rutina_id, ejercicio_id, series_objetivo, reps_objetivo, dia_nombre) SELECT ?, ejercicio_id, series_objetivo, reps_objetivo, dia_nombre FROM Rutina_Ejercicios WHERE rutina_id = ?`;
            return db.query(queryClonarEjercicios, [nuevaRutinaId, plantilla_id])
                .then(() => res.status(201).json({ message: 'Rutina clonada', nuevaRutinaId }));
        })
        .catch(err => res.status(500).json({ error: err.message }));
});

// ==========================================
// 🏋️‍♂️ RUTAS DE EJERCICIOS, NOTAS Y PROGRESO
// ==========================================
app.get('/api/ejercicios', (req, res) => {
    db.query('SELECT * FROM Ejercicios')
        .then(([resultados]) => res.json(resultados))
        .catch(err => res.status(500).json({ error: err.message }));
});

app.get('/api/rutina-ejercicios/:rutina_id', (req, res) => {
    const query = `SELECT re.*, e.nombre, e.grupo_muscular FROM Rutina_Ejercicios re JOIN Ejercicios e ON re.ejercicio_id = e.id WHERE re.rutina_id = ?`;
    db.query(query, [req.params.rutina_id])
        .then(([resultados]) => res.json(resultados))
        .catch(err => res.status(500).json({ error: err.message }));
});

app.post('/api/rutina-ejercicios', (req, res) => {
    const { rutina_id, ejercicios } = req.body;
    db.query('DELETE FROM Rutina_Ejercicios WHERE rutina_id = ?', [rutina_id])
        .then(() => {
            if (!ejercicios || ejercicios.length === 0) return res.json({ message: 'Rutina vaciada' });
            const values = ejercicios.map(e => [rutina_id, e.id, e.series_objetivo, e.reps_objetivo, e.dia_nombre]);
            return db.query('INSERT INTO Rutina_Ejercicios (rutina_id, ejercicio_id, series_objetivo, reps_objetivo, dia_nombre) VALUES ?', [values])
                .then(() => res.status(201).json({ message: 'Ejercicios guardados' }));
        })
        .catch(err => res.status(500).json({ error: err.message }));
});

app.get('/api/notas/:cliente_id', (req, res) => {
    db.query('SELECT * FROM Notas_Clientes WHERE cliente_id = ? ORDER BY fecha_creacion DESC', [req.params.cliente_id])
        .then(([resultados]) => res.json(resultados))
        .catch(err => res.status(500).json({ error: err.message }));
});

app.post('/api/notas', (req, res) => {
    const { cliente_id, categoria, mensaje } = req.body;
    // Nota: Dejamos el entrenador_email aquí por si tu tabla de Notas_Clientes aún lo usa.
    db.query('INSERT INTO Notas_Clientes (cliente_id, entrenador_email, categoria, mensaje) VALUES (?, ?, ?, ?)', [cliente_id, req.headers['entrenador-email'], categoria, mensaje])
        .then(([resultado]) => res.status(201).json({ id: resultado.insertId, message: 'Nota guardada' }))
        .catch(err => res.status(500).json({ error: err.message }));
});

app.get('/api/progreso/:cliente_id/:rutina_id', (req, res) => {
    const query = `SELECT r.*, e.nombre as ejercicio_nombre FROM Registro_Progreso r JOIN Ejercicios e ON r.ejercicio_id = e.id WHERE r.cliente_id = ? AND r.rutina_id = ? ORDER BY r.fecha DESC, r.ejercicio_id, r.serie_numero`;
    db.query(query, [req.params.cliente_id, req.params.rutina_id])
        .then(([resultados]) => res.json(resultados))
        .catch(err => res.status(500).json({ error: err.message }));
});

app.post('/api/progreso', (req, res) => {
    const { cliente_id, rutina_id, registros } = req.body;
    if (!registros || registros.length === 0) return res.status(400).json({ message: 'No hay registros' });
    const values = registros.map(r => [cliente_id, rutina_id, r.ejercicio_id, r.serie_numero, r.peso || 0, r.reps || 0, r.tipo_serie || 'Normal']);
    db.query('INSERT INTO Registro_Progreso (cliente_id, rutina_id, ejercicio_id, serie_numero, peso_kg, repeticiones, tipo_serie) VALUES ?', [values])
        .then(() => res.status(201).json({ message: 'Progreso guardado' }))
        .catch(err => res.status(500).json({ error: err.message }));
});

// 🚂 ENCENDIDO DEL MOTOR
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚂 Servidor backend volando en el puerto ${PORT}`);
});