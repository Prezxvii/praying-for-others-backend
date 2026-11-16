const express = require('express');
const mongoose = require('mongoose');

const {
  protect,
  verifyAccessToken,
  AuthError,
} = require('../middleware/auth');

const Prayer = require('../models/Prayer');
const Interaction = require('../models/Interaction');
const Report = require('../models/Report');
const Comment = require('../models/Comment');
const User = require('../models/User');

const {
  prayerResponse,
} = require('../utils/prayerResponse');

const {
  commentResponse,
} = require('../utils/commentResponse');

const {
  notifyUser,
} = require('../utils/notifyUser');

const router = express.Router();

const CATEGORIES = [
  'Persecution',
  'Countries',
  'Advocacy',
  'Healing',
  'Guidance',
  'Thanksgiving',
];

const UPDATE_TYPES = [
  'update',
  'answered',
  'ongoing',
];

const validId = (value) =>
  typeof value === 'string' &&
  mongoose.isObjectIdOrHexString(value);

const routeError = (res, error, message) => {
  console.error(message, error.name);

  return res.status(
    error.name === 'ValidationError' ? 400 : 500
  ).json({ message });
};

// Notification delivery must not turn an otherwise successful
// database operation into an apparent failure.
const notifySafely = async (app, recipientId, payload) => {
  try {
    await notifyUser(app, recipientId, payload);
  } catch (error) {
    console.error(
      'Notification delivery failed:',
      error.name
    );
  }
};

// Public reads allow requests without a token.
// A supplied invalid token is rejected.
const optionalAuth = async (req, res, next) => {
  const authorization = req.headers.authorization;

  if (!authorization) {
    return next();
  }

  if (
    typeof authorization !== 'string' ||
    !/^Bearer\s+\S+$/i.test(authorization)
  ) {
    return res.status(401).json({
      message: 'Not authorized, token failed',
      code: 'SESSION_INVALID',
    });
  }

  try {
    const token = authorization.split(/\s+/)[1];

    req.user = await verifyAccessToken(token);

    return next();
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(error.status).json({
        message: error.message,
        code: error.code,
      });
    }

    return res.status(503).json({
      message: 'Authentication is temporarily unavailable.',
      code: 'AUTH_UNAVAILABLE',
    });
  }
};

const findCommunityPrayer = (id) =>
  Prayer.findOne({
    _id: id,
    isDaily: { $ne: true },
  });

const enrichPrayers = async (prayers, userId) => {
  const viewerId = userId ? String(userId) : null;
  const prayerIds = prayers.map((prayer) => prayer._id);

  const interactions =
    viewerId && prayerIds.length > 0
      ? await Interaction.find({
          userId: viewerId,
          prayerId: { $in: prayerIds },
          type: 'pray',
        })
          .select('prayerId')
          .lean()
      : [];

  const prayedSet = new Set(
    interactions.map((interaction) =>
      interaction.prayerId.toString()
    )
  );

  return prayers.map((prayer) => {
    const isBookmarked = viewerId
      ? (prayer.bookmarkedBy || []).some(
          (id) => id.toString() === viewerId
        )
      : false;

    return prayerResponse(prayer, {
      userId: viewerId,
      hasPrayed: prayedSet.has(prayer._id.toString()),
      isBookmarked,
    });
  });
};

// Return only public update fields.
const updateResponse = (update) => ({
  _id: update._id ? update._id.toString() : null,
  text: update.text || '',
  type: update.type || 'update',
  createdAt: update.createdAt,
});

/*
 * COMMUNITY PRAYER MANAGEMENT
 */

// CREATE COMMUNITY REQUEST
router.post('/', protect, async (req, res) => {
  const {
    title = '',
    text,
    category = 'Persecution',
    isAnonymous = false,
    location = null,
  } = req.body || {};

  if (
    typeof text !== 'string' ||
    !text.trim() ||
    text.trim().length > 10000
  ) {
    return res.status(400).json({
      message: 'Prayer text must contain 1–10000 characters.',
    });
  }

  if (
    typeof title !== 'string' ||
    title.trim().length > 200
  ) {
    return res.status(400).json({
      message: 'Title must contain no more than 200 characters.',
    });
  }

  if (!CATEGORIES.includes(category)) {
    return res.status(400).json({
      message: 'Choose a valid prayer category.',
    });
  }

  if (typeof isAnonymous !== 'boolean') {
    return res.status(400).json({
      message: 'isAnonymous must be true or false.',
    });
  }

  if (
    location !== null &&
    (
      typeof location !== 'string' ||
      location.trim().length > 200
    )
  ) {
    return res.status(400).json({
      message:
        'Location must be text with no more than 200 characters.',
    });
  }

  try {
    const now = new Date();

    const newPrayer = await Prayer.create({
      title: title.trim(),
      text: text.trim(),
      content: text.trim(),
      category,
      author: req.user.id,
      isAnonymous,

      // New anonymous requests do not retain a structured location.
      location:
        !isAnonymous && typeof location === 'string'
          ? location.trim() || null
          : null,

      // Community creation cannot publish daily or urgent content.
      isDaily: false,
      isUrgent: false,

      action: 'Praying',
      startDate: now,
      endDate: new Date(
        now.getTime() + 7 * 24 * 60 * 60 * 1000
      ),
    });

    await newPrayer.populate(
      'author',
      'firstName lastName'
    );

    return res.status(201).json(
      prayerResponse(newPrayer, {
        userId: req.user.id,
        hasPrayed: false,
        isBookmarked: false,
      })
    );
  } catch (error) {
    return routeError(
      res,
      error,
      'Could not create prayer request.'
    );
  }
});

// ACTIVE COMMUNITY FEED
router.get('/today', optionalAuth, async (req, res) => {
  try {
    const now = new Date();

    const prayers = await Prayer.find({
      isDaily: { $ne: true },
      startDate: { $lte: now },
      endDate: { $gte: now },
    })
      .sort({ createdAt: -1 })
      .populate('author', 'firstName lastName');

    return res.json(
      await enrichPrayers(prayers, req.user?.id)
    );
  } catch (error) {
    return routeError(
      res,
      error,
      'Could not load prayer requests.'
    );
  }
});

// ACTIVE URGENT COMMUNITY REQUESTS
router.get('/urgent', optionalAuth, async (req, res) => {
  try {
    const now = new Date();

    const prayers = await Prayer.find({
      isDaily: { $ne: true },
      isUrgent: true,
      startDate: { $lte: now },
      endDate: { $gte: now },
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('author', 'firstName lastName');

    return res.json(
      await enrichPrayers(prayers, req.user?.id)
    );
  } catch (error) {
    return routeError(
      res,
      error,
      'Could not load urgent prayer requests.'
    );
  }
});

/*
 * RETIRED DAILY ENDPOINTS
 *
 * Daily publishing uses /api/daily-content.
 * Completion and saving remain unavailable until implemented.
 */

router.get('/daily', (req, res) => {
  return res.status(410).json({
    message:
      'Daily content has moved to /api/daily-content/today.',
    code: 'DAILY_ENDPOINT_REPLACED',
  });
});

router.post('/daily/complete', protect, (req, res) => {
  return res.status(501).json({
    message:
      'Daily prayer completion tracking is not available yet.',
    code: 'FEATURE_NOT_IMPLEMENTED',
  });
});

router.post('/daily/save', protect, (req, res) => {
  return res.status(501).json({
    message: 'Daily prayer saving is not available yet.',
    code: 'FEATURE_NOT_IMPLEMENTED',
  });
});

/*
 * COMMENTS
 */

// GET COMMENTS WITH PRIVACY-SAFE RESPONSES
router.get(
  '/:id/comments',
  optionalAuth,
  async (req, res) => {
    if (!validId(req.params.id)) {
      return res.status(400).json({
        message: 'Invalid prayer ID.',
      });
    }

    try {
      const prayer = await findCommunityPrayer(req.params.id)
        .select('_id author isAnonymous');

      if (!prayer) {
        return res.status(404).json({
          message: 'Prayer not found.',
        });
      }

      const comments = await Comment.find({
        prayerId: prayer._id,
      })
        .populate(
          'userId',
          'firstName lastName username'
        )
        .sort({
          createdAt: -1,
          _id: -1,
        });

      return res.json(
        comments.map((comment) =>
          commentResponse(
            comment,
            prayer,
            req.user?.id
          )
        )
      );
    } catch (error) {
      return routeError(
        res,
        error,
        'Could not load comments.'
      );
    }
  }
);

// ADD COMMENT
router.post(
  '/:id/comments',
  protect,
  async (req, res) => {
    if (!validId(req.params.id)) {
      return res.status(400).json({
        message: 'Invalid prayer ID.',
      });
    }

    const {
      text,
      replyTo = null,
    } = req.body || {};

    if (
      typeof text !== 'string' ||
      !text.trim() ||
      text.trim().length > 300
    ) {
      return res.status(400).json({
        message: 'Comment must contain 1–300 characters.',
      });
    }

    if (replyTo !== null && replyTo !== '') {
      return res.status(400).json({
        message:
          'Name-based replies are no longer supported. ' +
          'Update the app and post a regular comment.',
      });
    }

    try {
      const prayer = await findCommunityPrayer(req.params.id)
        .select('_id author isAnonymous');

      if (!prayer) {
        return res.status(404).json({
          message: 'Prayer not found.',
        });
      }

      const savedComment = await Comment.create({
        prayerId: prayer._id,
        userId: req.user.id,
        text: text.trim(),
        replyTo: null,
      });

      await Prayer.updateOne(
        { _id: prayer._id },
        { $inc: { commentCount: 1 } }
      );

      await savedComment.populate(
        'userId',
        'firstName lastName username'
      );

      // The author receives notifications about other commenters.
      // Authors do not receive notifications for their own comments.
      if (
        prayer.author &&
        prayer.author.toString() !== String(req.user.id)
      ) {
        await notifySafely(req.app, prayer.author, {
          actorId: req.user.id,
          actorName: req.user.username || 'A member',
          actionKey: 'notifReplied',
          targetId: prayer._id,
        });
      }

      return res.status(201).json(
        commentResponse(
          savedComment,
          prayer,
          req.user.id
        )
      );
    } catch (error) {
      return routeError(
        res,
        error,
        'Could not post comment.'
      );
    }
  }
);

/*
 * INTERACTIONS AND MODERATION
 */

// TOGGLE PRAYER PARTICIPATION
router.post('/:id/pray', protect, async (req, res) => {
  const prayerId = req.params.id;
  const userId = String(req.user.id);

  if (!validId(prayerId)) {
    return res.status(400).json({
      message: 'Invalid prayer ID.',
    });
  }

  try {
    const target = await findCommunityPrayer(prayerId);

    if (!target) {
      return res.status(404).json({
        message: 'Prayer not found.',
      });
    }

    const existing = await Interaction.findOne({
      userId,
      prayerId,
      type: 'pray',
    });

    if (existing) {
      const removed = await Interaction.deleteOne({
        _id: existing._id,
      });

      // Only decrement if this request removed the interaction.
      if (removed.deletedCount > 0) {
        await Prayer.updateOne(
          {
            _id: prayerId,
            prayingCount: { $gt: 0 },
          },
          {
            $inc: { prayingCount: -1 },
          }
        );

        await User.findByIdAndUpdate(userId, {
          $pull: { prayedFor: prayerId },
        });
      }

      const prayer = await Prayer.findById(prayerId)
        .select('prayingCount');

      if (!prayer) {
        return res.status(404).json({
          message: 'Prayer not found.',
        });
      }

      return res.json({
        prayingCount: prayer.prayingCount || 0,
        hasPrayed: false,
      });
    }

    await Interaction.create({
      userId,
      prayerId,
      type: 'pray',
    });

    const prayer = await Prayer.findOneAndUpdate(
      {
        _id: prayerId,
        isDaily: { $ne: true },
      },
      {
        $inc: { prayingCount: 1 },
      },
      {
        new: true,
      }
    );

    if (!prayer) {
      await Interaction.deleteMany({
        userId,
        prayerId,
        type: 'pray',
      });

      return res.status(404).json({
        message: 'Prayer not found.',
      });
    }

    await User.findByIdAndUpdate(userId, {
      $addToSet: { prayedFor: prayerId },
    });

    if (
      prayer.author &&
      prayer.author.toString() !== userId
    ) {
      await notifySafely(req.app, prayer.author, {
        actorId: userId,
        actorName: req.user.username || 'A member',
        actionKey: 'notifPrayed',
        targetId: prayerId,
      });
    }

    return res.json({
      prayingCount: prayer.prayingCount,
      hasPrayed: true,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message:
          'Prayer participation changed in another request. ' +
          'Refresh before trying again.',
        code: 'INTERACTION_CONFLICT',
      });
    }

    return routeError(
      res,
      error,
      'Could not update prayer participation.'
    );
  }
});

// TOGGLE BOOKMARK
router.post('/:id/bookmark', protect, async (req, res) => {
  const prayerId = req.params.id;
  const userId = String(req.user.id);

  if (!validId(prayerId)) {
    return res.status(400).json({
      message: 'Invalid prayer ID.',
    });
  }

  try {
    const prayer = await findCommunityPrayer(prayerId);

    if (!prayer) {
      return res.status(404).json({
        message: 'Prayer not found.',
      });
    }

    const alreadyBookmarked = (
      prayer.bookmarkedBy || []
    ).some((id) => id.toString() === userId);

    const update = alreadyBookmarked
      ? { $pull: { bookmarkedBy: userId } }
      : { $addToSet: { bookmarkedBy: userId } };

    const result = await Prayer.updateOne(
      {
        _id: prayerId,
        isDaily: { $ne: true },
      },
      update
    );

    if (!result.matchedCount) {
      return res.status(404).json({
        message: 'Prayer not found.',
      });
    }

    return res.json({
      isBookmarked: !alreadyBookmarked,
    });
  } catch (error) {
    return routeError(
      res,
      error,
      'Could not update bookmark.'
    );
  }
});

// REPORT COMMUNITY REQUEST
router.post('/:id/report', protect, async (req, res) => {
  const prayerId = req.params.id;
  const reason = req.body?.reason ?? 'General';

  if (!validId(prayerId)) {
    return res.status(400).json({
      message: 'Invalid prayer ID.',
    });
  }

  if (
    typeof reason !== 'string' ||
    !reason.trim() ||
    reason.trim().length > 500
  ) {
    return res.status(400).json({
      message: 'Report reason must contain 1–500 characters.',
    });
  }

  try {
    const prayer = await findCommunityPrayer(prayerId)
      .select('_id');

    if (!prayer) {
      return res.status(404).json({
        message: 'Prayer not found.',
      });
    }

    const report = await Report.create({
      reporterId: req.user.id,
      targetId: prayer._id,
      reason: reason.trim(),
      status: 'pending',
    });

    return res.status(201).json({
      message: 'Report submitted.',
      reportId: report._id.toString(),
    });
  } catch (error) {
    return routeError(
      res,
      error,
      'Could not submit report.'
    );
  }
});

/*
 * AUTHOR UPDATES
 */

router.post('/:id/updates', protect, async (req, res) => {
  if (!validId(req.params.id)) {
    return res.status(400).json({
      message: 'Invalid prayer ID.',
    });
  }

  const {
    text,
    type = 'update',
  } = req.body || {};

  if (
    typeof text !== 'string' ||
    !text.trim() ||
    text.trim().length > 5000
  ) {
    return res.status(400).json({
      message: 'Update must contain 1–5000 characters.',
    });
  }

  if (!UPDATE_TYPES.includes(type)) {
    return res.status(400).json({
      message: 'Choose a valid update type.',
    });
  }

  try {
    const prayer = await findCommunityPrayer(req.params.id);

    if (!prayer) {
      return res.status(404).json({
        message: 'Prayer not found.',
      });
    }

    const userId = String(req.user.id);

    if (
      !prayer.author ||
      prayer.author.toString() !== userId
    ) {
      return res.status(403).json({
        message: 'Only the author can post updates.',
      });
    }

    prayer.updates.push({
      text: text.trim(),
      type,
      createdAt: new Date(),
    });

    await prayer.save();

    const savedUpdate =
      prayer.updates[prayer.updates.length - 1];

    // The updated notification helper redacts anonymous actors
    // before saving or emitting notifications.
    try {
      const recipients = await Interaction.distinct(
        'userId',
        {
          prayerId: prayer._id,
          type: 'pray',
        }
      );

      for (const recipientId of recipients) {
        if (recipientId.toString() === userId) {
          continue;
        }

        await notifySafely(req.app, recipientId, {
          actorId: userId,

          actorName: prayer.isAnonymous
            ? 'A prayer author'
            : req.user.username || 'Author',

          isActorAnonymous: prayer.isAnonymous === true,

          actionKey: 'notifUpdate',
          targetId: prayer._id,
        });
      }
    } catch (error) {
      console.error(
        'Could not prepare update notifications:',
        error.name
      );
    }

    return res.status(201).json(
      updateResponse(savedUpdate)
    );
  } catch (error) {
    return routeError(
      res,
      error,
      'Could not post prayer update.'
    );
  }
});

/*
 * COMMENT ACTIONS
 */

// TOGGLE COMMENT LIKE
router.post(
  '/:id/comments/:commentId/like',
  protect,
  async (req, res) => {
    const { id, commentId } = req.params;

    if (!validId(id) || !validId(commentId)) {
      return res.status(400).json({
        message: 'Valid prayer and comment IDs are required.',
      });
    }

    try {
      const prayer = await findCommunityPrayer(id)
        .select('_id');

      if (!prayer) {
        return res.status(404).json({
          message: 'Prayer not found.',
        });
      }

      const comment = await Comment.findOne({
        _id: commentId,
        prayerId: id,
      });

      if (!comment) {
        return res.status(404).json({
          message: 'Comment not found.',
        });
      }

      const userId = String(req.user.id);

      const alreadyLiked = (comment.likes || []).some(
        (value) => value.toString() === userId
      );

      if (alreadyLiked) {
        comment.likes = comment.likes.filter(
          (value) => value.toString() !== userId
        );
      } else {
        if (!comment.likes) {
          comment.likes = [];
        }

        comment.likes.push(userId);
      }

      await comment.save();

      return res.json({
        liked: !alreadyLiked,
        likeCount: comment.likes.length,
      });
    } catch (error) {
      return routeError(
        res,
        error,
        'Could not update comment reaction.'
      );
    }
  }
);

// DELETE OWN COMMENT
router.delete(
  '/:id/comments/:commentId',
  protect,
  async (req, res) => {
    const { id, commentId } = req.params;

    if (!validId(id) || !validId(commentId)) {
      return res.status(400).json({
        message: 'Valid prayer and comment IDs are required.',
      });
    }

    try {
      const prayer = await findCommunityPrayer(id)
        .select('_id');

      if (!prayer) {
        return res.status(404).json({
          message: 'Prayer not found.',
        });
      }

      const comment = await Comment.findOne({
        _id: commentId,
        prayerId: id,
      });

      if (!comment) {
        return res.status(404).json({
          message: 'Comment not found.',
        });
      }

      if (
        !comment.userId ||
        comment.userId.toString() !== String(req.user.id)
      ) {
        return res.status(403).json({
          message: 'Only the comment author can delete it.',
        });
      }

      const deleted = await Comment.findOneAndDelete({
        _id: commentId,
        prayerId: id,
        userId: req.user.id,
      });

      if (!deleted) {
        return res.status(404).json({
          message: 'Comment not found or already deleted.',
        });
      }

      await Prayer.updateOne(
        {
          _id: id,
          commentCount: { $gt: 0 },
        },
        {
          $inc: { commentCount: -1 },
        }
      );

      return res.json({
        message: 'Comment deleted.',
      });
    } catch (error) {
      return routeError(
        res,
        error,
        'Could not delete comment.'
      );
    }
  }
);

// DELETE OWN COMMUNITY REQUEST
router.delete('/:id', protect, async (req, res) => {
  if (!validId(req.params.id)) {
    return res.status(400).json({
      message: 'Invalid prayer ID.',
    });
  }

  try {
    const prayer = await findCommunityPrayer(req.params.id);

    if (!prayer) {
      return res.status(404).json({
        message: 'Prayer not found.',
      });
    }

    if (
      !prayer.author ||
      prayer.author.toString() !== String(req.user.id)
    ) {
      return res.status(403).json({
        message: 'Only the author can delete this request.',
      });
    }

    const deleted = await Prayer.findOneAndDelete({
      _id: prayer._id,
      author: req.user.id,
      isDaily: { $ne: true },
    });

    if (!deleted) {
      return res.status(404).json({
        message: 'Prayer not found or already deleted.',
      });
    }

    await Comment.deleteMany({
      prayerId: prayer._id,
    });

    await Interaction.deleteMany({
      prayerId: prayer._id,
    });

    await User.updateMany(
      { prayedFor: prayer._id },
      { $pull: { prayedFor: prayer._id } }
    );

    return res.json({
      message: 'Prayer, comments, and interactions removed.',
    });
  } catch (error) {
    return routeError(
      res,
      error,
      'Could not delete prayer request.'
    );
  }
});

module.exports = router;