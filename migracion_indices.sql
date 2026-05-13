-- ==========================================
-- ÍNDICES DE RENDIMIENTO — Ejecutar en producción
-- Seguro ejecutar múltiples veces (IF NOT EXISTS)
-- ==========================================

-- Registro_Progreso: Las queries de métricas, adherencia y semáforo filtran por cliente_id + fecha
CREATE INDEX IF NOT EXISTS idx_rp_cliente_fecha ON Registro_Progreso (cliente_id, fecha);

-- Registro_Progreso: Las queries de 1RM y picos filtran por cliente_id + ejercicio_id
CREATE INDEX IF NOT EXISTS idx_rp_cliente_ejercicio ON Registro_Progreso (cliente_id, ejercicio_id);

-- Registro_Progreso: Las queries de últimas sesiones filtran por rutina_id + ejercicio_id
CREATE INDEX IF NOT EXISTS idx_rp_rutina_ejercicio ON Registro_Progreso (rutina_id, ejercicio_id);

-- Notas_Clientes: Las queries del dashboard y semáforo filtran por cliente_id + fecha
CREATE INDEX IF NOT EXISTS idx_notas_cliente_fecha ON Notas_Clientes (cliente_id, fecha_creacion);

-- Rutina_Ejercicios: Las queries de rendimiento y adherencia filtran por rutina_id + dia_nombre
CREATE INDEX IF NOT EXISTS idx_re_rutina_dia ON Rutina_Ejercicios (rutina_id, dia_nombre);

-- Clientes: El middleware de auth busca por email constantemente
CREATE INDEX IF NOT EXISTS idx_clientes_email ON Clientes (email);

-- Entrenadores: El middleware de auth busca por email constantemente
CREATE INDEX IF NOT EXISTS idx_entrenadores_email ON Entrenadores (email);
