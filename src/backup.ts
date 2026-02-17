/**
 * @fileoverview Database backup module with GFS-lite retention policy.
 * Uses better-sqlite3's online backup API for safe, concurrent backups.
 * @module backup
 */

import fs from 'node:fs';
import path from 'node:path';
import config from './config.js';
import * as db from './db.js';
import logger from './logger.js';
import type { BackupFileInfo, BackupCreateResponse, BackupsListResponse } from './types/index.js';

/** Backup filename prefix and extension */
const BACKUP_PREFIX = 'meals-';
const BACKUP_EXT = '.db';

/** Regex to match and parse backup filenames: meals-YYYY-MM-DDTHH-MM-SSZ.db */
const BACKUP_FILENAME_RE = /^meals-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.db$/;

/** Resolve the backup directory path */
const BACKUP_DIR = config.paths.backups(
  // Use the same dirname resolution pattern as other path configs.
  // At module load time, import.meta.dirname points to src/ (dev) or dist/ (prod).
  typeof import.meta.dirname === 'string' ? import.meta.dirname : process.cwd()
);

/** Ensure backup directory exists (matches logger.ts pattern) */
fs.mkdirSync(BACKUP_DIR, { recursive: true });

/** Timestamp of the last manual backup (for cooldown enforcement) */
let lastManualBackupTime = 0;

/**
 * Generates a backup filename from a Date.
 * Format: meals-YYYY-MM-DDTHH-MM-SSZ.db (hyphens instead of colons for cross-platform safety)
 */
export function makeBackupFilename(now: Date = new Date()): string {
  const iso = now.toISOString(); // e.g. 2026-02-17T14:30:00.000Z
  const stamp = iso.slice(0, 19).replace(/:/g, '-') + 'Z'; // 2026-02-17T14-30-00Z
  return `${BACKUP_PREFIX}${stamp}${BACKUP_EXT}`;
}

/**
 * Parses a backup filename back into a Date.
 * Returns null if the filename doesn't match the expected pattern.
 */
export function parseBackupDate(filename: string): Date | null {
  const m = BACKUP_FILENAME_RE.exec(filename);
  if (!m) return null;
  const [, year, month, day, hour, min, sec] = m;
  return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}Z`);
}

/** A backup file with its parsed date, used internally by retention logic */
interface BackupEntry {
  filename: string;
  date: Date;
}

/**
 * Pure function implementing GFS-lite retention policy.
 * Determines which backup files to keep from a list.
 *
 * Strategy:
 * 1. Keep the newest backup per day within the daily retention window
 * 2. From remaining: keep newest per ISO week within the weekly window
 * 3. From remaining: keep newest per month within the monthly window
 * 4. Everything else is marked for pruning
 *
 * @param files - Array of {filename, date} objects
 * @param now - Current time reference point
 * @param daily - Number of daily backups to retain (default: 7)
 * @param weekly - Number of weekly backups to retain (default: 4)
 * @param monthly - Number of monthly backups to retain (default: 3)
 * @returns Object with `keep` and `prune` filename arrays
 */
export function selectFilesToKeep(
  files: BackupEntry[],
  now: Date,
  daily: number = config.backupRetainDaily,
  weekly: number = config.backupRetainWeekly,
  monthly: number = config.backupRetainMonthly,
): { keep: string[]; prune: string[] } {
  if (files.length === 0) return { keep: [], prune: [] };

  // Sort descending by date (newest first)
  const sorted = [...files].sort((a, b) => b.date.getTime() - a.date.getTime());
  const kept = new Set<string>();

  // --- Daily: keep newest per calendar day (UTC) for last N days ---
  const dailyCutoff = new Date(now);
  dailyCutoff.setUTCDate(dailyCutoff.getUTCDate() - daily);

  const seenDays = new Set<string>();
  for (const entry of sorted) {
    if (entry.date < dailyCutoff) continue;
    const dayKey = entry.date.toISOString().slice(0, 10); // YYYY-MM-DD
    if (!seenDays.has(dayKey)) {
      seenDays.add(dayKey);
      kept.add(entry.filename);
    }
  }

  // --- Weekly: from non-kept files, keep newest per ISO week for last N weeks ---
  // Pre-populate with weeks already represented by daily-kept files
  const weeklyCutoff = new Date(now);
  weeklyCutoff.setUTCDate(weeklyCutoff.getUTCDate() - weekly * 7);

  const seenWeeks = new Set<string>();
  for (const entry of sorted) {
    if (kept.has(entry.filename)) seenWeeks.add(getISOWeekKey(entry.date));
  }
  for (const entry of sorted) {
    if (kept.has(entry.filename)) continue;
    if (entry.date < weeklyCutoff) continue;
    const weekKey = getISOWeekKey(entry.date);
    if (!seenWeeks.has(weekKey)) {
      seenWeeks.add(weekKey);
      kept.add(entry.filename);
    }
  }

  // --- Monthly: from non-kept files, keep newest per month for last N months ---
  // Pre-populate with months already represented by daily/weekly-kept files
  const monthlyCutoff = new Date(now);
  monthlyCutoff.setUTCMonth(monthlyCutoff.getUTCMonth() - monthly);

  const seenMonths = new Set<string>();
  for (const entry of sorted) {
    if (kept.has(entry.filename)) seenMonths.add(entry.date.toISOString().slice(0, 7));
  }
  for (const entry of sorted) {
    if (kept.has(entry.filename)) continue;
    if (entry.date < monthlyCutoff) continue;
    const monthKey = entry.date.toISOString().slice(0, 7); // YYYY-MM
    if (!seenMonths.has(monthKey)) {
      seenMonths.add(monthKey);
      kept.add(entry.filename);
    }
  }

  const keep = sorted.filter(e => kept.has(e.filename)).map(e => e.filename);
  const prune = sorted.filter(e => !kept.has(e.filename)).map(e => e.filename);

  return { keep, prune };
}

/**
 * Returns an ISO week key like "2026-W08" for a given date.
 * Uses the ISO 8601 week date system (weeks start on Monday).
 */
function getISOWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // Set to nearest Thursday: current date + 4 - current day number (Mon=1, Sun=7)
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Reads the backup directory and returns parsed entries.
 */
function readBackupEntries(): BackupEntry[] {
  const files = fs.readdirSync(BACKUP_DIR);
  const entries: BackupEntry[] = [];
  for (const f of files) {
    const date = parseBackupDate(f);
    if (date) entries.push({ filename: f, date });
  }
  return entries;
}

/**
 * Creates a new database backup using better-sqlite3's online backup API.
 * After creating the backup, prunes old backups per the retention policy.
 *
 * @returns Backup result with file info and pruning stats
 */
export async function createBackup(): Promise<BackupCreateResponse> {
  const filename = makeBackupFilename();
  const destPath = path.join(BACKUP_DIR, filename);

  await db.getDb().backup(destPath);

  const stats = fs.statSync(destPath);
  const { pruned, retained } = pruneBackups();

  logger.info({ filename, sizeBytes: stats.size, retained, pruned: pruned.length }, 'Backup created');

  return {
    filename,
    path: destPath,
    sizeBytes: stats.size,
    retained,
    pruned: pruned.length,
  };
}

/**
 * Applies the GFS-lite retention policy, deleting backups that fall outside
 * all retention windows.
 *
 * @returns Counts of retained and pruned files
 */
function pruneBackups(): { retained: number; pruned: string[] } {
  const entries = readBackupEntries();
  const { keep, prune } = selectFilesToKeep(entries, new Date());

  for (const filename of prune) {
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, filename));
    } catch (err) {
      logger.warn({ err, filename }, 'Failed to delete old backup');
    }
  }

  if (prune.length > 0) {
    logger.info({ pruned: prune.length, retained: keep.length }, 'Pruned old backups');
  }

  return { retained: keep.length, pruned: prune };
}

/**
 * Lists all backup files with metadata, sorted newest first.
 */
export function listBackups(): BackupsListResponse {
  const entries = readBackupEntries()
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  const backups: BackupFileInfo[] = entries.map(e => {
    const fullPath = path.join(BACKUP_DIR, e.filename);
    const stats = fs.statSync(fullPath);
    return {
      filename: e.filename,
      path: fullPath,
      createdAt: e.date.toISOString(),
      sizeBytes: stats.size,
    };
  });

  return { backups, count: backups.length };
}

/**
 * Creates a backup on server startup if none exists for today (UTC).
 * Prevents duplicate backups on frequent restarts (e.g., during deploys).
 */
export async function runStartupBackupIfNeeded(): Promise<void> {
  const entries = readBackupEntries();
  const todayKey = new Date().toISOString().slice(0, 10);
  const hasToday = entries.some(e => e.date.toISOString().slice(0, 10) === todayKey);

  if (!hasToday) {
    logger.info('No backup found for today, creating startup backup');
    await createBackup();
  } else {
    logger.debug('Startup backup skipped — already have one for today');
  }
}

/**
 * Triggers a manual backup with cooldown enforcement.
 * Throws if called again within the cooldown window.
 *
 * @returns Backup result or throws with cooldown info
 */
export async function triggerManualBackup(): Promise<BackupCreateResponse> {
  const now = Date.now();
  const elapsed = now - lastManualBackupTime;

  if (lastManualBackupTime > 0 && elapsed < config.backupManualCooldownMs) {
    const retryAfterSec = Math.ceil((config.backupManualCooldownMs - elapsed) / 1000);
    const err = new Error('Backup cooldown active') as Error & { retryAfterSec: number };
    err.retryAfterSec = retryAfterSec;
    throw err;
  }

  lastManualBackupTime = now;
  return createBackup();
}

/**
 * Resets the manual backup cooldown timer.
 * Only used in tests.
 */
export function resetCooldown(): void {
  lastManualBackupTime = 0;
}

/**
 * Returns the resolved backup directory path.
 * Used by server.ts for logging and by tests.
 */
export function getBackupDir(): string {
  return BACKUP_DIR;
}
