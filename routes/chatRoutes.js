const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const { protect } = require('../middleware/auth');

// GET history - PROTECTED
router.get('/history/:circleId', protect, async (req, res) => {
  try {
    const messages = await Message.find({ circle: req.params.circleId })
      .populate('sender', 'username role')
      .sort({ createdAt: -1 })
      .limit(50);

    const formatted = messages.map(msg => ({
      _id: msg._id,
      text: msg.text,
      senderName: msg.senderName || msg.sender?.username,
      senderId: msg.sender?._id,
      senderRole: msg.sender?.role || 'user',
      // Send the raw date string back so frontend can calculate contextual day groups
      createdAt: msg.createdAt, 
    }));

    res.json(formatted);
  } catch (err) {
    console.error("History error:", err);
    res.status(500).json({ message: "Could not load history" });
  }
});

// DELETE a message - PROTECTED
router.delete('/:messageId', protect, async (req, res) => {
  try {
    const message = await Message.findById(req.params.messageId);
    if (!message) return res.status(404).json({ message: "Message not found" });

    if (message.sender.toString() === req.user.id || req.user.isAdmin) {
      await message.deleteOne();
      res.json({ message: "Deleted" });
    } else {
      res.status(403).json({ message: "Unauthorized" });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;