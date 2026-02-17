/**
 * @fileoverview Centralized configuration for the Meal Planner application.
 * Consolidates all configuration constants from server, database, and logger modules.
 * @module config
 */

import path from 'path';
import type { AppConfig } from './types/index.js';

/**
 * Application configuration object.
 * All configurable values are centralized here for easy management.
 */
const config: AppConfig = {
  // Server configuration
  port: process.env.PORT || 3000,
  maxJsonBodySize: '10kb',

  // Rate limiting configuration
  rateLimitWindowMs: 15 * 60 * 1000,
  rateLimitReadMax: 500,
  rateLimitWriteMax: 100,

  // Database configuration
  maxFieldLength: 500,
  maxNoteLength: 1000,
  maxWeeksReturned: 52,

  // Timezone configuration
  timezone: 'America/New_York',

  // Background tasks
  autoCompleteIntervalMs: 5 * 60 * 1000, // 5 minutes

  // Backup configuration
  backupIntervalMs: 24 * 60 * 60 * 1000, // 24 hours
  backupRetainDaily: 7,
  backupRetainWeekly: 4,
  backupRetainMonthly: 3,
  backupManualCooldownMs: 5 * 60 * 1000, // 5 minutes

  // Logging configuration
  logLevel: process.env.LOG_LEVEL || 'info',
  nodeEnv: process.env.NODE_ENV || 'development',

  // Path configuration (functions that accept dirname for proper resolution)
  paths: {
    db: (dirname: string): string => path.join(dirname, '../meals.db'),
    logs: (dirname: string): string => process.env.LOG_DIR || path.join(dirname, '../logs'),
    public: (dirname: string): string => path.join(dirname, '../public'),
    backups: (dirname: string): string => process.env.BACKUP_DIR || path.join(dirname, '../backups'),
  }
};

export default config;
