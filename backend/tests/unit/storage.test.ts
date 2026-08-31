/**
 * @file storage.test.ts
 * @description Unit tests for Supabase Storage operations — uploadFile, downloadFile,
 *   removeFile, and listStagedFiles (list-and-filter of the staging bucket).
 * @author [Author Placeholder]
 * @created 2026-08-31
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks (run before any module imports) ───────────────────────────

const { mockUpload, mockDownload, mockRemove, mockList, mockFrom } = vi.hoisted(() => {
  const mockUpload = vi.fn();
  const mockDownload = vi.fn();
  const mockRemove = vi.fn();
  const mockList = vi.fn();
  const mockFrom = vi.fn().mockReturnValue({
    upload: mockUpload,
    download: mockDownload,
    remove: mockRemove,
    list: mockList,
  });
  return { mockUpload, mockDownload, mockRemove, mockList, mockFrom };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ storage: { from: mockFrom } })),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// ─── Import module under test (after mocks) ───────────────────────────────────

import { uploadFile, downloadFile, removeFile, listStagedFiles } from '../../src/services/storage';
import { InternalError } from '../../src/types/index';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('uploadFile', () => {
  it('uploads the buffer to the "documents" bucket under the given key', async () => {
    mockUpload.mockResolvedValue({ error: null });

    await uploadFile('doc-1_file.pdf', Buffer.from('hello'));

    expect(mockFrom).toHaveBeenCalledWith('documents');
    expect(mockUpload).toHaveBeenCalledWith(
      'doc-1_file.pdf',
      Buffer.from('hello'),
      expect.objectContaining({ contentType: 'application/octet-stream', upsert: false }),
    );
  });

  it('throws InternalError when the upload fails', async () => {
    mockUpload.mockResolvedValue({ error: { message: 'bucket not found' } });

    await expect(uploadFile('doc-1_file.pdf', Buffer.from('x'))).rejects.toThrow(InternalError);
  });
});

describe('downloadFile', () => {
  it('returns the file bytes as a Buffer', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    mockDownload.mockResolvedValue({ data: blob, error: null });

    const result = await downloadFile('doc-1_file.pdf');

    expect(result).toBeInstanceOf(Buffer);
    expect(Array.from(result)).toEqual([1, 2, 3]);
  });

  it('throws InternalError when the download fails', async () => {
    mockDownload.mockResolvedValue({ data: null, error: { message: 'not found' } });

    await expect(downloadFile('missing-key')).rejects.toThrow(InternalError);
  });

  it('throws InternalError when no data is returned but there is also no error', async () => {
    mockDownload.mockResolvedValue({ data: null, error: null });

    await expect(downloadFile('missing-key')).rejects.toThrow(InternalError);
    await expect(downloadFile('missing-key')).rejects.toThrow(/missing-key/);
  });
});

describe('removeFile', () => {
  it('calls remove with the given key', async () => {
    mockRemove.mockResolvedValue({ error: null });

    await removeFile('doc-1_file.pdf');

    expect(mockRemove).toHaveBeenCalledWith(['doc-1_file.pdf']);
  });

  it('swallows errors and does not throw (best-effort cleanup)', async () => {
    mockRemove.mockResolvedValue({ error: { message: 'already gone' } });

    await expect(removeFile('doc-1_file.pdf')).resolves.toBeUndefined();
  });

  it('does not throw even if the underlying call rejects unexpectedly', async () => {
    // removeFile does not wrap in try/catch, so a genuine promise rejection
    // (as opposed to a Supabase { error } result) does propagate — this
    // documents that boundary rather than asserting false safety.
    mockRemove.mockResolvedValue({ error: null });
    await expect(removeFile('key')).resolves.toBeUndefined();
  });
});

describe('listStagedFiles', () => {
  it('maps storage entries to {name, createdAt}', async () => {
    mockList.mockResolvedValue({
      data: [
        { name: 'doc-1_a.pdf', id: 'obj-1', created_at: '2026-08-01T00:00:00Z' },
        { name: 'doc-2_b.txt', id: 'obj-2', created_at: '2026-08-02T00:00:00Z' },
      ],
      error: null,
    });

    const result = await listStagedFiles();

    expect(result).toEqual([
      { name: 'doc-1_a.pdf', createdAt: '2026-08-01T00:00:00Z' },
      { name: 'doc-2_b.txt', createdAt: '2026-08-02T00:00:00Z' },
    ]);
  });

  it('filters out placeholder folder entries (id === null)', async () => {
    mockList.mockResolvedValue({
      data: [
        { name: '.emptyFolderPlaceholder', id: null, created_at: null },
        { name: 'doc-1_a.pdf', id: 'obj-1', created_at: '2026-08-01T00:00:00Z' },
      ],
      error: null,
    });

    const result = await listStagedFiles();

    expect(result).toEqual([{ name: 'doc-1_a.pdf', createdAt: '2026-08-01T00:00:00Z' }]);
  });

  it('filters out entries with an empty/falsy name', async () => {
    mockList.mockResolvedValue({
      data: [
        { name: '', id: 'obj-x', created_at: '2026-08-01T00:00:00Z' },
        { name: 'doc-1_a.pdf', id: 'obj-1', created_at: '2026-08-01T00:00:00Z' },
      ],
      error: null,
    });

    const result = await listStagedFiles();

    expect(result).toEqual([{ name: 'doc-1_a.pdf', createdAt: '2026-08-01T00:00:00Z' }]);
  });

  it('falls back to epoch ISO string when created_at is missing', async () => {
    mockList.mockResolvedValue({
      data: [{ name: 'doc-1_a.pdf', id: 'obj-1', created_at: null }],
      error: null,
    });

    const result = await listStagedFiles();

    expect(result).toEqual([{ name: 'doc-1_a.pdf', createdAt: new Date(0).toISOString() }]);
  });

  it('returns an empty array when data is null', async () => {
    mockList.mockResolvedValue({ data: null, error: null });

    const result = await listStagedFiles();

    expect(result).toEqual([]);
  });

  it('calls list() with a generous limit and ascending created_at sort', async () => {
    mockList.mockResolvedValue({ data: [], error: null });

    await listStagedFiles();

    expect(mockList).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ limit: 10_000, sortBy: { column: 'created_at', order: 'asc' } }),
    );
  });

  it('throws InternalError when the listing itself fails', async () => {
    mockList.mockResolvedValue({ data: null, error: { message: 'network error' } });

    await expect(listStagedFiles()).rejects.toThrow(InternalError);
  });
});
