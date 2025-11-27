const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const app = express();
const PORT = 3001;
const axios = require('axios');

const DEVELOPER_ID = "1362553254117904496"; 

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/statusbot_db';

mongoose.connect(MONGO_URI)
    .then(() => {
        console.log('Successfully connected to MongoDB!');
    })
    .catch((err) => {
        console.error('MongoDB connection error:', err);
    });

const notificationSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    type: { type: String, required: true },
    message: { type: String, required: true },
    author: { type: String, required: true },
    timestamp: { type: Number, default: Date.now },
});

const Notification = mongoose.model('Notification', notificationSchema);

const giftsSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    gifts: { type: Object, default: {} }
});

const Gifts = mongoose.model('Gifts', giftsSchema);

const siteWideGiftSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true }, 
    active: { type: Boolean, default: false },
    claimedUsers: { type: [String], default: [] }
});

const SiteWideGift = mongoose.model('SiteWideGift', siteWideGiftSchema);

app.use(cors());
app.use(bodyParser.json());

app.get('/api/notifications', async (req, res) => {
    try {
        const notifications = await Notification.find({})
            .sort({ timestamp: -1 })
            .limit(500); 
        
        res.json(notifications);

    } catch (err) {
        console.error("Error fetching notifications from DB:", err);
        res.status(500).send("Error fetching notifications.");
    }
});

app.post('/api/notifications/new-announcement', async (req, res) => {
    const { message, type, author, developerId } = req.body;

    if (developerId !== DEVELOPER_ID) {
        return res.status(403).json({ success: false, error: 'Forbidden: Invalid developer ID.' });
    }

    if (!message || !type || !author) {
        return res.status(400).send("Missing required fields: message, type, or author.");
    }

    try {
        const newNotification = new Notification({
            id: uuidv4(),
            message,
            type,
            author,
            timestamp: Date.now() 
        });

        await newNotification.save();
        
        res.json({ success: true, notification: newNotification });

    } catch (err) {
        console.error("Error saving new announcement to DB:", err);
        res.status(500).send("Error saving announcement.");
    }
});

app.post('/api/notifications/delete-last', async (req, res) => {
    const { developerId } = req.body;
    
    if (developerId !== DEVELOPER_ID) {
        return res.status(403).json({ success: false, error: 'Forbidden.' });
    }

    try {
        const lastAnnouncement = await Notification.findOne({ type: 'announcement' })
            .sort({ timestamp: -1 });

        if (!lastAnnouncement) {
            return res.status(404).json({ success: false, error: 'No announcements found to remove.' });
        }

        await Notification.deleteOne({ id: lastAnnouncement.id });
        
        return res.json({ success: true, message: `Removed announcement: "${lastAnnouncement.message}"` });

    } catch (err) {
        console.error("Error deleting last announcement from DB:", err);
        return res.status(500).json({ success: false, error: 'Error deleting announcement.' });
    }
});

app.post('/api/trials/set-global', async (req, res) => {
    const { developerId } = req.body;

    if (developerId !== DEVELOPER_ID) {
        return res.status(403).json({ success: false, error: 'Forbidden.' });
    }

    try {
        const siteWideGift = await SiteWideGift.findOneAndUpdate(
            { key: 'siteWideTrial' },
            { $set: { active: true } },
            { upsert: true, new: true }
        );

        const newNotification = new Notification({
            id: uuidv4(),
            type: 'trial',
            message: '🎉 A site-wide free trial has been activated!',
            author: 'Developer',
            timestamp: Date.now() 
        });
        await newNotification.save();

        res.json({ success: true, message: 'Site-wide free trial activated.' });

    } catch (e) {
        console.error('Error activating site-wide trial:', e);
        res.status(500).json({ success: false, error: 'Error activating site-wide trial.' });
    }
});

app.post('/api/trials/clear-global', async (req, res) => {
    const { developerId } = req.body;

    if (developerId !== DEVELOPER_ID) {
        return res.status(403).json({ success: false, error: 'Forbidden.' });
    }

    try {
        await SiteWideGift.findOneAndUpdate(
            { key: 'siteWideTrial' },
            { $set: { active: false } },
            { new: true }
        );

        res.json({ success: true, message: 'Site-wide free trial ended.' });

    } catch (e) {
        console.error('Error clearing site-wide trial:', e);
        res.status(500).json({ success: false, error: 'Error clearing site-wide trial.' });
    }
});

app.get('/api/trials/global-status', async (req, res) => {
    try {
        const status = await SiteWideGift.findOne({ key: 'siteWideTrial' });
        res.json({ active: status ? status.active : false });
    } catch (e) {
        console.error('Error fetching global trial status:', e);
        res.status(500).json({ success: false, error: 'Error fetching global trial status.' });
    }
});

app.get('/api/gifts/:userId', async (req, res) => {
    const userId = req.params.userId;
    try {
        const userGifts = await Gifts.findOne({ userId: userId });
        res.json(userGifts ? userGifts.gifts : {});
    } catch (e) {
        console.error('Error fetching user gifts:', e);
        res.status(500).json({ success: false, error: 'Error fetching user gifts.' });
    }
});

app.post('/api/gifts/claim', async (req, res) => {
    const { userId, giftKey, developerId } = req.body;

    if (developerId !== DEVELOPER_ID) {
        return res.status(403).json({ success: false, error: 'Forbidden.' });
    }

    try {
        const userDoc = await Gifts.findOneAndUpdate(
            { userId: userId },
            { $set: { [`gifts.${giftKey}`]: true } },
            { upsert: true, new: true }
        );

        res.json({ success: true, message: `${giftKey} claimed for user ${userId}.` });
    } catch (e) {
        console.error('Error claiming gift:', e);
        res.status(500).json({ success: false, error: 'Error claiming gift.' });
    }
});

app.post('/api/gifts/claim-all', async (req, res) => {
    const { userId } = req.body;

    try {
        const trialStatus = await SiteWideGift.findOne({ key: 'siteWideTrial' });
        
        if (!trialStatus || !trialStatus.active) {
            return res.status(403).json({ success: false, error: 'Site-wide free trial is not active.' });
        }

        if (trialStatus.claimedUsers.includes(userId)) {
            return res.status(409).json({ success: false, error: 'User has already claimed the site-wide trial gift.' });
        }

        await SiteWideGift.findOneAndUpdate(
            { key: 'siteWideTrial' },
            { $push: { claimedUsers: userId } },
            { new: true }
        );

        const userDoc = await Gifts.findOneAndUpdate(
            { userId: userId },
            { $set: { 
                'gifts.trial_gift_1': true,
                'gifts.trial_gift_2': true 
            } },
            { upsert: true, new: true }
        );

        res.json({ success: true, message: 'All free trial gifts claimed!' });
    } catch (e) {
        console.error('Error claiming all gifts:', e);
        res.status(500).json({ success: false, error: 'Error claiming all gifts.' });
    }
});

app.post('/api/gifts/clear-user', async (req, res) => {
    const { userId, developerId } = req.body;

    if (developerId !== DEVELOPER_ID) {
        return res.status(403).json({ success: false, error: 'Forbidden.' });
    }

    try {
        await Gifts.deleteOne({ userId: userId });
        res.json({ success: true, message: `Gifts cleared for user ${userId}.` });
    } catch (e) {
        console.error('Error clearing user gifts:', e);
        res.status(500).json({ success: false, error: 'Error clearing user gifts.' });
    }
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
