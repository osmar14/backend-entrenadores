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
                re.dia_nombre, -- AÑADIDO: Traemos el nombre del Día (Ej. "Día 1", "brazo")
                GROUP_CONCAT(DISTINCT e.nombre SEPARATOR ', ') as ejercicios
            FROM Registro_Progreso rp
            LEFT JOIN Rutinas r ON rp.rutina_id = r.id
            LEFT JOIN Ejercicios e ON rp.ejercicio_id = e.id
            -- NUEVO JOIN: Cruzamos con la plantilla para saber el "Día"
            LEFT JOIN Rutina_Ejercicios re ON rp.rutina_id = re.rutina_id AND rp.ejercicio_id = re.ejercicio_id
            WHERE rp.cliente_id = ?
            GROUP BY DATE(rp.fecha), rp.rutina_id, r.nombre, re.dia_nombre -- AÑADIDO: Agrupamos por el Día
            ORDER BY dia_entrenamiento DESC
            LIMIT 15
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

// ==========================================
// 5. ÚLTIMOS ENTRENAMIENTOS POR DÍA DE RUTINA
// ==========================================
router.get('/ultimos-por-dia/:cliente_id/:rutina_id', verificarUsuario, verificarPropiedadCliente, async (req, res) => {
    try {
        // Para cada dia_nombre de la rutina, traer la fecha más reciente que se entrenó
        // y luego los registros de esa fecha+día
        const query = `
            SELECT 
                sub.dia_nombre,
                sub.ultima_fecha,
                rp.ejercicio_id,
                e.nombre AS ejercicio_nombre,
                rp.serie_numero,
                rp.peso_kg,
                rp.repeticiones,
                rp.rir,
                rp.tipo_serie
            FROM (
                SELECT 
                    re.dia_nombre,
                    MAX(DATE(rp2.fecha)) AS ultima_fecha
                FROM Rutina_Ejercicios re
                JOIN Registro_Progreso rp2 ON rp2.ejercicio_id = re.ejercicio_id 
                    AND rp2.rutina_id = re.rutina_id 
                    AND rp2.cliente_id = ?
                WHERE re.rutina_id = ?
                GROUP BY re.dia_nombre
            ) sub
            JOIN Rutina_Ejercicios re2 ON re2.rutina_id = ? AND re2.dia_nombre = sub.dia_nombre
            JOIN Registro_Progreso rp ON rp.ejercicio_id = re2.ejercicio_id 
                AND rp.rutina_id = ? 
                AND rp.cliente_id = ? 
                AND DATE(rp.fecha) = sub.ultima_fecha
            JOIN Ejercicios e ON rp.ejercicio_id = e.id
            ORDER BY sub.dia_nombre, e.nombre, rp.serie_numero
        `;
        const clienteId = req.params.cliente_id;
        const rutinaId = req.params.rutina_id;
        const [resultados] = await db.query(query, [clienteId, rutinaId, rutinaId, rutinaId, clienteId]);
        
        // Agrupar por dia_nombre para facilitar el consumo en el frontend
        const agrupado = {};
        resultados.forEach(r => {
            if (!agrupado[r.dia_nombre]) {
                agrupado[r.dia_nombre] = { dia_nombre: r.dia_nombre, ultima_fecha: r.ultima_fecha, ejercicios: {} };
            }
            if (!agrupado[r.dia_nombre].ejercicios[r.ejercicio_nombre]) {
                agrupado[r.dia_nombre].ejercicios[r.ejercicio_nombre] = { nombre: r.ejercicio_nombre, ejercicio_id: r.ejercicio_id, series: [] };
            }
            agrupado[r.dia_nombre].ejercicios[r.ejercicio_nombre].series.push({
                serie_numero: r.serie_numero,
                peso_kg: r.peso_kg,
                repeticiones: r.repeticiones,
                rir: r.rir,
                tipo_serie: r.tipo_serie
            });
        });

        // Convertir objetos a arrays para el frontend
        const resultado = Object.values(agrupado).map(dia => ({
            ...dia,
            ejercicios: Object.values(dia.ejercicios)
        }));

        res.json(resultado);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 6. HISTORIAL COMPLETO DEL ÚLTIMO MES (SIMPLIFICADO)
// ==========================================
router.get('/historial-mes/:cliente_id', verificarUsuario, verificarPropiedadCliente, async (req, res) => {
    try {
        // Query simplificada al máximo y usando la misma base que la función Volumen
        const query = `
            SELECT 
                DATE_FORMAT(rp.fecha, '%Y-%m-%d') AS dia_entrenamiento,
                rp.rutina_id,
                rp.ejercicio_id,
                e.nombre AS ejercicio_nombre,
                rp.serie_numero,
                rp.peso_kg,
                rp.repeticiones,
                rp.tipo_serie,
                re.dia_nombre
            FROM Registro_Progreso rp
            JOIN Ejercicios e ON rp.ejercicio_id = e.id
            JOIN Rutina_Ejercicios re ON rp.rutina_id = re.rutina_id AND rp.ejercicio_id = re.ejercicio_id
            WHERE rp.cliente_id = ? AND rp.fecha >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            ORDER BY rp.fecha DESC, e.nombre, rp.serie_numero
        `;
        const [resultados] = await db.query(query, [req.params.cliente_id]);
        res.json(resultados);
    } catch (err) {
        console.error('🚨 Error historial-mes:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;