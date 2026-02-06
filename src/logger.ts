/**
 * @fileoverview Structured logging module using Pino with log rotation support.
 * Provides consistent logging across the application with different log levels.
 * @module logger
 */

import pino, { Logger } from 'pino';
import { createRequire } from 'module';
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
 * Check if a module is available without importing it.
 */
function isModuleAvailable(name: string): boolean {
  try {
    createRequire(import.meta.url).resolve(name);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build pino transport targets based on environment and available modules.
 * In development: pretty print to console (falls back to plain JSON stdout).
 * In production: always JSON to stdout, plus file rotation if pino-roll is available.
 */
function createTransport(): ReturnType<typeof pino.transport> | undefined {
  if (NODE_ENV === 'development') {
    if (isModuleAvailable('pino-pretty')) {
      return pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname'
        }
      });
    }
    // pino-pretty not available — fall back to default stdout (no transport)
    return undefined;
  }

  // Production: always include stdout, optionally add file rotation
  const targets: pino.TransportTargetOptions[] = [
    { target: 'pino/file', options: { destination: 1 } }
  ];

  if (isModuleAvailable('pino-roll')) {
    targets.push({
      target: 'pino-roll',
      options: {
        file: path.join(LOG_DIR, 'app'),
        frequency: 'daily',
        mkdir: true,
        size: '10m',
        extension: '.log'
      }
    });
  }

  return pino.transport({ targets });
}

/**
 * Base logger configuration
 */
const baseConfig: pino.LoggerOptions = {
  level: LOG_LEVEL,
  base: {
    env: NODE_ENV
  },
  timestamp: pino.stdTimeFunctions.isoTime
};

/** Extended logger interface with custom methods */
interface CustomLogger extends Logger {
  createChild: (bindings: pino.Bindings) => Logger;
  requestMiddleware: (req: Request, res: Response, next: NextFunction) => void;
}

/**
 * Create the logger instance.
 * Always logs to stdout. File transport is added when pino-roll is available.
 */
let logger: CustomLogger;

const transport = createTransport();
if (transport) {
  logger = pino(baseConfig, transport) as CustomLogger;
} else {
  // No transport — pino writes JSON to stdout by default
  logger = pino(baseConfig) as CustomLogger;
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
