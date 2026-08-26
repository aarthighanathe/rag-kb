/**
 * @file dataRetention.test.ts
 * @description Unit tests for data retention policy calculations and cleanup queries.
 * @author [Author Placeholder]
 * @created 2026-08-26
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RETENTION_POLICIES,
  DataType,
  calculateExpirationDate,
  checkRetentionStatus,
  cleanupExpiredQueries,
  cleanupExpiredAuditLogs,
  runAllCleanupTasks,
  getExpiringDataSummary,
} from '../../src/services/dataRetention.js';

const mockGetClient = vi.fn();

vi.mock('../../src/services/vectorStore.js', () => ({
  getClient: () => mockGetClient(),
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

describe('calculateExpirationDate', () => {
  it('adds 365 days for query logs', () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const expiresAt = calculateExpirationDate(DataType.QUERY, createdAt);
    expect(expiresAt.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('adds 730 days for audit logs', () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const expiresAt = calculateExpirationDate(DataType.AUDIT_LOG, createdAt);
    expect(expiresAt.toISOString()).toBe('2028-01-01T00:00:00.000Z');
  });

  it('matches the documented RETENTION_POLICIES constants', () => {
    expect(RETENTION_POLICIES.queries.standard).toBe(365);
    expect(RETENTION_POLICIES.auditLogs.standard).toBe(730);
  });
});

describe('checkRetentionStatus', () => {
  it('reports a record created today as retained for queries', () => {
    const status = checkRetentionStatus(DataType.QUERY, new Date());
    expect(status.isRetained).toBe(true);
    expect(status.reason).toMatch(/Retained until/);
  });

  it('reports a query log older than 365 days as expired', () => {
    const createdAt = new Date(Date.now() - 366 * 24 * 60 * 60 * 1000);
    const status = checkRetentionStatus(DataType.QUERY, createdAt);
    expect(status.isRetained).toBe(false);
    expect(status.reason).toBe('Retention period expired');
  });

  it('reports an audit log 400 days old as still retained (2-year policy)', () => {
    const createdAt = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    const status = checkRetentionStatus(DataType.AUDIT_LOG, createdAt);
    expect(status.isRetained).toBe(true);
  });

  it('reports an audit log older than 730 days as expired', () => {
    const createdAt = new Date(Date.now() - 731 * 24 * 60 * 60 * 1000);
    const status = checkRetentionStatus(DataType.AUDIT_LOG, createdAt);
    expect(status.isRetained).toBe(false);
  });

  it('places the expiration boundary exactly at the retention day count', () => {
    // A record created exactly 365 days ago (to the millisecond) has an
    // expiresAt of "now" — `new Date() < expiresAt` should be false, i.e.
    // already expired rather than retained, since the comparison is strict.
    const createdAt = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const status = checkRetentionStatus(DataType.QUERY, createdAt);
    expect(status.isRetained).toBe(false);
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

describe('runAllCleanupTasks', () => {
  beforeEach(() => {
    mockGetClient.mockReset();
  });

  it('sums query and audit-log deletions into a total', async () => {
    let call = 0;
    mockGetClient.mockReturnValue({
      from: vi.fn(() => {
        call += 1;
        // First call is cleanupExpiredQueries (2 rows), second is
        // cleanupExpiredAuditLogs (5 rows) — order matches Promise.all's
        // array position, not resolution order.
        const rows = call === 1 ? [{ id: '1' }, { id: '2' }] : [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }, { id: '5' }];
        return makeDeleteBuilder({ data: rows, error: null });
      }),
    });

    const result = await runAllCleanupTasks();

    expect(result).toEqual({ queries: 2, auditLogs: 5, total: 7 });
  });

  it('produces a total of 0 when both cleanups fail', async () => {
    mockGetClient.mockReturnValue({
      from: vi.fn(() => makeDeleteBuilder({ data: null, error: { message: 'down' } })),
    });

    const result = await runAllCleanupTasks();

    expect(result).toEqual({ queries: 0, auditLogs: 0, total: 0 });
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
