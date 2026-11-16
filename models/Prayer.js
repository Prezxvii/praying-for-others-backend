const mongoose = require('mongoose');

const prayerSchema = new mongoose.Schema({
  // Core content
  title: {
    type: String,
  },

  text: {
    type: String,
  },

  verse: {
    type: String,
  },

  reference: {
    type: String,
  },

  content: {
    type: String,
  },

  action: {
    type: String,
  },

  // Daily Scripture attribution
  bibleTranslation: {
    type: String,
    trim: true,
    maxlength: 100,
  },

  // Daily publishing
  publishDate: {
    type: String,
    match: /^\d{4}-\d{2}-\d{2}$/,
  },

  publicationStatus: {
    type: String,
    enum: ['draft', 'published'],
    default: 'draft',
  },

  displayOrder: {
    type: Number,
    default: 0,
    min: 0,
    max: 999,
  },

  publishedAt: {
    type: Date,
  },

  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },

  // Categorization
  category: {
    type: String,
    enum: [
      'Persecution',
      'Countries',
      'Advocacy',
      'Healing',
      'Guidance',
      'Thanksgiving',
    ],
  },

  location: {
    type: String,
  },

  // Existing community-prayer scheduling
  startDate: {
    type: Date,
    default: Date.now,
  },

  endDate: {
    type: Date,
    default: () =>
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  },

  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },

  isAnonymous: {
    type: Boolean,
    default: false,
  },

  isUrgent: {
    type: Boolean,
    default: false,
  },

  isDaily: {
    type: Boolean,
    default: false,
  },

  bookmarkedBy: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  ],

  updates: [
    {
      text: {
        type: String,
        required: true,
      },
      type: {
        type: String,
        enum: ['update', 'answered', 'ongoing'],
        default: 'update',
      },
      createdAt: {
        type: Date,
        default: Date.now,
      },
    },
  ],

  prayingCount: {
    type: Number,
    default: 0,
  },

  commentCount: {
    type: Number,
    default: 0,
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },

  editedAt: {
    type: Date,
  },
});

prayerSchema.index({
  isDaily: 1,
  publicationStatus: 1,
  publishDate: 1,
  displayOrder: 1,
});

module.exports = mongoose.model('Prayer', prayerSchema);