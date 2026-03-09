const mysql = require('mysql2');
require('dotenv').config();

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    multipleStatements: true
});

const cirugiaSQL = `
    -- 1. Agregamos la columna para saber de qué entrenador es la plantilla
    ALTER TABLE Rutinas ADD COLUMN entrenador_id INT AFTER id;
    
    -- 2. La conectamos con la tabla de Entrenadores
    ALTER TABLE Rutinas ADD FOREIGN KEY (entrenador_id) REFERENCES Entrenadores(id) ON DELETE CASCADE;
    
    -- 3. Agregamos el interruptor para saber si es plantilla o rutina de cliente
    ALTER TABLE Rutinas ADD COLUMN es_plantilla BOOLEAN DEFAULT FALSE AFTER nombre;
`;

db.connect((err) => {
    if (err) throw err;
    console.log('⚕️ Entrando a la bóveda para hacer cirugía en la tabla Rutinas...');
    
    db.query(cirugiaSQL, (error, resultados) => {
        if (error) {
            // Si da error de columna duplicada, significa que ya lo habías corrido
            console.error('❌ Error en la cirugía:', error.message);
        } else {
            console.log('✅ ¡CIRUGÍA EXITOSA! La tabla Rutinas ahora soporta Plantillas Maestras.');
        }
        process.exit();
    });
});