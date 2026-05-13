const admin = require('../config/firebase');
const db = require('../config/db');

module.exports = function(io) {
    // ==========================================
    // MIDDLEWARE DE AUTENTICACIÓN PARA SOCKET.IO
    // ==========================================
    io.use(async (socket, next) => {
        const token = socket.handshake.auth?.token;
        if (!token) {
            console.warn('🚫 Socket rechazado: sin token');
            return next(new Error('Token de autenticación requerido'));
        }
        try {
            const decoded = await admin.auth().verifyIdToken(token);
            socket.userEmail = decoded.email;
            next();
        } catch (err) {
            console.warn('🚫 Socket rechazado: token inválido', err.message);
            next(new Error('Token inválido o expirado'));
        }
    });

    io.on('connection', (socket) => {
        console.log('🔗 Cliente autenticado en Coachboard Live:', socket.id, socket.userEmail);

        socket.on('unirse_como_coach', async (coachId) => {
            try {
                // Verificar que el email del socket pertenece a este coach
                const [check] = await db.query(
                    'SELECT id FROM Entrenadores WHERE id = ? AND email = ?',
                    [coachId, socket.userEmail]
                );
                if (check.length === 0) {
                    console.warn(`🚫 Coach ${coachId} rechazado: email ${socket.userEmail} no coincide`);
                    return;
                }
                socket.join(`coach_${coachId}`);
                console.log(`👨‍🏫 Coach ${coachId} verificado y listo para monitorear en vivo`);
            } catch (err) {
                console.error('Error verificando coach en socket:', err.message);
            }
        });

        socket.on('iniciar_entrenamiento', (data) => {
            io.to(`coach_${data.coachId}`).emit('cliente_entrenando', data);
        });

        socket.on('actualizar_serie', (data) => {
            io.to(`coach_${data.coachId}`).emit('progreso_en_vivo', data);
        });

        socket.on('terminar_entrenamiento', (data) => {
            io.to(`coach_${data.coachId}`).emit('cliente_termino', data);
        });

        socket.on('disconnect', () => {
            console.log('🔴 Cliente desconectado de Coachboard Live:', socket.id);
        });
    });
};
