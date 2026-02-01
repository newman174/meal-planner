process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10kb' }));
app.use(helmet({
  contentSecurityPolicy: false // App uses inline styles; CSP would break it
}));
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500, // Higher limit for rapid field edits
  message: { error: 'Too many requests, please try again later' }
}));

// Input validation helper
function isValidWeekOf(weekOf) {
  return /^\d{4}-\d{2}-\d{2}$/.test(weekOf);
}

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
  });
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// --- App API routes ---

// Get a week's meals (creates if not exists)
app.get('/api/weeks/:weekOf', (req, res) => {
  try {
    if (!isValidWeekOf(req.params.weekOf)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }
    const week = db.getWeekWithCreate(req.params.weekOf);
    res.json(week);
  } catch (err) {
    console.error('Error fetching week:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update a specific day's meals
app.put('/api/weeks/:weekOf/days/:day', (req, res) => {
  try {
    if (!isValidWeekOf(req.params.weekOf)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }
    const dayIndex = parseInt(req.params.day, 10);
    if (isNaN(dayIndex) || dayIndex < 0 || dayIndex > 6) {
      return res.status(400).json({ error: 'Invalid day index (0-6)' });
    }
    db.updateDay(req.params.weekOf, dayIndex, req.body);
    const week = db.getWeek(req.params.weekOf);
    res.json(week);
  } catch (err) {
    console.error('Error updating day:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// List all saved weeks
app.get('/api/weeks', (req, res) => {
  try {
    const weeks = db.listWeeks();
    res.json(weeks);
  } catch (err) {
    console.error('Error listing weeks:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Copy a week to a new week
app.post('/api/weeks/:weekOf/copy', (req, res) => {
  try {
    if (!isValidWeekOf(req.params.weekOf)) {
      return res.status(400).json({ error: 'Invalid source date format. Use YYYY-MM-DD' });
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
    console.error('Error copying week:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a week
app.delete('/api/weeks/:weekOf', (req, res) => {
  try {
    if (!isValidWeekOf(req.params.weekOf)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }
    db.deleteWeek(req.params.weekOf);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error deleting week:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Public API routes (for Home Assistant etc.) ---

app.get('/api/schedule/current', (req, res) => {
  try {
    const weekOf = db.getCurrentMonday();
    const week = db.getWeek(weekOf);
    if (!week) {
      return res.json({ week_of: weekOf, days: [] });
    }
    res.json(db.formatWeekForApi(week));
  } catch (err) {
    console.error('Error fetching current schedule:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Today + next 2 days
app.get('/api/schedule/upcoming', (_req, res) => {
  try {
    const days = db.getUpcomingDays(3);
    res.json({ days, updated_at: db.getEasternTimeString() });
  } catch (err) {
    console.error('Error fetching upcoming schedule:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
    console.error('Error fetching schedule:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Meal Planner running at http://localhost:${PORT}`);
});
