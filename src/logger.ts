/**
 * @fileoverview Structured logging module using Pino with log rotation support.
 * Provides consistent logging across the application with different log levels.
 * @module logger
 */

import pino, { Logger, TransportSingleOptions } from 'pino';
import path from 'path';
import fs from 'fs';
import type { Request, Response, NextFunction } from 'express';
import config from './config.js';

// Configuration from centralized config
const LOG_DIR = config.paths.logs(import.meta.dirname);
const LOG_LEVEL = config.logLevel;
const NODE_ENV = config.nodeEnv;

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Create pino transport configuration based on environment.
 * In development: pretty print to console.
 * In production: JSON to file with rotation support.
 */
function getTransport(): TransportSingleOptions {
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
const baseConfig: pino.LoggerOptions = {
  level: LOG_LEVEL,
  base: {
    env: NODE_ENV
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label: string) => ({ level: label })
  }
};

/** Extended logger interface with custom methods */
interface CustomLogger extends Logger {
  createChild: (bindings: pino.Bindings) => Logger;
  requestMiddleware: (req: Request, res: Response, next: NextFunction) => void;
}

/**
 * Create the logger instance.
 * Falls back to basic console transport if pino-pretty/pino-roll not available.
 */
let logger: CustomLogger;

try {
  logger = pino(baseConfig, pino.transport(getTransport())) as CustomLogger;
} catch (err) {
  // Fallback if transport modules not installed
  logger = pino({
    ...baseConfig,
    transport: undefined
  }) as CustomLogger;
  const errorMessage = err instanceof Error ? err.message : 'Unknown error';
  logger.warn({ err: errorMessage }, 'Using basic logger - install pino-pretty (dev) or pino-roll (prod) for better output');
}

/**
 * Create a child logger with additional context.
 * Useful for adding request-specific or module-specific context.
 */
logger.createChild = function(this: Logger, bindings: pino.Bindings): Logger {
  return this.child(bindings);
};

/**
 * Express middleware for request logging.
 * Logs method, URL, status code, and response time.
 */
logger.requestMiddleware = function(req: Request, res: Response, next: NextFunction): void {
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

export default logger;
