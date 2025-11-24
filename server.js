const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 3001;
const axios = require('axios');

// --- Configuration ---
const NOTIFICATIONS_FILE = path.join(__dirname, '..', 'notifications.json');
const GIFTS_FILE = path.join(__dirname, '..', 'gifts.json');
const DEVELOPER_ID = "1362553254117904496"; 
// NEW: File for the single site-wide gift (for 'all'/'everyone')
const SITE_WIDE_GIFT_FILE = path.join(__dirname, '..', 'site_wide_gift.json'); 
// ---------------------

// Middleware
app.use(cors());
app.use(bodyParser.json());

// --- Helper Functions for Data Persistence ---

function loadFile(filePath) {
    if (fs.existsSync(filePath)) {
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (e) {
            console.error(`Error reading ${filePath}:`, e);
            return {};
        }
    }
    // For files that are meant to hold arrays (like notifications), return an array
    if (filePath.endsWith('notifications.json')) return [];
    // Otherwise, return an object (for gifts and site_wide_gift)
    return {};
}

function saveFile(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error(`Error writing to ${filePath}:`, e);
    }
}

// Notification Management 
function saveNotification({ userId, duration, type = 'claim', message = null }) {
    const notifications = loadFile(NOTIFICATIONS_FILE);
    const newNotification = {
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        userId,
        duration,
        type,
        message
    };
    notifications.unshift(newNotification); // Add to the start
    saveFile(NOTIFICATIONS_FILE, notifications.slice(0, 50)); // Keep max 50
}

function saveSiteAnnouncement(message) {
    saveNotification({
        userId: DEVELOPER_ID,
        duration: null,
        type: 'announcement',
        message: message
    });
}

// --- Gift Management Helper Functions ---

function loadGifts() {
    return loadFile(GIFTS_FILE);
}

function saveTrialGift({ userId, code, duration, senderId }) {
    const gifts = loadGifts();
    
    if (!gifts[userId]) {
        gifts[userId] = [];
    }

    const newGift = {
        id: uuidv4(),
        code: code,
        duration: duration,
        generated_at: new Date().toISOString(),
        redeemed: false,
        type: 'trial',
        senderId: senderId
    };
    
    gifts[userId].push(newGift);
    saveFile(GIFTS_FILE, gifts);
    return newGift;
}

// --- Trial Code Logic (JavaScript implementation of Python logic) ---
const TRIAL_CODE_MAP = {
    "1D": ["COOKIE", "PAPER", "STATUS", "PLANE", "BRICK", "CLOUD", "STONE", "RIVER", "METAL", "LEAF"],
    "3D": ["TOWER", "LIGHT", "OCEAN", "TRAIN", "CABLE", "GLASS", "FIELD", "STORM", "BRIDGE", "FLAME"],
    "7D": ["CASTLE", "ROCKET", "SIGNAL", "CIRCLE", "TRACK", "WOODS", "SHELL", "CRANE", "BLADE", "HORSE"],
    "14D": ["ENGINE", "SWORD", "VALLEY", "DESERT", "STATION", "BEACON", "MINER", "SPHERE", "LADDER", "CROWN"],
    "1M": ["GALAXY", "SYSTEM", "PORTAL", "TEMPLE", "CIRCUIT", "ARMOR", "PYRAMID", "FUSION", "ORBIT", "LEGEND"]
};

// Function to generate a random 4-part trial code: SB-TRIAL-{DURATION}-{SECRET}
function generateTrialCode(duration) {
    if (!TRIAL_CODE_MAP[duration]) {
        return null;
    }
    const secrets = TRIAL_CODE_MAP[duration];
    const secret = secrets[Math.floor(Math.random() * secrets.length)];
    // Full format: SB-TRIAL-{DURATION}-{SECRET}
    return `SB-TRIAL-${duration}-${secret}`;
}

// --- Site-Wide Gift Logic ---
function saveSiteWideGift({ code, duration, senderId }) {
    const giftData = {
        code,
        duration,
        senderId,
        generated_at: new Date().toISOString()
    };
    saveFile(SITE_WIDE_GIFT_FILE, giftData);
    return giftData;
}

function loadSiteWideGift() {
    return loadFile(SITE_WIDE_GIFT_FILE);
}

// --- API Endpoints ---

// Existing endpoint for retrieving notifications
app.get('/api/notifications', (req, res) => {
    const notifications = loadFile(NOTIFICATIONS_FILE);
    res.json(notifications);
});

// Existing endpoint for site announcements
app.post('/api/notifications/announce', (req, res) => {
    const { userId, message } = req.body;
    if (userId !== DEVELOPER_ID) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    
    if (!message || message.length < 5) {
        return res.status(400).json({ error: 'Notification message is too short.' });
    }
    
    saveSiteAnnouncement(message);
    res.json({ success: true, message: 'Announcement sent successfully.' });
});

// --- NEW API endpoint for sending Trial Membership ---
app.post('/api/trials/send', (req, res) => {
    const { developerId, targetUserId, duration } = req.body;

    if (developerId !== DEVELOPER_ID) {
        return res.status(403).json({ error: 'Forbidden. Only the authorized developer can send trials.' });
    }
    
    const validDurations = Object.keys(TRIAL_CODE_MAP);
    if (!validDurations.includes(duration)) {
        return res.status(400).json({ error: 'Invalid trial duration.' });
    }

    const trialCode = generateTrialCode(duration);

    if (targetUserId.toLowerCase() === 'all' || targetUserId.toLowerCase() === 'everyone') {
        // 1. Save the single, current site-wide gift (overwrites any previous one)
        const gift = saveSiteWideGift({ code: trialCode, duration, senderId: developerId });

        // 2. Log the trial as a site announcement (to satisfy notification requirement)
        saveSiteAnnouncement(`🎉 A **${duration}** trial has been distributed site-wide! Check your Gifts tab to claim your key: **${gift.code}**`);
        
        console.log(`[TRIAL] Site-wide trial sent: ${duration}. Code: ${trialCode}`);
        return res.json({ success: true, target: 'ALL USERS', duration, code: trialCode, message: 'Site-wide trial announced and gift generated.' });
        
    } else if (targetUserId.match(/^\d{16,20}$/)) {
        // Single user ID target
        const gift = saveTrialGift({ userId: targetUserId, code: trialCode, duration, senderId: developerId });
        
        // Log to console
        console.log(`[TRIAL] Single user trial sent: ${duration} to ${targetUserId}. Code: ${trialCode}`);
        return res.json({ success: true, target: targetUserId, duration, code: trialCode, message: 'Trial gift sent to user.' });
    } else {
        return res.status(400).json({ error: 'Invalid targetUserId. Must be a Discord ID or "all"/"everyone".' });
    }
});
// -------------------------------------------------------------------

// --- NEW API endpoint for fetching user gifts ---
app.get('/api/gifts/:userId', (req, res) => {
    const { userId } = req.params;
    const gifts = loadGifts();
    const siteWideGift = loadSiteWideGift();
    
    let userGifts = gifts[userId] || [];
    
    if (siteWideGift && siteWideGift.code) {
        // Create a unique temporary gift object for the user to see, showing the site-wide code.
        // The front-end is responsible for handling the redemption state.
        const siteWideGiftEntry = {
            id: 'SITE_WIDE_' + siteWideGift.code,
            code: siteWideGift.code,
            duration: siteWideGift.duration,
            generated_at: siteWideGift.generated_at,
            redeemed: false, 
            type: 'site_wide_trial',
            senderId: siteWideGift.senderId
        };
        // Add the site-wide gift to the list. Filter out exact duplicates if the user already has this specific code as a private gift.
        if (!userGifts.some(g => g.code === siteWideGiftEntry.code)) {
            userGifts.unshift(siteWideGiftEntry); 
        }
    }
    
    res.json(userGifts); 
});
// -------------------------------------------------------------------

// --- NEW API endpoint for redeeming a gift (simulated) ---
app.post('/api/gifts/redeem', (req, res) => {
    const { userId, code } = req.body;
    
    // 1. Check if it's a site-wide code
    const siteWideGift = loadSiteWideGift();
    if (siteWideGift.code === code) {
        // The core logic for redeeming site-wide codes would happen here (e.g., granting premium)
        
        // Create a notification for the trial claim (to satisfy the notification requirement)
        saveNotification({
            userId: userId,
            duration: siteWideGift.duration,
            type: 'claim',
            message: `User <@${userId}> claimed a site-wide **${siteWideGift.duration}** trial.`
        });
        
        return res.json({ success: true, message: `Successfully claimed site-wide ${siteWideGift.duration} trial!` });
    }
    
    // 2. Check if it's a private gift
    const gifts = loadGifts();
    if (gifts[userId]) {
        const giftIndex = gifts[userId].findIndex(g => g.code === code);
        if (giftIndex !== -1 && !gifts[userId][giftIndex].redeemed) {
            // Mark as redeemed
            gifts[userId][giftIndex].redeemed = true;
            saveFile(GIFTS_FILE, gifts);
            
            // Create a notification for the trial claim
            saveNotification({
                userId: userId,
                duration: gifts[userId][giftIndex].duration,
                type: 'claim',
                message: `User <@${userId}> claimed a **${gifts[userId][giftIndex].duration}** trial from a private gift.`
            });
            
            return res.json({ success: true, message: `Successfully claimed private ${gifts[userId][giftIndex].duration} trial!` });
        }
    }

    return res.status(404).json({ success: false, message: 'Gift code not found or already redeemed.' });
});


app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
});
