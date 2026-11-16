const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Prayer = require('../models/Prayer');
const NewsArticle = require('../models/NewsArticle');
const { protect } = require('../middleware/auth');
const { adminOnly } = require('../middleware/adminMiddleware');
const { notifyUser, broadcastAnnouncement } = require('../utils/notifyUser');
const axios = require('axios');

const NEWS_API_KEY = process.env.NEWS_API_KEY;
const TRUSTED_DOMAINS = 'christianitytoday.com,wng.org,opendoorsusa.org,persecution.com';
const NEWS_QUERIES = [
  'christian+persecution',
  'middle+east+christians',
  'asia+christians',
  'africa+christians',
  'christian+faith',
  'religious+freedom',
];

// All routes require auth + admin role
router.use(protect, adminOnly);

// POST: Admin broadcast announcement to all users
router.post('/announce', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ message: 'Message required' });
    broadcastAnnouncement(req.app, message);
    res.json({ message: 'Announcement sent' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET: All users with search
router.get('/users', async (req, res) => {
  try {
    const { search } = req.query;
    const query = search
      ? {
          $or: [
            { username: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
            { firstName: { $regex: search, $options: 'i' } },
            { lastName: { $regex: search, $options: 'i' } },
          ]
        }
      : {};

    const users = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .limit(100);

    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET: Single user + their prayer posts
router.get('/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });

    const prayers = await Prayer.find({ author: req.params.id })
      .sort({ createdAt: -1 })
      .limit(20);

    res.json({ user, prayers });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH: Change user role
router.patch('/users/:id/role', async (req, res) => {
  try {
    const { role } = req.body;
    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { new: true }
    ).select('-password');
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH: Ban / suspend user
router.patch('/users/:id/ban', async (req, res) => {
  try {
    const { isBanned } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isBanned },
      { new: true }
    ).select('-password');
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE: Delete user and their content
router.delete('/users/:id', async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    await Prayer.deleteMany({ author: req.params.id });
    res.json({ message: 'User and their content deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET: All prayers (admin view)
router.get('/prayers', async (req, res) => {
  try {
    const prayers = await Prayer.find()
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('author', 'firstName lastName username');
    res.json(prayers);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST: Create a new admin prayer (daily/urgent)
router.post('/prayers', async (req, res) => {
  try {
    const { title, verse, reference, content, action, isDaily, isUrgent, category } = req.body;
    const prayer = new Prayer({
      title,
      verse,
      reference,
      text: content,
      content,
      action: action || '',
      category: category || 'Persecution',
      isDaily: isDaily || false,
      isUrgent: isUrgent || false,
      author: req.user.id,
      startDate: new Date(),
      endDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
    });
    await prayer.save();
    res.status(201).json(prayer);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PATCH: Update a prayer (title, content, flags etc.)
router.patch('/prayers/:id', async (req, res) => {
  try {
    const allowed = ['title', 'verse', 'reference', 'content', 'text', 'action', 'category', 'isDaily', 'isUrgent'];
    const update = {};
    allowed.forEach(key => {
      if (req.body[key] !== undefined) {
        update[key] = req.body[key];
        if (key === 'content') update.text = req.body[key];
      }
    });
    const prayer = await Prayer.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!prayer) return res.status(404).json({ message: 'Prayer not found' });
    res.json(prayer);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE: Remove a prayer
router.delete('/prayers/:id', async (req, res) => {
  try {
    await Prayer.findByIdAndDelete(req.params.id);
    res.json({ message: 'Prayer deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── NEWS CURATION ────────────────────────────────────────────────

// GET: Fetch fresh articles from NewsAPI for admin to review
router.get('/news/fetch', async (req, res) => {
  try {
    let allArticles = [];

    // Try trusted domains first
    for (const q of NEWS_QUERIES) {
      try {
        const r = await axios.get(
          `https://newsapi.org/v2/everything?q=${q}&domains=${TRUSTED_DOMAINS}&sortBy=publishedAt&pageSize=10&language=en&apiKey=${NEWS_API_KEY}`
        );
        if (r.data.articles?.length) allArticles.push(...r.data.articles);
      } catch (e) { /* skip failed queries */ }
    }

    // Fallback: broaden if not enough results
    if (allArticles.length < 10) {
      for (const q of NEWS_QUERIES.slice(0, 3)) {
        try {
          const r = await axios.get(
            `https://newsapi.org/v2/everything?q=${q}&sortBy=publishedAt&pageSize=10&language=en&apiKey=${NEWS_API_KEY}`
          );
          if (r.data.articles?.length) allArticles.push(...r.data.articles);
        } catch (e) { /* skip */ }
      }
    }

    // Deduplicate by URL
    const seen = new Set();
    const unique = allArticles.filter(a => {
      if (!a.url || seen.has(a.url)) return false;
      seen.add(a.url);
      return true;
    });

    // Check which URLs are already in DB
    const existingUrls = await NewsArticle.find({}).distinct('url');
    const existingSet = new Set(existingUrls);
    const fresh = unique.filter(a => !existingSet.has(a.url));

    res.json({ articles: fresh, total: fresh.length });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET: All articles in DB (pending/approved/rejected) with optional status filter
router.get('/news', async (req, res) => {
  try {
    const { status } = req.query;
    const query = status ? { status } : {};
    const articles = await NewsArticle.find(query)
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('approvedBy', 'firstName lastName');
    res.json(articles);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST: Save a fetched article to DB as pending
router.post('/news', async (req, res) => {
  try {
    const { title, description, url, urlToImage, sourceName, publishedAt, category } = req.body;
    const existing = await NewsArticle.findOne({ url });
    if (existing) return res.status(409).json({ message: 'Article already saved' });

    const article = await NewsArticle.create({
      title, description, url, urlToImage,
      sourceName, publishedAt, category: category || 'General',
      status: 'pending',
    });
    res.status(201).json(article);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PATCH: Approve or reject an article, optionally add admin note
router.patch('/news/:id', async (req, res) => {
  try {
    const { status, adminNote, category } = req.body;
    const update = {};
    if (status) update.status = status;
    if (adminNote !== undefined) update.adminNote = adminNote;
    if (category) update.category = category;
    if (status === 'approved') {
      update.approvedAt = new Date();
      update.approvedBy = req.user.id;
    }
    const article = await NewsArticle.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!article) return res.status(404).json({ message: 'Article not found' });
    res.json(article);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE: Remove article from DB
router.delete('/news/:id', async (req, res) => {
  try {
    await NewsArticle.findByIdAndDelete(req.params.id);
    res.json({ message: 'Article removed' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;