/**
 * @fileoverview Integration tests for inventory database operations
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDb, insertTestWeek, updateTestDay } from '../helpers/db-test-helper.js';
import { getWeek } from '../../src/db.js';
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
});
