/**
 * @file documents.ts
 * @description GET /api/documents, GET /api/documents/similarity, GET /api/documents/:id, DELETE /api/documents/:id
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { validate } from '../middleware/validate.js';
import {
  ListDocumentsQuerySchema,
  DocumentIdParamSchema,
  SimilarityQuerySchema,
  type ListDocumentsQuery,
  type SimilarityQuery,
} from '../schemas/document.schema.js';
import { listDocuments, getDocument, deleteDocument, computeDocumentSimilarity, getChunkQualityStats } from '../services/vectorStore.js';
import { cancelDocumentJob } from '../queues/documentQueue.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * GET /api/documents
 * Returns a paginated list of all uploaded documents with optional status filter.
 * Pagination metadata is in the `meta` envelope field.
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
      const [pairs, { data: docs }] = await Promise.all([
        computeDocumentSimilarity(threshold, userId),
        listDocuments(1, 100, 'ready', userId),
      ]);

      requestLogger.info('Document similarity computed', { pairCount: pairs.length, threshold });
      res.json({
        success: true,
        data: { pairs, documents: docs },
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
 * DELETE /api/documents/:id
 * Permanently deletes a document and all its associated vector chunks (cascade via DB constraint).
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
      await getDocument(id, userId);

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
