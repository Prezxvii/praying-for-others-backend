const mongoose = require('mongoose');

const CircleSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isPublic: { type: Boolean, default: true },
  
  scheduledMeetings: [{
    title: String,
    dateTime: Date,
    description: String,
    link: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }],
  
  // --- ADDED: Prayer Journal Entries ---
  journals: [{
    text: String,
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    isAnswered: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
  }],
  // -------------------------------------
  
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Circle', CircleSchema);