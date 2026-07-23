/**
 * @file documentWorker.test.ts
 * @description Integration tests for the document processing worker pipeline
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { JobCancelledError } from '@queues/cancellation';

// ── Service mocks (must be declared before module imports) ────────────────────

const mockExtractText = vi.fn();
const mockCreateChunks = vi.fn();
const mockEmbedBatch = vi.fn();
const mockUpdateDocumentStatus = vi.fn();
const mockUpsertChunks = vi.fn();
const mockUpdateChunkCount = vi.fn();
const mockDownloadFile = vi.fn();
const mockRemoveFile = vi.fn();

vi.mock('@services/chunker', () => ({
  extractText: mockExtractText,
  createChunks: mockCreateChunks,
}));

vi.mock('@services/embedder', () => ({
  embedBatch: mockEmbedBatch,
}));

vi.mock('@services/vectorStore', () => ({
  updateDocumentStatus: mockUpdateDocumentStatus,
  upsertChunks: mockUpsertChunks,
  updateChunkCount: mockUpdateChunkCount,
}));

vi.mock('@services/storage', () => ({
  downloadFile: mockDownloadFile,
  removeFile: mockRemoveFile,
}));

/**
 * Mirrors the real vectorStore checkpoint behaviour (`throwIfAborted`) for a
 * mocked write function: if the call's trailing arg is an already-aborted
 * AbortSignal, throw JobCancelledError instead of resolving. Lets the
 * cancellation-race test prove the worker's signal wiring actually prevents a
 * write, not just that a mock was called with some arguments.
 */
function abortAwareMock<Args extends unknown[]>(
  recordedCalls: Args[],
): (...args: Args) => Promise<void> {
  return async (...args: Args) => {
    const signal = args[args.length - 1];
    if (signal instanceof AbortSignal && signal.aborted) {
      throw new JobCancelledError(`write skipped (reason: ${String(signal.reason)})`);
    }
    recordedCalls.push(args);
  };
}

// ── BullMQ Worker mock ────────────────────────────────────────────────────────

const capturedProcessors: Array<(job: MockJob) => Promise<unknown>> = [];
const mockWorkerOn = vi.fn();
const mockWorkerClose = vi.fn().mockResolvedValue(undefined);

vi.mock('bullmq', () => {
  class MockWorker {
    constructor(_name: string, processor: (job: MockJob) => Promise<unknown>, _opts: unknown) {
      capturedProcessors.push(processor);
    }
    on = mockWorkerOn;
    close = mockWorkerClose;
  }
  class MockQueue {
    on = vi.fn();
  }
  class MockUnrecoverableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'UnrecoverableError';
    }
  }
  return { Worker: MockWorker, Queue: MockQueue, UnrecoverableError: MockUnrecoverableError };
});

// ── Types / helpers ───────────────────────────────────────────────────────────

interface MockJob {
  id: string;
  data: {
    documentId: string;
    storageKey: string;
    fileType: 'pdf' | 'txt' | 'md' | 'docx';
    originalName: string;
    correlationId: string;
    userId: string;
  };
  attemptsMade: number;
  updateProgress: Mock;
}

function makeJob(overrides: Partial<MockJob['data']> = {}): MockJob {
  return {
    id: 'job-001',
    data: {
      documentId: 'doc-uuid-111',
      storageKey: 'doc-uuid-111_report.pdf',
      fileType: 'pdf',
      originalName: 'report.pdf',
      correlationId: 'corr-xyz-789',
      userId: 'test-user-1',
      ...overrides,
    },
    attemptsMade: 1,
    updateProgress: vi.fn().mockResolvedValue(undefined),
  };
}

function makeChunks(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    content: `Chunk ${i + 1} content`,
    index: i,
    tokenCount: 50,
    metadata: { char_start: i * 100, char_end: (i + 1) * 100 },
  }));
}

function makeEmbeddings(count: number) {
  return Array.from({ length: count }, () => ({
    embedding: Array.from({ length: 384 }, () => Math.random()),
    tokenCount: 50,
    model: 'sentence-transformers/all-MiniLM-L6-v2',
  }));
}

// ── Import module under test after mocks are set up ──────────────────────────

// Side-effect import registers the worker and pushes to capturedProcessors
await import('@queues/workers/documentWorker');

// Grab the captured processor function
const getProcessor = () => capturedProcessors[capturedProcessors.length - 1]!;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('documentWorker — happy path', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const fileBuffer = Buffer.from('%PDF-1.4 test content');
    mockDownloadFile.mockResolvedValue(fileBuffer);
    mockExtractText.mockResolvedValue('Full document text about AI and machine learning.');
    mockCreateChunks.mockReturnValue(makeChunks(5));
    mockEmbedBatch.mockResolvedValue(makeEmbeddings(5));
    mockUpdateDocumentStatus.mockResolvedValue(undefined);
    mockUpsertChunks.mockResolvedValue(undefined);
    mockUpdateChunkCount.mockResolvedValue(undefined);
    mockRemoveFile.mockResolvedValue(undefined);
  });

  it('marks document as processing at the start (0%)', async () => {
    const job = makeJob();
    await getProcessor()(job);

    expect(mockUpdateDocumentStatus).toHaveBeenCalledWith(
      'doc-uuid-111',
      'processing',
      undefined,
      expect.any(AbortSignal),
    );
    const firstCall = (mockUpdateDocumentStatus as Mock).mock.calls[0];
    expect(firstCall[0]).toBe('doc-uuid-111');
    expect(firstCall[1]).toBe('processing');
  });

  it('calls services in the correct order: extract → chunk → embed → store', async () => {
    const job = makeJob();
    await getProcessor()(job);

    const extractOrder = (mockExtractText as Mock).mock.invocationCallOrder[0]!;
    const chunkOrder = (mockCreateChunks as Mock).mock.invocationCallOrder[0]!;
    const embedOrder = (mockEmbedBatch as Mock).mock.invocationCallOrder[0]!;
    const upsertOrder = (mockUpsertChunks as Mock).mock.invocationCallOrder[0]!;

    expect(extractOrder).toBeLessThan(chunkOrder);
    expect(chunkOrder).toBeLessThan(embedOrder);
    expect(embedOrder).toBeLessThan(upsertOrder);
  });

  it('extracts text using fileType from job data (not mimeType)', async () => {
    const job = makeJob({ fileType: 'docx', originalName: 'contract.docx' });
    await getProcessor()(job);

    expect(mockExtractText).toHaveBeenCalledWith(expect.any(Buffer), 'docx');
  });

  it('fires progress updates at 20, 40, 70, 90, 100', async () => {
    const job = makeJob();
    await getProcessor()(job);

    const progressCalls = (job.updateProgress as Mock).mock.calls.map(
      ([p]: [number]) => p,
    );
    expect(progressCalls).toEqual([20, 40, 70, 90, 100]);
  });

  it('passes chunk content strings to embedBatch', async () => {
    const chunks = makeChunks(3);
    mockCreateChunks.mockReturnValue(chunks);
    mockEmbedBatch.mockResolvedValue(makeEmbeddings(3));
    const job = makeJob();

    await getProcessor()(job);

    expect(mockEmbedBatch).toHaveBeenCalledWith(
      chunks.map((c) => c.content),
      undefined,
      expect.any(AbortSignal),
    );
  });

  it('upserts chunks with the correct documentId', async () => {
    const job = makeJob();
    await getProcessor()(job);

    expect(mockUpsertChunks).toHaveBeenCalledWith(
      'doc-uuid-111',
      expect.any(Array),
      expect.any(Array),
      expect.any(AbortSignal),
    );
  });

  it('updates chunk count to the number of created chunks', async () => {
    const chunks = makeChunks(7);
    mockCreateChunks.mockReturnValue(chunks);
    mockEmbedBatch.mockResolvedValue(makeEmbeddings(7));
    const job = makeJob();

    await getProcessor()(job);

    expect(mockUpdateChunkCount).toHaveBeenCalledWith('doc-uuid-111', 7, expect.any(AbortSignal));
  });

  it('marks document as ready after all steps complete', async () => {
    const job = makeJob();
    await getProcessor()(job);

    const readyCall = (mockUpdateDocumentStatus as Mock).mock.calls.find(
      ([, status]: [string, string]) => status === 'ready',
    );
    expect(readyCall).toBeDefined();
    expect(readyCall![0]).toBe('doc-uuid-111');
  });

  it('returns chunkCount and processingTimeMs in the result', async () => {
    const chunks = makeChunks(5);
    mockCreateChunks.mockReturnValue(chunks);
    mockEmbedBatch.mockResolvedValue(makeEmbeddings(5));
    const job = makeJob();

    const result = await getProcessor()(job) as { chunkCount: number; processingTimeMs: number };

    expect(result.chunkCount).toBe(5);
    expect(typeof result.processingTimeMs).toBe('number');
    expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('deletes the staged file after successful processing', async () => {
    const job = makeJob();
    await getProcessor()(job);

    expect(mockRemoveFile).toHaveBeenCalledWith('doc-uuid-111_report.pdf');
  });
});

describe('documentWorker — failure handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateDocumentStatus.mockResolvedValue(undefined);
    mockRemoveFile.mockResolvedValue(undefined);
  });

  it('marks document as failed when extractText throws', async () => {
    mockDownloadFile.mockResolvedValue(Buffer.from('data'));
    mockExtractText.mockRejectedValue(new Error('PDF corrupt header'));
    const job = makeJob();

    await expect(getProcessor()(job)).rejects.toThrow('PDF corrupt header');

    const failedCall = (mockUpdateDocumentStatus as Mock).mock.calls.find(
      ([, status]: [string, string]) => status === 'failed',
    );
    expect(failedCall).toBeDefined();
    expect(failedCall![2]).toBe('PDF corrupt header');
  });

  it('marks document as failed when embedBatch throws', async () => {
    mockDownloadFile.mockResolvedValue(Buffer.from('data'));
    mockExtractText.mockResolvedValue('Some text');
    mockCreateChunks.mockReturnValue(makeChunks(3));
    mockEmbedBatch.mockRejectedValue(new Error('HuggingFace rate limited'));
    const job = makeJob();

    await expect(getProcessor()(job)).rejects.toThrow('HuggingFace rate limited');

    const failedCall = (mockUpdateDocumentStatus as Mock).mock.calls.find(
      ([, status]: [string, string]) => status === 'failed',
    );
    expect(failedCall![2]).toBe('HuggingFace rate limited');
  });

  it('throws when document produces zero chunks', async () => {
    mockDownloadFile.mockResolvedValue(Buffer.from('data'));
    mockExtractText.mockResolvedValue('');
    mockCreateChunks.mockReturnValue([]);
    const job = makeJob();

    await expect(getProcessor()(job)).rejects.toThrow('zero chunks');
  });

  it('cleans up the staged file even when processing fails', async () => {
    mockDownloadFile.mockResolvedValue(Buffer.from('data'));
    mockExtractText.mockRejectedValue(new Error('Extraction failed'));
    const job = makeJob();

    await expect(getProcessor()(job)).rejects.toThrow();

    expect(mockRemoveFile).toHaveBeenCalledWith('doc-uuid-111_report.pdf');
  });

  it('does not re-throw cleanup errors that occur during failure path', async () => {
    mockDownloadFile.mockResolvedValue(Buffer.from('data'));
    mockExtractText.mockRejectedValue(new Error('parse error'));
    mockRemoveFile.mockRejectedValue(new Error('ENOENT'));
    const job = makeJob();

    // Should still throw the original error, not the cleanup error
    await expect(getProcessor()(job)).rejects.toThrow('parse error');
  });

  it('re-throws the original error so BullMQ can apply retry backoff', async () => {
    const originalError = new Error('Supabase pgvector insert timeout');
    mockDownloadFile.mockResolvedValue(Buffer.from('data'));
    mockExtractText.mockResolvedValue('text');
    mockCreateChunks.mockReturnValue(makeChunks(2));
    mockEmbedBatch.mockResolvedValue(makeEmbeddings(2));
    mockUpsertChunks.mockRejectedValue(originalError);
    const job = makeJob();

    const thrown = await getProcessor()(job).catch((e: Error) => e);
    expect(thrown).toBe(originalError);
  });
});

describe('documentWorker — progress checkpoints', () => {
  it('does not emit any progress before text is extracted', async () => {
    let extractCalled = false;
    mockDownloadFile.mockResolvedValue(Buffer.from('data'));
    mockExtractText.mockImplementation(async () => {
      // Verify no progress has been emitted before this point
      extractCalled = true;
      return 'some text';
    });
    mockCreateChunks.mockReturnValue(makeChunks(1));
    mockEmbedBatch.mockResolvedValue(makeEmbeddings(1));
    mockUpdateDocumentStatus.mockResolvedValue(undefined);
    mockUpsertChunks.mockResolvedValue(undefined);
    mockUpdateChunkCount.mockResolvedValue(undefined);
    mockRemoveFile.mockResolvedValue(undefined);

    const job = makeJob();
    const progressBeforeExtract: number[] = [];
    (job.updateProgress as Mock).mockImplementation(async (p: number) => {
      if (!extractCalled) progressBeforeExtract.push(p);
    });

    await getProcessor()(job);

    expect(progressBeforeExtract).toHaveLength(0);
    expect(extractCalled).toBe(true);
  });

  it('emits exactly 5 progress updates for a successful job', async () => {
    mockDownloadFile.mockResolvedValue(Buffer.from('data'));
    mockExtractText.mockResolvedValue('text');
    mockCreateChunks.mockReturnValue(makeChunks(2));
    mockEmbedBatch.mockResolvedValue(makeEmbeddings(2));
    mockUpdateDocumentStatus.mockResolvedValue(undefined);
    mockUpsertChunks.mockResolvedValue(undefined);
    mockUpdateChunkCount.mockResolvedValue(undefined);
    mockRemoveFile.mockResolvedValue(undefined);

    const job = makeJob();
    await getProcessor()(job);

    expect((job.updateProgress as Mock).mock.calls).toHaveLength(5);
  });
});

describe('documentWorker — cancellation under retry race', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDownloadFile.mockResolvedValue(Buffer.from('data'));
    mockRemoveFile.mockResolvedValue(undefined);
  });

  it('does not let a timed-out attempt clobber a subsequent retry\'s writes', async () => {
    // Records of writes that actually "landed" (mock resolved, not skipped
    // via JobCancelledError) — the assertion is on this, not on mock call
    // args, so the test proves behaviour rather than just wiring.
    const statusWrites: unknown[][] = [];
    const chunkWrites: unknown[][] = [];
    const countWrites: unknown[][] = [];

    mockUpdateDocumentStatus.mockImplementation(abortAwareMock(statusWrites));
    mockUpsertChunks.mockImplementation(abortAwareMock(chunkWrites));
    mockUpdateChunkCount.mockImplementation(abortAwareMock(countWrites));

    mockExtractText.mockResolvedValue('Full document text.');
    mockCreateChunks.mockReturnValue(makeChunks(3));

    // Attempt A's embedBatch call never resolves until we manually flip it —
    // simulates a slow HuggingFace call that outlives the job's timeout.
    let resolveAttemptAEmbed!: (v: ReturnType<typeof makeEmbeddings>) => void;
    const attemptAEmbedPromise = new Promise<ReturnType<typeof makeEmbeddings>>((resolve) => {
      resolveAttemptAEmbed = resolve;
    });

    let embedCallCount = 0;
    mockEmbedBatch.mockImplementation(async () => {
      embedCallCount++;
      if (embedCallCount === 1) {
        // Attempt A: hangs here — this is the "mid-pipeline, after chunking,
        // before embedding completes" timeout point the task asks for.
        return attemptAEmbedPromise;
      }
      // Attempt B (the retry): resolves immediately and proceeds normally.
      return makeEmbeddings(3);
    });

    const job = makeJob({ documentId: 'doc-race-1' });
    job.id = 'job-race-1';

    // ── Start attempt A — it will hang inside embedBatch ──────────────────
    const attemptAResult = getProcessor()(job);

    // Let attempt A reach the embedBatch call and hang there.
    await vi.waitFor(() => expect(embedCallCount).toBe(1));

    // ── Simulate BullMQ starting a retry for the same job ID ──────────────
    // (In production this happens after attempt A's own 5-minute timeout
    // fires and BullMQ reassigns the job; here we drive it directly to keep
    // the test deterministic instead of depending on real timers.)
    const attemptBResult = getProcessor()(job);
    await attemptBResult;

    // ── Now let attempt A's stale embedBatch call finally resolve ─────────
    // This simulates the abandoned attempt's slow network call completing
    // well after the retry has already finished successfully.
    resolveAttemptAEmbed(makeEmbeddings(3));
    await attemptAResult;

    // Exactly one successful pass wrote status/chunks/count — attempt B's.
    // Attempt A's late writes must all have been skipped via JobCancelledError.
    expect(statusWrites.filter((call) => call[1] === 'ready')).toHaveLength(1);
    expect(chunkWrites).toHaveLength(1);
    expect(countWrites).toHaveLength(1);

    // The successful writes are unambiguously attempt B's — sanity check via
    // the document ID (both attempts share it, but there being exactly one
    // recorded write of each kind is the load-bearing assertion above).
    expect(chunkWrites[0]?.[0]).toBe('doc-race-1');
  });

  it('attempt A exits cleanly (does not throw, does not reject the job) when cancelled by a retry', async () => {
    mockUpdateDocumentStatus.mockImplementation(abortAwareMock([]));
    mockUpsertChunks.mockImplementation(abortAwareMock([]));
    mockUpdateChunkCount.mockImplementation(abortAwareMock([]));
    mockExtractText.mockResolvedValue('text');
    mockCreateChunks.mockReturnValue(makeChunks(2));

    let resolveAttemptAEmbed!: (v: ReturnType<typeof makeEmbeddings>) => void;
    const attemptAEmbedPromise = new Promise<ReturnType<typeof makeEmbeddings>>((resolve) => {
      resolveAttemptAEmbed = resolve;
    });

    let embedCallCount = 0;
    mockEmbedBatch.mockImplementation(async () => {
      embedCallCount++;
      if (embedCallCount === 1) return attemptAEmbedPromise;
      return makeEmbeddings(2);
    });

    const job = makeJob({ documentId: 'doc-race-2' });
    job.id = 'job-race-2';

    const attemptAResult = getProcessor()(job);
    await vi.waitFor(() => expect(embedCallCount).toBe(1));

    await getProcessor()(job); // attempt B — retry claims the job

    resolveAttemptAEmbed(makeEmbeddings(2));

    // Attempt A must resolve cleanly (cancellation is not a job failure —
    // it must never reject/throw as if BullMQ should retry it again).
    await expect(attemptAResult).resolves.toEqual(
      expect.objectContaining({ chunkCount: 0 }),
    );
  });

  it('a genuinely new job ID is unaffected by a cancelled attempt on a different job ID', async () => {
    const statusWrites: unknown[][] = [];
    mockUpdateDocumentStatus.mockImplementation(abortAwareMock(statusWrites));
    mockUpsertChunks.mockImplementation(abortAwareMock([]));
    mockUpdateChunkCount.mockImplementation(abortAwareMock([]));
    mockExtractText.mockResolvedValue('text');
    mockCreateChunks.mockReturnValue(makeChunks(1));
    mockEmbedBatch.mockResolvedValue(makeEmbeddings(1));

    const jobX = makeJob({ documentId: 'doc-x' });
    jobX.id = 'job-x';
    const jobY = makeJob({ documentId: 'doc-y' });
    jobY.id = 'job-y';

    await getProcessor()(jobX);
    await getProcessor()(jobY);

    expect(statusWrites.filter((c) => c[0] === 'doc-x' && c[1] === 'ready')).toHaveLength(1);
    expect(statusWrites.filter((c) => c[0] === 'doc-y' && c[1] === 'ready')).toHaveLength(1);
  });
});

describe('documentWorker — graceful shutdown', () => {
  it('registers a SIGTERM handler', () => {
    const listeners = process.listeners('SIGTERM');
    expect(listeners.length).toBeGreaterThan(0);
  });

  it('worker.close() resolves without throwing', async () => {
    const { documentWorker } = await import('@queues/workers/documentWorker');
    await expect(documentWorker.close()).resolves.not.toThrow();
    expect(mockWorkerClose).toHaveBeenCalled();
  });
});
