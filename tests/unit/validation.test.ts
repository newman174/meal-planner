/**
 * @fileoverview Unit tests for validation functions in server.ts and db.ts
 */

import { describe, it, expect } from 'vitest';
import { isValidWeekOf, isValidRequestBody } from '../../src/server.js';
import { ALLOWED_DAY_FIELDS } from '../../src/db.js';

describe('isValidWeekOf', () => {
  it('returns true for valid YYYY-MM-DD format', () => {
    expect(isValidWeekOf('2025-01-06')).toBe(true);
    expect(isValidWeekOf('2024-12-31')).toBe(true);
    expect(isValidWeekOf('2025-02-28')).toBe(true);
  });

  it('returns true for leap year date', () => {
    expect(isValidWeekOf('2024-02-29')).toBe(true);
  });

  it('returns false for invalid date format (wrong separators)', () => {
    expect(isValidWeekOf('2025/01/06')).toBe(false);
    expect(isValidWeekOf('2025.01.06')).toBe(false);
    expect(isValidWeekOf('01-06-2025')).toBe(false);
  });

  it('returns false for invalid date format (wrong lengths)', () => {
    expect(isValidWeekOf('25-01-06')).toBe(false);
    expect(isValidWeekOf('2025-1-6')).toBe(false);
    expect(isValidWeekOf('2025-1-06')).toBe(false);
    expect(isValidWeekOf('2025-01-6')).toBe(false);
  });

  it('returns false for clearly invalid month/day values', () => {
    // Note: JavaScript Date parsing is lenient - 2025-02-30 becomes March 2
    // These tests verify the regex validation catches obviously invalid formats
    expect(isValidWeekOf('2025-13-01')).toBe(false); // Month 13 doesn't exist
    expect(isValidWeekOf('2025-00-15')).toBe(false); // Month 0 doesn't exist
  });

  it('returns false for dates that JavaScript would silently roll over', () => {
    expect(isValidWeekOf('2025-02-30')).toBe(false); // Feb 30 doesn't exist
    expect(isValidWeekOf('2025-04-31')).toBe(false); // Apr only has 30 days
    expect(isValidWeekOf('2025-02-29')).toBe(false); // 2025 is not a leap year
  });

  it('returns false for empty string', () => {
    expect(isValidWeekOf('')).toBe(false);
  });

  it('returns false for random strings', () => {
    expect(isValidWeekOf('not-a-date')).toBe(false);
    expect(isValidWeekOf('hello world')).toBe(false);
    expect(isValidWeekOf('2025-XX-YY')).toBe(false);
  });

  it('returns false for partial dates', () => {
    expect(isValidWeekOf('2025-01')).toBe(false);
    expect(isValidWeekOf('2025')).toBe(false);
  });
});

describe('isValidRequestBody', () => {
  it('returns true for plain objects', () => {
    expect(isValidRequestBody({})).toBe(true);
    expect(isValidRequestBody({ key: 'value' })).toBe(true);
    expect(isValidRequestBody({ nested: { object: true } })).toBe(true);
  });

  it('returns false for null', () => {
    expect(isValidRequestBody(null)).toBe(false);
  });

  it('returns false for arrays', () => {
    expect(isValidRequestBody([])).toBe(false);
    expect(isValidRequestBody([1, 2, 3])).toBe(false);
    expect(isValidRequestBody([{ key: 'value' }])).toBe(false);
  });

  it('returns false for primitives', () => {
    expect(isValidRequestBody('string')).toBe(false);
    expect(isValidRequestBody(123)).toBe(false);
    expect(isValidRequestBody(true)).toBe(false);
    expect(isValidRequestBody(undefined)).toBe(false);
  });

  it('returns true for objects created with Object.create', () => {
    const obj = Object.create(null);
    obj.key = 'value';
    expect(isValidRequestBody(obj)).toBe(true);
  });
});

describe('ALLOWED_DAY_FIELDS', () => {
  it('contains all baby breakfast fields', () => {
    expect(ALLOWED_DAY_FIELDS).toHaveProperty('baby_breakfast_cereal');
    expect(ALLOWED_DAY_FIELDS).toHaveProperty('baby_breakfast_fruit');
    expect(ALLOWED_DAY_FIELDS).toHaveProperty('baby_breakfast_yogurt');
  });

  it('contains all baby lunch fields', () => {
    expect(ALLOWED_DAY_FIELDS).toHaveProperty('baby_lunch_meat');
    expect(ALLOWED_DAY_FIELDS).toHaveProperty('baby_lunch_vegetable');
    expect(ALLOWED_DAY_FIELDS).toHaveProperty('baby_lunch_fruit');
  });

  it('contains all baby dinner fields', () => {
    expect(ALLOWED_DAY_FIELDS).toHaveProperty('baby_dinner_meat');
    expect(ALLOWED_DAY_FIELDS).toHaveProperty('baby_dinner_vegetable');
    expect(ALLOWED_DAY_FIELDS).toHaveProperty('baby_dinner_fruit');
  });

  it('contains adult dinner field', () => {
    expect(ALLOWED_DAY_FIELDS).toHaveProperty('adult_dinner');
  });

  it('contains note field', () => {
    expect(ALLOWED_DAY_FIELDS).toHaveProperty('note');
  });

  it('has exactly 11 fields', () => {
    expect(Object.keys(ALLOWED_DAY_FIELDS)).toHaveLength(11);
  });

  it('maps field names to identical column names', () => {
    // This tests the whitelist pattern where input key maps to DB column
    for (const [key, value] of Object.entries(ALLOWED_DAY_FIELDS)) {
      expect(key).toBe(value);
    }
  });

  it('does not contain unauthorized fields', () => {
    expect(ALLOWED_DAY_FIELDS).not.toHaveProperty('id');
    expect(ALLOWED_DAY_FIELDS).not.toHaveProperty('week_id');
    expect(ALLOWED_DAY_FIELDS).not.toHaveProperty('day');
    expect(ALLOWED_DAY_FIELDS).not.toHaveProperty('__proto__');
    expect(ALLOWED_DAY_FIELDS).not.toHaveProperty('constructor');
  });
});
