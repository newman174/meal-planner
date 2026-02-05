/**
 * @fileoverview Integration tests for API endpoints
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestClient, type TestClient } from '../helpers/api-test-helper.js';
import { setupTestDb, insertTestWeek, updateTestDay } from '../helpers/db-test-helper.js';
import type Database from 'better-sqlite3';

describe('API Endpoints', () => {
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

  describe('GET /api/weeks/:weekOf', () => {
    it('returns 200 and creates week if not exists', async () => {
      const res = await client.get('/api/weeks/2025-01-06');

      expect(res.status).toBe(200);
      expect(res.body.week_of).toBe('2025-01-06');
      expect(res.body.days).toHaveLength(7);
    });

    it('returns existing week data', async () => {
      const weekId = insertTestWeek(db, '2025-01-13');
      updateTestDay(db, weekId, 0, { adult_dinner: 'Pasta' });

      const res = await client.get('/api/weeks/2025-01-13');

      expect(res.status).toBe(200);
      expect(res.body.days[0].adult_dinner).toBe('Pasta');
    });

    it('returns 400 for invalid date format', async () => {
      const res = await client.get('/api/weeks/invalid-date');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid date format');
    });

    it('accepts dates that JavaScript rolls over (known JS Date behavior)', async () => {
      // JavaScript Date is lenient: 2025-02-30 becomes 2025-03-02
      // The API accepts this as valid since it's parseable
      const res = await client.get('/api/weeks/2025-02-30');

      expect(res.status).toBe(200);
      // The week is created for the rolled-over date
      expect(res.body.week_of).toBeDefined();
    });
  });

  describe('PUT /api/weeks/:weekOf/days/:day', () => {
    it('returns 200 and updates day', async () => {
      insertTestWeek(db, '2025-01-20');

      const res = await client
        .put('/api/weeks/2025-01-20/days/0')
        .send({ adult_dinner: 'Pizza' });

      expect(res.status).toBe(200);
      expect(res.body.days[0].adult_dinner).toBe('Pizza');
    });

    it('creates week if not exists', async () => {
      const res = await client
        .put('/api/weeks/2025-01-27/days/2')
        .send({ adult_dinner: 'Tacos' });

      expect(res.status).toBe(200);
      expect(res.body.days[2].adult_dinner).toBe('Tacos');
    });

    it('returns 400 for invalid weekOf', async () => {
      const res = await client
        .put('/api/weeks/bad-date/days/0')
        .send({ adult_dinner: 'Salad' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid date format');
    });

    it('returns 400 for invalid day index (negative)', async () => {
      const res = await client
        .put('/api/weeks/2025-02-03/days/-1')
        .send({ adult_dinner: 'Soup' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid day index');
    });

    it('returns 400 for invalid day index (>6)', async () => {
      const res = await client
        .put('/api/weeks/2025-02-03/days/7')
        .send({ adult_dinner: 'Soup' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid day index');
    });

    it('returns 400 for non-numeric day', async () => {
      const res = await client
        .put('/api/weeks/2025-02-03/days/monday')
        .send({ adult_dinner: 'Soup' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid day index');
    });

    it('returns 400 for invalid request body (array)', async () => {
      const res = await client
        .put('/api/weeks/2025-02-03/days/0')
        .send([{ adult_dinner: 'Bad' }]);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid request body');
    });

    it('ignores non-allowed fields', async () => {
      insertTestWeek(db, '2025-02-10');

      const res = await client
        .put('/api/weeks/2025-02-10/days/0')
        .send({
          adult_dinner: 'Steak',
          malicious_field: 'DROP TABLE days;'
        });

      expect(res.status).toBe(200);
      expect(res.body.days[0].adult_dinner).toBe('Steak');
      // Verify malicious field was not added
      expect(res.body.days[0]).not.toHaveProperty('malicious_field');
    });
  });

  describe('GET /api/weeks', () => {
    it('returns empty array when no weeks exist', async () => {
      const res = await client.get('/api/weeks');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns all weeks ordered by date descending', async () => {
      insertTestWeek(db, '2025-02-17');
      insertTestWeek(db, '2025-02-24');
      insertTestWeek(db, '2025-03-03');

      const res = await client.get('/api/weeks');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
      expect(res.body[0].week_of).toBe('2025-03-03');
      expect(res.body[1].week_of).toBe('2025-02-24');
      expect(res.body[2].week_of).toBe('2025-02-17');
    });
  });

  describe('POST /api/weeks/:weekOf/copy', () => {
    it('returns 200 and copies week data', async () => {
      const sourceId = insertTestWeek(db, '2025-03-10');
      updateTestDay(db, sourceId, 0, {
        adult_dinner: 'Copied dinner',
        note: 'Copied note'
      });

      const res = await client
        .post('/api/weeks/2025-03-10/copy')
        .send({ targetWeekOf: '2025-03-17' });

      expect(res.status).toBe(200);
      expect(res.body.week_of).toBe('2025-03-17');
      expect(res.body.days[0].adult_dinner).toBe('Copied dinner');
      expect(res.body.days[0].note).toBe('Copied note');
    });

    it('returns 404 when source week not found', async () => {
      const res = await client
        .post('/api/weeks/2025-03-24/copy')
        .send({ targetWeekOf: '2025-03-31' });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Source week not found');
    });

    it('returns 400 for invalid source date', async () => {
      const res = await client
        .post('/api/weeks/bad-date/copy')
        .send({ targetWeekOf: '2025-03-31' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid source date format');
    });

    it('returns 400 for invalid target date', async () => {
      insertTestWeek(db, '2025-04-07');

      const res = await client
        .post('/api/weeks/2025-04-07/copy')
        .send({ targetWeekOf: 'not-a-date' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid target date format');
    });

    it('returns 400 when targetWeekOf is missing', async () => {
      insertTestWeek(db, '2025-04-14');

      const res = await client
        .post('/api/weeks/2025-04-14/copy')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('targetWeekOf is required');
    });

    it('returns 400 for invalid request body', async () => {
      const res = await client
        .post('/api/weeks/2025-04-21/copy')
        .send([]);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid request body');
    });
  });

  describe('DELETE /api/weeks/:weekOf', () => {
    it('returns 200 and deletes week', async () => {
      insertTestWeek(db, '2025-04-28');

      const res = await client.delete('/api/weeks/2025-04-28');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // Verify deletion
      const weeks = db.prepare('SELECT * FROM weeks').all();
      expect(weeks).toHaveLength(0);
    });

    it('returns 200 even if week does not exist', async () => {
      const res = await client.delete('/api/weeks/2025-05-05');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('returns 400 for invalid date format', async () => {
      const res = await client.delete('/api/weeks/invalid');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid date format');
    });
  });

  describe('GET /api/schedule/current', () => {
    it('returns current week schedule', async () => {
      const res = await client.get('/api/schedule/current');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('week_of');
      expect(res.body).toHaveProperty('days');
    });

    it('returns empty days array if week not found', async () => {
      const res = await client.get('/api/schedule/current');

      expect(res.status).toBe(200);
      // When week doesn't exist, days should be empty array
      expect(res.body.days).toEqual([]);
    });
  });

  describe('GET /api/schedule/upcoming', () => {
    it('returns upcoming 3 days with updated_at', async () => {
      const res = await client.get('/api/schedule/upcoming');

      expect(res.status).toBe(200);
      expect(res.body.days).toHaveLength(3);
      expect(res.body).toHaveProperty('updated_at');
      expect(res.body.updated_at).toMatch(/^\d{2}:\d{2}$/);
    });

    it('includes date and day name for each day', async () => {
      const res = await client.get('/api/schedule/upcoming');

      expect(res.status).toBe(200);
      for (const day of res.body.days) {
        expect(day).toHaveProperty('date');
        expect(day).toHaveProperty('day');
        expect(day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });
  });

  describe('GET /api/schedule/:weekOf', () => {
    it('returns formatted week for existing week', async () => {
      const weekId = insertTestWeek(db, '2025-05-12');
      updateTestDay(db, weekId, 0, { adult_dinner: 'Test dinner' });

      const res = await client.get('/api/schedule/2025-05-12');

      expect(res.status).toBe(200);
      expect(res.body.week_of).toBe('2025-05-12');
      expect(res.body.days[0].day).toBe('Monday');
      expect(res.body.days[0].adult.dinner).toBe('Test dinner');
    });

    it('returns 404 for non-existent week', async () => {
      const res = await client.get('/api/schedule/2025-05-19');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Week not found');
    });

    it('returns 400 for invalid date format', async () => {
      const res = await client.get('/api/schedule/bad-date');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid date format');
    });
  });

  describe('GET /api/inventory', () => {
    it('returns empty inventory with no meals planned', async () => {
      const res = await client.get('/api/inventory?lookahead=7');

      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
      expect(res.body.otherStock).toEqual([]);
      expect(res.body.lookahead).toBe(7);
    });

    it('returns inventory with planned meals', async () => {
      const weekId = insertTestWeek(db, '2025-01-06');
      updateTestDay(db, weekId, 0, { baby_lunch_meat: 'chicken' });

      const res = await client.get('/api/inventory?lookahead=7&today=2025-01-06');

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].ingredient).toBe('chicken');
      expect(res.body.items[0].needed).toBe(1);
    });

    it('defaults lookahead to 7', async () => {
      const res = await client.get('/api/inventory');

      expect(res.status).toBe(200);
      expect(res.body.lookahead).toBe(7);
    });

    it('rejects invalid lookahead values', async () => {
      const res = await client.get('/api/inventory?lookahead=10');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('lookahead');
    });
  });

  describe('PUT /api/inventory/:ingredient', () => {
    it('sets absolute stock', async () => {
      const res = await client
        .put('/api/inventory/chicken')
        .send({ stock: 5 });

      expect(res.status).toBe(200);
      expect(res.body.ingredient).toBe('chicken');
      expect(res.body.stock).toBe(5);
    });

    it('applies delta to stock', async () => {
      await client.put('/api/inventory/chicken').send({ stock: 3 });

      const res = await client
        .put('/api/inventory/chicken')
        .send({ delta: 2 });

      expect(res.status).toBe(200);
      expect(res.body.stock).toBe(5);
    });

    it('returns 400 when neither stock nor delta provided', async () => {
      const res = await client
        .put('/api/inventory/chicken')
        .send({});

      expect(res.status).toBe(400);
    });

    it('normalizes ingredient name', async () => {
      const res = await client
        .put('/api/inventory/%20Chicken%20')
        .send({ stock: 5 });

      expect(res.status).toBe(200);
      expect(res.body.ingredient).toBe('chicken');
    });
  });

  describe('PUT /api/weeks/:weekOf/days/:day/consume', () => {
    it('marks meal as consumed and returns updated day', async () => {
      const weekId = insertTestWeek(db, '2025-01-06');
      updateTestDay(db, weekId, 0, { baby_lunch_meat: 'chicken' });

      const res = await client
        .put('/api/weeks/2025-01-06/days/0/consume')
        .send({ meal: 'baby_lunch' });

      expect(res.status).toBe(200);
      expect(res.body.baby_lunch_consumed).toBe(1);
    });

    it('returns 400 for invalid meal type', async () => {
      insertTestWeek(db, '2025-01-06');

      const res = await client
        .put('/api/weeks/2025-01-06/days/0/consume')
        .send({ meal: 'adult_dinner' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('meal');
    });

    it('returns 400 for missing meal field', async () => {
      insertTestWeek(db, '2025-01-06');

      const res = await client
        .put('/api/weeks/2025-01-06/days/0/consume')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/weeks/:weekOf/days/:day/unconsume', () => {
    it('unmarks meal as consumed', async () => {
      const weekId = insertTestWeek(db, '2025-01-06');
      updateTestDay(db, weekId, 0, { baby_lunch_meat: 'chicken' });

      await client
        .put('/api/weeks/2025-01-06/days/0/consume')
        .send({ meal: 'baby_lunch' });

      const res = await client
        .put('/api/weeks/2025-01-06/days/0/unconsume')
        .send({ meal: 'baby_lunch' });

      expect(res.status).toBe(200);
      expect(res.body.baby_lunch_consumed).toBe(0);
    });
  });
});
