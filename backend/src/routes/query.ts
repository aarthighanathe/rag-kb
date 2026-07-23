/**
 * @file query.ts
 * @description POST /api/query (initiate) + GET /api/query/stream (SSE) — two-step RAG query
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  QueryRequestSchema,
  QueryStreamParamsSchema,
  QueryFeedbackParamSchema,
  QueryFeedbackRequestSchema,
  type QueryRequest,
  type QueryFeedbackParam,
  type QueryFeedbackRequest,
} from '../schemas/query.schema.js';
import { embedText } from '../services/embedder.js';
import { similaritySearch, logQuery, setQueryFeedback } from '../services/vectorStore.js';
import { streamAnswer, extractCitations, setSseHeaders } from '../services/llm.js';
import { sanitizeQueryText } from '../utils/sanitize.js';
import { logger } from '../utils/logger.js';
import { NotFoundError } from '../types/index.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const QUERY_TTL_MS = 2 * 60 * 1000; // 2 minutes
const SSE_TIMEOUT_MS = 60 * 1000; // 60s hard timeout — kills hung Groq streams
const PENDING_QUERY_SWEEP_INTERVAL_MS = 60 * 1000; // sweep expired entries once a minute

interface PendingQuery {
  params: QueryRequest;
  correlationId: string;
  expiresAt: number;
  /**
   * Owner captured from the verified JWT at POST time. The GET /stream endpoint
   * is opened via native EventSource, which cannot attach an Authorization header,
   * so it does not re-authenticate — it inherits this userId instead. The queryId
   * itself is the capability: an unguessable UUID, scoped by TTL, and only ever
   * handed to the user who created it.
   */
  userId: string;
}

/**
 * A GET /stream attempt against this entry does NOT delete it (see
 * claimPendingQuery) — a dropped connection's exponential-backoff reconnect
 * (useSSE.ts) targets the same queryId, and deleting on first GET made every
 * such reconnect 404 unconditionally, defeating Rule 17's reconnect
 * requirement. Instead the entry lives until the stream finishes
 * (finalizePendingQuery) or its TTL sweeps it, so a reconnect within the TTL
 * window re-claims it and restarts the query (search + generation) rather
 * than failing outright — there is no server-side token buffer to truly
 * resume a partial answer from.
 */

const pendingQueries = new Map<string, PendingQuery>();

/**
 * Stores validated query params keyed by a new UUID.
 * @param params - Validated QueryRequest from Zod
 * @param correlationId - Request correlation ID
 * @param userId - Authenticated owner of this query (from req.auth.userId)
 * @returns The generated queryId
 */
function storePendingQuery(params: QueryRequest, correlationId: string, userId: string): string {
  const queryId = uuidv4();
  pendingQueries.set(queryId, {
    params,
    correlationId,
    expiresAt: Date.now() + QUERY_TTL_MS,
    userId,
  });
  return queryId;
}

/**
 * Retrieves a pending query without deleting it — a subsequent GET /stream
 * reconnect against the same queryId (e.g. after a network blip) must still
 * find it. Returns null if not found or expired.
 * @param queryId - UUID returned by POST /api/query
 * @returns PendingQuery or null
 */
function claimPendingQuery(queryId: string): PendingQuery | null {
  const entry = pendingQueries.get(queryId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    pendingQueries.delete(queryId);
    return null;
  }
  return entry;
}

/**
 * Removes a pending query once its stream has genuinely finished (completed,
 * errored terminally, or timed out) — as opposed to a mid-stream disconnect,
 * which must leave the entry in place for a reconnect to re-claim.
 * @param queryId - UUID returned by POST /api/query
 */
function finalizePendingQuery(queryId: string): void {
  pendingQueries.delete(queryId);
}

/**
 * Periodically evicts expired entries from `pendingQueries`, independent of
 * whether the client ever opens GET /stream. Without this sweep, a client
 * that posts queries and never opens the matching SSE stream grows this
 * process-local Map without bound — since it's in-memory (not Redis-backed),
 * sustained abuse (bounded only by the query rate limit) degrades or crashes
 * the Node process. `unref()` so this timer never keeps the process alive on
 * its own during graceful shutdown.
 */
const pendingQuerySweepTimer = setInterval(() => {
  const now = Date.now();
  let evicted = 0;
  for (const [queryId, entry] of pendingQueries) {
    if (now > entry.expiresAt) {
      pendingQueries.delete(queryId);
      evicted++;
    }
  }
  if (evicted > 0) {
    logger.debug('Swept expired pending queries', { evicted, remaining: pendingQueries.size });
  }
}, PENDING_QUERY_SWEEP_INTERVAL_MS);
pendingQuerySweepTimer.unref();

// ─── SSE helpers ──────────────────────────────────────────────────────────────

/**
 * Writes a named SSE event to the response.
 * @param res - Express response with SSE headers set
 * @param eventType - SSE event name (searching | found | generating | token | complete | error)
 * @param data - JSON-serialisable payload
 */
function sendSseEvent(res: Response, eventType: string, data: Record<string, unknown>): void {
  res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ─── Router ───────────────────────────────────────────────────────────────────

const router = Router();

/**
 * POST /api/query
 * Validates the query parameters and stores them server-side for up to 2 minutes.
 * Returns a queryId that the client must pass to GET /api/query/stream.
 * Requires authentication — the resulting queryId is scoped to the caller's userId.
 */
router.post('/', requireAuth, validate(QueryRequestSchema), (req: Request, res: Response): void => {
  const params = req.body as QueryRequest;
  const queryId = storePendingQuery(params, req.correlationId, req.auth!.userId);

  logger.info('Query registered', {
    correlationId: req.correlationId,
    queryId,
    queryLength: params.query.length,
  });

  res.json({
    success: true,
    data: { queryId },
    meta: { correlationId: req.correlationId },
  });
});

/**
 * POST /api/query/:queryId/feedback
 * Records (or updates) whether a completed query's answer was helpful.
 *
 * `:queryId` here is the `query_logs` row id returned in the SSE `complete`
 * event's payload — NOT the ephemeral pending-query UUID used by POST / and
 * GET /stream, which is deleted the moment the stream starts and can't be
 * reused as a durable reference once the answer has finished streaming.
 *
 * Ownership is checked in the same query as the update (setQueryFeedback),
 * matching the getDocument/deleteDocument IDOR-prevention pattern: a
 * mismatched owner or nonexistent queryId both surface as the same 404,
 * so an attacker probing query IDs from another account can never
 * distinguish "not yours" from "doesn't exist". Idempotent — resubmitting
 * feedback for the same query overwrites the prior value via UPDATE rather
 * than erroring or inserting a duplicate.
 */
router.post(
  '/:queryId/feedback',
  requireAuth,
  validate(QueryFeedbackParamSchema, 'params'),
  validate(QueryFeedbackRequestSchema, 'body'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { queryId } = req.params as unknown as QueryFeedbackParam;
    const { feedback } = req.body as QueryFeedbackRequest;
    const userId = req.auth!.userId;

    try {
      await setQueryFeedback(queryId, userId, feedback);
      logger.info('Query feedback recorded', {
        correlationId: req.correlationId,
        queryId,
        feedback,
      });
      res.json({
        success: true,
        data: { queryId, feedback },
        meta: { correlationId: req.correlationId },
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * Per-connection SSE state and helpers shared across the stream stages below.
 * Grouping these into one object (rather than inlining them in the route
 * handler) is what lets each stage live in its own top-level function —
 * the prior single ~180-line handler measured cyclomatic complexity ~15
 * against CLAUDE.md's Rule 8 ceiling of 10.
 */
interface StreamContext {
  res: Response;
  req: Request;
  queryId: string;
  requestLogger: ReturnType<typeof logger.child>;
  isConnected: () => boolean;
  emit: (eventType: string, data: Record<string, unknown>) => void;
  endStream: () => void;
  clearSseTimeout: () => void;
  groqSignal: AbortSignal;
  /**
   * True once endStream() has actually closed the response (a genuine
   * terminal outcome: complete, error, or timeout — all reached
   * `emit('complete'|'error', ...)` before ending). False if the client's
   * TCP connection dropped first (req 'close' fired), leaving the pipeline
   * to unwind via the `isConnected()` early-return guards instead. The route
   * handler uses this to decide whether to finalizePendingQuery (delete) or
   * leave the entry claimed for a reconnect to pick back up.
   */
  didFinish: () => boolean;
}

/**
 * Builds the per-connection SSE context: headers, disconnect tracking, the
 * 60s hard timeout, and the emit/end helpers every stage below shares.
 * @param req - Express request (for the 'close' event and correlationId)
 * @param res - Express response to write SSE frames to
 * @param queryId - Pending query UUID, for log correlation
 * @param requestLogger - Logger pre-bound with correlationId/queryId
 * @returns StreamContext plus the AbortController driving `groqSignal`
 */
function createStreamContext(
  req: Request,
  res: Response,
  queryId: string,
  requestLogger: ReturnType<typeof logger.child>,
): StreamContext {
  setSseHeaders(res);

  let connected = true;
  let finished = false;

  // Aborts the in-flight Groq fetch the instant the 60s timeout fires, so a
  // slow/hung upstream stream doesn't keep running (and burning tokens) after
  // the client has already been told the request timed out. Deliberately a
  // standalone AbortController rather than the BullMQ job-attempt registry in
  // queues/cancellation.ts: that registry supersedes retries of the same
  // durable job ID, whereas this timeout is a one-shot, per-HTTP-connection
  // cutoff with no retry concept — the two don't share a lifecycle model, so
  // they intentionally remain separate cancellation mechanisms.
  const groqAbortController = new AbortController();

  req.on('close', () => {
    connected = false;
    // Without this, clicking "Stop" (which just closes the client's
    // EventSource) left the for-await loop in doGroqStream consuming tokens
    // from Groq until the stream ended naturally or the 60s timeout fired —
    // burning cost and continuing generation the user believed was cancelled.
    groqAbortController.abort('client-disconnected');
    requestLogger.info('SSE client disconnected', { queryId });
  });

  const emit = (eventType: string, data: Record<string, unknown>): void => {
    if (connected) sendSseEvent(res, eventType, data);
  };

  // Ends the response exactly once, only if the connection is still open —
  // without this guard, a Groq stream finishing just after the 60s timeout
  // fires would double-`res.end()` and still write a query log for a
  // request the client was already told had timed out.
  const endStream = (): void => {
    if (!connected) return;
    connected = false;
    finished = true;
    res.end();
  };

  const sseTimeout = setTimeout(() => {
    groqAbortController.abort('sse-timeout');
    if (connected) {
      emit('error', { type: 'error', message: 'Stream timed out after 60s' });
      endStream();
      requestLogger.warn('SSE stream timed out', { queryId });
    }
  }, SSE_TIMEOUT_MS);

  return {
    res,
    req,
    queryId,
    requestLogger,
    isConnected: () => connected,
    emit,
    endStream,
    clearSseTimeout: () => clearTimeout(sseTimeout),
    groqSignal: groqAbortController.signal,
    didFinish: () => finished,
  };
}

/**
 * Handles the zero-results branch: logs the query with no chunks and no
 * generation, then emits `complete` immediately.
 * @param ctx - Active stream context
 * @param safeQuery - Sanitised query text
 * @param userId - Authenticated owner of the query
 * @param startTime - `Date.now()` at stream start, for latency_ms
 */
async function handleNoChunksFound(
  ctx: StreamContext,
  safeQuery: string,
  userId: string,
  startTime: number,
): Promise<void> {
  ctx.clearSseTimeout();
  ctx.requestLogger.info('No chunks found for query', { queryId: ctx.queryId });
  // Awaited (unlike the historical fire-and-forget pattern) because the
  // client needs the inserted row's id in the `complete` payload to later
  // call POST /api/query/:queryId/feedback. Wrapped in try/catch so a
  // logging failure still can't block or fail the response; queryLogId is
  // simply omitted (feedback becomes unavailable for this one query, not a
  // user-facing error).
  const queryLogId = await logQuery({
    query_text: safeQuery,
    retrieved_chunk_ids: [],
    response_preview: '',
    latency_ms: Date.now() - startTime,
    user_id: userId,
  }).catch((err: unknown) => {
    ctx.requestLogger.warn('Failed to log query', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  });
  ctx.emit('complete', { type: 'complete', citations: [], queryLogId });
  ctx.endStream();
}

/** Chunks retrieved from similaritySearch, passed through to generation + logging. */
type RetrievedChunk = Awaited<ReturnType<typeof similaritySearch>>[number];

/**
 * Runs LLM generation over the retrieved chunks and streams tokens, then
 * logs the completed query and emits `complete`.
 * @param ctx - Active stream context
 * @param chunks - Chunks retrieved from similaritySearch
 * @param citationChips - Citation view of `chunks`, echoed in the `complete` payload
 * @param safeQuery - Sanitised query text
 * @param userId - Authenticated owner of the query
 * @param history - Prior conversation turns for multi-turn context
 * @param startTime - `Date.now()` at stream start, for latency_ms
 */
async function streamGeneratedAnswer(
  ctx: StreamContext,
  chunks: RetrievedChunk[],
  citationChips: ReturnType<typeof extractCitations>,
  safeQuery: string,
  userId: string,
  history: QueryRequest['history'],
  startTime: number,
): Promise<void> {
  let fullText = '';

  await streamAnswer(
    { chunks, query: safeQuery },
    history,
    {
      onChunk: (text) => {
        fullText += text;
        ctx.emit('token', { type: 'token', content: text });
      },
      onComplete: () => {
        ctx.clearSseTimeout();
        // If the timeout already fired and ended the response, the client
        // has moved on — skip the (costly) query log write and the emit,
        // both of which would otherwise fire for a request already told it
        // timed out.
        if (!ctx.isConnected()) return;
        // Not awaited here (StreamOptions.onComplete is a sync callback, and
        // doGroqStream doesn't await it — see llm.ts), so the async work
        // below is self-contained with its own try/catch. It must never
        // throw out of this closure: an unhandled rejection here wouldn't
        // have anywhere to be caught. logQuery is awaited (unlike the
        // historical fire-and-forget pattern) because the client needs the
        // inserted row's id in the `complete` payload.
        void (async (): Promise<void> => {
          const queryLogId = await logQuery({
            query_text: safeQuery,
            retrieved_chunk_ids: chunks.map((c) => c.id),
            response_preview: fullText.slice(0, 200),
            latency_ms: Date.now() - startTime,
            user_id: userId,
          }).catch((err: unknown) => {
            ctx.requestLogger.warn('Failed to log query', {
              error: err instanceof Error ? err.message : String(err),
            });
            return null;
          });
          ctx.emit('complete', { type: 'complete', citations: citationChips, queryLogId });
          ctx.endStream();
          ctx.requestLogger.info('Query stream completed', {
            queryId: ctx.queryId,
            chunkCount: chunks.length,
            historyLength: history.length,
          });
        })();
      },
      onError: (err) => {
        ctx.clearSseTimeout();
        ctx.emit('error', { type: 'error', message: err.message });
        ctx.endStream();
        ctx.requestLogger.error('LLM stream error', { queryId: ctx.queryId, error: err.message });
      },
    },
    ctx.groqSignal,
  );
}

/**
 * Runs the full retrieve-then-generate pipeline for one SSE connection:
 * embed the query, vector search, and either report zero results or stream
 * a generated answer. Left to the caller's try/catch for unexpected errors.
 * @param ctx - Active stream context
 * @param pending - The claimed PendingQuery (params + owner)
 */
async function runQueryStream(ctx: StreamContext, pending: PendingQuery): Promise<void> {
  const { params, userId } = pending;
  const startTime = Date.now();

  ctx.emit('searching', { type: 'searching', message: 'Finding relevant chunks...' });

  // Sanitize before embedding — strips HTML tags, null bytes, normalises whitespace
  const safeQuery = sanitizeQueryText(params.query);
  const { embedding } = await embedText(safeQuery);
  if (!ctx.isConnected()) {
    // Client already gone — nothing left to time out. Clear now rather than
    // leaving the 60s timer to expire on its own; under a burst of
    // disconnects those dangling timers would otherwise accumulate.
    ctx.clearSseTimeout();
    return;
  }

  const chunks = await similaritySearch(
    embedding,
    params.matchCount,
    userId,
    params.documentIds,
    params.similarityThreshold,
  );
  if (!ctx.isConnected()) {
    ctx.clearSseTimeout();
    return;
  }

  const citationChips = extractCitations(chunks);
  ctx.emit('found', { type: 'found', chunks: citationChips });

  if (chunks.length === 0) {
    await handleNoChunksFound(ctx, safeQuery, userId, startTime);
    return;
  }

  ctx.emit('generating', { type: 'generating', message: 'Generating answer...' });
  await streamGeneratedAnswer(ctx, chunks, citationChips, safeQuery, userId, params.history, startTime);
}

/**
 * GET /api/query/stream?queryId=<uuid>
 * Opens an SSE stream for a previously registered query.
 *
 * Stream sequence:
 *   1. event: searching  — vector search starting
 *   2. event: found      — retrieved CitationChips
 *   3. event: generating — LLM inference starting
 *   4. event: token      — incremental LLM token (repeats)
 *   5. event: complete   — final citations, connection closes
 *   On failure: event: error, connection closes
 *
 * A reconnect (useSSE.ts's exponential backoff) that targets the same
 * queryId after a mid-stream drop re-claims the still-live pending entry
 * and restarts retrieval + generation from scratch, rather than 404ing —
 * see PendingQuery.claimed for why the entry isn't deleted on first GET.
 */
router.get(
  '/stream',
  validate(QueryStreamParamsSchema, 'query'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { queryId } = req.query as unknown as { queryId: string };

    const pending = claimPendingQuery(queryId);
    if (!pending) {
      next(new NotFoundError('Query not found or expired (TTL: 2 minutes)'));
      return;
    }

    const requestLogger = logger.child({ correlationId: pending.correlationId, queryId });
    const ctx = createStreamContext(req, res, queryId, requestLogger);

    try {
      await runQueryStream(ctx, pending);
      // Only delete the entry once the stream reached a genuine terminal
      // outcome (complete/error/timeout — ctx.didFinish()). If the client's
      // connection dropped mid-flight, runQueryStream returns normally via
      // its isConnected() guards without ever finishing — the entry must
      // stay claimed so a reconnect against this queryId can retry the
      // pipeline instead of 404ing.
      if (ctx.didFinish()) finalizePendingQuery(queryId);
    } catch (err) {
      ctx.clearSseTimeout();
      if (!res.headersSent) {
        finalizePendingQuery(queryId);
        next(err);
      } else {
        const message = err instanceof Error ? err.message : 'Query failed';
        ctx.emit('error', { type: 'error', message });
        ctx.endStream();
        finalizePendingQuery(queryId);
        requestLogger.error('Unexpected error in SSE stream', { queryId, error: message });
      }
    }
  },
);

export default router;
