/**
 * @file queryEmbeddingCache.ts
 * @description Redis-backed cache for single-text (query-time) embeddings — skips a
 *   HuggingFace API call for a repeat/duplicate query string. Reuses the REDIS_URL
 *   connection BullMQ already depends on; no new infrastructure.
 * @author [Author Placeholder]
 * @created 2026-08-24
 */

import Redis from 'ioredis';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { EMBEDDING_MODEL, type EmbeddingResult } from './embedder.js';

/** Cache entries expire after 1 hour — bounds staleness if the embedding model ever changes. */
const CACHE_TTL_SECONDS = 60 * 60;

const KEY_PREFIX = 'lumina:query-embedding:';

let _client: Redis | null = null;

// ─── Hit/miss instrumentation ──────────────────────────────────────────────────
//
// In-process counters only — reset on restart and not shared across
// instances. Sufficient for observing real cache behavior in a single dev/
// benchmark session; a multi-instance deployment would need these in Redis
// itself (e.g. INCR on a stats key) to aggregate across processes.

let hitCount = 0;
let missCount = 0;
let errorCount = 0;

/** Cache instrumentation counters and derived hit rate. */
export interface CacheStats {
  hits: number;
  misses: number;
  errors: number;
  /** hits / (hits + misses), as a percentage rounded to 2 decimal places. Errors count as misses (the caller always falls through to a live embedding) but are also tracked separately. 0 when no lookups have occurred yet. */
  hitRatePercent: number;
}

/**
 * Returns current cache hit/miss/error counts and the derived hit rate.
 * @returns Snapshot of in-process cache instrumentation
 */
export function getCacheStats(): CacheStats {
  const total = hitCount + missCount;
  const hitRatePercent = total === 0 ? 0 : Math.round((hitCount / total) * 10000) / 100;
  return { hits: hitCount, misses: missCount, errors: errorCount, hitRatePercent };
}

/** Resets all counters to zero. Exported for test isolation between benchmark/test runs. */
export function resetCacheStats(): void {
  hitCount = 0;
  missCount = 0;
  errorCount = 0;
}

/**
 * Returns the singleton ioredis client for this cache, creating it on first
 * call. Kept separate from BullMQ's own connection (documentQueue.ts) since
 * the two serve unrelated purposes and shouldn't share failure/lifecycle
 * coupling — a cache outage must never affect job processing or vice versa.
 * @returns Connected ioredis client
 */
function getClient(): Redis {
  if (!_client) {
    _client = new Redis(env.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 1 });
    _client.on('error', (err) => {
      logger.warn('Query embedding cache Redis error', { error: err.message });
    });
  }
  return _client;
}

/**
 * Derives a stable, collision-resistant cache key for a query string.
 * @param text - Raw query text
 * @returns Redis key including a content hash
 */
function cacheKey(text: string): string {
  const hash = crypto.createHash('sha256').update(text).digest('hex');
  return `${KEY_PREFIX}${hash}`;
}

/**
 * Looks up a cached embedding for the given text. Never throws — a cache
 * failure (Redis down, malformed entry) is treated as a miss so the caller
 * always falls back to the real HuggingFace call rather than failing the
 * request over what is purely a latency optimization.
 * @param text - Query text to look up
 * @returns The cached EmbeddingResult, or null on a miss or any error
 */
export async function getCachedQueryEmbedding(text: string): Promise<EmbeddingResult | null> {
  try {
    const raw = await getClient().get(cacheKey(text));
    if (!raw) {
      missCount++;
      return null;
    }
    const parsed = JSON.parse(raw) as EmbeddingResult;
    if (!Array.isArray(parsed.embedding) || parsed.model !== EMBEDDING_MODEL) {
      missCount++;
      return null;
    }
    hitCount++;
    logger.debug('Query embedding cache hit', getCacheStats());
    return parsed;
  } catch (err) {
    errorCount++;
    missCount++;
    logger.warn('Query embedding cache read failed — falling back to live embedding', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Stores an embedding result for later reuse. Never throws — a write failure
 * only costs a future cache miss, not correctness of the current request.
 * @param text - Query text the embedding was computed for
 * @param result - EmbeddingResult to cache
 */
export async function setCachedQueryEmbedding(
  text: string,
  result: EmbeddingResult,
): Promise<void> {
  try {
    await getClient().set(cacheKey(text), JSON.stringify(result), 'EX', CACHE_TTL_SECONDS);
  } catch (err) {
    logger.warn('Query embedding cache write failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
