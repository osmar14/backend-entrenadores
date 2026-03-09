const mysql = require('mysql2');
require('dotenv').config();

// Conectamos a la bóveda, habilitando "multipleStatements" para mandar todo de golpe
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    multipleStatements: true 
});

// ESTE ES EL PLANO SQL DE TUS TABLAS
const construirTablas = `
    CREATE TABLE IF NOT EXISTS Entrenadores (
        id INT AUTO_INCREMENT PRIMARY KEY,
        clerk_id VARCHAR(255) UNIQUE,
        nombre VARCHAR(100),
        email VARCHAR(150) UNIQUE,
        creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS Ejercicios (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(100),
        grupo_muscular VARCHAR(50)
    );

    CREATE TABLE IF NOT EXISTS Clientes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        entrenador_id INT,
        nombre VARCHAR(100),
        objetivo VARCHAR(255),
        creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (entrenador_id) REFERENCES Entrenadores(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS Rutinas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        cliente_id INT,
        nombre VARCHAR(100),
        activa BOOLEAN DEFAULT TRUE,
        FOREIGN KEY (cliente_id) REFERENCES Clientes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS Rutina_Ejercicios (
        id INT AUTO_INCREMENT PRIMARY KEY,
        rutina_id INT,
        ejercicio_id INT,
        orden INT,
        series_objetivo INT,
        reps_objetivo VARCHAR(50),
        FOREIGN KEY (rutina_id) REFERENCES Rutinas(id) ON DELETE CASCADE,
        FOREIGN KEY (ejercicio_id) REFERENCES Ejercicios(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS Registro_Progreso (
        id INT AUTO_INCREMENT PRIMARY KEY,
        rutina_id INT,
        ejercicio_id INT,
        serie_numero INT,
        repeticiones INT,
        peso_kg DECIMAL(5,2),
        fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (rutina_id) REFERENCES Rutinas(id) ON DELETE CASCADE,
        FOREIGN KEY (ejercicio_id) REFERENCES Ejercicios(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS Fotos_Progreso (
        id INT AUTO_INCREMENT PRIMARY KEY,
        cliente_id INT,
        url_foto VARCHAR(255),
        fecha_captura DATETIME DEFAULT CURRENT_TIMESTAMP,
        peso_kg DECIMAL(5,2),
        FOREIGN KEY (cliente_id) REFERENCES Clientes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS Notas_Clientes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        cliente_id INT,
        entrenador_id INT,
        categoria VARCHAR(50),
        mensaje TEXT,
        fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (cliente_id) REFERENCES Clientes(id) ON DELETE CASCADE,
        FOREIGN KEY (entrenador_id) REFERENCES Entrenadores(id) ON DELETE SET NULL
    );
`;

// Ejecutamos la construcción
db.connect((err) => {
    if (err) throw err;
    console.log('🚧 Entrando a la bóveda de Railway para construir las tablas...');
    
    db.query(construirTablas, (error, resultados) => {
        if (error) {
            console.error('❌ Error al construir:', error.message);
        } else {
            console.log('✅ ¡ÉXITO! Las 8 tablas han sido creadas perfectamente en la nube.');
            console.log('Ya puedes cerrar este archivo. La arquitectura de datos está finalizada.');
        }
        process.exit(); // Apagamos este script temporal
    });
});