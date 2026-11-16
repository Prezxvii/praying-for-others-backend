const mongoose = require('mongoose');

const newsArticleSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String },
  url: { type: String, required: true, unique: true },
  urlToImage: { type: String },
  sourceName: { type: String },
  category: {
    type: String,
    enum: ['Persecution', 'Middle East', 'Asia', 'Africa', 'Faith Stories', 'Advocacy', 'General'],
    default: 'General'
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  adminNote: { type: String, default: '' },
  publishedAt: { type: Date },
  approvedAt: { type: Date },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('NewsArticle', newsArticleSchema);