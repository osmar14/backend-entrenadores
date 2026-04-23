const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verificarUsuario } = require('../middlewares/auth');
const stripeKey = process.env.STRIPE_SECRET_KEY || 'sk_test_mock';
const stripe = require('stripe')(stripeKey);

router.post('/crear-sesion-pago', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores' });
    const { plan } = req.body; 
    
    if (!plan || !['BASICO', 'PRO'].includes(plan)) {
        return res.status(400).json({ error: 'Plan inválido. Debe ser BASICO o PRO' });
    }

    const preciosPorPlan = {
        BASICO: process.env.STRIPE_PRICE_BASICO,
        PRO: process.env.STRIPE_PRICE_PRO
    };

    const precioId = preciosPorPlan[plan];
    if (!precioId) {
        return res.status(500).json({ error: 'Price ID no configurado para este plan. Configura STRIPE_PRICE_BASICO y STRIPE_PRICE_PRO en las variables de entorno.' });
    }

    try {
        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            payment_method_types: ['card'],
            customer_email: req.emailSeguro,
            line_items: [{ price: precioId, quantity: 1 }],
            metadata: { plan },
            success_url: `${process.env.FRONTEND_URL || 'https://tu-web.com'}/planes?resultado=exito`,
            cancel_url: `${process.env.FRONTEND_URL || 'https://tu-web.com'}/planes?resultado=cancelado`,
        });
        
        res.json({ url: session.url, sessionId: session.id });
    } catch (err) {
        console.error('🚨 Error creando sesión de Stripe:', err.message);
        res.status(500).json({ error: 'Error al crear sesión de pago: ' + err.message });
    }
});

router.post('/portal-suscripcion', verificarUsuario, async (req, res) => {
    if (req.rol !== 'entrenador') return res.status(403).json({ error: 'Solo entrenadores' });
    try {
        const [entrenadorData] = await db.query('SELECT stripe_customer_id FROM Entrenadores WHERE id = ?', [req.usuarioId]);
        const customerId = entrenadorData[0]?.stripe_customer_id;
        
        if (!customerId) {
            return res.status(400).json({ error: 'No tienes una suscripción activa para gestionar' });
        }

        const portalSession = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: `${process.env.FRONTEND_URL || 'https://tu-web.com'}/planes`,
        });
        
        res.json({ url: portalSession.url });
    } catch (err) {
        res.status(500).json({ error: 'Error al crear portal: ' + err.message });
    }
});

module.exports = router;
