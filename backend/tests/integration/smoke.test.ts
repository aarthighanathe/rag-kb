/**
 * @file smoke.test.ts
 * @description End-to-end smoke test — proves the complete happy path works with all
 *   external services mocked.  Runs sequentially:
 *   upload → process → query (SSE) → delete → verify gone.
 * @author [Author Placeholder]
 * @created 2026-06-17
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import type { Application } from 'express';
import type { RetrievedChunk } from '../../src/types/index.js';
import { collectSSEEvents, authedRequest } from './helpers.js';

// ─── Service mocks (hoisted before module import) ─────────────────────────────

const MOCK_DOC_ID = 'smoke-doc-uuid-1';
const MOCK_JOB_ID = 'smoke-job-uuid-1';
const MOCK_CHUNK_ID = 'smoke-chunk-uuid-1';

const mockDoc = {
  id: MOCK_DOC_ID,
  filename: 'smoke-test.txt',
  mime_type: 'text/plain',
  size_bytes: 100,
  status: 'pending' as const,
  chunk_count: 0,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const mockReadyDoc = {
  ...mockDoc,
  status: 'ready' as const,
  chunk_count: 3,
};

const mockChunk: RetrievedChunk = {
  id: MOCK_CHUNK_ID,
  document_id: MOCK_DOC_ID,
  content: 'This is a smoke test document with enough content to embed.',
  similarity: 0.95,
  metadata: { char_start: 0, char_end: 60 },
  filename: 'smoke-test.txt',
};

// Mock all external service calls
vi.mock('@services/vectorStore', () => ({
  createDocument:       vi.fn().mockResolvedValue(mockDoc),
  updateDocumentStatus: vi.fn().mockResolvedValue(undefined),
  updateChunkCount:     vi.fn().mockResolvedValue(undefined),
  upsertChunks:         vi.fn().mockResolvedValue(undefined),
  similaritySearch:     vi.fn().mockResolvedValue([mockChunk]),
  listDocuments:        vi.fn().mockResolvedValue({ data: [mockReadyDoc], total: 1 }),
  getDocument:          vi.fn().mockResolvedValue(mockReadyDoc),
  deleteDocument:       vi.fn().mockResolvedValue(undefined),
  logQuery:             vi.fn().mockResolvedValue(undefined),
  getChunkQualityStats: vi.fn().mockResolvedValue({ shortChunkCount: 0, longChunkCount: 0, avgTokenCount: 50, grade: 'good' }),
}));

vi.mock('@queues/documentQueue', () => ({
  addDocumentJob:     vi.fn().mockResolvedValue(MOCK_JOB_ID),
  getQueue:           vi.fn(),
  getJobStatus:       vi.fn(),
  cancelDocumentJob:  vi.fn().mockResolvedValue(undefined),
  documentQueue:      { close: vi.fn(), on: vi.fn() },
}));

// /api/health now pings real Supabase/Redis (readiness check) — mocked so
// the smoke test's health-check assertion gets a fast, deterministic 200
// instead of failing on unreachable dependencies in the test environment.
vi.mock('@utils/readiness', () => ({
  checkReadiness: vi.fn().mockResolvedValue({
    status: 'ok',
    checks: { supabase: { status: 'ok' }, redis: { status: 'ok' } },
  }),
}));

vi.mock('@services/embedder', () => ({
  embedText: vi.fn().mockResolvedValue({
    embedding: new Array(384).fill(0.1),
    tokenCount: 12,
    model: 'sentence-transformers/all-MiniLM-L6-v2',
  }),
  embedBatch: vi.fn().mockResolvedValue([
    { embedding: new Array(384).fill(0.1), tokenCount: 12, model: 'all-MiniLM-L6-v2' },
  ]),
}));

vi.mock('@services/llm', () => ({
  streamAnswer: vi.fn().mockImplementation(
    async (
      _ctx: unknown,
      _history: unknown,
      opts: { onChunk: (t: string) => void; onComplete: (t: string) => void },
    ) => {
      opts.onChunk('Revenue ');
      opts.onChunk('grew by 20%.');
      opts.onComplete('Revenue grew by 20%.');
    },
  ),
  extractCitations: vi.fn().mockReturnValue([
    {
      documentId: MOCK_DOC_ID,
      filename: 'smoke-test.txt',
      chunkId: MOCK_CHUNK_ID,
      similarity: 0.95,
      excerpt: 'This is a smoke test document with enough content to embed.',
    },
  ]),
  setSseHeaders: vi.fn().mockImplementation((res: import('express').Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
  }),
}));

vi.mock('fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir:     vi.fn().mockResolvedValue(undefined),
  readFile:  vi.fn().mockResolvedValue(Buffer.from('Smoke test document content for chunking.')),
  unlink:    vi.fn().mockResolvedValue(undefined),
}));

// ─── Test Setup ───────────────────────────────────────────────────────────────

let app: Application;
const timings: Record<string, number> = {};

beforeAll(async () => {
  const { createApp } = await import('../../src/app.js');
  app = createApp();
});

afterAll(() => {
  const total = Object.values(timings).reduce((a, b) => a + b, 0);
  // eslint-disable-next-line no-console
  console.info('\n=== Smoke Test Timings ===');
  Object.entries(timings).forEach(([step, ms]) => {
    // eslint-disable-next-line no-console
    console.info(`  ${step}: ${ms}ms`);
  });
  // eslint-disable-next-line no-console
  console.info(`  TOTAL: ${total}ms\n`);
});

// ─── Smoke Test ───────────────────────────────────────────────────────────────

describe('Smoke test — complete happy path', () => {
  /**
   * The entire pipeline in one sequential test.
   * Any step failure fails the whole test — that is intentional.
   * Total must complete under 30 000 ms.
   */
  it('runs the complete pipeline: upload → query → delete', async () => {
    const testStart = Date.now();

    // ── Step 1: Upload a text document ────────────────────────────────────────
    let t = Date.now();
    const uploadRes = await authedRequest(app)
      .post('/api/upload')
      .attach('files', Buffer.from('Smoke test document content.'), {
        filename: 'smoke-test.txt',
        contentType: 'text/plain',
      })
      .expect(200);

    timings['1-upload'] = Date.now() - t;

    expect(uploadRes.body.success).toBe(true);
    expect(uploadRes.body.data.documents).toHaveLength(1);

    const [uploadedDoc] = uploadRes.body.data.documents as Array<{
      id: string;
      filename: string;
      status: string;
      jobId: string;
    }>;
    expect(uploadedDoc).toBeDefined();
    expect(typeof uploadedDoc!.id).toBe('string');
    expect(uploadedDoc!.status).toBe('pending');
    expect(typeof uploadedDoc!.jobId).toBe('string');

    const documentId = uploadedDoc!.id;

    // ── Step 2: Verify document record created (status = ready in mock) ───────
    t = Date.now();
    const docRes = await authedRequest(app)
      .get(`/api/documents/${documentId}`)
      .expect(200);

    timings['2-get-document'] = Date.now() - t;

    expect(docRes.body.success).toBe(true);
    expect(docRes.body.data.document.status).toBe('ready');
    expect(docRes.body.data.document.chunk_count).toBeGreaterThan(0);

    // ── Step 3: Initiate a query ───────────────────────────────────────────────
    t = Date.now();
    const queryRes = await authedRequest(app)
      .post('/api/query')
      .send({
        query: 'What grew by 20 percent?',
        matchCount: 3,
        documentIds: [documentId],
      })
      .expect(200);

    timings['3-initiate-query'] = Date.now() - t;

    expect(queryRes.body.success).toBe(true);
    expect(typeof queryRes.body.data.queryId).toBe('string');

    const queryId = queryRes.body.data.queryId as string;

    // ── Step 4: Stream the SSE response ───────────────────────────────────────
    t = Date.now();
    const sseRes = await supertest(app)
      .get(`/api/query/stream?queryId=${queryId}`)
      .buffer(true)           // collect the full body before assertions
      .parse((res, callback) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => callback(null, data));
      });

    timings['4-sse-stream'] = Date.now() - t;

    expect(sseRes.status).toBe(200);
    expect(sseRes.headers['content-type']).toContain('text/event-stream');

    const events = collectSSEEvents(sseRes.body as string);
    const eventTypes = events.map((e) => e.event);

    // Must contain all five event types in the correct relative order
    expect(eventTypes).toContain('searching');
    expect(eventTypes).toContain('found');
    expect(eventTypes).toContain('generating');
    expect(eventTypes).toContain('token');
    expect(eventTypes).toContain('complete');

    // searching must come before generating
    expect(eventTypes.indexOf('searching')).toBeLessThan(eventTypes.indexOf('generating'));

    // complete must be the last event
    expect(eventTypes[eventTypes.length - 1]).toBe('complete');

    // Token events must accumulate to the full answer
    const tokenText = events
      .filter((e) => e.event === 'token')
      .map((e) => (e.data as { content?: string }).content ?? '')
      .join('');
    expect(tokenText.length).toBeGreaterThan(0);

    // complete event must include citations
    const completeEvent = events.find((e) => e.event === 'complete');
    expect(completeEvent).toBeDefined();
    const citations = (completeEvent!.data as { citations?: unknown[] }).citations;
    expect(Array.isArray(citations)).toBe(true);
    expect(citations!.length).toBeGreaterThan(0);

    // ── Step 5: List documents — document must appear ─────────────────────────
    t = Date.now();
    const listRes = await authedRequest(app)
      .get('/api/documents')
      .expect(200);

    timings['5-list-documents'] = Date.now() - t;

    expect(listRes.body.success).toBe(true);
    const docList = listRes.body.data as Array<{ id: string }>;
    expect(docList.some((d) => d.id === MOCK_DOC_ID)).toBe(true);

    // ── Step 6: Delete the document ───────────────────────────────────────────
    t = Date.now();
    const deleteRes = await authedRequest(app)
      .delete(`/api/documents/${documentId}`)
      .expect(200);

    timings['6-delete-document'] = Date.now() - t;

    expect(deleteRes.body.success).toBe(true);
    expect(deleteRes.body.data.documentId).toBe(documentId);

    // ── Step 7: Verify deleted (mock now throws NotFoundError) ────────────────
    const { NotFoundError } = await import('../../src/types/index.js');
    const { getDocument } = await import('@services/vectorStore');
    vi.mocked(getDocument).mockRejectedValueOnce(new NotFoundError(`Document ${documentId} not found`));

    t = Date.now();
    await authedRequest(app)
      .get(`/api/documents/${documentId}`)
      .expect(404);

    timings['7-verify-gone'] = Date.now() - t;

    // ── Final check: total elapsed ─────────────────────────────────────────────
    const totalMs = Date.now() - testStart;
    expect(totalMs).toBeLessThan(30_000);
  }, 30_000);

  // ── Health check sanity ───────────────────────────────────────────────────────
  it('GET /health returns 200', async () => {
    const res = await supertest(app).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /api/health returns correlation ID', async () => {
    const res = await supertest(app).get('/api/health').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.headers['x-correlation-id']).toBeDefined();
  });
});
