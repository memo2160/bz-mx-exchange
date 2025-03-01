const express = require('express');
const mysql = require('mysql2');
const axios = require('axios');
const nodemailer = require('nodemailer');
const ejs = require('ejs');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

dotenv.config();

const app = express();
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

// Security middleware
app.use(helmet());

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 100,
    message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// Database connection using a pool
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

db.getConnection((err) => {
    if (err) {
        console.error('Database connection failed:', err);
        process.exit(1);
    } else {
        console.log('Connected to MySQL');
    }
});

// Home Route (Fetch Exchange Rate)
app.get('/', async (req, res) => {
    let exchangeRateMessage = { text: 'Unable to fetch exchange rate.', color: 'gray' };
    try {
        const response = await axios.get('https://api.exchangerate-api.com/v4/latest/MXN');
        const rate = response.data.rates.BZD;
        exchangeRateMessage = {
            text: rate > 0.10 ? 'Good time to buy!' : 'Bad time to buy.',
            color: rate > 0.10 ? 'green' : 'red'
        };
    } catch (error) {
        console.error('Error fetching exchange rate:', error);
    }
    res.render('index', { exchangeRateMessage });
});

// Subscribe Route
app.post('/subscribe', [
    body('email').isEmail().normalizeEmail().withMessage('Invalid email format')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        // If there are errors, show an error message
        return res.render('index', {
            exchangeRateMessage: { text: 'Unable to fetch exchange rate.', color: 'gray' },
            alertMessage: { text: errors.array()[0].msg, type: 'danger' }
        });
    }

    const email = req.body.email.trim(); // Get the email from the request body

    // Insert the email into the database
    db.query('INSERT INTO subscribers (email) VALUES (?)', [email], (err) => {
        if (err) {
            console.error('Database insertion error:', err);
            return res.render('index', {
                exchangeRateMessage: { text: 'Unable to fetch exchange rate.', color: 'gray' },
                alertMessage: { text: 'Error inserting email into the database.', type: 'danger' }
            });
        }
        
        // On successful insertion, display success message
        res.render('index', {
            exchangeRateMessage: { text: 'Subscribed successfully!', color: 'green' },
            alertMessage: { text: 'You have successfully subscribed!', type: 'success' }
        });
    });
});


// Notify Users
async function notifyUsers(message) {
    db.query('SELECT email FROM subscribers', async (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return;
        }

        const transporter = nodemailer.createTransport({
            host: 'mail.privateemail.com',
            port: 587,
            secure: false,
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
            tls: { rejectUnauthorized: false },
        });

        for (const subscriber of results) {
            try {
                await transporter.sendMail({
                    from: process.env.EMAIL_USER,
                    to: subscriber.email,
                    subject: 'Chetumal Sales Alert',
                    text: message
                });
                console.log(`Email sent to ${subscriber.email}`);
            } catch (error) {
                console.error(`Error sending email to ${subscriber.email}:`, error);
            }
        }
    });
}


// Schedule Exchange Rate Check (Every 12 Hours)
setInterval(async () => {
    try {
        const response = await axios.get('https://api.exchangerate-api.com/v4/latest/MXN');
        const rate = response.data.rates.BZD;
        const message = rate > 0.10 ? 'Good time to shop! MXN/BZD rate is favorable.' : 'Bad time to shop!';
        notifyUsers(message);
    } catch (error) {
        console.error('Error fetching exchange rate:', error);
    }
},  12 * 60 * 60 * 1000);

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
