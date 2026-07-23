/**
 * @file cancellation.ts
 * @description Per-job-attempt cancellation primitives for the document processing
 *              pipeline — a real AbortSignal threaded through every pipeline stage,
 *              plus a registry that aborts a stale attempt as soon as a retry claims
 *              the same job ID.
 * @author [Author Placeholder]
 * @created 2026-07-18
 */

import { logger } from '../utils/logger.js';

/**
 * Thrown by `throwIfAborted` when a pipeline stage checkpoint finds its attempt's
 * signal already aborted. Deliberately NOT an `AppError` subclass — cancellation
 * is an expected, clean exit condition (a superseded attempt stepping aside for
 * a retry), not an application failure, and must never be reported, logged, or
 * routed as one.
 */
export class JobCancelledError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'JobCancelledError';
  }
}

/**
 * Registry of the live AbortController for each in-flight job ID. Lets a newly
 * started attempt abort its predecessor's signal the moment it claims the same
 * job (BullMQ starting a retry, or — defensively — two attempts overlapping),
 * so the predecessor's next write checkpoint stops it before it touches the DB.
 */
const activeAttempts = new Map<string, AbortController>();

/**
 * Starts a new cancellable attempt for the given job ID. If a controller is
 * already registered for this job ID (a previous attempt that outlived its
 * timeout and hasn't settled yet), that controller is aborted first — the new
 * attempt always wins, the old one is signalled to stop at its next checkpoint.
 * @param jobId - BullMQ job ID (stable across retries of the same job)
 * @returns AbortController owned by this attempt; caller must call
 *   `endAttempt(jobId, controller)` when the attempt settles (success or failure)
 */
export function beginAttempt(jobId: string): AbortController {
  const stale = activeAttempts.get(jobId);
  if (stale && !stale.signal.aborted) {
    logger.warn('New attempt claimed job — aborting previous in-flight attempt', { jobId });
    stale.abort('superseded-by-retry');
  }

  const controller = new AbortController();
  activeAttempts.set(jobId, controller);
  return controller;
}

/**
 * Clears the registry entry for a job ID once an attempt settles, but only if
 * the caller's own controller is still the one registered — prevents a stale
 * attempt's cleanup from clobbering a newer attempt's live entry.
 * @param jobId - BullMQ job ID
 * @param controller - The controller this attempt owned (from `beginAttempt`)
 */
export function endAttempt(jobId: string, controller: AbortController): void {
  if (activeAttempts.get(jobId) === controller) {
    activeAttempts.delete(jobId);
  }
}

/**
 * Aborts the in-flight attempt for a job ID, if one is currently running.
 * Used when a document is deleted mid-processing (DELETE /api/documents/:id)
 * so the worker stops burning HuggingFace embedding calls and never reaches
 * `upsertChunks`/`updateChunkCount`/`updateDocumentStatus` for a document row
 * that no longer exists — those calls check `signal` immediately before
 * writing (see `throwIfAborted`) and exit via `JobCancelledError` instead.
 * No-op if no attempt is currently registered for this job ID (nothing
 * in-flight, or it already finished).
 * @param jobId - BullMQ job ID (equals documentId for document jobs)
 * @returns true if an in-flight attempt was found and aborted, false otherwise
 */
export function cancelJob(jobId: string): boolean {
  const controller = activeAttempts.get(jobId);
  if (!controller || controller.signal.aborted) return false;

  logger.info('Cancelling in-flight job attempt — document deleted', { jobId });
  controller.abort('document-deleted');
  return true;
}

/**
 * Checkpoint helper — call immediately before every pipeline database write.
 * Throws `JobCancelledError` (skipping the write) if this attempt's signal has
 * already been aborted, either by its own timeout or by a newer attempt
 * claiming the same job ID.
 * @param signal - This attempt's AbortSignal
 * @param stage - Human-readable stage name, included in the log line and error
 *   message so an aborted write is observable, not silent
 * @param context - Structured fields (jobId, documentId, etc.) for the log line
 * @throws {JobCancelledError} If `signal.aborted` is true
 */
export function throwIfAborted(
  signal: AbortSignal,
  stage: string,
  context: Record<string, unknown>,
): void {
  if (!signal.aborted) return;

  const reason = String(signal.reason as unknown);
  logger.warn('Skipping write — job attempt was cancelled', {
    ...context,
    stage,
    reason,
  });
  throw new JobCancelledError(`Attempt cancelled before ${stage} (reason: ${reason})`);
}
