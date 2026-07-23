/**
 * @file documentQueue.test.ts
 * @description Unit tests for the document-processing BullMQ queue module
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── BullMQ mock ───────────────────────────────────────────────────────────────

const { mockJobAdd, mockJobGetJob, mockQueueOn, mockQueueClose, mockGetState, mockJobRemove, mockCancelInFlightAttempt } =
  vi.hoisted(() => ({
    mockJobAdd: vi.fn(),
    mockJobGetJob: vi.fn(),
    mockQueueOn: vi.fn(),
    mockQueueClose: vi.fn(),
    mockGetState: vi.fn(),
    mockJobRemove: vi.fn(),
    mockCancelInFlightAttempt: vi.fn(),
  }));

vi.mock('bullmq', () => {
  class MockQueue {
    public name: string;
    public opts: Record<string, unknown>;
    constructor(name: string, opts: Record<string, unknown>) {
      this.name = name;
      this.opts = opts;
    }
    add = mockJobAdd;
    getJob = mockJobGetJob;
    on = mockQueueOn;
    close = mockQueueClose;
    getWaitingCount = vi.fn().mockResolvedValue(2);
    getActiveCount = vi.fn().mockResolvedValue(1);
    getCompletedCount = vi.fn().mockResolvedValue(10);
    getFailedCount = vi.fn().mockResolvedValue(0);
  }

  return { Queue: MockQueue };
});

vi.mock('@queues/cancellation', () => ({
  cancelJob: mockCancelInFlightAttempt,
}));

// ── Module under test (imported after mock is set up) ────────────────────────

import {
  addDocumentJob,
  getJobStatus,
  getQueue,
  cancelDocumentJob,
  DOCUMENT_QUEUE_NAME,
} from '@queues/documentQueue';
import type { DocumentJobData } from '@types/index';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeJobData(overrides: Partial<DocumentJobData> = {}): DocumentJobData {
  return {
    documentId: 'doc-uuid-123',
    storageKey: 'doc-uuid-123_report.pdf',
    fileType: 'pdf',
    originalName: 'report.pdf',
    correlationId: 'corr-abc-456',
    userId: 'test-user-1',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('documentQueue — queue configuration', () => {
  it('creates a queue with the correct name', () => {
    expect(DOCUMENT_QUEUE_NAME).toBe('document-processing');
    const queue = getQueue();
    expect(queue.name).toBe('document-processing');
  });

  it('configures 3 retry attempts', () => {
    const queue = getQueue() as unknown as { opts: { defaultJobOptions: { attempts: number } } };
    expect(queue.opts.defaultJobOptions.attempts).toBe(3);
  });

  it('configures exponential backoff with 1000 ms delay', () => {
    const queue = getQueue() as unknown as {
      opts: { defaultJobOptions: { backoff: { type: string; delay: number } } };
    };
    expect(queue.opts.defaultJobOptions.backoff.type).toBe('exponential');
    expect(queue.opts.defaultJobOptions.backoff.delay).toBe(1000);
  });

  it('keeps at most 100 completed jobs', () => {
    const queue = getQueue() as unknown as {
      opts: { defaultJobOptions: { removeOnComplete: { count: number } } };
    };
    expect(queue.opts.defaultJobOptions.removeOnComplete.count).toBe(100);
  });

  it('keeps at most 50 failed jobs', () => {
    const queue = getQueue() as unknown as {
      opts: { defaultJobOptions: { removeOnFail: { count: number } } };
    };
    expect(queue.opts.defaultJobOptions.removeOnFail.count).toBe(50);
  });
});

describe('addDocumentJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls queue.add with the job name and full data payload', async () => {
    mockJobAdd.mockResolvedValueOnce({ id: 'doc-uuid-123' });
    const data = makeJobData();

    await addDocumentJob(data);

    expect(mockJobAdd).toHaveBeenCalledOnce();
    const [jobName, jobData] = mockJobAdd.mock.calls[0] as [string, DocumentJobData];
    expect(jobName).toBe('process-document');
    expect(jobData.documentId).toBe('doc-uuid-123');
    expect(jobData.fileType).toBe('pdf');
    expect(jobData.originalName).toBe('report.pdf');
    expect(jobData.correlationId).toBe('corr-abc-456');
  });

  it('uses documentId as the stable jobId to prevent duplicate processing', async () => {
    mockJobAdd.mockResolvedValueOnce({ id: 'doc-uuid-123' });
    const data = makeJobData();

    await addDocumentJob(data);

    const [, , opts] = mockJobAdd.mock.calls[0] as [string, DocumentJobData, { jobId: string }];
    expect(opts.jobId).toBe('doc-uuid-123');
  });

  it('returns the job ID string', async () => {
    mockJobAdd.mockResolvedValueOnce({ id: 'doc-uuid-123' });
    const result = await addDocumentJob(makeJobData());
    expect(result).toBe('doc-uuid-123');
  });

  it('throws QueueError when queue.add returns no ID', async () => {
    mockJobAdd.mockResolvedValueOnce({ id: undefined });

    await expect(addDocumentJob(makeJobData())).rejects.toThrow('returned no ID');
  });

  it('throws QueueError wrapping a Redis connection error', async () => {
    mockJobAdd.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(addDocumentJob(makeJobData())).rejects.toThrow('Failed to enqueue document job');
  });
});

describe('getJobStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns state unknown when no job exists for the given ID', async () => {
    mockJobGetJob.mockResolvedValueOnce(undefined);

    const status = await getJobStatus('nonexistent-id');

    expect(status.jobId).toBe('nonexistent-id');
    expect(status.state).toBe('unknown');
    expect(status.progress).toBe(0);
    expect(typeof status.timestamp).toBe('number');
  });

  it('returns correct shape for a completed job', async () => {
    const returnvalue = { chunkCount: 12, processingTimeMs: 4200 };
    mockGetState.mockResolvedValueOnce('completed');
    mockJobGetJob.mockResolvedValueOnce({
      getState: mockGetState,
      progress: 100,
      returnvalue,
      failedReason: undefined,
      timestamp: 1718000000000,
      finishedOn: 1718000004200,
    });

    const status = await getJobStatus('doc-uuid-123');

    expect(status.state).toBe('completed');
    expect(status.progress).toBe(100);
    expect(status.result).toEqual(returnvalue);
    expect(status.finishedOn).toBe(1718000004200);
    expect(status.failedReason).toBeUndefined();
  });

  it('returns failedReason for a failed job', async () => {
    mockGetState.mockResolvedValueOnce('failed');
    mockJobGetJob.mockResolvedValueOnce({
      getState: mockGetState,
      progress: 20,
      returnvalue: undefined,
      failedReason: 'PDF parsing failed: corrupt header',
      timestamp: 1718000000000,
      finishedOn: 1718000001000,
    });

    const status = await getJobStatus('doc-uuid-123');

    expect(status.state).toBe('failed');
    expect(status.failedReason).toBe('PDF parsing failed: corrupt header');
    expect(status.result).toBeUndefined();
  });

  it('normalises non-numeric progress to 0', async () => {
    mockGetState.mockResolvedValueOnce('active');
    mockJobGetJob.mockResolvedValueOnce({
      getState: mockGetState,
      progress: { step: 'embedding' }, // object-form progress BullMQ allows
      returnvalue: null,
      failedReason: undefined,
      timestamp: 1718000000000,
      finishedOn: undefined,
    });

    const status = await getJobStatus('doc-uuid-123');
    expect(status.progress).toBe(0);
  });
});

describe('cancelDocumentJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not touch the queue when an in-flight attempt was cancelled', async () => {
    mockCancelInFlightAttempt.mockReturnValueOnce(true);

    await cancelDocumentJob('doc-active-123');

    expect(mockCancelInFlightAttempt).toHaveBeenCalledWith('doc-active-123');
    expect(mockJobGetJob).not.toHaveBeenCalled();
  });

  it('is a no-op when no job exists for the document (already finished or never queued)', async () => {
    mockCancelInFlightAttempt.mockReturnValueOnce(false);
    mockJobGetJob.mockResolvedValueOnce(undefined);

    await expect(cancelDocumentJob('doc-gone-123')).resolves.toBeUndefined();
    expect(mockJobRemove).not.toHaveBeenCalled();
  });

  it('removes a still-waiting job from the queue', async () => {
    mockCancelInFlightAttempt.mockReturnValueOnce(false);
    mockJobGetJob.mockResolvedValueOnce({
      getState: vi.fn().mockResolvedValue('waiting'),
      remove: mockJobRemove,
    });

    await cancelDocumentJob('doc-waiting-123');

    expect(mockJobRemove).toHaveBeenCalledOnce();
  });

  it('removes a delayed job from the queue', async () => {
    mockCancelInFlightAttempt.mockReturnValueOnce(false);
    mockJobGetJob.mockResolvedValueOnce({
      getState: vi.fn().mockResolvedValue('delayed'),
      remove: mockJobRemove,
    });

    await cancelDocumentJob('doc-delayed-123');

    expect(mockJobRemove).toHaveBeenCalledOnce();
  });

  it('does not attempt to remove a completed job', async () => {
    mockCancelInFlightAttempt.mockReturnValueOnce(false);
    mockJobGetJob.mockResolvedValueOnce({
      getState: vi.fn().mockResolvedValue('completed'),
      remove: mockJobRemove,
    });

    await cancelDocumentJob('doc-completed-123');

    expect(mockJobRemove).not.toHaveBeenCalled();
  });

  it('swallows a remove() failure rather than throwing (best-effort cancellation)', async () => {
    mockCancelInFlightAttempt.mockReturnValueOnce(false);
    mockJobRemove.mockRejectedValueOnce(new Error('job already locked'));
    mockJobGetJob.mockResolvedValueOnce({
      getState: vi.fn().mockResolvedValue('waiting'),
      remove: mockJobRemove,
    });

    await expect(cancelDocumentJob('doc-lockrace-123')).resolves.toBeUndefined();
  });

  it('retries the in-flight abort for an active job with no registered controller yet, and succeeds once it appears', async () => {
    // First call (before the job starts) finds nothing registered; state is
    // 'active' in Redis (the worker claimed it) but beginAttempt() hasn't run
    // yet — a narrow startup race. The retry loop should keep polling
    // cancelInFlightAttempt until it succeeds, rather than silently no-op'ing.
    mockCancelInFlightAttempt
      .mockReturnValueOnce(false) // initial call in cancelDocumentJob
      .mockReturnValueOnce(false) // retry 1
      .mockReturnValueOnce(true); // retry 2 — controller now registered
    mockJobGetJob.mockResolvedValueOnce({
      getState: vi.fn().mockResolvedValue('active'),
      remove: mockJobRemove,
    });

    await cancelDocumentJob('doc-active-race-123');

    expect(mockCancelInFlightAttempt).toHaveBeenCalledTimes(3);
    expect(mockJobRemove).not.toHaveBeenCalled();
  }, 10000);

  it('gives up and logs a warning if an active job never registers a controller', async () => {
    mockCancelInFlightAttempt.mockReturnValue(false);
    mockJobGetJob.mockResolvedValueOnce({
      getState: vi.fn().mockResolvedValue('active'),
      remove: mockJobRemove,
    });

    await expect(cancelDocumentJob('doc-active-nevershows-123')).resolves.toBeUndefined();
    expect(mockJobRemove).not.toHaveBeenCalled();
  }, 10000);
});
