require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const stripeKey = process.env.STRIPE_SECRET_KEY || 'sk_test_mock';
const stripe = require('stripe')(stripeKey);
const db = require('./config/db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());

// Webhooks de Stripe (debe ir ANTES de express.json())
app.post('/api/webhooks/stripe', express.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error(`🚨 Webhook Error: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const email = session.customer_email;
        const planAdquirido = session.metadata?.plan || 'BASICO'; 
        
        try {
            await db.query('UPDATE Entrenadores SET plan_actual = ?, stripe_customer_id = ? WHERE email = ?', [planAdquirido, session.customer, email]);
            console.log(`✅ Plan de suscripción actualizado a ${planAdquirido} para ${email}`);
        } catch (error) {
            console.error("🚨 Error actualizando plan en DB:", error);
        }
    }

    if (event.type === 'customer.subscription.deleted') {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        
        try {
            await db.query('UPDATE Entrenadores SET plan_actual = ? WHERE stripe_customer_id = ?', ['TRIAL', customerId]);
            console.log(`⚠️ Suscripción cancelada para customer ${customerId}. Plan degradado a TRIAL.`);
        } catch (error) {
            console.error("🚨 Error degradando plan:", error);
        }
    }

    res.json({received: true});
});

app.use(express.json());

// Montar las rutas modularizadas
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/clientes', require('./routes/clientes'));
app.use('/api/rutinas', require('./routes/rutinas'));
app.use('/api/rutina-ejercicios', require('./routes/rutina_ejercicios'));
app.use('/api/ejercicios', require('./routes/ejercicios'));
app.use('/api/metricas', require('./routes/metricas'));
app.use('/api/notas', require('./routes/notas'));
app.use('/api/progreso', require('./routes/progreso'));
app.use('/api/fotos', require('./routes/fotos'));
app.use('/api/entrenadores', require('./routes/entrenadores'));
app.use('/api', require('./routes/stripe')); // Rutas /api/crear-sesion-pago y /api/portal-suscripcion

// Inicializar sockets
require('./sockets')(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`🚂 Servidor backend V3 (Modularizado) volando en el puerto ${PORT}`); });