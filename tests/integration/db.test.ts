/**
 * @fileoverview Integration tests for database operations in db.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDb, insertTestWeek, updateTestDay } from '../helpers/db-test-helper.js';
import {
  getOrCreateWeek,
  getWeek,
  updateDay,
  copyWeek,
  deleteWeek,
  formatWeekForApi,
  listWeeks,
  DAY_NAMES
} from '../../src/db.js';
import type Database from 'better-sqlite3';

describe('Database Operations', () => {
  let db: Database.Database;
  let cleanup: () => void;

  beforeEach(() => {
    const testSetup = setupTestDb();
    db = testSetup.db;
    cleanup = testSetup.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  describe('getOrCreateWeek', () => {
    it('creates a new week if it does not exist', () => {
      const week = getOrCreateWeek('2025-01-06');

      expect(week).toBeDefined();
      expect(week.week_of).toBe('2025-01-06');
      expect(week.id).toBeGreaterThan(0);
    });

    it('returns existing week if it already exists', () => {
      const weekId = insertTestWeek(db, '2025-01-13');

      const week = getOrCreateWeek('2025-01-13');

      expect(week.id).toBe(weekId);
      expect(week.week_of).toBe('2025-01-13');
    });

    it('creates 7 days for a new week', () => {
      getOrCreateWeek('2025-01-20');

      const days = db.prepare('SELECT * FROM days WHERE week_id = 1 ORDER BY day').all();
      expect(days).toHaveLength(7);
    });

    it('does not create duplicate days for existing week', () => {
      const weekId = insertTestWeek(db, '2025-01-27');

      // Call getOrCreateWeek again
      getOrCreateWeek('2025-01-27');

      const days = db.prepare('SELECT * FROM days WHERE week_id = ?').all(weekId);
      expect(days).toHaveLength(7);
    });
  });

  describe('getWeek', () => {
    it('returns null for non-existent week', () => {
      const week = getWeek('2025-02-03');
      expect(week).toBeNull();
    });

    it('returns week with days for existing week', () => {
      insertTestWeek(db, '2025-02-10');

      const week = getWeek('2025-02-10');

      expect(week).not.toBeNull();
      expect(week?.week_of).toBe('2025-02-10');
      expect(week?.days).toHaveLength(7);
    });

    it('returns days in correct order (0-6)', () => {
      insertTestWeek(db, '2025-02-17');

      const week = getWeek('2025-02-17');

      expect(week?.days.map(d => d.day)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });
  });

  describe('updateDay', () => {
    it('updates allowed fields', () => {
      insertTestWeek(db, '2025-02-24');

      updateDay('2025-02-24', 0, {
        adult_dinner: 'Pasta',
        baby_breakfast_cereal: 'Oatmeal'
      });

      const week = getWeek('2025-02-24');
      const monday = week?.days.find(d => d.day === 0);

      expect(monday?.adult_dinner).toBe('Pasta');
      expect(monday?.baby_breakfast_cereal).toBe('Oatmeal');
    });

    it('ignores non-allowed fields', () => {
      insertTestWeek(db, '2025-03-03');

      // These fields should be ignored (SQL injection attempt)
      updateDay('2025-03-03', 0, {
        adult_dinner: 'Salad',
        id: '999',
        week_id: '999',
        __proto__: 'malicious'
      } as Record<string, string>);

      const week = getWeek('2025-03-03');
      const monday = week?.days.find(d => d.day === 0);

      expect(monday?.adult_dinner).toBe('Salad');
      // id and week_id should not be changed
      expect(monday?.id).not.toBe(999);
    });

    it('creates week if it does not exist', () => {
      updateDay('2025-03-10', 2, { adult_dinner: 'Pizza' });

      const week = getWeek('2025-03-10');
      expect(week).not.toBeNull();
      expect(week?.days.find(d => d.day === 2)?.adult_dinner).toBe('Pizza');
    });

    it('truncates values exceeding max length', () => {
      insertTestWeek(db, '2025-03-17');

      const longValue = 'a'.repeat(600); // Exceeds 500 char limit
      updateDay('2025-03-17', 0, { adult_dinner: longValue });

      const week = getWeek('2025-03-17');
      const monday = week?.days.find(d => d.day === 0);

      expect(monday?.adult_dinner.length).toBe(500);
    });

    it('allows longer notes up to 1000 chars', () => {
      insertTestWeek(db, '2025-03-24');

      const longNote = 'a'.repeat(800);
      updateDay('2025-03-24', 0, { note: longNote });

      const week = getWeek('2025-03-24');
      const monday = week?.days.find(d => d.day === 0);

      expect(monday?.note.length).toBe(800);
    });
  });

  describe('copyWeek', () => {
    it('copies all meal data to target week', () => {
      const sourceId = insertTestWeek(db, '2025-04-07');
      updateTestDay(db, sourceId, 0, {
        adult_dinner: 'Steak',
        baby_breakfast_cereal: 'Rice cereal',
        note: 'Special note'
      });

      const result = copyWeek('2025-04-07', '2025-04-14');

      expect(result).not.toBeNull();
      expect(result?.week_of).toBe('2025-04-14');

      const targetMonday = result?.days.find(d => d.day === 0);
      expect(targetMonday?.adult_dinner).toBe('Steak');
      expect(targetMonday?.baby_breakfast_cereal).toBe('Rice cereal');
      expect(targetMonday?.note).toBe('Special note');
    });

    it('returns null if source week does not exist', () => {
      const result = copyWeek('2025-04-21', '2025-04-28');
      expect(result).toBeNull();
    });

    it('creates target week if it does not exist', () => {
      insertTestWeek(db, '2025-05-05');

      copyWeek('2025-05-05', '2025-05-12');

      const targetWeek = getWeek('2025-05-12');
      expect(targetWeek).not.toBeNull();
    });

    it('overwrites existing target week data', () => {
      const sourceId = insertTestWeek(db, '2025-05-19');
      const targetId = insertTestWeek(db, '2025-05-26');

      updateTestDay(db, sourceId, 0, { adult_dinner: 'New dinner' });
      updateTestDay(db, targetId, 0, { adult_dinner: 'Old dinner' });

      copyWeek('2025-05-19', '2025-05-26');

      const target = getWeek('2025-05-26');
      expect(target?.days.find(d => d.day === 0)?.adult_dinner).toBe('New dinner');
    });
  });

  describe('deleteWeek', () => {
    it('deletes week and all its days (cascade)', () => {
      insertTestWeek(db, '2025-06-02');

      deleteWeek('2025-06-02');

      const week = getWeek('2025-06-02');
      expect(week).toBeNull();

      // Verify days are also deleted
      const days = db.prepare('SELECT * FROM days').all();
      expect(days).toHaveLength(0);
    });

    it('does nothing if week does not exist', () => {
      // Should not throw
      expect(() => deleteWeek('2025-06-09')).not.toThrow();
    });
  });

  describe('listWeeks', () => {
    it('returns empty array when no weeks exist', () => {
      const weeks = listWeeks();
      expect(weeks).toEqual([]);
    });

    it('returns weeks ordered by date descending', () => {
      insertTestWeek(db, '2025-06-16');
      insertTestWeek(db, '2025-06-23');
      insertTestWeek(db, '2025-06-30');

      const weeks = listWeeks();

      expect(weeks).toHaveLength(3);
      expect(weeks[0].week_of).toBe('2025-06-30');
      expect(weeks[1].week_of).toBe('2025-06-23');
      expect(weeks[2].week_of).toBe('2025-06-16');
    });
  });

  describe('formatWeekForApi', () => {
    it('returns null for null input', () => {
      const result = formatWeekForApi(null);
      expect(result).toBeNull();
    });

    it('transforms week structure correctly', () => {
      const weekId = insertTestWeek(db, '2025-07-07');
      updateTestDay(db, weekId, 0, {
        baby_breakfast_cereal: 'Oats',
        baby_breakfast_fruit: 'Banana',
        baby_breakfast_yogurt: 'Plain',
        baby_lunch_meat: 'Chicken',
        baby_lunch_vegetable: 'Peas',
        baby_lunch_fruit: 'Apple',
        baby_dinner_meat: 'Turkey',
        baby_dinner_vegetable: 'Carrots',
        baby_dinner_fruit: 'Pear',
        adult_dinner: 'Salmon',
        note: 'Test note'
      });

      const week = getWeek('2025-07-07');
      const result = formatWeekForApi(week);

      expect(result).not.toBeNull();
      expect(result?.week_of).toBe('2025-07-07');
      expect(result?.days).toHaveLength(7);

      const monday = result?.days[0];
      expect(monday?.day).toBe('Monday');
      expect(monday?.baby.breakfast).toEqual({
        cereal: 'Oats',
        fruit: 'Banana',
        yogurt: 'Plain'
      });
      expect(monday?.baby.lunch).toEqual({
        meat: 'Chicken',
        vegetable: 'Peas',
        fruit: 'Apple'
      });
      expect(monday?.baby.dinner).toEqual({
        meat: 'Turkey',
        vegetable: 'Carrots',
        fruit: 'Pear'
      });
      expect(monday?.adult.dinner).toBe('Salmon');
      expect(monday?.note).toBe('Test note');
    });

    it('uses correct day names', () => {
      insertTestWeek(db, '2025-07-14');
      const week = getWeek('2025-07-14');
      const result = formatWeekForApi(week);

      const dayNames = result?.days.map(d => d.day);
      expect(dayNames).toEqual(DAY_NAMES);
    });
  });
});
