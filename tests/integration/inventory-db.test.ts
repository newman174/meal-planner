/**
 * @fileoverview Integration tests for inventory database operations
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDb, insertTestWeek, updateTestDay } from '../helpers/db-test-helper.js';
import {
  getWeek,
  getInventory,
  updateStock,
  consumeMeal,
  unconsumeMeal,
} from '../../src/db.js';
import type Database from 'better-sqlite3';

describe('Inventory Database Schema', () => {
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

  describe('consumed columns on days table', () => {
    it('days table has consumed columns with default 0', () => {
      insertTestWeek(db, '2025-01-06');
      const week = getWeek('2025-01-06');
      const monday = week?.days[0];

      expect(monday).toHaveProperty('baby_breakfast_consumed', 0);
      expect(monday).toHaveProperty('baby_lunch_consumed', 0);
      expect(monday).toHaveProperty('baby_dinner_consumed', 0);
    });
  });

  describe('inventory table', () => {
    it('inventory table exists and accepts inserts', () => {
      db.prepare('INSERT INTO inventory (ingredient, stock) VALUES (?, ?)').run('chicken', 3);
      const row = db.prepare('SELECT * FROM inventory WHERE ingredient = ?').get('chicken') as { ingredient: string; stock: number };

      expect(row.ingredient).toBe('chicken');
      expect(row.stock).toBe(3);
    });

    it('enforces unique ingredient constraint', () => {
      db.prepare('INSERT INTO inventory (ingredient, stock) VALUES (?, ?)').run('peas', 2);

      expect(() => {
        db.prepare('INSERT INTO inventory (ingredient, stock) VALUES (?, ?)').run('peas', 5);
      }).toThrow();
    });

    it('defaults stock to 0', () => {
      db.prepare('INSERT INTO inventory (ingredient) VALUES (?)').run('banana');
      const row = db.prepare('SELECT stock FROM inventory WHERE ingredient = ?').get('banana') as { stock: number };

      expect(row.stock).toBe(0);
    });
  });

  describe('getInventory', () => {
    it('returns empty items when no meals planned', () => {
      const result = getInventory(7, '2025-01-06');
      expect(result.items).toEqual([]);
      expect(result.otherStock).toEqual([]);
    });

    it('aggregates ingredients from upcoming days', () => {
      const weekId = insertTestWeek(db, '2025-01-06');
      updateTestDay(db, weekId, 0, { baby_lunch_meat: 'chicken', baby_lunch_vegetable: 'peas' });
      updateTestDay(db, weekId, 1, { baby_lunch_meat: 'chicken', baby_dinner_meat: 'beef' });

      const result = getInventory(7, '2025-01-06');

      const chicken = result.items.find(i => i.ingredient === 'chicken');
      expect(chicken).toBeDefined();
      expect(chicken!.needed).toBe(2);
      expect(chicken!.stock).toBe(0);
      expect(chicken!.toMake).toBe(2);
    });

    it('excludes consumed meals from needed count', () => {
      const weekId = insertTestWeek(db, '2025-01-06');
      updateTestDay(db, weekId, 0, { baby_lunch_meat: 'chicken' });
      updateTestDay(db, weekId, 1, { baby_lunch_meat: 'chicken' });
      db.prepare('UPDATE days SET baby_lunch_consumed = 1 WHERE week_id = ? AND day = 0').run(weekId);

      const result = getInventory(7, '2025-01-06');
      const chicken = result.items.find(i => i.ingredient === 'chicken');
      expect(chicken!.needed).toBe(1);
    });

    it('includes stock in toMake calculation', () => {
      const weekId = insertTestWeek(db, '2025-01-06');
      updateTestDay(db, weekId, 0, { baby_lunch_meat: 'chicken' });
      updateTestDay(db, weekId, 1, { baby_lunch_meat: 'chicken' });
      db.prepare('INSERT INTO inventory (ingredient, stock) VALUES (?, ?)').run('chicken', 1);

      const result = getInventory(7, '2025-01-06');
      const chicken = result.items.find(i => i.ingredient === 'chicken');
      expect(chicken!.stock).toBe(1);
      expect(chicken!.needed).toBe(2);
      expect(chicken!.toMake).toBe(1);
    });

    it('shows items with stock not in lookahead as otherStock', () => {
      db.prepare('INSERT INTO inventory (ingredient, stock) VALUES (?, ?)').run('turkey', 3);

      const result = getInventory(7, '2025-01-06');
      expect(result.items).toEqual([]);
      expect(result.otherStock).toHaveLength(1);
      expect(result.otherStock[0].ingredient).toBe('turkey');
    });

    it('normalizes ingredient names case-insensitively', () => {
      const weekId = insertTestWeek(db, '2025-01-06');
      updateTestDay(db, weekId, 0, { baby_lunch_meat: 'Chicken' });
      updateTestDay(db, weekId, 1, { baby_dinner_meat: 'chicken' });

      const result = getInventory(7, '2025-01-06');
      const chickenItems = result.items.filter(i => i.ingredient === 'chicken');
      expect(chickenItems).toHaveLength(1);
      expect(chickenItems[0].needed).toBe(2);
      expect(chickenItems[0].displayName).toBe('Chicken');
    });

    it('assigns correct categories', () => {
      const weekId = insertTestWeek(db, '2025-01-06');
      updateTestDay(db, weekId, 0, {
        baby_breakfast_cereal: 'oats',
        baby_breakfast_yogurt: 'plain',
        baby_breakfast_fruit: 'banana',
        baby_lunch_meat: 'chicken',
        baby_lunch_vegetable: 'peas',
      });

      const result = getInventory(7, '2025-01-06');
      expect(result.items.find(i => i.ingredient === 'oats')!.category).toBe('cereal');
      expect(result.items.find(i => i.ingredient === 'plain')!.category).toBe('yogurt');
      expect(result.items.find(i => i.ingredient === 'banana')!.category).toBe('fruit');
      expect(result.items.find(i => i.ingredient === 'chicken')!.category).toBe('meat');
      expect(result.items.find(i => i.ingredient === 'peas')!.category).toBe('vegetable');
    });

    it('crosses week boundaries for lookahead', () => {
      const weekId1 = insertTestWeek(db, '2025-01-06');
      updateTestDay(db, weekId1, 6, { baby_lunch_meat: 'chicken' });

      const weekId2 = insertTestWeek(db, '2025-01-13');
      updateTestDay(db, weekId2, 0, { baby_lunch_meat: 'chicken' });

      const result = getInventory(7, '2025-01-11');
      const chicken = result.items.find(i => i.ingredient === 'chicken');
      expect(chicken!.needed).toBe(2);
    });
  });

  describe('updateStock', () => {
    it('creates new inventory row with absolute stock', () => {
      updateStock('chicken', { stock: 5 });
      const row = db.prepare('SELECT * FROM inventory WHERE ingredient = ?').get('chicken') as { stock: number };
      expect(row.stock).toBe(5);
    });

    it('updates existing stock with absolute value', () => {
      db.prepare('INSERT INTO inventory (ingredient, stock) VALUES (?, ?)').run('chicken', 3);
      updateStock('chicken', { stock: 5 });
      const row = db.prepare('SELECT stock FROM inventory WHERE ingredient = ?').get('chicken') as { stock: number };
      expect(row.stock).toBe(5);
    });

    it('applies delta to existing stock', () => {
      db.prepare('INSERT INTO inventory (ingredient, stock) VALUES (?, ?)').run('chicken', 3);
      updateStock('chicken', { delta: 2 });
      const row = db.prepare('SELECT stock FROM inventory WHERE ingredient = ?').get('chicken') as { stock: number };
      expect(row.stock).toBe(5);
    });

    it('applies delta to non-existent ingredient (starts from 0)', () => {
      updateStock('peas', { delta: -1 });
      const row = db.prepare('SELECT stock FROM inventory WHERE ingredient = ?').get('peas') as { stock: number };
      expect(row.stock).toBe(-1);
    });

    it('normalizes ingredient name', () => {
      updateStock('  Chicken  ', { stock: 5 });
      const row = db.prepare('SELECT * FROM inventory WHERE ingredient = ?').get('chicken') as { ingredient: string; stock: number };
      expect(row.ingredient).toBe('chicken');
      expect(row.stock).toBe(5);
    });
  });

  describe('consumeMeal / unconsumeMeal', () => {
    it('consumeMeal sets flag and decrements stock', () => {
      const weekId = insertTestWeek(db, '2025-01-06');
      updateTestDay(db, weekId, 0, { baby_lunch_meat: 'chicken', baby_lunch_vegetable: 'peas', baby_lunch_fruit: 'apple' });
      db.prepare('INSERT INTO inventory (ingredient, stock) VALUES (?, ?)').run('chicken', 3);
      db.prepare('INSERT INTO inventory (ingredient, stock) VALUES (?, ?)').run('peas', 2);
      db.prepare('INSERT INTO inventory (ingredient, stock) VALUES (?, ?)').run('apple', 1);

      consumeMeal('2025-01-06', 0, 'baby_lunch');

      const week = getWeek('2025-01-06');
      expect(week?.days[0].baby_lunch_consumed).toBe(1);

      const chicken = db.prepare('SELECT stock FROM inventory WHERE ingredient = ?').get('chicken') as { stock: number };
      expect(chicken.stock).toBe(2);
    });

    it('consumeMeal creates inventory rows if they do not exist', () => {
      const weekId = insertTestWeek(db, '2025-01-06');
      updateTestDay(db, weekId, 0, { baby_lunch_meat: 'chicken' });

      consumeMeal('2025-01-06', 0, 'baby_lunch');

      const row = db.prepare('SELECT stock FROM inventory WHERE ingredient = ?').get('chicken') as { stock: number };
      expect(row.stock).toBe(-1);
    });

    it('consumeMeal is idempotent (does not double-decrement)', () => {
      const weekId = insertTestWeek(db, '2025-01-06');
      updateTestDay(db, weekId, 0, { baby_lunch_meat: 'chicken' });
      db.prepare('INSERT INTO inventory (ingredient, stock) VALUES (?, ?)').run('chicken', 3);

      consumeMeal('2025-01-06', 0, 'baby_lunch');
      consumeMeal('2025-01-06', 0, 'baby_lunch');

      const row = db.prepare('SELECT stock FROM inventory WHERE ingredient = ?').get('chicken') as { stock: number };
      expect(row.stock).toBe(2);
    });

    it('unconsumeMeal clears flag and increments stock', () => {
      const weekId = insertTestWeek(db, '2025-01-06');
      updateTestDay(db, weekId, 0, { baby_lunch_meat: 'chicken' });
      db.prepare('INSERT INTO inventory (ingredient, stock) VALUES (?, ?)').run('chicken', 2);

      consumeMeal('2025-01-06', 0, 'baby_lunch');
      unconsumeMeal('2025-01-06', 0, 'baby_lunch');

      const week = getWeek('2025-01-06');
      expect(week?.days[0].baby_lunch_consumed).toBe(0);

      const chicken = db.prepare('SELECT stock FROM inventory WHERE ingredient = ?').get('chicken') as { stock: number };
      expect(chicken.stock).toBe(2);
    });

    it('unconsumeMeal is idempotent (does not double-increment)', () => {
      const weekId = insertTestWeek(db, '2025-01-06');
      updateTestDay(db, weekId, 0, { baby_lunch_meat: 'chicken' });
      db.prepare('INSERT INTO inventory (ingredient, stock) VALUES (?, ?)').run('chicken', 3);

      consumeMeal('2025-01-06', 0, 'baby_lunch');
      unconsumeMeal('2025-01-06', 0, 'baby_lunch');
      unconsumeMeal('2025-01-06', 0, 'baby_lunch');

      const row = db.prepare('SELECT stock FROM inventory WHERE ingredient = ?').get('chicken') as { stock: number };
      expect(row.stock).toBe(3);
    });
  });
});
