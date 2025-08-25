const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs').promises;
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('.'));

const db = new sqlite3.Database('quiz.db', (err) => {
    if (err) console.error('Error al conectar a la base de datos:', err);
    db.run(`CREATE TABLE IF NOT EXISTS responses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT,
        apellido TEXT,
        correo TEXT,
        ip TEXT,
        type TEXT,
        fecha TEXT,
        score INTEGER,
        total INTEGER,
        answers TEXT,
        justifications TEXT,
        corrected INTEGER,
        feedback TEXT
    )`);
});

app.get('/questions', async (req, res) => {
    try {
        const questions = JSON.parse(await fs.readFile('questions.json'));
        res.json(questions);
    } catch (error) {
        console.error('Error al leer preguntas:', error);
        res.status(500).json({ success: false, message: 'Error al cargar preguntas.' });
    }
});


app.post('/submit', async (req, res) => {
    const { nombre, apellido, correo, answers, type, justifications, ip } = req.body;

    if (!nombre || !apellido || !correo) {
        return res.status(400).json({ success: false, message: 'Por favor completa los campos de nombre, apellido y correo.' });
    }

    try {
        // Asegurar que la tabla responses exista
        await new Promise((resolve, reject) => {
            db.run(`CREATE TABLE IF NOT EXISTS responses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT,
                apellido TEXT,
                correo TEXT,
                ip TEXT,
                type TEXT,
                fecha TEXT,
                score INTEGER,
                total INTEGER,
                answers TEXT,
                justifications TEXT,
                corrected INTEGER,
                feedback TEXT
            )`, (err) => {
                if (err) reject(err);
                resolve();
            });
        });

        // Verificar si el correo o IP ya existen
        const existing = await new Promise((resolve) => {
            db.get('SELECT * FROM responses WHERE correo = ? OR ip = ?', [correo, ip], (err, row) => {
                if (err) console.error('Error al verificar existente:', err);
                resolve(row);
            });
        });

        if (existing) {
            return res.status(400).json({ success: false, message: 'Este correo o dispositivo ya ha enviado el cuestionario.' });
        }

        const questions = JSON.parse(await fs.readFile('questions.json'));
        const correctAnswers = {};
        questions.forEach(q => {
            correctAnswers[q.id] = q.correctAnswer;
        });

        let score = 0;
        const feedback = {};
        questions.forEach(q => {
            feedback[q.id] = { correct: answers?.[q.id] === correctAnswers[q.id] && justifications?.[q.id] };
            if (answers?.[q.id] && justifications?.[q.id] && feedback[q.id].correct) score++;
        });

        const answersData = {};
        questions.forEach(q => {
            answersData[q.id] = {
                value: answers?.[q.id] || 'No respondida',
                correct: feedback[q.id].correct,
                message: answers?.[q.id] && justifications?.[q.id]
                    ? (feedback[q.id].correct ? 'Correcta' : `Incorrecta, la respuesta correcta es ${q.options.find(opt => opt.value === q.correctAnswer).text}`)
                    : 'No evaluada (falta justificación o respuesta)'
            };
        });

        const data = {
            type: type === 'manual' ? 'Manual' : 'Automático',
            fecha: new Date().toLocaleString('es-ES'),
            nombre,
            apellido,
            correo,
            ip,
            score,
            total: questions.length,
            answers: answersData,
            justifications: justifications || {},
            corrected: false
        };

        await new Promise((resolve, reject) => {
            db.run('INSERT INTO responses (nombre, apellido, correo, ip, type, fecha, score, total, answers, justifications, corrected, feedback) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [nombre, apellido, correo, ip, data.type, data.fecha, score, data.total, JSON.stringify(data.answers), JSON.stringify(data.justifications), 0, JSON.stringify(data.answers)],
                (err) => {
                    if (err) reject(err);
                    resolve();
                });
        });

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.json({ success: true, message: 'Cuestionario enviado. La corrección está en proceso.' });
    } catch (error) {
        console.error('Error al procesar el envío:', error);
        res.status(500).json({ success: false, message: 'Error al procesar el envío. Por favor intenta de nuevo.' });
    }
});



app.get('/check-results', async (req, res) => {
    const { correo } = req.query;

    try {
        // Asegurar que la tabla responses exista
        await new Promise((resolve, reject) => {
            db.run(`CREATE TABLE IF NOT EXISTS responses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT,
                apellido TEXT,
                correo TEXT,
                ip TEXT,
                type TEXT,
                fecha TEXT,
                score INTEGER,
                total INTEGER,
                answers TEXT,
                justifications TEXT,
                corrected INTEGER,
                feedback TEXT
            )`, (err) => {
                if (err) reject(err);
                resolve();
            });
        });

        const row = await new Promise((resolve) => {
            db.get('SELECT * FROM responses WHERE correo = ?', [correo], (err, row) => {
                if (err) console.error('Error al consultar resultados:', err);
                resolve(row);
            });
        });

        if (!row) {
            return res.json({ success: false, message: 'No se encontró el cuestionario.' });
        }

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.json({
            success: true,
            corrected: row.corrected,
            score: row.score,
            total: row.total,
            answers: JSON.parse(row.answers),
            justifications: JSON.parse(row.justifications)
        });
    } catch (error) {
        console.error('Error al consultar resultados:', error);
        res.status(500).json({ success: false, message: 'Error al consultar resultados.' });
    }
});



app.post('/view-responses', async (req, res) => {
    const { password } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, message: 'Clave incorrecta.' });
    }

    try {
        const rows = await new Promise((resolve) => {
            db.all('SELECT * FROM responses', [], (err, rows) => {
                resolve(rows);
            });
        });

        const formattedResponses = rows.length > 0 ? rows.map(r => {
            const answers = JSON.parse(r.answers);
            const justifications = JSON.parse(r.justifications);
            return `
----------------------------------------
Envío: ${r.type}
Fecha: ${r.fecha}
Nombre: ${r.nombre}
Apellido: ${r.apellido}
Correo: ${r.correo}
IP: ${r.ip}
Puntuación: ${r.score}/${r.total}
${Object.keys(answers).map(q => `
Pregunta ${q.replace('q', '')}: ${answers[q].value} (${answers[q].message})
Justificación ${q.replace('q', '')}: ${justifications[q] || 'No proporcionada'}
Comentario ${q.replace('q', '')}: ${answers[q].comment || 'Sin comentario'}
`).join('')}
Corregido: ${r.corrected ? 'Sí' : 'No'}
----------------------------------------
`;
        }).join('') : 'No hay respuestas disponibles.';

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.json({ success: true, responses: formattedResponses });
    } catch (error) {
        console.error('Error al leer respuestas:', error);
        res.status(500).json({ success: false, message: 'Error al leer las respuestas. Por favor intenta de nuevo.' });
    }
});

app.post('/update-feedback', async (req, res) => {
    const { password, studentEmail, questionNumber, score, comment } = req.body;

    if (password !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, message: 'Clave incorrecta.' });
    }

    try {
        const row = await new Promise((resolve) => {
            db.get('SELECT * FROM responses WHERE correo = ?', [studentEmail], (err, row) => {
                resolve(row);
            });
        });

        if (!row) {
            return res.json({ success: false, message: 'No se encontró el cuestionario.' });
        }

        const answers = JSON.parse(row.answers);
        let totalScore = row.score;
        if (answers[questionNumber].correct && score == 0) totalScore--;
        if (!answers[questionNumber].correct && score == 1) totalScore++;
        answers[questionNumber].score = parseInt(score);
        answers[questionNumber].comment = comment;

        await new Promise((resolve, reject) => {
            db.run('UPDATE responses SET answers = ?, score = ?, corrected = 1 WHERE correo = ?',
                [JSON.stringify(answers), totalScore, studentEmail],
                (err) => {
                    if (err) reject(err);
                    resolve();
                });
        });

        res.json({ success: true, message: 'Corrección actualizada.' });
    } catch (error) {
        console.error('Error al actualizar corrección:', error);
        res.status(500).json({ success: false, message: 'Error al actualizar corrección.' });
    }
});


app.post('/reset-quiz', async (req, res) => {
    const { password } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, message: 'Clave incorrecta.' });
    }

    try {
        // Eliminar todas las respuestas
        await new Promise((resolve, reject) => {
            db.run('DELETE FROM responses', (err) => {
                if (err) reject(err);
                resolve();
            });
        });

        // Optimizar la base de datos
        await new Promise((resolve, reject) => {
            db.run('VACUUM', (err) => {
                if (err) reject(err);
                resolve();
            });
        });

        // Asegurar que la tabla responses exista
        await new Promise((resolve, reject) => {
            db.run(`CREATE TABLE IF NOT EXISTS responses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT,
                apellido TEXT,
                correo TEXT,
                ip TEXT,
                type TEXT,
                fecha TEXT,
                score INTEGER,
                total INTEGER,
                answers TEXT,
                justifications TEXT,
                corrected INTEGER,
                feedback TEXT
            )`, (err) => {
                if (err) reject(err);
                resolve();
            });
        });

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.json({ success: true, message: 'Cuestionario reseteado correctamente.' });
    } catch (error) {
        console.error('Error al resetear el cuestionario:', error);
        res.status(500).json({ success: false, message: 'Error al resetear el cuestionario. Por favor intenta de nuevo.' });
    }
});


app.get('/admin', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.sendFile(__dirname + '/admin.html');
});

app.listen(port, () => {
    console.log(`Servidor corriendo en http://localhost:${port}`);
});