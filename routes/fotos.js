const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verificarUsuario, verificarPropiedadCliente } = require('../middlewares/auth');

router.get('/:cliente_id', verificarUsuario, verificarPropiedadCliente, async (req, res) => {
    try {
        const [resultados] = await db.query('SELECT * FROM Fotos_Progreso WHERE cliente_id = ? ORDER BY fecha_captura DESC', [req.params.cliente_id]);
        res.json(resultados);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', verificarUsuario, async (req, res) => {
    const { cliente_id, url_foto, peso_kg } = req.body;
    if (req.rol === 'cliente' && req.usuarioId !== parseInt(cliente_id)) {
        return res.status(403).json({ error: 'No puedes subir fotos para otro cliente' });
    }
    try {
        await db.query('INSERT INTO Fotos_Progreso (cliente_id, url_foto, fecha_captura, peso_kg) VALUES (?, ?, NOW(), ?)', [cliente_id, url_foto, peso_kg || null]);
        res.json({ message: 'Foto guardada correctamente' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
