/**
 * @fileoverview Unit tests for GFS-lite backup retention logic.
 * Tests the pure selectFilesToKeep() function with synthetic file lists.
 */

import { describe, it, expect } from 'vitest';
import { selectFilesToKeep, makeBackupFilename, parseBackupDate } from '../../src/backup.js';

/** Helper to create a BackupEntry from an ISO date string */
function entry(isoDate: string) {
  const date = new Date(isoDate);
  return { filename: makeBackupFilename(date), date };
}

describe('makeBackupFilename / parseBackupDate', () => {
  it('round-trips a date through filename encoding', () => {
    const date = new Date('2026-02-17T14:30:00.000Z');
    const filename = makeBackupFilename(date);
    expect(filename).toBe('meals-2026-02-17T14-30-00Z.db');

    const parsed = parseBackupDate(filename);
    expect(parsed).not.toBeNull();
    expect(parsed!.toISOString()).toBe('2026-02-17T14:30:00.000Z');
  });

  it('returns null for non-matching filenames', () => {
    expect(parseBackupDate('random-file.db')).toBeNull();
    expect(parseBackupDate('meals-bad-format.db')).toBeNull();
    expect(parseBackupDate('')).toBeNull();
  });
});

describe('selectFilesToKeep', () => {
  it('returns empty arrays for empty input', () => {
    const result = selectFilesToKeep([], new Date(), 7, 4, 3);
    expect(result.keep).toEqual([]);
    expect(result.prune).toEqual([]);
  });

  it('keeps a single file', () => {
    const now = new Date('2026-02-17T12:00:00Z');
    const files = [entry('2026-02-17T08:00:00Z')];
    const result = selectFilesToKeep(files, now, 7, 4, 3);
    expect(result.keep).toHaveLength(1);
    expect(result.prune).toHaveLength(0);
  });

  it('keeps newest-per-day within daily window', () => {
    const now = new Date('2026-02-17T12:00:00Z');
    const files = [
      entry('2026-02-17T08:00:00Z'),
      entry('2026-02-17T04:00:00Z'), // same day, older — should be pruned
      entry('2026-02-16T08:00:00Z'),
      entry('2026-02-15T08:00:00Z'),
    ];
    const result = selectFilesToKeep(files, now, 7, 4, 3);
    expect(result.keep).toHaveLength(3); // one per day for 3 days
    expect(result.prune).toHaveLength(1);
    expect(result.prune[0]).toContain('2026-02-17T04-00-00Z');
  });

  it('keeps weekly backups beyond the daily window', () => {
    const now = new Date('2026-03-01T12:00:00Z');
    const files: { filename: string; date: Date }[] = [];

    // Daily window: Feb 22 - Mar 1 (7 days)
    for (let d = 22; d <= 28; d++) {
      files.push(entry(`2026-02-${String(d).padStart(2, '0')}T08:00:00Z`));
    }
    files.push(entry('2026-03-01T08:00:00Z'));

    // Beyond daily window but within weekly: Feb 1, Feb 8, Feb 15
    files.push(entry('2026-02-01T08:00:00Z'));
    files.push(entry('2026-02-08T08:00:00Z'));
    files.push(entry('2026-02-15T08:00:00Z'));

    const result = selectFilesToKeep(files, now, 7, 4, 3);
    // Daily: 8 files (Feb 22-28 + Mar 1)
    // Weekly: Feb 15 and Feb 8 are within 4-week window (back to Feb 1)
    // Feb 1 is also within 4 weeks
    expect(result.keep.length).toBeGreaterThanOrEqual(8);
    expect(result.prune.length).toBeLessThanOrEqual(files.length - 8);
  });

  it('keeps monthly backups beyond the weekly window', () => {
    const now = new Date('2026-06-01T12:00:00Z');
    const files = [
      entry('2026-06-01T08:00:00Z'), // daily
      entry('2026-01-15T08:00:00Z'), // 5 months ago — beyond monthly window (3 months)
      entry('2026-03-15T08:00:00Z'), // within monthly window
      entry('2026-04-15T08:00:00Z'), // within monthly window
      entry('2026-05-10T08:00:00Z'), // within weekly window
    ];
    const result = selectFilesToKeep(files, now, 7, 4, 3);
    // Jan 15 is 5 months ago, beyond 3-month retention → pruned
    expect(result.prune).toContainEqual(expect.stringContaining('2026-01-15'));
    // Mar 15 and Apr 15 should be kept as monthly
    expect(result.keep).toContainEqual(expect.stringContaining('2026-03-15'));
    expect(result.keep).toContainEqual(expect.stringContaining('2026-04-15'));
  });

  it('handles files exactly at boundary dates', () => {
    const now = new Date('2026-02-17T12:00:00Z');
    // File exactly 7 days ago (daily cutoff boundary)
    const files = [entry('2026-02-10T12:00:00Z')];
    const result = selectFilesToKeep(files, now, 7, 4, 3);
    // At the boundary — should still be within daily window
    expect(result.keep).toHaveLength(1);
  });

  it('prunes everything outside all retention windows', () => {
    const now = new Date('2026-06-01T12:00:00Z');
    const files = [
      entry('2025-01-01T08:00:00Z'), // 17 months ago
      entry('2025-02-01T08:00:00Z'), // 16 months ago
    ];
    const result = selectFilesToKeep(files, now, 7, 4, 3);
    expect(result.keep).toHaveLength(0);
    expect(result.prune).toHaveLength(2);
  });

  it('deduplicates within the same ISO week', () => {
    const now = new Date('2026-03-15T12:00:00Z');
    // Two files from same week but different days, both outside daily window
    const files = [
      entry('2026-02-23T08:00:00Z'), // Monday
      entry('2026-02-25T08:00:00Z'), // Wednesday (same ISO week)
    ];
    const result = selectFilesToKeep(files, now, 7, 4, 3);
    // Only the newest from this ISO week should be kept
    expect(result.keep).toHaveLength(1);
    expect(result.keep[0]).toContain('2026-02-25');
  });
});
