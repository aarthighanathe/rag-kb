/**
 * @file errorHandler.ts
 * @description Global Express error-handling middleware — maps all error types to the response envelope
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { type Request, type Response, type NextFunction } from 'express';
import { ZodError } from 'zod';
import multer from 'multer';
import { AppError, InternalError } from '../types/index.js';
import { FileValidationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

// ─── Response shape ───────────────────────────────────────────────────────────

interface ErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  correlationId: string;
}

/**
 * Builds a typed error envelope response body.
 * @param code - Machine-readable error code
 * @param message - Human-readable description
 * @param correlationId - Request correlation ID
 * @param details - Optional structured details (e.g. Zod field errors)
 * @returns ErrorEnvelope object
 */
function envelope(
  code: string,
  message: string,
  correlationId: string,
  details?: unknown,
): ErrorEnvelope {
  const body: ErrorEnvelope = { success: false, error: { code, message }, correlationId };
  if (details !== undefined) body.error.details = details;
  return body;
}

/**
 * Formats Zod issues into a flat array of { field, message } pairs for API consumers.
 * @param err - ZodError from a failed schema parse
 * @returns Array of field-level error descriptors
 */
function formatZodIssues(err: ZodError): Array<{ field: string; message: string }> {
  return err.issues.map((issue) => ({
    field: issue.path.join('.') || 'root',
    message: issue.message,
  }));
}

/**
 * Derives a short SCREAMING_SNAKE_CASE error code from an AppError subclass name.
 * e.g. "ValidationError" → "VALIDATION_ERROR", "NotFoundError" → "NOT_FOUND"
 * @param errorName - constructor.name of the AppError subclass
 * @returns Derived code string
 */
function codeFromName(errorName: string): string {
  return errorName
    .replace(/Error$/, '')
    .replace(/([A-Z])/g, '_$1')
    .toUpperCase()
    .replace(/^_/, '');
}

/**
 * Express 5 global error handler — last middleware in the chain.
 * Handles ZodError, multer.MulterError, FileValidationError, AppError, and unknown errors.
 * Never leaks stack traces in production.
 * @param err - Any thrown or next()ed error
 * @param req - Express request (for correlationId)
 * @param res - Express response
 * @param _next - Required by Express 4-arity signature but unused
 */
// ─── Branch handlers (each handles one error type) ────────────────────────────

/** Handles ZodError → 422 with field-level details. */
function handleZodError(err: ZodError, res: Response, correlationId: string): void {
  const details = formatZodIssues(err);
  logger.warn('Schema validation failed', { correlationId, issues: details });
  res
    .status(422)
    .json(envelope('UNPROCESSABLE_ENTITY', 'Validation failed', correlationId, details));
}

/** Handles multer.MulterError → 413 (size) or 400 (other). */
function handleMulterError(err: multer.MulterError, res: Response, correlationId: string): void {
  logger.warn('Multer upload error', { correlationId, code: err.code, message: err.message });
  // LIMIT_FILE_SIZE → 413; all other multer codes → 400
  const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
  const message =
    err.code === 'LIMIT_FILE_SIZE' ? 'File exceeds the maximum allowed size' : err.message;
  res.status(status).json(envelope(err.code, message, correlationId));
}

/** Handles FileValidationError (magic-byte mismatch, path traversal, etc.) → 4xx. */
function handleFileValidationError(
  err: FileValidationError,
  res: Response,
  correlationId: string,
): void {
  logger.warn('File validation error', { correlationId, code: err.code, message: err.message });
  res.status(err.statusCode).json(envelope(err.code, err.message, correlationId));
}

/** Generic message shown for InternalError in production instead of the raw (possibly DB-derived) message. */
const GENERIC_INTERNAL_MESSAGE = 'Internal server error';

/** Handles AppError subclasses (ValidationError, NotFoundError, etc.). */
function handleAppError(err: AppError, res: Response, correlationId: string): void {
  // Prefer an explicit machine-readable code when the error carries one
  // (e.g. InternalError's optional sub-code from dbError.ts) over the
  // generic name-derived code, so clients can distinguish sub-cases like
  // "DB unreachable" from "schema not migrated" without message-sniffing.
  const explicitCode = 'code' in err && typeof err.code === 'string' ? err.code : undefined;
  const code = explicitCode ?? codeFromName(err.name);
  const logPayload = {
    correlationId,
    statusCode: err.statusCode,
    message: err.message,
    meta: err.meta,
  };

  if (err.isOperational) {
    logger.warn('Operational error', logPayload);
  } else {
    logger.error('Non-operational error', { ...logPayload, stack: err.stack });
  }

  // InternalError (raised by dbError.ts's fallback branch, among others) can
  // embed raw Supabase/PostgREST text — table names, constraint names. Every
  // other AppError subclass (ValidationError, NotFoundError, etc.) has an
  // intentionally user-facing message, so only InternalError is gated here,
  // matching how handleUnknownError already hides messages in production.
  const clientMessage =
    err instanceof InternalError && env.NODE_ENV === 'production'
      ? GENERIC_INTERNAL_MESSAGE
      : err.message;

  res.status(err.statusCode).json(envelope(code, clientMessage, correlationId, err.meta));
}

/** Handles unknown / unexpected errors → 500. Never leaks stack in production. */
function handleUnknownError(err: unknown, res: Response, correlationId: string): void {
  const message = err instanceof Error ? err.message : 'An unexpected error occurred';
  logger.error('Unexpected error', {
    correlationId,
    message,
    stack: err instanceof Error ? err.stack : undefined,
  });

  res
    .status(500)
    .json(
      envelope(
        'INTERNAL_ERROR',
        env.NODE_ENV === 'production' ? 'Internal server error' : message,
        correlationId,
      ),
    );
}

// ─── Main dispatcher ──────────────────────────────────────────────────────────

/**
 * Express 5 global error handler — last middleware in the chain.
 * Dispatches to a dedicated handler per error type.
 * Never leaks stack traces in production.
 * Complexity: O(1) — each branch is a single function call.
 * @param err - Any thrown or next()ed error
 * @param req - Express request (for correlationId)
 * @param res - Express response
 * @param _next - Required by Express 4-arity signature but unused
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const correlationId = req.correlationId ?? 'unknown';

  if (err instanceof ZodError) {
    handleZodError(err, res, correlationId);
    return;
  }
  if (err instanceof multer.MulterError) {
    handleMulterError(err, res, correlationId);
    return;
  }
  if (err instanceof FileValidationError) {
    handleFileValidationError(err, res, correlationId);
    return;
  }
  if (err instanceof AppError) {
    handleAppError(err, res, correlationId);
    return;
  }

  handleUnknownError(err, res, correlationId);
}
