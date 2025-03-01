const express = require('express');
const mysql = require('mysql2');
const nodemailer = require('nodemailer');
const ejs = require('ejs');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const https = require('https'); // Import the https module

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

// Function to fetch exchange rates using the https module
function getExchangeRate(callback) {
    const options = {
        hostname: 'api.freecurrencyapi.com',
        path: '/v1/latest?base_currency=USD&target_currency=MXN&apikey=fca_live_gMvVwjVBWoBchVqQdKzWVhZS4HtK4yAYIWwKNM4a',
        method: 'GET',
    };

    const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
            data += chunk;
        });

        res.on('end', () => {
            try {
                const parsedData = JSON.parse(data);
                console.log('Raw API Response:', parsedData); // Log the entire raw response

                const usdToMxn = parsedData.data.MXN;

                // Logging the exchange rates received
                console.log(`Exchange rate fetched: USD/MXN = ${usdToMxn}`);

                // Check if usdToMxn is a valid number before calculating BZD/MXN
                if (isNaN(usdToMxn)) {
                    console.error('Invalid USD/MXN exchange rate received.');
                    callback(new Error('Invalid USD/MXN exchange rate received'), null);
                    return;
                }

                // Fixed conversion rate for USD to BZD
                const usdToBzd = 2.01;

                // Calculate BZD/MXN rate using the fixed USD to BZD rate
                const bzMxnRate = usdToBzd / usdToMxn;

                // Logging the calculated BZD/MXN rate
                console.log(`Calculated BZD/MXN rate: ${bzMxnRate}`);

                callback(null, bzMxnRate);
            } catch (error) {
                console.error('Error parsing exchange rate data:', error);
                callback(error, null);
            }
        });
    });

    req.on('error', (error) => {
        console.error('Request error:', error);
        callback(error, null);
    });

    req.end();
}

// Home Route (Fetch Exchange Rate)
app.get('/', (req, res) => {
    let exchangeRateMessage = { text: 'Unable to fetch exchange rate.', color: 'gray' };

    console.log('Fetching exchange rate...');

    getExchangeRate((error, rate) => {
        if (error) {
            console.error('Error fetching exchange rate:', error);
            return res.render('index', { exchangeRateMessage });
        }

        exchangeRateMessage = {
            text: rate > 0.095 ? 'Good time to buy!' : 'Bad time to buy.',
            color: rate > 0.095 ? 'green' : 'red'
        };

        console.log(`Exchange rate fetched: ${rate}. Exchange rate message: ${exchangeRateMessage.text}`);

        res.render('index', { exchangeRateMessage });
    });
});

// Subscribe Route
app.post('/subscribe', [
    body('email').isEmail().normalizeEmail().withMessage('Invalid email format')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        // If there are errors, show an error message
        const errorMessage = errors.array()[0].msg;
        console.log(`Subscription failed. Error: ${errorMessage}`);

        return res.render('index', {
            exchangeRateMessage: { text: 'Unable to fetch exchange rate.', color: 'gray' },
            alertMessage: { text: errorMessage, type: 'danger' }
        });
    }

    const email = req.body.email.trim(); // Get the email from the request body

    console.log(`New subscription request: ${email}`);

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
        console.log(`Email ${email} subscribed successfully!`);

        res.render('index', {
            exchangeRateMessage: { text: 'Subscribed successfully!', color: 'green' },
            alertMessage: { text: 'You have successfully subscribed!', type: 'success' }
        });
    });
});

// Notify Users
async function notifyUsers(message) {
    console.log('Notifying users about exchange rate update...');

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
                console.log(`Sending email to ${subscriber.email}`);
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
setInterval(() => {
    console.log('Checking exchange rate...');

    getExchangeRate((error, rate) => {
        if (error) {
            console.error('Error fetching exchange rate:', error);
            return;
        }

        const message = rate > 0.095 ? 'Good time to shop! MXN/BZD rate is favorable.' : 'Bad time to shop!';
        console.log(`Exchange rate check complete. Rate: ${rate}. Message: ${message}`);

        notifyUsers(message);
    });
}, 12 * 60 * 60 * 1000);

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
