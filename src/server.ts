/**
 * @fileoverview Express server for the Meal Planner application.
 * Provides REST API endpoints for managing weekly meal plans.
 * Includes rate limiting, security headers, and optional API key authentication.
 * @module server
 */

import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import config from './config.js';
import * as db from './db.js';
import logger from './logger.js';
import './types/index.js'; // Import for Express Request extension

const app = express();

/**
 * API key for write operations.
 * Set via MEAL_PLANNER_API_KEY environment variable.
 * If not set, authentication is disabled (development mode).
 */
const API_KEY = process.env.MEAL_PLANNER_API_KEY;

if (!API_KEY) {
  logger.warn('MEAL_PLANNER_API_KEY not set - write operations are unprotected. Set this in production!');
}

// Middleware setup
app.use(express.json({ limit: config.maxJsonBodySize }));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      upgradeInsecureRequests: null  // Disable for HTTP-only local network deployments
    }
  }
}));

/**
 * Rate limiter for read operations (GET requests).
 * Allows more requests than write operations.
 */
const readLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitReadMax,
  message: { error: 'Too many requests, please try again later' }
});

/**
 * Rate limiter for write operations (PUT, POST, DELETE).
 * More restrictive than read limiter.
 */
const writeLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitWriteMax,
  message: { error: 'Too many requests, please try again later' }
});

/**
 * Apply appropriate rate limiter based on HTTP method.
 */
app.use('/api/', (req: Request, res: Response, next: NextFunction) => {
  if (req.method === 'GET') {
    return readLimiter(req, res, next);
  }
  return writeLimiter(req, res, next);
});

/**
 * Validates that a string is a valid week date in YYYY-MM-DD format.
 * Also validates that the date is actually parseable.
 */
function isValidWeekOf(weekOf: string): boolean {
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
 */
function isValidRequestBody(body: unknown): body is Record<string, unknown> {
  return body !== null && typeof body === 'object' && !Array.isArray(body);
}

/**
 * Authentication middleware for write operations.
 * Checks for X-API-Key header when MEAL_PLANNER_API_KEY is set.
 * Skips authentication if no API key is configured (development mode).
 */
function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  // Skip auth if no API key is configured (development mode)
  if (!API_KEY) {
    next();
    return;
  }

  const providedKey = req.get('X-API-Key');

  if (!providedKey) {
    logger.warn({ method: req.method, path: req.path }, 'Missing API key');
    res.status(401).json({ error: 'API key required. Include X-API-Key header.' });
    return;
  }

  // Use timing-safe comparison to prevent timing attacks
  const keyBuffer = Buffer.from(API_KEY);
  const providedBuffer = Buffer.from(providedKey);

  if (keyBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(keyBuffer, providedBuffer)) {
    logger.warn({ method: req.method, path: req.path }, 'Invalid API key');
    res.status(403).json({ error: 'Invalid API key' });
    return;
  }

  next();
}

// Request logging middleware
app.use(logger.requestMiddleware);

// Static files
app.use(express.static(config.paths.public(import.meta.dirname)));

// --- App API routes ---

/**
 * GET /api/weeks/:weekOf
 * Retrieves a week's meals, creating the week if it doesn't exist.
 */
app.get('/api/weeks/:weekOf', (req: Request<{ weekOf: string }>, res: Response) => {
  try {
    if (!isValidWeekOf(req.params.weekOf)) {
      res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
      return;
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
 */
app.put('/api/weeks/:weekOf/days/:day', requireApiKey, (req: Request<{ weekOf: string; day: string }>, res: Response) => {
  try {
    if (!isValidWeekOf(req.params.weekOf)) {
      res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
      return;
    }

    if (!isValidRequestBody(req.body)) {
      res.status(400).json({ error: 'Invalid request body. Expected JSON object.' });
      return;
    }

    const dayIndex = parseInt(req.params.day, 10);
    if (isNaN(dayIndex) || dayIndex < 0 || dayIndex > 6) {
      res.status(400).json({ error: 'Invalid day index (0-6)' });
      return;
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
 */
app.get('/api/weeks', (_req: Request, res: Response) => {
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
 */
app.post('/api/weeks/:weekOf/copy', requireApiKey, (req: Request<{ weekOf: string }>, res: Response) => {
  try {
    if (!isValidWeekOf(req.params.weekOf)) {
      res.status(400).json({ error: 'Invalid source date format. Use YYYY-MM-DD' });
      return;
    }

    if (!isValidRequestBody(req.body)) {
      res.status(400).json({ error: 'Invalid request body. Expected JSON object.' });
      return;
    }

    const targetWeekOf = (req.body as Record<string, unknown>).targetWeekOf;
    if (!targetWeekOf || typeof targetWeekOf !== 'string') {
      res.status(400).json({ error: 'targetWeekOf is required' });
      return;
    }
    if (!isValidWeekOf(targetWeekOf)) {
      res.status(400).json({ error: 'Invalid target date format. Use YYYY-MM-DD' });
      return;
    }
    const result = db.copyWeek(req.params.weekOf, targetWeekOf);
    if (!result) {
      res.status(404).json({ error: 'Source week not found' });
      return;
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
 */
app.delete('/api/weeks/:weekOf', requireApiKey, (req: Request<{ weekOf: string }>, res: Response) => {
  try {
    if (!isValidWeekOf(req.params.weekOf)) {
      res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
      return;
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
 */
app.get('/api/schedule/current', (_req: Request, res: Response) => {
  try {
    const weekOf = db.getCurrentMonday();
    const week = db.getWeek(weekOf);
    if (!week) {
      res.json({ week_of: weekOf, days: [] });
      return;
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
 */
app.get('/api/schedule/upcoming', (_req: Request, res: Response) => {
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
 */
app.get('/api/schedule/:weekOf', (req: Request<{ weekOf: string }>, res: Response) => {
  try {
    if (!isValidWeekOf(req.params.weekOf)) {
      res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
      return;
    }
    const week = db.getWeek(req.params.weekOf);
    if (!week) {
      res.status(404).json({ error: 'Week not found' });
      return;
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
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err, method: req.method, path: req.path }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

// Export for testing
export { app, isValidWeekOf, isValidRequestBody };

// Start server only when run directly (not imported for tests)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  app.listen(config.port, () => {
    logger.info({ port: config.port }, 'Meal Planner server started');
    if (API_KEY) {
      logger.info('API key authentication enabled for write operations');
    }
  });
}
