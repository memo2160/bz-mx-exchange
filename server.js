// Import required modules
const express = require('express');
const mysql = require('mysql2');
const ejs = require('ejs');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const helmet = require('helmet');
const sgMail = require('@sendgrid/mail');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const https = require('https'); // Import the https module for secure HTTP requests

// Load environment variables from a .env file
dotenv.config();

// Create an Express application
const app = express();
sgMail.setApiKey(process.env.SENDGRID_API_KEY);
app.set('view engine', 'ejs'); // Set EJS as the view engine for rendering views
app.use(bodyParser.urlencoded({ extended: true })); // Middleware to parse URL-encoded data
app.use(express.json()); // Middleware to parse JSON data
app.use(express.static('public')); // Serve static files from the 'public' folder

// Security middleware to add security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https:", "http:"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https:", "http:"],
        imgSrc: ["'self'", "data:", "https:", "http:"],
        connectSrc: ["'self'", "https:", "http:"],
      },
    },
  })
);


// Set up rate limiting to prevent abuse by limiting the number of requests
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Maximum 100 requests per 15 minutes
    message: 'Too many requests from this IP, please try again later.' // Error message when limit is exceeded
});
app.use(limiter); // Apply the rate limiter middleware


// Database connection using a connection pool
const db = mysql.createPool({
    host: process.env.DB_HOST, // Database host from environment variables
    user: process.env.DB_USERNAME, // Database username from environment variables
    password: process.env.DB_PASSWORD, // Database password from environment variables
    database: process.env.DB_NAME, // Database name from environment variables
    waitForConnections: true, // Wait for an available connection before starting a new one
    connectionLimit: 10, // Maximum number of connections in the pool
    queueLimit: 0 // Unlimited queue length
});

// Test the database connection on server startup
db.getConnection((err) => {
    if (err) {
        console.error('Database connection failed:', err);
        process.exit(1); // Exit if database connection fails
    } else {
        console.log('Connected to MySQL');
    }
});

// Function to fetch the USD to MXN exchange rate from an API
function getExchangeRate(callback) {
    const options = {
        hostname: 'api.freecurrencyapi.com', // API endpoint for fetching exchange rates
        path: '/v1/latest?base_currency=USD&target_currency=MXN&apikey=fca_live_gMvVwjVBWoBchVqQdKzWVhZS4HtK4yAYIWwKNM4a', // API request URL
        method: 'GET', // HTTP method (GET)
    };

    const req = https.request(options, (res) => {
        let data = '';

        // Handle incoming data
        res.on('data', (chunk) => {
            data += chunk;
        });

        // When the response ends, parse the data
        res.on('end', () => {
            try {
                const parsedData = JSON.parse(data); // Parse the JSON response
                console.log('Raw API Response:', parsedData); // Log the raw response

                const usdToMxn = parsedData.data.MXN; // Extract the USD to MXN rate

                // Logging the exchange rates received
                console.log(`Exchange rate fetched: USD/MXN = ${usdToMxn}`);

                // Check if the rate is valid before proceeding
                if (isNaN(usdToMxn)) {
                    console.error('Invalid USD/MXN exchange rate received.');
                    callback(new Error('Invalid USD/MXN exchange rate received'), null);
                    return;
                }

                // Fixed conversion rate for USD to BZD (Belize Dollar)
                const usdToBzd = 2.01;

                // Calculate BZD to MXN exchange rate
                const bzMxnRate = usdToBzd / usdToMxn;

                // Logging the calculated BZD/MXN rate
                console.log(`Calculated BZD/MXN rate: ${bzMxnRate}`);

                // Return the BZD/MXN rate to the callback
                callback(null, bzMxnRate);
            } catch (error) {
                console.error('Error parsing exchange rate data:', error);
                callback(error, null);
            }
        });
    });

    req.on('error', (error) => {
        console.error('Request error:', error); // Handle request errors
        callback(error, null); // Return the error to the callback
    });

    req.end(); // End the request
}

// Home route: Fetch and display exchange rate status
app.get('/', (req, res) => {
    let exchangeRateMessage = { text: 'Unable to fetch exchange rate.', color: 'gray' };

    console.log('Fetching exchange rate...');

    getExchangeRate((error, rate) => {
        if (error) {
            console.error('Error fetching exchange rate:', error);
            return res.render('index', { exchangeRateMessage });
        }

        // Determine if it is a good or bad time to shop based on the exchange rate
        exchangeRateMessage = {
            text: rate > 0.095 ? 'Good time to visit Mexico!' : 'Bad time to visit Mexico.',
            color: rate > 0.095 ? 'green' : 'red'
        };

        console.log(`Exchange rate fetched: ${rate}. Exchange rate message: ${exchangeRateMessage.text}`);

        res.render('index', { exchangeRateMessage }); // Render the index page with the exchange rate message
    });
});


// Disclaimer Route
app.get('/disclaimer', (req, res) => {
    res.render('disclaimer'); // Renders the 'disclaimer.ejs' page
});

// Subscribe route: Handle subscription form submission
app.post('/subscribe', [
    body('email').isEmail().normalizeEmail().withMessage('Invalid email format') // Validate email format
], (req, res) => {
    const errors = validationResult(req); // Check for validation errors
    if (!errors.isEmpty()) {
        // If there are validation errors, display an error message
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

        // On successful insertion, display a success message
        console.log(`Email ${email} subscribed successfully!`);

        res.render('index', {
            exchangeRateMessage: { text: 'Subscribed successfully!', color: 'green' },
            alertMessage: { text: 'You have successfully subscribed!', type: 'success' }
        });
    });
});


app.post('/unsubscribe', [
    body('email').isEmail().normalizeEmail().withMessage('Invalid email format')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.render('index', {
            exchangeRateMessage: { text: 'Unable to fetch exchange rate.', color: 'gray' },
            alertMessage: { text: errors.array()[0].msg, type: 'danger' }
        });
    }

    const email = req.body.email.trim();

    console.log(`Unsubscribe request for: ${email}`);

    db.query('DELETE FROM subscribers WHERE email = ?', [email], (err, result) => {
        if (err) {
            console.error('Database deletion error:', err);
            return res.render('index', {
                exchangeRateMessage: { text: 'Unable to fetch exchange rate.', color: 'gray' },
                alertMessage: { text: 'Error removing email from the database.', type: 'danger' }
            });
        }

        if (result.affectedRows === 0) {
            return res.render('index', {
                exchangeRateMessage: { text: 'Unable to fetch exchange rate.', color: 'gray' },
                alertMessage: { text: 'Email not found in the subscription list.', type: 'warning' }
            });
        }

        console.log(`Email ${email} unsubscribed successfully!`);
        res.render('index', {
            exchangeRateMessage: { text: 'Subscription removed!', color: 'green' },
            alertMessage: { text: 'You have successfully unsubscribed.', type: 'success' }
        });
    });
});


app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send(`User-agent: *
Disallow:

Sitemap: https://ex.holdyah.com/sitemap.xml`);
});


app.get('/about', (req, res) => {
    res.render('about');  // Renders the 'about.ejs' file (you will create this below)
});

app.get('/tool', (req, res) => {
    res.render('tool');  // This will render exchangeRateAlert.ejs from the views folder
});

// Route to render the contact page
app.get("/contact", (req, res) => {
    res.render("contact");
});





app.use((req, res) => {
    res.status(404).render('404', { url: req.originalUrl });
});


async function notifyUsers(message) {
    console.log('Notifying users about exchange rate update...');

    db.query('SELECT email FROM subscribers', async (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return;
        }

        for (const subscriber of results) {
            try {
                console.log(`Sending email to ${subscriber.email}`);
                const msg = {
                    to: subscriber.email,
                    from: process.env.EMAIL_USER, // Must be a verified sender in SendGrid
                    templateId: process.env.SENDGRID_TEMPLATE_ID, // SendGrid dynamic template ID
                    dynamicTemplateData: {
                        subject: 'BZ-MX Exchange Alert',
                        exchange_rate_message: message,
                        unsubscribe_url: 'https://ex.holdyah.com/'
                    }
                };
                await sgMail.send(msg);
                console.log(`Email sent to ${subscriber.email}`);
            } catch (error) {
                console.error(`Error sending email to ${subscriber.email}:`, error);
            }
        }
    });
}

// Schedule a task to check exchange rates every 12 hours and notify users
setInterval(() => {
    console.log('Checking exchange rate...');

    getExchangeRate((error, rate) => {
        if (error) {
            console.error('Error fetching exchange rate:', error);
            return;
        }

        const message = rate > 0.095 ? 'Good time to visit Mexico! MXN/BZD rate is favorable.' : 'Bad time to shop!';
        console.log(`Exchange rate check complete. Rate: ${rate}. Message: ${message}`);

        // Notify users about the exchange rate status
        notifyUsers(message);
    });
}, 12 * 60 * 60 * 1000); // Every 12 hours

// Start the Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
