/**
 * @file backupService.test.ts
 * @description Unit tests for the automated backup/restore service — filename
 *   generation, pg_dump vs. Supabase-SDK fallback branching, incremental
 *   diffing, retention-based cleanup, and format-detecting restore.
 * @author [Author Placeholder]
 * @created 2026-08-26
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetClient = vi.fn();
const mockExec = vi.fn();
const mockAccess = vi.fn();
const mockMkdir = vi.fn();
const mockWriteFile = vi.fn();
const mockReadFile = vi.fn();
const mockReaddir = vi.fn();
const mockStat = vi.fn();
const mockUnlink = vi.fn();

vi.mock('../../src/services/vectorStore.js', () => ({
  getClient: () => mockGetClient(),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../../src/config/env.js', () => ({
  env: { ADMIN_SECRET: 'x'.repeat(32) },
}));

// child_process.exec is wrapped via util.promisify in the source, which
// reads exec.__promisify__; vitest's vi.mock replaces the whole module, so
// we provide a plain async-compatible fn and let promisify use its normal
// callback-style contract by exposing a callback overload.
vi.mock('child_process', () => ({
  exec: (...args: unknown[]) => mockExec(...args),
}));

vi.mock('fs/promises', () => ({
  access: (...args: unknown[]) => mockAccess(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  readdir: (...args: unknown[]) => mockReaddir(...args),
  stat: (...args: unknown[]) => mockStat(...args),
  unlink: (...args: unknown[]) => mockUnlink(...args),
}));

vi.mock('fs', () => ({
  constants: { R_OK: 4, W_OK: 2 },
  promises: {
    access: (...args: unknown[]) => mockAccess(...args),
    mkdir: (...args: unknown[]) => mockMkdir(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    readFile: (...args: unknown[]) => mockReadFile(...args),
    readdir: (...args: unknown[]) => mockReaddir(...args),
    stat: (...args: unknown[]) => mockStat(...args),
    unlink: (...args: unknown[]) => mockUnlink(...args),
  },
}));

vi.mock('util', () => ({
  promisify:
    (fn: (...args: unknown[]) => void) =>
    (...args: unknown[]) =>
      new Promise((resolve, reject) => {
        fn(...args, (err: unknown, result: unknown) => (err ? reject(err) : resolve(result)));
      }),
}));

import {
  performFullBackup,
  performIncrementalBackup,
  cleanupOldBackups,
  listBackups,
  restoreBackup,
  runScheduledBackups,
} from '../../src/services/backupService.js';

/** Builds a chainable Supabase `.from(table).select('*')` fake resolving to `result`. */
function makeSelectAllBuilder(byTable: Record<string, { data: unknown[] | null; error: unknown }>) {
  return {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => Promise.resolve(byTable[table] ?? { data: [], error: null })),
    })),
  };
}

/** Builds a chainable Supabase `.from(table).select('*').gt(col, val)` fake. */
function makeGtBuilder(byTable: Record<string, { data: unknown[] | null; error: unknown }>) {
  return {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        gt: vi.fn(() => Promise.resolve(byTable[table] ?? { data: [], error: null })),
      })),
    })),
  };
}

/** Builds a chainable Supabase `.from(table).upsert(rows)` fake. */
function makeUpsertBuilder(errorForTable: Record<string, unknown> = {}) {
  return {
    from: vi.fn((table: string) => ({
      upsert: vi.fn(() => Promise.resolve({ error: errorForTable[table] ?? null })),
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env['DATABASE_URL'];
  // ensureBackupDirectory: directory already exists by default.
  mockAccess.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('performFullBackup', () => {
  it('falls back to the Supabase SDK backup when DATABASE_URL is unset', async () => {
    mockGetClient.mockReturnValue(
      makeSelectAllBuilder({
        documents: { data: [{ id: '1' }], error: null },
        document_chunks: { data: [], error: null },
        query_logs: { data: [], error: null },
        audit_logs: { data: [], error: null },
      }),
    );
    mockWriteFile.mockResolvedValue(undefined);

    const result = await performFullBackup();

    expect(result.success).toBe(true);
    expect(result.type).toBe('full');
    expect(result.tablesBackedUp).toEqual(['documents', 'document_chunks', 'query_logs', 'audit_logs']);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    // Content written must be valid JSON containing the fetched row.
    const written = mockWriteFile.mock.calls[0]?.[1] as string;
    expect(JSON.parse(written).documents).toEqual([{ id: '1' }]);
  });

  it('uses pg_dump when DATABASE_URL is set and succeeds', async () => {
    process.env['DATABASE_URL'] = 'postgres://user:pass@host:5432/db';
    mockExec.mockImplementation((_cmd: string, cb: (err: unknown, result: unknown) => void) =>
      cb(null, { stdout: '', stderr: '' }),
    );
    mockStat.mockResolvedValue({ size: 12345 });

    const result = await performFullBackup();

    expect(result.success).toBe(true);
    expect(result.sizeBytes).toBe(12345);
    expect(mockExec).toHaveBeenCalledTimes(1);
    const [command] = mockExec.mock.calls[0] as [string];
    expect(command).toContain('pg_dump');
    expect(command).toContain('-t documents -t document_chunks -t query_logs -t audit_logs');
  });

  it('falls back to the Supabase SDK backup when pg_dump fails', async () => {
    process.env['DATABASE_URL'] = 'postgres://user:pass@host:5432/db';
    mockExec.mockImplementation((_cmd: string, cb: (err: unknown, result: unknown) => void) =>
      cb(new Error('pg_dump: command not found'), null),
    );
    mockGetClient.mockReturnValue(
      makeSelectAllBuilder({
        documents: { data: [], error: null },
        document_chunks: { data: [], error: null },
        query_logs: { data: [], error: null },
        audit_logs: { data: [], error: null },
      }),
    );
    mockWriteFile.mockResolvedValue(undefined);

    const result = await performFullBackup();

    expect(result.success).toBe(true);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });

  it('creates the backup directory when it does not already exist', async () => {
    mockAccess.mockRejectedValueOnce(new Error('ENOENT'));
    mockMkdir.mockResolvedValue(undefined);
    mockGetClient.mockReturnValue(
      makeSelectAllBuilder({
        documents: { data: [], error: null },
        document_chunks: { data: [], error: null },
        query_logs: { data: [], error: null },
        audit_logs: { data: [], error: null },
      }),
    );
    mockWriteFile.mockResolvedValue(undefined);

    await performFullBackup();

    expect(mockMkdir).toHaveBeenCalledWith('./backups', { recursive: true });
  });

  it('returns success:false with the error message when the SDK backup write fails', async () => {
    mockGetClient.mockReturnValue(
      makeSelectAllBuilder({
        documents: { data: [], error: null },
        document_chunks: { data: [], error: null },
        query_logs: { data: [], error: null },
        audit_logs: { data: [], error: null },
      }),
    );
    mockWriteFile.mockRejectedValue(new Error('disk full'));

    const result = await performFullBackup();

    expect(result.success).toBe(false);
    expect(result.error).toBe('disk full');
    expect(result.tablesBackedUp).toEqual([]);
  });

  it('backs up an empty array for a table that errors, without failing the whole backup', async () => {
    mockGetClient.mockReturnValue(
      makeSelectAllBuilder({
        documents: { data: null, error: { message: 'permission denied' } },
        document_chunks: { data: [], error: null },
        query_logs: { data: [], error: null },
        audit_logs: { data: [], error: null },
      }),
    );
    mockWriteFile.mockResolvedValue(undefined);

    const result = await performFullBackup();

    expect(result.success).toBe(true);
    const written = mockWriteFile.mock.calls[0]?.[1] as string;
    expect(JSON.parse(written).documents).toEqual([]);
  });
});

describe('performIncrementalBackup', () => {
  it('backs up only tables with rows changed since the last window and lists them', async () => {
    mockGetClient.mockReturnValue(
      makeGtBuilder({
        documents: { data: [{ id: 'd1' }], error: null },
        document_chunks: { data: [], error: null },
        query_logs: { data: [{ id: 'q1' }, { id: 'q2' }], error: null },
        audit_logs: { data: [], error: null },
      }),
    );
    mockWriteFile.mockResolvedValue(undefined);

    const result = await performIncrementalBackup();

    expect(result.success).toBe(true);
    expect(result.tablesBackedUp.sort()).toEqual(['documents', 'query_logs']);
    const written = mockWriteFile.mock.calls[0]?.[1] as string;
    const parsed = JSON.parse(written);
    expect(parsed.document_chunks).toBeUndefined();
    expect(parsed.query_logs).toHaveLength(2);
  });

  it('reports success with no tables backed up and skips the file write when nothing changed', async () => {
    mockGetClient.mockReturnValue(
      makeGtBuilder({
        documents: { data: [], error: null },
        document_chunks: { data: [], error: null },
        query_logs: { data: [], error: null },
        audit_logs: { data: [], error: null },
      }),
    );

    const result = await performIncrementalBackup();

    expect(result.success).toBe(true);
    expect(result.tablesBackedUp).toEqual([]);
    expect(result.filePath).toBeUndefined();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('uses updated_at as the change column for documents but created_at for other tables', async () => {
    const gtSpies: Record<string, ReturnType<typeof vi.fn>> = {};
    mockGetClient.mockReturnValue({
      from: vi.fn((table: string) => {
        const gt = vi.fn(() => Promise.resolve({ data: [], error: null }));
        gtSpies[table] = gt;
        return { select: vi.fn(() => ({ gt })) };
      }),
    });

    await performIncrementalBackup();

    expect(gtSpies['documents']).toHaveBeenCalledWith('updated_at', expect.any(String));
    expect(gtSpies['query_logs']).toHaveBeenCalledWith('created_at', expect.any(String));
    expect(gtSpies['audit_logs']).toHaveBeenCalledWith('created_at', expect.any(String));
  });
});

describe('cleanupOldBackups', () => {
  it('deletes full backups older than 7 days and incremental backups older than 2 days', async () => {
    const now = Date.now();
    mockReaddir.mockResolvedValue([
      'backup-full-old.sql',
      'backup-full-recent.sql',
      'backup-incremental-old.sql',
      'backup-incremental-recent.sql',
      'not-a-backup.txt',
    ]);
    mockStat.mockImplementation((path: string) => {
      if (path.includes('full-old')) return Promise.resolve({ mtime: new Date(now - 8 * 24 * 60 * 60 * 1000) });
      if (path.includes('full-recent')) return Promise.resolve({ mtime: new Date(now - 1 * 24 * 60 * 60 * 1000) });
      if (path.includes('incremental-old')) return Promise.resolve({ mtime: new Date(now - 3 * 24 * 60 * 60 * 1000) });
      return Promise.resolve({ mtime: new Date(now - 1 * 60 * 60 * 1000) });
    });
    mockUnlink.mockResolvedValue(undefined);

    const deletedCount = await cleanupOldBackups();

    expect(deletedCount).toBe(2);
    expect(mockUnlink).toHaveBeenCalledTimes(2);
    const deletedPaths = mockUnlink.mock.calls.map((c) => c[0] as string);
    expect(deletedPaths.some((p) => p.includes('full-old'))).toBe(true);
    expect(deletedPaths.some((p) => p.includes('incremental-old'))).toBe(true);
    expect(deletedPaths.some((p) => p.includes('recent'))).toBe(false);
  });

  it('ignores non-backup files entirely', async () => {
    mockReaddir.mockResolvedValue(['README.md', '.gitkeep']);

    const deletedCount = await cleanupOldBackups();

    expect(deletedCount).toBe(0);
    expect(mockStat).not.toHaveBeenCalled();
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it('returns 0 without throwing when the directory read fails', async () => {
    mockReaddir.mockRejectedValue(new Error('ENOENT: no such directory'));

    const deletedCount = await cleanupOldBackups();

    expect(deletedCount).toBe(0);
  });
});

describe('listBackups', () => {
  it('classifies, sizes, and sorts backups newest-first', async () => {
    mockReaddir.mockResolvedValue(['backup-full-a.sql', 'backup-incremental-b.sql']);
    mockStat.mockImplementation((path: string) => {
      if (path.includes('full-a')) {
        return Promise.resolve({ mtime: new Date('2026-01-01T00:00:00Z'), size: 100 });
      }
      return Promise.resolve({ mtime: new Date('2026-06-01T00:00:00Z'), size: 200 });
    });

    const backups = await listBackups();

    expect(backups).toHaveLength(2);
    expect(backups[0]?.type).toBe('incremental');
    expect(backups[0]?.sizeBytes).toBe(200);
    expect(backups[1]?.type).toBe('full');
  });

  it('returns an empty array when the backup directory cannot be read', async () => {
    mockReaddir.mockRejectedValue(new Error('ENOENT'));

    const backups = await listBackups();

    expect(backups).toEqual([]);
  });
});

describe('restoreBackup', () => {
  it('restores a JSON backup via Supabase upsert for each non-empty table', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ documents: [{ id: '1' }], query_logs: [] }));
    const upsertBuilder = makeUpsertBuilder();
    mockGetClient.mockReturnValue(upsertBuilder);

    const ok = await restoreBackup('./backups/backup-full-x.sql');

    expect(ok).toBe(true);
    expect(upsertBuilder.from).toHaveBeenCalledWith('documents');
    expect(upsertBuilder.from).not.toHaveBeenCalledWith('query_logs');
  });

  it('fails a JSON restore when Supabase rejects the upsert for a table', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ documents: [{ id: '1' }] }));
    mockGetClient.mockReturnValue(makeUpsertBuilder({ documents: { message: 'constraint violation' } }));

    const ok = await restoreBackup('./backups/backup-full-x.sql');

    expect(ok).toBe(false);
  });

  it('restores a plain-SQL backup via psql when DATABASE_URL is set', async () => {
    process.env['DATABASE_URL'] = 'postgres://user:pass@host:5432/db';
    mockReadFile.mockResolvedValue('-- pg_dump output\nBEGIN;\nCOMMIT;\n');
    mockExec.mockImplementation((_cmd: string, cb: (err: unknown, result: unknown) => void) =>
      cb(null, { stdout: '', stderr: '' }),
    );

    const ok = await restoreBackup('./backups/backup-full-x.sql');

    expect(ok).toBe(true);
    const [command] = mockExec.mock.calls[0] as [string];
    expect(command).toContain('psql');
  });

  it('fails a SQL restore when DATABASE_URL is unset', async () => {
    mockReadFile.mockResolvedValue('-- pg_dump output\nBEGIN;\nCOMMIT;\n');

    const ok = await restoreBackup('./backups/backup-full-x.sql');

    expect(ok).toBe(false);
  });

  it('returns false without throwing when the backup file cannot be read', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    const ok = await restoreBackup('./backups/missing.sql');

    expect(ok).toBe(false);
  });
});

describe('runScheduledBackups', () => {
  it('runs only cleanup outside the scheduled full/incremental hours', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T05:00:00'));
    mockReaddir.mockResolvedValue([]);

    const result = await runScheduledBackups();

    expect(result.full).toBeNull();
    expect(result.incremental).toBeNull();
    expect(result.cleanup).toBe(0);
    vi.useRealTimers();
  });

  it('runs a full backup at hour 2 and still runs cleanup', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T02:00:00'));
    mockGetClient.mockReturnValue(
      makeSelectAllBuilder({
        documents: { data: [], error: null },
        document_chunks: { data: [], error: null },
        query_logs: { data: [], error: null },
        audit_logs: { data: [], error: null },
      }),
    );
    mockWriteFile.mockResolvedValue(undefined);
    mockReaddir.mockResolvedValue([]);

    const result = await runScheduledBackups();

    expect(result.full?.success).toBe(true);
    expect(result.incremental).toBeNull();
    vi.useRealTimers();
  });

  it('runs an incremental backup at hour 6 (not hour 2)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T06:00:00'));
    mockGetClient.mockReturnValue(
      makeGtBuilder({
        documents: { data: [], error: null },
        document_chunks: { data: [], error: null },
        query_logs: { data: [], error: null },
        audit_logs: { data: [], error: null },
      }),
    );
    mockReaddir.mockResolvedValue([]);

    const result = await runScheduledBackups();

    expect(result.full).toBeNull();
    expect(result.incremental?.success).toBe(true);
    vi.useRealTimers();
  });
});
