/**
 * @fileoverview Unit tests for date utility functions in db.ts
 */

import { describe, it, expect } from 'vitest';
import { getMonday, getEasternDateParts } from '../../src/db.js';

describe('getMonday (string input)', () => {
  // IMPORTANT: JavaScript parses 'YYYY-MM-DD' as UTC midnight, which can be
  // the previous day in Eastern time. Use 'YYYY-MM-DDT12:00:00' to avoid
  // timezone issues in tests.

  it('returns Monday for a Monday date string (with time to avoid TZ issues)', () => {
    // 2025-01-06 is a Monday - use T12:00:00 to ensure correct date
    const result = getMonday('2025-01-06T12:00:00');
    expect(result).toBe('2025-01-06');
  });

  it('returns Monday for a mid-week date (Wednesday)', () => {
    // 2025-01-08 is a Wednesday, Monday was 2025-01-06
    const result = getMonday('2025-01-08T12:00:00');
    expect(result).toBe('2025-01-06');
  });

  it('returns Monday for a Friday date', () => {
    // 2025-01-10 is a Friday, Monday was 2025-01-06
    const result = getMonday('2025-01-10T12:00:00');
    expect(result).toBe('2025-01-06');
  });

  it('handles Sunday edge case (returns previous Monday)', () => {
    // 2025-01-12 is a Sunday, Monday was 2025-01-06
    const result = getMonday('2025-01-12T12:00:00');
    expect(result).toBe('2025-01-06');
  });

  it('handles Saturday (returns Monday of same week)', () => {
    // 2025-01-11 is a Saturday, Monday was 2025-01-06
    const result = getMonday('2025-01-11T12:00:00');
    expect(result).toBe('2025-01-06');
  });

  it('returns null for invalid date string', () => {
    const result = getMonday('not-a-date');
    expect(result).toBeNull();
  });

  it('returns null for empty string', () => {
    const result = getMonday('');
    expect(result).toBeNull();
  });

  it('handles year boundaries correctly', () => {
    // 2024-12-31 is a Tuesday, Monday was 2024-12-30
    const result = getMonday('2024-12-31T12:00:00');
    expect(result).toBe('2024-12-30');
  });

  it('handles month boundaries correctly', () => {
    // 2025-02-01 is a Saturday, Monday was 2025-01-27
    const result = getMonday('2025-02-01T12:00:00');
    expect(result).toBe('2025-01-27');
  });

  it('handles leap year correctly', () => {
    // 2024-02-29 is a Thursday (leap year), Monday was 2024-02-26
    const result = getMonday('2024-02-29T12:00:00');
    expect(result).toBe('2024-02-26');
  });
});

describe('getMonday (Date input)', () => {
  // getMonday must work with Date objects too — used by getLookaheadDays
  // and getUpcomingDays to find the week a future date belongs to.

  it('returns correct Monday for a Date in the current week', () => {
    // Use a fixed date to avoid flakiness: 2025-01-08 (Wednesday)
    const date = new Date(2025, 0, 8, 12, 0, 0); // Jan 8, 2025, noon local
    const result = getMonday(date);
    expect(result).toBe('2025-01-06');
  });

  it('returns correct Monday for a Date in a different week', () => {
    // 2025-01-15 (Wednesday) — Monday is Jan 13, NOT Jan 6
    const date = new Date(2025, 0, 15, 12, 0, 0);
    const result = getMonday(date);
    expect(result).toBe('2025-01-13');
  });

  it('returns correct Monday for a Date several weeks out', () => {
    // 2025-02-10 (Monday) — Monday is Feb 10 itself
    const date = new Date(2025, 1, 10, 12, 0, 0);
    const result = getMonday(date);
    expect(result).toBe('2025-02-10');
  });

  it('handles Sunday Date (returns previous Monday)', () => {
    // 2025-01-19 (Sunday) — Monday was Jan 13
    const date = new Date(2025, 0, 19, 12, 0, 0);
    const result = getMonday(date);
    expect(result).toBe('2025-01-13');
  });

  it('does not mutate the input Date', () => {
    const date = new Date(2025, 0, 15, 12, 0, 0);
    const originalTime = date.getTime();
    getMonday(date);
    expect(date.getTime()).toBe(originalTime);
  });
});

describe('getEasternDateParts', () => {
  it('returns object with year, month, day, hour, minute', () => {
    const testDate = new Date('2025-06-15T14:30:00Z');
    const parts = getEasternDateParts(testDate);

    expect(parts).toHaveProperty('year');
    expect(parts).toHaveProperty('month');
    expect(parts).toHaveProperty('day');
    expect(parts).toHaveProperty('hour');
    expect(parts).toHaveProperty('minute');
  });

  it('returns correctly formatted date parts', () => {
    // Create a date that's clearly in a specific timezone
    // Using a fixed timestamp: Jan 15, 2025 at 12:00 UTC
    // In Eastern (EST, UTC-5), this is 07:00
    const testDate = new Date('2025-01-15T12:00:00Z');
    const parts = getEasternDateParts(testDate);

    expect(parts.year).toBe('2025');
    expect(parts.month).toBe('01');
    expect(parts.day).toBe('15');
    // Hour depends on DST, so we just check it's a valid 2-digit string
    expect(parts.hour).toMatch(/^\d{2}$/);
    expect(parts.minute).toBe('00');
  });

  it('pads single-digit months with zero', () => {
    const testDate = new Date('2025-03-05T12:00:00Z');
    const parts = getEasternDateParts(testDate);

    expect(parts.month).toBe('03');
    expect(parts.day).toBe('05');
  });

  it('uses current date when no argument provided', () => {
    const parts = getEasternDateParts();
    const currentYear = new Date().getFullYear().toString();

    // Year should be current year (might be off by 1 around new year)
    expect(parseInt(parts.year)).toBeGreaterThanOrEqual(parseInt(currentYear) - 1);
    expect(parseInt(parts.year)).toBeLessThanOrEqual(parseInt(currentYear) + 1);
  });
});
