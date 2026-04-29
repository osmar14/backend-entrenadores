const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verificarUsuario } = require('../middlewares/auth');

router.get('/', verificarUsuario, async (req, res) => {
    try {
        const query = req.rol === 'entrenador' ? 'SELECT * FROM Rutinas WHERE entrenador_id = ?' : 'SELECT * FROM Rutinas WHERE cliente_id = ? AND es_plantilla = 0 AND activa = 1';
        const [resultados] = await db.query(query, [req.usuarioId]);
        res.json(resultados);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores' });
    const { nombre, descripcion, nivel, es_plantilla, cliente_id } = req.body;
    try {
        const [resultado] = await db.query('INSERT INTO Rutinas (nombre, descripcion, nivel, es_plantilla, cliente_id, entrenador_id) VALUES (?, ?, ?, ?, ?, ?)', [nombre, descripcion, nivel, es_plantilla !== undefined ? es_plantilla : 1, cliente_id || null, req.usuarioId]);
        res.status(201).json({ id: resultado.insertId, nombre });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores' });
    const { nombre, descripcion, nivel } = req.body;
    try {
        await db.query('UPDATE Rutinas SET nombre = ?, descripcion = ?, nivel = ? WHERE id = ? AND entrenador_id = ?', 
        [nombre, descripcion, nivel || 'Principiante', req.params.id, req.usuarioId]);
        res.json({ message: 'Rutina actualizada' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores' });
    try {
        await db.query('DELETE FROM Rutinas WHERE id = ? AND entrenador_id = ?', [req.params.id, req.usuarioId]);
        res.json({ message: 'Eliminado' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/clonar', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores' });
    const { plantilla_id, cliente_id } = req.body;
    try {
        const [resultRutina] = await db.query(`INSERT INTO Rutinas (nombre, descripcion, nivel, es_plantilla, cliente_id, entrenador_id) SELECT nombre, descripcion, nivel, 0, ?, entrenador_id FROM Rutinas WHERE id = ?`, [cliente_id, plantilla_id]);
        const nuevaRutinaId = resultRutina.insertId;
        await db.query(`INSERT INTO Rutina_Ejercicios (rutina_id, ejercicio_id, series_objetivo, reps_objetivo, rir_objetivo, notas_entrenador, dia_nombre, orden, grupo_superserie, tempo, es_unilateral, segundos_objetivo, tipos_series) SELECT ?, ejercicio_id, series_objetivo, reps_objetivo, rir_objetivo, notas_entrenador, dia_nombre, orden, grupo_superserie, tempo, es_unilateral, segundos_objetivo, tipos_series FROM Rutina_Ejercicios WHERE rutina_id = ?`, [nuevaRutinaId, plantilla_id]);
        res.status(201).json({ message: 'Rutina clonada', nuevaRutinaId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/clonar-masivo', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores' });
    const { plantilla_id, cliente_ids } = req.body;
    if (!cliente_ids || !Array.isArray(cliente_ids) || cliente_ids.length === 0) return res.status(400).json({ error: 'Se requiere una lista de cliente_ids' });
    
    try {
        for (const c_id of cliente_ids) {
            const [resultRutina] = await db.query(`INSERT INTO Rutinas (nombre, descripcion, nivel, es_plantilla, cliente_id, entrenador_id) SELECT nombre, descripcion, nivel, 0, ?, entrenador_id FROM Rutinas WHERE id = ?`, [c_id, plantilla_id]);
            const nuevaRutinaId = resultRutina.insertId;
            await db.query(`INSERT INTO Rutina_Ejercicios (rutina_id, ejercicio_id, series_objetivo, reps_objetivo, rir_objetivo, notas_entrenador, dia_nombre, orden, grupo_superserie, tempo, es_unilateral, segundos_objetivo, tipos_series) SELECT ?, ejercicio_id, series_objetivo, reps_objetivo, rir_objetivo, notas_entrenador, dia_nombre, orden, grupo_superserie, tempo, es_unilateral, segundos_objetivo, tipos_series FROM Rutina_Ejercicios WHERE rutina_id = ?`, [nuevaRutinaId, plantilla_id]);
        }
        res.status(201).json({ message: 'Rutinas clonadas masivamente' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
