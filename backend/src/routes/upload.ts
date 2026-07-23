/**
 * @file upload.ts
 * @description POST /api/upload — multi-file upload with magic-byte validation and async processing
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import { validateFile, MIME_TO_FILE_TYPE } from '../utils/fileValidator.js';
import { createDocument, deleteDocument } from '../services/vectorStore.js';
import { uploadFile, removeFile } from '../services/storage.js';
import { addDocumentJob } from '../queues/documentQueue.js';
import { UploadRequestSchema } from '../schemas/upload.schema.js';
import { ValidationError, InternalError, type FileType } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const ALLOWED_MIME_TYPES = Object.keys(MIME_TO_FILE_TYPE);

// ─── Multer ───────────────────────────────────────────────────────────────────

/**
 * Multer middleware: memory storage (for magic-byte validation), MIME allowlist filter.
 * Max files (5) and max size are enforced here before any route logic runs.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_FILE_SIZE_MB * 1024 * 1024,
    files: 5,
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new ValidationError(`Unsupported MIME type: ${file.mimetype}`));
    }
  },
});

// ─── Router ───────────────────────────────────────────────────────────────────

const router = Router();

/**
 * Best-effort removal of the staged file from Supabase Storage before a later
 * step failed. Swallows errors — cleanup failing must never mask the
 * original upload error.
 * @param storageKey - Key of the staged file to remove
 * @param correlationId - Request correlation ID for log tracing
 */
async function rollbackFile(storageKey: string, correlationId: string): Promise<void> {
  try {
    await removeFile(storageKey);
  } catch (err) {
    logger.warn('Failed to roll back staged file after upload failure — manual cleanup may be needed', {
      storageKey,
      correlationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Best-effort removal of the Supabase document row created before a later step failed.
 * Swallows errors — cleanup failing must never mask the original upload error.
 * @param documentId - UUID of the row to remove
 * @param userId - Owner, required by deleteDocument's ownership-scoped query
 * @param correlationId - Request correlation ID for log tracing
 */
async function rollbackDocumentRow(
  documentId: string,
  userId: string,
  correlationId: string,
): Promise<void> {
  try {
    await deleteDocument(documentId, userId);
  } catch (err) {
    logger.warn('Failed to roll back document row after upload failure — manual cleanup may be needed', {
      documentId,
      correlationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Processes a single multer file: validates magic bytes, writes to disk,
 * creates a Supabase document record, and enqueues the processing job.
 * If any step after the file write fails, everything that already succeeded
 * is rolled back (in reverse order) so a transient Redis/Supabase blip never
 * leaves an orphaned temp file or a 'pending' row with no queue job ever
 * created to process or clean it up.
 * @param file - Multer file object from memoryStorage
 * @param correlationId - Request correlation ID for logging
 * @returns Object with id, filename, status, jobId for the response
 * @throws {FileValidationError} On magic-byte mismatch or invalid filename
 * @throws {InternalError} On Supabase or queue failure
 */
async function processUploadedFile(
  file: Express.Multer.File,
  correlationId: string,
  userId: string,
): Promise<{ id: string; filename: string; status: 'pending'; jobId: string }> {
  const requestLogger = logger.child({ correlationId });

  const validated = await validateFile(file.buffer, file.originalname, env.MAX_FILE_SIZE_MB);

  const documentId = uuidv4();
  const storageKey = `${documentId}_${validated.sanitizedName}`;
  const fileType: FileType | undefined = MIME_TO_FILE_TYPE[validated.mimeType];
  if (!fileType) {
    // validateFile only ever returns a mimeType present in MIME_TO_FILE_TYPE
    // (both derive from the same FILE_TYPE_TO_MIME source of truth), so this
    // is unreachable in practice — but if it ever drifted, silently labeling
    // a binary file as 'txt' would corrupt the extracted text, so fail loudly.
    throw new InternalError(`No FileType mapping for validated MIME type "${validated.mimeType}"`);
  }

  await uploadFile(storageKey, file.buffer);

  try {
    await createDocument({
      id: documentId,
      filename: storageKey,
      originalName: validated.sanitizedName,
      fileType,
      sizeBytes: validated.sizeBytes,
      userId,
    });
  } catch (err) {
    await rollbackFile(storageKey, correlationId);
    throw err;
  }

  let jobId: string;
  try {
    jobId = await addDocumentJob({
      documentId,
      storageKey,
      fileType,
      originalName: validated.sanitizedName,
      correlationId,
      userId,
    });
  } catch (err) {
    // Reverse order: the row referencing the file must go before the file itself.
    await rollbackDocumentRow(documentId, userId, correlationId);
    await rollbackFile(storageKey, correlationId);
    throw err;
  }

  requestLogger.info('File uploaded and queued', {
    documentId,
    filename: validated.sanitizedName,
    jobId,
  });

  return { id: documentId, filename: validated.sanitizedName, status: 'pending', jobId };
}

/**
 * POST /api/upload
 * Accepts 1–5 files via multipart/form-data (field name: "files").
 * Each file is validated by magic bytes, written to disk, recorded in Supabase,
 * and enqueued for async processing. Returns immediately — does not wait for processing.
 */
router.post(
  '/',
  upload.array('files', 5),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const requestLogger = logger.child({ correlationId: req.correlationId });
    const files = req.files as Express.Multer.File[] | undefined;

    if (!files || files.length === 0) {
      next(new ValidationError('No files provided. Include files in the "files" field.'));
      return;
    }

    // Validate the files array shape with Zod (MIME, size, count)
    const parseResult = UploadRequestSchema.safeParse({ files });
    if (!parseResult.success) {
      next(parseResult.error);
      return;
    }

    const userId = req.auth!.userId;

    // Each file is processed independently — one file's validation/storage
    // failure must not discard the response for files that already
    // succeeded (and already have side effects: disk write, DB row, queue job).
    const settled = await Promise.allSettled(
      files.map((file) => processUploadedFile(file, req.correlationId, userId)),
    );

    const documents = settled
      .filter(
        (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof processUploadedFile>>> =>
          r.status === 'fulfilled',
      )
      .map((r) => r.value);

    const errors = settled
      .map((r, i) => ({ result: r, file: files[i] }))
      .filter(
        (
          entry,
        ): entry is { result: PromiseRejectedResult; file: Express.Multer.File } =>
          entry.result.status === 'rejected',
      )
      .map(({ result, file }) => ({
        filename: file?.originalname ?? 'unknown',
        message: result.reason instanceof Error ? result.reason.message : 'Upload failed',
      }));

    requestLogger.info('Upload batch processed', {
      succeeded: documents.length,
      failed: errors.length,
    });

    if (documents.length === 0) {
      // Every file failed — surface the first failure via the standard error pipeline.
      const firstRejection = settled.find(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      next(firstRejection?.reason ?? new ValidationError('All files failed to upload'));
      return;
    }

    res.status(errors.length > 0 ? 207 : 200).json({
      success: true,
      data: { documents, ...(errors.length > 0 ? { errors } : {}) },
      meta: { correlationId: req.correlationId },
    });
  },
);

export default router;
