const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verificarUsuario, verificarPropiedadCliente } = require('../middlewares/auth');

router.get('/:cliente_id', verificarUsuario, verificarPropiedadCliente, async (req, res) => {
    try {
        const [resultados] = await db.query('SELECT * FROM Notas_Clientes WHERE cliente_id = ? ORDER BY fecha_creacion DESC', [req.params.cliente_id]);
        res.json(resultados);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', verificarUsuario, async (req, res) => {
    const { cliente_id, categoria, mensaje } = req.body;
    try {
        const email = req.emailSeguro; 
        const [resultado] = await db.query('INSERT INTO Notas_Clientes (cliente_id, entrenador_email, categoria, mensaje) VALUES (?, ?, ?, ?)', [cliente_id, email, categoria, mensaje]);
        res.status(201).json({ id: resultado.insertId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
