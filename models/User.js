const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    maxlength: 80,
  },

  email: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    lowercase: true,
    maxlength: 254,
  },

  password: {
    type: String,
  },

  firstName: {
    type: String,
    trim: true,
    maxlength: 100,
  },

  lastName: {
    type: String,
    trim: true,
    maxlength: 100,
  },

  profileImage: {
    type: String,
    default: null,
  },

  isAnonymous: {
    type: Boolean,
    default: false,
  },

  // Retained for compatibility until their usage is reviewed.
  isAnonymousProfile: {
    type: Boolean,
    default: false,
  },

  prefAnonymous: {
    type: Boolean,
    default: false,
  },

  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user',
  },

  isBanned: {
    type: Boolean,
    default: false,
  },

  privacy: {
    isPrivate: {
      type: Boolean,
      default: false,
    },
    anonDefault: {
      type: Boolean,
      default: false,
    },
    readReceipts: {
      type: Boolean,
      default: true,
    },
  },

  prayedFor: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Prayer',
    },
  ],

  circlesJoined: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Circle',
    },
  ],

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

userSchema.pre('validate', function () {
  if (!this.isModified('password') || this.password == null) {
    return;
  }

  if (
    typeof this.password !== 'string' ||
    this.password.length < 8 ||
    Buffer.byteLength(this.password, 'utf8') > 72
  ) {
    this.invalidate(
      'password',
      'Password must contain at least 8 characters and no more than 72 UTF-8 bytes.'
    );
  }
});

userSchema.pre('save', async function () {
  if (!this.password || !this.isModified('password')) return;

  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  if (
    typeof candidatePassword !== 'string' ||
    !this.password
  ) {
    return false;
  }

  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);