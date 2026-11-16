const express = require('express');
const mongoose = require('mongoose');

const Notification = require('../models/Notification');

const {
  protect,
} = require('../middleware/auth');

const {
  notificationResponses,
} = require('../utils/notificationResponse');

const router = express.Router();

const validId = (value) =>
  typeof value === 'string' &&
  mongoose.isObjectIdOrHexString(value);

const routeError = (res, error, message) => {
  console.error(message, error.name);

  return res.status(500).json({ message });
};

// Every notification endpoint requires authentication.
router.use(protect);

// GET CURRENT USER'S NOTIFICATIONS
router.get('/', async (req, res) => {
  try {
    const notifications = await Notification.find({
      recipientId: req.user.id,
    })
      .sort({
        createdAt: -1,
        _id: -1,
      })
      .limit(20)
      .lean();

    const responses = await notificationResponses(
      notifications
    );

    return res.json(responses);
  } catch (error) {
    return routeError(
      res,
      error,
      'Could not load notifications.'
    );
  }
});

// GET UNREAD COUNT
router.get('/unread-count', async (req, res) => {
  try {
    const count = await Notification.countDocuments({
      recipientId: req.user.id,
      isRead: false,
    });

    return res.json({ count });
  } catch (error) {
    return routeError(
      res,
      error,
      'Could not load unread notification count.'
    );
  }
});

// MARK ALL OF THE CURRENT USER'S NOTIFICATIONS AS READ
router.patch('/read-all', async (req, res) => {
  try {
    await Notification.updateMany(
      {
        recipientId: req.user.id,
        isRead: false,
      },
      {
        $set: { isRead: true },
      }
    );

    return res.sendStatus(200);
  } catch (error) {
    return routeError(
      res,
      error,
      'Could not mark notifications as read.'
    );
  }
});

// MARK ONE OF THE CURRENT USER'S NOTIFICATIONS AS READ
router.patch('/:id/read', async (req, res) => {
  if (!validId(req.params.id)) {
    return res.status(400).json({
      message: 'A valid notification ID is required.',
    });
  }

  try {
    const result = await Notification.updateOne(
      {
        _id: req.params.id,
        recipientId: req.user.id,
      },
      {
        $set: { isRead: true },
      }
    );

    if (!result.matchedCount) {
      return res.status(404).json({
        message: 'Notification not found.',
      });
    }

    return res.sendStatus(200);
  } catch (error) {
    return routeError(
      res,
      error,
      'Could not mark notification as read.'
    );
  }
});

module.exports = router;