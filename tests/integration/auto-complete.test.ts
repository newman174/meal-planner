/**
 * @fileoverview Integration tests for auto-completing past baby meals
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDb, insertTestWeek, updateTestDay } from '../helpers/db-test-helper.js';
import {
  getWeek,
  autoCompletePastMeals,
} from '../../src/db.js';
import type Database from 'better-sqlite3';

describe('autoCompletePastMeals', () => {
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

  it('auto-completes past meals with ingredients', () => {
    // Monday 2025-01-06 is in the past relative to today=2025-01-08
    const weekId = insertTestWeek(db, '2025-01-06');
    updateTestDay(db, weekId, 0, { baby_lunch_meat: 'chicken', baby_lunch_vegetable: 'peas' });
    db.prepare('INSERT INTO inventory (ingredient, stock) VALUES (?, ?)').run('Chicken', 3);
    db.prepare('INSERT INTO inventory (ingredient, stock) VALUES (?, ?)').run('Peas', 2);

    const result = autoCompletePastMeals('2025-01-08');

    expect(result.completed).toBe(1); // 1 meal (baby_lunch on Monday)

    const week = getWeek('2025-01-06');
    expect(week?.days[0].baby_lunch_consumed).toBe(1);

    // Stock should be decremented
    const chicken = db.prepare('SELECT stock FROM inventory WHERE ingredient = ?').get('Chicken') as { stock: number };
    expect(chicken.stock).toBe(2);
    const peas = db.prepare('SELECT stock FROM inventory WHERE ingredient = ?').get('Peas') as { stock: number };
    expect(peas.stock).toBe(1);
  });

  it('does not touch today\'s meals', () => {
    const weekId = insertTestWeek(db, '2025-01-06');
    // Day 2 = Wednesday = 2025-01-08 (same as todayOverride)
    updateTestDay(db, weekId, 2, { baby_lunch_meat: 'chicken' });

    const result = autoCompletePastMeals('2025-01-08');

    expect(result.completed).toBe(0);
    const week = getWeek('2025-01-06');
    expect(week?.days[2].baby_lunch_consumed).toBe(0);
  });

  it('does not touch future meals', () => {
    const weekId = insertTestWeek(db, '2025-01-06');
    // Day 3 = Thursday = 2025-01-09 (future relative to 2025-01-08)
    updateTestDay(db, weekId, 3, { baby_lunch_meat: 'chicken' });

    const result = autoCompletePastMeals('2025-01-08');

    expect(result.completed).toBe(0);
    const week = getWeek('2025-01-06');
    expect(week?.days[3].baby_lunch_consumed).toBe(0);
  });

  it('skips past meals with empty ingredients', () => {
    const weekId = insertTestWeek(db, '2025-01-06');
    // Monday has no ingredients (all defaults to '')
    // This should not be auto-completed

    const result = autoCompletePastMeals('2025-01-08');

    expect(result.completed).toBe(0);
    const week = getWeek('2025-01-06');
    expect(week?.days[0].baby_lunch_consumed).toBe(0);
  });

  it('skips already-consumed meals (no double stock decrement)', () => {
    const weekId = insertTestWeek(db, '2025-01-06');
    updateTestDay(db, weekId, 0, { baby_lunch_meat: 'chicken' });
    db.prepare('INSERT INTO inventory (ingredient, stock) VALUES (?, ?)').run('Chicken', 3);

    // Manually consume first
    db.prepare('UPDATE days SET baby_lunch_consumed = 1 WHERE week_id = ? AND day = 0').run(weekId);
    db.prepare('UPDATE inventory SET stock = stock - 1 WHERE ingredient = ?').run('Chicken');

    const result = autoCompletePastMeals('2025-01-08');

    expect(result.completed).toBe(0);
    const chicken = db.prepare('SELECT stock FROM inventory WHERE ingredient = ?').get('Chicken') as { stock: number };
    expect(chicken.stock).toBe(2); // Only decremented once (manually)
  });

  it('selectively completes per-meal-type', () => {
    const weekId = insertTestWeek(db, '2025-01-06');
    updateTestDay(db, weekId, 0, {
      baby_breakfast_cereal: 'oats',
      baby_lunch_meat: 'chicken',
      // baby_dinner has no ingredients
    });

    const result = autoCompletePastMeals('2025-01-08');

    expect(result.completed).toBe(2); // breakfast + lunch, not dinner

    const week = getWeek('2025-01-06');
    expect(week?.days[0].baby_breakfast_consumed).toBe(1);
    expect(week?.days[0].baby_lunch_consumed).toBe(1);
    expect(week?.days[0].baby_dinner_consumed).toBe(0);
  });

  it('is idempotent (second call returns 0)', () => {
    const weekId = insertTestWeek(db, '2025-01-06');
    updateTestDay(db, weekId, 0, { baby_lunch_meat: 'chicken' });
    db.prepare('INSERT INTO inventory (ingredient, stock) VALUES (?, ?)').run('Chicken', 3);

    const first = autoCompletePastMeals('2025-01-08');
    expect(first.completed).toBe(1);

    const second = autoCompletePastMeals('2025-01-08');
    expect(second.completed).toBe(0);

    // Stock only decremented once
    const chicken = db.prepare('SELECT stock FROM inventory WHERE ingredient = ?').get('Chicken') as { stock: number };
    expect(chicken.stock).toBe(2);
  });

  it('handles multiple past days across weeks', () => {
    // Week 1: Monday and Tuesday have meals
    const weekId1 = insertTestWeek(db, '2025-01-06');
    updateTestDay(db, weekId1, 0, { baby_lunch_meat: 'chicken' });
    updateTestDay(db, weekId1, 1, { baby_dinner_meat: 'beef' });

    // Week 2: Monday has a meal
    const weekId2 = insertTestWeek(db, '2025-01-13');
    updateTestDay(db, weekId2, 0, { baby_breakfast_fruit: 'banana' });

    // Today is 2025-01-15 (Wednesday of week 2) — all 3 days are in the past
    const result = autoCompletePastMeals('2025-01-15');

    expect(result.completed).toBe(3);
  });

  it('completes all three meal types on same day', () => {
    const weekId = insertTestWeek(db, '2025-01-06');
    updateTestDay(db, weekId, 0, {
      baby_breakfast_cereal: 'oats',
      baby_breakfast_fruit: 'banana',
      baby_lunch_meat: 'chicken',
      baby_lunch_vegetable: 'peas',
      baby_dinner_meat: 'beef',
      baby_dinner_fruit: 'apple',
    });

    const result = autoCompletePastMeals('2025-01-08');

    expect(result.completed).toBe(3); // All 3 meals

    const week = getWeek('2025-01-06');
    expect(week?.days[0].baby_breakfast_consumed).toBe(1);
    expect(week?.days[0].baby_lunch_consumed).toBe(1);
    expect(week?.days[0].baby_dinner_consumed).toBe(1);
  });
});
