/**
 * @file documentWorker.ts
 * @description BullMQ worker that processes document jobs: extract → chunk → embed → store
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { Worker, UnrecoverableError, type Job } from 'bullmq';
import fs from 'fs/promises';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { extractText, createChunks } from '../../services/chunker.js';
import { embedBatch } from '../../services/embedder.js';
import {
  updateDocumentStatus,
  upsertChunks,
  updateChunkCount,
} from '../../services/vectorStore.js';
import { DOCUMENT_QUEUE_NAME } from '../documentQueue.js';
import { beginAttempt, endAttempt, JobCancelledError } from '../cancellation.js';
import type { DocumentJobData, DocumentJobResult } from '../../types/index.js';

/** Concurrency=1 so the single HuggingFace free-tier connection is never saturated. */
const WORKER_CONCURRENCY = 1;

/** Hard timeout — kills the job promise if processing stalls beyond 5 minutes. */
const JOB_TIMEOUT_MS = 5 * 60 * 1_000;

/**
 * Wraps a promise with a hard timeout that rejects after the given duration.
 * The original promise is NOT cancelled when the timeout wins — Node has no
 * way to abort arbitrary in-flight work — but `controller.abort()` is called
 * so the still-running callee observes its signal is aborted at its next
 * checkpoint (before any further network call or DB write) and exits cleanly
 * instead of continuing to completion.
 * @param promise - The async operation to race against the clock
 * @param timeoutMs - Maximum allowed duration in milliseconds
 * @param label - Label included in the timeout error message
 * @param controller - Aborted when the timeout fires first
 * @returns Resolves with the promise result or rejects with a timeout error
 */
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  controller: AbortController,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort('timeout');
      reject(new Error(`${label} timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Deletes the temporary uploaded file from disk.
 * Swallows errors so cleanup failures never mask the primary job outcome.
 * @param filePath - Absolute path to the temp file
 * @param correlationId - Request correlation ID for log tracing
 */
async function cleanupFile(filePath: string, correlationId: string): Promise<void> {
  try {
    await fs.unlink(filePath);
    logger.debug('Temp file deleted', { filePath, correlationId });
  } catch {
    logger.warn('Failed to delete temp file — manual cleanup may be needed', {
      filePath,
      correlationId,
    });
  }
}

/**
 * Core processing pipeline for one document job.
 * Progress checkpoints: 0% → 20% → 40% → 70% → 90% → 100%
 *
 * Cancellation model: `signal` belongs to this specific attempt (see
 * `beginAttempt` in cancellation.ts). It is aborted either by this attempt's
 * own timeout (`withTimeout`, below) or — the moment a retry of the same job
 * ID starts — by that new attempt calling `beginAttempt` again, which aborts
 * the stale controller registered for that job ID. Every write-performing
 * pipeline call (`embedBatch`'s network calls, `upsertChunks`,
 * `updateChunkCount`, `updateDocumentStatus`) is passed the signal and checks
 * it immediately before doing any work, so an abandoned attempt stops at its
 * next checkpoint instead of writing stale data over a concurrent retry's
 * output. The `(document_id, chunk_index)` unique constraint remains the
 * DB-level idempotency guarantee; this is defense in depth on top of it, not
 * a replacement for it.
 * @param job - BullMQ job carrying DocumentJobData
 * @param signal - This attempt's cancellation signal
 * @returns Chunk count and wall-clock processing time on success
 * @throws Re-throws any error after updating document status to 'failed'
 *   (except `JobCancelledError`, which is an expected clean exit and is
 *   swallowed rather than propagated as a job failure)
 */
async function processDocumentJob(
  job: Job<DocumentJobData, DocumentJobResult>,
  signal: AbortSignal,
): Promise<DocumentJobResult> {
  const { documentId, filePath, fileType, originalName, correlationId, userId } = job.data;
  const jobLogger = logger.child({ jobId: job.id, documentId, correlationId, userId });
  const startTime = Date.now();

  try {
    // 0% — mark processing so the UI can show a spinner immediately. Inside
    // the try block so a signal already aborted at this exact instant (e.g.
    // a cancellation racing job start) exits cleanly via the JobCancelledError
    // branch below instead of propagating uncaught to BullMQ's 'failed' event.
    await updateDocumentStatus(documentId, 'processing', undefined, signal);
    jobLogger.info('Document job started', { originalName, fileType });

    // ── Step 1: Extract text (20%) ─────────────────────────────────────────
    const fileBuffer = await fs.readFile(filePath);
    const rawText = await extractText(fileBuffer, fileType);
    await job.updateProgress(20);
    jobLogger.debug('Text extracted', { charCount: rawText.length });

    // ── Step 2: Chunk (40%) ────────────────────────────────────────────────
    const chunks = createChunks(rawText);
    if (chunks.length === 0) {
      // Deterministic failure — re-processing the same empty/unparseable file
      // will fail identically every time, so BullMQ must not retry it.
      // UnrecoverableError signals BullMQ to skip remaining attempts.
      throw new UnrecoverableError('Document produced zero chunks — file may be empty or unreadable');
    }
    await job.updateProgress(40);
    jobLogger.debug('Text chunked', { chunkCount: chunks.length });

    // ── Step 3: Embed in batches (70%) ────────────────────────────────────
    const embeddingResults = await embedBatch(
      chunks.map((c) => c.content),
      undefined,
      signal,
    );
    const embeddings = embeddingResults.map((r) => r.embedding);
    await job.updateProgress(70);
    jobLogger.debug('Embeddings generated', { count: embeddings.length });

    // ── Step 4: Store chunks in Supabase (90%) ────────────────────────────
    await upsertChunks(documentId, chunks, embeddings, signal);
    await updateChunkCount(documentId, chunks.length, signal);
    await job.updateProgress(90);
    jobLogger.debug('Chunks stored in vector store');

    // ── Step 5: Mark ready, clean up (100%) ──────────────────────────────
    await updateDocumentStatus(documentId, 'ready', undefined, signal);
    await cleanupFile(filePath, correlationId);
    await job.updateProgress(100);

    const processingTimeMs = Date.now() - startTime;
    jobLogger.info('Document job completed', { chunkCount: chunks.length, processingTimeMs });

    return { chunkCount: chunks.length, processingTimeMs };
  } catch (err) {
    if (err instanceof JobCancelledError) {
      // Expected clean exit — this attempt was superseded (its own timeout
      // fired, or a retry claimed the job first). Not a job failure: no
      // 'failed' status write, no re-throw for BullMQ to retry against.
      jobLogger.warn('Document job attempt cancelled — exiting without further writes', {
        reason: err.message,
      });
      await cleanupFile(filePath, correlationId);
      const processingTimeMs = Date.now() - startTime;
      return { chunkCount: 0, processingTimeMs };
    }

    const message = err instanceof Error ? err.message : 'Unknown processing error';
    jobLogger.error('Document job failed', { error: message, attempt: job.attemptsMade });
    try {
      await updateDocumentStatus(documentId, 'failed', message, signal);
    } catch (statusErr) {
      if (statusErr instanceof JobCancelledError) {
        jobLogger.warn('Skipped writing failed status — attempt was cancelled', {
          reason: statusErr.message,
        });
      } else {
        jobLogger.error('Failed to update document status to failed', {
          error: statusErr instanceof Error ? statusErr.message : String(statusErr),
        });
      }
    }
    await cleanupFile(filePath, correlationId);
    throw err;
  }
}

/**
 * Wraps processDocumentJob with a hard 5-minute timeout and per-attempt
 * cancellation. `beginAttempt` registers this attempt's controller under the
 * job's stable ID, aborting whatever controller was previously registered for
 * that ID — so if BullMQ starts a retry while a prior attempt is still
 * winding down past its own timeout, the prior attempt is aborted the instant
 * the retry begins, not just when its own timer eventually fires.
 * BullMQ will still apply its own retry logic on the re-thrown error.
 */
async function timedDocumentJob(
  job: Job<DocumentJobData, DocumentJobResult>,
): Promise<DocumentJobResult> {
  const jobId = job.id ?? `unknown-${job.data.documentId}`;
  const controller = beginAttempt(jobId);
  try {
    return await withTimeout(
      processDocumentJob(job, controller.signal),
      JOB_TIMEOUT_MS,
      `Job ${jobId}`,
      controller,
    );
  } finally {
    endAttempt(jobId, controller);
  }
}

/**
 * BullMQ worker — starts consuming jobs from the document-processing queue on module load.
 * concurrency: 1 prevents concurrent HuggingFace embedding calls from exhausting the free tier.
 * lockDuration: 330 000 ms gives the 5-minute job timeout a 30-second grace window before BullMQ
 * considers the job stale and hands it to another worker.
 */
export const documentWorker = new Worker<DocumentJobData, DocumentJobResult>(
  DOCUMENT_QUEUE_NAME,
  timedDocumentJob,
  {
    connection: { url: env.REDIS_URL },
    concurrency: WORKER_CONCURRENCY,
    lockDuration: JOB_TIMEOUT_MS + 30_000,
  },
);

documentWorker.on('completed', (job) => {
  logger.info('Worker: job completed', {
    jobId: job.id,
    documentId: job.data.documentId,
    correlationId: job.data.correlationId,
  });
});

documentWorker.on('failed', (job, err) => {
  logger.error('Worker: job failed', {
    jobId: job?.id,
    documentId: job?.data.documentId,
    correlationId: job?.data.correlationId,
    attempt: job?.attemptsMade,
    error: err.message,
  });

  // BullMQ fires 'failed' on every attempt, not just the last one — a mid-retry
  // failure re-queues silently and processDocumentJob's own catch block already
  // wrote 'failed' for that case (unless the attempt was cancelled/superseded,
  // in which case a retry is about to run and must NOT be marked failed here
  // either). Only once attemptsMade has reached the configured attempts ceiling
  // is this truly terminal — write 'failed' here as a backstop for the one gap
  // processDocumentJob can't cover: a JobCancelledError on the FINAL attempt
  // (e.g. its own timeout fired with no retry left to supersede it), which
  // deliberately skips writing status so a live retry isn't clobbered — except
  // there is no live retry when attempts are exhausted, so the document would
  // otherwise stay 'processing' forever.
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    const message = err.message || 'Document processing failed after all retry attempts';
    void updateDocumentStatus(job.data.documentId, 'failed', message).catch((statusErr: unknown) => {
      logger.error('Failed to write terminal failed status after exhausted retries', {
        jobId: job.id,
        documentId: job.data.documentId,
        error: statusErr instanceof Error ? statusErr.message : String(statusErr),
      });
    });
  }
});

documentWorker.on('error', (err) => {
  logger.error('Worker connection error', { error: err.message, stack: err.stack });
});

// Graceful shutdown — let the current job finish before the process exits.
// index.ts also calls documentWorker.close() in its shutdown handler;
// this once-handler acts as a safety net when the worker runs standalone.
process.once('SIGTERM', () => {
  void documentWorker.close().then(() => {
    logger.info('Document worker closed on SIGTERM');
  });
});
