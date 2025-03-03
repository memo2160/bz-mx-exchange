// Import required modules
const express = require('express');
const mysql = require('mysql2');
const nodemailer = require('nodemailer');
const ejs = require('ejs');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const https = require('https');

// Load environment variables from a .env file
dotenv.config();

// Create an Express application
const app = express();
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.use(helmet());

// Enforce canonical URLs
app.use((req, res, next) => {
    if (!req.secure && process.env.NODE_ENV === 'production') {
        return res.redirect(`https://${req.headers.host}${req.url}`);
    }
    next();
});

// Set up rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many requests, try again later.'
});
app.use(limiter);

// Database connection
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
    }
    console.log('Connected to MySQL');
});

// Fetch exchange rate
function getExchangeRate(callback) {
    const options = {
        hostname: 'api.freecurrencyapi.com',
        path: `/v1/latest?base_currency=USD&target_currency=MXN&apikey=${process.env.CURRENCY_API_KEY}`,
        method: 'GET',
    };
    
    const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
            try {
                const parsedData = JSON.parse(data);
                const usdToMxn = parsedData.data.MXN;
                if (isNaN(usdToMxn)) return callback(new Error('Invalid exchange rate'), null);
                callback(null, 2.01 / usdToMxn);
            } catch (error) {
                callback(error, null);
            }
        });
    });
    
    req.on('error', (error) => callback(error, null));
    req.end();
}

// Routes
app.get('/', (req, res) => {
    getExchangeRate((error, rate) => {
        const message = rate ? (rate > 0.095 ? 'Good time to buy!' : 'Bad time to buy.') : 'Unable to fetch rate.';
        res.render('index', { exchangeRateMessage: { text: message, color: rate > 0.095 ? 'green' : 'red' } });
    });
});

app.get('/disclaimer', (req, res) => res.render('disclaimer'));

app.post('/subscribe', [body('email').isEmail().normalizeEmail().withMessage('Invalid email')], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.render('index', { alertMessage: { text: errors.array()[0].msg, type: 'danger' } });
    
    db.query('INSERT INTO subscribers (email) VALUES (?)', [req.body.email.trim()], (err) => {
        const message = err ? 'Error saving email' : 'Successfully subscribed';
        res.render('index', { alertMessage: { text: message, type: err ? 'danger' : 'success' } });
    });
});

app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send(`User-agent: *\nDisallow:\nSitemap: https://${process.env.DOMAIN}/sitemap.xml`);
});

app.use((req, res) => res.status(404).render('404', { url: req.originalUrl }));

// Notify users
async function notifyUsers(message) {
    db.query('SELECT email FROM subscribers', async (err, results) => {
        if (err) return console.error('Database error:', err);
        
        const transporter = nodemailer.createTransport({
            host: 'mail.privateemail.com',
            port: 587,
            secure: false,
            auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
            tls: { rejectUnauthorized: false }
        });
        
        for (const { email } of results) {
            try {
                await transporter.sendMail({ from: process.env.EMAIL_USER, to: email, subject: 'Chetumal Sales Alert', text: message });
                console.log(`Email sent to ${email}`);
            } catch (error) {
                console.error(`Error sending email to ${email}:`, error);
            }
        }
    });
}

// Schedule exchange rate check
setInterval(() => {
    getExchangeRate((error, rate) => {
        if (!error) notifyUsers(rate > 0.095 ? 'Good time to shop!' : 'Bad time to shop!');
    });
}, 12 * 60 * 60 * 1000);

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
