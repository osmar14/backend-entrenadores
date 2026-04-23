-- =============================================
-- 🔧 MIGRACIÓN COMPLETA PARA PLANES DE PAGO
-- Ejecuta esto en tu base de datos de Railway
-- Es seguro ejecutar múltiples veces (usa IF NOT EXISTS)
-- =============================================

-- 1. ENTRENADORES: Agregar columnas de plan y Stripe
ALTER TABLE Entrenadores ADD COLUMN IF NOT EXISTS plan_actual VARCHAR(20) DEFAULT 'TRIAL';
ALTER TABLE Entrenadores ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255) DEFAULT NULL;

-- 2. CLIENTES: Columnas que usa el código
ALTER TABLE Clientes ADD COLUMN IF NOT EXISTS email VARCHAR(150) DEFAULT NULL;
ALTER TABLE Clientes ADD COLUMN IF NOT EXISTS dias_entrenamiento VARCHAR(100) DEFAULT '';
ALTER TABLE Clientes ADD COLUMN IF NOT EXISTS firebase_uid VARCHAR(255) DEFAULT NULL;
ALTER TABLE Clientes ADD COLUMN IF NOT EXISTS is_vip TINYINT(1) DEFAULT 0;

-- 3. RUTINAS: Columnas de plantillas y entrenador
ALTER TABLE Rutinas ADD COLUMN IF NOT EXISTS descripcion TEXT DEFAULT NULL;
ALTER TABLE Rutinas ADD COLUMN IF NOT EXISTS nivel VARCHAR(50) DEFAULT 'Principiante';
ALTER TABLE Rutinas ADD COLUMN IF NOT EXISTS es_plantilla TINYINT(1) DEFAULT 1;
ALTER TABLE Rutinas ADD COLUMN IF NOT EXISTS entrenador_id INT DEFAULT NULL;

-- 4. RUTINA_EJERCICIOS: Campos de prescripción estándar + Pro
ALTER TABLE Rutina_Ejercicios ADD COLUMN IF NOT EXISTS dia_nombre VARCHAR(50) DEFAULT 'Día 1';
ALTER TABLE Rutina_Ejercicios ADD COLUMN IF NOT EXISTS rir_objetivo VARCHAR(20) DEFAULT NULL;
ALTER TABLE Rutina_Ejercicios ADD COLUMN IF NOT EXISTS notas_entrenador TEXT DEFAULT '';
ALTER TABLE Rutina_Ejercicios ADD COLUMN IF NOT EXISTS grupo_superserie VARCHAR(10) DEFAULT NULL;
-- Campos PRO:
ALTER TABLE Rutina_Ejercicios ADD COLUMN IF NOT EXISTS tempo VARCHAR(20) DEFAULT NULL;
ALTER TABLE Rutina_Ejercicios ADD COLUMN IF NOT EXISTS es_unilateral TINYINT(1) DEFAULT 0;
ALTER TABLE Rutina_Ejercicios ADD COLUMN IF NOT EXISTS segundos_objetivo INT DEFAULT NULL;

-- 5. REGISTRO_PROGRESO: Campos de tracking avanzado
ALTER TABLE Registro_Progreso ADD COLUMN IF NOT EXISTS cliente_id INT DEFAULT NULL;
ALTER TABLE Registro_Progreso ADD COLUMN IF NOT EXISTS rir VARCHAR(10) DEFAULT NULL;
ALTER TABLE Registro_Progreso ADD COLUMN IF NOT EXISTS tipo_serie VARCHAR(30) DEFAULT 'Normal';
ALTER TABLE Registro_Progreso ADD COLUMN IF NOT EXISTS notas_cliente TEXT DEFAULT '';

-- 6. NOTAS_CLIENTES: Campo de email del entrenador
ALTER TABLE Notas_Clientes ADD COLUMN IF NOT EXISTS entrenador_email VARCHAR(150) DEFAULT NULL;

-- 7. EJERCICIOS: Campo de tipo de métrica
ALTER TABLE Ejercicios ADD COLUMN IF NOT EXISTS tipo_metrica VARCHAR(30) DEFAULT 'reps';

-- =============================================
-- ✅ VERIFICACIÓN: Ejecuta esto para confirmar
-- =============================================
-- SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Entrenadores';
-- SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Rutina_Ejercicios';
