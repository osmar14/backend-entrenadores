const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verificarUsuario, verificarPropiedadCliente } = require('../middlewares/auth');

router.get('/volumen/:cliente_id', verificarUsuario, verificarPropiedadCliente, async (req, res) => {
    try {
        const query = `
            SELECT e.grupo_muscular, COUNT(rp.id) as total_series 
            FROM Registro_Progreso rp
            JOIN Ejercicios e ON rp.ejercicio_id = e.id
            WHERE rp.cliente_id = ? AND rp.fecha >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
            GROUP BY e.grupo_muscular
            ORDER BY total_series DESC
        `;
        const [resultados] = await db.query(query, [req.params.cliente_id]);
        
        const resultadosConSemaforo = resultados.map(r => {
            let estado = 'Verde';
            if (r.total_series > 10 && r.total_series <= 20) estado = 'Amarillo';
            if (r.total_series > 20) estado = 'Rojo';
            return { ...r, semaforo: estado };
        });

        res.json(resultadosConSemaforo);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/radar/:cliente_id', verificarUsuario, verificarPropiedadCliente, async (req, res) => {
    try {
        const query = `
            SELECT e.grupo_muscular, COUNT(rp.id) as total_series 
            FROM Registro_Progreso rp
            JOIN Ejercicios e ON rp.ejercicio_id = e.id
            WHERE rp.cliente_id = ? AND rp.fecha >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            GROUP BY e.grupo_muscular
        `;
        const [resultados] = await db.query(query, [req.params.cliente_id]);
        res.json(resultados);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/radar-detalle/:cliente_id/:grupo_muscular', verificarUsuario, verificarPropiedadCliente, async (req, res) => {
    try {
        const query = `
            SELECT e.nombre as ejercicio, COUNT(rp.id) as total_series 
            FROM Registro_Progreso rp
            JOIN Ejercicios e ON rp.ejercicio_id = e.id
            WHERE rp.cliente_id = ? AND e.grupo_muscular = ? AND rp.fecha >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            GROUP BY e.id, e.nombre
        `;
        const [resultados] = await db.query(query, [req.params.cliente_id, req.params.grupo_muscular]);
        res.json(resultados);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/comparativa/:cliente_id', verificarUsuario, verificarPropiedadCliente, async (req, res) => {
    try {
        const { mes1, mes2 } = req.query;
        if (!mes1 || !mes2) return res.status(400).json({error: "Se requieren mes1 y mes2"});
        
        const query = `
            SELECT 
                e.grupo_muscular, 
                SUM(CASE WHEN DATE_FORMAT(rp.fecha, '%Y-%m') = ? THEN 1 ELSE 0 END) as series_mes1,
                SUM(CASE WHEN DATE_FORMAT(rp.fecha, '%Y-%m') = ? THEN 1 ELSE 0 END) as series_mes2
            FROM Registro_Progreso rp
            JOIN Ejercicios e ON rp.ejercicio_id = e.id
            WHERE rp.cliente_id = ? 
            AND (DATE_FORMAT(rp.fecha, '%Y-%m') = ? OR DATE_FORMAT(rp.fecha, '%Y-%m') = ?)
            GROUP BY e.grupo_muscular
        `;
        const [resultados] = await db.query(query, [mes1, mes2, req.params.cliente_id, mes1, mes2]);
        res.json(resultados);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/1rm/:cliente_id/:ejercicio_id', verificarUsuario, verificarPropiedadCliente, async (req, res) => {
    try {
        const query = `
            SELECT fecha, peso_kg, repeticiones, 
                   ROUND(peso_kg * (1 + (repeticiones / 30)), 2) AS estimado_1rm
            FROM Registro_Progreso 
            WHERE cliente_id = ? AND ejercicio_id = ? AND repeticiones > 0
            ORDER BY fecha ASC
        `;
        const [resultados] = await db.query(query, [req.params.cliente_id, req.params.ejercicio_id]);
        res.json(resultados);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/pr/:cliente_id/:ejercicio_id', verificarUsuario, verificarPropiedadCliente, async (req, res) => {
    try {
        const query = `
            SELECT MAX(peso_kg) as pr 
            FROM Registro_Progreso 
            WHERE cliente_id = ? AND ejercicio_id = ? AND fecha >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        `;
        const [resultados] = await db.query(query, [req.params.cliente_id, req.params.ejercicio_id]);
        res.json({ pr: resultados[0].pr || 0 });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/volumen-carga-total/:cliente_id', verificarUsuario, verificarPropiedadCliente, async (req, res) => {
    try {
        const query = `
            SELECT DATE_FORMAT(fecha, '%Y-%m-%d') as fecha_corta, 
                   SUM(peso_kg * repeticiones) as volumen_total 
            FROM Registro_Progreso 
            WHERE cliente_id = ? AND peso_kg > 0 AND repeticiones > 0 AND fecha >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            GROUP BY DATE_FORMAT(fecha, '%Y-%m-%d')
            ORDER BY fecha_corta ASC
            LIMIT 15
        `;
        const [resultados] = await db.query(query, [req.params.cliente_id]);
        res.json(resultados);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// MAPA DE ADHERENCIA (Calendario estilo GitHub)
// ==========================================
router.get('/adherencia/:cliente_id', verificarUsuario, verificarPropiedadCliente, async (req, res) => {
    try {
        // 1. Obtener la fecha de la primera rutina asignada al cliente
        const [fechaInicio] = await db.query(
            'SELECT MIN(fecha_creacion) AS inicio FROM Rutinas WHERE cliente_id = ?',
            [req.params.cliente_id]
        );
        const inicio = fechaInicio[0]?.inicio || new Date();

        // 2. Obtener todos los días distintos que el cliente registró progreso (últimos 90 días)
        const [diasEntrenados] = await db.query(
            `SELECT DISTINCT DATE_FORMAT(fecha, '%Y-%m-%d') AS dia 
             FROM Registro_Progreso 
             WHERE cliente_id = ? AND fecha >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
             ORDER BY dia ASC`,
            [req.params.cliente_id]
        );

        // 3. Calcular total de días desde inicio hasta hoy (máx 90)
        const hoy = new Date();
        const fechaInicioDate = new Date(inicio);
        const diffMs = hoy - fechaInicioDate;
        const diasTotales = Math.min(Math.ceil(diffMs / (1000 * 60 * 60 * 24)), 90);
        const diasActivosCount = diasEntrenados.length;
        const porcentaje = diasTotales > 0 ? Math.round((diasActivosCount / diasTotales) * 100) : 0;

        res.json({
            porcentaje_adherencia: porcentaje,
            dias_entrenados: diasActivosCount,
            dias_totales: diasTotales,
            fechas_activas: diasEntrenados.map(d => d.dia)
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// CUESTIONARIO READINESS (POST y GET)
// ==========================================
router.post('/readiness', verificarUsuario, async (req, res) => {
    const { cliente_id, sueno, estres, dolor_muscular } = req.body;
    if (!cliente_id || sueno == null || estres == null || dolor_muscular == null) {
        return res.status(400).json({ error: 'Se requieren: cliente_id, sueno, estres, dolor_muscular (1-5)' });
    }
    try {
        await db.query(
            `INSERT INTO Cuestionario_Readiness (cliente_id, sueno, estres, dolor_muscular, fecha) 
             VALUES (?, ?, ?, ?, NOW())`,
            [cliente_id, sueno, estres, dolor_muscular]
        );
        res.status(201).json({ message: 'Readiness registrado' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/readiness/:cliente_id', verificarUsuario, verificarPropiedadCliente, async (req, res) => {
    try {
        const [resultados] = await db.query(
            `SELECT * FROM Cuestionario_Readiness 
             WHERE cliente_id = ? ORDER BY fecha DESC LIMIT 1`,
            [req.params.cliente_id]
        );
        res.json(resultados[0] || null);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// SEMÁFORO DE FATIGA CIENTÍFICO
// ==========================================
router.get('/semaforo-fatiga/:cliente_id', verificarUsuario, verificarPropiedadCliente, async (req, res) => {
    try {
        // 1. Obtener último cuestionario de readiness
        const [readiness] = await db.query(
            `SELECT * FROM Cuestionario_Readiness 
             WHERE cliente_id = ? ORDER BY fecha DESC LIMIT 1`,
            [req.params.cliente_id]
        );

        // 2. Obtener carga aguda (volumen últimos 7 días)
        const [carga] = await db.query(
            `SELECT COALESCE(SUM(peso_kg * repeticiones), 0) AS carga_aguda,
                    COUNT(DISTINCT DATE(fecha)) AS dias_entreno
             FROM Registro_Progreso 
             WHERE cliente_id = ? AND fecha >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`,
            [req.params.cliente_id]
        );

        const cargaAguda = carga[0]?.carga_aguda || 0;
        const diasEntreno = carga[0]?.dias_entreno || 0;
        const readinessData = readiness[0] || null;

        // 3. Algoritmo de fatiga
        let puntuacion = 100; // Empieza en 100 (óptimo)
        let factores = [];

        // Factor: Carga aguda alta
        if (cargaAguda > 15000) { puntuacion -= 25; factores.push('Volumen semanal muy alto'); }
        else if (cargaAguda > 10000) { puntuacion -= 10; factores.push('Volumen semanal elevado'); }

        // Factor: Frecuencia alta
        if (diasEntreno >= 6) { puntuacion -= 15; factores.push('Entrenó 6+ días esta semana'); }

        // Factor: Readiness (si hay cuestionario reciente)
        if (readinessData) {
            const esReciente = (new Date() - new Date(readinessData.fecha)) < 48 * 60 * 60 * 1000; // últimas 48h
            if (esReciente) {
                if (readinessData.sueno <= 2) { puntuacion -= 20; factores.push(`Sueño pobre (${readinessData.sueno}/5)`); }
                else if (readinessData.sueno <= 3) { puntuacion -= 10; }

                if (readinessData.estres >= 4) { puntuacion -= 15; factores.push(`Estrés alto (${readinessData.estres}/5)`); }
                else if (readinessData.estres >= 3) { puntuacion -= 5; }

                if (readinessData.dolor_muscular >= 4) { puntuacion -= 20; factores.push(`DOMS severo (${readinessData.dolor_muscular}/5)`); }
                else if (readinessData.dolor_muscular >= 3) { puntuacion -= 10; }
            }
        }

        puntuacion = Math.max(0, Math.min(100, puntuacion));

        let estado, recomendacion;
        if (puntuacion >= 70) {
            estado = 'Verde';
            recomendacion = 'Condiciones óptimas para entrenar con intensidad.';
        } else if (puntuacion >= 40) {
            estado = 'Amarillo';
            recomendacion = 'Reducir volumen un 10-15%. Priorizar técnica.';
        } else {
            estado = 'Rojo';
            recomendacion = 'Recomendar descanso activo o deload. Reducir cargas un 20-30%.';
        }

        res.json({
            estado,
            puntuacion,
            recomendacion,
            factores,
            carga_aguda: cargaAguda,
            dias_entreno: diasEntreno,
            readiness: readinessData
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
