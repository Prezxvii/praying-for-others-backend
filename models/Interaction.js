const mongoose = require('mongoose');

const interactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  prayerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Prayer', required: true },
  type: { 
    type: String, 
    enum: ['pray', 'report'], 
    default: 'pray' 
  }
}, { timestamps: true });

// This prevents the same user from praying for the same post twice
interactionSchema.index({ userId: 1, prayerId: 1, type: 1 }, { unique: true });

module.exports = mongoose.model('Interaction', interactionSchema);