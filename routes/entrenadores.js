const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verificarUsuario } = require('../middlewares/auth');

router.post('/registro', async (req, res) => {
    try {
        const { email } = req.body;
        const [existe] = await db.query('SELECT id FROM Entrenadores WHERE email = ?', [email]);
        
        if (existe.length === 0) {
            const nombre = email.split('@')[0];
            await db.query('INSERT INTO Entrenadores (nombre, email, plan_actual) VALUES (?, ?, ?)', [nombre, email, 'TRIAL']);
        }
        res.status(200).json({ message: "Entrenador verificado/creado" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/perfil', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores' });
    try {
        const [entrenadorData] = await db.query('SELECT plan_actual FROM Entrenadores WHERE id = ?', [req.usuarioId]);
        const planActual = (entrenadorData[0] && entrenadorData[0].plan_actual) ? entrenadorData[0].plan_actual : 'TRIAL';
        res.json({ plan_actual: planActual });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/test-plan', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores' });
    const { nuevo_plan } = req.body; 
    try {
        await db.query('UPDATE Entrenadores SET plan_actual = ? WHERE id = ?', [nuevo_plan, req.usuarioId]);
        res.json({ message: 'Plan actualizado exitosamente (Modo Prueba)' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
