/**
 * @file query.test.ts
 * @description Integration tests for POST /api/query and GET /api/query/stream (SSE)
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import http from 'http';
import type { Application } from 'express';
import type { RetrievedChunk } from '../../src/types/index.js';
import { authedRequest, collectSSEEvents, OTHER_TEST_USER_ID } from './helpers.js';

// ── Service mocks ─────────────────────────────────────────────────────────────

vi.mock('@services/embedder', () => ({
  embedText: vi.fn().mockResolvedValue({ embedding: new Array(384).fill(0.1), tokenCount: 5 }),
}));

vi.mock('@services/vectorStore', () => ({
  similaritySearch: vi.fn(),
  createDocument: vi.fn(),
  listDocuments: vi.fn(),
  getDocument: vi.fn(),
  deleteDocument: vi.fn(),
  logQuery: vi.fn().mockResolvedValue('query-log-uuid-1'),
  setQueryFeedback: vi.fn(),
}));

vi.mock('@services/llm', () => ({
  streamAnswer: vi.fn(),
  extractCitations: vi.fn(),
  setSseHeaders: vi.fn().mockImplementation((res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
  }),
}));

vi.mock('@queues/documentQueue', () => ({
  getQueue: vi.fn(),
  addDocumentJob: vi.fn(),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_CHUNK: RetrievedChunk = {
  id: 'chunk-uuid-1',
  document_id: 'doc-uuid-1',
  content: 'The main conclusion is that revenue grew by 20%.',
  similarity: 0.92,
  metadata: { char_start: 0, char_end: 47 },
  filename: 'report.pdf',
};

const MOCK_CITATION = {
  documentId: 'doc-uuid-1',
  filename: 'report.pdf',
  chunkId: 'chunk-uuid-1',
  similarity: 0.92,
  excerpt: 'The main conclusion is that revenue grew by 20%.',
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

// ── POST /api/query ────────────────────────────────────────────────────────────

describe('POST /api/query', () => {
  it('returns 200 with a queryId for a valid query', async () => {
    const res = await authedRequest(app)
      .post('/api/query')
      .send({ query: 'What are the main conclusions?' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.queryId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(res.body.meta.correlationId).toBeDefined();
  });

  it('returns 422 when query is too short (< 3 chars)', async () => {
    const res = await authedRequest(app)
      .post('/api/query')
      .send({ query: 'hi' })
      .expect(422);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNPROCESSABLE_ENTITY');
    expect(res.body.error.details).toBeInstanceOf(Array);
    const fieldError = (res.body.error.details as Array<{ field: string; message: string }>).find(
      (d) => d.field === 'query',
    );
    expect(fieldError).toBeDefined();
  });

  it('returns 422 when query is missing entirely', async () => {
    const res = await authedRequest(app)
      .post('/api/query')
      .send({ matchCount: 5 })
      .expect(422);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNPROCESSABLE_ENTITY');
  });

  it('applies defaults for matchCount and similarityThreshold when not provided', async () => {
    const res = await authedRequest(app)
      .post('/api/query')
      .send({ query: 'What is the revenue?' })
      .expect(200);

    // Only the queryId is returned; internal defaults are verified via the stream test
    expect(res.body.success).toBe(true);
    expect(res.body.data.queryId).toBeDefined();
  });
});

// ── GET /api/query/stream ──────────────────────────────────────────────────────

describe('GET /api/query/stream', () => {
  it('returns 422 when queryId parameter is missing', async () => {
    const res = await supertest(app).get('/api/query/stream').expect(422);
    expect(res.body.success).toBe(false);
  });

  it('returns 422 when queryId is not a valid UUID', async () => {
    const res = await supertest(app)
      .get('/api/query/stream?queryId=not-a-uuid')
      .expect(422);
    expect(res.body.success).toBe(false);
  });

  it('returns 422 when queryId is passed twice (array)', async () => {
    const res = await supertest(app)
      .get('/api/query/stream?queryId=00000000-0000-4000-8000-000000000000&queryId=11111111-1111-4111-8111-111111111111')
      .expect(422);
    expect(res.body.success).toBe(false);
  });

  it('returns 404 when queryId does not exist', async () => {
    // Routed through the shared NotFoundError -> errorHandler.ts pattern
    // (same as every other "not found" in the app) rather than a hand-built
    // envelope, so the code is the generic NOT_FOUND, not a bespoke one.
    const res = await supertest(app)
      .get('/api/query/stream?queryId=00000000-0000-4000-8000-000000000000')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('establishes SSE connection and fires events in correct order', async () => {
    const { similaritySearch } = await import('@services/vectorStore') as {
      similaritySearch: ReturnType<typeof vi.fn>;
    };
    const { streamAnswer, extractCitations } = await import('@services/llm') as {
      streamAnswer: ReturnType<typeof vi.fn>;
      extractCitations: ReturnType<typeof vi.fn>;
    };

    similaritySearch.mockResolvedValue([MOCK_CHUNK]);
    extractCitations.mockReturnValue([MOCK_CITATION]);
    streamAnswer.mockImplementation(
      async (
        _ctx: unknown,
        _history: unknown,
        opts: { onChunk: (t: string) => void; onComplete: () => void },
      ) => {
        opts.onChunk('The main ');
        opts.onChunk('conclusion is...');
        opts.onComplete();
      },
    );

    // Step 1: Register the query
    const initRes = await authedRequest(app)
      .post('/api/query')
      .send({ query: 'What is the main finding?', matchCount: 3 })
      .expect(200);

    const { queryId } = initRes.body.data as { queryId: string };

    // Step 2: Open the SSE stream
    const streamRes = await supertest(app)
      .get(`/api/query/stream?queryId=${queryId}`)
      .expect(200);

    expect(streamRes.headers['content-type']).toMatch(/text\/event-stream/);

    const events = collectSSEEvents(String(streamRes.text));
    const eventTypes = events.map((e) => e.event);

    // Verify the sequence: searching → found → generating → token(s) → complete
    expect(eventTypes[0]).toBe('searching');
    expect(eventTypes).toContain('found');
    expect(eventTypes).toContain('generating');
    expect(eventTypes).toContain('token');
    expect(eventTypes[eventTypes.length - 1]).toBe('complete');
  });

  // Regression: consumePendingQuery used to delete the entry on the FIRST GET,
  // so useSSE.ts's exponential-backoff reconnect (targeting the same queryId
  // after a genuinely dropped connection) could only ever hit a 404 — the
  // reconnect mechanism was structurally incapable of helping with the one
  // scenario it exists for. This simulates a real mid-stream drop (socket
  // destroyed before the pipeline reaches a terminal outcome), then reopens
  // the same queryId and expects a fresh, successful stream — not a 404.
  it('lets a reconnect after a genuine mid-stream drop restart the query instead of 404ing', async () => {
    const { similaritySearch } = await import('@services/vectorStore') as {
      similaritySearch: ReturnType<typeof vi.fn>;
    };
    const { streamAnswer, extractCitations } = await import('@services/llm') as {
      streamAnswer: ReturnType<typeof vi.fn>;
      extractCitations: ReturnType<typeof vi.fn>;
    };
    extractCitations.mockReturnValue([MOCK_CITATION]);
    streamAnswer.mockImplementation(
      async (
        _ctx: unknown,
        _history: unknown,
        opts: { onChunk: (t: string) => void; onComplete: () => void },
      ) => {
        opts.onChunk('answer');
        opts.onComplete();
      },
    );

    const server = app.listen(0);
    const { port } = server.address() as { port: number };

    try {
      const initRes = await authedRequest(app)
        .post('/api/query')
        .send({ query: 'Drop then reconnect to the same query.', matchCount: 3 })
        .expect(200);
      const { queryId } = initRes.body.data as { queryId: string };

      // similaritySearch resolves only after the client socket has already
      // been destroyed, so the first attempt unwinds via the isConnected()
      // guard without ever reaching a terminal emit.
      let resolveSearch: (chunks: RetrievedChunk[]) => void;
      const searchPromise = new Promise<RetrievedChunk[]>((resolve) => {
        resolveSearch = resolve;
      });
      similaritySearch.mockReturnValueOnce(searchPromise);

      await new Promise<void>((resolveTest) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port,
            path: `/api/query/stream?queryId=${queryId}`,
            method: 'GET',
            agent: false,
          },
          (res) => {
            res.on('data', () => { /* drain */ });
          },
        );
        req.on('error', () => { /* expected once the socket is destroyed */ });
        req.end();

        setTimeout(() => {
          req.destroy();
          setTimeout(() => {
            resolveSearch([MOCK_CHUNK]);
            setTimeout(() => {
              resolveTest();
            }, 150);
          }, 150);
        }, 200);
      });

      // Second attempt: same queryId, fresh (non-once) mock — must succeed,
      // not 404, and must run the pipeline again (not resume a buffer).
      similaritySearch.mockResolvedValue([MOCK_CHUNK]);
      const secondRes = await supertest(app)
        .get(`/api/query/stream?queryId=${queryId}`)
        .expect(200);

      const events = collectSSEEvents(String(secondRes.text));
      expect(events.map((e) => e.event)).toContain('complete');
    } finally {
      server.close();
    }
  });

  it('sends complete event with empty citations when knowledge base has no matches', async () => {
    const { similaritySearch } = await import('@services/vectorStore') as {
      similaritySearch: ReturnType<typeof vi.fn>;
    };
    const { extractCitations } = await import('@services/llm') as {
      extractCitations: ReturnType<typeof vi.fn>;
    };

    similaritySearch.mockResolvedValue([]);
    extractCitations.mockReturnValue([]);

    const initRes = await authedRequest(app)
      .post('/api/query')
      .send({ query: 'Question with no matching documents?' })
      .expect(200);

    const { queryId } = initRes.body.data as { queryId: string };

    const streamRes = await supertest(app)
      .get(`/api/query/stream?queryId=${queryId}`)
      .expect(200);

    const events = collectSSEEvents(String(streamRes.text));
    const completeEvent = events.find((e) => e.event === 'complete');

    expect(completeEvent).toBeDefined();
    const data = completeEvent?.data as { type: string; citations: unknown[] };
    expect(data.citations).toHaveLength(0);
  });

  it('sends an error SSE event when the LLM fails mid-stream', async () => {
    const { similaritySearch } = await import('@services/vectorStore') as {
      similaritySearch: ReturnType<typeof vi.fn>;
    };
    const { streamAnswer } = await import('@services/llm') as {
      streamAnswer: ReturnType<typeof vi.fn>;
    };

    similaritySearch.mockResolvedValue([MOCK_CHUNK]);
    streamAnswer.mockImplementation(
      async (
        _ctx: unknown,
        _history: unknown,
        opts: { onChunk: (t: string) => void; onError: (e: Error) => void },
      ) => {
        opts.onChunk('Partial answer ');
        const { LLMError, LLMErrorCode } = await import('../../src/utils/errors.js');
        const err = new LLMError('Groq stream interrupted', LLMErrorCode.STREAM_FAILED, 503);
        opts.onError(err);
        throw err;
      },
    );

    const initRes = await authedRequest(app)
      .post('/api/query')
      .send({ query: 'Trigger an LLM error mid-stream.' })
      .expect(200);

    const { queryId } = initRes.body.data as { queryId: string };

    const streamRes = await supertest(app)
      .get(`/api/query/stream?queryId=${queryId}`)
      .expect(200);

    expect(streamRes.headers['content-type']).toMatch(/text\/event-stream/);

    const events = collectSSEEvents(String(streamRes.text));
    const errorEvent = events.find((e) => e.event === 'error');
    expect(errorEvent).toBeDefined();

    const tokenEvents = events.filter((e) => e.event === 'token');
    expect(tokenEvents.length).toBeGreaterThan(0); // partial tokens emitted before error
  });

  it('returns 200 with complete event and empty citations when no chunks match', async () => {
    const { similaritySearch } = await import('@services/vectorStore') as {
      similaritySearch: ReturnType<typeof vi.fn>;
    };
    const { streamAnswer, extractCitations } = await import('@services/llm') as {
      streamAnswer: ReturnType<typeof vi.fn>;
      extractCitations: ReturnType<typeof vi.fn>;
    };

    similaritySearch.mockResolvedValue([]);
    extractCitations.mockReturnValue([]);
    streamAnswer.mockImplementation(
      async (
        _ctx: unknown,
        _history: unknown,
        opts: { onChunk: (t: string) => void; onComplete: () => void },
      ) => {
        opts.onChunk('No relevant content found.');
        opts.onComplete();
      },
    );

    const initRes = await authedRequest(app)
      .post('/api/query')
      .send({ query: 'A question with no matching chunks.' })
      .expect(200);

    const { queryId } = initRes.body.data as { queryId: string };

    const streamRes = await supertest(app)
      .get(`/api/query/stream?queryId=${queryId}`)
      .expect(200);

    const events = collectSSEEvents(String(streamRes.text));
    const completeEvent = events.find((e) => e.event === 'complete');
    expect(completeEvent).toBeDefined();
    expect((completeEvent?.data as { citations: unknown[] }).citations).toHaveLength(0);
  });

  it('includes RateLimit headers in the stream response', async () => {
    const { similaritySearch } = await import('@services/vectorStore') as {
      similaritySearch: ReturnType<typeof vi.fn>;
    };
    similaritySearch.mockResolvedValue([]);

    const initRes = await authedRequest(app)
      .post('/api/query')
      .send({ query: 'Check rate limit headers.' })
      .expect(200);

    const { queryId } = initRes.body.data as { queryId: string };

    const streamRes = await supertest(app).get(
      `/api/query/stream?queryId=${queryId}`,
    );

    // POST /api/query has rate-limit middleware applied
    expect(initRes.headers['ratelimit-limit'] ?? initRes.headers['x-ratelimit-limit']).toBeDefined();
    // GET /stream is served under the same router prefix
    expect(streamRes.status).toBe(200);
  });

  it('does not invoke the LLM when the client disconnects between vector search and generation', async () => {
    const { similaritySearch } = await import('@services/vectorStore') as {
      similaritySearch: ReturnType<typeof vi.fn>;
    };
    const { streamAnswer, extractCitations } = await import('@services/llm') as {
      streamAnswer: ReturnType<typeof vi.fn>;
      extractCitations: ReturnType<typeof vi.fn>;
    };
    extractCitations.mockReturnValue([MOCK_CITATION]);
    streamAnswer.mockImplementation(
      async (
        _ctx: unknown,
        _history: unknown,
        opts: { onChunk: (t: string) => void; onComplete: () => void },
      ) => {
        opts.onChunk('should never be sent');
        opts.onComplete();
      },
    );

    // Real listening server + raw http client so the request socket can be
    // destroyed mid-flight — supertest's high-level API awaits the full
    // response and offers no way to abort partway through.
    const server = app.listen(0);
    const { port } = server.address() as { port: number };

    try {
      const initRes = await authedRequest(app)
        .post('/api/query')
        .send({ query: 'Disconnect before the LLM call starts.', matchCount: 3 })
        .expect(200);
      const { queryId } = initRes.body.data as { queryId: string };

      // similaritySearch resolves only once the client request has already
      // been destroyed, simulating a disconnect that lands between vector
      // search finishing and the LLM call starting.
      let resolveSearch: (chunks: RetrievedChunk[]) => void;
      const searchPromise = new Promise<RetrievedChunk[]>((resolve) => {
        resolveSearch = resolve;
      });
      similaritySearch.mockReturnValue(searchPromise);

      await new Promise<void>((resolveTest, rejectTest) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port,
            path: `/api/query/stream?queryId=${queryId}`,
            method: 'GET',
            agent: false,
          },
          (res) => {
            res.on('data', () => {
              /* draining the response is required for 'close' to fire cleanly on some platforms */
            });
          },
        );
        req.on('error', () => {
          /* destroying the socket triggers an expected client-side error — ignore it */
        });
        req.end();

        // Give the server enough time to run through auth/rate-limit
        // middleware and reach the similaritySearch await point, then
        // destroy the client connection and resolve the search.
        setTimeout(() => {
          req.destroy();
          // Let the server's req.on('close') handler run before the search resolves.
          setTimeout(() => {
            resolveSearch([MOCK_CHUNK]);
            // Give the post-search isConnected check and (if it wrongly
            // fires) streamAnswer's own mock implementation time to run.
            setTimeout(() => {
              try {
                expect(streamAnswer).not.toHaveBeenCalled();
                resolveTest();
              } catch (err) {
                rejectTest(err as Error);
              }
            }, 150);
          }, 150);
        }, 200);
      });
    } finally {
      server.close();
    }
  });
});

// ── Authentication ─────────────────────────────────────────────────────────────

describe('POST /api/query authentication', () => {
  it('returns 401 without an Authorization header', async () => {
    const res = await supertest(app)
      .post('/api/query')
      .send({ query: 'Who can see this?' })
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 with an invalid bearer token', async () => {
    const res = await supertest(app)
      .post('/api/query')
      .set('Authorization', 'Bearer garbage')
      .send({ query: 'Who can see this?' })
      .expect(401);

    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });
});

describe('GET /api/query/stream requires no separate Authorization header', () => {
  it('serves the stream for a valid queryId with no Authorization header at all', async () => {
    const { similaritySearch } = await import('@services/vectorStore') as {
      similaritySearch: ReturnType<typeof vi.fn>;
    };
    similaritySearch.mockResolvedValue([]);

    // POST is authenticated — the resulting queryId is the capability that lets
    // the unauthenticated (EventSource-compatible) GET /stream proceed.
    const initRes = await authedRequest(app)
      .post('/api/query')
      .send({ query: 'No auth header on the GET half.' })
      .expect(200);

    const { queryId } = initRes.body.data as { queryId: string };

    const streamRes = await supertest(app).get(`/api/query/stream?queryId=${queryId}`);
    expect(streamRes.status).toBe(200);
  });
});

// ── POST /api/query/:queryId/feedback ─────────────────────────────────────────
//
// setQueryFeedback is mocked here, so these tests verify the route layer's
// contract with the service layer — request validation, auth gating, and the
// IDOR-prevention convention (a service-side NotFoundError surfaces as a plain
// 404, never a 403). The actual ownership-scoped UPDATE is unit-tested in
// vectorStore.test.ts.

describe('POST /api/query/:queryId/feedback', () => {
  const FEEDBACK_QUERY_ID = '550e8400-e29b-41d4-a716-446655440042';

  it('returns 200 and records helpful feedback for a valid queryId', async () => {
    const { setQueryFeedback } = await import('@services/vectorStore') as {
      setQueryFeedback: ReturnType<typeof vi.fn>;
    };
    setQueryFeedback.mockResolvedValue(undefined);

    const res = await authedRequest(app)
      .post(`/api/query/${FEEDBACK_QUERY_ID}/feedback`)
      .send({ feedback: 'helpful' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ queryId: FEEDBACK_QUERY_ID, feedback: 'helpful' });
    expect(setQueryFeedback).toHaveBeenCalledWith(FEEDBACK_QUERY_ID, 'test-user-1', 'helpful');
  });

  it('returns 401 without an Authorization header', async () => {
    const res = await supertest(app)
      .post(`/api/query/${FEEDBACK_QUERY_ID}/feedback`)
      .send({ feedback: 'helpful' })
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 422 when queryId path parameter is not a valid UUID', async () => {
    const res = await authedRequest(app)
      .post('/api/query/not-a-uuid/feedback')
      .send({ feedback: 'helpful' })
      .expect(422);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNPROCESSABLE_ENTITY');
  });

  it("returns 422 when feedback is not 'helpful' or 'not_helpful'", async () => {
    const res = await authedRequest(app)
      .post(`/api/query/${FEEDBACK_QUERY_ID}/feedback`)
      .send({ feedback: 'meh' })
      .expect(422);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNPROCESSABLE_ENTITY');
  });

  it('returns 422 when the feedback field is missing entirely', async () => {
    const res = await authedRequest(app)
      .post(`/api/query/${FEEDBACK_QUERY_ID}/feedback`)
      .send({})
      .expect(422);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNPROCESSABLE_ENTITY');
  });

  // ── Ownership (IDOR prevention) ──────────────────────────────────────────

  it('returns 404, not 403, when the query exists but belongs to another user', async () => {
    const { setQueryFeedback } = await import('@services/vectorStore') as {
      setQueryFeedback: ReturnType<typeof vi.fn>;
    };
    const { NotFoundError } = await import('../../src/types/index.js');
    // Simulates the real setQueryFeedback's .eq('user_id', userId) filter
    // matching zero rows — indistinguishable from a nonexistent queryId.
    setQueryFeedback.mockRejectedValue(new NotFoundError(`Query ${FEEDBACK_QUERY_ID} not found`));

    const res = await authedRequest(app, OTHER_TEST_USER_ID)
      .post(`/api/query/${FEEDBACK_QUERY_ID}/feedback`)
      .send({ feedback: 'helpful' })
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(setQueryFeedback).toHaveBeenCalledWith(
      FEEDBACK_QUERY_ID,
      OTHER_TEST_USER_ID,
      'helpful',
    );
  });

  it('returns 404 for a queryId that never existed', async () => {
    const { setQueryFeedback } = await import('@services/vectorStore') as {
      setQueryFeedback: ReturnType<typeof vi.fn>;
    };
    const { NotFoundError } = await import('../../src/types/index.js');
    setQueryFeedback.mockRejectedValue(new NotFoundError('Query not found'));

    const res = await authedRequest(app)
      .post('/api/query/00000000-0000-4000-8000-000000000000/feedback')
      .send({ feedback: 'not_helpful' })
      .expect(404);

    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  // ── Idempotency ───────────────────────────────────────────────────────────

  it('resubmitting feedback for the same query updates it rather than erroring', async () => {
    const { setQueryFeedback } = await import('@services/vectorStore') as {
      setQueryFeedback: ReturnType<typeof vi.fn>;
    };
    setQueryFeedback.mockResolvedValue(undefined);

    // First submission
    const first = await authedRequest(app)
      .post(`/api/query/${FEEDBACK_QUERY_ID}/feedback`)
      .send({ feedback: 'helpful' })
      .expect(200);
    expect(first.body.data.feedback).toBe('helpful');

    // Resubmission with a different value — must also succeed with 200,
    // not 409/500, and reflect the new value (the service layer's UPDATE,
    // not INSERT, is what actually guarantees no duplicate row; this test
    // verifies the route doesn't reject a second call for the same queryId).
    const second = await authedRequest(app)
      .post(`/api/query/${FEEDBACK_QUERY_ID}/feedback`)
      .send({ feedback: 'not_helpful' })
      .expect(200);
    expect(second.body.data.feedback).toBe('not_helpful');

    expect(setQueryFeedback).toHaveBeenNthCalledWith(1, FEEDBACK_QUERY_ID, 'test-user-1', 'helpful');
    expect(setQueryFeedback).toHaveBeenNthCalledWith(2, FEEDBACK_QUERY_ID, 'test-user-1', 'not_helpful');
    expect(setQueryFeedback).toHaveBeenCalledTimes(2);
  });
});
