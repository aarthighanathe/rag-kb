/**
 * @file documents.ts
 * @description GET /api/documents, GET /api/documents/similarity, GET /api/documents/suggested-topics, GET /api/documents/:id, PATCH /api/documents/:id/tags, DELETE /api/documents/:id
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  ListDocumentsQuerySchema,
  DocumentIdParamSchema,
  SimilarityQuerySchema,
  SuggestedTopicsQuerySchema,
  UpdateDocumentTagsRequestSchema,
  type ListDocumentsQuery,
  type SimilarityQuery,
  type SuggestedTopicsQuery,
  type UpdateDocumentTagsRequest,
} from '../schemas/document.schema.js';
import {
  listDocuments,
  getDocument,
  deleteDocument,
  computeDocumentSimilarity,
  getChunkQualityStats,
  getSuggestedTopics,
  setDocumentTags,
} from '../services/vectorStore.js';
import { cancelDocumentJob } from '../queues/documentQueue.js';
import { logger } from '../utils/logger.js';
import { logDocumentDelete } from '../utils/auditLogger.js';

const router = Router();

/**
 * GET /api/documents
 * Returns a paginated list of all uploaded documents with optional status filter.
 * Pagination metadata is in the `meta` envelope field.
 * @param req - Express request; `req.query` carries the Zod-validated page/limit/status, `req.auth.userId` the caller
 * @param res - Express response, sent as `{ success, data, meta }`
 * @param next - Forwards any thrown error to the central error handler
 * @returns Resolves once the response has been sent or the error forwarded
 */
router.get(
  '/',
  validate(ListDocumentsQuerySchema, 'query'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // After validate middleware, req.query is replaced with Zod-coerced data
    const { page, limit, status } = req.query as unknown as ListDocumentsQuery;
    const userId = req.auth!.userId;

    try {
      const { data, total } = await listDocuments(page, limit, status, userId);
      res.json({
        success: true,
        data,
        meta: { page, total, correlationId: req.correlationId },
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/documents/similarity
 * Returns pairwise document similarity scores for the relationship map.
 * MUST be mounted before /:id to avoid Express matching "similarity" as a UUID.
 * @param req - Express request; `req.query.threshold` is the Zod-validated similarity floor, `req.auth.userId` the caller
 * @param res - Express response, sent as `{ success, data: { pairs, documents, capped, readyDocumentCount }, meta }`
 * @param next - Forwards any thrown error to the central error handler
 * @returns Resolves once the response has been sent or the error forwarded
 */
router.get(
  '/similarity',
  validate(SimilarityQuerySchema, 'query'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { threshold } = req.query as unknown as SimilarityQuery;
    const userId = req.auth!.userId;
    const requestLogger = logger.child({ correlationId: req.correlationId });

    try {
      // computeDocumentSimilarity and listDocuments are independent reads
      // (both separately query the user's 'ready' documents) — running them
      // concurrently instead of sequentially halves this endpoint's latency.
      const [result, { data: docs }] = await Promise.all([
        computeDocumentSimilarity(threshold, userId),
        listDocuments(1, 100, 'ready', userId),
      ]);

      requestLogger.info('Document similarity computed', {
        pairCount: result.pairs.length,
        threshold,
        capped: result.capped,
        readyDocumentCount: result.readyDocumentCount,
      });
      res.json({
        success: true,
        data: {
          pairs: result.pairs,
          documents: docs,
          capped: result.capped,
          readyDocumentCount: result.readyDocumentCount,
        },
        meta: { correlationId: req.correlationId },
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/documents/suggested-topics
 * Returns distinct section headings drawn from the given documents' chunks,
 * for building content-aware query suggestions in the chat UI.
 * MUST be mounted before /:id to avoid Express matching "suggested-topics" as a UUID.
 * @param req - Express request; `req.query.documentIds` is the Zod-validated UUID array, `req.auth.userId` the caller
 * @param res - Express response, sent as `{ success, data: { topics }, meta }`
 * @param next - Forwards any thrown error to the central error handler
 * @returns Resolves once the response has been sent or the error forwarded
 */
router.get(
  '/suggested-topics',
  requireAuth,
  validate(SuggestedTopicsQuerySchema, 'query'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { documentIds } = req.query as unknown as SuggestedTopicsQuery;
    const userId = req.auth!.userId;

    try {
      const topics = await getSuggestedTopics(documentIds, userId);
      res.json({
        success: true,
        data: { topics },
        meta: { correlationId: req.correlationId },
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/documents/:id
 * Returns metadata for a single document by UUID.
 * @param req - Express request; `req.params.id` is the Zod-validated document UUID, `req.auth.userId` the caller
 * @param res - Express response, sent as `{ success, data: { document, chunkQuality }, meta }`
 * @param next - Forwards any thrown error (e.g. NotFoundError for a missing/foreign document) to the central error handler
 * @returns Resolves once the response has been sent or the error forwarded
 */
router.get(
  '/:id',
  validate(DocumentIdParamSchema, 'params'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { id } = req.params as { id: string };
    const userId = req.auth!.userId;
    try {
      const document = await getDocument(id, userId);
      let chunkQuality = null;
      if (document.status === 'ready') {
        chunkQuality = await getChunkQualityStats(id, userId);
      }
      res.json({
        success: true,
        data: { document, chunkQuality },
        meta: { correlationId: req.correlationId },
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * PATCH /api/documents/:id/tags
 * Replaces a document's full tag list (auto-derived and/or manually-added tags
 * share this one field). Ownership is enforced by setDocumentTags itself,
 * which throws NotFoundError for a mismatched owner — collapsing to the same
 * 404 as "doesn't exist", consistent with every other per-user mutation here.
 * @param req - Express request; `req.params.id` is the document UUID, `req.body.tags` the Zod-validated replacement tag list, `req.auth.userId` the caller
 * @param res - Express response, sent as `{ success, data: { documentId, tags }, meta }`
 * @param next - Forwards any thrown error (e.g. NotFoundError for a missing/foreign document) to the central error handler
 * @returns Resolves once the response has been sent or the error forwarded
 */
router.patch(
  '/:id/tags',
  requireAuth,
  validate(DocumentIdParamSchema, 'params'),
  validate(UpdateDocumentTagsRequestSchema, 'body'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { id } = req.params as { id: string };
    const { tags } = req.body as UpdateDocumentTagsRequest;
    const userId = req.auth!.userId;

    try {
      await setDocumentTags(id, userId, tags);
      res.json({
        success: true,
        data: { documentId: id, tags },
        meta: { correlationId: req.correlationId },
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /api/documents/:id
 * Permanently deletes a document and all its associated vector chunks (cascade via DB constraint).
 * @param req - Express request; `req.params.id` is the Zod-validated document UUID, `req.auth.userId` the caller
 * @param res - Express response, sent as `{ success, data: { documentId, message }, meta }`
 * @param next - Forwards any thrown error (e.g. NotFoundError for a missing/foreign document) to the central error handler
 * @returns Resolves once the response has been sent or the error forwarded
 */
router.delete(
  '/:id',
  validate(DocumentIdParamSchema, 'params'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { id } = req.params as { id: string };
    const userId = req.auth!.userId;
    const requestLogger = logger.child({ correlationId: req.correlationId });

    try {
      // Verify ownership first (throws NotFoundError for a mismatched owner,
      // collapsing to the same 404 as "doesn't exist" — consistent with every
      // other per-user lookup in vectorStore.ts) before touching the queue.
      // Without this check first, an authenticated caller who merely knows/
      // guesses another user's documentId could cancel that user's in-flight
      // job before ever hitting the ownership gate.
      const document = await getDocument(id, userId);

      // Cancel any in-flight/queued processing job before the SQL delete —
      // otherwise the worker keeps burning HuggingFace embedding calls and
      // then fails on upsertChunks trying to insert chunks for a document_id
      // that no longer exists. Best-effort: a cancellation failure must not
      // block the delete itself, since the row disappearing is what matters
      // most to the user, and the worker's own signal checks are defense in
      // depth against any write that does still slip through.
      await cancelDocumentJob(id).catch((err: unknown) => {
        requestLogger.warn('Failed to cancel document job before delete', {
          documentId: id,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      await deleteDocument(id, userId);
      requestLogger.info('Document deleted', { documentId: id });
      logDocumentDelete(userId, id, document.filename, true, req.correlationId);
      res.json({
        success: true,
        data: { documentId: id, message: 'Document deleted successfully.' },
        meta: { correlationId: req.correlationId },
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
