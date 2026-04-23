const express = require('express');
const router = express.Router();
const db = require('../config/db');
const admin = require('../config/firebase');
const { verificarUsuario } = require('../middlewares/auth');

router.get('/', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Acceso denegado' });
    try {
        const [resultados] = await db.query('SELECT * FROM Clientes WHERE entrenador_id = ?', [req.usuarioId]);
        res.json(resultados);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores' });
    
    const { nombre, email, objetivo, dias_entrenamiento } = req.body;
    if (!email) return res.status(400).json({ error: 'El correo es obligatorio' });

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
