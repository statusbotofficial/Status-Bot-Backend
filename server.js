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
            return (filePath.endsWith('notifications.json')) ? [] : {};
        }
    }
    return (filePath.endsWith('notifications.json')) ? [] : {};
}

function saveFile(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error(`Error writing ${filePath}:`, e);
    }
}

function saveNotification({ userId, duration, type, message }) {
    const notifications = loadFile(NOTIFICATIONS_FILE);
    
    notifications.push({
        timestamp: new Date().toISOString(),
        userId: userId,
        duration: duration,
        type: type || 'claim',
        message: message
    });
    saveFile(NOTIFICATIONS_FILE, notifications.slice(-100));
}

function saveSiteAnnouncement(message) {
    saveNotification({
        userId: DEVELOPER_ID,
        type: 'announcement',
        message: message
    });
}

// --- Trial Code Logic ---
const TRIAL_CODE_MAP = {
    // FIXED: Keys use 'D' or 'M' suffix for consistency
    "1D": ["COOKIE", "PAPER", "STATUS", "PLANE", "BRICK", "CLOUD", "STONE", "RIVER", "METAL", "LEAF"],
    "3D": ["TOWER", "LIGHT", "OCEAN", "TRAIN", "CABLE", "GLASS", "FIELD", "STORM", "BRIDGE", "FLAME"],
    "7D": ["CASTLE", "ROCKET", "SIGNAL", "CIRCLE", "TRACK", "WOODS", "SHELL", "CRANE", "BLADE", "HORSE"],
    "14D": ["ENGINE", "SWORD", "VALLEY", "DESERT", "STATION", "BEACON", "MINER", "SPHERE", "LADDER", "CROWN"],
    "30D": ["GALAXY", "SYSTEM", "PORTAL", "TEMPLE", "CIRCUIT", "ARMOR", "PYRAMID", "FUSION", "ORBIT", "LEGEND"] 
};

function generateTrialCode(duration) {
    if (!TRIAL_CODE_MAP[duration]) {
        return null;
    }
    const secrets = TRIAL_CODE_MAP[duration];
    const secret = secrets[Math.floor(Math.random() * secrets.length)];
    return `SB-TRIAL-${duration}-${secret}`;
}

// =========================================================================
// --- NEW API endpoint for sending Trial Membership (Gift Creation) ---
// =========================================================================
app.post('/api/trials/send', (req, res) => {
    const { developerId, targetUserId, duration } = req.body; 

    if (developerId !== DEVELOPER_ID) {
        return res.status(403).json({ success: false, error: 'Forbidden. Only the authorized developer can send trials.' });
    }
    
    // 1. Validate Duration
    const validDurations = Object.keys(TRIAL_CODE_MAP); 
    if (!validDurations.includes(duration)) {
        return res.status(400).json({ success: false, error: 'Invalid trial duration.' });
    }

    // 2. Handle Site-Wide Gift (for 'all' or 'everyone')
    if (targetUserId === 'all' || targetUserId === 'everyone') {
        const siteWideGift = loadFile(SITE_WIDE_GIFT_FILE);
        siteWideGift.code = generateTrialCode(duration);
        siteWideGift.duration = duration;
        // Logic to save site-wide key goes here...
        saveFile(SITE_WIDE_GIFT_FILE, siteWideGift);
        saveNotification({
            userId: 'System', 
            type: 'announcement', 
            message: `A new site-wide **${duration}** trial is now available! Claim it now with the code: \`${siteWideGift.code}\``
        });
        return res.json({ success: true, message: `Site-wide trial updated. Code: ${siteWideGift.code}`, code: siteWideGift.code });
    }

    // 3. Handle Private Gift (for specific user ID)
    if (!targetUserId.match(/^\d{16,20}$/)) { 
        return res.status(400).json({ success: false, error: 'Invalid target user ID.' });
    }

    const code = generateTrialCode(duration);
    if (!code) {
        return res.status(500).json({ success: false, error: 'Failed to generate trial code.' });
    }

    const gifts = loadFile(GIFTS_FILE);

    if (!gifts[targetUserId]) {
        gifts[targetUserId] = [];
    }

    // Save the new gift to the user's list
    gifts[targetUserId].push({
        code: code,
        duration: duration,
        redeemed: false,
        sent_at: new Date().toISOString()
    });

    saveFile(GIFTS_FILE, gifts);

    return res.json({ success: true, message: 'Trial sent successfully.', code: code });
});

// =========================================================================
// --- NEW API endpoint for fetching a user's private gifts (Gift Retrieval) ---
// =========================================================================
app.get('/api/gifts/user', (req, res) => {
    // NOTE: Replace this mock user ID with a secure method of getting the logged-in user's ID
    const userId = req.query.userId || DEVELOPER_ID; 

    if (!userId.match(/^\d{16,20}$/)) {
        return res.status(401).json({ success: false, error: 'Authentication required. Invalid userId format.' });
    }

    const gifts = loadFile(GIFTS_FILE);
    
    // Return only the UNREDEEMED gifts
    const userGifts = gifts[userId] || [];
    const unredeemedGifts = userGifts.filter(g => !g.redeemed);
    
    res.json({ success: true, gifts: unredeemedGifts });
});

// --- Existing /api/gifts/claim endpoint (Kept for context) ---
app.post('/api/gifts/claim', async (req, res) => {
    // ... (Existing claim logic)
});

// --- MODIFIED: The GET notifications endpoint now returns all notifications ---
app.get('/api/notifications', (req, res) => {
  const notifications = loadFile(NOTIFICATIONS_FILE);
  notifications.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  res.json(notifications);
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
