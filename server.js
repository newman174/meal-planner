/**
 * @fileoverview Express server for the Meal Planner application.
 * Provides REST API endpoints for managing weekly meal plans.
 * Includes rate limiting, security headers, and optional API key authentication.
 * @module server
 */

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const db = require('./db');
const logger = require('./logger');

const app = express();
const PORT = process.env.PORT || 3000;

/**
 * Server configuration constants
 * @constant {Object}
 */
const CONFIG = {
  /** Maximum size for JSON request bodies */
  MAX_JSON_BODY_SIZE: '10kb',
  /** Rate limiting window in milliseconds (15 minutes) */
  RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000,
  /** Maximum read requests per window */
  RATE_LIMIT_READ_MAX: 500,
  /** Maximum write requests per window */
  RATE_LIMIT_WRITE_MAX: 100
};

/**
 * API key for write operations.
 * Set via MEAL_PLANNER_API_KEY environment variable.
 * If not set, authentication is disabled (development mode).
 * @constant {string|undefined}
 */
const API_KEY = process.env.MEAL_PLANNER_API_KEY;

if (!API_KEY) {
  logger.warn('MEAL_PLANNER_API_KEY not set - write operations are unprotected. Set this in production!');
}

// Middleware setup
app.use(express.json({ limit: CONFIG.MAX_JSON_BODY_SIZE }));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"]
    }
  }
}));

/**
 * Rate limiter for read operations (GET requests).
 * Allows more requests than write operations.
 */
const readLimiter = rateLimit({
  windowMs: CONFIG.RATE_LIMIT_WINDOW_MS,
  max: CONFIG.RATE_LIMIT_READ_MAX,
  message: { error: 'Too many requests, please try again later' }
});

/**
 * Rate limiter for write operations (PUT, POST, DELETE).
 * More restrictive than read limiter.
 */
const writeLimiter = rateLimit({
  windowMs: CONFIG.RATE_LIMIT_WINDOW_MS,
  max: CONFIG.RATE_LIMIT_WRITE_MAX,
  message: { error: 'Too many requests, please try again later' }
});

/**
 * Apply appropriate rate limiter based on HTTP method.
 */
app.use('/api/', (req, res, next) => {
  if (req.method === 'GET') {
    return readLimiter(req, res, next);
  }
  return writeLimiter(req, res, next);
});

/**
 * Validates that a string is a valid week date in YYYY-MM-DD format.
 * Also validates that the date is actually parseable.
 * @param {string} weekOf - The date string to validate
 * @returns {boolean} True if valid, false otherwise
 */
function isValidWeekOf(weekOf) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekOf)) {
    return false;
  }
  // Also validate it's an actual date
  const parsed = new Date(weekOf + 'T00:00:00');
  return !isNaN(parsed.getTime());
}

/**
 * Validates that a request body is a valid object (not null, array, or primitive).
 * Prevents prototype pollution and type confusion attacks.
 * @param {*} body - The request body to validate
 * @returns {boolean} True if valid object, false otherwise
 */
function isValidRequestBody(body) {
  return body !== null && typeof body === 'object' && !Array.isArray(body);
}

/**
 * Authentication middleware for write operations.
 * Checks for X-API-Key header when MEAL_PLANNER_API_KEY is set.
 * Skips authentication if no API key is configured (development mode).
 * @param {express.Request} req - Express request object
 * @param {express.Response} res - Express response object
 * @param {express.NextFunction} next - Next middleware function
 */
function requireApiKey(req, res, next) {
  // Skip auth if no API key is configured (development mode)
  if (!API_KEY) {
    return next();
  }

  const providedKey = req.get('X-API-Key');

  if (!providedKey) {
    logger.warn({ method: req.method, path: req.path }, 'Missing API key');
    return res.status(401).json({ error: 'API key required. Include X-API-Key header.' });
  }

  // Use timing-safe comparison to prevent timing attacks
  const keyBuffer = Buffer.from(API_KEY);
  const providedBuffer = Buffer.from(providedKey);

  if (keyBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(keyBuffer, providedBuffer)) {
    logger.warn({ method: req.method, path: req.path }, 'Invalid API key');
    return res.status(403).json({ error: 'Invalid API key' });
  }

  next();
}

// Request logging middleware
app.use(logger.requestMiddleware);

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// --- App API routes ---

/**
 * GET /api/weeks/:weekOf
 * Retrieves a week's meals, creating the week if it doesn't exist.
 * @param {string} weekOf - The Monday of the week in YYYY-MM-DD format
 * @returns {Object} Week object with days array
 */
app.get('/api/weeks/:weekOf', (req, res) => {
  try {
    if (!isValidWeekOf(req.params.weekOf)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }
    const week = db.getWeekWithCreate(req.params.weekOf);
    res.json(week);
  } catch (err) {
    logger.error({ err, weekOf: req.params.weekOf }, 'Error fetching week');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/weeks/:weekOf/days/:day
 * Updates a specific day's meals.
 * Requires API key authentication if configured.
 * @param {string} weekOf - The Monday of the week in YYYY-MM-DD format
 * @param {number} day - Day index (0=Monday, 6=Sunday)
 * @body {Object} Field updates (e.g., { adult_dinner: "Pasta" })
 * @returns {Object} Updated week object
 */
app.put('/api/weeks/:weekOf/days/:day', requireApiKey, (req, res) => {
  try {
    if (!isValidWeekOf(req.params.weekOf)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    if (!isValidRequestBody(req.body)) {
      return res.status(400).json({ error: 'Invalid request body. Expected JSON object.' });
    }

    const dayIndex = parseInt(req.params.day, 10);
    if (isNaN(dayIndex) || dayIndex < 0 || dayIndex > 6) {
      return res.status(400).json({ error: 'Invalid day index (0-6)' });
    }

    db.updateDay(req.params.weekOf, dayIndex, req.body);
    const week = db.getWeek(req.params.weekOf);
    res.json(week);
  } catch (err) {
    logger.error({ err, weekOf: req.params.weekOf, day: req.params.day }, 'Error updating day');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/weeks
 * Lists all saved weeks, ordered by date descending.
 * @returns {Array<Object>} Array of week summary objects
 */
app.get('/api/weeks', (req, res) => {
  try {
    const weeks = db.listWeeks();
    res.json(weeks);
  } catch (err) {
    logger.error({ err }, 'Error listing weeks');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/weeks/:weekOf/copy
 * Copies all meal data from one week to another.
 * Requires API key authentication if configured.
 * @param {string} weekOf - Source week Monday in YYYY-MM-DD format
 * @body {Object} { targetWeekOf: "YYYY-MM-DD" }
 * @returns {Object} The newly created week
 */
app.post('/api/weeks/:weekOf/copy', requireApiKey, (req, res) => {
  try {
    if (!isValidWeekOf(req.params.weekOf)) {
      return res.status(400).json({ error: 'Invalid source date format. Use YYYY-MM-DD' });
    }

    if (!isValidRequestBody(req.body)) {
      return res.status(400).json({ error: 'Invalid request body. Expected JSON object.' });
    }

    const { targetWeekOf } = req.body;
    if (!targetWeekOf) {
      return res.status(400).json({ error: 'targetWeekOf is required' });
    }
    if (!isValidWeekOf(targetWeekOf)) {
      return res.status(400).json({ error: 'Invalid target date format. Use YYYY-MM-DD' });
    }
    const result = db.copyWeek(req.params.weekOf, targetWeekOf);
    if (!result) {
      return res.status(404).json({ error: 'Source week not found' });
    }
    res.json(result);
  } catch (err) {
    logger.error({ err, weekOf: req.params.weekOf }, 'Error copying week');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/weeks/:weekOf
 * Deletes a week and all its associated days.
 * Requires API key authentication if configured.
 * @param {string} weekOf - The Monday of the week in YYYY-MM-DD format
 * @returns {Object} { ok: true }
 */
app.delete('/api/weeks/:weekOf', requireApiKey, (req, res) => {
  try {
    if (!isValidWeekOf(req.params.weekOf)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }
    db.deleteWeek(req.params.weekOf);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, weekOf: req.params.weekOf }, 'Error deleting week');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Public API routes (for Home Assistant, MagTag, etc.) ---
// These routes are intentionally unauthenticated for easy integration

/**
 * GET /api/schedule/current
 * Returns the current week's meals formatted for display.
 * Public endpoint for Home Assistant integration.
 * @returns {Object} Formatted week data
 */
app.get('/api/schedule/current', (req, res) => {
  try {
    const weekOf = db.getCurrentMonday();
    const week = db.getWeek(weekOf);
    if (!week) {
      return res.json({ week_of: weekOf, days: [] });
    }
    res.json(db.formatWeekForApi(week));
  } catch (err) {
    logger.error({ err }, 'Error fetching current schedule');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/schedule/upcoming
 * Returns today plus the next 2 days' meals.
 * Optimized endpoint for MagTag e-ink display.
 * @returns {Object} { days: [...], updated_at: "HH:MM" }
 */
app.get('/api/schedule/upcoming', (_req, res) => {
  try {
    const days = db.getUpcomingDays(3);
    res.json({ days, updated_at: db.getEasternTimeString() });
  } catch (err) {
    logger.error({ err }, 'Error fetching upcoming schedule');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/schedule/:weekOf
 * Returns a specific week's meals formatted for display.
 * Public endpoint for external integrations.
 * @param {string} weekOf - The Monday of the week in YYYY-MM-DD format
 * @returns {Object} Formatted week data
 */
app.get('/api/schedule/:weekOf', (req, res) => {
  try {
    if (!isValidWeekOf(req.params.weekOf)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }
    const week = db.getWeek(req.params.weekOf);
    if (!week) {
      return res.status(404).json({ error: 'Week not found' });
    }
    res.json(db.formatWeekForApi(week));
  } catch (err) {
    logger.error({ err, weekOf: req.params.weekOf }, 'Error fetching schedule');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Global error handler for unhandled errors.
 * Logs the error and returns a generic 500 response.
 */
app.use((err, req, res, _next) => {
  logger.error({ err, method: req.method, path: req.path }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Meal Planner server started');
  if (API_KEY) {
    logger.info('API key authentication enabled for write operations');
  }
});
