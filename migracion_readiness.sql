-- ==========================================
-- TABLA: Cuestionario de Readiness (Fatiga Científica)
-- Ejecutar en la base de datos de producción
-- ==========================================

CREATE TABLE IF NOT EXISTS Cuestionario_Readiness (
    id INT AUTO_INCREMENT PRIMARY KEY,
    cliente_id INT NOT NULL,
    sueno TINYINT NOT NULL CHECK (sueno BETWEEN 1 AND 5),
    estres TINYINT NOT NULL CHECK (estres BETWEEN 1 AND 5),
    dolor_muscular TINYINT NOT NULL CHECK (dolor_muscular BETWEEN 1 AND 5),
    fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cliente_id) REFERENCES Clientes(id) ON DELETE CASCADE,
    INDEX idx_cliente_fecha (cliente_id, fecha)
);
