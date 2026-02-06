/**
 * @fileoverview Database test helper for creating in-memory SQLite databases.
 * Provides isolated database instances for each test.
 */

import Database from 'better-sqlite3';
import { setTestDb, resetDb } from '../../src/db.js';

/**
 * Creates an in-memory SQLite database with the same schema as production.
 * Initializes tables, indexes, and foreign key constraints.
 */
export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

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
      baby_breakfast_consumed INTEGER DEFAULT 0,
      baby_lunch_consumed INTEGER DEFAULT 0,
      baby_dinner_consumed INTEGER DEFAULT 0,
      FOREIGN KEY (week_id) REFERENCES weeks(id) ON DELETE CASCADE,
      UNIQUE(week_id, day)
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ingredient TEXT UNIQUE NOT NULL,
      stock INTEGER DEFAULT 0,
      category TEXT DEFAULT '',
      pinned INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_days_week_id ON days(week_id);
    CREATE INDEX IF NOT EXISTS idx_weeks_week_of ON weeks(week_of);
  `);

  return db;
}

/**
 * Sets up a fresh in-memory database for testing.
 * Returns a cleanup function to reset the database after the test.
 */
export function setupTestDb(): { db: Database.Database; cleanup: () => void } {
  const db = createTestDb();
  setTestDb(db);

  return {
    db,
    cleanup: () => {
      resetDb();
    }
  };
}

/**
 * Helper to insert a test week directly into the database.
 * Useful for setting up test fixtures.
 */
export function insertTestWeek(db: Database.Database, weekOf: string): number {
  const result = db.prepare('INSERT INTO weeks (week_of) VALUES (?)').run(weekOf);
  const weekId = result.lastInsertRowid as number;

  // Create 7 empty days
  const insertDay = db.prepare('INSERT INTO days (week_id, day) VALUES (?, ?)');
  for (let i = 0; i < 7; i++) {
    insertDay.run(weekId, i);
  }

  return weekId;
}

/**
 * Helper to update a day in the test database.
 */
export function updateTestDay(
  db: Database.Database,
  weekId: number,
  dayIndex: number,
  fields: Record<string, string>
): void {
  const setClauses = Object.keys(fields).map(k => `${k} = ?`).join(', ');
  const values = [...Object.values(fields), weekId, dayIndex];
  db.prepare(`UPDATE days SET ${setClauses} WHERE week_id = ? AND day = ?`).run(...values);
}
