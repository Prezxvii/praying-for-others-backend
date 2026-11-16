const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');

class AuthError extends Error {
  constructor(message, status = 401, code = 'SESSION_INVALID') {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
  }
}

const verifyAccessToken = async (token) => {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.length < 32) {
    throw new AuthError(
      'Authentication is not configured.',
      503,
      'AUTH_UNAVAILABLE'
    );
  }

  if (typeof token !== 'string' || !token) {
    throw new AuthError(
      'No token, authorization denied',
      401,
      'SESSION_REQUIRED'
    );
  }

  let decoded;

  try {
    decoded = jwt.verify(token, secret, {
      algorithms: ['HS256'],
    });
  } catch (error) {
    const expired = error.name === 'TokenExpiredError';

    throw new AuthError(
      expired
        ? 'Session expired. Please sign in again.'
        : 'Not authorized, token failed',
      401,
      expired ? 'SESSION_EXPIRED' : 'SESSION_INVALID'
    );
  }

  if (
    !decoded ||
    typeof decoded !== 'object' ||
    typeof decoded.id !== 'string' ||
    !mongoose.isObjectIdOrHexString(decoded.id)
  ) {
    throw new AuthError('Not authorized, token failed');
  }

  const user = await User.findById(decoded.id)
    .select('_id username role isBanned')
    .lean();

  if (!user) {
    throw new AuthError(
      'User not found',
      401,
      'SESSION_INVALID'
    );
  }

  if (user.isBanned) {
    throw new AuthError(
      'Account suspended',
      403,
      'ACCOUNT_SUSPENDED'
    );
  }

  return {
    id: user._id.toString(),
    username: user.username,
    role: user.role,
  };
};

const protect = async (req, res, next) => {
  const authorization = req.headers.authorization;

  if (
    typeof authorization !== 'string' ||
    !/^Bearer\s+\S+$/i.test(authorization)
  ) {
    return res.status(401).json({
      message: 'No token, authorization denied',
      code: 'SESSION_REQUIRED',
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

    console.error('Authentication lookup failed:', error.name);

    return res.status(503).json({
      message: 'Authentication is temporarily unavailable.',
      code: 'AUTH_UNAVAILABLE',
    });
  }
};

module.exports = {
  protect,
  verifyAccessToken,
  AuthError,
};