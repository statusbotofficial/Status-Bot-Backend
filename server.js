const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 3001;
const axios = require('axios');

const NOTIFICATIONS_FILE = path.join(__dirname, '..', 'notifications.json');
const GIFTS_FILE = path.join(__dirname, '..', 'gifts.json');
const DEVELOPER_ID = "1362553254117904496"; 
const SITE_WIDE_GIFT_FILE = path.join(__dirname, '..', 'site_wide_gift.json'); 
const PERSISTENT_ANNOUNCEMENT_FILE = path.join(__dirname, '..', 'persistent_announcement.json'); // ADDED

app.use(cors());
app.use(bodyParser.json());


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
    saveFile(PERSISTENT_ANNOUNCEMENT_FILE, data);
}
// --- END OF NEW HELPER FUNCTIONS ---


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

// --- MOVED AND FIXED saveNotification FUNCTION ---
// (The first, simpler version was deleted)
function saveNotification({ userId, duration, type, message }) {
    const notifications = loadFile(NOTIFICATIONS_FILE);
    
    notifications.push({
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        userId: userId,
        duration: duration,
        type: type || 'claim',
        message: message
    });
    
    saveFile(NOTIFICATIONS_FILE, notifications.slice(-500)); 
}

function saveSiteAnnouncement(message) {
    saveNotification({
        userId: DEVELOPER_ID,
        type: 'announcement',
        message: message
    });
}

const TRIAL_CODE_MAP = {
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

app.post('/api/trials/send', (req, res) => {
    const { developerId, targetUserId, duration } = req.body; 

    if (developerId !== DEVELOPER_ID) {
        return res.status(403).json({ success: false, error: 'Forbidden. Only the authorized developer can send trials.' });
    }
    
    const validDurations = Object.keys(TRIAL_CODE_MAP); 
    if (!validDurations.includes(duration)) {
        return res.status(400).json({ success: false, error: 'Invalid trial duration.' });
    }

    if (targetUserId === 'all' || targetUserId === 'everyone') {
        const siteWideGift = loadFile(SITE_WIDE_GIFT_FILE);
        siteWideGift.code = generateTrialCode(duration);
        siteWideGift.duration = duration;
        saveFile(SITE_WIDE_GIFT_FILE, siteWideGift);
        saveNotification({
            userId: 'System', 
            type: 'announcement', 
            message: `A new site-wide **${duration}** trial is now available! Claim it now with the code: \`${siteWideGift.code}\``
        });
        return res.json({ success: true, message: `Site-wide trial updated. Code: ${siteWideGift.code}`, code: siteWideGift.code });
    }

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

    gifts[targetUserId].push({
        code: code,
        duration: duration,
        redeemed: false,
        sent_at: new Date().toISOString()
    });

    saveFile(GIFTS_FILE, gifts);

    return res.json({ success: true, message: 'Trial sent successfully.', code: code });
});

app.get('/api/gifts/user', (req, res) => {
    const userId = req.query.userId || DEVELOPER_ID; 

    if (!userId.match(/^\d{16,20}$/)) {
        return res.status(401).json({ success: false, error: 'Authentication required. Invalid userId format.' });
    }

    const gifts = loadFile(GIFTS_FILE);
    
    const userGifts = gifts[userId] || [];
    const unredeemedGifts = userGifts.filter(g => !g.redeemed);
    
    res.json({ success: true, gifts: unredeemedGifts });
});

app.post('/api/gifts/transfer', (req, res) => {
    const { giverId, recipientId, giftCode } = req.body;

    if (!giverId || !recipientId || !giftCode) {
        return res.status(400).json({ success: false, error: 'Missing giverId, recipientId, or giftCode.' });
    }
    if (!recipientId.match(/^\d{16,20}$/)) { 
        return res.status(400).json({ success: false, error: 'Invalid recipient User ID.' });
    }
    if (giverId === recipientId) {
        return res.status(400).json({ success: false, error: 'You cannot gift a code to yourself.' });
    }

    if (!giftCode.startsWith('SB-PREM-') || giftCode.length !== 18) {
        return res.status(400).json({ success: false, error: 'Invalid Premium Code format. Must be 18 characters and start with SB-PREM-.' });
    }

    const gifts = loadFile(GIFTS_FILE);

    const giftToTransfer = {
        code: giftCode,
        duration: "Premium Access",
        redeemed: false,
        sent_at: new Date().toISOString(),
        gifted_by: giverId
    };
    
    if (!gifts[recipientId]) {
        gifts[recipientId] = [];
    }
    
    if (gifts[recipientId].some(g => g.code === giftCode)) {
        return res.status(400).json({ success: false, error: 'This user already has this exact gift code.' });
    }

    gifts[recipientId].push(giftToTransfer);

    saveFile(GIFTS_FILE, gifts);

    console.log(`[GIFT TRANSFER] User ${giverId} sent ${giftToTransfer.code} to ${recipientId}`);
    return res.json({ success: true, message: `Successfully gifted "Premium Access" to user ${recipientId}!`});
});

app.post('/api/gifts/claim', async (req, res) => {
});

app.post('/api/notifications/announce', (req, res) => {
    const { title, message, isPersistent } = req.body; // MODIFIED
    const authorId = DEVELOPER_ID; 

    if (!message || message.length < 5) {
        return res.status(400).json({ success: false, error: 'Notification message is too short.' });
    }
    
    const notifications = loadFile(NOTIFICATIONS_FILE);

    const newNotification = {
            id: uuidv4(), 
            type: 'announcement',
            title: title || 'New Announcement',
            message: message,
            userId: authorId,
            timestamp: new Date().toISOString()
        };

    notifications.push(newNotification);
    saveFile(NOTIFICATIONS_FILE, notifications.slice(-500)); // MODIFIED

    // --- BEGIN MODIFIED LOGIC ---
    if (isPersistent) {
        // If 'isPersistent' is true, save it to our new state file
        savePersistentAnnouncement({
            message: message,
            lastSent: newNotification.timestamp,
            isActive: true
        });
        console.log(`[ANNOUNCEMENT] New *persistent* notification set by ${authorId}`);
    } else {
        // If a *non-persistent* announcement is sent, 
        // we should *clear* any existing persistent one.
        const persistentData = loadPersistentAnnouncement();
        if (persistentData.isActive) {
            persistentData.isActive = false;
            persistentData.message = null;
            savePersistentAnnouncement(persistentData);
            console.log('[ANNOUNCEMENT] Cleared previous persistent notification.');
        }
        console.log(`[ANNOUNCEMENT] New notification sent by ${authorId}: "${newNotification.title}"`);
    }
    // --- END MODIFIED LOGIC ---
    
    return res.json({ success: true, message: 'Announcement sent successfully.' });
});

app.get('/api/notifications', (req, res) => {
  // --- BEGIN NEW REPEATER LOGIC ---
  try {
    const persistentData = loadPersistentAnnouncement();
    const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

    if (persistentData.isActive && persistentData.message) {
        const lastSentTime = persistentData.lastSent ? new Date(persistentData.lastSent).getTime() : 0;
        const now = Date.now();

        // Check if 15 minutes have passed
        if (now - lastSentTime > FIFTEEN_MINUTES_MS) {
            console.log('[HEARTBEAT] Resending persistent announcement.');
            
            // Re-use the logic from your /announce endpoint to post the message
            let notifications = loadFile(NOTIFICATIONS_FILE); // <-- *** MODIFIED: Changed to 'let' ***
            
            // --- *** NEW: Filter out the previous repeating announcement *** ---
            notifications = notifications.filter(n => {
                return !(n.type === 'announcement' && n.message === persistentData.message);
            });
            // --- *** END NEW *** ---

            const newNotification = {
                id: uuidv4(), 
                type: 'announcement',
                title: 'Announcement (Repeating)', // Give it a clear title
                message: persistentData.message,
                userId: DEVELOPER_ID,
                timestamp: new Date().toISOString()
            };
            
            notifications.push(newNotification);
            saveFile(NOTIFICATIONS_FILE, notifications.slice(-500));

            // IMPORTANT: Update the 'lastSent' time in our state file
            persistentData.lastSent = newNotification.timestamp;
            savePersistentAnnouncement(persistentData);
        }
    }
  } catch (e) {
     console.error('Error in persistent announcement check:', e);
  }
  // --- END NEW REPEATER LOGIC ---

  const notifications = loadFile(NOTIFICATIONS_FILE);
  notifications.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  res.json(notifications);
});

// NOTE: The second, duplicate saveNotification function that was here has been moved to the top.

app.post('/api/notifications/delete-last', (req, res) => {
    const { developerId } = req.body;
    
    if (developerId !== DEVELOPER_ID) {
        return res.status(403).json({ success: false, error: 'Forbidden.' });
    }

    let notifications = loadFile(NOTIFICATIONS_FILE);
    
    let indexToRemove = -1;
    for (let i = notifications.length - 1; i >= 0; i--) {
        if (notifications[i].type === 'announcement') {
            indexToRemove = i;
            break;
        }
    }

    if (indexToRemove !== -1) {
        const removed = notifications.splice(indexToRemove, 1);
        saveFile(NOTIFICATIONS_FILE, notifications);
        
        // --- BEGIN MODIFIED LOGIC ---
        // Also clear the persistent announcement state
        const persistentData = loadPersistentAnnouncement();
        if (persistentData.isActive) {
            persistentData.isActive = false;
            persistentData.message = null;
            savePersistentAnnouncement(persistentData);
            console.log('[DELETE] Cleared persistent announcement.');
        }
        // --- END MODIFIED LOGIC ---

        return res.json({ success: true, message: `Removed announcement: "${removed[0].message}"` });
    } else {
        return res.status(4DEN).json({ success: false, error: 'No announcements found to remove.' });
    }
});

app.post('/api/trials/clear-global', (req, res) => {
    const { developerId } = req.body;

    if (developerId !== DEVELOPER_ID) {
        return res.status(403).json({ success: false, error: 'Forbidden.' });
    }

    const resetData = { code: null, duration: null };
    saveFile(SITE_WIDE_GIFT_FILE, resetData);

    return res.json({ success: true, message: 'Global trial has been removed.' });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
