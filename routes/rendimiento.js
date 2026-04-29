const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verificarUsuario } = require('../middlewares/auth');

// 1. Obtener rutinas y sus días asignados
router.get('/rutinas-dias/:cliente_id', verificarUsuario, async (req, res) => {
    try {
        const query = `
            SELECT r.id as rutina_id, r.nombre as rutina_nombre, re.dia_nombre 
            FROM Rutinas r
            JOIN Rutina_Ejercicios re ON r.id = re.rutina_id
            WHERE r.cliente_id = ?
            GROUP BY r.id, re.dia_nombre
            ORDER BY r.id DESC, re.dia_nombre ASC
        `;
        const [resultados] = await db.query(query, [req.params.cliente_id]);
        
        // Agrupar por rutina
        const rutinasMap = {};
        resultados.forEach(row => {
            if (!rutinasMap[row.rutina_id]) {
                rutinasMap[row.rutina_id] = {
                    id: row.rutina_id,
                    nombre: row.rutina_nombre,
                    dias: []
                };
            }
            if (row.dia_nombre) {
                rutinasMap[row.rutina_id].dias.push(row.dia_nombre);
            }
        });
        
        res.json(Object.values(rutinasMap));
    } catch (err) {
        console.error("Error obteniendo rutinas y dias:", err);
        res.status(500).json({ error: err.message });
    }
});

// 2. Obtener las últimas 4 sesiones de un día específico de una rutina
router.get('/sesiones-dia/:cliente_id/:rutina_id/:dia_nombre', verificarUsuario, async (req, res) => {
    try {
        const { rutina_id, dia_nombre } = req.params;
        
        // Paso 1: Encontrar las últimas 4 fechas distintas donde se entrenó este día
        const [fechasRows] = await db.query(`
            SELECT DISTINCT DATE(rp.fecha) as fecha_corta
            FROM Registro_Progreso rp
            JOIN Rutina_Ejercicios re ON re.rutina_id = rp.rutina_id AND re.ejercicio_id = rp.ejercicio_id
            WHERE rp.rutina_id = ? AND re.dia_nombre = ?
            ORDER BY fecha_corta DESC LIMIT 4
        `, [rutina_id, dia_nombre]);

        if (fechasRows.length === 0) {
            return res.json([]);
        }

        const fechas = fechasRows.map(f => f.fecha_corta);

        // Paso 2: Obtener todos los ejercicios de esas fechas
        const [sesionesRows] = await db.query(`
            SELECT DATE(rp.fecha) as fecha_corta, rp.peso_kg, rp.repeticiones, rp.serie_numero, e.nombre as ejercicio_nombre
            FROM Registro_Progreso rp
            JOIN Ejercicios e ON rp.ejercicio_id = e.id
            JOIN Rutina_Ejercicios re ON re.rutina_id = rp.rutina_id AND re.ejercicio_id = rp.ejercicio_id
            WHERE rp.rutina_id = ? AND re.dia_nombre = ? AND DATE(rp.fecha) IN (?)
            ORDER BY fecha_corta DESC, e.nombre ASC, rp.serie_numero ASC
        `, [rutina_id, dia_nombre, fechas]);

        // Paso 3: Agrupar por fecha -> ejercicio
        const porFecha = {};
        sesionesRows.forEach(row => {
            const fechaStr = row.fecha_corta;
            if (!porFecha[fechaStr]) {
                porFecha[fechaStr] = { fecha: fechaStr, ejercicios: {} };
            }
            if (!porFecha[fechaStr].ejercicios[row.ejercicio_nombre]) {
                porFecha[fechaStr].ejercicios[row.ejercicio_nombre] = [];
            }
            porFecha[fechaStr].ejercicios[row.ejercicio_nombre].push({
                serie: row.serie_numero,
                peso: parseFloat(row.peso_kg),
                reps: row.repeticiones
            });
        });

        res.json(Object.values(porFecha).sort((a, b) => new Date(b.fecha) - new Date(a.fecha)));

    } catch (err) {
        console.error("Error obteniendo sesiones del dia:", err);
        res.status(500).json({ error: err.message });
    }
});

// 3. Progreso de un ejercicio específico para la gráfica de picos
router.get('/progreso-ejercicio/:cliente_id/:ejercicio_id', verificarUsuario, async (req, res) => {
    try {
        const { cliente_id, ejercicio_id } = req.params;

        // Obtenemos todos los registros de progreso de ese ejercicio para el cliente
        const query = `
            SELECT rp.fecha, rp.peso_kg, rp.repeticiones
            FROM Registro_Progreso rp
            JOIN Rutinas r ON rp.rutina_id = r.id
            WHERE r.cliente_id = ? AND rp.ejercicio_id = ?
            ORDER BY rp.fecha ASC
        `;
        const [registros] = await db.query(query, [cliente_id, ejercicio_id]);

        // Agrupamos por fecha (Día) para encontrar la serie con mayor 1RM (el pico)
        const progresoPorFecha = {};
        
        registros.forEach(row => {
            const fechaCorta = new Date(row.fecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
            const peso = parseFloat(row.peso_kg);
            const reps = parseInt(row.repeticiones);
            const rmEst = peso * (1 + reps / 30); // Fórmula Brzycki aproximada
            const volumenSerie = peso * reps;

            if (!progresoPorFecha[fechaCorta]) {
                progresoPorFecha[fechaCorta] = {
                    fecha: fechaCorta,
                    max1rm: rmEst,
                    mejorSerieReps: reps,
                    mejorSeriePeso: peso,
                    mejorSerieVolumen: volumenSerie,
                    volumenTotalDia: volumenSerie // volumen de todo el día para ese ejercicio
                };
            } else {
                progresoPorFecha[fechaCorta].volumenTotalDia += volumenSerie;
                
                // Si encontramos una serie con un 1RM mayor en el mismo día, actualizamos el pico
                if (rmEst > progresoPorFecha[fechaCorta].max1rm) {
                    progresoPorFecha[fechaCorta].max1rm = rmEst;
                    progresoPorFecha[fechaCorta].mejorSerieReps = reps;
                    progresoPorFecha[fechaCorta].mejorSeriePeso = peso;
                    progresoPorFecha[fechaCorta].mejorSerieVolumen = volumenSerie;
                }
            }
        });

        // Formatear los valores para la gráfica
        const datosGrafica = Object.values(progresoPorFecha).map(d => ({
            fecha: d.fecha,
            rm_estimado: parseFloat(d.max1rm.toFixed(2)),
            reps: d.mejorSerieReps,
            peso: d.mejorSeriePeso,
            volumen_serie: parseFloat(d.mejorSerieVolumen.toFixed(2)),
            volumen_total_dia: parseFloat(d.volumenTotalDia.toFixed(2))
        }));

        res.json(datosGrafica);

    } catch (err) {
        console.error("Error obteniendo progreso del ejercicio:", err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
