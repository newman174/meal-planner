/**
 * @fileoverview Unit tests for frontend date utility functions in public/app.js
 * Uses jsdom environment to test browser-like code
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import * as fs from 'fs';
import * as path from 'path';

// Load the frontend app.js code into jsdom environment
let getMonday: (date: Date) => string;
let formatDate: (d: Date) => string;
let addDays: (dateStr: string, n: number) => string;
let formatWeekLabel: (weekOf: string) => string;
let isValidDate: (dateStr: string) => boolean;

beforeAll(async () => {
  // Read the app.js file
  const appJsPath = path.join(import.meta.dirname, '../../public/app.js');
  const appJsCode = fs.readFileSync(appJsPath, 'utf-8');

  // Create a minimal DOM environment
  const dom = new JSDOM(`
    <!DOCTYPE html>
    <html>
      <body>
        <div id="week-view"></div>
        <span id="week-label"></span>
        <button id="prev-week"></button>
        <button id="next-week"></button>
        <button id="today-btn"></button>
        <button id="history-btn"></button>
        <button id="copy-btn"></button>
        <button id="theme-toggle"><span class="theme-icon"></span></button>
        <button id="inventory-btn"></button>
        <button id="lookahead-btn"></button>
        <div id="lookahead-nav" style="display:none"><div id="lookahead-day-selector"></div></div>
        <span id="app-version"></span>
        <div class="app-layout">
          <aside id="inventory-panel" class="inventory-panel collapsed">
            <button id="inventory-panel-close"></button>
          </aside>
        </div>
        <div id="modal-overlay" class="hidden">
          <span id="modal-title"></span>
          <div id="modal-body"></div>
          <button id="modal-close"></button>
        </div>
      </body>
    </html>
  `, {
    runScripts: 'dangerously',
    url: 'http://localhost:3000'
  });

  // Mock fetch to prevent actual HTTP calls
  (dom.window as typeof globalThis & { fetch: unknown }).fetch = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ days: [] })
  });

  // Execute the app.js code in the jsdom context
  const script = dom.window.document.createElement('script');
  script.textContent = appJsCode;
  dom.window.document.body.appendChild(script);

  // Extract functions from the window object (they're global in app.js)
  getMonday = (dom.window as typeof globalThis & { getMonday: typeof getMonday }).getMonday;
  formatDate = (dom.window as typeof globalThis & { formatDate: typeof formatDate }).formatDate;
  addDays = (dom.window as typeof globalThis & { addDays: typeof addDays }).addDays;
  formatWeekLabel = (dom.window as typeof globalThis & { formatWeekLabel: typeof formatWeekLabel }).formatWeekLabel;
  isValidDate = (dom.window as typeof globalThis & { isValidDate: typeof isValidDate }).isValidDate;
});

describe('Frontend Date Utilities', () => {
  describe('getMonday', () => {
    it('returns Monday for a Monday date', () => {
      const date = new Date('2025-01-06T12:00:00');
      const result = getMonday(date);
      expect(result).toBe('2025-01-06');
    });

    it('returns Monday for a Wednesday date', () => {
      const date = new Date('2025-01-08T12:00:00');
      const result = getMonday(date);
      expect(result).toBe('2025-01-06');
    });

    it('returns Monday for a Sunday date', () => {
      const date = new Date('2025-01-12T12:00:00');
      const result = getMonday(date);
      expect(result).toBe('2025-01-06');
    });

    it('handles month boundaries', () => {
      // February 1, 2025 is Saturday - Monday was Jan 27
      const date = new Date('2025-02-01T12:00:00');
      const result = getMonday(date);
      expect(result).toBe('2025-01-27');
    });
  });

  describe('formatDate', () => {
    it('formats date as YYYY-MM-DD', () => {
      const date = new Date('2025-03-15T12:00:00');
      const result = formatDate(date);
      expect(result).toBe('2025-03-15');
    });

    it('pads single-digit months', () => {
      const date = new Date('2025-01-05T12:00:00');
      const result = formatDate(date);
      expect(result).toBe('2025-01-05');
    });

    it('pads single-digit days', () => {
      const date = new Date('2025-12-09T12:00:00');
      const result = formatDate(date);
      expect(result).toBe('2025-12-09');
    });
  });

  describe('addDays', () => {
    it('adds positive days', () => {
      const result = addDays('2025-01-15', 5);
      expect(result).toBe('2025-01-20');
    });

    it('adds negative days (subtracts)', () => {
      const result = addDays('2025-01-15', -5);
      expect(result).toBe('2025-01-10');
    });

    it('handles month rollover', () => {
      const result = addDays('2025-01-30', 5);
      expect(result).toBe('2025-02-04');
    });

    it('handles year rollover', () => {
      const result = addDays('2025-12-30', 5);
      expect(result).toBe('2026-01-04');
    });

    it('adds zero days (returns same date)', () => {
      const result = addDays('2025-06-15', 0);
      expect(result).toBe('2025-06-15');
    });

    it('adds 7 days for week navigation', () => {
      const result = addDays('2025-01-06', 7);
      expect(result).toBe('2025-01-13');
    });

    it('subtracts 7 days for week navigation', () => {
      const result = addDays('2025-01-13', -7);
      expect(result).toBe('2025-01-06');
    });
  });

  describe('formatWeekLabel', () => {
    it('formats week range correctly', () => {
      const result = formatWeekLabel('2025-01-06');
      // Should show "Jan 6 – Jan 12, 2025" (Monday to Sunday)
      expect(result).toContain('Jan');
      expect(result).toContain('6');
      expect(result).toContain('12');
      expect(result).toContain('2025');
    });

    it('handles month spanning weeks', () => {
      const result = formatWeekLabel('2025-01-27');
      // Should show "Jan 27 – Feb 2, 2025"
      expect(result).toContain('Jan');
      expect(result).toContain('Feb');
    });

    it('includes year only at the end', () => {
      const result = formatWeekLabel('2025-06-02');
      // Year should only appear once (at the end with the end date)
      const yearMatches = result.match(/2025/g);
      expect(yearMatches?.length).toBe(1);
    });
  });

  describe('isValidDate', () => {
    it('returns true for valid dates', () => {
      expect(isValidDate('2025-01-15')).toBe(true);
      expect(isValidDate('2024-02-29')).toBe(true); // Leap year
      expect(isValidDate('2025-12-31')).toBe(true);
    });

    it('returns true for dates that JavaScript rolls over (lenient parsing)', () => {
      // JavaScript Date is lenient: 2025-02-30 becomes 2025-03-02
      // This is expected behavior - isValidDate just checks parseability
      expect(isValidDate('2025-02-30')).toBe(true);
    });

    it('returns false for non-date strings', () => {
      expect(isValidDate('not-a-date')).toBe(false);
      expect(isValidDate('')).toBe(false);
      expect(isValidDate('hello')).toBe(false);
    });
  });
});
