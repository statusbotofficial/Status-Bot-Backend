const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 3001;
const axios = require('axios');
const nodemailer = require('nodemailer'); // NEW: Include nodemailer for email sending

const NOTIFICATIONS_FILE = path.join(__dirname, '..', 'notifications.json');
const GIFTS_FILE = path.join(__dirname, '..', 'gifts.json');
const DEVELOPER_ID = "1362553254117904496"; 
const SITE_WIDE_GIFT_FILE = path.join(__dirname, '..', 'site_wide_gift.json'); 
const PERSISTENT_ANNOUNCEMENT_FILE = path.join(__dirname, '..', 'persistent_announcement.json'); 

app.use(cors());
app.use(bodyParser.json());


// --- EMAIL CONFIGURATION (IMPORTANT: Replace with your actual credentials) ---
// You MUST set up an email service provider (like SendGrid, Mailgun, or use a dedicated Gmail App Password).
// Using environment variables is highly recommended for security.
const EMAIL_USER = process.env.SMTP_USER || 'your_email_user@example.com'; 
const EMAIL_PASS = process.env.SMTP_PASS || 'your_email_password'; 
const TARGET_EMAIL = 'statusbotofficial@gmail.com'; // Your required destination email

const transporter = nodemailer.createTransport({
    service: 'gmail', // Use 'gmail' or replace with your SMTP host
    auth: {
        user: EMAIL_USER, 
        pass: EMAIL_PASS, 
    }
});

// --- ADDED NEW HELPER FUNCTIONS ---
function loadPersistentAnnouncement() {
    if (fs.existsSync(PERSISTENT_ANNOUNCEMENT_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(PERSISTENT_ANNOUNCEMENT_FILE, 'utf8'));
        } catch (e) {
            console.error('Error reading persistent announcement:', e);
        }
    }
    // Default structure if file doesn't exist
    return { message: null, lastSent: null, isActive: false };
}

function savePersistentAnnouncement(data) {
    fs.writeFileSync(PERSISTENT_ANNOUNCEMENT_FILE, JSON.stringify(data, null, 4), 'utf8');
}

function loadFile(filePath) {
    if (fs.existsSync(filePath)) {
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (e) {
            console.error(`Error reading file ${filePath}:`, e);
            return [];
        }
    }
    return [];
}

function saveFile(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 4), 'utf8');
}

// =========================================================================
// NEW ENDPOINT: Form Submission Handler
// =========================================================================
app.post('/api/forms/submit', async (req, res) => {
    const formData = req.body;
    const { formType, discordUserId, discordName } = formData;
    
    // Basic validation
    if (!formType || !discordUserId || !discordName) {
        return res.status(400).json({ success: false, error: 'Missing required fields: formType, discordUserId, or discordName.' });
    }
    
    let subject = `New Application: [${formType.toUpperCase()}] from ${discordName} (${discordUserId})`;
    
    // Format the email body
    let body = `A new application of type **${formType.toUpperCase()}** has been submitted.\n\n`;
    body += `--- User Details ---\n`;
    body += `Discord Name: ${discordName}\n`;
    body += `Discord User ID: ${discordUserId}\n`;
    body += `\n--- Application Content ---\n`;

    for (const key in formData) {
        // Skip keys already covered in the header
        if (key === 'formType' || key === 'discordUserId' || key === 'discordName') {
            continue;
        }
        // Capitalize key for readability
        const formattedKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
        body += `${formattedKey}: \n${formData[key]}\n\n`;
    }

    // Attempt to send the email
    try {
        await transporter.sendMail({
            from: `"Status Bot Form Submitter" <${EMAIL_USER}>`, // Sender address
            to: TARGET_EMAIL, 
            subject: subject,
            text: body, // Plain text body
        });
        
        console.log(`[FORM SUBMIT] Successfully sent email for ${formType} from ${discordUserId}`);
        return res.json({ success: true, message: 'Application received.' });

    } catch (error) {
        console.error(`[FORM ERROR] Failed to send email for ${formType}:`, error);
        // Respond with success even if email failed, to prevent user spamming on error, 
        // but log the failure for manual check. Alternatively, return 500 status.
        return res.status(500).json({ success: false, error: 'Server error during submission.' });
    }
});
// =========================================================================

// --- Existing Endpoints (Example: /api/notifications) ---

// Your existing /api/notifications GET endpoint
app.get('/api/notifications', (req, res) => {
    // ... existing logic ...
    const notifications = loadFile(NOTIFICATIONS_FILE);
    const persistentData = loadPersistentAnnouncement();
    
    let responseList = notifications;
    if (persistentData.isActive && persistentData.message) {
        // Add persistent announcement at the beginning
        responseList = [{ type: 'announcement', message: persistentData.message, timestamp: persistentData.lastSent || Date.now() }, ...notifications];
    }

    res.json(responseList);
});

// Your existing /api/notifications POST endpoint
app.post('/api/notifications', (req, res) => {
    const { message, developerId, type, durationDays } = req.body;

    if (developerId !== DEVELOPER_ID) {
        return res.status(403).json({ success: false, error: 'Forbidden.' });
    }

    if (!message || !type) {
        return res.status(400).json({ success: false, error: 'Message and type are required.' });
    }

    const notifications = loadFile(NOTIFICATIONS_FILE);
    const newNotification = {
        id: uuidv4(),
        message,
        type,
        timestamp: Date.now(),
        duration: durationDays ? durationDays * 24 * 60 * 60 * 1000 : null,
    };

    if (type === 'announcement') {
        // Handle persistent announcement
        const persistentData = loadPersistentAnnouncement();
        persistentData.isActive = true;
        persistentData.message = message;
        persistentData.lastSent = Date.now();
        savePersistentAnnouncement(persistentData);
        
        // Ensure only one 'announcement' type is in the main list (optional, but good practice)
        for (let i = notifications.length - 1; i >= 0; i--) {
            if (notifications[i].type === 'announcement') {
                notifications.splice(i, 1);
            }
        }
    }

    notifications.push(newNotification);
    saveFile(NOTIFICATIONS_FILE, notifications);
    res.json({ success: true, notification: newNotification });
});

app.delete('/api/notifications/announcement', (req, res) => {
    const { developerId } = req.body;

    if (developerId !== DEVELOPER_ID) {
        return res.status(403).json({ success: false, error: 'Forbidden.' });
    }

    const notifications = loadFile(NOTIFICATIONS_FILE);
    let indexToRemove = -1;

    // Find the last announcement to remove
    for (let i = notifications.length - 1; i >= 0; i--) {
        if (notifications[i].type === 'announcement') {
            indexToRemove = i;
            break;
        }
    }

    if (indexToRemove !== -1) {
        const removed = notifications.splice(indexToRemove, 1);
        saveFile(NOTIFICATIONS_FILE, notifications);
        
        // Also clear the persistent announcement state
        const persistentData = loadPersistentAnnouncement();
        if (persistentData.isActive) {
            persistentData.isActive = false;
            persistentData.message = null;
            savePersistentAnnouncement(persistentData);
            console.log('[DELETE] Cleared persistent announcement.');
        }

        return res.json({ success: true, message: `Removed announcement: "${removed[0].message}"` });
    } else {
        return res.status(404).json({ success: false, error: 'No announcements found to remove.' });
    }
});


app.post('/api/trials/clear-global', (req, res) => {
    const { developerId } = req.body;

    if (developerId !== DEVELOPER_ID) {
        return res.status(403).json({ success: false, error: 'Forbidden.' });
    }

    const resetData = { code: null, duration: null };
    saveFile(SITE_WIDE_GIFT_FILE, resetData);
    res.json({ success: true, message: 'Site-wide gift cleared.' });
});


app.post('/api/gifts', (req, res) => {
    const { developerId, code, durationDays } = req.body;

    if (developerId !== DEVELOPER_ID) {
        return res.status(403).json({ success: false, error: 'Forbidden.' });
    }

    if (!code || !durationDays) {
        return res.status(400).json({ success: false, error: 'Code and durationDays are required.' });
    }

    const gifts = loadFile(GIFTS_FILE);
    const giftDurationMs = durationDays * 24 * 60 * 60 * 1000;
    
    // Check for existing code
    if (gifts.some(gift => gift.code === code)) {
        return res.status(409).json({ success: false, error: 'This code already exists.' });
    }

    const newGift = {
        code,
        duration: giftDurationMs,
        createdAt: Date.now(),
        uses: 0
    };

    gifts.push(newGift);
    saveFile(GIFTS_FILE, gifts);
    res.json({ success: true, gift: newGift });
});

app.get('/api/gifts/:code', (req, res) => {
    const code = req.params.code;
    const gifts = loadFile(GIFTS_FILE);

    const gift = gifts.find(g => g.code === code);

    if (gift) {
        return res.json({ success: true, gift: { code: gift.code, duration: gift.duration, uses: gift.uses } });
    } else {
        return res.status(404).json({ success: false, error: 'Gift code not found.' });
    }
});

app.post('/api/gifts/:code/use', (req, res) => {
    const code = req.params.code;
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ success: false, error: 'userId is required.' });
    }

    const gifts = loadFile(GIFTS_FILE);
    const giftIndex = gifts.findIndex(g => g.code === code);

    if (giftIndex === -1) {
        return res.status(404).json({ success: false, error: 'Gift code not found.' });
    }

    const gift = gifts[giftIndex];

    // Check if the user has already used this code (simple implementation for now)
    // A more robust system would use a separate usage log/table.
    // For simplicity, we'll increment 'uses'
    gift.uses += 1;

    saveFile(GIFTS_FILE, gifts);
    res.json({ success: true, message: 'Gift code usage recorded.', gift: { code: gift.code, uses: gift.uses } });
});

app.post('/api/gifts/site-wide', (req, res) => {
    const { developerId, code, durationDays } = req.body;

    if (developerId !== DEVELOPER_ID) {
        return res.status(403).json({ success: false, error: 'Forbidden.' });
    }

    if (!code || !durationDays) {
        return res.status(400).json({ success: false, error: 'Code and durationDays are required.' });
    }

    const giftDurationMs = durationDays * 24 * 60 * 60 * 1000;
    const data = { code, duration: giftDurationMs };
    saveFile(SITE_WIDE_GIFT_FILE, data);

    res.json({ success: true, message: `Site-wide gift set: ${code} for ${durationDays} days.` });
});

app.get('/api/gifts/site-wide', (req, res) => {
    const data = loadFile(SITE_WIDE_GIFT_FILE);
    if (data && data.code) {
        return res.json({ success: true, code: data.code, duration: data.duration });
    }
    res.json({ success: false, error: 'No active site-wide gift.' });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
