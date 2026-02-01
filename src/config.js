/**
 * @fileoverview Centralized configuration for the Meal Planner application.
 * Consolidates all configuration constants from server, database, and logger modules.
 * @module config
 */

const path = require('path');

/**
 * Application configuration object.
 * All configurable values are centralized here for easy management.
 * @constant {Object}
 */
module.exports = {
  // Server configuration
  /** Port the server listens on */
  port: process.env.PORT || 3000,
  /** Maximum size for JSON request bodies */
  maxJsonBodySize: '10kb',

  // Rate limiting configuration
  /** Rate limiting window in milliseconds (15 minutes) */
  rateLimitWindowMs: 15 * 60 * 1000,
  /** Maximum read requests per window */
  rateLimitReadMax: 500,
  /** Maximum write requests per window */
  rateLimitWriteMax: 100,

  // Database configuration
  /** Maximum length for meal fields */
  maxFieldLength: 500,
  /** Maximum length for note fields */
  maxNoteLength: 1000,
  /** Maximum number of weeks returned in list queries */
  maxWeeksReturned: 52,

  // Timezone configuration
  /** IANA timezone identifier for all date calculations */
  timezone: 'America/New_York',

  // Logging configuration
  /** Log level (trace, debug, info, warn, error, fatal) */
  logLevel: process.env.LOG_LEVEL || 'info',
  /** Node environment (development, production) */
  nodeEnv: process.env.NODE_ENV || 'development',

  // Path configuration (functions that accept dirname for proper resolution)
  paths: {
    /**
     * Get the database file path
     * @param {string} dirname - The __dirname of the calling module
     * @returns {string} Absolute path to the database file
     */
    db: (dirname) => path.join(dirname, '../meals.db'),

    /**
     * Get the logs directory path
     * @param {string} dirname - The __dirname of the calling module
     * @returns {string} Absolute path to the logs directory
     */
    logs: (dirname) => process.env.LOG_DIR || path.join(dirname, '../logs'),

    /**
     * Get the public static files directory path
     * @param {string} dirname - The __dirname of the calling module
     * @returns {string} Absolute path to the public directory
     */
    public: (dirname) => path.join(dirname, '../public'),
  }
};
