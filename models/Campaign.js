const mongoose = require('mongoose');

const CampaignSchema = new mongoose.Schema({
  title: { type: String, required: true },
  country: String,
  description: String, // The "Why" behind the campaign
  targetOfficial: String, // e.g., "Minister of Justice"
  templateText: String, // The pre-written letter content
  isActive: { type: Boolean, default: true },
  externalLink: String, // Link to official advocacy site
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Campaign', CampaignSchema);