const express = require('express');
const router = express.Router();
const db = require('../config/db');
const admin = require('../config/firebase');
const { verificarUsuario } = require('../middlewares/auth');

// ==========================================
// GET /api/clientes — OPTIMIZADO (N+1 eliminado)
// Antes: 1 + 2N queries (101 queries para 50 clientes)
// Ahora: 1 sola query con JOINs laterales
// ==========================================
router.get('/', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Acceso denegado' });
    try {
        const query = `
            SELECT c.*,
                COALESCE(lesiones.total_lesiones, 0) AS total_lesiones,
                COALESCE(rir_data.rir_cero, 0) AS rir_cero
            FROM Clientes c
            LEFT JOIN (
                SELECT nc.cliente_id, COUNT(*) AS total_lesiones
                FROM Notas_Clientes nc
                WHERE nc.fecha_creacion >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
                  AND (LOWER(nc.categoria) LIKE '%lesion%' OR LOWER(nc.categoria) LIKE '%lesión%'
                       OR LOWER(nc.mensaje) LIKE '%lesion%' OR LOWER(nc.mensaje) LIKE '%lesión%')
                GROUP BY nc.cliente_id
            ) lesiones ON lesiones.cliente_id = c.id
            LEFT JOIN (
                SELECT rp.cliente_id, COUNT(*) AS rir_cero
                FROM Registro_Progreso rp
                WHERE (rp.rir = '0' OR rp.rir = 0)
                  AND rp.fecha >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
                GROUP BY rp.cliente_id
            ) rir_data ON rir_data.cliente_id = c.id
            WHERE c.entrenador_id = ?
        `;
        const [clientes] = await db.query(query, [req.usuarioId]);

        // Calcular semáforo en JS (ya tenemos los datos precalculados)
        const clientesConSemaforo = clientes.map(cliente => {
            let semaforo = 'Verde';
            const tieneLesion = cliente.total_lesiones > 0;
            const cantidadRirCero = cliente.rir_cero;

            if (tieneLesion || cantidadRirCero >= 4) {
                semaforo = 'Rojo';
            } else if (cantidadRirCero >= 2) {
                semaforo = 'Amarillo';
            }

            return { ...cliente, semaforo };
        });

        res.json(clientesConSemaforo);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores' });
    
    const { nombre, email, objetivo, dias_entrenamiento } = req.body;
    if (!email) return res.status(400).json({ error: 'El correo es obligatorio' });
    if (!nombre || nombre.trim().length === 0) return res.status(400).json({ error: 'El nombre es obligatorio' });

    try {
        const [entrenadorData] = await db.query('SELECT plan_actual FROM Entrenadores WHERE id = ?', [req.usuarioId]);
        const planActual = (entrenadorData[0] && entrenadorData[0].plan_actual) ? entrenadorData[0].plan_actual : 'TRIAL';

        const [conteo] = await db.query('SELECT COUNT(*) as total FROM Clientes WHERE entrenador_id = ?', [req.usuarioId]);
        const totalClientes = conteo[0].total;

        if (planActual === 'TRIAL' && totalClientes >= 3) {
            return res.status(402).json({ 
                error: 'Límite alcanzado', 
                mensaje: 'Has alcanzado el límite de 3 clientes en tu plan Starter Gratuito. Actualiza al Plan Básico o Pro para clientes ilimitados.' 
            });
        }

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

router.put('/:id', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores' });
    const { dias_entrenamiento } = req.body;
    try {
        await db.query('UPDATE Clientes SET dias_entrenamiento = ? WHERE id = ? AND entrenador_id = ?', [dias_entrenamiento, req.params.id, req.usuarioId]);
        res.json({ message: 'Actualizado' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
