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
    
    // Validación de URL
    if (!url_foto || typeof url_foto !== 'string' || url_foto.trim().length === 0) {
        return res.status(400).json({ error: 'La URL de la foto es requerida' });
    }
    
    // Validar que sea una URL válida (http/https)
    try {
        const parsedUrl = new URL(url_foto);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            return res.status(400).json({ error: 'La URL debe usar protocolo http o https' });
        }
    } catch (e) {
        return res.status(400).json({ error: 'URL de foto inválida' });
    }
    
    // Validar peso_kg si se proporciona
    if (peso_kg !== undefined && peso_kg !== null) {
        const pesoNum = parseFloat(peso_kg);
        if (isNaN(pesoNum) || pesoNum < 0 || pesoNum > 500) {
            return res.status(400).json({ error: 'Peso debe ser un número entre 0 y 500 kg' });
        }
    }
    
    try {
        await db.query('INSERT INTO Fotos_Progreso (cliente_id, url_foto, fecha_captura, peso_kg) VALUES (?, ?, NOW(), ?)', [cliente_id, url_foto.trim(), peso_kg || null]);
        res.json({ message: 'Foto guardada correctamente' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
