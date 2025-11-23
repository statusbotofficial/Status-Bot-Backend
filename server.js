const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 3001;

// --- New Developer Action Logging Function ---
function saveDeveloperAction({ action, initiatedBy, targetId, message, duration }) {
    const filePath = path.join(__dirname, '..', 'developer_actions.json');
    let actions = [];
    if (fs.existsSync(filePath)) {
        try {
            // Read from the new developer_actions.json file
            actions = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (e) {
            actions = [];
        }
    }
    actions.unshift({
        action, // e.g., 'sent_generic_notification', 'sent_trial_gift'
        initiatedBy,
        targetId, // Can be null (for generic) or a user ID
        message, // Optional message for generic notifications
        duration, // Optional duration for trial gifts
        timestamp: new Date().toISOString()
    });
    fs.writeFileSync(filePath, JSON.stringify(actions, null, 4));
}

app.use(cors());
app.use(bodyParser.json());

let gifts = [];
let claimed = {};

const DEVELOPER_ID = '1362553254117904496';

function generateKey(duration, userId) {
    const hex = uuidv4().replace(/-/g, '').slice(0, 10).toUpperCase();
    const key = `SB-PREM-${hex}`;
    const now = new Date();
    let expiresAt = null;
  if (duration === '1 day') expiresAt = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);
  else if (duration === '3 days') expiresAt = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  else if (duration === '7 days') expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  else if (duration === '1 month') expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    return {
    key,
    generated_by: userId,
    used: false,
    scope: 'user',
    created_at: now.toISOString(),
    expires_at: expiresAt ? expiresAt.toISOString() : null
    };
}

function savePremiumKey(keyData, userId) {
  const filePath = path.join(__dirname, '..', 'premium_keys.json');
  let data = {};
  if (fs.existsSync(filePath)) {
    try {
      data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      data = {};
    }
  }
  data[keyData.key] = {
    generated_by: userId,
    used: true,
    scope: keyData.scope,
    created_at: keyData.created_at,
    expires_at: keyData.expires_at,
    redeemed_by: userId,
    redeemed_at: new Date().toISOString()
  };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 4));
}

app.get('/api/gifts', (req, res) => {
  const userId = req.query.userId;
  const userGifts = gifts.filter(g => !claimed[g.id]?.includes(userId));
  res.json(userGifts);
});

// Modified /api/gifts/send to include the new action log
app.post('/api/gifts/send', (req, res) => {
    const { userId, duration } = req.body;
    if (userId !== DEVELOPER_ID) return res.status(403).json({ error: 'Forbidden' });
    gifts = gifts.filter(g => !(g.title === `Free Premium Trial (${duration})` && g.sent_by === userId));
    const id = uuidv4();
    gifts.push({
        id,
        title: `Free Premium Trial (${duration})`,
        desc: `Claim your free premium trial for ${duration}.`,
        duration,
        sent_by: userId,
        created_at: new Date().toISOString()
    });

    // Log the developer action: Sent Trial Gift
    saveDeveloperAction({
        action: 'sent_trial_gift',
        initiatedBy: userId,
        targetId: userId, // Assuming the developer is sending the trial to themselves for testing
        duration: duration
    });

    res.json({ success: true });
});

app.post('/api/gifts/claim', async (req, res) => {
    const { userId, giftId } = req.body;
    const gift = gifts.find(g => g.id === giftId);
    if (!gift) return res.status(404).json({ error: 'Gift not found' });
    if (!claimed[giftId]) claimed[giftId] = [];
    if (claimed[giftId].includes(userId)) return res.status(400).json({ error: 'Already claimed' });
    claimed[giftId].push(userId);
    const keyData = generateKey(gift.duration, userId);
    savePremiumKey(keyData, userId);
    // Removed: saveNotification({ userId: userId, duration: gift.duration });
    res.json({ key: keyData.key, expires_at: keyData.expires_at });
});

// New endpoint for generic developer notification logging
app.post('/api/dev/notify', (req, res) => {
    const { userId, message } = req.body;
    if (userId !== DEVELOPER_ID) return res.status(403).json({ error: 'Forbidden' });

    // Save the action log
    saveDeveloperAction({
        action: 'sent_generic_notification',
        initiatedBy: userId,
        targetId: null,
        message: message || 'Developer sent a generic notification.'
    });

    res.json({ success: true, message: 'Developer notification sent and logged.' });
});

app.listen(PORT, () => {
    console.log(`Backend running on http://localhost:${PORT}`);
});
