/**
 * @file maintenanceQueue.ts
 * @description BullMQ repeatable jobs for scheduled backups and data-retention cleanup.
 *   Both underlying functions (backupService.ts's runScheduledBackups, dataRetention.ts's
 *   runAllCleanupTasks) were previously fully implemented but never invoked by anything —
 *   this module is what actually wires them into a running schedule, rather than leaving
 *   the documented backup cadence and retention policy silently unenforced. Deliberately a
 *   separate queue/worker from documentQueue.ts's document-processing pipeline: these jobs
 *   are unrelated in purpose, failure mode, and concurrency needs, and mixing them onto one
 *   queue would let a stuck maintenance job's retry/backoff interfere with real user uploads.
 * @author [Author Placeholder]
 * @created 2026-08-31
 */

import { Queue, Worker, type Job } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { runScheduledBackups } from '../services/backupService.js';
import { runAllCleanupTasks } from '../services/dataRetention.js';

export const MAINTENANCE_QUEUE_NAME = 'maintenance';

const RUN_BACKUPS_JOB = 'run-backups';
const RUN_RETENTION_CLEANUP_JOB = 'run-retention-cleanup';

const connection = { url: env.REDIS_URL };

let _queue: Queue | null = null;

/**
 * Returns the singleton BullMQ Queue instance for maintenance jobs, creating
 * it (and registering its repeatable jobs) on first call.
 * @returns Configured maintenance Queue
 */
function getMaintenanceQueue(): Queue {
  if (!_queue) {
    _queue = new Queue(MAINTENANCE_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 20 },
      },
    });

    _queue.on('error', (err) => {
      logger.error('Maintenance queue connection error', { error: err.message, stack: err.stack });
    });
  }
  return _queue;
}

/**
 * Returns the singleton maintenance Queue so index.ts's graceful-shutdown
 * path can close it alongside documentQueue.ts's queue, mirroring that
 * module's own getQueue() export.
 * @returns The maintenance Queue instance
 */
export function getMaintenanceQueueForShutdown(): Queue {
  return getMaintenanceQueue();
}

/**
 * Registers both repeatable jobs (idempotent — BullMQ dedupes a repeatable
 * job by its jobId + repeat pattern, so calling this again on every restart
 * does not create duplicate schedules). Call once at startup.
 *
 * - run-backups hourly: runScheduledBackups() itself decides what to actually
 *   do based on the current hour (full at 2 AM, incremental every 6 hours),
 *   so it needs to be invoked hourly for that internal gating to have any effect.
 * - run-retention-cleanup daily at 03:00: query_logs/audit_logs retention and
 *   orphaned-storage reconciliation don't need finer granularity than daily.
 */
export async function scheduleMaintenanceJobs(): Promise<void> {
  const queue = getMaintenanceQueue();

  await queue.upsertJobScheduler(
    RUN_BACKUPS_JOB,
    { pattern: '0 * * * *' },
    {
      name: RUN_BACKUPS_JOB,
    },
  );
  await queue.upsertJobScheduler(
    RUN_RETENTION_CLEANUP_JOB,
    { pattern: '0 3 * * *' },
    { name: RUN_RETENTION_CLEANUP_JOB },
  );

  logger.info('Maintenance jobs scheduled', {
    backups: 'hourly (self-gates on hour internally)',
    retentionCleanup: 'daily at 03:00',
  });
}

/**
 * Processes one maintenance job by name — dispatches to the backup or
 * retention-cleanup task depending on which repeatable schedule triggered it.
 * @param job - The BullMQ job to process
 * @throws Propagates any error from the underlying task so BullMQ's
 *   attempts/backoff (see getMaintenanceQueue's defaultJobOptions) retries it —
 *   both runScheduledBackups and runAllCleanupTasks already catch and log
 *   their own per-task errors internally and return partial results rather
 *   than throwing, so a thrown error here means something more fundamental
 *   (e.g. Redis/Supabase totally unreachable) went wrong.
 */
async function processMaintenanceJob(job: Job): Promise<unknown> {
  switch (job.name) {
    case RUN_BACKUPS_JOB:
      return runScheduledBackups();
    case RUN_RETENTION_CLEANUP_JOB:
      return runAllCleanupTasks();
    default:
      logger.warn('Unknown maintenance job name — skipping', { jobName: job.name });
      return null;
  }
}

/**
 * BullMQ worker — starts consuming jobs from the maintenance queue on module
 * load. concurrency: 1 since these are low-frequency, non-latency-sensitive
 * jobs with no reason to run concurrently with each other.
 */
export const maintenanceWorker = new Worker(MAINTENANCE_QUEUE_NAME, processMaintenanceJob, {
  connection,
  concurrency: 1,
});

maintenanceWorker.on('completed', (job) => {
  logger.info('Maintenance job completed', { jobName: job.name, result: job.returnvalue });
});

maintenanceWorker.on('failed', (job, err) => {
  logger.error('Maintenance job failed', {
    jobName: job?.name,
    error: err.message,
    stack: err.stack,
  });
});

maintenanceWorker.on('error', (err) => {
  logger.error('Maintenance worker connection error', { error: err.message, stack: err.stack });
});
