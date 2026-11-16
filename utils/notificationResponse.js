const Prayer = require('../models/Prayer');

const PRAYER_ACTIONS = new Set([
  'notifPrayed',
  'notifReplied',
  'notifUpdate',
]);

const idString = (value) => {
  if (!value) {
    return null;
  }

  const id = value._id || value;

  return typeof id.toString === 'function'
    ? id.toString()
    : null;
};

const notificationResponses = async (notifications) => {
  const sources = notifications.map((notification) =>
    typeof notification.toObject === 'function'
      ? notification.toObject()
      : notification
  );

  const targetIds = [
    ...new Set(
      sources
        .filter((item) => PRAYER_ACTIONS.has(item.actionKey))
        .map((item) => idString(item.targetId))
        .filter(Boolean)
    ),
  ];

  const prayers = targetIds.length > 0
    ? await Prayer.find({
        _id: { $in: targetIds },
      })
        .select('_id author isAnonymous')
        .lean()
    : [];

  const prayerMap = new Map(
    prayers.map((prayer) => [
      idString(prayer._id),
      prayer,
    ])
  );

  return sources.map((item) => {
    const isPrayerAction = PRAYER_ACTIONS.has(item.actionKey);
    const targetId = idString(item.targetId);
    const actorId = idString(item.actorId);

    const prayer = isPrayerAction
      ? prayerMap.get(targetId)
      : null;

    const authorId = prayer
      ? idString(prayer.author)
      : null;

    let hideActor = item.isActorAnonymous === true;

    if (isPrayerAction) {
      if (!prayer || !actorId || !authorId) {
        // Fail closed for deleted targets or unverifiable
        // legacy actor identities.
        hideActor = true;
      } else if (
        prayer.isAnonymous === true &&
        (
          item.actionKey === 'notifUpdate' ||
          actorId === authorId
        )
      ) {
        hideActor = true;
      }
    }

    const genericName = item.actionKey === 'notifUpdate'
      ? 'A prayer author'
      : 'A member';

    return {
      _id: idString(item._id),

      actorName: hideActor
        ? genericName
        : (
            typeof item.actorName === 'string' &&
            item.actorName.trim()
              ? item.actorName.trim()
              : 'A member'
          ),

      isActorAnonymous: hideActor,
      actionKey: item.actionKey,
      targetId,
      isRead: item.isRead === true,
      createdAt: item.createdAt,
    };
  });
};

module.exports = { notificationResponses };