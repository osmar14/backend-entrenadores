const admin = require('../config/firebase');
const db = require('../config/db');

async function verificarUsuario(req, res, next) {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Acceso denegado: Falta el Token de Seguridad' });
    }

    const token = authHeader.split('Bearer ')[1];

    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        const emailSeguro = decodedToken.email; 

        if (!emailSeguro) return res.status(401).json({ error: 'Token inválido o sin correo asociado' });

        const [entrenadores] = await db.query('SELECT id FROM Entrenadores WHERE email = ?', [emailSeguro]);
        if (entrenadores.length > 0) {
            req.usuarioId = entrenadores[0].id;
            req.rol = 'entrenador';
            req.emailSeguro = emailSeguro; 
            return next();
        }

        const [clientes] = await db.query('SELECT id, entrenador_id FROM Clientes WHERE email = ?', [emailSeguro]);
        if (clientes.length > 0) {
            req.usuarioId = clientes[0].id;
            req.entrenadorId = clientes[0].entrenador_id; 
            req.rol = 'cliente';
            req.emailSeguro = emailSeguro;
            return next();
        }

        return res.status(404).json({ error: 'Usuario no encontrado en la base de datos' });
    } catch (error) {
        console.error("🚨 Intento de acceso bloqueado / Token inválido:", error.message);
        return res.status(401).json({ error: 'Token expirado, inválido o manipulado' });
    }
}

async function obtenerUsuarioOpcional(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return next();
    
    const token = authHeader.split('Bearer ')[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        const emailSeguro = decodedToken.email; 
        if (!emailSeguro) return next();
        
        const [entrenadores] = await db.query('SELECT id FROM Entrenadores WHERE email = ?', [emailSeguro]);
        if (entrenadores.length > 0) {
            req.usuarioId = entrenadores[0].id;
            req.rol = 'entrenador';
        }
    } catch (e) {}
    next();
}

function verificarPlan(planMinimo) {
    return async (req, res, next) => {
        try {
            const [entrenadorData] = await db.query('SELECT plan_actual FROM Entrenadores WHERE id = ?', [req.usuarioId]);
            const plan = (entrenadorData[0] && entrenadorData[0].plan_actual) ? entrenadorData[0].plan_actual : 'TRIAL';
            const jerarquia = { TRIAL: 0, BASICO: 1, PRO: 2 };
            if ((jerarquia[plan] || 0) < (jerarquia[planMinimo] || 0)) {
                return res.status(403).json({ error: `Función exclusiva del plan ${planMinimo}. Tu plan actual: ${plan}` });
            }
            req.planActual = plan;
            next();
        } catch (error) {
            return res.status(500).json({ error: 'Error verificando plan' });
        }
    };
}

async function verificarPropiedadCliente(req, res, next) {
    const clienteId = req.params.cliente_id || req.params.id;
    if (!clienteId) return next();
    try {
        if (req.rol === 'entrenador') {
            const [check] = await db.query('SELECT id FROM Clientes WHERE id = ? AND entrenador_id = ?', [clienteId, req.usuarioId]);
            if (check.length === 0) return res.status(403).json({ error: 'Este cliente no te pertenece' });
        } else if (req.rol === 'cliente') {
            if (parseInt(clienteId) !== req.usuarioId) return res.status(403).json({ error: 'Acceso denegado' });
        }
        next();
    } catch (error) {
        return res.status(500).json({ error: 'Error de verificación' });
    }
}

module.exports = {
    verificarUsuario,
    obtenerUsuarioOpcional,
    verificarPlan,
    verificarPropiedadCliente
};
