/**
 * @file ragStore.polling.test.ts
 * @description Regression tests for startPolling's interval-leak fix (#16) and
 *   poll-count cap fix (#17): duplicate startPolling calls for the same jobId
 *   must not orphan the original interval, and a job stuck 'active' forever
 *   must eventually be marked failed/timed-out rather than polled forever.
 * @author [Author Placeholder]
 * @created 2026-07-23
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useRagStore, type UploadItem } from '../../stores/ragStore';
import { getJobStatus } from '../../services/api';

// Mock API calls — same shape as ragStore.split.test.ts
vi.mock('../../services/api', () => ({
  listDocuments: vi.fn().mockResolvedValue({ data: [] }),
  deleteDocument: vi.fn(),
  uploadDocument: vi.fn(),
  extractErrorMessage: vi.fn((e: unknown) => (e as Error).message),
  initiateQuery: vi.fn().mockResolvedValue({ queryId: 'q1' }),
  getJobStatus: vi.fn(),
  getQueryStreamUrl: vi.fn(),
}));

const mockedGetJobStatus = vi.mocked(getJobStatus);

function makeQueueItem(overrides: Partial<UploadItem> = {}): UploadItem {
  return {
    id: 'item-1',
    file: new File(['content'], 'doc.pdf'),
    progress: 0,
    status: 'processing',
    documentId: 'doc-1',
    jobId: 'job-1',
    fileSizeBytes: 1024,
    ...overrides,
  };
}

describe('ragStore — startPolling interval leak (#16)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedGetJobStatus.mockReset();
    mockedGetJobStatus.mockResolvedValue({ documentId: 'doc-1', state: 'active', progress: 10 });
    useRagStore.setState({
      pollingJobs: {},
      uploadQueue: [makeQueueItem()],
    });
  });

  afterEach(() => {
    useRagStore.getState().stopPolling('job-1');
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('clears the prior interval when startPolling is called twice for the same jobId', async () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    useRagStore.getState().startPolling('job-1', 'doc-1');
    const firstIntervalId = useRagStore.getState().pollingJobs['job-1'];
    expect(firstIntervalId).toBeDefined();

    // Simulate a remount / duplicate upload-start path polling the same job again.
    useRagStore.getState().startPolling('job-1', 'doc-1');
    const secondIntervalId = useRagStore.getState().pollingJobs['job-1'];

    expect(clearIntervalSpy).toHaveBeenCalledWith(firstIntervalId);
    expect(secondIntervalId).not.toBe(firstIntervalId);

    // Only one interval should still be ticking — advancing time should only
    // trigger one set of getJobStatus calls per 3s tick, not two overlapping ones.
    mockedGetJobStatus.mockClear();
    await vi.advanceTimersByTimeAsync(3000);
    expect(mockedGetJobStatus).toHaveBeenCalledTimes(1);

    clearIntervalSpy.mockRestore();
  });

  it('does not leave a stale pollingJobs entry pointing at a cleared interval', () => {
    useRagStore.getState().startPolling('job-1', 'doc-1');
    const firstIntervalId = useRagStore.getState().pollingJobs['job-1'];

    useRagStore.getState().startPolling('job-1', 'doc-1');

    // The store's bookkeeping must reflect only the latest interval.
    expect(useRagStore.getState().pollingJobs['job-1']).not.toBe(firstIntervalId);
    expect(Object.keys(useRagStore.getState().pollingJobs)).toHaveLength(1);
  });
});

describe('ragStore — startPolling poll cap (#17)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedGetJobStatus.mockReset();
    // Simulate a permanently-stuck job: backend never reports 'completed' or 'failed'.
    mockedGetJobStatus.mockResolvedValue({ documentId: 'doc-1', state: 'active', progress: 50 });
    useRagStore.setState({
      pollingJobs: {},
      uploadQueue: [makeQueueItem()],
    });
  });

  afterEach(() => {
    useRagStore.getState().stopPolling('job-1');
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('stops polling and marks the item failed after the max poll attempts are exhausted', async () => {
    useRagStore.getState().startPolling('job-1', 'doc-1');

    // Drive every 3s tick forward past the cap (200 attempts * 3s = 600_000ms).
    // Add one extra tick of headroom to guarantee the cap-exceeding branch runs.
    await vi.advanceTimersByTimeAsync(200 * 3000 + 3000);

    const item = useRagStore.getState().uploadQueue.find((i) => i.jobId === 'job-1');
    expect(item?.status).toBe('failed');
    expect(item?.error).toMatch(/timed out/i);

    // Polling must have actually stopped — no interval left registered.
    expect(useRagStore.getState().pollingJobs['job-1']).toBeUndefined();
  });

  it('does not mark the item failed before the cap is reached', async () => {
    useRagStore.getState().startPolling('job-1', 'doc-1');

    // Advance well under the cap.
    await vi.advanceTimersByTimeAsync(50 * 3000);

    const item = useRagStore.getState().uploadQueue.find((i) => i.jobId === 'job-1');
    expect(item?.status).toBe('processing');
    expect(useRagStore.getState().pollingJobs['job-1']).toBeDefined();
  });
});
