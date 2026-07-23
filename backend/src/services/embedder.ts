/**
 * @file embedder.ts
 * @description HuggingFace Inference API embedding service — generates 384-dim vectors.
 *              Retry on transient failures is handled at the BullMQ job level
 *              (documentQueue.ts); this module makes a single attempt per batch
 *              and throws a typed EmbeddingError for the caller/queue to retry.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { env } from '../config/env.js';
import { EmbeddingError, EmbeddingErrorCode } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { JobCancelledError } from '../queues/cancellation.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const HF_API_URL =
  'https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction';

/** Public model identifier included in every EmbeddingResult. */
export const EMBEDDING_MODEL = 'sentence-transformers/all-MiniLM-L6-v2';

/** Expected vector dimension for all-MiniLM-L6-v2. */
export const EMBEDDING_DIMENSION = 384;

/** HuggingFace batch limit per request. */
const MAX_BATCH_SIZE = 32;

/** Proactive inter-batch pause — keeps HF free-tier under its rate limit. */
const INTER_BATCH_DELAY_MS = 200;

/** Per-request timeout in milliseconds. */
const REQUEST_TIMEOUT_MS = 30_000;

// ─── Interfaces ───────────────────────────────────────────────────────────────

/** Result of a single text embedding operation. */
export interface EmbeddingResult {
  /** 384-dimensional embedding vector. */
  embedding: number[];
  /** Estimated token count for the input text (1 token ≈ 4 chars). */
  tokenCount: number;
  /** Model identifier used to produce this embedding. */
  model: string;
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Returns a Promise that resolves after the specified delay.
 * @param ms - Milliseconds to wait
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Splits an array into sub-arrays of at most `size` elements.
 * @param arr - Source array
 * @param size - Maximum sub-array length
 * @returns Array of batches in original order
 */
function splitIntoBatches<T>(arr: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    batches.push(arr.slice(i, i + size));
  }
  return batches;
}

/**
 * Rough token count estimate (1 token ≈ 4 chars).
 * @param text - Input string
 * @returns Non-negative estimated token count
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Checks that a parsed HuggingFace response body is actually an array of
 * number arrays, not just asserted to be one. HuggingFace can return a 200
 * with a non-array body (e.g. `{"error": "model loading"}`) during cold
 * starts even with `wait_for_model: true` under load — without this check,
 * the blind `as number[][]` cast lets that shape reach `.entries()` /
 * `validateEmbedding()` downstream, producing an uncaught TypeError instead
 * of the typed EmbeddingError the rest of the pipeline expects.
 * @param body - Parsed JSON response body of unknown shape
 * @returns True if `body` is an array of arrays of numbers
 */
function isEmbeddingArrayShape(body: unknown): body is number[][] {
  return (
    Array.isArray(body) &&
    body.every((row) => Array.isArray(row) && row.every((v) => typeof v === 'number'))
  );
}

/**
 * Makes a single HTTP call to the HuggingFace feature-extraction endpoint.
 * @param texts - Batch of texts (must be ≤ MAX_BATCH_SIZE)
 * @returns Raw embedding vectors from the API
 * @throws {EmbeddingError} On non-200 response, 429, malformed response shape, or network timeout
 */
async function callHuggingFaceApi(texts: string[]): Promise<number[][]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(HF_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.HUGGINGFACE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inputs: texts, options: { wait_for_model: true } }),
      signal: controller.signal,
    });

    if (response.status === 429) {
      throw new EmbeddingError(
        'HuggingFace rate limit exceeded (429)',
        EmbeddingErrorCode.RATE_LIMITED,
        429,
      );
    }

    if (!response.ok) {
      const body = await response.text();
      throw new EmbeddingError(
        `HuggingFace API error ${response.status}: ${body.slice(0, 200)}`,
        EmbeddingErrorCode.API_UNAVAILABLE,
        502,
      );
    }

    const body: unknown = await response.json();
    if (!isEmbeddingArrayShape(body)) {
      throw new EmbeddingError(
        'HuggingFace returned a malformed response (not an array of embedding vectors) — ' +
          'likely a cold-start or overload response body despite a 200 status',
        EmbeddingErrorCode.API_UNAVAILABLE,
        502,
      );
    }
    return body;
  } catch (err) {
    if (err instanceof EmbeddingError) throw err;
    throw new EmbeddingError(
      `HuggingFace request failed: ${err instanceof Error ? err.message : String(err)}`,
      EmbeddingErrorCode.API_UNAVAILABLE,
      503,
      err instanceof Error ? err : undefined,
    );
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Checks whether an embedding vector has the correct dimension and finite values.
 * @param embedding - Vector to validate
 * @returns True if the vector has exactly EMBEDDING_DIMENSION finite numbers
 */
export function validateEmbedding(embedding: number[]): boolean {
  return (
    Array.isArray(embedding) &&
    embedding.length === EMBEDDING_DIMENSION &&
    embedding.every((v) => typeof v === 'number' && Number.isFinite(v))
  );
}

/**
 * Generates a single embedding vector for one text string.
 * @param text - Input text (model truncates at 512 tokens internally)
 * @returns EmbeddingResult with 384-dim vector and metadata
 * @throws {EmbeddingError} If the text is empty, the API fails, or the dimension is wrong
 */
export async function embedText(text: string): Promise<EmbeddingResult> {
  if (text.trim().length === 0) {
    throw new EmbeddingError('Input text is empty', EmbeddingErrorCode.EMPTY_INPUT, 400);
  }

  const results = await embedBatch([text]);
  const first = results[0];
  if (first === undefined) {
    throw new EmbeddingError(
      'Embedder returned empty result',
      EmbeddingErrorCode.INVALID_DIMENSION,
      500,
    );
  }
  return first;
}

/**
 * Generates embedding vectors for an array of texts.
 * Automatically splits into batches of `batchSize` (default MAX_BATCH_SIZE = 32),
 * validates each embedding dimension, and logs latency per batch.
 * @param texts - Array of input texts
 * @param batchSize - Maximum texts per API call (default 32)
 * @param signal - Optional cancellation signal. Checked between batches (not
 *   mid-request — the in-flight HTTP call already has its own request timeout)
 *   so a superseded job attempt stops issuing further HuggingFace calls instead
 *   of burning through the rest of a large document's batches for a result
 *   that will be discarded. Throwing (rather than returning a partial array)
 *   means callers never have to remember to check the result length against
 *   the input length — an aborted batch always surfaces as a `JobCancelledError`.
 * @returns Array of EmbeddingResults in the same order as the input
 * @throws {EmbeddingError} On API failure, invalid dimension, or empty input after filtering
 * @throws {JobCancelledError} If `signal` is aborted before a batch starts
 */
export async function embedBatch(
  texts: string[],
  batchSize: number = MAX_BATCH_SIZE,
  signal?: AbortSignal,
): Promise<EmbeddingResult[]> {
  if (texts.length === 0) return [];

  const batches = splitIntoBatches(texts, batchSize);
  const results: EmbeddingResult[] = [];

  for (const [batchIdx, batch] of batches.entries()) {
    if (signal?.aborted) {
      const reason = String(signal.reason as unknown);
      logger.warn('Skipping embedding batch — job attempt was cancelled', {
        batchIdx,
        completedBatches: batchIdx,
        totalBatches: batches.length,
        reason,
      });
      throw new JobCancelledError(
        `Attempt cancelled before embedding batch ${batchIdx}/${batches.length} (reason: ${reason})`,
      );
    }

    // Proactive pause between batches so HF free-tier doesn't 429 mid-document
    if (batchIdx > 0) await sleep(INTER_BATCH_DELAY_MS);

    // Single attempt per batch — BullMQ's job-level retry (3 attempts,
    // exponential backoff; documentQueue.ts) is the sole retry layer for
    // transient HF failures. A per-batch retry loop here would compound with
    // it (3 job retries × 3 batch retries × N batches), each burning up to
    // REQUEST_TIMEOUT_MS while the single-concurrency worker sits blocked.
    const t0 = Date.now();
    const rawEmbeddings = await callHuggingFaceApi(batch);
    const latencyMs = Date.now() - t0;

    logger.debug('Batch embedded', { batchIdx, batchSize: batch.length, latencyMs });

    for (const [i, embedding] of rawEmbeddings.entries()) {
      if (!validateEmbedding(embedding)) {
        throw new EmbeddingError(
          `Invalid embedding dimension at batch ${batchIdx} index ${i}: expected ${EMBEDDING_DIMENSION}, got ${embedding.length}`,
          EmbeddingErrorCode.INVALID_DIMENSION,
          500,
        );
      }

      results.push({
        embedding,
        tokenCount: estimateTokens(batch[i] ?? ''),
        model: EMBEDDING_MODEL,
      });
    }
  }

  return results;
}
