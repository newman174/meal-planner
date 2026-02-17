/**
 * @fileoverview Express server for the Meal Planner application.
 * Provides REST API endpoints for managing weekly meal plans.
 * Includes rate limiting and security headers.
 * @module server
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import config from './config.js';
import * as db from './db.js';
import logger from './logger.js';
import './types/index.js'; // Import for Express Request extension

// Read version from package.json at startup
const packageJson = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf-8'));
const APP_VERSION: string = packageJson.version;

const app = express();

// Trust first reverse proxy (e.g. nginx) so rate limiter sees real client IPs
app.set('trust proxy', 1);

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
  // Validate it's an actual calendar date (reject JS Date rollover like Feb 30 → Mar 2)
  const [year, month, day] = weekOf.split('-').map(Number);
  const parsed = new Date(weekOf + 'T00:00:00');
  if (isNaN(parsed.getTime())) return false;
  return parsed.getFullYear() === year && parsed.getMonth() + 1 === month && parsed.getDate() === day;
}

/**
 * Validates that a request body is a valid object (not null, array, or primitive).
 * Prevents prototype pollution and type confusion attacks.
 */
function isValidRequestBody(body: unknown): body is Record<string, unknown> {
  return body !== null && typeof body === 'object' && !Array.isArray(body);
}

// Request logging middleware
app.use(logger.requestMiddleware);

// Static files
app.use(express.static(config.paths.public(import.meta.dirname)));

// --- Version endpoint ---

/**
 * GET /api/version
 * Returns the application version from package.json.
 */
app.get('/api/version', (_req: Request, res: Response) => {
  res.json({ version: APP_VERSION });
});

/**
 * GET /api/suggestions
 * Returns distinct baby meal ingredient values grouped by category.
 * Used by the autocomplete feature on schedule input fields.
 */
app.get('/api/suggestions', (_req: Request, res: Response) => {
  try {
    const suggestions = db.getSuggestions();
    res.json(suggestions);
  } catch (err) {
    logger.error({ err }, 'Error fetching suggestions');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Constants used by route handlers ---

const VALID_LOOKAHEADS = [3, 5, 7];
const VALID_MEAL_TYPES = ['baby_breakfast', 'baby_lunch', 'baby_dinner'];

// --- Look-ahead endpoint ---

/**
 * GET /api/lookahead?days=N
 * Returns raw day records for the upcoming N days (3, 5, or 7).
 * Used by the look-ahead frontend view for inline editing.
 */
app.get('/api/lookahead', (req: Request, res: Response) => {
  try {
    const daysParam = parseInt(req.query.days as string, 10) || 7;
    if (!VALID_LOOKAHEADS.includes(daysParam)) {
      res.status(400).json({ error: 'Invalid days. Must be 3, 5, or 7.' });
      return;
    }
    const days = db.getLookaheadDays(daysParam);
    res.json({ days, count: days.length });
  } catch (err) {
    logger.error({ err }, 'Error fetching lookahead days');
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
*/
app.put('/api/weeks/:weekOf/days/:day', (req: Request<{ weekOf: string; day: string }>, res: Response) => {
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
*/
app.post('/api/weeks/:weekOf/copy', (req: Request<{ weekOf: string }>, res: Response) => {
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
*/
app.delete('/api/weeks/:weekOf', (req: Request<{ weekOf: string }>, res: Response) => {
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

// --- Inventory API routes ---

/**
 * GET /api/inventory/allocation
 * Returns per-day, per-field allocation map showing whether each baby meal
 * ingredient is covered by available stock.
 */
app.get('/api/inventory/allocation', (req: Request, res: Response) => {
  try {
    const weekOf = req.query.weekOf as string;
    if (!weekOf || !isValidWeekOf(weekOf)) {
      res.status(400).json({ error: 'weekOf query parameter required in YYYY-MM-DD format.' });
      return;
    }
    const todayOverride = config.nodeEnv !== 'production' ? req.query.today as string | undefined : undefined;
    const result = db.getAllocation(weekOf, todayOverride);
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'Error fetching allocation');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/inventory
 * Returns inventory items with needed counts and stock levels.
 */
app.get('/api/inventory', (req: Request, res: Response) => {
  try {
    const lookaheadParam = parseInt(req.query.lookahead as string, 10) || 7;
    if (!VALID_LOOKAHEADS.includes(lookaheadParam)) {
      res.status(400).json({ error: 'Invalid lookahead. Must be 3, 5, or 7.' });
      return;
    }

    const todayOverride = config.nodeEnv !== 'production' ? req.query.today as string | undefined : undefined;
    const result = db.getInventory(lookaheadParam, todayOverride);
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'Error fetching inventory');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/inventory/:ingredient
 * Updates stock for an ingredient (absolute or delta).
 */
app.put('/api/inventory/:ingredient', (req: Request<{ ingredient: string }>, res: Response) => {
  try {
    if (!isValidRequestBody(req.body)) {
      res.status(400).json({ error: 'Invalid request body.' });
      return;
    }

    const { stock, delta, pinned, category, noPrep } = req.body as { stock?: number; delta?: number; pinned?: boolean; category?: string; noPrep?: boolean | null };
    if (stock === undefined && delta === undefined && pinned === undefined && noPrep === undefined) {
      res.status(400).json({ error: 'Provide "stock", "delta", "pinned", or "noPrep".' });
      return;
    }

    if (stock !== undefined && typeof stock !== 'number') {
      res.status(400).json({ error: '"stock" must be a number.' });
      return;
    }
    if (delta !== undefined && typeof delta !== 'number') {
      res.status(400).json({ error: '"delta" must be a number.' });
      return;
    }

    let ingredient: string;
    try {
      ingredient = db.normalizeIngredient(decodeURIComponent(req.params.ingredient));
    } catch {
      res.status(400).json({ error: 'Invalid ingredient name encoding.' });
      return;
    }

    if (pinned === true) {
      if (!category || typeof category !== 'string' || !db.CATEGORY_SET.has(category)) {
        res.status(400).json({ error: `When pinning, category must be one of: ${[...db.CATEGORY_SET].join(', ')}` });
        return;
      }
      db.addManualItem(ingredient, category);
    } else if (pinned === false) {
      db.unpinItem(ingredient);
    }

    if (noPrep !== undefined) {
      if (noPrep !== null && typeof noPrep !== 'boolean') {
        res.status(400).json({ error: '"noPrep" must be a boolean or null.' });
        return;
      }
      db.setNoPrep(ingredient, noPrep);
    }

    if (stock !== undefined || delta !== undefined) {
      db.updateStock(ingredient, { stock, delta });
    }

    const database = db.getDb();
    const row = database.prepare('SELECT ingredient, stock, category, pinned, no_prep FROM inventory WHERE ingredient = ?').get(ingredient) as { ingredient: string; stock: number; category: string; pinned: number; no_prep: number | null } | undefined;
    res.json(row || { ingredient, stock: 0, category: '', pinned: 0, no_prep: null });
  } catch (err) {
    logger.error({ err, ingredient: req.params.ingredient }, 'Error updating inventory');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/inventory
 * Adds a manually pinned inventory item with a category.
 */
app.post('/api/inventory', (req: Request, res: Response) => {
  try {
    if (!isValidRequestBody(req.body)) {
      res.status(400).json({ error: 'Invalid request body.' });
      return;
    }

    const { ingredient, category } = req.body as { ingredient?: string; category?: string };

    if (!ingredient || typeof ingredient !== 'string' || !ingredient.trim()) {
      res.status(400).json({ error: 'ingredient is required and must be a non-empty string.' });
      return;
    }

    if (ingredient.trim().length > config.maxFieldLength) {
      res.status(400).json({ error: `ingredient must be ${config.maxFieldLength} characters or fewer.` });
      return;
    }

    if (!category || typeof category !== 'string' || !db.CATEGORY_SET.has(category)) {
      res.status(400).json({ error: `category must be one of: ${[...db.CATEGORY_SET].join(', ')}` });
      return;
    }

    const result = db.addManualItem(ingredient, category);
    res.status(201).json(result);
  } catch (err) {
    logger.error({ err }, 'Error adding manual inventory item');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/inventory/:ingredient
 * Deletes a manually pinned inventory item.
 */
app.delete('/api/inventory/:ingredient', (req: Request<{ ingredient: string }>, res: Response) => {
  try {
    let ingredient: string;
    try {
      ingredient = db.normalizeIngredient(decodeURIComponent(req.params.ingredient));
    } catch {
      res.status(400).json({ error: 'Invalid ingredient name encoding.' });
      return;
    }
    const deleted = db.deleteManualItem(ingredient);
    if (!deleted) {
      res.status(404).json({ error: 'Item not found or not a manual item.' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, ingredient: req.params.ingredient }, 'Error deleting inventory item');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/weeks/:weekOf/days/:day/consume
 * Marks a baby meal as consumed and decrements ingredient stock.
 */
app.put('/api/weeks/:weekOf/days/:day/consume', (req: Request<{ weekOf: string; day: string }>, res: Response) => {
  try {
    if (!isValidWeekOf(req.params.weekOf)) {
      res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
      return;
    }
    if (!isValidRequestBody(req.body)) {
      res.status(400).json({ error: 'Invalid request body.' });
      return;
    }

    const dayIndex = parseInt(req.params.day, 10);
    if (isNaN(dayIndex) || dayIndex < 0 || dayIndex > 6) {
      res.status(400).json({ error: 'Invalid day index (0-6)' });
      return;
    }

    const meal = (req.body as Record<string, unknown>).meal as string;
    if (!meal || !VALID_MEAL_TYPES.includes(meal)) {
      res.status(400).json({ error: 'Invalid meal. Must be baby_breakfast, baby_lunch, or baby_dinner.' });
      return;
    }

    const result = db.consumeMeal(req.params.weekOf, dayIndex, meal);
    if (!result) {
      res.status(404).json({ error: 'Day not found' });
      return;
    }
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'Error consuming meal');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/weeks/:weekOf/days/:day/unconsume
 * Unmarks a baby meal as consumed and increments ingredient stock.
 */
app.put('/api/weeks/:weekOf/days/:day/unconsume', (req: Request<{ weekOf: string; day: string }>, res: Response) => {
  try {
    if (!isValidWeekOf(req.params.weekOf)) {
      res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
      return;
    }
    if (!isValidRequestBody(req.body)) {
      res.status(400).json({ error: 'Invalid request body.' });
      return;
    }

    const dayIndex = parseInt(req.params.day, 10);
    if (isNaN(dayIndex) || dayIndex < 0 || dayIndex > 6) {
      res.status(400).json({ error: 'Invalid day index (0-6)' });
      return;
    }

    const meal = (req.body as Record<string, unknown>).meal as string;
    if (!meal || !VALID_MEAL_TYPES.includes(meal)) {
      res.status(400).json({ error: 'Invalid meal. Must be baby_breakfast, baby_lunch, or baby_dinner.' });
      return;
    }

    const result = db.unconsumeMeal(req.params.weekOf, dayIndex, meal);
    if (!result) {
      res.status(404).json({ error: 'Day not found' });
      return;
    }
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'Error unconsuming meal');
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
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'Meal Planner server started');
  });

  // Auto-complete past baby meals: run once on startup, then every 5 minutes
  db.autoCompletePastMeals();
  const autoCompleteInterval = setInterval(() => {
    try {
      db.autoCompletePastMeals();
    } catch (err) {
      logger.error({ err }, 'Auto-complete past meals failed');
    }
  }, config.autoCompleteIntervalMs);

  function shutdown(signal: string) {
    logger.info(`Received ${signal}, shutting down gracefully`);
    clearInterval(autoCompleteInterval);
    // Force exit if graceful shutdown stalls (e.g., hung connections)
    setTimeout(() => process.exit(1), 5000).unref();
    server.close(() => {
      db.closeDb();
      process.exit(0);
    });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err: Error) => {
    logger.fatal({ err }, 'Uncaught exception, closing database and exiting');
    db.closeDb();
    process.exit(1);
  });
  process.on('unhandledRejection', (reason: unknown) => {
    logger.fatal({ reason }, 'Unhandled promise rejection');
    db.closeDb();
    process.exit(1);
  });
}
