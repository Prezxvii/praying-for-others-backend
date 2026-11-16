require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const Message = require('./models/Message');
const Circle = require('./models/Circle');

const {
  verifyAccessToken,
  AuthError,
} = require('./middleware/auth');

const app = express();
const server = http.createServer(app);

const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(null, false);
  },
};

const io = new Server(server, {
  cors: {
    ...corsOptions,
    methods: ['GET', 'POST'],
  },
  maxHttpBufferSize: 100000,
});

app.disable('x-powered-by');
app.use(cors(corsOptions));
app.use(express.json({ limit: '128kb' }));
app.set('io', io);

// SERVICE INFORMATION
app.get('/', (req, res) => {
  res.status(200).json({
    service: 'praying-for-others-backend',
    status: 'running',
  });
});

// READINESS CHECK
// Checks the connection state, not a live database query.
app.get('/health', (req, res) => {
  const databaseConnected =
    mongoose.connection.readyState === 1;

  res.set('Cache-Control', 'no-store');

  return res.status(databaseConnected ? 200 : 503).json({
    status: databaseConnected ? 'ok' : 'unavailable',
    database: databaseConnected
      ? 'connected'
      : 'disconnected',
  });
});

// HTTP ROUTES
app.use('/api/prayers', require('./routes/prayerRoutes'));
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/circles', require('./routes/circleRoutes'));
app.use('/api/chat', require('./routes/chatRoutes'));
app.use('/api/campaigns', require('./routes/campaignRoutes'));
app.use(
  '/api/notifications',
  require('./routes/notificationRoutes')
);
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/news', require('./routes/newsRoutes'));

// Scheduled administrator-controlled daily content.
app.use(
  '/api/daily-content',
  require('./routes/dailyContentRoutes')
);

const validId = (value) =>
  typeof value === 'string' &&
  mongoose.isObjectIdOrHexString(value);

const circleRoom = (circleId) => `circle:${circleId}`;

const actionError = (message) => {
  const error = new Error(message);
  error.isActionError = true;
  return error;
};

const reply = (ack, payload) => {
  if (typeof ack === 'function') {
    ack(payload);
  }
};

const freshSocketUser = async (socket) => {
  const user = await verifyAccessToken(socket.data.token);
  socket.data.user = user;

  return user;
};

const requireMember = async (circleId, userId) => {
  if (!validId(circleId)) {
    throw actionError('A valid circle ID is required.');
  }

  const circle = await Circle.findOne({
    _id: circleId,
    members: userId,
  }).select('_id creator');

  if (!circle) {
    throw actionError('Circle access denied.');
  }

  return circle;
};

const registerAction = (socket, eventName, handler) => {
  socket.on(eventName, async (payload, ack) => {
    try {
      if (
        !payload ||
        typeof payload !== 'object' ||
        Array.isArray(payload)
      ) {
        throw actionError('Invalid event data.');
      }

      const user = await freshSocketUser(socket);
      const result = await handler(payload, user);

      reply(ack, {
        ok: true,
        ...result,
      });
    } catch (error) {
      const safeMessage =
        error instanceof AuthError || error.isActionError
          ? error.message
          : 'The operation could not be completed.';

      if (
        !(error instanceof AuthError) &&
        !error.isActionError
      ) {
        console.error(
          `Socket ${eventName} failed:`,
          error.name
        );
      }

      const failure = {
        ok: false,
        message: safeMessage,
        code: error.code || 'ACTION_FAILED',
      };

      reply(ack, failure);

      socket.emit('operation_error', {
        event: eventName,
        ...failure,
      });

      if (
        error instanceof AuthError &&
        error.status !== 503
      ) {
        socket.disconnect(true);
      }
    }
  });
};

// SOCKET AUTHENTICATION
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    const user = await verifyAccessToken(token);

    socket.data.token = token;
    socket.data.user = user;

    next();
  } catch (error) {
    const connectionError = new Error(
      error instanceof AuthError
        ? error.message
        : 'Authentication is temporarily unavailable.'
    );

    connectionError.data = {
      code: error.code || 'AUTH_UNAVAILABLE',
    };

    next(connectionError);
  }
});

// SOCKET EVENTS
io.on('connection', (socket) => {
  socket.join(`user:${socket.data.user.id}`);

  // Compatibility with clients that still emit this event.
  socket.on('join_user_room', (userId, ack) => {
    if (String(userId) !== socket.data.user.id) {
      return reply(ack, {
        ok: false,
        message: 'Notification room access denied.',
      });
    }

    socket.join(`user:${socket.data.user.id}`);

    return reply(ack, { ok: true });
  });

  registerAction(
    socket,
    'join_circle',
    async (data, user) => {
      await requireMember(data.circleId, user.id);
      await socket.join(circleRoom(data.circleId));

      return {
        circleId: data.circleId,
      };
    }
  );

  registerAction(
    socket,
    'send_message',
    async (data, user) => {
      await requireMember(data.circleId, user.id);

      if (
        typeof data.text !== 'string' ||
        !data.text.trim() ||
        data.text.trim().length > 5000
      ) {
        throw actionError(
          'Message must contain 1–5000 characters.'
        );
      }

      const saved = await Message.create({
        circle: data.circleId,
        sender: user.id,
        senderName: user.username,
        text: data.text.trim(),
      });

      const message = {
        _id: saved._id.toString(),
        circleId: data.circleId,
        senderId: user.id,
        senderName: user.username,
        senderRole: user.role,
        text: saved.text,
        createdAt: saved.createdAt,
      };

      io.to(circleRoom(data.circleId)).emit(
        'receive_message',
        message
      );

      return { message };
    }
  );

  registerAction(
    socket,
    'schedule_meeting',
    async (data, user) => {
      const circle = await requireMember(
        data.circleId,
        user.id
      );

      if (circle.creator.toString() !== user.id) {
        throw actionError(
          'Only the circle creator can schedule meetings.'
        );
      }

      const meeting = data.meetingData;

      if (
        !meeting ||
        typeof meeting.title !== 'string' ||
        !meeting.title.trim() ||
        meeting.title.trim().length > 160 ||
        typeof meeting.dateTime !== 'string'
      ) {
        throw actionError(
          'A meeting title and future date are required.'
        );
      }

      const dateTime = new Date(meeting.dateTime);

      if (
        Number.isNaN(dateTime.getTime()) ||
        dateTime.getTime() <= Date.now()
      ) {
        throw actionError(
          'Choose a future meeting date and time.'
        );
      }

      const meetingData = {
        _id: new mongoose.Types.ObjectId(),
        title: meeting.title.trim(),
        dateTime,
        createdBy: user.id,
      };

      const result = await Circle.updateOne(
        {
          _id: circle._id,
          creator: user.id,
          members: user.id,
        },
        {
          $push: {
            scheduledMeetings: meetingData,
          },
        },
        {
          runValidators: true,
        }
      );

      if (!result.modifiedCount) {
        throw actionError(
          'Meeting could not be scheduled.'
        );
      }

      io.to(circleRoom(data.circleId)).emit(
        'meeting_scheduled',
        {
          meetingData,
          circleId: data.circleId,
        }
      );

      return { meetingData };
    }
  );

  registerAction(
    socket,
    'delete_message',
    async (data, user) => {
      await requireMember(data.circleId, user.id);

      if (!validId(data.messageId)) {
        throw actionError(
          'A valid message ID is required.'
        );
      }

      const query = {
        _id: data.messageId,
        circle: data.circleId,
      };

      if (user.role !== 'admin') {
        query.sender = user.id;
      }

      const deleted =
        await Message.findOneAndDelete(query);

      if (!deleted) {
        throw actionError(
          'Message not found or deletion is not permitted.'
        );
      }

      io.to(circleRoom(data.circleId)).emit(
        'message_deleted',
        deleted._id.toString()
      );

      return {
        messageId: deleted._id.toString(),
      };
    }
  );
});

// ERROR HANDLER
app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  if (error.type === 'entity.too.large') {
    return res.status(413).json({
      message: 'Request is too large.',
    });
  }

  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({
      message: 'Invalid JSON request body.',
    });
  }

  console.error(
    'Unhandled request error:',
    error.name
  );

  return res.status(500).json({
    message: 'An unexpected server error occurred.',
  });
});

// STARTUP
const start = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required.');
  }

  if (
    !process.env.JWT_SECRET ||
    process.env.JWT_SECRET.length < 32
  ) {
    throw new Error(
      'JWT_SECRET is required and must contain at least 32 characters.'
    );
  }

  const port = Number(process.env.PORT || 5000);

  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error('PORT must be a valid TCP port.');
  }

  await mongoose.connect(process.env.MONGO_URI);

  console.log('Connected to MongoDB.');

  server.listen(port, '0.0.0.0', () => {
    console.log(
      `Server listening on port ${port}.`
    );

    console.log(
      'Daily publishing timezone:',
      process.env.DAILY_CONTENT_TIMEZONE ||
        'America/New_York'
    );
  });
};

start().catch((error) => {
  console.error(
    'Server startup failed:',
    error.message
  );

  process.exit(1);
});