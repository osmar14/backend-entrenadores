const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verificarUsuario, verificarPropiedadCliente } = require('../middlewares/auth');

// ==========================================
// 1. OBTENER HISTORIAL DE RUTINA ESPECÍFICA
// ==========================================
router.get('/:cliente_id/:rutina_id', verificarUsuario, verificarPropiedadCliente, async (req, res) => {
    try {
        const query = `
            SELECT r.*, e.nombre as ejercicio_nombre 
            FROM Registro_Progreso r 
            JOIN Ejercicios e ON r.ejercicio_id = e.id 
            WHERE r.cliente_id = ? AND r.rutina_id = ? 
            ORDER BY r.fecha DESC, r.ejercicio_id, r.serie_numero
            LIMIT 800
        `;
        const [resultados] = await db.query(query, [req.params.cliente_id, req.params.rutina_id]);
        res.json(resultados);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 2. OBTENER RESUMEN GLOBAL (CORREGIDO DATE)
// ==========================================
router.get('/global/:cliente_id', verificarUsuario, verificarPropiedadCliente, async (req, res) => {
    try {
        const query = `
            SELECT 
                DATE(rp.fecha) as dia_entrenamiento, 
                rp.rutina_id, 
                r.nombre as rutina_nombre,
                GROUP_CONCAT(DISTINCT e.nombre SEPARATOR ', ') as ejercicios
            FROM Registro_Progreso rp
            LEFT JOIN Rutinas r ON rp.rutina_id = r.id
            LEFT JOIN Ejercicios e ON rp.ejercicio_id = e.id
            WHERE rp.cliente_id = ?
            GROUP BY DATE(rp.fecha), rp.rutina_id, r.nombre 
            ORDER BY dia_entrenamiento DESC
            LIMIT 10
        `;
        const [resultados] = await db.query(query, [req.params.cliente_id]);
        res.json(resultados);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 3. OBTENER FEEDBACK Y NOTAS DEL CLIENTE
// ==========================================
router.get('/feedback/:cliente_id', verificarUsuario, verificarPropiedadCliente, async (req, res) => {
    try {
        const query = `
            SELECT rp.fecha, rp.notas_cliente, e.nombre as ejercicio_nombre 
            FROM Registro_Progreso rp
            JOIN Ejercicios e ON rp.ejercicio_id = e.id
            WHERE rp.cliente_id = ? 
              AND rp.notas_cliente IS NOT NULL 
              AND rp.notas_cliente != ''
            ORDER BY rp.fecha DESC
            LIMIT 20
        `;
        const [resultados] = await db.query(query, [req.params.cliente_id]);
        res.json(resultados);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 4. GUARDAR NUEVO PROGRESO (BULK INSERT)
// ==========================================
router.post('/', verificarUsuario, async (req, res) => {
    const { rutina_id, registros } = req.body;

    // Validación de seguridad para saber quién anota
    const clienteId = req.rol === 'cliente' ? req.usuarioId : req.body.cliente_id;

    if (!registros || registros.length === 0) {
        return res.status(400).json({ message: 'El registro de progreso está vacío' });
    }

    try {
        // Mapeo seguro de datos hacia la base de datos
        const values = registros.map(r => [
            clienteId,
            rutina_id,
            r.ejercicio_id,
            r.serie_numero,
            r.peso || 0,
            r.reps || 0,
            r.rir || null,
            r.tipo_serie || 'Normal',
            r.notas_cliente || ''
        ]);

        await db.query(
            'INSERT INTO Registro_Progreso (cliente_id, rutina_id, ejercicio_id, serie_numero, peso_kg, repeticiones, rir, tipo_serie, notas_cliente) VALUES ?',
            [values]
        );

        res.status(201).json({ message: 'Progreso guardado correctamente' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;