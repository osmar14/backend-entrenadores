const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verificarUsuario } = require('../middlewares/auth');

router.get('/', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores' });
    try {
        const [notas] = await db.query(`SELECT n.*, c.nombre as cliente_nombre FROM Notas_Clientes n JOIN Clientes c ON n.cliente_id = c.id WHERE c.entrenador_id = ? ORDER BY n.fecha_creacion DESC LIMIT 10`, [req.usuarioId]);
        const [progresos] = await db.query(`SELECT rp.fecha, c.nombre as cliente_nombre, rut.nombre as rutina_nombre FROM Registro_Progreso rp JOIN Clientes c ON rp.cliente_id = c.id JOIN Rutinas rut ON rp.rutina_id = rut.id WHERE c.entrenador_id = ? GROUP BY rp.fecha, c.nombre, rut.nombre ORDER BY rp.fecha DESC LIMIT 5`, [req.usuarioId]);
        res.json({ notasRecientes: notas, actividadReciente: progresos });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
