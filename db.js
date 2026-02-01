/**
 * @fileoverview Database layer for the Meal Planner application.
 * Provides SQLite database operations for managing weekly meal plans.
 * Uses better-sqlite3 with WAL mode for improved concurrency.
 * @module db
 */

const Database = require('better-sqlite3');
const path = require('path');
const logger = require('./logger');

const DB_PATH = path.join(__dirname, 'meals.db');

/** @type {Database.Database|null} */
let db = null;

/**
 * Gets or initializes the database connection.
 * Creates the database file if it doesn't exist and initializes the schema.
 * Uses WAL mode for better concurrent read/write performance.
 * @returns {Database.Database} The SQLite database instance
 */
function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
    logger.info({ dbPath: DB_PATH }, 'Database connection established');
  }
  return db;
}

/**
 * Initializes the database schema.
 * Creates weeks and days tables if they don't exist.
 * Handles migration from legacy column names.
 * @private
 */
function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS weeks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_of TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_id INTEGER NOT NULL,
      day INTEGER NOT NULL,
      baby_lunch_cereal TEXT DEFAULT '',
      baby_lunch_fruit TEXT DEFAULT '',
      baby_lunch_yogurt TEXT DEFAULT '',
      baby_dinner_cereal TEXT DEFAULT '',
      baby_dinner_fruit TEXT DEFAULT '',
      baby_dinner_vegetable TEXT DEFAULT '',
      adult_dinner TEXT DEFAULT '',
      note TEXT DEFAULT '',
      FOREIGN KEY (week_id) REFERENCES weeks(id) ON DELETE CASCADE,
      UNIQUE(week_id, day)
    );

    CREATE INDEX IF NOT EXISTS idx_days_week_id ON days(week_id);
    -- UNIQUE constraint creates implicit index, but explicit index ensures clarity
    -- and optimal query planning for frequent week_of lookups
    CREATE INDEX IF NOT EXISTS idx_weeks_week_of ON weeks(week_of);
  `);

  // Migrate: rename adult_dinner_note → note if the old column exists
  const cols = db.pragma('table_info(days)').map(c => c.name);
  if (cols.includes('adult_dinner_note')) {
    db.exec('ALTER TABLE days RENAME COLUMN adult_dinner_note TO note');
    logger.info('Migrated adult_dinner_note column to note');
  }
}

/** Day names indexed by day number (0 = Monday, 6 = Sunday) */
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** IANA timezone identifier for all date calculations */
const TIMEZONE = 'America/New_York';

/** Number of days in a week */
const DAYS_PER_WEEK = 7;

// Configuration constants
const MAX_FIELD_LENGTH = 500;
const MAX_NOTE_LENGTH = 1000;
const MAX_WEEKS_RETURNED = 52;

/**
 * Whitelist mapping of user input field names to database column names.
 * This prevents SQL injection by ensuring only valid, pre-defined column
 * names are used in dynamic queries. Keys are validated user input,
 * values are the actual database column names.
 * @constant {Object.<string, string>}
 */
const ALLOWED_DAY_FIELDS = {
  'baby_lunch_cereal': 'baby_lunch_cereal',
  'baby_lunch_fruit': 'baby_lunch_fruit',
  'baby_lunch_yogurt': 'baby_lunch_yogurt',
  'baby_dinner_cereal': 'baby_dinner_cereal',
  'baby_dinner_fruit': 'baby_dinner_fruit',
  'baby_dinner_vegetable': 'baby_dinner_vegetable',
  'adult_dinner': 'adult_dinner',
  'note': 'note'
};

/**
 * Parses a date into its component parts in Eastern timezone.
 * Uses Intl.DateTimeFormat for reliable timezone conversion.
 * @param {Date} [date=new Date()] - The date to parse
 * @returns {Object} Object with year, month, day, hour, minute properties
 */
function getEasternDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = {};
  for (const { type, value } of formatter.formatToParts(date)) {
    parts[type] = value;
  }
  return parts;
}

/**
 * Gets the current date/time adjusted to Eastern timezone.
 * @returns {Date} Date object representing current Eastern time
 */
function getEasternNow() {
  const str = new Date().toLocaleString('en-US', { timeZone: TIMEZONE });
  return new Date(str);
}

/**
 * Gets the current time as a string in HH:MM format (Eastern timezone).
 * @returns {string} Time string in HH:MM format
 * @example
 * getEasternTimeString(); // "14:30"
 */
function getEasternTimeString() {
  const parts = getEasternDateParts();
  return `${parts.hour}:${parts.minute}`;
}

/**
 * Calculates the Monday of the week containing the given date.
 * Used to normalize dates to week boundaries.
 * @param {Date|string} date - A Date object or date string (YYYY-MM-DD)
 * @returns {string} The Monday date in YYYY-MM-DD format
 * @example
 * getMonday('2024-01-17'); // "2024-01-15" (Wednesday → Monday)
 * getMonday(new Date());   // Monday of current week
 */
function getMonday(date) {
  const d = date instanceof Date ? getEasternNow() : new Date(date);
  if (!(date instanceof Date)) {
    // If a string was passed, parse it as-is
    const parsed = new Date(date);
    if (isNaN(parsed.getTime())) {
      logger.warn({ date }, 'Invalid date passed to getMonday');
      return null;
    }
    d.setFullYear(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }
  const day = d.getDay();
  // Convert Sunday (0) to 6, otherwise subtract 1 to get days since Monday
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/**
 * Gets the Monday of the current week in Eastern timezone.
 * @returns {string} Current Monday in YYYY-MM-DD format
 */
function getCurrentMonday() {
  return getMonday(getEasternNow());
}

/**
 * Gets or creates a week record and its associated day records.
 * Uses INSERT OR IGNORE to handle concurrent requests safely.
 * @param {string} weekOf - The Monday of the week in YYYY-MM-DD format
 * @returns {Object} The week record from the database
 * @throws {Error} If database operation fails
 */
function getOrCreateWeek(weekOf) {
  const database = getDb();
  // Use INSERT OR IGNORE to prevent race condition with concurrent requests
  database.prepare('INSERT OR IGNORE INTO weeks (week_of) VALUES (?)').run(weekOf);
  const week = database.prepare('SELECT * FROM weeks WHERE week_of = ?').get(weekOf);

  // Check if days exist, create if not
  const existingDays = database.prepare('SELECT COUNT(*) as count FROM days WHERE week_id = ?').get(week.id);
  if (existingDays.count === 0) {
    const insertDay = database.prepare('INSERT OR IGNORE INTO days (week_id, day) VALUES (?, ?)');
    const insertMany = database.transaction(() => {
      for (let i = 0; i < DAYS_PER_WEEK; i++) {
        insertDay.run(week.id, i);
      }
    });

    try {
      insertMany();
      logger.debug({ weekOf, weekId: week.id }, 'Created new week with days');
    } catch (err) {
      logger.error({ err, weekOf }, 'Failed to create days for week');
      throw err;
    }
  }
  return week;
}

/**
 * Retrieves a week and all its days from the database.
 * @param {string} weekOf - The Monday of the week in YYYY-MM-DD format
 * @returns {Object|null} Week object with days array, or null if not found
 * @example
 * const week = getWeek('2024-01-15');
 * // { id: 1, week_of: '2024-01-15', days: [...] }
 */
function getWeek(weekOf) {
  const database = getDb();
  const week = database.prepare('SELECT * FROM weeks WHERE week_of = ?').get(weekOf);
  if (!week) return null;
  const days = database.prepare('SELECT * FROM days WHERE week_id = ? ORDER BY day').all(week.id);
  return { ...week, days };
}

/**
 * Gets a week, creating it if it doesn't exist.
 * Convenience function that combines getOrCreateWeek and getWeek.
 * @param {string} weekOf - The Monday of the week in YYYY-MM-DD format
 * @returns {Object} Week object with days array
 */
function getWeekWithCreate(weekOf) {
  getOrCreateWeek(weekOf);
  return getWeek(weekOf);
}

/**
 * Updates specific fields for a day in a week.
 * Only updates fields that are in the ALLOWED_DAY_FIELDS whitelist.
 * Truncates values to prevent database bloat.
 * @param {string} weekOf - The Monday of the week in YYYY-MM-DD format
 * @param {number} dayIndex - Day index (0=Monday, 6=Sunday)
 * @param {Object} fields - Key-value pairs of fields to update
 * @throws {Error} If database operation fails
 * @example
 * updateDay('2024-01-15', 0, { adult_dinner: 'Pasta', note: 'Birthday!' });
 */
function updateDay(weekOf, dayIndex, fields) {
  const database = getDb();
  const week = getOrCreateWeek(weekOf);
  const setClauses = [];
  const values = [];

  for (const [key, value] of Object.entries(fields)) {
    const columnName = ALLOWED_DAY_FIELDS[key];  // Safe lookup - only mapped values used
    if (columnName && typeof value === 'string') {
      // Enforce max length to prevent database bloat
      const maxLen = key === 'note' ? MAX_NOTE_LENGTH : MAX_FIELD_LENGTH;
      const truncated = value.slice(0, maxLen);
      setClauses.push(`${columnName} = ?`);  // Uses mapped value, not user input
      values.push(truncated);
    }
  }

  if (setClauses.length === 0) return;
  values.push(week.id, dayIndex);
  database.prepare(
    `UPDATE days SET ${setClauses.join(', ')} WHERE week_id = ? AND day = ?`
  ).run(...values);

  logger.debug({ weekOf, dayIndex, fieldsUpdated: setClauses.length }, 'Day updated');
}

/**
 * Lists all saved weeks, ordered by date descending.
 * @returns {Array<Object>} Array of week records (id, week_of)
 */
function listWeeks() {
  const database = getDb();
  return database.prepare('SELECT * FROM weeks ORDER BY week_of DESC LIMIT ?').all(MAX_WEEKS_RETURNED);
}

/**
 * Copies all meal data from one week to another.
 * Creates the target week if it doesn't exist.
 * @param {string} sourceWeekOf - Source week Monday in YYYY-MM-DD format
 * @param {string} targetWeekOf - Target week Monday in YYYY-MM-DD format
 * @returns {Object|null} The newly copied week, or null if source not found
 * @throws {Error} If database transaction fails
 */
function copyWeek(sourceWeekOf, targetWeekOf) {
  const source = getWeek(sourceWeekOf);
  if (!source) {
    logger.warn({ sourceWeekOf }, 'Copy failed: source week not found');
    return null;
  }

  const target = getOrCreateWeek(targetWeekOf);
  const database = getDb();
  const update = database.prepare(`
    UPDATE days SET
      baby_lunch_cereal = ?, baby_lunch_fruit = ?, baby_lunch_yogurt = ?,
      baby_dinner_cereal = ?, baby_dinner_fruit = ?, baby_dinner_vegetable = ?,
      adult_dinner = ?, note = ?
    WHERE week_id = ? AND day = ?
  `);

  const copyAll = database.transaction(() => {
    for (const day of source.days) {
      update.run(
        day.baby_lunch_cereal, day.baby_lunch_fruit, day.baby_lunch_yogurt,
        day.baby_dinner_cereal, day.baby_dinner_fruit, day.baby_dinner_vegetable,
        day.adult_dinner, day.note,
        target.id, day.day
      );
    }
  });

  try {
    copyAll();
    logger.info({ sourceWeekOf, targetWeekOf }, 'Week copied successfully');
  } catch (err) {
    logger.error({ err, sourceWeekOf, targetWeekOf }, 'Failed to copy week');
    throw err;
  }

  return getWeek(targetWeekOf);
}

/**
 * Gets meal data for the upcoming N days starting from today.
 * Spans multiple weeks if necessary.
 * @param {number} count - Number of days to retrieve
 * @returns {Array<Object>} Array of day objects with formatted meal data
 * @example
 * const upcoming = getUpcomingDays(3);
 * // [{ date: '2024-01-17', day: 'Wednesday', baby: {...}, adult: {...} }, ...]
 */
function getUpcomingDays(count) {
  const today = getEasternNow();

  // Pre-compute all dates and needed weeks to batch fetch
  const dates = [];
  const weekOfsNeeded = new Set();
  for (let i = 0; i < count; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const weekOf = getMonday(d);
    weekOfsNeeded.add(weekOf);
    const dow = d.getDay();
    // Convert Sunday (0) to index 6, otherwise subtract 1 to get 0-based index from Monday
    const dayIndex = dow === 0 ? 6 : dow - 1;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    dates.push({ dateStr: `${y}-${m}-${dd}`, weekOf, dayIndex });
  }

  // Batch fetch all needed weeks
  const weeksCache = {};
  for (const weekOf of weekOfsNeeded) {
    weeksCache[weekOf] = getWeek(weekOf);
  }

  // Build results using cached weeks
  const results = [];
  for (const { dateStr, weekOf, dayIndex } of dates) {
    const week = weeksCache[weekOf];
    const dayData = week ? week.days.find(r => r.day === dayIndex) : null;
    if (dayData) {
      results.push({
        date: dateStr,
        day: DAY_NAMES[dayIndex],
        baby: {
          lunch: { cereal: dayData.baby_lunch_cereal, fruit: dayData.baby_lunch_fruit, yogurt: dayData.baby_lunch_yogurt },
          dinner: { cereal: dayData.baby_dinner_cereal, fruit: dayData.baby_dinner_fruit, vegetable: dayData.baby_dinner_vegetable }
        },
        adult: { dinner: dayData.adult_dinner },
        note: dayData.note
      });
    } else {
      results.push({
        date: dateStr,
        day: DAY_NAMES[dayIndex],
        baby: { lunch: { cereal: '', fruit: '', yogurt: '' }, dinner: { cereal: '', fruit: '', vegetable: '' } },
        adult: { dinner: '' },
        note: ''
      });
    }
  }
  return results;
}

/**
 * Deletes a week and all its associated days (via CASCADE).
 * @param {string} weekOf - The Monday of the week in YYYY-MM-DD format
 */
function deleteWeek(weekOf) {
  const database = getDb();
  const result = database.prepare('DELETE FROM weeks WHERE week_of = ?').run(weekOf);
  if (result.changes > 0) {
    logger.info({ weekOf }, 'Week deleted');
  }
}

/**
 * Formats a week object for the public API response.
 * Transforms the internal database structure into a cleaner nested format.
 * @param {Object} weekData - Week object from getWeek()
 * @returns {Object|null} Formatted week object, or null if input is null
 */
function formatWeekForApi(weekData) {
  if (!weekData) return null;
  return {
    week_of: weekData.week_of,
    days: weekData.days.map(d => ({
      day: DAY_NAMES[d.day],
      baby: {
        lunch: { cereal: d.baby_lunch_cereal, fruit: d.baby_lunch_fruit, yogurt: d.baby_lunch_yogurt },
        dinner: { cereal: d.baby_dinner_cereal, fruit: d.baby_dinner_fruit, vegetable: d.baby_dinner_vegetable }
      },
      adult: { dinner: d.adult_dinner },
      note: d.note
    }))
  };
}

/**
 * Closes the database connection.
 * Called during graceful shutdown to ensure WAL checkpoint completes.
 */
function closeDb() {
  if (db) {
    logger.info('Closing database connection');
    db.close();
    db = null;
  }
}

// Graceful shutdown handlers - close database connection
process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  closeDb();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully');
  closeDb();
  process.exit(0);
});

// Handle uncaught exceptions to prevent database connection leaks
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception, closing database and exiting');
  closeDb();
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.fatal({ reason }, 'Unhandled promise rejection');
  closeDb();
  process.exit(1);
});

module.exports = {
  getDb,
  getMonday,
  getCurrentMonday,
  getOrCreateWeek,
  getWeek,
  getWeekWithCreate,
  updateDay,
  listWeeks,
  copyWeek,
  deleteWeek,
  formatWeekForApi,
  getUpcomingDays,
  getEasternTimeString,
  DAY_NAMES,
  closeDb
};
