/**
 * @file index.ts
 * @description Server entry point — bootstraps the Express app and starts listening
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import type { Server } from 'http';
import { env } from './config/env.js';
import { createApp } from './app.js';
import { logger, logFatalError } from './utils/logger.js';
import { getQueue } from './queues/documentQueue.js';
import { documentWorker } from './queues/workers/index.js';
import { checkReadiness } from './utils/readiness.js';

/** Maximum time to wait for in-flight requests to finish before forcing exit. */
const SHUTDOWN_TIMEOUT_MS = 30_000;

/**
 * Gracefully shuts down the HTTP server, then the job queue/worker.
 * Stops accepting new connections first and lets in-flight requests (including
 * uploads and SSE chat streams) finish, up to a bounded timeout, before
 * tearing down BullMQ and exiting.
 */
async function gracefulShutdown(signal: string, server: Server): Promise<void> {
  logger.info(`Received ${signal} — starting graceful shutdown`);

  try {
    await new Promise<void>((resolve, reject) => {
      const forceTimer = setTimeout(() => {
        logger.warn('Graceful shutdown timed out — forcing server close', {
          timeoutMs: SHUTDOWN_TIMEOUT_MS,
        });
        resolve();
      }, SHUTDOWN_TIMEOUT_MS);

      server.close((err) => {
        clearTimeout(forceTimer);
        if (err) reject(err);
        else resolve();
      });
    });
    logger.info('HTTP server closed');
  } catch (err) {
    logger.error('Error closing HTTP server during shutdown', { error: err });
  }

  try {
    await Promise.all([getQueue().close(), documentWorker.close()]);
    logger.info('BullMQ queue and worker closed');
  } catch (err) {
    logger.error('Error closing queue/worker during shutdown', { error: err });
  }

  process.exit(0);
}

/** Bootstraps the application and starts the HTTP server. */
async function bootstrap(): Promise<void> {
  // Loud, unmissable startup line: the single place an operator can confirm
  // NODE_ENV actually resolved to what the deploy host was supposed to set,
  // before any other log noise starts.
  logger.info(`>>> NODE_ENV=${env.NODE_ENV} <<<`);

  // Fail loud, not silent: if Redis rejects auth (REDIS_URL missing the
  // password docker-compose's --requirepass enforces) or Supabase is
  // unreachable, the document queue would otherwise fail invisibly on the
  // first upload rather than at boot, where it's immediately actionable.
  const startupReadiness = await checkReadiness();
  if (startupReadiness.status !== 'ok') {
    logger.error('Startup dependency check failed — see checks for detail', {
      checks: startupReadiness.checks,
    });
  } else {
    logger.info('Startup dependency check passed (Supabase + Redis reachable)');
  }

  const app = createApp();

  const server = app.listen(env.PORT, () => {
    logger.info(`RAG Knowledge Base backend started`, {
      port: env.PORT,
      env: env.NODE_ENV,
      docs: `http://localhost:${env.PORT}/api/docs`,
    });
  });

  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM', server));
  process.on('SIGINT', () => void gracefulShutdown('SIGINT', server));
  process.on('uncaughtException', (err) => {
    logFatalError(err, 'uncaughtException');
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    logFatalError(reason, 'unhandledRejection');
    process.exit(1);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${env.PORT} is already in use`);
    } else {
      logger.error('Server error', { error: err.message });
    }
    process.exit(1);
  });
}

void bootstrap();
