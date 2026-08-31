/**
 * @file dataRetention.test.ts
 * @description Unit tests for data retention policy calculations and cleanup queries.
 * @author [Author Placeholder]
 * @created 2026-08-26
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RETENTION_POLICIES,
  cleanupExpiredQueries,
  cleanupExpiredAuditLogs,
  reconcileOrphanedStorageFiles,
  runAllCleanupTasks,
  getExpiringDataSummary,
} from '../../src/services/dataRetention.js';

const mockGetClient = vi.fn();
const mockListStagedFiles = vi.fn();
const mockRemoveFile = vi.fn();

vi.mock('../../src/services/vectorStore.js', () => ({
  getClient: () => mockGetClient(),
}));

vi.mock('../../src/services/storage.js', () => ({
  listStagedFiles: (...args: unknown[]) => mockListStagedFiles(...args),
  removeFile: (...args: unknown[]) => mockRemoveFile(...args),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

/** Builds a chainable Supabase query-builder fake for `.from(table).delete().lt(...).select(...)`. */
function makeDeleteBuilder(result: { data: unknown; error: unknown }) {
  const builder = {
    delete: vi.fn(() => builder),
    lt: vi.fn(() => builder),
    select: vi.fn(() => Promise.resolve(result)),
  };
  return builder;
}

/** Builds a chainable Supabase query-builder fake for the count-only `.select(..., {count}).lt(...)` path. */
function makeCountBuilder(result: { count: number | null; error: unknown }) {
  const builder = {
    select: vi.fn(() => builder),
    lt: vi.fn(() => Promise.resolve(result)),
  };
  return builder;
}

describe('RETENTION_POLICIES', () => {
  it('matches the documented retention periods', () => {
    expect(RETENTION_POLICIES.queries.standard).toBe(365);
    expect(RETENTION_POLICIES.auditLogs.standard).toBe(730);
  });
});

describe('cleanupExpiredQueries', () => {
  beforeEach(() => {
    mockGetClient.mockReset();
  });

  it('deletes rows older than the cutoff and returns the deleted count', async () => {
    const builder = makeDeleteBuilder({ data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], error: null });
    mockGetClient.mockReturnValue({ from: vi.fn(() => builder) });

    const count = await cleanupExpiredQueries();

    expect(count).toBe(3);
    expect(builder.lt).toHaveBeenCalledWith('created_at', expect.any(String));
  });

  it('returns 0 and logs when Supabase returns an error', async () => {
    const builder = makeDeleteBuilder({ data: null, error: { message: 'connection refused' } });
    mockGetClient.mockReturnValue({ from: vi.fn(() => builder) });

    const count = await cleanupExpiredQueries();

    expect(count).toBe(0);
  });

  it('returns 0 when no rows matched the cutoff', async () => {
    const builder = makeDeleteBuilder({ data: [], error: null });
    mockGetClient.mockReturnValue({ from: vi.fn(() => builder) });

    const count = await cleanupExpiredQueries();

    expect(count).toBe(0);
  });

  it('returns 0 without throwing when the client itself throws', async () => {
    mockGetClient.mockImplementation(() => {
      throw new Error('client not initialised');
    });

    const count = await cleanupExpiredQueries();

    expect(count).toBe(0);
  });
});

describe('cleanupExpiredAuditLogs', () => {
  beforeEach(() => {
    mockGetClient.mockReset();
  });

  it('deletes expired audit log rows and returns the count', async () => {
    const builder = makeDeleteBuilder({ data: [{ id: '1' }], error: null });
    mockGetClient.mockReturnValue({ from: vi.fn(() => builder) });

    const count = await cleanupExpiredAuditLogs();

    expect(count).toBe(1);
    expect(builder.lt).toHaveBeenCalledWith('created_at', expect.any(String));
  });

  it('returns 0 on a Supabase error', async () => {
    const builder = makeDeleteBuilder({ data: null, error: { message: 'timeout' } });
    mockGetClient.mockReturnValue({ from: vi.fn(() => builder) });

    const count = await cleanupExpiredAuditLogs();

    expect(count).toBe(0);
  });
});

describe('reconcileOrphanedStorageFiles', () => {
  const DOC_A = '11111111-1111-1111-1111-111111111111';
  const DOC_B = '22222222-2222-2222-2222-222222222222';
  const OLD_TIMESTAMP = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2h ago
  const RECENT_TIMESTAMP = new Date().toISOString();

  beforeEach(() => {
    mockGetClient.mockReset();
    mockListStagedFiles.mockReset();
    mockRemoveFile.mockReset();
    mockRemoveFile.mockResolvedValue(undefined);
  });

  /** Builds a chainable `.from('documents').select('id').in('id', ids)` fake. */
  function makeDocumentsInBuilder(result: { data: unknown; error: unknown }) {
    return { select: vi.fn(() => ({ in: vi.fn(() => Promise.resolve(result)) })) };
  }

  it('removes files past the grace period with no matching documents row', async () => {
    mockListStagedFiles.mockResolvedValue([
      { name: `${DOC_A}_report.pdf`, createdAt: OLD_TIMESTAMP },
      { name: `${DOC_B}_notes.txt`, createdAt: OLD_TIMESTAMP },
    ]);
    mockGetClient.mockReturnValue({
      from: vi.fn(() => makeDocumentsInBuilder({ data: [{ id: DOC_A }], error: null })),
    });

    const count = await reconcileOrphanedStorageFiles();

    expect(count).toBe(1);
    expect(mockRemoveFile).toHaveBeenCalledTimes(1);
    expect(mockRemoveFile).toHaveBeenCalledWith(`${DOC_B}_notes.txt`);
  });

  it('never removes a file inside the grace period, even with no matching row', async () => {
    mockListStagedFiles.mockResolvedValue([
      { name: `${DOC_A}_report.pdf`, createdAt: RECENT_TIMESTAMP },
    ]);
    mockGetClient.mockReturnValue({
      from: vi.fn(() => makeDocumentsInBuilder({ data: [], error: null })),
    });

    const count = await reconcileOrphanedStorageFiles();

    expect(count).toBe(0);
    expect(mockRemoveFile).not.toHaveBeenCalled();
  });

  it('returns 0 without querying documents when the bucket is empty', async () => {
    mockListStagedFiles.mockResolvedValue([]);

    const count = await reconcileOrphanedStorageFiles();

    expect(count).toBe(0);
    expect(mockGetClient).not.toHaveBeenCalled();
  });

  it('returns 0 and logs when the documents lookup errors', async () => {
    mockListStagedFiles.mockResolvedValue([{ name: `${DOC_A}_x.pdf`, createdAt: OLD_TIMESTAMP }]);
    mockGetClient.mockReturnValue({
      from: vi.fn(() => makeDocumentsInBuilder({ data: null, error: { message: 'down' } })),
    });

    const count = await reconcileOrphanedStorageFiles();

    expect(count).toBe(0);
    expect(mockRemoveFile).not.toHaveBeenCalled();
  });

  it('returns 0 without throwing when listStagedFiles itself throws', async () => {
    mockListStagedFiles.mockRejectedValue(new Error('storage unreachable'));

    const count = await reconcileOrphanedStorageFiles();

    expect(count).toBe(0);
  });

  it('leaves a file with an unparseable key alone rather than deleting it', async () => {
    mockListStagedFiles.mockResolvedValue([{ name: 'not-a-uuid-prefixed-key.txt', createdAt: OLD_TIMESTAMP }]);
    mockGetClient.mockReturnValue({
      from: vi.fn(() => makeDocumentsInBuilder({ data: [], error: null })),
    });

    const count = await reconcileOrphanedStorageFiles();

    expect(count).toBe(0);
    expect(mockRemoveFile).not.toHaveBeenCalled();
  });
});

describe('runAllCleanupTasks', () => {
  beforeEach(() => {
    mockGetClient.mockReset();
    mockListStagedFiles.mockReset();
    mockListStagedFiles.mockResolvedValue([]);
  });

  it('sums query, audit-log, and orphaned-storage cleanups into a total', async () => {
    let call = 0;
    mockGetClient.mockReturnValue({
      from: vi.fn(() => {
        call += 1;
        // First call is cleanupExpiredQueries (2 rows), second is
        // cleanupExpiredAuditLogs (5 rows) — order matches Promise.all's
        // array position, not resolution order. reconcileOrphanedStorageFiles
        // never reaches getClient() here since the staged-files list is empty.
        const rows = call === 1 ? [{ id: '1' }, { id: '2' }] : [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }, { id: '5' }];
        return makeDeleteBuilder({ data: rows, error: null });
      }),
    });

    const result = await runAllCleanupTasks();

    expect(result).toEqual({ queries: 2, auditLogs: 5, orphanedStorageFiles: 0, total: 7 });
  });

  it('produces a total of 0 when all cleanups fail', async () => {
    mockGetClient.mockReturnValue({
      from: vi.fn(() => makeDeleteBuilder({ data: null, error: { message: 'down' } })),
    });

    const result = await runAllCleanupTasks();

    expect(result).toEqual({ queries: 0, auditLogs: 0, orphanedStorageFiles: 0, total: 0 });
  });
});

describe('getExpiringDataSummary', () => {
  beforeEach(() => {
    mockGetClient.mockReset();
  });

  it('returns the exact counts reported by Supabase for each table', async () => {
    let call = 0;
    mockGetClient.mockReturnValue({
      from: vi.fn(() => {
        call += 1;
        const count = call === 1 ? 42 : 7;
        return makeCountBuilder({ count, error: null });
      }),
    });

    const summary = await getExpiringDataSummary();

    expect(summary).toEqual({ queries: 42, auditLogs: 7 });
  });

  it('falls back to 0 when Supabase returns a null count', async () => {
    mockGetClient.mockReturnValue({
      from: vi.fn(() => makeCountBuilder({ count: null, error: null })),
    });

    const summary = await getExpiringDataSummary();

    expect(summary).toEqual({ queries: 0, auditLogs: 0 });
  });

  it('returns zeroed counts without throwing when the client throws', async () => {
    mockGetClient.mockImplementation(() => {
      throw new Error('client not initialised');
    });

    const summary = await getExpiringDataSummary();

    expect(summary).toEqual({ queries: 0, auditLogs: 0 });
  });
});
