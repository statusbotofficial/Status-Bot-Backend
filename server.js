// backend/server.js
// Express backend for gifts and premium key generation

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const app = express();
const PORT = 3001;

app.use(cors());
app.use(bodyParser.json());

// Simulated in-memory storage
let gifts = [];
let claimed = {};

// Only allow this Discord user to send gifts
const DEVELOPER_ID = '1362553254117904496';

// Simulate /generate command logic
function generateKey(duration, userId) {
    // You can replace this with your actual logic
    const key = uuidv4().replace(/-/g, '').slice(0, 16).toUpperCase();
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

// Get gifts for a user
app.get('/api/gifts', (req, res) => {
    const userId = req.query.userId;
    // Gifts are visible to all users until claimed
    const userGifts = gifts.filter(g => !claimed[g.id]?.includes(userId));
    res.json(userGifts);
});

// Developer sends a trial gift to all users
app.post('/api/gifts/send', (req, res) => {
    const { userId, duration } = req.body;
    if (userId !== DEVELOPER_ID) return res.status(403).json({ error: 'Forbidden' });
    // Remove any previous unclaimed gifts of same type sent by developer
    gifts = gifts.filter(g => !(g.title === `Free Premium Trial (${duration})` && g.sent_by === userId));
    // Add a new gift visible to all users until claimed
    const id = uuidv4();
    gifts.push({
        id,
        title: `Free Premium Trial (${duration})`,
        desc: `Claim your free premium trial for ${duration}.`,
        duration,
        sent_by: userId,
        created_at: new Date().toISOString()
    });
    res.json({ success: true });
});

// Claim a gift, generate a premium key
app.post('/api/gifts/claim', (req, res) => {
    const { userId, giftId } = req.body;
    const gift = gifts.find(g => g.id === giftId);
    if (!gift) return res.status(404).json({ error: 'Gift not found' });
    if (!claimed[giftId]) claimed[giftId] = [];
    if (claimed[giftId].includes(userId)) return res.status(400).json({ error: 'Already claimed' });
    claimed[giftId].push(userId);
    const keyData = generateKey(gift.duration, userId);
    res.json({ key: keyData.key, expires_at: keyData.expires_at });
});

app.listen(PORT, () => {
    console.log(`Backend running on http://localhost:${PORT}`);
});
