/**
 * @file logger.ts
 * @description Winston logger with JSON transport, correlation ID support, and log-level control
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import winston from 'winston';
import { env } from '../config/env.js';

const { combine, timestamp, json, colorize, printf, errors } = winston.format;

/** Human-readable format for development console output. */
const devFormat = printf(({ level, message, timestamp: ts, correlationId, ...meta }) => {
  const cid = correlationId ? ` [${String(correlationId)}]` : '';
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${String(ts)} ${level}${cid}: ${String(message)}${metaStr}`;
});

const isDev = env.NODE_ENV !== 'production';

/** Application-wide Winston logger. Use this exclusively — never use console.log. */
export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    isDev ? combine(colorize(), devFormat) : json(),
  ),
  transports: [new winston.transports.Console()],
  exitOnError: false,
});

/**
 * Logs an unhandled error with full stack trace before process exit.
 * @param error - The uncaught error
 * @param origin - 'uncaughtException' | 'unhandledRejection'
 */
export function logFatalError(error: unknown, origin: string): void {
  const err = error instanceof Error ? error : new Error(String(error));
  logger.error('Fatal error — process will exit', {
    origin,
    message: err.message,
    stack: err.stack,
  });
}
