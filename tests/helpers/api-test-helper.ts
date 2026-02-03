/**
 * @fileoverview API test helper for creating supertest clients.
 * Provides pre-configured test clients for HTTP request testing.
 */

import request from 'supertest';
import { app } from '../../src/server.js';

/**
 * Creates a supertest client for the Express app.
 * Use this for making HTTP requests in integration tests.
 */
export function createTestClient() {
  return request(app);
}

/**
 * Type for the supertest client for better TypeScript support.
 */
export type TestClient = ReturnType<typeof createTestClient>;
