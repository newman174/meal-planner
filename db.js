const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'meals.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

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
  `);

  // Migrate: rename adult_dinner_note → note if the old column exists
  const cols = db.pragma('table_info(days)').map(c => c.name);
  if (cols.includes('adult_dinner_note')) {
    db.exec('ALTER TABLE days RENAME COLUMN adult_dinner_note TO note');
  }
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TIMEZONE = 'America/New_York';

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

function getEasternNow() {
  const str = new Date().toLocaleString('en-US', { timeZone: TIMEZONE });
  return new Date(str);
}

function getEasternTimeString() {
  const parts = getEasternDateParts();
  return `${parts.hour}:${parts.minute}`;
}

function getMonday(date) {
  const d = date instanceof Date ? getEasternNow() : new Date(date);
  if (!(date instanceof Date)) {
    // If a string was passed, parse it as-is
    const parsed = new Date(date);
    d.setFullYear(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function getCurrentMonday() {
  return getMonday(getEasternNow());
}

function getOrCreateWeek(weekOf) {
  const db = getDb();
  let week = db.prepare('SELECT * FROM weeks WHERE week_of = ?').get(weekOf);
  if (!week) {
    const result = db.prepare('INSERT INTO weeks (week_of) VALUES (?)').run(weekOf);
    week = { id: result.lastInsertRowid, week_of: weekOf };
    const insertDay = db.prepare(
      'INSERT INTO days (week_id, day) VALUES (?, ?)'
    );
    const insertMany = db.transaction(() => {
      for (let i = 0; i < 7; i++) {
        insertDay.run(week.id, i);
      }
    });
    insertMany();
  }
  return week;
}

function getWeek(weekOf) {
  const db = getDb();
  const week = db.prepare('SELECT * FROM weeks WHERE week_of = ?').get(weekOf);
  if (!week) return null;
  const days = db.prepare('SELECT * FROM days WHERE week_id = ? ORDER BY day').all(week.id);
  return { ...week, days };
}

function getWeekWithCreate(weekOf) {
  getOrCreateWeek(weekOf);
  return getWeek(weekOf);
}

function updateDay(weekOf, dayIndex, fields) {
  const db = getDb();
  const week = getOrCreateWeek(weekOf);
  const allowed = [
    'baby_lunch_cereal', 'baby_lunch_fruit', 'baby_lunch_yogurt',
    'baby_dinner_cereal', 'baby_dinner_fruit', 'baby_dinner_vegetable',
    'adult_dinner', 'note'
  ];
  const setClauses = [];
  const values = [];
  for (const [key, value] of Object.entries(fields)) {
    if (allowed.includes(key) && typeof value === 'string') {
      setClauses.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (setClauses.length === 0) return;
  values.push(week.id, dayIndex);
  db.prepare(
    `UPDATE days SET ${setClauses.join(', ')} WHERE week_id = ? AND day = ?`
  ).run(...values);
}

function listWeeks() {
  const db = getDb();
  return db.prepare('SELECT * FROM weeks ORDER BY week_of DESC').all();
}

function copyWeek(sourceWeekOf, targetWeekOf) {
  const source = getWeek(sourceWeekOf);
  if (!source) return null;
  const target = getOrCreateWeek(targetWeekOf);
  const db = getDb();
  const update = db.prepare(`
    UPDATE days SET
      baby_lunch_cereal = ?, baby_lunch_fruit = ?, baby_lunch_yogurt = ?,
      baby_dinner_cereal = ?, baby_dinner_fruit = ?, baby_dinner_vegetable = ?,
      adult_dinner = ?, note = ?
    WHERE week_id = ? AND day = ?
  `);
  const copyAll = db.transaction(() => {
    for (const day of source.days) {
      update.run(
        day.baby_lunch_cereal, day.baby_lunch_fruit, day.baby_lunch_yogurt,
        day.baby_dinner_cereal, day.baby_dinner_fruit, day.baby_dinner_vegetable,
        day.adult_dinner, day.note,
        target.id, day.day
      );
    }
  });
  copyAll();
  return getWeek(targetWeekOf);
}

function getUpcomingDays(count) {
  const today = getEasternNow();
  const results = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const weekOf = getMonday(d);
    const dow = d.getDay();
    const dayIndex = dow === 0 ? 6 : dow - 1;
    const week = getWeek(weekOf);
    const dayData = week ? week.days.find(r => r.day === dayIndex) : null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${dd}`;
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

function deleteWeek(weekOf) {
  const db = getDb();
  db.prepare('DELETE FROM weeks WHERE week_of = ?').run(weekOf);
}

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

module.exports = {
  getDb, getMonday, getCurrentMonday, getOrCreateWeek, getWeek,
  getWeekWithCreate, updateDay, listWeeks, copyWeek, deleteWeek,
  formatWeekForApi, getUpcomingDays, getEasternTimeString, DAY_NAMES
};
