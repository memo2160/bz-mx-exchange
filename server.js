const express = require('express');
const mysql = require('mysql2');
const axios = require('axios');
const nodemailer = require('nodemailer');
const ejs = require('ejs');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');


dotenv.config();
const app = express();
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Database connection
const db = mysql.createConnection({
    host: "",
    user: '',
    password: '',
    database: ''
});


db.connect(err => {
    if (err) throw err;
    console.log('Connected to MySQL');
});


// Create views/index.ejs file if it doesn't exist
const ejsFilePath = path.join(__dirname, 'views', 'index.ejs');
if (!fs.existsSync(ejsFilePath)) {
    fs.writeFileSync(ejsFilePath, `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sales Alert Subscription</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
</head>
<body>
    <div class="container mt-5">
        <h2 class="text-center">Subscribe for Sales Alerts</h2>
        <form id="subscribeForm" class="mt-3">
            <div class="mb-3">
                <label for="email" class="form-label">Email address</label>
                <input type="email" class="form-control" id="email" name="email" required>
            </div>
            <button type="submit" class="btn btn-primary">Subscribe</button>
        </form>
        <div id="successMessage" class="alert alert-success mt-3" style="display: none;">Subscribed successfully!</div>
        
        <!-- Exchange Rate Alert -->
        <div id="exchangeRateMessage" class="alert mt-4 text-center" style="color: <%= exchangeRateMessage.color %>; font-weight: bold;">
            <%= exchangeRateMessage.text %>
        </div>
    </div>
    <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
    <script>
        $(document).ready(function() {
            $('#subscribeForm').submit(function(event) {
                event.preventDefault();
                $.post('/subscribe', { email: $('#email').val() }, function(response) {
                    if (response.success) {
                        $('#successMessage').show().delay(3000).fadeOut();
                        $('#subscribeForm')[0].reset();
                    } else {
                        alert(response.message);
                    }
                });
            });
        });
    </script>
</body>
</html>
    `);
}

// Home Route
app.get('/', async (req, res) => {
    let exchangeRateMessage = '';
    try {
        const response = await axios.get('https://api.exchangerate-api.com/v4/latest/MXN');
        const rate = response.data.rates.BZD;
        if (rate > 0.10) {
            exchangeRateMessage = { text: 'Good time to buy!', color: 'green' };
        } else {
            exchangeRateMessage = { text: 'Bad time to buy.', color: 'red' };
        }
    } catch (error) {
        console.error('Error fetching exchange rate', error);
        exchangeRateMessage = { text: 'Unable to fetch exchange rate.', color: 'gray' };
    }
    res.render('index', { exchangeRateMessage });
});

// Save email to database
app.post('/subscribe', (req, res) => {
    const email = req.body.email;
    if (email) {
        db.query('INSERT INTO subscribers (email) VALUES (?)', [email], (err) => {
            if (err) throw err;
            res.json({ success: true, message: 'Subscribed successfully!' });
        });
    } else {
        res.json({ success: false, message: 'Please enter an email' });
    }
});


app.get('/disclaimer', (req, res) => {
    res.render('disclaimer');
});


// Function to check MXN to BZD rate
async function checkExchangeRate() {
    try {
        const response = await axios.get('https://api.exchangerate-api.com/v4/latest/MXN');
        const rate = response.data.rates.BZD;
        if (rate > 0.10) {
            notifyUsers('Good time to shop! MXN/BZD rate is favorable.');
        }else{
            notifyUsers('Bad time to shop! MXN/BZD rate is not favorable.');
        }
    } catch (error) {
        console.error('Error fetching exchange rate', error);
    }
}

// Send notifications to subscribers
function notifyUsers(message) {
    db.query('SELECT email FROM subscribers', (err, results) => {
        if (err) throw err;
        let transporter = nodemailer.createTransport({
            host: 'mail.privateemail.com',
            port: 587, // or 587
            secure: false, // For port 465, secure connection is enabled
            auth: {
              user: "", // Your Namecheap email address
              pass: "", // Your Namecheap email password
            },
            tls: {
              rejectUnauthorized: false, // Disables certificate validation
            },
          });
        results.forEach(subscriber => {
            let mailOptions = {
                from: "no-reply@holdyah.com",
                to: subscriber.email,
                subject: 'Chetumal Sales Alert',
                text: message
            };
            transporter.sendMail(mailOptions, (error) => {
                if (error) console.error('Error sending email', error);
            });
        });
    });
}

// Schedule checks (every 12 hours)
setInterval(checkExchangeRate, 12 * 60 * 60 * 1000);
//setInterval(checkExchangeRate, 1 * 60 * 1000); // Check every 5 minutes
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));