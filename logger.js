/**
 * @fileoverview Structured logging module using Pino with log rotation support.
 * Provides consistent logging across the application with different log levels.
 * @module logger
 */

const pino = require('pino');
const path = require('path');
const fs = require('fs');

// Configuration
const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, 'logs');
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Create pino transport configuration based on environment.
 * In development: pretty print to console.
 * In production: JSON to file with rotation support.
 * @returns {object} Pino transport configuration
 */
function getTransport() {
  if (NODE_ENV === 'development') {
    return {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname'
      }
    };
  }

  // Production: use pino-roll for log rotation
  return {
    target: 'pino-roll',
    options: {
      file: path.join(LOG_DIR, 'app'),
      frequency: 'daily',
      mkdir: true,
      size: '10m',
      extension: '.log'
    }
  };
}

/**
 * Base logger configuration
 */
const baseConfig = {
  level: LOG_LEVEL,
  base: {
    env: NODE_ENV
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label })
  }
};

/**
 * Create the logger instance.
 * Falls back to basic console transport if pino-pretty/pino-roll not available.
 */
let logger;

try {
  logger = pino(baseConfig, pino.transport(getTransport()));
} catch (err) {
  // Fallback if transport modules not installed
  logger = pino({
    ...baseConfig,
    transport: undefined
  });
  logger.warn({ err: err.message }, 'Using basic logger - install pino-pretty (dev) or pino-roll (prod) for better output');
}

/**
 * Create a child logger with additional context.
 * Useful for adding request-specific or module-specific context.
 * @param {object} bindings - Key-value pairs to include in all log entries
 * @returns {pino.Logger} Child logger instance
 * @example
 * const reqLogger = logger.child({ requestId: 'abc123' });
 * reqLogger.info('Processing request');
 */
logger.createChild = function(bindings) {
  return this.child(bindings);
};

/**
 * Express middleware for request logging.
 * Logs method, URL, status code, and response time.
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {function} next - Next middleware function
 */
logger.requestMiddleware = function(req, res, next) {
  const start = Date.now();
  const requestId = Math.random().toString(36).substring(2, 10);

  // Add request ID to request for tracing
  req.requestId = requestId;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      requestId,
      method: req.method,
      url: req.path, // Use path instead of originalUrl to avoid logging query params
      statusCode: res.statusCode,
      duration,
      userAgent: req.get('user-agent')
    };

    if (res.statusCode >= 500) {
      logger.error(logData, 'Request failed');
    } else if (res.statusCode >= 400) {
      logger.warn(logData, 'Request error');
    } else {
      logger.info(logData, 'Request completed');
    }
  });

  next();
};

/**
 * Log levels available:
 * - trace: Very detailed debugging information
 * - debug: Debugging information
 * - info: General information about application state
 * - warn: Warning conditions that should be addressed
 * - error: Error conditions
 * - fatal: Critical errors causing shutdown
 *
 * @example
 * logger.info({ userId: 123 }, 'User logged in');
 * logger.error({ err }, 'Database connection failed');
 * logger.warn({ weekOf: '2024-01-01' }, 'Week not found');
 */

module.exports = logger;
