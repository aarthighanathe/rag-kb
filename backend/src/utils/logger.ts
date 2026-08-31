/**
 * @file logger.ts
 * @description Winston logger with JSON transport, correlation ID support, and log-level control
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import winston from 'winston';
import { env } from '../config/env.js';
import { getRequestContext } from './requestContext.js';

const { combine, timestamp, json, colorize, printf, errors } = winston.format;

/**
 * Injects the current request's correlationId (from AsyncLocalStorage) into
 * every log entry that doesn't already carry one — so a service-layer call
 * (`upsertChunks`, `streamCompletion`, etc.) that never received
 * correlationId as an explicit parameter still gets it in its log lines,
 * without needing to thread it through every function signature. An
 * explicit correlationId (e.g. from `logger.child({ correlationId })`)
 * always wins — this only fills the gap, it never overrides.
 */
const withRequestCorrelationId = winston.format((info) => {
  if (info['correlationId'] === undefined) {
    const context = getRequestContext();
    if (context) info['correlationId'] = context.correlationId;
  }
  return info;
});

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
    withRequestCorrelationId(),
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
