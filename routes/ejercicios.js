const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verificarUsuario, obtenerUsuarioOpcional } = require('../middlewares/auth');

router.get('/', obtenerUsuarioOpcional, async (req, res) => {
    try {
        const query = 'SELECT * FROM Ejercicios WHERE entrenador_id IS NULL OR entrenador_id = ?';
        const [resultados] = await db.query(query, [req.usuarioId || null]);
        res.json(resultados);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores' });
    const { nombre, grupo_muscular, tipo_metrica } = req.body;
    try {
        const [resultado] = await db.query('INSERT INTO Ejercicios (nombre, grupo_muscular, tipo_metrica, entrenador_id) VALUES (?, ?, ?, ?)', [nombre, grupo_muscular, tipo_metrica || 'reps', req.usuarioId]);
        res.status(201).json({ id: resultado.insertId, nombre, grupo_muscular, tipo_metrica, entrenador_id: req.usuarioId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores' });
    const { nombre, grupo_muscular, tipo_metrica } = req.body;
    try {
        await db.query('UPDATE Ejercicios SET nombre = ?, grupo_muscular = ?, tipo_metrica = ? WHERE id = ? AND entrenador_id = ?', [nombre, grupo_muscular, tipo_metrica, req.params.id, req.usuarioId]);
        res.json({ message: 'Ejercicio actualizado' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores' });
    try {
        await db.query('DELETE FROM Ejercicios WHERE id = ? AND entrenador_id = ?', [req.params.id, req.usuarioId]);
        res.json({ message: 'Ejercicio eliminado' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// RUTAS RELACIONADAS A RUTINA-EJERCICIOS

router.get('/rutina/:rutina_id', verificarUsuario, async (req, res) => {
    try {
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

router.post('/rutina', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores' });
    const { rutina_id, ejercicios } = req.body;
    
    try {
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
            esPro ? (e.tempo || null) : null,
            esPro ? (e.es_unilateral ? 1 : 0) : 0,
            esPro ? (e.segundos_objetivo || null) : null
        ]);
        
        await db.query(`INSERT INTO Rutina_Ejercicios (rutina_id, ejercicio_id, series_objetivo, reps_objetivo, dia_nombre, rir_objetivo, notas_entrenador, orden, grupo_superserie, tempo, es_unilateral, segundos_objetivo) VALUES ?`, [values]);
        res.status(201).json({ message: 'Guardados', plan: planActual });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
