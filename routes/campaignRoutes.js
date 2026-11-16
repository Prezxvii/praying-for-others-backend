const express = require('express');
const router = express.Router();
const Campaign = require('../models/Campaign');
const { protect } = require('../middleware/auth');

// GET all active campaigns
router.get('/', async (req, res) => {
  try {
    const campaigns = await Campaign.find({ isActive: true }).sort({ createdAt: -1 });
    res.json(campaigns);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST a new campaign (Restricted to Admin)
router.post('/', protect, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied: Requires admin privileges' });
  }

  const campaign = new Campaign({
    title: req.body.title,
    country: req.body.country,
    description: req.body.description,
    targetOfficial: req.body.targetOfficial,
    templateText: req.body.templateText,
  });

  try {
    const newCampaign = await campaign.save();
    res.status(201).json(newCampaign);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;