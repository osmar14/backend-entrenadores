module.exports = function(io) {
    io.on('connection', (socket) => {
        console.log('🔗 Cliente conectado a Coachboard Live:', socket.id);

        socket.on('unirse_como_coach', (coachId) => {
            socket.join(`coach_${coachId}`);
            console.log(`👨‍🏫 Coach ${coachId} listo para monitorear en vivo`);
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
