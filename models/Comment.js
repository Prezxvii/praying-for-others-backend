const mongoose = require('mongoose');

const CommentSchema = new mongoose.Schema({
  prayerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Prayer',
    required: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  text: {
    type: String,
    required: true,
    maxlength: 310,
  },
  replyTo: {
    type: String,
    default: null,
  },
  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
}, { timestamps: true });

module.exports = mongoose.model('Comment', CommentSchema);