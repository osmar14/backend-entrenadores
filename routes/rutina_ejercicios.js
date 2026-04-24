const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verificarUsuario } = require('../middlewares/auth');

// OBTENER EJERCICIOS DE UNA RUTINA
router.get('/:rutina_id', verificarUsuario, async (req, res) => {
    try {
        const query = `
            SELECT re.*, e.nombre, e.grupo_muscular 
            FROM Rutina_Ejercicios re
            JOIN Ejercicios e ON re.ejercicio_id = e.id
            WHERE re.rutina_id = ?
            ORDER BY re.orden ASC
        `;
        const [resultados] = await db.query(query, [req.params.rutina_id]);
        res.json(resultados);
    } catch (err) {
        console.error("Error obteniendo rutina_ejercicios:", err);
        res.status(500).json({ error: err.message });
    }
});

// GUARDAR (ACTUALIZAR) EJERCICIOS DE UNA RUTINA (EL PLAN DE VUELO)
router.post('/', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores' });
    
    const { rutina_id, ejercicios } = req.body;
    if (!rutina_id || !Array.isArray(ejercicios)) {
        return res.status(400).json({ error: 'Faltan datos obligatorios o el formato es incorrecto' });
    }

    try {
        // Primero, validamos que la rutina pertenezca al entrenador actual
        const [rutinaCheck] = await db.query('SELECT id FROM Rutinas WHERE id = ? AND entrenador_id = ?', [rutina_id, req.usuarioId]);
        if (rutinaCheck.length === 0) {
            return res.status(403).json({ error: 'No tienes permiso para modificar esta rutina' });
        }

        // Eliminamos los ejercicios anteriores de esta rutina
        await db.query('DELETE FROM Rutina_Ejercicios WHERE rutina_id = ?', [rutina_id]);

        // Si la lista no está vacía, insertamos los nuevos
        if (ejercicios.length > 0) {
            const values = ejercicios.map((ej, index) => [
                rutina_id,
                ej.id || ej.ejercicio_id, // Manejar si viene como id o ejercicio_id
                index, // orden
                ej.series_objetivo || 3,
                ej.reps_objetivo || '10',
                ej.rir_objetivo || null,
                ej.notas_entrenador || '',
                ej.dia_nombre || 'Día 1',
                ej.tempo || null,
                ej.es_unilateral ? 1 : 0,
                ej.segundos_objetivo || null
            ]);

            const insertQuery = `
                INSERT INTO Rutina_Ejercicios 
                (rutina_id, ejercicio_id, orden, series_objetivo, reps_objetivo, rir_objetivo, notas_entrenador, dia_nombre, tempo, es_unilateral, segundos_objetivo) 
                VALUES ?
            `;
            await db.query(insertQuery, [values]);
        }

        res.json({ message: 'Plan de vuelo (ejercicios) guardado exitosamente' });
    } catch (err) {
        console.error("Error guardando rutina_ejercicios:", err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
