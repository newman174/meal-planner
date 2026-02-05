/**
 * @fileoverview Database layer for the Meal Planner application.
 * Provides SQLite database operations for managing weekly meal plans.
 * Uses better-sqlite3 with WAL mode for improved concurrency.
 * @module db
 */

import Database from 'better-sqlite3';
import config from './config.js';
import logger from './logger.js';
import type {
  WeekRecord,
  DayRecord,
  WeekWithDays,
  FormattedWeek,
  UpcomingDay,
  DayFieldKey,
  DateParts,
  InventoryItem,
  InventoryResponse
} from './types/index.js';

const DB_PATH = config.paths.db(import.meta.dirname);

let db: Database.Database | null = null;

/**
 * Gets or initializes the database connection.
 * Creates the database file if it doesn't exist and initializes the schema.
 * Uses WAL mode for better concurrent read/write performance.
 */
function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
    logger.info({ dbPath: DB_PATH }, 'Database connection established');
  }
  return db;
}

/** Column info from pragma table_info */
interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

/**
 * Initializes the database schema.
 * Creates weeks and days tables if they don't exist.
 * Handles migration from legacy column names.
 */
function initSchema(): void {
  if (!db) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS weeks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_of TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_id INTEGER NOT NULL,
      day INTEGER NOT NULL,
      baby_breakfast_cereal TEXT DEFAULT '',
      baby_breakfast_fruit TEXT DEFAULT '',
      baby_breakfast_yogurt TEXT DEFAULT '',
      baby_lunch_meat TEXT DEFAULT '',
      baby_lunch_vegetable TEXT DEFAULT '',
      baby_lunch_fruit TEXT DEFAULT '',
      baby_dinner_meat TEXT DEFAULT '',
      baby_dinner_vegetable TEXT DEFAULT '',
      baby_dinner_fruit TEXT DEFAULT '',
      adult_dinner TEXT DEFAULT '',
      note TEXT DEFAULT '',
      FOREIGN KEY (week_id) REFERENCES weeks(id) ON DELETE CASCADE,
      UNIQUE(week_id, day)
    );

    CREATE INDEX IF NOT EXISTS idx_days_week_id ON days(week_id);
    CREATE INDEX IF NOT EXISTS idx_weeks_week_of ON weeks(week_of);
  `);

  // Migrate: rename adult_dinner_note → note if the old column exists
  const cols = (db.pragma('table_info(days)') as ColumnInfo[]).map(c => c.name);
  if (cols.includes('adult_dinner_note')) {
    db.exec('ALTER TABLE days RENAME COLUMN adult_dinner_note TO note');
    logger.info('Migrated adult_dinner_note column to note');
  }

  // Migrate: 2-meal → 3-meal baby structure
  // Old: baby_lunch (cereal, fruit, yogurt), baby_dinner (cereal, fruit, vegetable)
  // New: baby_breakfast (cereal, fruit, yogurt), baby_lunch (meat, vegetable, fruit), baby_dinner (meat, vegetable, fruit)
  if (cols.includes('baby_lunch_cereal') && !cols.includes('baby_breakfast_cereal')) {
    logger.info('Migrating baby meal structure from 2-meal to 3-meal...');

    // Add new columns
    db.exec(`
      ALTER TABLE days ADD COLUMN baby_breakfast_cereal TEXT DEFAULT '';
      ALTER TABLE days ADD COLUMN baby_breakfast_fruit TEXT DEFAULT '';
      ALTER TABLE days ADD COLUMN baby_breakfast_yogurt TEXT DEFAULT '';
      ALTER TABLE days ADD COLUMN baby_lunch_meat TEXT DEFAULT '';
      ALTER TABLE days ADD COLUMN baby_lunch_vegetable TEXT DEFAULT '';
      ALTER TABLE days ADD COLUMN baby_dinner_meat TEXT DEFAULT '';
    `);

    // Copy old lunch → new breakfast (cereal, fruit, yogurt match exactly)
    db.exec(`
      UPDATE days SET
        baby_breakfast_cereal = baby_lunch_cereal,
        baby_breakfast_fruit = baby_lunch_fruit,
        baby_breakfast_yogurt = baby_lunch_yogurt
    `);

    // Drop old columns (SQLite 3.35+)
    db.exec(`
      ALTER TABLE days DROP COLUMN baby_lunch_cereal;
      ALTER TABLE days DROP COLUMN baby_lunch_yogurt;
      ALTER TABLE days DROP COLUMN baby_dinner_cereal;
    `);

    logger.info('Baby meal structure migration complete');
  }

  // Migrate: add consumed columns to days table
  const daysCols = (db.pragma('table_info(days)') as ColumnInfo[]).map(c => c.name);
  if (!daysCols.includes('baby_breakfast_consumed')) {
    db.exec(`
      ALTER TABLE days ADD COLUMN baby_breakfast_consumed INTEGER DEFAULT 0;
      ALTER TABLE days ADD COLUMN baby_lunch_consumed INTEGER DEFAULT 0;
      ALTER TABLE days ADD COLUMN baby_dinner_consumed INTEGER DEFAULT 0;
    `);
    logger.info('Added consumed columns to days table');
  }

  // Create inventory table
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ingredient TEXT UNIQUE NOT NULL,
      stock INTEGER DEFAULT 0
    );
  `);
}

/** Day names indexed by day number (0 = Monday, 6 = Sunday) */
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/** Number of days in a week */
const DAYS_PER_WEEK = 7;

/**
 * Whitelist mapping of user input field names to database column names.
 * This prevents SQL injection by ensuring only valid, pre-defined column
 * names are used in dynamic queries.
 */
const ALLOWED_DAY_FIELDS: Record<DayFieldKey, string> = {
  'baby_breakfast_cereal': 'baby_breakfast_cereal',
  'baby_breakfast_fruit': 'baby_breakfast_fruit',
  'baby_breakfast_yogurt': 'baby_breakfast_yogurt',
  'baby_lunch_meat': 'baby_lunch_meat',
  'baby_lunch_vegetable': 'baby_lunch_vegetable',
  'baby_lunch_fruit': 'baby_lunch_fruit',
  'baby_dinner_meat': 'baby_dinner_meat',
  'baby_dinner_vegetable': 'baby_dinner_vegetable',
  'baby_dinner_fruit': 'baby_dinner_fruit',
  'adult_dinner': 'adult_dinner',
  'note': 'note'
};

/** Maps baby meal field name prefixes to their sub-fields */
const BABY_MEAL_FIELDS: Record<string, { fields: string[]; category: Record<string, string> }> = {
  baby_breakfast: {
    fields: ['baby_breakfast_cereal', 'baby_breakfast_yogurt', 'baby_breakfast_fruit'],
    category: { baby_breakfast_cereal: 'cereal', baby_breakfast_yogurt: 'yogurt', baby_breakfast_fruit: 'fruit' }
  },
  baby_lunch: {
    fields: ['baby_lunch_meat', 'baby_lunch_vegetable', 'baby_lunch_fruit'],
    category: { baby_lunch_meat: 'meat', baby_lunch_vegetable: 'vegetable', baby_lunch_fruit: 'fruit' }
  },
  baby_dinner: {
    fields: ['baby_dinner_meat', 'baby_dinner_vegetable', 'baby_dinner_fruit'],
    category: { baby_dinner_meat: 'meat', baby_dinner_vegetable: 'vegetable', baby_dinner_fruit: 'fruit' }
  },
};

/**
 * Parses a date into its component parts in Eastern timezone.
 * Uses Intl.DateTimeFormat for reliable timezone conversion.
 */
function getEasternDateParts(date: Date = new Date()): DateParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts: DateParts = { year: '', month: '', day: '', hour: '', minute: '' };
  for (const { type, value } of formatter.formatToParts(date)) {
    parts[type] = value;
  }
  return parts;
}

/**
 * Gets the current date/time adjusted to Eastern timezone.
 */
function getEasternNow(): Date {
  const str = new Date().toLocaleString('en-US', { timeZone: config.timezone });
  return new Date(str);
}

/**
 * Gets the current time as a string in HH:MM format (Eastern timezone).
 */
function getEasternTimeString(): string {
  const parts = getEasternDateParts();
  return `${parts.hour}:${parts.minute}`;
}

/**
 * Calculates the Monday of the week containing the given date.
 * Used to normalize dates to week boundaries.
 */
function getMonday(date: Date | string): string | null {
  const d = date instanceof Date ? getEasternNow() : new Date(date as string);
  if (!(date instanceof Date)) {
    // If a string was passed, parse it as-is
    const parsed = new Date(date as string);
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
 */
function getCurrentMonday(): string {
  return getMonday(getEasternNow()) as string;
}

/**
 * Gets or creates a week record and its associated day records.
 * Uses INSERT OR IGNORE to handle concurrent requests safely.
 */
function getOrCreateWeek(weekOf: string): WeekRecord {
  const database = getDb();
  database.prepare('INSERT OR IGNORE INTO weeks (week_of) VALUES (?)').run(weekOf);
  const week = database.prepare('SELECT * FROM weeks WHERE week_of = ?').get(weekOf) as WeekRecord;

  // Check if days exist, create if not
  const existingDays = database.prepare('SELECT COUNT(*) as count FROM days WHERE week_id = ?').get(week.id) as { count: number };
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
 */
function getWeek(weekOf: string): WeekWithDays | null {
  const database = getDb();
  const week = database.prepare('SELECT * FROM weeks WHERE week_of = ?').get(weekOf) as WeekRecord | undefined;
  if (!week) return null;
  const days = database.prepare('SELECT * FROM days WHERE week_id = ? ORDER BY day').all(week.id) as DayRecord[];
  return { ...week, days };
}

/**
 * Gets a week, creating it if it doesn't exist.
 * Convenience function that combines getOrCreateWeek and getWeek.
 */
function getWeekWithCreate(weekOf: string): WeekWithDays {
  getOrCreateWeek(weekOf);
  return getWeek(weekOf) as WeekWithDays;
}

/**
 * Updates specific fields for a day in a week.
 * Only updates fields that are in the ALLOWED_DAY_FIELDS whitelist.
 * Truncates values to prevent database bloat.
 */
function updateDay(weekOf: string, dayIndex: number, fields: Record<string, unknown>): void {
  const database = getDb();
  const week = getOrCreateWeek(weekOf);
  const setClauses: string[] = [];
  const values: (string | number)[] = [];

  for (const [key, value] of Object.entries(fields)) {
    const columnName = ALLOWED_DAY_FIELDS[key as DayFieldKey];
    if (columnName && typeof value === 'string') {
      // Enforce max length to prevent database bloat
      const maxLen = key === 'note' ? config.maxNoteLength : config.maxFieldLength;
      const truncated = value.slice(0, maxLen);
      setClauses.push(`${columnName} = ?`);
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
 */
function listWeeks(): WeekRecord[] {
  const database = getDb();
  return database.prepare('SELECT * FROM weeks ORDER BY week_of DESC LIMIT ?').all(config.maxWeeksReturned) as WeekRecord[];
}

/**
 * Copies all meal data from one week to another.
 * Creates the target week if it doesn't exist.
 */
function copyWeek(sourceWeekOf: string, targetWeekOf: string): WeekWithDays | null {
  const source = getWeek(sourceWeekOf);
  if (!source) {
    logger.warn({ sourceWeekOf }, 'Copy failed: source week not found');
    return null;
  }

  const target = getOrCreateWeek(targetWeekOf);
  const database = getDb();
  const update = database.prepare(`
    UPDATE days SET
      baby_breakfast_cereal = ?, baby_breakfast_fruit = ?, baby_breakfast_yogurt = ?,
      baby_lunch_meat = ?, baby_lunch_vegetable = ?, baby_lunch_fruit = ?,
      baby_dinner_meat = ?, baby_dinner_vegetable = ?, baby_dinner_fruit = ?,
      adult_dinner = ?, note = ?
    WHERE week_id = ? AND day = ?
  `);

  const copyAll = database.transaction(() => {
    for (const day of source.days) {
      update.run(
        day.baby_breakfast_cereal, day.baby_breakfast_fruit, day.baby_breakfast_yogurt,
        day.baby_lunch_meat, day.baby_lunch_vegetable, day.baby_lunch_fruit,
        day.baby_dinner_meat, day.baby_dinner_vegetable, day.baby_dinner_fruit,
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

/** Date info for upcoming days calculation */
interface DateInfo {
  dateStr: string;
  weekOf: string | null;
  dayIndex: number;
}

/**
 * Gets meal data for the upcoming N days starting from today.
 * Spans multiple weeks if necessary.
 */
function getUpcomingDays(count: number): UpcomingDay[] {
  const today = getEasternNow();

  // Pre-compute all dates and needed weeks to batch fetch
  const dates: DateInfo[] = [];
  const weekOfsNeeded = new Set<string>();
  for (let i = 0; i < count; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const weekOf = getMonday(d);
    if (weekOf) weekOfsNeeded.add(weekOf);
    const dow = d.getDay();
    // Convert Sunday (0) to index 6, otherwise subtract 1 to get 0-based index from Monday
    const dayIndex = dow === 0 ? 6 : dow - 1;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    dates.push({ dateStr: `${y}-${m}-${dd}`, weekOf, dayIndex });
  }

  // Batch fetch all needed weeks
  const weeksCache: Record<string, WeekWithDays | null> = {};
  for (const weekOf of weekOfsNeeded) {
    weeksCache[weekOf] = getWeek(weekOf);
  }

  // Build results using cached weeks
  const results: UpcomingDay[] = [];
  for (const { dateStr, weekOf, dayIndex } of dates) {
    const week = weekOf ? weeksCache[weekOf] : null;
    const dayData = week ? week.days.find(r => r.day === dayIndex) : null;
    if (dayData) {
      results.push({
        date: dateStr,
        day: DAY_NAMES[dayIndex],
        baby: {
          breakfast: { cereal: dayData.baby_breakfast_cereal, fruit: dayData.baby_breakfast_fruit, yogurt: dayData.baby_breakfast_yogurt },
          lunch: { meat: dayData.baby_lunch_meat, vegetable: dayData.baby_lunch_vegetable, fruit: dayData.baby_lunch_fruit },
          dinner: { meat: dayData.baby_dinner_meat, vegetable: dayData.baby_dinner_vegetable, fruit: dayData.baby_dinner_fruit }
        },
        adult: { dinner: dayData.adult_dinner },
        note: dayData.note
      });
    } else {
      results.push({
        date: dateStr,
        day: DAY_NAMES[dayIndex],
        baby: {
          breakfast: { cereal: '', fruit: '', yogurt: '' },
          lunch: { meat: '', vegetable: '', fruit: '' },
          dinner: { meat: '', vegetable: '', fruit: '' }
        },
        adult: { dinner: '' },
        note: ''
      });
    }
  }
  return results;
}

/**
 * Deletes a week and all its associated days (via CASCADE).
 */
function deleteWeek(weekOf: string): void {
  const database = getDb();
  const result = database.prepare('DELETE FROM weeks WHERE week_of = ?').run(weekOf);
  if (result.changes > 0) {
    logger.info({ weekOf }, 'Week deleted');
  }
}

/**
 * Formats a week object for the public API response.
 * Transforms the internal database structure into a cleaner nested format.
 */
function formatWeekForApi(weekData: WeekWithDays | null): FormattedWeek | null {
  if (!weekData) return null;
  return {
    week_of: weekData.week_of,
    days: weekData.days.map(d => ({
      day: DAY_NAMES[d.day],
      baby: {
        breakfast: { cereal: d.baby_breakfast_cereal, fruit: d.baby_breakfast_fruit, yogurt: d.baby_breakfast_yogurt },
        lunch: { meat: d.baby_lunch_meat, vegetable: d.baby_lunch_vegetable, fruit: d.baby_lunch_fruit },
        dinner: { meat: d.baby_dinner_meat, vegetable: d.baby_dinner_vegetable, fruit: d.baby_dinner_fruit }
      },
      adult: { dinner: d.adult_dinner },
      note: d.note
    }))
  };
}

/**
 * Normalizes an ingredient name for storage and comparison.
 * Trims whitespace and lowercases the name.
 */
function normalizeIngredient(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Gets the current inventory status with needed ingredients for the lookahead period.
 * @param lookahead - Number of days to look ahead for meal planning
 * @param todayOverride - Optional date string to use as today (for testing)
 */
function getInventory(lookahead: number, todayOverride?: string): InventoryResponse {
  const database = getDb();
  const today = todayOverride ? new Date(todayOverride + 'T12:00:00') : getEasternNow();

  // Helper to format Date as YYYY-MM-DDTHH:MM:SS string
  // Adding time component avoids UTC/local timezone parsing issues in getMonday
  const formatDateStr = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}T12:00:00`;
  };

  const dayRecords: DayRecord[] = [];
  const weekOfsNeeded = new Set<string>();

  for (let i = 0; i < lookahead; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const weekOf = getMonday(formatDateStr(d));
    if (weekOf) weekOfsNeeded.add(weekOf);
  }

  const weeksCache: Record<string, WeekWithDays | null> = {};
  for (const weekOf of weekOfsNeeded) {
    weeksCache[weekOf] = getWeek(weekOf);
  }

  for (let i = 0; i < lookahead; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const weekOf = getMonday(formatDateStr(d));
    const dow = d.getDay();
    const dayIndex = dow === 0 ? 6 : dow - 1;

    const week = weekOf ? weeksCache[weekOf] : null;
    const dayData = week?.days.find(r => r.day === dayIndex);
    if (dayData) dayRecords.push(dayData);
  }

  const ingredientMap = new Map<string, { displayName: string; category: string; needed: number }>();

  for (const day of dayRecords) {
    for (const [mealType, mealConfig] of Object.entries(BABY_MEAL_FIELDS)) {
      const consumedKey = `${mealType}_consumed` as keyof DayRecord;
      if (day[consumedKey]) continue;

      for (const field of mealConfig.fields) {
        const value = day[field as keyof DayRecord] as string;
        if (!value || !value.trim()) continue;

        const normalized = normalizeIngredient(value);
        const existing = ingredientMap.get(normalized);
        if (existing) {
          existing.needed++;
        } else {
          ingredientMap.set(normalized, {
            displayName: value.trim(),
            category: mealConfig.category[field],
            needed: 1,
          });
        }
      }
    }
  }

  const allStock = database.prepare('SELECT ingredient, stock FROM inventory').all() as { ingredient: string; stock: number }[];
  const stockMap = new Map(allStock.map(r => [r.ingredient, r.stock]));

  const items: InventoryItem[] = [];
  for (const [ingredient, data] of ingredientMap) {
    const stock = stockMap.get(ingredient) || 0;
    items.push({
      ingredient,
      displayName: data.displayName,
      category: data.category,
      stock,
      needed: data.needed,
      toMake: Math.max(0, data.needed - stock),
    });
  }

  const otherStock: InventoryItem[] = [];
  for (const [ingredient, stock] of stockMap) {
    if (stock > 0 && !ingredientMap.has(ingredient)) {
      otherStock.push({
        ingredient,
        displayName: ingredient,
        category: '',
        stock,
        needed: 0,
        toMake: 0,
      });
    }
  }

  return { items, otherStock, lookahead };
}

/**
 * Updates the stock level for an ingredient.
 * @param ingredient - The ingredient name (will be normalized)
 * @param update - Either an absolute stock value or a delta to apply
 */
function updateStock(ingredient: string, update: { stock?: number; delta?: number }): void {
  const database = getDb();
  const normalized = normalizeIngredient(ingredient);

  if (update.stock !== undefined) {
    database.prepare(
      'INSERT INTO inventory (ingredient, stock) VALUES (?, ?) ON CONFLICT(ingredient) DO UPDATE SET stock = excluded.stock'
    ).run(normalized, update.stock);
  } else if (update.delta !== undefined) {
    database.prepare(
      'INSERT INTO inventory (ingredient, stock) VALUES (?, ?) ON CONFLICT(ingredient) DO UPDATE SET stock = stock + ?'
    ).run(normalized, update.delta, update.delta);
  }
}

/**
 * Marks a baby meal as consumed and decrements inventory stock.
 * Idempotent - calling multiple times has no additional effect.
 * @param weekOf - The week containing the meal
 * @param dayIndex - The day index (0 = Monday, 6 = Sunday)
 * @param mealType - The meal type (baby_breakfast, baby_lunch, baby_dinner)
 */
function consumeMeal(weekOf: string, dayIndex: number, mealType: string): DayRecord | null {
  const database = getDb();
  const week = getWeek(weekOf);
  if (!week) return null;

  const day = week.days.find(d => d.day === dayIndex);
  if (!day) return null;

  const consumedKey = `${mealType}_consumed` as keyof DayRecord;
  if (day[consumedKey]) return day;

  const mealConfig = BABY_MEAL_FIELDS[mealType];
  if (!mealConfig) return null;

  const consumeTransaction = database.transaction(() => {
    database.prepare(`UPDATE days SET ${mealType}_consumed = 1 WHERE week_id = ? AND day = ?`).run(week.id, dayIndex);

    for (const field of mealConfig.fields) {
      const value = day[field as keyof DayRecord] as string;
      if (!value || !value.trim()) continue;
      const normalized = normalizeIngredient(value);
      database.prepare(
        'INSERT INTO inventory (ingredient, stock) VALUES (?, -1) ON CONFLICT(ingredient) DO UPDATE SET stock = stock - 1'
      ).run(normalized);
    }
  });

  consumeTransaction();

  const updatedWeek = getWeek(weekOf);
  return updatedWeek?.days.find(d => d.day === dayIndex) || null;
}

/**
 * Marks a baby meal as unconsumed and increments inventory stock.
 * Idempotent - calling multiple times has no additional effect.
 * @param weekOf - The week containing the meal
 * @param dayIndex - The day index (0 = Monday, 6 = Sunday)
 * @param mealType - The meal type (baby_breakfast, baby_lunch, baby_dinner)
 */
function unconsumeMeal(weekOf: string, dayIndex: number, mealType: string): DayRecord | null {
  const database = getDb();
  const week = getWeek(weekOf);
  if (!week) return null;

  const day = week.days.find(d => d.day === dayIndex);
  if (!day) return null;

  const consumedKey = `${mealType}_consumed` as keyof DayRecord;
  if (!day[consumedKey]) return day;

  const mealConfig = BABY_MEAL_FIELDS[mealType];
  if (!mealConfig) return null;

  const unconsumeTransaction = database.transaction(() => {
    database.prepare(`UPDATE days SET ${mealType}_consumed = 0 WHERE week_id = ? AND day = ?`).run(week.id, dayIndex);

    for (const field of mealConfig.fields) {
      const value = day[field as keyof DayRecord] as string;
      if (!value || !value.trim()) continue;
      const normalized = normalizeIngredient(value);
      database.prepare(
        'INSERT INTO inventory (ingredient, stock) VALUES (?, 1) ON CONFLICT(ingredient) DO UPDATE SET stock = stock + 1'
      ).run(normalized);
    }
  });

  unconsumeTransaction();

  const updatedWeek = getWeek(weekOf);
  return updatedWeek?.days.find(d => d.day === dayIndex) || null;
}

/**
 * Closes the database connection.
 * Called during graceful shutdown to ensure WAL checkpoint completes.
 */
function closeDb(): void {
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
process.on('uncaughtException', (err: Error) => {
  logger.fatal({ err }, 'Uncaught exception, closing database and exiting');
  closeDb();
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason: unknown) => {
  logger.fatal({ reason }, 'Unhandled promise rejection');
  closeDb();
  process.exit(1);
});

// ============ Test Helpers ============

/**
 * Injects a test database instance.
 * Only use in tests to replace the production database with an in-memory one.
 */
function setTestDb(testDb: Database.Database): void {
  db = testDb;
}

/**
 * Resets the database connection.
 * Used in tests to clean up between test runs.
 */
function resetDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export {
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
  getEasternDateParts,
  DAY_NAMES,
  ALLOWED_DAY_FIELDS,
  BABY_MEAL_FIELDS,
  getInventory,
  updateStock,
  consumeMeal,
  unconsumeMeal,
  closeDb,
  setTestDb,
  resetDb
};
