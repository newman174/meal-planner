const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

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
  const week = db.getWeekWithCreate(req.params.weekOf);
  res.json(week);
});

// Update a specific day's meals
app.put('/api/weeks/:weekOf/days/:day', (req, res) => {
  const dayIndex = parseInt(req.params.day, 10);
  if (isNaN(dayIndex) || dayIndex < 0 || dayIndex > 6) {
    return res.status(400).json({ error: 'Invalid day index (0-6)' });
  }
  db.updateDay(req.params.weekOf, dayIndex, req.body);
  const week = db.getWeek(req.params.weekOf);
  res.json(week);
});

// List all saved weeks
app.get('/api/weeks', (req, res) => {
  const weeks = db.listWeeks();
  res.json(weeks);
});

// Copy a week to a new week
app.post('/api/weeks/:weekOf/copy', (req, res) => {
  const { targetWeekOf } = req.body;
  if (!targetWeekOf) {
    return res.status(400).json({ error: 'targetWeekOf is required' });
  }
  const result = db.copyWeek(req.params.weekOf, targetWeekOf);
  if (!result) {
    return res.status(404).json({ error: 'Source week not found' });
  }
  res.json(result);
});

// Delete a week
app.delete('/api/weeks/:weekOf', (req, res) => {
  db.deleteWeek(req.params.weekOf);
  res.json({ ok: true });
});

// --- Public API routes (for Home Assistant etc.) ---

app.get('/api/schedule/current', (req, res) => {
  const weekOf = db.getCurrentMonday();
  const week = db.getWeek(weekOf);
  if (!week) {
    return res.json({ week_of: weekOf, days: [] });
  }
  res.json(db.formatWeekForApi(week));
});

// Today + next 2 days
app.get('/api/schedule/upcoming', (_req, res) => {
  const days = db.getUpcomingDays(3);
  res.json({ days });
});

app.get('/api/schedule/:weekOf', (req, res) => {
  const week = db.getWeek(req.params.weekOf);
  if (!week) {
    return res.status(404).json({ error: 'Week not found' });
  }
  res.json(db.formatWeekForApi(week));
});

app.listen(PORT, () => {
  console.log(`Meal Planner running at http://localhost:${PORT}`);
});
