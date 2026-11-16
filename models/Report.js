const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  reporterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },

  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Prayer',
    required: true,
  },

  reason: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500,
    default: 'General',
  },

  status: {
    type: String,
    enum: ['pending', 'resolved'],
    default: 'pending',
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

reportSchema.index({
  status: 1,
  createdAt: -1,
});

module.exports = mongoose.model('Report', reportSchema);