const stringId = (value) => {
  if (!value) {
    return null;
  }

  const id = value._id || value;

  return typeof id.toString === 'function'
    ? id.toString()
    : null;
};

const publicAuthor = (author) => {
  if (
    !author ||
    typeof author !== 'object' ||
    !author._id
  ) {
    return null;
  }

  return {
    _id: stringId(author._id),
    firstName:
      typeof author.firstName === 'string'
        ? author.firstName
        : '',
    lastName:
      typeof author.lastName === 'string'
        ? author.lastName
        : '',
  };
};

const safeCount = (value) => (
  Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0
);

const prayerResponse = (
  prayer,
  {
    userId = null,
    hasPrayed = false,
    isBookmarked = false,
  } = {}
) => {
  const source =
    typeof prayer.toObject === 'function'
      ? prayer.toObject()
      : prayer;

  const authorId = stringId(source.author);
  const viewerId = stringId(userId);
  const anonymous = source.isAnonymous === true;

  return {
    _id: stringId(source._id),

    title: source.title || '',
    text: source.text || source.content || '',
    content: source.content || source.text || '',
    category: source.category || '',

    isAnonymous: anonymous,
    isAuthor: Boolean(
      viewerId &&
      authorId &&
      viewerId === authorId
    ),

    author: anonymous
      ? null
      : publicAuthor(source.author),

    location: anonymous
      ? null
      : source.location || null,

    isUrgent: source.isUrgent === true,
    isDaily: false,

    prayingCount: safeCount(source.prayingCount),
    commentCount: safeCount(source.commentCount),

    hasPrayed: Boolean(viewerId && hasPrayed),
    isBookmarked: Boolean(viewerId && isBookmarked),

    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    startDate: source.startDate,
    endDate: source.endDate,

    updates: Array.isArray(source.updates)
      ? source.updates.map((update) => ({
          _id: stringId(update._id),
          text: update.text || '',
          type: update.type || 'update',
          createdAt: update.createdAt,
        }))
      : [],
  };
};

module.exports = { prayerResponse };