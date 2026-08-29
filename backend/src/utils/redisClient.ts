/**
 * @file redisClient.ts
 * @description Shared ioredis singleton for non-BullMQ key/value use (pending-query bridge)
 * @author [Author Placeholder]
 * @created 2026-08-29
 */

import Redis from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

let _client: Redis | null = null;

/**
 * Returns the singleton ioredis client, creating it on first call.
 * Separate from BullMQ's own internal connections (documentQueue.ts,
 * documentWorker.ts) — this one is for plain GET/SET/DEL use by application
 * code that needs a shared, process-restart-surviving key/value store.
 * @returns Connected ioredis client
 */
export function getRedisClient(): Redis {
  if (!_client) {
    _client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
    });

    _client.on('error', (err) => {
      logger.error('Redis client connection error', { error: err.message, stack: err.stack });
    });
  }
  return _client;
}
