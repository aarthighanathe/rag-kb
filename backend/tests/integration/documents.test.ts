/**
 * @file documents.test.ts
 * @description Integration tests for GET /api/documents, GET /api/documents/:id,
 *              and DELETE /api/documents/:id
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import type { Application } from 'express';
import type { DocumentRecord } from '../../src/types/index.js';
import { authedRequest, TEST_USER_ID, OTHER_TEST_USER_ID } from './helpers.js';

// ── Service mocks ─────────────────────────────────────────────────────────────

vi.mock('@services/vectorStore', () => ({
  listDocuments: vi.fn(),
  getDocument: vi.fn(),
  deleteDocument: vi.fn(),
  createDocument: vi.fn(),
  similaritySearch: vi.fn(),
  computeDocumentSimilarity: vi.fn(),
  getChunkQualityStats: vi.fn(),
}));

vi.mock('@queues/documentQueue', () => ({
  getQueue: vi.fn(),
  addDocumentJob: vi.fn(),
  getJobStatus: vi.fn(),
  cancelDocumentJob: vi.fn().mockResolvedValue(undefined),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_DOCUMENT: DocumentRecord = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  filename: 'quarterly-report.pdf',
  mime_type: 'application/pdf',
  size_bytes: 204800,
  status: 'ready',
  chunk_count: 12,
  created_at: '2026-06-16T10:00:00.000Z',
  updated_at: '2026-06-16T10:01:30.000Z',
};

const MOCK_DOCUMENT_2: DocumentRecord = {
  id: '550e8400-e29b-41d4-a716-446655440002',
  filename: 'notes.txt',
  mime_type: 'text/plain',
  size_bytes: 1024,
  status: 'pending',
  chunk_count: 0,
  created_at: '2026-06-16T11:00:00.000Z',
  updated_at: '2026-06-16T11:00:00.000Z',
};

// ── Setup ──────────────────────────────────────────────────────────────────────

let app: Application;

beforeAll(async () => {
  const { createApp } = await import('../../src/app');
  app = createApp();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ── GET /api/documents ─────────────────────────────────────────────────────────

describe('GET /api/documents', () => {
  it('returns 200 with the correct envelope shape', async () => {
    const { listDocuments } = await import('@services/vectorStore') as {
      listDocuments: ReturnType<typeof vi.fn>;
    };
    listDocuments.mockResolvedValue({ data: [MOCK_DOCUMENT, MOCK_DOCUMENT_2], total: 2 });

    const res = await authedRequest(app).get('/api/documents').expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta).toMatchObject({
      page: 1,
      total: 2,
      correlationId: expect.any(String),
    });
  });

  it('passes page and limit query params to the service', async () => {
    const { listDocuments } = await import('@services/vectorStore') as {
      listDocuments: ReturnType<typeof vi.fn>;
    };
    listDocuments.mockResolvedValue({ data: [MOCK_DOCUMENT], total: 10 });

    const res = await authedRequest(app)
      .get('/api/documents?page=2&limit=5')
      .expect(200);

    expect(listDocuments).toHaveBeenCalledWith(2, 5, undefined, TEST_USER_ID);
    expect(res.body.meta.page).toBe(2);
    expect(res.body.meta.total).toBe(10);
  });

  it('passes the status filter to the service when provided', async () => {
    const { listDocuments } = await import('@services/vectorStore') as {
      listDocuments: ReturnType<typeof vi.fn>;
    };
    listDocuments.mockResolvedValue({ data: [], total: 0 });

    await authedRequest(app).get('/api/documents?status=ready').expect(200);

    expect(listDocuments).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), 'ready', TEST_USER_ID);
  });

  it('returns 422 for an invalid status value', async () => {
    const res = await authedRequest(app)
      .get('/api/documents?status=unknown_status')
      .expect(422);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNPROCESSABLE_ENTITY');
  });
});

// ── GET /api/documents/:id ─────────────────────────────────────────────────────

describe('GET /api/documents/:id', () => {
  it('returns 200 with the document in the data field', async () => {
    const { getDocument } = await import('@services/vectorStore') as {
      getDocument: ReturnType<typeof vi.fn>;
    };
    getDocument.mockResolvedValue(MOCK_DOCUMENT);

    const res = await authedRequest(app)
      .get(`/api/documents/${MOCK_DOCUMENT.id}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.document).toMatchObject({
      id: MOCK_DOCUMENT.id,
      filename: MOCK_DOCUMENT.filename,
    });
    expect(res.body.data.chunkQuality).toBeUndefined();
    expect(res.body.meta.correlationId).toBeDefined();
  });

  it('returns 422 for a non-UUID id path parameter', async () => {
    const res = await authedRequest(app)
      .get('/api/documents/not-a-valid-uuid')
      .expect(422);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNPROCESSABLE_ENTITY');
  });

  it('returns 404 when the document does not exist', async () => {
    const { getDocument } = await import('@services/vectorStore') as {
      getDocument: ReturnType<typeof vi.fn>;
    };
    const { NotFoundError } = await import('../../src/types/index.js');
    getDocument.mockRejectedValue(new NotFoundError('Document not found'));

    const res = await authedRequest(app)
      .get('/api/documents/550e8400-e29b-41d4-a716-000000000099')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// ── DELETE /api/documents/:id ─────────────────────────────────────────────────

describe('DELETE /api/documents/:id', () => {
  it('returns 200 with success and documentId after deletion', async () => {
    const { getDocument, deleteDocument } = await import('@services/vectorStore') as {
      getDocument: ReturnType<typeof vi.fn>;
      deleteDocument: ReturnType<typeof vi.fn>;
    };
    getDocument.mockResolvedValue(MOCK_DOCUMENT);
    deleteDocument.mockResolvedValue(undefined);

    const res = await authedRequest(app)
      .delete(`/api/documents/${MOCK_DOCUMENT.id}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.documentId).toBe(MOCK_DOCUMENT.id);
    expect(res.body.data.message).toMatch(/deleted/i);
    expect(res.body.meta.correlationId).toBeDefined();
  });

  it('calls deleteDocument service once with the correct ID', async () => {
    const { getDocument, deleteDocument } = await import('@services/vectorStore') as {
      getDocument: ReturnType<typeof vi.fn>;
      deleteDocument: ReturnType<typeof vi.fn>;
    };
    getDocument.mockResolvedValue(MOCK_DOCUMENT);
    deleteDocument.mockResolvedValue(undefined);

    await authedRequest(app)
      .delete(`/api/documents/${MOCK_DOCUMENT.id}`)
      .expect(200);

    expect(deleteDocument).toHaveBeenCalledOnce();
    expect(deleteDocument).toHaveBeenCalledWith(MOCK_DOCUMENT.id, TEST_USER_ID);
  });

  it('returns 404 when the document does not exist', async () => {
    const { getDocument } = await import('@services/vectorStore') as {
      getDocument: ReturnType<typeof vi.fn>;
    };
    const { NotFoundError } = await import('../../src/types/index.js');
    getDocument.mockRejectedValue(new NotFoundError('Document not found'));

    const res = await authedRequest(app)
      .delete('/api/documents/550e8400-e29b-41d4-a716-000000000099')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 422 for a non-UUID id path parameter', async () => {
    const res = await authedRequest(app)
      .delete('/api/documents/invalid-id')
      .expect(422);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNPROCESSABLE_ENTITY');
  });
});

// ── GET /api/documents/similarity ─────────────────────────────────────────────

describe('GET /api/documents/similarity', () => {
  it('returns 200 with the correct envelope shape', async () => {
    const { computeDocumentSimilarity } = await import('@services/vectorStore') as {
      computeDocumentSimilarity: ReturnType<typeof vi.fn>;
    };
    const { listDocuments } = await import('@services/vectorStore') as {
      listDocuments: ReturnType<typeof vi.fn>;
    };
    computeDocumentSimilarity.mockResolvedValue([
      { documentA: MOCK_DOCUMENT.id, documentB: MOCK_DOCUMENT_2.id, similarity: 0.72 },
    ]);
    listDocuments.mockResolvedValue({ data: [MOCK_DOCUMENT], total: 1 });

    const res = await authedRequest(app).get('/api/documents/similarity').expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.pairs).toBeInstanceOf(Array);
    expect(res.body.data.documents).toBeInstanceOf(Array);
    expect(res.body.meta.correlationId).toBeDefined();
  });

  it('passes threshold query param to the service', async () => {
    const { computeDocumentSimilarity } = await import('@services/vectorStore') as {
      computeDocumentSimilarity: ReturnType<typeof vi.fn>;
    };
    const { listDocuments } = await import('@services/vectorStore') as {
      listDocuments: ReturnType<typeof vi.fn>;
    };
    computeDocumentSimilarity.mockResolvedValue([]);
    listDocuments.mockResolvedValue({ data: [], total: 0 });

    await authedRequest(app).get('/api/documents/similarity?threshold=0.8').expect(200);

    expect(computeDocumentSimilarity).toHaveBeenCalledWith(0.8, TEST_USER_ID);
  });

  it('returns empty pairs when fewer than 2 ready documents', async () => {
    const { computeDocumentSimilarity } = await import('@services/vectorStore') as {
      computeDocumentSimilarity: ReturnType<typeof vi.fn>;
    };
    const { listDocuments } = await import('@services/vectorStore') as {
      listDocuments: ReturnType<typeof vi.fn>;
    };
    computeDocumentSimilarity.mockResolvedValue([]);
    listDocuments.mockResolvedValue({ data: [MOCK_DOCUMENT], total: 1 });

    const res = await authedRequest(app).get('/api/documents/similarity').expect(200);

    expect(res.body.data.pairs).toEqual([]);
  });

  it('calls computeDocumentSimilarity and listDocuments exactly once each per request (Promise.all refactor)', async () => {
    // Regression guard: computeDocumentSimilarity and listDocuments are
    // independent reads run concurrently via Promise.all in the route
    // handler. This asserts the refactor still invokes both services
    // exactly once (neither dropped nor duplicated) and that the response
    // still combines both results correctly.
    const { computeDocumentSimilarity } = await import('@services/vectorStore') as {
      computeDocumentSimilarity: ReturnType<typeof vi.fn>;
    };
    const { listDocuments } = await import('@services/vectorStore') as {
      listDocuments: ReturnType<typeof vi.fn>;
    };
    computeDocumentSimilarity.mockResolvedValue([
      { documentA: MOCK_DOCUMENT.id, documentB: MOCK_DOCUMENT_2.id, similarity: 0.5 },
    ]);
    listDocuments.mockResolvedValue({ data: [MOCK_DOCUMENT, MOCK_DOCUMENT_2], total: 2 });

    const res = await authedRequest(app).get('/api/documents/similarity').expect(200);

    expect(computeDocumentSimilarity).toHaveBeenCalledTimes(1);
    expect(listDocuments).toHaveBeenCalledTimes(1);
    expect(listDocuments).toHaveBeenCalledWith(1, 100, 'ready', TEST_USER_ID);
    expect(res.body.data.pairs).toHaveLength(1);
    expect(res.body.data.documents).toHaveLength(2);
  });

  it('propagates a computeDocumentSimilarity failure as an error response even though listDocuments runs concurrently', async () => {
    // Preserves existing error-handling behavior across the Promise.all
    // refactor: if either concurrent call throws, the route's catch/next(err)
    // path must still fire.
    const { computeDocumentSimilarity } = await import('@services/vectorStore') as {
      computeDocumentSimilarity: ReturnType<typeof vi.fn>;
    };
    const { listDocuments } = await import('@services/vectorStore') as {
      listDocuments: ReturnType<typeof vi.fn>;
    };
    const { InternalError } = await import('../../src/types/index.js');
    computeDocumentSimilarity.mockRejectedValue(new InternalError('similarity computation failed'));
    listDocuments.mockResolvedValue({ data: [], total: 0 });

    const res = await authedRequest(app).get('/api/documents/similarity').expect(500);

    expect(res.body.success).toBe(false);
  });

  it('is mounted before /:id (no conflict with "similarity" as UUID)', async () => {
    const { computeDocumentSimilarity } = await import('@services/vectorStore') as {
      computeDocumentSimilarity: ReturnType<typeof vi.fn>;
    };
    const { listDocuments } = await import('@services/vectorStore') as {
      listDocuments: ReturnType<typeof vi.fn>;
    };
    computeDocumentSimilarity.mockResolvedValue([]);
    listDocuments.mockResolvedValue({ data: [], total: 0 });

    // "similarity" is not a valid UUID, so if the route is mounted correctly,
    // it should NOT hit the /:id route (which would return 422)
    const res = await authedRequest(app).get('/api/documents/similarity').expect(200);

    expect(res.body.success).toBe(true);
  });
});

// ── User isolation / IDOR prevention ──────────────────────────────────────────
//
// vectorStore functions are mocked here, so these tests verify the route layer's
// contract with the service layer: every call is scoped to req.auth.userId, and a
// service-side "not owned by this user" rejection (NotFoundError) surfaces as a
// plain 404 — never a 403 — so an attacker can't distinguish "not yours" from
// "doesn't exist". Real ownership filtering is unit-tested in vectorStore.test.ts.

describe('User isolation (IDOR prevention)', () => {
  it('GET /api/documents/:id passes the authenticated userId to the service', async () => {
    const { getDocument } = await import('@services/vectorStore') as {
      getDocument: ReturnType<typeof vi.fn>;
    };
    getDocument.mockResolvedValue(MOCK_DOCUMENT);

    await authedRequest(app, OTHER_TEST_USER_ID)
      .get(`/api/documents/${MOCK_DOCUMENT.id}`)
      .expect(200);

    expect(getDocument).toHaveBeenCalledWith(MOCK_DOCUMENT.id, OTHER_TEST_USER_ID);
  });

  it("returns 404, not 403, when a document exists but belongs to another user", async () => {
    const { getDocument } = await import('@services/vectorStore') as {
      getDocument: ReturnType<typeof vi.fn>;
    };
    const { NotFoundError } = await import('../../src/types/index.js');
    // Simulates the real getDocument's .eq('user_id', userId) filter finding no row.
    getDocument.mockRejectedValue(new NotFoundError(`Document ${MOCK_DOCUMENT.id} not found`));

    const res = await authedRequest(app, OTHER_TEST_USER_ID)
      .get(`/api/documents/${MOCK_DOCUMENT.id}`)
      .expect(404);

    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it("cannot delete another user's document — ownership check surfaces as 404 before the queue/delete are ever touched", async () => {
    // Ownership is verified via getDocument BEFORE cancelDocumentJob/deleteDocument
    // run, closing the IDOR window where a caller who merely knows another
    // user's documentId could cancel that user's in-flight processing job.
    const { getDocument, deleteDocument } = await import('@services/vectorStore') as {
      getDocument: ReturnType<typeof vi.fn>;
      deleteDocument: ReturnType<typeof vi.fn>;
    };
    const { cancelDocumentJob } = await import('@queues/documentQueue') as {
      cancelDocumentJob: ReturnType<typeof vi.fn>;
    };
    const { NotFoundError } = await import('../../src/types/index.js');
    getDocument.mockRejectedValue(new NotFoundError(`Document ${MOCK_DOCUMENT.id} not found`));

    const res = await authedRequest(app, OTHER_TEST_USER_ID)
      .delete(`/api/documents/${MOCK_DOCUMENT.id}`)
      .expect(404);

    expect(getDocument).toHaveBeenCalledWith(MOCK_DOCUMENT.id, OTHER_TEST_USER_ID);
    expect(cancelDocumentJob).not.toHaveBeenCalled();
    expect(deleteDocument).not.toHaveBeenCalled();
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it("similarity search never mixes in another user's documents", async () => {
    const { computeDocumentSimilarity, listDocuments } = await import('@services/vectorStore') as {
      computeDocumentSimilarity: ReturnType<typeof vi.fn>;
      listDocuments: ReturnType<typeof vi.fn>;
    };
    // Service is scoped by userId — user B's KB is empty even though user A has documents.
    computeDocumentSimilarity.mockResolvedValue([]);
    listDocuments.mockResolvedValue({ data: [], total: 0 });

    const res = await authedRequest(app, OTHER_TEST_USER_ID)
      .get('/api/documents/similarity')
      .expect(200);

    expect(computeDocumentSimilarity).toHaveBeenCalledWith(expect.any(Number), OTHER_TEST_USER_ID);
    expect(res.body.data.documents).toEqual([]);
    const docIds = (res.body.data.documents as Array<{ id: string }>).map((d) => d.id);
    expect(docIds).not.toContain(MOCK_DOCUMENT.id);
  });
});

// ── Unauthenticated access ────────────────────────────────────────────────────

describe('Unauthenticated access', () => {
  it('GET /api/documents returns 401 without an Authorization header', async () => {
    const res = await supertest(app).get('/api/documents').expect(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('GET /api/documents/:id returns 401 without an Authorization header', async () => {
    const res = await supertest(app).get(`/api/documents/${MOCK_DOCUMENT.id}`).expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('DELETE /api/documents/:id returns 401 without an Authorization header', async () => {
    const res = await supertest(app).delete(`/api/documents/${MOCK_DOCUMENT.id}`).expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('GET /api/documents/similarity returns 401 without an Authorization header', async () => {
    const res = await supertest(app).get('/api/documents/similarity').expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 with an invalid/garbage bearer token', async () => {
    const res = await supertest(app)
      .get('/api/documents')
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });
});
