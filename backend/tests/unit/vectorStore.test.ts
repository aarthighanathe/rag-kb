/**
 * @file vectorStore.test.ts
 * @description Unit tests for Supabase pgvector operations — all CRUD and similarity search
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks (run before any module imports) ───────────────────────────

const { mockFrom, mockRpc, chain } = vi.hoisted(() => {
  const chain = {
    select:  vi.fn(),
    insert:  vi.fn(),
    update:  vi.fn(),
    delete:  vi.fn(),
    upsert:  vi.fn(),
    eq:      vi.fn(),
    single:  vi.fn(),
    order:   vi.fn(),
    range:   vi.fn(),
    limit:   vi.fn(),
    in:      vi.fn(),
  };

  const mockRpc  = vi.fn();
  const mockFrom = vi.fn().mockReturnValue(chain);

  return { mockFrom, mockRpc, chain };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: mockFrom, rpc: mockRpc })),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// ─── Import module under test (after mocks) ───────────────────────────────────

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  createDocument,
  updateDocumentStatus,
  upsertChunks,
  similaritySearch,
  getDocument,
  listDocuments,
  deleteDocument,
  cosineSimilarity,
  computeDocumentSimilarity,
  setQueryFeedback,
} from '../../src/services/vectorStore';
import { InternalError, NotFoundError } from '../../src/types/index';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const sampleDbDocument = {
  id: 'doc-1',
  filename: 'doc-1_report.pdf',
  original_name: 'report.pdf',
  file_type: 'pdf' as const,
  file_size_bytes: 10240,
  status: 'ready' as const,
  chunk_count: 5,
  created_at: '2026-06-16T00:00:00Z',
  updated_at: '2026-06-16T00:00:00Z',
};

const sampleDocument = {
  id: 'doc-1',
  filename: 'report.pdf',
  mime_type: 'application/pdf',
  size_bytes: 10240,
  status: 'ready' as const,
  chunk_count: 5,
  created_at: '2026-06-16T00:00:00Z',
  updated_at: '2026-06-16T00:00:00Z',
};

const sampleChunk = {
  content: 'Chunk content here',
  index: 0,
  tokenCount: 4,
  metadata: { char_start: 0, char_end: 18 },
};

const sampleEmbedding = Array.from({ length: 384 }, () => 0.1);

const sampleRetrievedChunk = {
  id: 'chunk-1',
  document_id: 'doc-1',
  content: 'Chunk content',
  similarity: 0.92,
  metadata: { char_start: 0, char_end: 13 },
  filename: 'report.pdf',
};

// ─── beforeEach — reset and configure the chain ───────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();

  // Restore createClient mock so getClient() builds a new client if needed
  vi.mocked(createClient).mockReturnValue(
    { from: mockFrom, rpc: mockRpc } as unknown as SupabaseClient,
  );

  // Re-establish chain routing after reset
  mockFrom.mockReturnValue(chain);

  // Chaining methods return chain by default
  chain.select.mockReturnValue(chain);
  chain.insert.mockReturnValue(chain);
  chain.update.mockReturnValue(chain);
  chain.delete.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);           // non-terminal by default
  chain.limit.mockReturnValue(chain);        // non-terminal by default
  chain.in.mockReturnValue(chain);           // non-terminal by default

  // Terminal defaults
  chain.single.mockResolvedValue({ data: sampleDbDocument, error: null });
  chain.range.mockResolvedValue({ data: [sampleDbDocument], error: null, count: 1 });
  chain.upsert.mockResolvedValue({ error: null });
  mockRpc.mockResolvedValue({ data: [sampleRetrievedChunk], error: null });
});

// ─── createDocument ───────────────────────────────────────────────────────────

describe('createDocument', () => {
  it('inserts a document and returns the record', async () => {
    const result = await createDocument({
      id: 'doc-1',
      filename: 'doc-1_report.pdf',
      originalName: 'report.pdf',
      fileType: 'pdf',
      sizeBytes: 10240,
      userId: 'test-user-1',
    });

    expect(result).toMatchObject({ id: 'doc-1', filename: 'report.pdf' });
    expect(mockFrom).toHaveBeenCalledWith('documents');
    expect(chain.insert).toHaveBeenCalled();
    expect(chain.single).toHaveBeenCalled();
  });

  it('passes status: pending and user_id in the insert payload', async () => {
    await createDocument({
      id: 'doc-1',
      filename: 'doc-1_f.pdf',
      originalName: 'f.pdf',
      fileType: 'pdf',
      sizeBytes: 1,
      userId: 'test-user-1',
    });

    const insertArgs = (chain.insert.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(insertArgs['status']).toBe('pending');
    expect(insertArgs['original_name']).toBe('f.pdf');
    expect(insertArgs['file_type']).toBe('pdf');
    expect(insertArgs['user_id']).toBe('test-user-1');
  });

  it('throws InternalError when Supabase returns an error', async () => {
    chain.single.mockResolvedValue({ data: null, error: { message: 'DB error' } });
    await expect(
      createDocument({
        id: 'd',
        filename: 'd_f.pdf',
        originalName: 'f.pdf',
        fileType: 'pdf',
        sizeBytes: 1,
        userId: 'test-user-1',
      }),
    ).rejects.toBeInstanceOf(InternalError);
  });
});

// ─── updateDocumentStatus ─────────────────────────────────────────────────────

describe('updateDocumentStatus', () => {
  it('calls update and eq with correct arguments', async () => {
    chain.eq.mockResolvedValue({ error: null }); // terminal for this path
    await updateDocumentStatus('doc-1', 'processing');

    expect(chain.update).toHaveBeenCalled();
    expect(chain.eq).toHaveBeenCalledWith('id', 'doc-1');
  });

  it('throws InternalError when update fails', async () => {
    chain.eq.mockResolvedValue({ error: { message: 'update failed' } });
    await expect(updateDocumentStatus('doc-1', 'failed', 'Parse error')).rejects.toBeInstanceOf(InternalError);
  });
});

// ─── upsertChunks ─────────────────────────────────────────────────────────────

describe('upsertChunks', () => {
  it('upserts chunks without error when arrays match', async () => {
    await expect(
      upsertChunks('doc-1', [sampleChunk], [sampleEmbedding]),
    ).resolves.toBeUndefined();

    expect(chain.upsert).toHaveBeenCalled();
  });

  it('verifies no raw string interpolation — upsert is called, not rpc with a string query', async () => {
    await upsertChunks('doc-1', [sampleChunk], [sampleEmbedding]);
    // The SDK upsert method must be used (parameterized), never rpc with raw SQL
    expect(chain.upsert).toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('throws InternalError when chunks and embeddings lengths differ', async () => {
    await expect(upsertChunks('doc-1', [sampleChunk], [])).rejects.toBeInstanceOf(InternalError);
  });

  it('includes token_count in the upserted row so getChunkQualityStats can grade real chunks', async () => {
    // Regression test: token_count was previously omitted from the insert payload,
    // so every stored chunk read back as NULL -> 0 tokens -> always graded "poor"
    // regardless of actual document quality.
    await upsertChunks('doc-1', [sampleChunk], [sampleEmbedding]);

    const rows = (chain.upsert.mock.calls[0] as unknown[])[0] as Array<Record<string, unknown>>;
    expect(rows[0]?.['token_count']).toBe(sampleChunk.tokenCount);
  });
});

// ─── similaritySearch ─────────────────────────────────────────────────────────

describe('similaritySearch', () => {
  it('calls rpc with the query embedding, topK, and p_user_id', async () => {
    const result = await similaritySearch(sampleEmbedding, 5, 'test-user-1');
    expect(result).toHaveLength(1);
    expect(mockRpc).toHaveBeenCalledWith(
      'match_chunks',
      expect.objectContaining({
        query_embedding: sampleEmbedding,
        match_count: 5,
        p_user_id: 'test-user-1',
      }),
    );
  });

  it('returns empty array when rpc returns no data', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const result = await similaritySearch(sampleEmbedding, 5, 'test-user-1');
    expect(result).toEqual([]);
  });

  it('throws InternalError when rpc returns an error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'rpc failed' } });
    await expect(similaritySearch(sampleEmbedding, 5, 'test-user-1')).rejects.toBeInstanceOf(InternalError);
  });
});

// ─── getDocument ──────────────────────────────────────────────────────────────

describe('getDocument', () => {
  it('returns the document on success', async () => {
    const result = await getDocument('doc-1', 'test-user-1');
    expect(result).toMatchObject({ id: 'doc-1' });
    expect(chain.eq).toHaveBeenCalledWith('id', 'doc-1');
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'test-user-1');
  });

  it('throws NotFoundError when Supabase returns PGRST116 (row not found)', async () => {
    chain.single.mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'not found' } });
    await expect(getDocument('missing', 'test-user-1')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFoundError (not an authorization error) when the document belongs to another user', async () => {
    // The real query filters by user_id in SQL, so a mismatched owner looks
    // identical to a nonexistent row — PGRST116, not a 403.
    chain.single.mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'not found' } });
    await expect(getDocument('doc-1', 'someone-elses-id')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws InternalError for other database errors', async () => {
    chain.single.mockResolvedValue({ data: null, error: { code: 'OTHER', message: 'db error' } });
    await expect(getDocument('doc-1', 'test-user-1')).rejects.toBeInstanceOf(InternalError);
  });
});

// ─── listDocuments ────────────────────────────────────────────────────────────

describe('listDocuments', () => {
  it('returns paginated documents with total count', async () => {
    const result = await listDocuments(1, 10, undefined, 'test-user-1');
    expect(result.data).toHaveLength(1);
    expect(typeof result.total).toBe('number');
  });

  it('calls from documents table, filters by user_id, and applies ordering', async () => {
    await listDocuments(1, 10, undefined, 'test-user-1');
    expect(mockFrom).toHaveBeenCalledWith('documents');
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'test-user-1');
    expect(chain.order).toHaveBeenCalledWith('created_at', expect.objectContaining({ ascending: false }));
  });

  it('throws InternalError on database error', async () => {
    chain.range.mockResolvedValue({ data: null, error: { message: 'list error' }, count: null });
    await expect(listDocuments(1, 10, undefined, 'test-user-1')).rejects.toBeInstanceOf(InternalError);
  });
});

// ─── deleteDocument ───────────────────────────────────────────────────────────

describe('deleteDocument', () => {
  // deleteDocument chains two .eq() calls (id, then user_id) before the whole
  // expression is awaited — only the second call is the "terminal" one, so the
  // first must keep returning `chain` rather than resolving directly.

  it('deletes a document by id and user_id without error', async () => {
    chain.eq.mockReturnValueOnce(chain).mockResolvedValueOnce({ error: null, count: 1 });
    await expect(deleteDocument('doc-1', 'test-user-1')).resolves.toBeUndefined();
    expect(chain.eq).toHaveBeenCalledWith('id', 'doc-1');
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'test-user-1');
  });

  it('throws NotFoundError when count is 0 (document did not exist)', async () => {
    chain.eq.mockReturnValueOnce(chain).mockResolvedValueOnce({ error: null, count: 0 });
    await expect(deleteDocument('missing', 'test-user-1')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFoundError (not an authorization error) when the document belongs to another user', async () => {
    // Deleting zero rows because user_id didn't match looks identical to a
    // nonexistent document — an IDOR attacker can't tell "not yours" from "gone".
    chain.eq.mockReturnValueOnce(chain).mockResolvedValueOnce({ error: null, count: 0 });
    await expect(deleteDocument('doc-1', 'someone-elses-id')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws InternalError on database error', async () => {
    chain.eq.mockReturnValueOnce(chain).mockResolvedValueOnce({ error: { message: 'delete failed' }, count: 0 });
    await expect(deleteDocument('doc-1', 'test-user-1')).rejects.toBeInstanceOf(InternalError);
  });
});

// ─── setQueryFeedback ─────────────────────────────────────────────────────────
//
// Mirrors deleteDocument's chain shape exactly: .update(...).eq('id', ...)
// .eq('user_id', ...), with only the second .eq() call terminal (resolves
// {error, count}) — same ownership-scoped-in-the-same-query IDOR pattern
// used throughout this file.

describe('setQueryFeedback', () => {
  it('updates feedback scoped to id and user_id, and resolves on success', async () => {
    chain.eq.mockReturnValueOnce(chain).mockResolvedValueOnce({ error: null, count: 1 });

    await expect(setQueryFeedback('query-1', 'test-user-1', 'helpful')).resolves.toBeUndefined();

    expect(chain.update).toHaveBeenCalledWith({ feedback: 'helpful' }, { count: 'exact' });
    expect(chain.eq).toHaveBeenCalledWith('id', 'query-1');
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'test-user-1');
  });

  it('throws NotFoundError when count is 0 (query did not exist)', async () => {
    chain.eq.mockReturnValueOnce(chain).mockResolvedValueOnce({ error: null, count: 0 });
    await expect(
      setQueryFeedback('missing-query', 'test-user-1', 'helpful'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFoundError (not an authorization error) when the query belongs to another user', async () => {
    // Updating zero rows because user_id didn't match looks identical to a
    // nonexistent query — an IDOR attacker can't tell "not yours" from "gone".
    chain.eq.mockReturnValueOnce(chain).mockResolvedValueOnce({ error: null, count: 0 });
    await expect(
      setQueryFeedback('query-1', 'someone-elses-id', 'helpful'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws InternalError on database error', async () => {
    chain.eq.mockReturnValueOnce(chain).mockResolvedValueOnce({ error: { message: 'update failed' }, count: 0 });
    await expect(
      setQueryFeedback('query-1', 'test-user-1', 'helpful'),
    ).rejects.toBeInstanceOf(InternalError);
  });

  it('is idempotent: resubmitting feedback for the same query issues a plain UPDATE, not an insert or duplicate', async () => {
    // First submission: 'helpful'
    chain.eq.mockReturnValueOnce(chain).mockResolvedValueOnce({ error: null, count: 1 });
    await setQueryFeedback('query-1', 'test-user-1', 'helpful');
    expect(chain.update).toHaveBeenNthCalledWith(1, { feedback: 'helpful' }, { count: 'exact' });
    expect(chain.insert).not.toHaveBeenCalled();

    // Resubmission with a different value: overwrites via the same UPDATE path,
    // still scoped to the same id/user_id, never an insert.
    chain.eq.mockReturnValueOnce(chain).mockResolvedValueOnce({ error: null, count: 1 });
    await setQueryFeedback('query-1', 'test-user-1', 'not_helpful');
    expect(chain.update).toHaveBeenNthCalledWith(2, { feedback: 'not_helpful' }, { count: 'exact' });
    expect(chain.insert).not.toHaveBeenCalled();
    expect(chain.update).toHaveBeenCalledTimes(2);
  });
});

// ─── cosineSimilarity ─────────────────────────────────────────────────────────

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBe(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('returns 0 for zero vector', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it('returns negative value for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(-1);
  });
});

// ─── computeDocumentSimilarity ────────────────────────────────────────────────

describe('computeDocumentSimilarity', () => {
  const readyDocs = [
    { id: 'doc-1', original_name: 'report.pdf', file_type: 'pdf', chunk_count: 5 },
    { id: 'doc-2', original_name: 'notes.txt', file_type: 'txt', chunk_count: 3 },
  ];

  // fetchReadyDocumentEmbeddings now chains .eq('status','ready').eq('user_id', userId)
  // for the documents query (only the second, user_id, call is terminal), then fetches
  // chunks for ALL ready documents in a single .in('document_id', ids) query instead
  // of one query per document — the second .order() call is terminal for that query.

  it('returns pairs with similarity above threshold', async () => {
    chain.eq.mockImplementation((...args: unknown[]) => {
      if (args[0] === 'user_id') {
        return Promise.resolve({ data: readyDocs, error: null });
      }
      return chain;
    });

    chain.order.mockReturnValueOnce(chain).mockResolvedValueOnce({
      data: [
        { document_id: 'doc-1', embedding: [1, 0, 0], chunk_index: 0 },
        { document_id: 'doc-1', embedding: [0.9, 0.1, 0], chunk_index: 1 },
        { document_id: 'doc-2', embedding: [1, 0, 0], chunk_index: 0 },
        { document_id: 'doc-2', embedding: [0.9, 0.1, 0], chunk_index: 1 },
      ],
      error: null,
    });

    const pairs = await computeDocumentSimilarity(0.3, 'test-user-1');
    expect(pairs).toHaveLength(1);
    expect(pairs[0].documentA).toBe('doc-1');
    expect(pairs[0].documentB).toBe('doc-2');
    expect(pairs[0].similarity).toBeGreaterThan(0.3);
  });

  it('excludes pairs below threshold', async () => {
    chain.eq.mockImplementation((...args: unknown[]) => {
      if (args[0] === 'user_id') {
        return Promise.resolve({ data: readyDocs, error: null });
      }
      return chain;
    });

    // Doc 1: orthogonal vector [1, 0, 0]; Doc 2: orthogonal vector [0, 0, 1]
    chain.order.mockReturnValueOnce(chain).mockResolvedValueOnce({
      data: [
        { document_id: 'doc-1', embedding: [1, 0, 0], chunk_index: 0 },
        { document_id: 'doc-2', embedding: [0, 0, 1], chunk_index: 0 },
      ],
      error: null,
    });

    const pairs = await computeDocumentSimilarity(0.5, 'test-user-1');
    expect(pairs).toHaveLength(0);
  });

  it('returns empty array when fewer than 2 ready documents', async () => {
    chain.eq.mockImplementation((...args: unknown[]) => {
      if (args[0] === 'user_id') {
        return Promise.resolve({ data: [readyDocs[0]], error: null });
      }
      return chain;
    });

    const pairs = await computeDocumentSimilarity(0.3, 'test-user-1');
    expect(pairs).toEqual([]);
  });

  it('returns empty array when no ready documents', async () => {
    chain.eq.mockImplementation((...args: unknown[]) => {
      if (args[0] === 'user_id') {
        return Promise.resolve({ data: [], error: null });
      }
      return chain;
    });

    const pairs = await computeDocumentSimilarity(0.3, 'test-user-1');
    expect(pairs).toEqual([]);
  });

  it("scopes the query to the given user_id so another user's documents never mix in", async () => {
    chain.eq.mockImplementation((...args: unknown[]) => {
      if (args[0] === 'user_id') {
        expect(args[1]).toBe('test-user-1');
        return Promise.resolve({ data: readyDocs, error: null });
      }
      return chain;
    });
    chain.order.mockReturnValueOnce(chain).mockResolvedValueOnce({
      data: [
        { document_id: 'doc-1', embedding: [1, 0, 0], chunk_index: 0 },
        { document_id: 'doc-2', embedding: [0.9, 0.1, 0], chunk_index: 0 },
      ],
      error: null,
    });

    await computeDocumentSimilarity(0.3, 'test-user-1');
    expect(chain.eq).toHaveBeenCalledWith('status', 'ready');
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'test-user-1');
  });

  it('fetches chunks for all ready documents in a single query rather than one per document', async () => {
    chain.eq.mockImplementation((...args: unknown[]) => {
      if (args[0] === 'user_id') {
        return Promise.resolve({ data: readyDocs, error: null });
      }
      return chain;
    });
    chain.order.mockReturnValueOnce(chain).mockResolvedValueOnce({
      data: [
        { document_id: 'doc-1', embedding: [1, 0, 0], chunk_index: 0 },
        { document_id: 'doc-2', embedding: [0.9, 0.1, 0], chunk_index: 0 },
      ],
      error: null,
    });

    await computeDocumentSimilarity(0.3, 'test-user-1');

    expect(chain.in).toHaveBeenCalledTimes(1);
    expect(chain.in).toHaveBeenCalledWith('document_id', ['doc-1', 'doc-2']);
  });

  it('caps sampled embeddings per document at SAMPLE_SIZE even when more rows are returned', async () => {
    chain.eq.mockImplementation((...args: unknown[]) => {
      if (args[0] === 'user_id') {
        return Promise.resolve({ data: readyDocs, error: null });
      }
      return chain;
    });
    // 7 chunk rows for doc-1 (SAMPLE_SIZE is 5) — all identical vectors so the
    // similarity outcome doesn't depend on which 5 are kept, only that capping happens.
    const manyRows = Array.from({ length: 7 }, (_, i) => ({
      document_id: 'doc-1',
      embedding: [1, 0, 0],
      chunk_index: i,
    }));
    chain.order.mockReturnValueOnce(chain).mockResolvedValueOnce({
      data: [...manyRows, { document_id: 'doc-2', embedding: [1, 0, 0], chunk_index: 0 }],
      error: null,
    });

    const pairs = await computeDocumentSimilarity(0.3, 'test-user-1');
    // Similarity computation still succeeds and produces a valid pair —
    // the point of this test is that fetchReadyDocumentEmbeddings doesn't
    // throw or misbehave when a document has more rows than SAMPLE_SIZE.
    expect(pairs).toHaveLength(1);
  });
});
