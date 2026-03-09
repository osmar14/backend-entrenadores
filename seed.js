const mysql = require('mysql2');
require('dotenv').config();

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    multipleStatements: true // Permite ejecutar varias órdenes a la vez
});

const megaCatalogo = [
    // PECHO
    ['Press de Banca con Barra', 'Pecho'], ['Press de Banca Inclinado con Barra', 'Pecho'], ['Press de Banca Declinado', 'Pecho'], ['Press Inclinado con Mancuernas', 'Pecho'], ['Press Plano con Mancuernas', 'Pecho'], ['Aperturas Planas con Mancuernas', 'Pecho'], ['Aperturas Inclinadas con Mancuernas', 'Pecho'], ['Cruces en Polea Alta', 'Pecho'], ['Cruces en Polea Baja', 'Pecho'], ['Pec Deck (Máquina)', 'Pecho'], ['Fondos en Paralelas (Pecho)', 'Pecho'], ['Pullover con Mancuerna', 'Pecho'],
    // ESPALDA
    ['Dominadas (Pull-ups)', 'Espalda'], ['Dominadas Supinas (Chin-ups)', 'Espalda'], ['Jalón al Pecho Abierto', 'Espalda'], ['Jalón al Pecho Cerrado', 'Espalda'], ['Remo con Barra', 'Espalda'], ['Remo en Punta (T-Bar)', 'Espalda'], ['Remo con Mancuerna a una mano', 'Espalda'], ['Remo Gironda (Polea Baja)', 'Espalda'], ['Remo en Máquina', 'Espalda'], ['Pullover en Polea Alta', 'Espalda'], ['Peso Muerto Convencional', 'Espalda'], ['Extensiones Lumbares', 'Espalda'],
    // PIERNA (CUÁDRICEPS E ISQUIOS)
    ['Sentadilla Libre con Barra', 'Pierna'], ['Sentadilla Frontal', 'Pierna'], ['Sentadilla Búlgara', 'Pierna'], ['Sentadilla en Máquina Smith', 'Pierna'], ['Sentadilla Hack', 'Pierna'], ['Prensa de Piernas (Leg Press)', 'Pierna'], ['Extensiones de Cuádriceps', 'Pierna'], ['Peso Muerto Rumano', 'Pierna'], ['Peso Muerto Piernas Rígidas', 'Pierna'], ['Curl de Isquios Acostado', 'Pierna'], ['Curl de Isquios Sentado', 'Pierna'], ['Zancadas (Lunges) con Mancuernas', 'Pierna'],
    // GLÚTEO Y PANTORRILLA
    ['Hip Thrust con Barra', 'Glúteo'], ['Puente de Glúteo', 'Glúteo'], ['Patada de Glúteo en Polea', 'Glúteo'], ['Abducción de Cadera en Máquina', 'Glúteo'], ['Elevación de Talones de Pie', 'Pantorrilla'], ['Elevación de Talones Sentado', 'Pantorrilla'], ['Pantorrilla en Prensa', 'Pantorrilla'],
    // HOMBRO
    ['Press Militar con Barra', 'Hombro'], ['Press Militar Sentado con Mancuernas', 'Hombro'], ['Press Arnold', 'Hombro'], ['Press en Máquina', 'Hombro'], ['Elevaciones Laterales con Mancuernas', 'Hombro'], ['Elevaciones Laterales en Polea', 'Hombro'], ['Elevaciones Frontales con Mancuerna', 'Hombro'], ['Elevaciones Frontales con Disco', 'Hombro'], ['Pájaros (Elevaciones Posteriores)', 'Hombro'], ['Face Pull en Polea', 'Hombro'], ['Encogimientos de Hombros (Trapecio)', 'Hombro'],
    // BÍCEPS
    ['Curl de Bíceps con Barra Recta', 'Brazos'], ['Curl con Barra Z', 'Brazos'], ['Curl Alterno con Mancuernas', 'Brazos'], ['Curl Martillo con Mancuernas', 'Brazos'], ['Curl en Banco Scott', 'Brazos'], ['Curl Araña (Spider Curl)', 'Brazos'], ['Curl en Polea Baja', 'Brazos'], ['Curl Concentrado', 'Brazos'],
    // TRÍCEPS
    ['Extensión de Tríceps en Polea (Cuerda)', 'Brazos'], ['Extensión de Tríceps en Polea (Barra)', 'Brazos'], ['Press Francés con Barra Z', 'Brazos'], ['Extensión Tras Nuca con Mancuerna', 'Brazos'], ['Patada de Tríceps', 'Brazos'], ['Fondos para Tríceps', 'Brazos'], ['Press de Banca Agarre Cerrado', 'Brazos'],
    // CORE (ABDOMEN)
    ['Crunch Abdominal', 'Core'], ['Crunch en Polea', 'Core'], ['Elevación de Piernas Colgado', 'Core'], ['Elevación de Piernas Acostado', 'Core'], ['Plancha Abdominal (Plank)', 'Core'], ['Rueda Abdominal (Ab Wheel)', 'Core'], ['Giros Rusos (Russian Twists)', 'Core'], ['Woodchoppers en Polea', 'Core']
];

// Instrucción destructiva y constructiva (resetea y llena)
const querySiembra = `
    SET FOREIGN_KEY_CHECKS = 0;
    TRUNCATE TABLE Ejercicios;
    SET FOREIGN_KEY_CHECKS = 1;
    INSERT INTO Ejercicios (nombre, grupo_muscular) VALUES ?;
`;

db.connect((err) => {
    if (err) throw err;
    console.log('🌪️ Limpiando la tabla e inyectando el MEGA CATÁLOGO...');
    
    db.query(querySiembra, [megaCatalogo], (error, resultados) => {
        if (error) {
            console.error('❌ Error al sembrar:', error.message);
        } else {
            console.log(`✅ ¡MEGA ÉXITO! Se inyectaron alrededor de 80 ejercicios profesionales.`);
        }
        process.exit();
    });
});