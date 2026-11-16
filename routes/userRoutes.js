const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const User = require('../models/User');
const Prayer = require('../models/Prayer');
const Circle = require('../models/Circle');
const { protect } = require('../middleware/auth');

const router = express.Router();

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isObjectBody = (body) =>
  body !== null &&
  typeof body === 'object' &&
  !Array.isArray(body);

const publicUser = (user) => ({
  id: user._id.toString(),
  username: user.username,
  firstName: user.firstName || '',
  lastName: user.lastName || '',
  role: user.role,
  profileImage: user.profileImage || null,
  isAnonymous: Boolean(user.isAnonymous),
});

const signToken = (user, expiresIn = '7d') =>
  jwt.sign(
    { id: user._id.toString(), role: user.role },
    process.env.JWT_SECRET,
    {
      algorithm: 'HS256',
      expiresIn,
    }
  );

const handleRouteError = (res, error, fallback) => {
  if (error.code === 11000) {
    return res.status(409).json({
      message: 'Username or email is already in use.',
    });
  }

  if (error.name === 'ValidationError') {
    return res.status(400).json({
      message: 'Please check the submitted account details.',
    });
  }

  console.error(fallback, error.name);

  return res.status(500).json({
    message: fallback,
  });
};

// REGISTER
router.post('/register', async (req, res) => {
  if (!isObjectBody(req.body)) {
    return res.status(400).json({
      message: 'A valid request body is required.',
    });
  }

  if (
    Object.prototype.hasOwnProperty.call(req.body, 'role') &&
    req.body.role !== 'user'
  ) {
    return res.status(400).json({
      message: 'Account roles cannot be assigned during registration.',
    });
  }

  const {
    username,
    email,
    password,
    firstName,
    lastName,
    isAnonymous = false,
  } = req.body;

  if (
    typeof username !== 'string' ||
    typeof email !== 'string' ||
    typeof password !== 'string' ||
    typeof isAnonymous !== 'boolean'
  ) {
    return res.status(400).json({
      message: 'Username, email, password, and anonymity settings are invalid.',
    });
  }

  const normalizedUsername = username.trim().toLowerCase();
  const normalizedEmail = email.trim().toLowerCase();

  if (
    normalizedUsername.length < 3 ||
    normalizedUsername.length > 80 ||
    /\s/.test(normalizedUsername)
  ) {
    return res.status(400).json({
      message: 'Username must contain 3–80 characters with no spaces.',
    });
  }

  if (
    normalizedEmail.length > 254 ||
    !emailPattern.test(normalizedEmail)
  ) {
    return res.status(400).json({
      message: 'Enter a valid email address.',
    });
  }

  if (
    password.length < 8 ||
    Buffer.byteLength(password, 'utf8') > 72
  ) {
    return res.status(400).json({
      message: 'Password must contain at least 8 characters and no more than 72 UTF-8 bytes.',
    });
  }

  if (
    !isAnonymous &&
    (
      typeof firstName !== 'string' ||
      typeof lastName !== 'string' ||
      firstName.trim().length < 2 ||
      lastName.trim().length < 2 ||
      firstName.trim().length > 100 ||
      lastName.trim().length > 100
    )
  ) {
    return res.status(400).json({
      message: 'First and last names must each contain 2–100 characters.',
    });
  }

  try {
    const existing = await User.exists({
      $or: [
        { email: normalizedEmail },
        { username: normalizedUsername },
      ],
    });

    if (existing) {
      return res.status(409).json({
        message: 'Username or email is already in use.',
      });
    }

    const user = await User.create({
      username: normalizedUsername,
      email: normalizedEmail,
      password,
      firstName: isAnonymous ? '' : firstName.trim(),
      lastName: isAnonymous ? '' : lastName.trim(),
      isAnonymous,
      role: 'user',
    });

    return res.status(201).json({
      token: signToken(user),
      user: publicUser(user),
    });
  } catch (error) {
    return handleRouteError(res, error, 'Registration failed.');
  }
});

// LOGIN
router.post('/login', async (req, res) => {
  if (
    !isObjectBody(req.body) ||
    typeof req.body.email !== 'string' ||
    typeof req.body.password !== 'string'
  ) {
    return res.status(400).json({
      message: 'Email and password are required.',
    });
  }

  const email = req.body.email.trim().toLowerCase();
  const password = req.body.password;

  if (
    !emailPattern.test(email) ||
    email.length > 254 ||
    !password ||
    password.length > 1024
  ) {
    return res.status(401).json({
      message: 'Invalid email or password',
    });
  }

  try {
    const user = await User.findOne({ email });

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({
        message: 'Invalid email or password',
      });
    }

    if (user.isBanned) {
      return res.status(403).json({
        message: 'Account suspended',
        code: 'ACCOUNT_SUSPENDED',
      });
    }

    return res.json({
      token: signToken(user),
      user: publicUser(user),
    });
  } catch (error) {
    return handleRouteError(res, error, 'Login failed.');
  }
});

// GUEST ACCOUNT
// A pseudonymous account is not a guarantee of untraceability.
router.post('/anonymous', async (req, res) => {
  try {
    const user = await User.create({
      username: `guest_${crypto.randomBytes(12).toString('hex')}`,
      isAnonymous: true,
      role: 'user',
    });

    return res.status(201).json({
      token: signToken(user, '1d'),
      user: publicUser(user),
    });
  } catch (error) {
    return handleRouteError(res, error, 'Guest account creation failed.');
  }
});

// CURRENT USER
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(401).json({
        message: 'User not found',
        code: 'SESSION_INVALID',
      });
    }

    return res.json({ user: publicUser(user) });
  } catch (error) {
    return handleRouteError(res, error, 'Could not load account.');
  }
});

// PROFILE STATS
router.get('/me/stats', protect, async (req, res) => {
  try {
    const [prayersPosted, circlesJoined, user] = await Promise.all([
      Prayer.countDocuments({ author: req.user.id }),
      Circle.countDocuments({ members: req.user.id }),
      User.findById(req.user.id).select('prayedFor').lean(),
    ]);

    return res.json({
      prayersPosted,
      prayedFor: user?.prayedFor?.length || 0,
      circlesJoined,
    });
  } catch (error) {
    return handleRouteError(res, error, 'Could not load account statistics.');
  }
});

// AVATAR
router.patch('/me/avatar', protect, async (req, res) => {
  const profileImage = req.body?.profileImage;

  if (
    profileImage !== null &&
    (
      typeof profileImage !== 'string' ||
      profileImage.length > 100000
    )
  ) {
    return res.status(400).json({
      message: 'Provide a valid profile image or null.',
    });
  }

  try {
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { profileImage },
      { new: true, runValidators: true }
    ).select('profileImage');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.json({ profileImage: user.profileImage });
  } catch (error) {
    return handleRouteError(res, error, 'Could not update profile image.');
  }
});

// PRIVACY SETTINGS
router.get('/me/privacy', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('privacy')
      .lean();

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.json(user.privacy || {
      isPrivate: false,
      anonDefault: false,
      readReceipts: true,
    });
  } catch (error) {
    return handleRouteError(res, error, 'Could not load privacy settings.');
  }
});

router.patch('/me/privacy', protect, async (req, res) => {
  if (!isObjectBody(req.body)) {
    return res.status(400).json({
      message: 'A valid request body is required.',
    });
  }

  const allowed = ['isPrivate', 'anonDefault', 'readReceipts'];
  const update = {};

  for (const field of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body, field)) {
      if (typeof req.body[field] !== 'boolean') {
        return res.status(400).json({
          message: `${field} must be true or false.`,
        });
      }

      update[`privacy.${field}`] = req.body[field];
    }
  }

  if (!Object.keys(update).length) {
    return res.status(400).json({
      message: 'Provide at least one privacy setting.',
    });
  }

  try {
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: update },
      { new: true, runValidators: true }
    ).select('privacy');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.json({
      message: 'Privacy settings updated',
      privacy: user.privacy,
    });
  } catch (error) {
    return handleRouteError(res, error, 'Could not update privacy settings.');
  }
});

// Not implemented: do not falsely claim that an email was delivered.
router.post('/request-password-reset', (req, res) => {
  return res.status(501).json({
    message: 'Password recovery is not available yet.',
    code: 'FEATURE_NOT_IMPLEMENTED',
  });
});

// Not implemented: do not acknowledge a job that is never queued.
router.post('/me/request-data-export', protect, (req, res) => {
  return res.status(501).json({
    message: 'Account data export is not available yet.',
    code: 'FEATURE_NOT_IMPLEMENTED',
  });
});

// Existing deletion scope is preserved.
// Related messages, memberships, and other content need a separate policy.
router.delete('/me', protect, async (req, res) => {
  try {
    await Prayer.deleteMany({ author: req.user.id });
    const deleted = await User.findByIdAndDelete(req.user.id);

    if (!deleted) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.json({
      message: 'Account and authored prayer posts deleted.',
    });
  } catch (error) {
    return handleRouteError(res, error, 'Account deletion failed.');
  }
});

module.exports = router;