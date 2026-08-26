/**
 * @file queryEmbeddingCache.test.ts
 * @description Unit tests for the Redis-backed query embedding cache — hit/miss/error paths
 * @author [Author Placeholder]
 * @created 2026-08-24
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks (run before any module imports) ───────────────────────────

const { mockGet, mockSet, MockRedis } = vi.hoisted(() => {
  const mockGet = vi.fn();
  const mockSet = vi.fn();
  class MockRedis {
    get = mockGet;
    set = mockSet;
    on = vi.fn();
  }
  return { mockGet, mockSet, MockRedis };
});

vi.mock('ioredis', () => ({ default: MockRedis }));

vi.mock('../../src/utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../../src/config/env', () => ({
  env: { REDIS_URL: 'redis://localhost:6379' },
}));

// ─── Import module under test (after mocks) ───────────────────────────────────

import {
  getCachedQueryEmbedding,
  setCachedQueryEmbedding,
  getCacheStats,
  resetCacheStats,
} from '../../src/services/queryEmbeddingCache';
import { EMBEDDING_MODEL, EMBEDDING_DIMENSION } from '../../src/services/embedder';

const sampleResult = {
  embedding: Array.from({ length: EMBEDDING_DIMENSION }, () => 0.1),
  tokenCount: 3,
  model: EMBEDDING_MODEL,
};

beforeEach(() => {
  vi.clearAllMocks();
  resetCacheStats();
});

describe('getCachedQueryEmbedding', () => {
  it('returns null on a cache miss', async () => {
    mockGet.mockResolvedValue(null);
    expect(await getCachedQueryEmbedding('what is the refund policy?')).toBeNull();
  });

  it('returns the parsed result on a cache hit', async () => {
    mockGet.mockResolvedValue(JSON.stringify(sampleResult));
    const result = await getCachedQueryEmbedding('what is the refund policy?');
    expect(result).toEqual(sampleResult);
  });

  it('returns null (not a throw) when the stored entry is malformed', async () => {
    mockGet.mockResolvedValue('{"not":"a valid embedding result"}');
    expect(await getCachedQueryEmbedding('query')).toBeNull();
  });

  it('returns null when the cached entry was written by a different model', async () => {
    mockGet.mockResolvedValue(JSON.stringify({ ...sampleResult, model: 'some-other-model' }));
    expect(await getCachedQueryEmbedding('query')).toBeNull();
  });

  it('returns null (not a throw) when Redis itself errors', async () => {
    mockGet.mockRejectedValue(new Error('connection refused'));
    expect(await getCachedQueryEmbedding('query')).toBeNull();
  });
});

describe('setCachedQueryEmbedding', () => {
  it('writes the result with an expiry', async () => {
    mockSet.mockResolvedValue('OK');
    await setCachedQueryEmbedding('query', sampleResult);
    expect(mockSet).toHaveBeenCalledWith(
      expect.stringContaining('lumina:query-embedding:'),
      JSON.stringify(sampleResult),
      'EX',
      expect.any(Number),
    );
  });

  it('does not throw when the Redis write fails', async () => {
    mockSet.mockRejectedValue(new Error('connection refused'));
    await expect(setCachedQueryEmbedding('query', sampleResult)).resolves.toBeUndefined();
  });
});

describe('cache key derivation', () => {
  it('uses the same key for the same text across calls', async () => {
    mockGet.mockResolvedValue(null);
    await getCachedQueryEmbedding('identical query text');
    await getCachedQueryEmbedding('identical query text');
    const [firstKey] = mockGet.mock.calls[0] as [string];
    const [secondKey] = mockGet.mock.calls[1] as [string];
    expect(firstKey).toBe(secondKey);
  });

  it('uses different keys for different text', async () => {
    mockGet.mockResolvedValue(null);
    await getCachedQueryEmbedding('query one');
    await getCachedQueryEmbedding('query two');
    const [firstKey] = mockGet.mock.calls[0] as [string];
    const [secondKey] = mockGet.mock.calls[1] as [string];
    expect(firstKey).not.toBe(secondKey);
  });
});

describe('cache hit/miss instrumentation', () => {
  it('starts at zero for a fresh process with a 0% hit rate', () => {
    expect(getCacheStats()).toEqual({ hits: 0, misses: 0, errors: 0, hitRatePercent: 0 });
  });

  it('increments hits on a cache hit and computes the hit rate', async () => {
    mockGet.mockResolvedValue(JSON.stringify(sampleResult));
    await getCachedQueryEmbedding('query');
    await getCachedQueryEmbedding('query');
    expect(getCacheStats()).toEqual({ hits: 2, misses: 0, errors: 0, hitRatePercent: 100 });
  });

  it('increments misses on a cache miss', async () => {
    mockGet.mockResolvedValue(null);
    await getCachedQueryEmbedding('query');
    expect(getCacheStats()).toEqual({ hits: 0, misses: 1, errors: 0, hitRatePercent: 0 });
  });

  it('increments misses (not hits) for a malformed cached entry', async () => {
    mockGet.mockResolvedValue('{"not":"a valid embedding result"}');
    await getCachedQueryEmbedding('query');
    expect(getCacheStats().misses).toBe(1);
    expect(getCacheStats().hits).toBe(0);
  });

  it('increments both errors and misses when Redis itself errors', async () => {
    mockGet.mockRejectedValue(new Error('connection refused'));
    await getCachedQueryEmbedding('query');
    const stats = getCacheStats();
    expect(stats.errors).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(0);
  });

  it('computes a mixed hit rate correctly and rounds to 2 decimal places', async () => {
    mockGet
      .mockResolvedValueOnce(JSON.stringify(sampleResult)) // hit
      .mockResolvedValueOnce(null) // miss
      .mockResolvedValueOnce(null); // miss
    await getCachedQueryEmbedding('a');
    await getCachedQueryEmbedding('b');
    await getCachedQueryEmbedding('c');
    // 1 hit / 3 total = 33.333...% -> rounded to 33.33
    expect(getCacheStats()).toEqual({ hits: 1, misses: 2, errors: 0, hitRatePercent: 33.33 });
  });

  it('setCachedQueryEmbedding does not affect hit/miss counters', async () => {
    mockSet.mockResolvedValue('OK');
    await setCachedQueryEmbedding('query', sampleResult);
    expect(getCacheStats()).toEqual({ hits: 0, misses: 0, errors: 0, hitRatePercent: 0 });
  });

  it('resetCacheStats zeroes all counters', async () => {
    mockGet.mockResolvedValue(JSON.stringify(sampleResult));
    await getCachedQueryEmbedding('query');
    resetCacheStats();
    expect(getCacheStats()).toEqual({ hits: 0, misses: 0, errors: 0, hitRatePercent: 0 });
  });
});
