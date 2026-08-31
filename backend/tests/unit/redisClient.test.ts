/**
 * @file redisClient.test.ts
 * @description Unit tests for the shared ioredis singleton — lazy creation, singleton
 *   reuse across calls, constructor options, and the error listener wiring.
 * @author [Author Placeholder]
 * @created 2026-08-31
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks (run before any module imports) ───────────────────────────

const { MockRedis, constructorSpy, onSpy } = vi.hoisted(() => {
  const constructorSpy = vi.fn();
  const onSpy = vi.fn();
  class MockRedis {
    constructor(url: string, opts: Record<string, unknown>) {
      constructorSpy(url, opts);
    }
    on = onSpy;
  }
  return { MockRedis, constructorSpy, onSpy };
});

vi.mock('ioredis', () => ({ default: MockRedis }));

vi.mock('../../src/utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../../src/config/env', () => ({
  env: { REDIS_URL: 'redis://localhost:6379' },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('getRedisClient', () => {
  it('creates a Redis client with the configured REDIS_URL and maxRetriesPerRequest', async () => {
    const { getRedisClient } = await import('../../src/utils/redisClient');

    getRedisClient();

    expect(constructorSpy).toHaveBeenCalledWith(
      'redis://localhost:6379',
      expect.objectContaining({ maxRetriesPerRequest: 3 }),
    );
  });

  it('registers an error listener on the client', async () => {
    const { getRedisClient } = await import('../../src/utils/redisClient');

    getRedisClient();

    expect(onSpy).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('returns the same singleton instance across repeated calls', async () => {
    const { getRedisClient } = await import('../../src/utils/redisClient');

    const first = getRedisClient();
    const second = getRedisClient();

    expect(first).toBe(second);
    expect(constructorSpy).toHaveBeenCalledTimes(1);
  });

  it('logs an error via the logger when the client emits an "error" event', async () => {
    const { getRedisClient } = await import('../../src/utils/redisClient');
    const { logger } = await import('../../src/utils/logger');

    getRedisClient();
    const errorHandler = onSpy.mock.calls.find(([event]) => event === 'error')?.[1] as
      | ((err: Error) => void)
      | undefined;
    expect(errorHandler).toBeDefined();

    const fakeError = new Error('ECONNREFUSED');
    errorHandler?.(fakeError);

    expect(logger.error).toHaveBeenCalledWith(
      'Redis client connection error',
      expect.objectContaining({ error: 'ECONNREFUSED' }),
    );
  });
});
