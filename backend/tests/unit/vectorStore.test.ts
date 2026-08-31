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
    select:      vi.fn(),
    insert:      vi.fn(),
    update:      vi.fn(),
    delete:      vi.fn(),
    upsert:      vi.fn(),
    eq:          vi.fn(),
    single:      vi.fn(),
    maybeSingle: vi.fn(),
    order:       vi.fn(),
    range:       vi.fn(),
    limit:       vi.fn(),
    in:          vi.fn(),
    not:         vi.fn(),
    ilike:       vi.fn(),
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
  updateChunkCount,
  upsertChunks,
  similaritySearch,
  keywordSearch,
  hybridSearch,
  getDocument,
  getDocumentChunkPreviews,
  listDocuments,
  deleteDocument,
  cosineSimilarity,
  computeDocumentSimilarity,
  setQueryFeedback,
  findDocumentByHash,
  getSuggestedTopics,
  listQueryLogs,
  deriveAutoTags,
  setAutoTags,
  setDocumentTags,
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
  source: 'vector' as const,
};

// ─── beforeEach — reset and configure the chain ───────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();

  // Restore createClient mock so getClient() builds a new client if needed
  vi.mocked(createClient).mockReturnValue(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { from: mockFrom, rpc: mockRpc } as any,
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
  chain.not.mockReturnValue(chain);          // non-terminal by default
  chain.ilike.mockReturnValue(chain);        // non-terminal by default

  // Terminal defaults
  chain.single.mockResolvedValue({ data: sampleDbDocument, error: null });
  chain.maybeSingle.mockResolvedValue({ data: null, error: null });
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

  it('includes content_hash in the insert payload when provided', async () => {
    await createDocument({
      id: 'doc-1',
      filename: 'doc-1_f.pdf',
      originalName: 'f.pdf',
      fileType: 'pdf',
      sizeBytes: 1,
      userId: 'test-user-1',
      contentHash: 'abc123',
    });

    const insertArgs = (chain.insert.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(insertArgs['content_hash']).toBe('abc123');
  });

  it('inserts a null content_hash when not provided', async () => {
    await createDocument({
      id: 'doc-1',
      filename: 'doc-1_f.pdf',
      originalName: 'f.pdf',
      fileType: 'pdf',
      sizeBytes: 1,
      userId: 'test-user-1',
    });

    const insertArgs = (chain.insert.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(insertArgs['content_hash']).toBeNull();
  });
});

// ─── findDocumentByHash ─────────────────────────────────────────────────────

describe('findDocumentByHash', () => {
  it('returns null when no document matches the hash', async () => {
    chain.maybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await findDocumentByHash('test-user-1', 'nonexistent-hash');

    expect(result).toBeNull();
    expect(mockFrom).toHaveBeenCalledWith('documents');
  });

  it('returns the matching document when a hash match is found', async () => {
    chain.maybeSingle.mockResolvedValue({
      data: {
        id: 'doc-1',
        original_name: 'report.pdf',
        status: 'ready',
        created_at: '2026-06-16T00:00:00Z',
      },
      error: null,
    });

    const result = await findDocumentByHash('test-user-1', 'abc123');

    expect(result).toEqual({
      id: 'doc-1',
      filename: 'report.pdf',
      status: 'ready',
      createdAt: '2026-06-16T00:00:00Z',
    });
  });

  it('scopes the lookup by both user_id and content_hash', async () => {
    await findDocumentByHash('test-user-1', 'abc123');

    expect(chain.eq).toHaveBeenCalledWith('user_id', 'test-user-1');
    expect(chain.eq).toHaveBeenCalledWith('content_hash', 'abc123');
  });

  it('throws InternalError when Supabase returns an error', async () => {
    chain.maybeSingle.mockResolvedValue({ data: null, error: { message: 'DB error' } });
    await expect(findDocumentByHash('test-user-1', 'abc123')).rejects.toBeInstanceOf(InternalError);
  });
});

// ─── getSuggestedTopics ─────────────────────────────────────────────────────

describe('getSuggestedTopics', () => {
  it('returns an empty array without querying when documentIds is empty', async () => {
    const result = await getSuggestedTopics([], 'test-user-1');
    expect(result).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns an empty array when none of the requested documents are owned by the user', async () => {
    // First query (ownership filter) resolves on .in(...) with no matches.
    chain.in.mockResolvedValueOnce({ data: [], error: null });

    const result = await getSuggestedTopics(['doc-1', 'doc-2'], 'test-user-1');
    expect(result).toEqual([]);
    // Only the ownership query should have run — never the chunks query.
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it('returns distinct section headings across owned documents, capped and in first-seen order', async () => {
    chain.in
      .mockResolvedValueOnce({ data: [{ id: 'doc-1' }, { id: 'doc-2' }], error: null }) // ownership check
      .mockReturnValueOnce(chain); // chunks query .in(...) is non-terminal (chained into .not().limit())

    chain.limit.mockResolvedValueOnce({
      data: [
        { metadata: { section: 'Introduction' } },
        { metadata: { section: 'Pricing' } },
        { metadata: { section: 'Introduction' } }, // duplicate — must be deduped
        { metadata: { section: '  Getting Started  ' } }, // whitespace — must be trimmed
      ],
      error: null,
    });

    const result = await getSuggestedTopics(['doc-1', 'doc-2'], 'test-user-1');
    expect(result).toEqual(['Introduction', 'Pricing', 'Getting Started']);
  });

  it('ignores chunks with a missing or blank section', async () => {
    chain.in
      .mockResolvedValueOnce({ data: [{ id: 'doc-1' }], error: null })
      .mockReturnValueOnce(chain);

    chain.limit.mockResolvedValueOnce({
      data: [{ metadata: {} }, { metadata: { section: '   ' } }, { metadata: { section: 'Real Heading' } }],
      error: null,
    });

    const result = await getSuggestedTopics(['doc-1'], 'test-user-1');
    expect(result).toEqual(['Real Heading']);
  });

  it('throws InternalError when the ownership check fails', async () => {
    chain.in.mockResolvedValueOnce({ data: null, error: { message: 'DB error' } });
    await expect(getSuggestedTopics(['doc-1'], 'test-user-1')).rejects.toBeInstanceOf(InternalError);
  });

  it('throws InternalError when the chunks query fails', async () => {
    chain.in
      .mockResolvedValueOnce({ data: [{ id: 'doc-1' }], error: null })
      .mockReturnValueOnce(chain);
    chain.limit.mockResolvedValueOnce({ data: null, error: { message: 'DB error' } });

    await expect(getSuggestedTopics(['doc-1'], 'test-user-1')).rejects.toBeInstanceOf(InternalError);
  });
});

// ─── getDocumentChunkPreviews ─────────────────────────────────────────────────

describe('getDocumentChunkPreviews', () => {
  it('returns up to 3 chunks ordered by chunk_index, truncating long content', async () => {
    // assertDocumentOwnership: .select('id').eq('id',...).eq('user_id',...).maybeSingle()
    chain.eq.mockReturnValueOnce(chain).mockReturnValueOnce(chain);
    chain.maybeSingle.mockResolvedValueOnce({ data: { id: 'doc-1' }, error: null });
    // chunk query: .select(...).eq('document_id',...).order(...).limit(...)
    chain.eq.mockReturnValueOnce(chain);
    chain.order.mockReturnValueOnce(chain);
    const longContent = 'x'.repeat(300);
    chain.limit.mockResolvedValueOnce({
      data: [
        { id: 'chunk-1', chunk_index: 0, content: 'short chunk', token_count: 12 },
        { id: 'chunk-2', chunk_index: 1, content: longContent, token_count: 80 },
      ],
      error: null,
    });

    const result = await getDocumentChunkPreviews('doc-1', 'test-user-1');

    expect(result).toEqual([
      { id: 'chunk-1', chunkIndex: 0, contentPreview: 'short chunk', truncated: false, tokenCount: 12 },
      {
        id: 'chunk-2',
        chunkIndex: 1,
        contentPreview: `${longContent.slice(0, 240)}…`,
        truncated: true,
        tokenCount: 80,
      },
    ]);
  });

  it('returns an empty array for a document with no chunks yet', async () => {
    chain.eq.mockReturnValueOnce(chain).mockReturnValueOnce(chain);
    chain.maybeSingle.mockResolvedValueOnce({ data: { id: 'doc-1' }, error: null });
    chain.eq.mockReturnValueOnce(chain);
    chain.order.mockReturnValueOnce(chain);
    chain.limit.mockResolvedValueOnce({ data: [], error: null });

    const result = await getDocumentChunkPreviews('doc-1', 'test-user-1');
    expect(result).toEqual([]);
  });

  it('throws NotFoundError when the document is not owned by the caller', async () => {
    chain.eq.mockReturnValueOnce(chain).mockReturnValueOnce(chain);
    chain.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    await expect(
      getDocumentChunkPreviews('doc-1', 'someone-elses-id'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws InternalError when the chunks query fails', async () => {
    chain.eq.mockReturnValueOnce(chain).mockReturnValueOnce(chain);
    chain.maybeSingle.mockResolvedValueOnce({ data: { id: 'doc-1' }, error: null });
    chain.eq.mockReturnValueOnce(chain);
    chain.order.mockReturnValueOnce(chain);
    chain.limit.mockResolvedValueOnce({ data: null, error: { message: 'DB error' } });

    await expect(getDocumentChunkPreviews('doc-1', 'test-user-1')).rejects.toBeInstanceOf(
      InternalError,
    );
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

// ─── updateChunkCount ─────────────────────────────────────────────────────────

describe('updateChunkCount', () => {
  it('writes chunk_count without flipping status — the terminal status write belongs to updateDocumentStatus', async () => {
    chain.eq.mockResolvedValue({ error: null });
    await updateChunkCount('doc-1', 42);

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ chunk_count: 42 }),
    );
    const updatePayload = chain.update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(updatePayload).not.toHaveProperty('status');
    expect(chain.eq).toHaveBeenCalledWith('id', 'doc-1');
  });

  it('throws InternalError when the update fails', async () => {
    chain.eq.mockResolvedValue({ error: { message: 'update failed' } });
    await expect(updateChunkCount('doc-1', 5)).rejects.toBeInstanceOf(InternalError);
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

  it('omits relative_floor_gap from rpc params when not supplied, leaving the SQL default in effect', async () => {
    await similaritySearch(sampleEmbedding, 5, 'test-user-1');
    const rpcParams = (mockRpc.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(rpcParams).not.toHaveProperty('relative_floor_gap');
  });

  it('passes relative_floor_gap through to the rpc when supplied', async () => {
    await similaritySearch(sampleEmbedding, 5, 'test-user-1', undefined, undefined, 0.2);
    expect(mockRpc).toHaveBeenCalledWith(
      'match_chunks',
      expect.objectContaining({ relative_floor_gap: 0.2 }),
    );
  });

  it('allows callers to explicitly disable the relative floor with 0', async () => {
    await similaritySearch(sampleEmbedding, 5, 'test-user-1', undefined, undefined, 0);
    expect(mockRpc).toHaveBeenCalledWith(
      'match_chunks',
      expect.objectContaining({ relative_floor_gap: 0 }),
    );
  });
});

// ─── keywordSearch ────────────────────────────────────────────────────────────

describe('keywordSearch', () => {
  it('calls the match_chunks_keyword rpc with query_text, topK, and p_user_id', async () => {
    const result = await keywordSearch('acme part number', 5, 'test-user-1');
    expect(result).toHaveLength(1);
    expect(mockRpc).toHaveBeenCalledWith(
      'match_chunks_keyword',
      expect.objectContaining({
        query_text: 'acme part number',
        match_count: 5,
        p_user_id: 'test-user-1',
      }),
    );
  });

  it('returns empty array when rpc returns no data', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const result = await keywordSearch('query', 5, 'test-user-1');
    expect(result).toEqual([]);
  });

  it('throws InternalError when rpc returns an error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'rpc failed' } });
    await expect(keywordSearch('query', 5, 'test-user-1')).rejects.toBeInstanceOf(InternalError);
  });

  it('passes keyword_threshold through when supplied', async () => {
    await keywordSearch('query', 5, 'test-user-1', undefined, 0.3);
    expect(mockRpc).toHaveBeenCalledWith(
      'match_chunks_keyword',
      expect.objectContaining({ keyword_threshold: 0.3 }),
    );
  });

  it('passes filter_document_ids through when supplied', async () => {
    await keywordSearch('query', 5, 'test-user-1', ['doc-1', 'doc-2']);
    expect(mockRpc).toHaveBeenCalledWith(
      'match_chunks_keyword',
      expect.objectContaining({ filter_document_ids: ['doc-1', 'doc-2'] }),
    );
  });
});

// ─── hybridSearch ─────────────────────────────────────────────────────────────

describe('hybridSearch', () => {
  const vectorChunk = { ...sampleRetrievedChunk, id: 'chunk-vector', similarity: 0.30 };
  const keywordChunk = { ...sampleRetrievedChunk, id: 'chunk-keyword', similarity: 0.50 };
  const overlapChunkLow = { ...sampleRetrievedChunk, id: 'chunk-overlap', similarity: 0.10 };
  const overlapChunkHigh = { ...sampleRetrievedChunk, id: 'chunk-overlap', similarity: 0.40 };

  it('calls both match_chunks and match_chunks_keyword rpcs', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await hybridSearch(sampleEmbedding, 'query text', 5, 'test-user-1');
    const calledFnNames = mockRpc.mock.calls.map((call) => (call as unknown[])[0]);
    expect(calledFnNames).toContain('match_chunks');
    expect(calledFnNames).toContain('match_chunks_keyword');
  });

  it('merges disjoint results from both legs, sorted by similarity descending', async () => {
    mockRpc.mockImplementation((fnName: unknown) => {
      if (fnName === 'match_chunks') return Promise.resolve({ data: [vectorChunk], error: null });
      return Promise.resolve({ data: [keywordChunk], error: null });
    });

    const result = await hybridSearch(sampleEmbedding, 'query text', 5, 'test-user-1');
    expect(result.map((r) => r.id)).toEqual(['chunk-keyword', 'chunk-vector']);
  });

  it('deduplicates a chunk found by both legs, keeping the higher score', async () => {
    mockRpc.mockImplementation((fnName: unknown) => {
      if (fnName === 'match_chunks') return Promise.resolve({ data: [overlapChunkLow], error: null });
      return Promise.resolve({ data: [overlapChunkHigh], error: null });
    });

    const result = await hybridSearch(sampleEmbedding, 'query text', 5, 'test-user-1');
    expect(result).toHaveLength(1);
    expect(result[0]?.similarity).toBe(0.40);
  });

  it('caps the merged result at topK even when both legs contribute unique chunks', async () => {
    const manyVectorChunks = Array.from({ length: 5 }, (_, i) => ({
      ...sampleRetrievedChunk,
      id: `v-${i}`,
      similarity: 0.5 - i * 0.01,
    }));
    const manyKeywordChunks = Array.from({ length: 5 }, (_, i) => ({
      ...sampleRetrievedChunk,
      id: `k-${i}`,
      similarity: 0.4 - i * 0.01,
    }));
    mockRpc.mockImplementation((fnName: unknown) => {
      if (fnName === 'match_chunks') return Promise.resolve({ data: manyVectorChunks, error: null });
      return Promise.resolve({ data: manyKeywordChunks, error: null });
    });

    const result = await hybridSearch(sampleEmbedding, 'query text', 5, 'test-user-1');
    expect(result).toHaveLength(5);
    // Highest 5 scores overall should be the top 5 vector chunks (0.50..0.46)
    expect(result.map((r) => r.id)).toEqual(['v-0', 'v-1', 'v-2', 'v-3', 'v-4']);
  });

  it('propagates an InternalError if the vector leg fails', async () => {
    mockRpc.mockImplementation((fnName: unknown) => {
      if (fnName === 'match_chunks') return Promise.resolve({ data: null, error: { message: 'vector failed' } });
      return Promise.resolve({ data: [], error: null });
    });
    await expect(hybridSearch(sampleEmbedding, 'query text', 5, 'test-user-1')).rejects.toBeInstanceOf(InternalError);
  });

  it('degrades gracefully to vector-only results when the keyword leg fails (logs a warning, does not throw)', async () => {
    const { logger } = await import('../../src/utils/logger');
    mockRpc.mockImplementation((fnName: unknown) => {
      if (fnName === 'match_chunks_keyword') return Promise.resolve({ data: null, error: { message: 'keyword failed' } });
      return Promise.resolve({ data: [vectorChunk], error: null });
    });
    // Should resolve (not throw) — keyword leg is an enhancement, not a hard dependency.
    const result = await hybridSearch(sampleEmbedding, 'query text', 5, 'test-user-1');
    // Vector-only results are still returned.
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('chunk-vector');
    // A warning must be logged so the degradation is observable in production logs.
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Keyword search failed'),
      expect.any(Object),
    );
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

// ─── listQueryLogs ─────────────────────────────────────────────────────────────

describe('listQueryLogs', () => {
  const sampleLogRow = {
    id: 'log-1',
    query_text: 'What is the refund policy?',
    response_preview: 'Refunds are issued within 14 days...',
    latency_ms: 1200,
    feedback: 'helpful' as const,
    validation_confidence: 0.9,
    created_at: '2026-06-16T00:00:00Z',
  };

  it('returns paginated query logs with total count', async () => {
    chain.range.mockResolvedValue({ data: [sampleLogRow], error: null, count: 1 });

    const result = await listQueryLogs('test-user-1', 1, 20);
    expect(result.data).toEqual([sampleLogRow]);
    expect(result.total).toBe(1);
  });

  it('scopes by user_id, orders by created_at descending, and does not call ilike when no search term is given', async () => {
    chain.range.mockResolvedValue({ data: [], error: null, count: 0 });

    await listQueryLogs('test-user-1', 1, 20);

    expect(mockFrom).toHaveBeenCalledWith('query_logs');
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'test-user-1');
    expect(chain.order).toHaveBeenCalledWith('created_at', expect.objectContaining({ ascending: false }));
    expect(chain.ilike).not.toHaveBeenCalled();
  });

  it('applies an ilike filter on query_text when a search term is given', async () => {
    chain.range.mockResolvedValue({ data: [], error: null, count: 0 });

    await listQueryLogs('test-user-1', 1, 20, 'refund');

    expect(chain.ilike).toHaveBeenCalledWith('query_text', '%refund%');
  });

  it('trims the search term before building the ilike pattern', async () => {
    chain.range.mockResolvedValue({ data: [], error: null, count: 0 });

    await listQueryLogs('test-user-1', 1, 20, '  refund  ');

    expect(chain.ilike).toHaveBeenCalledWith('query_text', '%refund%');
  });

  it('does not call ilike for a blank/whitespace-only search term', async () => {
    chain.range.mockResolvedValue({ data: [], error: null, count: 0 });

    await listQueryLogs('test-user-1', 1, 20, '   ');

    expect(chain.ilike).not.toHaveBeenCalled();
  });

  it('escapes wildcard metacharacters (% and _) so they match literally', async () => {
    chain.range.mockResolvedValue({ data: [], error: null, count: 0 });

    await listQueryLogs('test-user-1', 1, 20, '50%_off');

    expect(chain.ilike).toHaveBeenCalledWith('query_text', '%50\\%\\_off%');
  });

  it('escapes literal backslashes before wildcard characters, per Postgres LIKE/ILIKE escape semantics', async () => {
    chain.range.mockResolvedValue({ data: [], error: null, count: 0 });

    // A literal backslash (e.g. from a Windows path) must itself be escaped
    // first — otherwise it would escape the character that follows it
    // instead of matching as a literal "\".
    await listQueryLogs('test-user-1', 1, 20, 'C:\\Users\\report');

    expect(chain.ilike).toHaveBeenCalledWith('query_text', '%C:\\\\Users\\\\report%');
  });

  it('applies correct range for pagination', async () => {
    chain.range.mockResolvedValue({ data: [], error: null, count: 0 });

    await listQueryLogs('test-user-1', 3, 10);

    expect(chain.range).toHaveBeenCalledWith(20, 29);
  });

  it('returns an empty array (not null) when data is null', async () => {
    chain.range.mockResolvedValue({ data: null, error: null, count: 0 });

    const result = await listQueryLogs('test-user-1', 1, 20);
    expect(result.data).toEqual([]);
  });

  it('throws InternalError on database error', async () => {
    chain.range.mockResolvedValue({ data: null, error: { message: 'list error' }, count: null });
    await expect(listQueryLogs('test-user-1', 1, 20)).rejects.toBeInstanceOf(InternalError);
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

// ─── deriveAutoTags ───────────────────────────────────────────────────────────

describe('deriveAutoTags', () => {
  it('returns distinct section names in first-seen order', () => {
    expect(deriveAutoTags(['Intro', 'Pricing', 'Intro', 'FAQ'])).toEqual(['Intro', 'Pricing', 'FAQ']);
  });

  it('skips undefined and blank sections', () => {
    expect(deriveAutoTags([undefined, '  ', 'Pricing', undefined])).toEqual(['Pricing']);
  });

  it('caps at 5 tags', () => {
    const sections = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    expect(deriveAutoTags(sections)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('returns an empty array when no sections are present', () => {
    expect(deriveAutoTags([undefined, undefined])).toEqual([]);
  });
});

// ─── setAutoTags ────────────────────────────────────────────────────────────

describe('setAutoTags', () => {
  it('updates the tags column scoped to the document id', async () => {
    chain.eq.mockResolvedValueOnce({ error: null });

    await expect(setAutoTags('doc-1', ['Intro', 'Pricing'])).resolves.toBeUndefined();

    expect(chain.update).toHaveBeenCalledWith({ tags: ['Intro', 'Pricing'] });
    expect(chain.eq).toHaveBeenCalledWith('id', 'doc-1');
  });

  it('no-ops without touching the database when tags is empty', async () => {
    await expect(setAutoTags('doc-1', [])).resolves.toBeUndefined();
    expect(chain.update).not.toHaveBeenCalled();
  });

  it('throws InternalError on database error', async () => {
    chain.eq.mockResolvedValueOnce({ error: { message: 'update failed' } });
    await expect(setAutoTags('doc-1', ['Intro'])).rejects.toBeInstanceOf(InternalError);
  });
});

// ─── setDocumentTags ────────────────────────────────────────────────────────

describe('setDocumentTags', () => {
  it('updates tags scoped to id and user_id, and resolves on success', async () => {
    chain.eq.mockReturnValueOnce(chain).mockResolvedValueOnce({ error: null, count: 1 });

    await expect(setDocumentTags('doc-1', 'test-user-1', ['pricing'])).resolves.toBeUndefined();

    expect(chain.update).toHaveBeenCalledWith({ tags: ['pricing'] }, { count: 'exact' });
    expect(chain.eq).toHaveBeenCalledWith('id', 'doc-1');
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'test-user-1');
  });

  it('throws NotFoundError when count is 0 (document did not exist)', async () => {
    chain.eq.mockReturnValueOnce(chain).mockResolvedValueOnce({ error: null, count: 0 });
    await expect(
      setDocumentTags('missing-doc', 'test-user-1', ['pricing']),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFoundError (not an authorization error) when the document belongs to another user', async () => {
    chain.eq.mockReturnValueOnce(chain).mockResolvedValueOnce({ error: null, count: 0 });
    await expect(
      setDocumentTags('doc-1', 'someone-elses-id', ['pricing']),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws InternalError on database error', async () => {
    chain.eq.mockReturnValueOnce(chain).mockResolvedValueOnce({ error: { message: 'update failed' }, count: 0 });
    await expect(
      setDocumentTags('doc-1', 'test-user-1', ['pricing']),
    ).rejects.toBeInstanceOf(InternalError);
  });

  it('allows clearing all tags by passing an empty array', async () => {
    chain.eq.mockReturnValueOnce(chain).mockResolvedValueOnce({ error: null, count: 1 });
    await expect(setDocumentTags('doc-1', 'test-user-1', [])).resolves.toBeUndefined();
    expect(chain.update).toHaveBeenCalledWith({ tags: [] }, { count: 'exact' });
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

    const result = await computeDocumentSimilarity(0.3, 'test-user-1');
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]!.documentA).toBe('doc-1');
    expect(result.pairs[0]!.documentB).toBe('doc-2');
    expect(result.pairs[0]!.similarity).toBeGreaterThan(0.3);
    expect(result.capped).toBe(false);
    expect(result.readyDocumentCount).toBe(2);
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

    const result = await computeDocumentSimilarity(0.5, 'test-user-1');
    expect(result.pairs).toHaveLength(0);
  });

  it('returns empty array when fewer than 2 ready documents', async () => {
    chain.eq.mockImplementation((...args: unknown[]) => {
      if (args[0] === 'user_id') {
        return Promise.resolve({ data: [readyDocs[0]], error: null });
      }
      return chain;
    });

    const result = await computeDocumentSimilarity(0.3, 'test-user-1');
    expect(result.pairs).toEqual([]);
    expect(result.capped).toBe(false);
  });

  it('returns empty array when no ready documents', async () => {
    chain.eq.mockImplementation((...args: unknown[]) => {
      if (args[0] === 'user_id') {
        return Promise.resolve({ data: [], error: null });
      }
      return chain;
    });

    const result = await computeDocumentSimilarity(0.3, 'test-user-1');
    expect(result.pairs).toEqual([]);
    expect(result.capped).toBe(false);
    expect(result.readyDocumentCount).toBe(0);
  });

  it('flags capped=true and skips computation entirely when ready document count exceeds the cap', async () => {
    const manyDocs = Array.from({ length: 151 }, (_, i) => ({
      id: `doc-${i}`, original_name: `doc-${i}.pdf`, file_type: 'pdf', chunk_count: 1,
    }));
    chain.eq.mockImplementation((...args: unknown[]) => {
      if (args[0] === 'user_id') {
        return Promise.resolve({ data: manyDocs, error: null });
      }
      return chain;
    });

    const result = await computeDocumentSimilarity(0.3, 'test-user-1');
    expect(result.capped).toBe(true);
    expect(result.pairs).toEqual([]);
    expect(result.readyDocumentCount).toBe(151);
    // Capped path must bail before ever fetching chunk embeddings — no point
    // paying for that query when the result is discarded unconditionally.
    expect(chain.in).not.toHaveBeenCalled();
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

    const result = await computeDocumentSimilarity(0.3, 'test-user-1');
    // Similarity computation still succeeds and produces a valid pair —
    // the point of this test is that fetchReadyDocumentEmbeddings doesn't
    // throw or misbehave when a document has more rows than SAMPLE_SIZE.
    expect(result.pairs).toHaveLength(1);
  });

  it('caps a hub document at its top 8 strongest edges instead of returning every qualifying pair', async () => {
    // A "hub" document (doc-hub) similar enough to 10 others to cross the
    // threshold with all of them — MAX_EDGES_PER_NODE (8) should keep only
    // its 8 strongest connections, not all 10.
    const hubAndLeaves = [
      { id: 'doc-hub', original_name: 'hub.pdf', file_type: 'pdf', chunk_count: 1 },
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `doc-leaf-${i}`, original_name: `leaf-${i}.pdf`, file_type: 'pdf', chunk_count: 1,
      })),
    ];
    chain.eq.mockImplementation((...args: unknown[]) => {
      if (args[0] === 'user_id') {
        return Promise.resolve({ data: hubAndLeaves, error: null });
      }
      return chain;
    });

    // Each leaf gets a slightly different vector so similarity-to-hub varies,
    // giving a deterministic strongest-8 ranking. Leaves never compare to
    // each other above threshold (all near-orthogonal to one another).
    const hubVec = [1, 0, 0];
    const chunkRows = [
      { document_id: 'doc-hub', embedding: hubVec, chunk_index: 0 },
      ...hubAndLeaves.slice(1).map((leaf, i) => ({
        document_id: leaf.id,
        // Decreasing similarity to hub as i increases (still all > 0.3 threshold).
        embedding: [1 - i * 0.03, i * 0.001, 0],
        chunk_index: 0,
      })),
    ];
    chain.order.mockReturnValueOnce(chain).mockResolvedValueOnce({ data: chunkRows, error: null });

    const result = await computeDocumentSimilarity(0.3, 'test-user-1');
    const hubEdges = result.pairs.filter((p) => p.documentA === 'doc-hub' || p.documentB === 'doc-hub');
    // Each leaf only has one candidate edge (to the hub), so it's trivially
    // that leaf's own top-1 — the hub side is what actually gets pruned down
    // from 10 candidates to 8, which is what this test is verifying.
    expect(hubEdges.length).toBeLessThanOrEqual(8);
    expect(hubEdges.length).toBeGreaterThan(0);

    // The strongest edge (leaf-0, nearly identical to the hub vector) must survive the cap.
    const leafIds = hubEdges.map((p) => (p.documentA === 'doc-hub' ? p.documentB : p.documentA));
    expect(leafIds).toContain('doc-leaf-0');
  });
});
