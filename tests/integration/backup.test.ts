/**
 * @fileoverview Integration tests for backup API endpoints.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestClient, type TestClient } from '../helpers/api-test-helper.js';
import { setupTestDb } from '../helpers/db-test-helper.js';
import { resetCooldown } from '../../src/backup.js';

describe('Backup API Endpoints', () => {
  let client: TestClient;
  let cleanup: () => void;

  beforeEach(() => {
    const testSetup = setupTestDb();
    cleanup = testSetup.cleanup;
    client = createTestClient();
    resetCooldown();
  });

  afterEach(() => {
    cleanup();
  });

  describe('GET /api/backups', () => {
    it('returns an object with backups array and count', async () => {
      const res = await client.get('/api/backups');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('backups');
      expect(res.body).toHaveProperty('count');
      expect(Array.isArray(res.body.backups)).toBe(true);
      expect(res.body.count).toBe(res.body.backups.length);
    });
  });

  describe('POST /api/backup', () => {
    it('creates a backup and returns 201', async () => {
      const res = await client.post('/api/backup');

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('filename');
      expect(res.body).toHaveProperty('sizeBytes');
      expect(res.body).toHaveProperty('retained');
      expect(res.body).toHaveProperty('pruned');
      expect(res.body.filename).toMatch(/^meals-.*\.db$/);
      expect(res.body.sizeBytes).toBeGreaterThan(0);
    });

    it('returns 429 on rapid successive requests', async () => {
      // First request should succeed
      const first = await client.post('/api/backup');
      expect(first.status).toBe(201);

      // Second request within cooldown should be rejected
      const second = await client.post('/api/backup');
      expect(second.status).toBe(429);
      expect(second.body).toHaveProperty('retryAfterSec');
      expect(second.headers).toHaveProperty('retry-after');
    });

    it('backup appears in list after creation', async () => {
      await client.post('/api/backup');

      const listRes = await client.get('/api/backups');
      expect(listRes.status).toBe(200);
      expect(listRes.body.count).toBeGreaterThanOrEqual(1);
      expect(listRes.body.backups[0]).toHaveProperty('filename');
      expect(listRes.body.backups[0]).toHaveProperty('createdAt');
      expect(listRes.body.backups[0]).toHaveProperty('sizeBytes');
    });
  });
});
