/**
 * @file clientLogger.ts
 * @description Lightweight client-side logger that respects the no-console lint rule.
 *   In production, errors can be forwarded to a monitoring service. In development,
 *   uses the browser console.
 * @author [Author Placeholder]
 * @created 2026-07-04
 */

type LogLevel = 'error' | 'warn' | 'info';

/**
 * Logs a message at the given level.
 * Uses console internally but is the single approved entry point — add remote
 * logging here when needed.
 * @param level - Log severity level
 * @param message - Log message prefix
 * @param args - Additional data to log
 */
export function clientLog(
  level: LogLevel,
  message: string,
  ...args: unknown[]
): void {
  if (import.meta.env.MODE === 'production') {
    // TODO: forward to monitoring service (Sentry, etc.)
    return;
  }
  // eslint-disable-next-line no-console
  console[level](`[${level.toUpperCase()}] ${message}`, ...args);
}
