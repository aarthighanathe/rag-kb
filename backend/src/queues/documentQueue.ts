/**
 * @file documentQueue.ts
 * @description BullMQ queue definition for asynchronous document processing jobs
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { Queue, type Job } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { QueueError, QueueErrorCode } from '../utils/errors.js';
import { cancelJob as cancelInFlightAttempt } from './cancellation.js';
import type { DocumentJobData, DocumentJobResult, JobStatus } from '../types/index.js';

export const DOCUMENT_QUEUE_NAME = 'document-processing';

const connection = { url: env.REDIS_URL };

let _queue: Queue<DocumentJobData, DocumentJobResult> | null = null;

/**
 * Returns the singleton BullMQ Queue instance, creating it on first call.
 * @returns Configured document-processing Queue
 */
export function getQueue(): Queue<DocumentJobData, DocumentJobResult> {
  if (!_queue) {
    _queue = new Queue<DocumentJobData, DocumentJobResult>(DOCUMENT_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    });

    _queue.on('error', (err) => {
      logger.error('Document queue connection error', { error: err.message, stack: err.stack });
    });
  }
  return _queue;
}

/**
 * Adds a document processing job to the queue.
 * Uses the documentId as a stable jobId so duplicate uploads are idempotent.
 * @param data - Job payload with document metadata and file location
 * @returns The BullMQ job ID (same as documentId)
 * @throws {QueueError} If Redis is unavailable or the add operation fails
 */
export async function addDocumentJob(data: DocumentJobData): Promise<string> {
  try {
    const job = await getQueue().add('process-document', data, {
      jobId: data.documentId,
    });

    if (!job.id) {
      throw new QueueError(
        'Job was added but BullMQ returned no ID',
        QueueErrorCode.ENQUEUE_FAILED,
      );
    }

    logger.info('Document job enqueued', {
      jobId: job.id,
      documentId: data.documentId,
      fileType: data.fileType,
      correlationId: data.correlationId,
    });

    return job.id;
  } catch (err) {
    if (err instanceof QueueError) throw err;
    throw new QueueError(
      `Failed to enqueue document job: ${err instanceof Error ? err.message : String(err)}`,
      QueueErrorCode.ENQUEUE_FAILED,
      500,
      err instanceof Error ? err : undefined,
    );
  }
}

/**
 * Cancels a document's processing job, covering every stage it could be in:
 *  - waiting/delayed (not yet picked up by the worker): removed from the queue outright
 *  - active (currently being processed): the worker's in-flight attempt is aborted via
 *    its AbortSignal, which stops it at its next checkpoint before any further write
 *  - already completed/failed/nonexistent: no-op
 * Called from DELETE /api/documents/:id so a mid-pipeline delete doesn't keep burning
 * HuggingFace embedding calls or attempt to write chunks for a document row that's gone.
 * @param documentId - Document UUID, equal to the BullMQ job ID
 */
export async function cancelDocumentJob(documentId: string): Promise<void> {
  const cancelledInFlight = cancelInFlightAttempt(documentId);
  if (cancelledInFlight) return;

  const job = await getQueue().getJob(documentId);
  if (!job) return;

  const state = await job.getState();
  if (state === 'waiting' || state === 'delayed' || state === 'prioritized') {
    try {
      await job.remove();
      logger.info('Removed queued document job on delete', { documentId, state });
    } catch (err) {
      logger.warn('Failed to remove queued document job on delete', {
        documentId,
        state,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (state === 'active') {
    // The job is active in Redis but cancelInFlightAttempt found no registered
    // AbortController — a narrow startup race where the worker has claimed the
    // job but hasn't reached beginAttempt() yet. Retry the in-process abort
    // briefly instead of silently no-op'ing, which would otherwise let the
    // worker fully process (and write chunks for) a document about to be deleted.
    const retryDelaysMs = [50, 150, 300];
    for (const delayMs of retryDelaysMs) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (cancelInFlightAttempt(documentId)) {
        logger.info('Cancelled active document job after registration race retry', {
          documentId,
          delayMs,
        });
        return;
      }
    }
    logger.warn('Active document job could not be aborted — no attempt controller registered', {
      documentId,
    });
  }
}

/**
 * Retrieves the current status and progress of a job by its ID.
 * Returns state 'unknown' when no job exists for the given ID.
 * @param jobId - BullMQ job ID (equals documentId for document jobs)
 * @returns JobStatus snapshot
 */
export async function getJobStatus(jobId: string): Promise<JobStatus> {
  const job: Job<DocumentJobData, DocumentJobResult> | undefined = await getQueue().getJob(jobId);

  if (!job) {
    return { jobId, state: 'unknown', progress: 0, timestamp: Date.now() };
  }

  const state = await job.getState();
  const rawProgress = job.progress;
  const progress = typeof rawProgress === 'number' ? rawProgress : 0;

  return {
    jobId,
    state: state as JobStatus['state'],
    progress,
    // Only include optional fields when they have actual values (exactOptionalPropertyTypes)
    ...(job.returnvalue !== undefined && { result: job.returnvalue }),
    ...(job.failedReason !== undefined && { failedReason: job.failedReason }),
    timestamp: job.timestamp,
    ...(job.finishedOn !== undefined && { finishedOn: job.finishedOn }),
  };
}
