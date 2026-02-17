/**
 * @fileoverview Integration tests for GET /api/suggestions endpoint
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestClient, type TestClient } from '../helpers/api-test-helper.js';
import { setupTestDb, insertTestWeek, updateTestDay } from '../helpers/db-test-helper.js';
import type Database from 'better-sqlite3';

describe('GET /api/suggestions', () => {
  let client: TestClient;
  let db: Database.Database;
  let cleanup: () => void;

  beforeEach(() => {
    const testSetup = setupTestDb();
    db = testSetup.db;
    cleanup = testSetup.cleanup;
    client = createTestClient();
  });

  afterEach(() => {
    cleanup();
  });

  it('returns empty arrays for all categories when database is empty', async () => {
    const res = await client.get('/api/suggestions');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      cereal: [],
      yogurt: [],
      fruit: [],
      meat: [],
      vegetable: [],
    });
  });

  it('returns suggestions from populated baby meal fields', async () => {
    const weekId = insertTestWeek(db, '2025-01-06');
    updateTestDay(db, weekId, 0, {
      baby_breakfast_cereal: 'Oatmeal',
      baby_breakfast_fruit: 'Blueberries',
      baby_lunch_meat: 'Chicken',
      baby_lunch_vegetable: 'Peas',
      baby_dinner_fruit: 'Banana',
    });

    const res = await client.get('/api/suggestions');

    expect(res.status).toBe(200);
    expect(res.body.cereal).toContain('Oatmeal');
    expect(res.body.fruit).toContain('Blueberries');
    expect(res.body.fruit).toContain('Banana');
    expect(res.body.meat).toContain('Chicken');
    expect(res.body.vegetable).toContain('Peas');
  });

  it('deduplicates values across meals and days', async () => {
    const weekId = insertTestWeek(db, '2025-01-06');
    updateTestDay(db, weekId, 0, { baby_lunch_fruit: 'Apple' });
    updateTestDay(db, weekId, 1, { baby_dinner_fruit: 'apple' }); // lowercase variant
    updateTestDay(db, weekId, 2, { baby_breakfast_fruit: 'Apple' });

    const res = await client.get('/api/suggestions');

    expect(res.status).toBe(200);
    // All normalize to "Apple" — should appear only once
    expect(res.body.fruit.filter((v: string) => v === 'Apple')).toHaveLength(1);
  });

  it('includes pinned inventory items', async () => {
    db.prepare(
      "INSERT INTO inventory (ingredient, stock, category, pinned) VALUES ('Salmon', 3, 'meat', 1)"
    ).run();

    const res = await client.get('/api/suggestions');

    expect(res.status).toBe(200);
    expect(res.body.meat).toContain('Salmon');
  });

  it('does not include non-pinned inventory items without meal history', async () => {
    // Non-pinned item with stock but no meal usage
    db.prepare(
      "INSERT INTO inventory (ingredient, stock, category, pinned) VALUES ('Tofu', 5, 'meat', 0)"
    ).run();

    const res = await client.get('/api/suggestions');

    expect(res.status).toBe(200);
    expect(res.body.meat).not.toContain('Tofu');
  });

  it('returns sorted results per category', async () => {
    const weekId = insertTestWeek(db, '2025-01-06');
    updateTestDay(db, weekId, 0, { baby_lunch_fruit: 'Pear' });
    updateTestDay(db, weekId, 1, { baby_lunch_fruit: 'Apple' });
    updateTestDay(db, weekId, 2, { baby_dinner_fruit: 'Mango' });

    const res = await client.get('/api/suggestions');

    expect(res.status).toBe(200);
    expect(res.body.fruit).toEqual(['Apple', 'Mango', 'Pear']);
  });

  it('does not include adult_dinner or note values', async () => {
    const weekId = insertTestWeek(db, '2025-01-06');
    updateTestDay(db, weekId, 0, { adult_dinner: 'Pizza', note: 'Test note' });

    const res = await client.get('/api/suggestions');

    expect(res.status).toBe(200);
    // These should not appear in any category
    const allValues = Object.values(res.body).flat();
    expect(allValues).not.toContain('Pizza');
    expect(allValues).not.toContain('Test note');
  });

  it('normalizes values: trims whitespace and capitalizes first letter', async () => {
    const weekId = insertTestWeek(db, '2025-01-06');
    updateTestDay(db, weekId, 0, { baby_lunch_meat: '  chicken  ' });

    const res = await client.get('/api/suggestions');

    expect(res.status).toBe(200);
    expect(res.body.meat).toContain('Chicken');
    expect(res.body.meat).not.toContain('  chicken  ');
  });
});
