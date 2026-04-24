const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verificarUsuario, verificarPropiedadCliente } = require('../middlewares/auth');

router.get('/volumen/:cliente_id', verificarUsuario, verificarPropiedadCliente, async (req, res) => {
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
        
        const resultadosConSemaforo = resultados.map(r => {
            let estado = 'Verde';
            if (r.total_series > 10 && r.total_series <= 20) estado = 'Amarillo';
            if (r.total_series > 20) estado = 'Rojo';
            return { ...r, semaforo: estado };
        });

        res.json(resultadosConSemaforo);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/radar/:cliente_id', verificarUsuario, verificarPropiedadCliente, async (req, res) => {
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

router.get('/radar-detalle/:cliente_id/:grupo_muscular', verificarUsuario, verificarPropiedadCliente, async (req, res) => {
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

router.get('/comparativa/:cliente_id', verificarUsuario, verificarPropiedadCliente, async (req, res) => {
    try {
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

router.get('/1rm/:cliente_id/:ejercicio_id', verificarUsuario, verificarPropiedadCliente, async (req, res) => {
    try {
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

router.get('/pr/:cliente_id/:ejercicio_id', verificarUsuario, verificarPropiedadCliente, async (req, res) => {
    try {
        const query = `
            SELECT MAX(peso_kg) as pr 
            FROM Registro_Progreso 
            WHERE cliente_id = ? AND ejercicio_id = ? AND fecha >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        `;
        const [resultados] = await db.query(query, [req.params.cliente_id, req.params.ejercicio_id]);
        res.json({ pr: resultados[0].pr || 0 });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/volumen-carga-total/:cliente_id', verificarUsuario, verificarPropiedadCliente, async (req, res) => {
    try {
        const query = `
            SELECT DATE_FORMAT(fecha, '%Y-%m-%d') as fecha_corta, 
                   SUM(peso_kg * repeticiones) as volumen_total 
            FROM Registro_Progreso 
            WHERE cliente_id = ? AND peso_kg > 0 AND repeticiones > 0 AND fecha >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            GROUP BY DATE_FORMAT(fecha, '%Y-%m-%d')
            ORDER BY fecha_corta ASC
            LIMIT 15
        `;
        const [resultados] = await db.query(query, [req.params.cliente_id]);
        res.json(resultados);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
