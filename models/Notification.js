const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  recipientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },

  actorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },

  actorName: {
    type: String,
    required: true,
    trim: true,
  },

  isActorAnonymous: {
    type: Boolean,
    default: false,
  },

  actionKey: {
    type: String,
    required: true,
  },

  targetId: {
    type: mongoose.Schema.Types.ObjectId,
  },

  isRead: {
    type: Boolean,
    default: false,
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

notificationSchema.index({
  recipientId: 1,
  createdAt: -1,
});

notificationSchema.index({
  recipientId: 1,
  isRead: 1,
});

module.exports = mongoose.model(
  'Notification',
  notificationSchema
);