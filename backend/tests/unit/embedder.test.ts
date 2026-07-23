/**
 * @file embedder.test.ts
 * @description Unit tests for the HuggingFace embedding service — batching and 429/error handling.
 *   Retry is BullMQ job-level (documentQueue.ts), not this module's concern — each test here
 *   expects a single fetch attempt per batch and a typed EmbeddingError on failure.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock global fetch before importing the module ───────────────────────────

const mockFetch = vi.fn();

vi.mock('../../src/utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import {
  embedText,
  embedBatch,
  validateEmbedding,
  EMBEDDING_DIMENSION,
  EMBEDDING_MODEL,
} from '../../src/services/embedder';
import { EmbeddingError, EmbeddingErrorCode } from '../../src/utils/errors';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns a valid 384-dimensional embedding vector. */
function makeEmbedding(value = 0.1): number[] {
  return Array.from({ length: EMBEDDING_DIMENSION }, () => value);
}

/** Creates a mocked fetch response. */
function mockResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ─── validateEmbedding ────────────────────────────────────────────────────────

describe('validateEmbedding', () => {
  it('returns true for a correct 384-dim vector', () => {
    expect(validateEmbedding(makeEmbedding())).toBe(true);
  });

  it('returns false when dimension is wrong', () => {
    expect(validateEmbedding([0.1, 0.2, 0.3])).toBe(false);
    expect(validateEmbedding(Array.from({ length: 512 }, () => 0.1))).toBe(false);
  });

  it('returns false when values contain non-finite numbers', () => {
    const vec = makeEmbedding();
    vec[0] = NaN;
    expect(validateEmbedding(vec)).toBe(false);

    const vec2 = makeEmbedding();
    vec2[5] = Infinity;
    expect(validateEmbedding(vec2)).toBe(false);
  });

  it('returns false for empty array', () => {
    expect(validateEmbedding([])).toBe(false);
  });
});

// ─── embedText ────────────────────────────────────────────────────────────────

describe('embedText', () => {
  it('returns an EmbeddingResult with correct shape', async () => {
    mockFetch.mockResolvedValue(mockResponse([makeEmbedding()]));

    const promise = embedText('hello world');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.embedding).toHaveLength(EMBEDDING_DIMENSION);
    expect(result.model).toBe(EMBEDDING_MODEL);
    expect(typeof result.tokenCount).toBe('number');
    expect(result.tokenCount).toBeGreaterThan(0);
  });

  it('throws EmbeddingError for empty text', async () => {
    await expect(embedText('')).rejects.toBeInstanceOf(EmbeddingError);
    await expect(embedText('  ')).rejects.toBeInstanceOf(EmbeddingError);
  });

  it('throws EmbeddingError with EMPTY_INPUT code for blank input', async () => {
    try {
      await embedText('');
    } catch (err) {
      expect(err).toBeInstanceOf(EmbeddingError);
      expect((err as EmbeddingError).code).toBe(EmbeddingErrorCode.EMPTY_INPUT);
    }
  });
});

// ─── embedBatch ───────────────────────────────────────────────────────────────

describe('embedBatch', () => {
  it('returns empty array for empty input', async () => {
    const result = await embedBatch([]);
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns one EmbeddingResult per input text', async () => {
    const texts = ['text one', 'text two', 'text three'];
    mockFetch.mockResolvedValue(mockResponse([makeEmbedding(0.1), makeEmbedding(0.2), makeEmbedding(0.3)]));

    const promise = embedBatch(texts);
    await vi.runAllTimersAsync();
    const results = await promise;

    expect(results).toHaveLength(texts.length);
    results.forEach((r) => {
      expect(r.embedding).toHaveLength(EMBEDDING_DIMENSION);
      expect(r.model).toBe(EMBEDDING_MODEL);
    });
  });

  it('splits into multiple batches when texts exceed batchSize', async () => {
    const texts = Array.from({ length: 5 }, (_, i) => `text ${i}`);
    // Each batch will return embeddings for the texts in that batch
    mockFetch
      .mockResolvedValueOnce(mockResponse([makeEmbedding(0.1), makeEmbedding(0.2), makeEmbedding(0.3)]))
      .mockResolvedValueOnce(mockResponse([makeEmbedding(0.4), makeEmbedding(0.5)]));

    const promise = embedBatch(texts, 3);
    await vi.runAllTimersAsync();
    const results = await promise;

    expect(results).toHaveLength(5);
    expect(mockFetch).toHaveBeenCalledTimes(2); // 2 batches
  });

  it('batches at 32 by default (single API call for ≤32 texts)', async () => {
    const texts = Array.from({ length: 32 }, (_, i) => `text ${i}`);
    mockFetch.mockResolvedValue(
      mockResponse(Array.from({ length: 32 }, () => makeEmbedding())),
    );

    const promise = embedBatch(texts);
    await vi.runAllTimersAsync();
    await promise;

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('throws EmbeddingError with INVALID_DIMENSION when API returns wrong dimension', async () => {
    const badEmbedding = [0.1, 0.2, 0.3]; // only 3 dims
    mockFetch.mockResolvedValue(mockResponse([badEmbedding]));

    // Attach the rejection handler in the same tick the promise is created —
    // if it's attached only after `runAllTimersAsync()`, Node sees an
    // unhandled rejection in between (the promise settles while the timers
    // are draining, before anything is listening), which flips the process
    // exit code under non-TTY output (e.g. CI) even though the test itself
    // still passes.
    const errPromise = embedBatch(['some text']).catch((e: unknown) => e);
    await vi.runAllTimersAsync();

    const err = await errPromise;
    expect(err).toBeInstanceOf(EmbeddingError);
    expect((err as EmbeddingError).code).toBe(EmbeddingErrorCode.INVALID_DIMENSION);
  });

  // ─── Malformed response shape (cold-start / overload) ────────────────────

  it('throws EmbeddingError (not a raw TypeError) when the API returns a 200 with a non-array body', async () => {
    // HuggingFace cold-start / overload behaviour: 200 status, but the body
    // is an error object instead of embedding vectors. A single attempt is
    // made — retry for this transient case is BullMQ's job-level concern,
    // not this module's.
    mockFetch.mockResolvedValueOnce(mockResponse({ error: 'Model is currently loading' }));

    const errPromise = embedBatch(['some text']).catch((e: unknown) => e);
    await vi.runAllTimersAsync();

    const err = await errPromise;
    expect(err).toBeInstanceOf(EmbeddingError);
    expect(err).not.toBeInstanceOf(TypeError);
    expect((err as EmbeddingError).code).toBe(EmbeddingErrorCode.API_UNAVAILABLE);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('wraps a non-array-of-non-arrays response in API_UNAVAILABLE', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(['not', 'an', 'embedding']));

    const errPromise = embedBatch(['some text']).catch((e: unknown) => e as EmbeddingError);
    await vi.runAllTimersAsync();

    const err = await errPromise;
    expect(err.code).toBe(EmbeddingErrorCode.API_UNAVAILABLE);
  });

  it('wraps a null response in API_UNAVAILABLE rather than crashing', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(null));

    const errPromise = embedBatch(['some text']).catch((e: unknown) => e as EmbeddingError);
    await vi.runAllTimersAsync();

    const err = await errPromise;
    expect(err).toBeInstanceOf(EmbeddingError);
    expect(err.code).toBe(EmbeddingErrorCode.API_UNAVAILABLE);
  });
});

// ─── Single-attempt error surfacing (no in-module retry) ─────────────────────

describe('surfaces transient failures immediately (no per-batch retry)', () => {
  it('throws EmbeddingError on a single 500 error without a second attempt', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse('Server Error', 500));

    const errPromise = embedBatch(['hello']).catch((e: unknown) => e);
    await vi.runAllTimersAsync();

    const err = await errPromise;
    expect(err).toBeInstanceOf(EmbeddingError);
    expect((err as EmbeddingError).code).toBe(EmbeddingErrorCode.API_UNAVAILABLE);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('throws EmbeddingError with RATE_LIMITED code on a 429 without retrying in-process', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse('Rate Limited', 429));

    const errPromise = embedBatch(['hello']).catch((e: unknown) => e as EmbeddingError);
    await vi.runAllTimersAsync();

    const err = await errPromise;
    expect(err.code).toBe(EmbeddingErrorCode.RATE_LIMITED);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
