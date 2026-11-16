const Notification = require('../models/Notification');

const {
  notificationResponses,
} = require('./notificationResponse');

/**
 * Save a notification and emit its privacy-safe response.
 *
 * Usage:
 * const { notifyUser } = require('../utils/notifyUser');
 * await notifyUser(app, recipientId, {
 *   actorId,
 *   actorName,
 *   actionKey,
 *   targetId,
 * });
 */
const notifyUser = async (app, recipientId, payload) => {
  if (
    !payload ||
    typeof payload.actionKey !== 'string' ||
    !payload.actionKey.trim()
  ) {
    throw new Error('A notification actionKey is required.');
  }

  const actionKey = payload.actionKey.trim();

  const [safeIdentity] = await notificationResponses([
    {
      actorId: payload.actorId || null,
      actorName: payload.actorName || 'A member',
      isActorAnonymous: payload.isActorAnonymous === true,
      actionKey,
      targetId: payload.targetId || null,
      isRead: false,
    },
  ]);

  const notification = await Notification.create({
    recipientId,

    actorId: safeIdentity.isActorAnonymous
      ? null
      : payload.actorId || null,

    actorName: safeIdentity.actorName,
    isActorAnonymous: safeIdentity.isActorAnonymous,

    actionKey,
    targetId: payload.targetId || undefined,
  });

  const response = {
    _id: notification._id.toString(),
    actorName: notification.actorName,
    isActorAnonymous: notification.isActorAnonymous,
    actionKey: notification.actionKey,
    targetId: notification.targetId
      ? notification.targetId.toString()
      : null,
    isRead: notification.isRead === true,
    createdAt: notification.createdAt,
  };

  // Persistence has already succeeded. A socket failure must
  // not make the caller retry and create another notification.
  try {
    const io = app.get('io');

    if (io) {
      io.to(`user:${String(recipientId)}`).emit(
        'new_notification',
        response
      );
    }
  } catch (error) {
    console.error(
      'Notification socket delivery failed:',
      error.name
    );
  }

  // Return the safe response, not the database document.
  return response;
};

/**
 * Broadcast an administrator announcement.
 * Authorization must be enforced by the calling route.
 */
const broadcastAnnouncement = (app, message) => {
  const io = app.get('io');

  if (io) {
    io.emit('admin_announcement', {
      message,
      createdAt: new Date(),
    });
  }
};

module.exports = {
  notifyUser,
  broadcastAnnouncement,
};