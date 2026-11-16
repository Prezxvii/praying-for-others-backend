const idString = (value) => {
  if (!value) {
    return null;
  }

  const id = value._id || value;

  return typeof id.toString === 'function'
    ? id.toString()
    : null;
};

const commentResponse = (
  comment,
  prayer,
  viewerId = null
) => {
  const source =
    typeof comment.toObject === 'function'
      ? comment.toObject()
      : comment;

  const commenterId = idString(source.userId);
  const authorId = idString(prayer.author);
  const currentUserId = idString(viewerId);

  const isPrayerAuthor = Boolean(
    commenterId &&
    authorId &&
    commenterId === authorId
  );

  const isAnonymous = Boolean(
    prayer.isAnonymous === true &&
    isPrayerAuthor
  );

  const populatedUser =
    source.userId &&
    typeof source.userId === 'object' &&
    source.userId._id
      ? source.userId
      : null;

  const likeIds = new Set(
    (source.likes || [])
      .map(idString)
      .filter(Boolean)
  );

  return {
    _id: idString(source._id),
    prayerId: idString(source.prayerId),

    text: source.text || '',
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,

    isAnonymous,
    isPrayerAuthor,

    isOwnComment: Boolean(
      currentUserId &&
      commenterId &&
      currentUserId === commenterId
    ),

    userId:
      !isAnonymous && populatedUser
        ? {
            _id: commenterId,
            firstName: populatedUser.firstName || '',
            lastName: populatedUser.lastName || '',
            username: populatedUser.username || '',
          }
        : null,

    likeCount: likeIds.size,

    hasLiked: Boolean(
      currentUserId &&
      likeIds.has(currentUserId)
    ),

    // Do not return legacy reply labels containing names.
    replyTo: null,
  };
};

module.exports = { commentResponse };