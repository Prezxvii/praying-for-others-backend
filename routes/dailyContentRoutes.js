const express = require('express');
const mongoose = require('mongoose');

const Prayer = require('../models/Prayer');
const { protect } = require('../middleware/auth');
const { adminOnly } = require('../middleware/adminMiddleware');

const router = express.Router();

const TIMEZONE =
  process.env.DAILY_CONTENT_TIMEZONE || 'America/New_York';

// Fail clearly if the configured timezone is invalid.
const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const todayInPublishingTimezone = () => {
  const parts = dateFormatter.formatToParts(new Date());

  const value = (type) =>
    parts.find((part) => part.type === type)?.value;

  return `${value('year')}-${value('month')}-${value('day')}`;
};

const isValidDate = (value) => {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
};

const validId = (value) =>
  typeof value === 'string' &&
  mongoose.isObjectIdOrHexString(value);

const readerEntry = (entry) => ({
  _id: entry._id.toString(),
  title: entry.title || '',
  verse: entry.verse || '',
  reference: entry.reference || '',
  bibleTranslation: entry.bibleTranslation || '',
  content: entry.content || entry.text || '',
  action: entry.action || '',
  publishDate: entry.publishDate,
  displayOrder: entry.displayOrder || 0,
});

const adminEntry = (entry) => ({
  ...readerEntry(entry),
  publicationStatus: entry.publicationStatus || 'draft',
  publishedAt: entry.publishedAt || null,
  editedAt: entry.editedAt || null,
  createdAt: entry.createdAt,
  needsScheduling: !entry.publishDate,
});

const textFields = {
  title: 200,
  verse: 10000,
  reference: 200,
  bibleTranslation: 100,
  content: 15000,
  action: 2000,
};

const buildEntry = (body, existing = null) => {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body)
  ) {
    return { error: 'A valid request body is required.' };
  }

  const result = {};

  for (const [field, maximum] of Object.entries(textFields)) {
    const supplied = Object.prototype.hasOwnProperty.call(
      body,
      field
    );

    const value = supplied
      ? body[field]
      : existing?.[field] ||
        (field === 'content' ? existing?.text : '') ||
        '';

    if (
      typeof value !== 'string' ||
      value.trim().length > maximum
    ) {
      return {
        error: `${field} must be text with no more than ${maximum} characters.`,
      };
    }

    result[field] = value.trim();
  }

  result.publishDate =
    body.publishDate !== undefined
      ? body.publishDate
      : existing?.publishDate;

  if (!isValidDate(result.publishDate)) {
    return {
      error: 'Choose a valid display date using YYYY-MM-DD.',
    };
  }

  result.publicationStatus =
    body.publicationStatus !== undefined
      ? body.publicationStatus
      : existing?.publicationStatus || 'draft';

  if (
    !['draft', 'published'].includes(
      result.publicationStatus
    )
  ) {
    return { error: 'Choose draft or published status.' };
  }

  result.displayOrder =
    body.displayOrder !== undefined
      ? body.displayOrder
      : existing?.displayOrder || 0;

  if (
    !Number.isInteger(result.displayOrder) ||
    result.displayOrder < 0 ||
    result.displayOrder > 999
  ) {
    return {
      error: 'Display order must be a whole number from 0 to 999.',
    };
  }

  if (!result.title) {
    return { error: 'A title is required, including for drafts.' };
  }

  if (
    result.publicationStatus === 'published' &&
    (
      !result.verse ||
      !result.reference ||
      !result.bibleTranslation ||
      !result.content
    )
  ) {
    return {
      error: 'Publishing requires Scripture, a reference, a Bible translation, and prayer content.',
    };
  }

  return { value: result };
};

const databaseError = (res, error, message) => {
  console.error(message, error.name);

  return res.status(
    error.name === 'ValidationError' ? 400 : 500
  ).json({ message });
};

// ADMIN: List scheduled entries and older unscheduled daily records.
router.get('/admin', protect, adminOnly, async (req, res) => {
  const query = { isDaily: true };

  if (req.query.date !== undefined) {
    if (!isValidDate(req.query.date)) {
      return res.status(400).json({
        message: 'Date must use YYYY-MM-DD.',
      });
    }

    query.publishDate = req.query.date;
  }

  try {
    const entries = await Prayer.find(query)
      .sort({
        publishDate: -1,
        displayOrder: 1,
        createdAt: -1,
      })
      .limit(200)
      .lean();

    return res.json({
      timezone: TIMEZONE,
      today: todayInPublishingTimezone(),
      entries: entries.map(adminEntry),
    });
  } catch (error) {
    return databaseError(
      res,
      error,
      'Could not load daily entries.'
    );
  }
});

// ADMIN: Create draft or published entry.
router.post('/admin', protect, adminOnly, async (req, res) => {
  const parsed = buildEntry(req.body);

  if (parsed.error) {
    return res.status(400).json({
      message: parsed.error,
    });
  }

  try {
    const entry = await Prayer.create({
      ...parsed.value,
      text: parsed.value.content,
      author: req.user.id,
      updatedBy: req.user.id,
      isDaily: true,
      isUrgent: false,
      isAnonymous: false,
      publishedAt:
        parsed.value.publicationStatus === 'published'
          ? new Date()
          : undefined,
    });

    return res.status(201).json(
      adminEntry(entry.toObject())
    );
  } catch (error) {
    return databaseError(
      res,
      error,
      'Could not create daily entry.'
    );
  }
});

// ADMIN: Edit, publish, or return an entry to draft.
router.patch(
  '/admin/:id',
  protect,
  adminOnly,
  async (req, res) => {
    if (!validId(req.params.id)) {
      return res.status(400).json({
        message: 'A valid entry ID is required.',
      });
    }

    try {
      const entry = await Prayer.findOne({
        _id: req.params.id,
        isDaily: true,
      });

      if (!entry) {
        return res.status(404).json({
          message: 'Daily entry not found.',
        });
      }

      const parsed = buildEntry(req.body, entry);

      if (parsed.error) {
        return res.status(400).json({
          message: parsed.error,
        });
      }

      const wasPublished =
        entry.publicationStatus === 'published';

      Object.assign(entry, parsed.value);

      entry.text = entry.content;
      entry.updatedBy = req.user.id;
      entry.editedAt = new Date();

      if (entry.publicationStatus === 'published') {
        if (!wasPublished || !entry.publishedAt) {
          entry.publishedAt = new Date();
        }
      } else {
        entry.publishedAt = undefined;
      }

      await entry.save();

      return res.json(adminEntry(entry.toObject()));
    } catch (error) {
      return databaseError(
        res,
        error,
        'Could not update daily entry.'
      );
    }
  }
);

// READER: Published entries for the current publishing day.
router.get('/today', protect, async (req, res) => {
  try {
    const today = todayInPublishingTimezone();

    const entries = await Prayer.find({
      isDaily: true,
      publicationStatus: 'published',
      publishDate: today,
    })
      .sort({
        displayOrder: 1,
        createdAt: 1,
        _id: 1,
      })
      .lean();

    return res.json({
      date: today,
      timezone: TIMEZONE,
      entries: entries.map(readerEntry),
    });
  } catch (error) {
    return databaseError(
      res,
      error,
      'Could not load today’s daily content.'
    );
  }
});

module.exports = router;