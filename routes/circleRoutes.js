const express = require('express');
const router = express.Router();
const Circle = require('../models/Circle');
const { protect } = require('../middleware/auth');
const { notifyUser } = require('../utils/notifyUser');

// 1. CREATE a New Circle - PROTECTED
router.post('/create', protect, async (req, res) => {
  try {
    const { name, description, isPublic } = req.body;
    const newCircle = new Circle({
      name,
      description,
      creator: req.user.id,
      members: [req.user.id],
      isPublic: isPublic !== undefined ? isPublic : true
    });
    const savedCircle = await newCircle.save();
    res.status(201).json(savedCircle);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// 2. GET All Circles - PUBLIC
router.get('/all', async (req, res) => {
  try {
    const circles = await Circle.find().sort({ createdAt: -1 });
    res.json(circles);
  } catch (err) {
    res.status(500).json({ message: "Error fetching circles" });
  }
});

// 3. GET Single Circle Details - PROTECTED
router.get('/:circleId', protect, async (req, res) => {
  try {
    const circle = await Circle.findById(req.params.circleId);
    if (!circle) return res.status(404).json({ message: "Circle not found" });
    res.json(circle);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 4. JOIN a circle - PROTECTED
router.post('/join/:circleId', protect, async (req, res) => {
  try {
    const circle = await Circle.findById(req.params.circleId);
    if (!circle) return res.status(404).json({ message: "Circle not found" });
    
    const alreadyMember = circle.members.some(id => id.toString() === req.user.id);
    if (!alreadyMember) {
      circle.members.push(req.user.id);
      await circle.save();

      // Notify circle creator that someone joined
      if (circle.creator && circle.creator.toString() !== req.user.id) {
        await notifyUser(req.app, circle.creator, {
          actorId: req.user.id,
          actorName: req.user.username || 'Someone',
          actionKey: 'notifCircle',
          targetId: circle._id,
        });
      }
    }

    res.json({ message: "Joined successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 5. LEAVE a circle - PROTECTED
router.post('/leave/:circleId', protect, async (req, res) => {
  try {
    const circle = await Circle.findById(req.params.circleId);
    if (!circle) return res.status(404).json({ message: "Circle not found" });
    circle.members = circle.members.filter(id => id.toString() !== req.user.id);
    await circle.save();
    res.json({ message: "Left successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 6. ADD a journal entry to a circle - PROTECTED
router.post('/:id/journal', protect, async (req, res) => {
  try {
    const circle = await Circle.findById(req.params.id);
    if (!circle) return res.status(404).json({ message: 'Circle not found' });
    if (!circle.members.some(id => id.toString() === req.user.id)) {
      return res.status(403).json({ message: 'Not a member of this circle' });
    }
    circle.journals.push({
      text: req.body.text,
      author: req.user.id
    });
    await circle.save();
    res.json(circle);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 7. MARK entry as answered - PROTECTED
router.patch('/:id/journal/:journalId', protect, async (req, res) => {
  try {
    const circle = await Circle.findById(req.params.id);
    if (!circle) return res.status(404).json({ message: 'Circle not found' });
    const journalEntry = circle.journals.id(req.params.journalId);
    if (!journalEntry) return res.status(404).json({ message: 'Journal entry not found' });
    journalEntry.isAnswered = true;
    await circle.save();
    res.json(circle);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;