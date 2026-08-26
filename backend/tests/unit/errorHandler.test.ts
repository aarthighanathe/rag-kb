/**
 * @file errorHandler.test.ts
 * @description Unit tests for the global Express error handler — dispatch to
 *   the correct branch per error type (ZodError, MulterError, FileValidationError,
 *   AppError subclasses, unknown errors), status codes, envelope shape, and
 *   production-mode message redaction for InternalError / unknown errors.
 * @author [Author Placeholder]
 * @created 2026-08-24
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import multer from 'multer';
import type { Request, Response, NextFunction } from 'express';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: { NODE_ENV: 'test' as 'test' | 'production' | 'development' },
}));

vi.mock('../../src/config/env', () => ({ env: mockEnv }));

vi.mock('../../src/utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { errorHandler } from '../../src/middleware/errorHandler';
import { ValidationError, NotFoundError, InternalError } from '../../src/types/index';
import { FileValidationError, FileValidationErrorCode } from '../../src/utils/errors';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(correlationId = 'corr-123'): Request {
  return { correlationId } as unknown as Request;
}

function makeRes(): Response {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

const noopNext = vi.fn() as unknown as NextFunction;

beforeEach(() => {
  mockEnv.NODE_ENV = 'test';
  vi.clearAllMocks();
});

// ─── ZodError ─────────────────────────────────────────────────────────────────

describe('errorHandler — ZodError', () => {
  it('returns 422 with UNPROCESSABLE_ENTITY code and field-level details', () => {
    const schema = z.object({ query: z.string().min(3) });
    const result = schema.safeParse({ query: 'ab' });
    if (result.success) throw new Error('expected schema to fail');

    const req = makeReq();
    const res = makeRes();

    errorHandler(result.error, req, res, noopNext);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'UNPROCESSABLE_ENTITY',
          message: 'Validation failed',
          details: [{ field: 'query', message: expect.any(String) as unknown }],
        }),
        correlationId: 'corr-123',
      }),
    );
  });

  it('formats a root-level issue (empty path) as field "root"', () => {
    const schema = z.string();
    const result = schema.safeParse(123);
    if (result.success) throw new Error('expected schema to fail');

    const res = makeRes();
    errorHandler(result.error, makeReq(), res, noopNext);

    const [body] = (res.json as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      { error: { details: Array<{ field: string }> } },
    ];
    expect(body.error.details[0]?.field).toBe('root');
  });
});

// ─── multer.MulterError ───────────────────────────────────────────────────────

describe('errorHandler — multer.MulterError', () => {
  it('returns 413 for LIMIT_FILE_SIZE with a generic message', () => {
    const err = new multer.MulterError('LIMIT_FILE_SIZE');
    const res = makeRes();

    errorHandler(err, makeReq(), res, noopNext);

    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'LIMIT_FILE_SIZE',
          message: 'File exceeds the maximum allowed size',
        }),
      }),
    );
  });

  it('returns 400 for any other multer error code, using the raw multer message', () => {
    const err = new multer.MulterError('LIMIT_UNEXPECTED_FILE');
    const res = makeRes();

    errorHandler(err, makeReq(), res, noopNext);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'LIMIT_UNEXPECTED_FILE' }),
      }),
    );
  });
});

// ─── FileValidationError ──────────────────────────────────────────────────────

describe('errorHandler — FileValidationError', () => {
  it('uses the error\'s own statusCode, code, and message', () => {
    const err = new FileValidationError(
      'Unsupported MIME type: text/html',
      FileValidationErrorCode.UNSUPPORTED_TYPE,
      400,
    );
    const res = makeRes();

    errorHandler(err, makeReq(), res, noopNext);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: {
          code: FileValidationErrorCode.UNSUPPORTED_TYPE,
          message: 'Unsupported MIME type: text/html',
        },
      }),
    );
  });
});

// ─── AppError subclasses ──────────────────────────────────────────────────────

describe('errorHandler — AppError subclasses', () => {
  it('returns 400 with a name-derived code for ValidationError', () => {
    const err = new ValidationError('query must be at least 3 characters');
    const res = makeRes();

    errorHandler(err, makeReq(), res, noopNext);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: { code: 'VALIDATION', message: 'query must be at least 3 characters' },
      }),
    );
  });

  it('returns 404 with a name-derived code for NotFoundError', () => {
    const err = new NotFoundError('Document abc123 not found');
    const res = makeRes();

    errorHandler(err, makeReq(), res, noopNext);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: { code: 'NOT_FOUND', message: 'Document abc123 not found' } }),
    );
  });

  it('prefers an explicit sub-code over the name-derived code when present', () => {
    const err = new InternalError('DB connection refused', 'DB_CONNECTIVITY');
    const res = makeRes();

    errorHandler(err, makeReq(), res, noopNext);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'DB_CONNECTIVITY' }) }),
    );
  });

  it('shows the real InternalError message outside production', () => {
    mockEnv.NODE_ENV = 'test';
    const err = new InternalError('relation "documents" does not exist');
    const res = makeRes();

    errorHandler(err, makeReq(), res, noopNext);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: 'relation "documents" does not exist' }),
      }),
    );
  });

  it('redacts the InternalError message to a generic string in production', () => {
    mockEnv.NODE_ENV = 'production';
    const err = new InternalError('relation "documents" does not exist');
    const res = makeRes();

    errorHandler(err, makeReq(), res, noopNext);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: 'Internal server error' }),
      }),
    );
  });

  it('does NOT redact a non-InternalError AppError message in production (e.g. NotFoundError)', () => {
    mockEnv.NODE_ENV = 'production';
    const err = new NotFoundError('Document abc123 not found');
    const res = makeRes();

    errorHandler(err, makeReq(), res, noopNext);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: 'Document abc123 not found' }),
      }),
    );
  });
});

// ─── Unknown errors ────────────────────────────────────────────────────────────

describe('errorHandler — unknown errors', () => {
  it('returns 500 with the real message outside production', () => {
    mockEnv.NODE_ENV = 'test';
    const err = new Error('something broke');
    const res = makeRes();

    errorHandler(err, makeReq(), res, noopNext);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: { code: 'INTERNAL_ERROR', message: 'something broke' },
      }),
    );
  });

  it('redacts the message to a generic string in production', () => {
    mockEnv.NODE_ENV = 'production';
    const err = new Error('leaks a stack trace detail');
    const res = makeRes();

    errorHandler(err, makeReq(), res, noopNext);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      }),
    );
  });

  it('handles a thrown non-Error value (e.g. a string) without crashing', () => {
    const res = makeRes();

    errorHandler('a plain string throw', makeReq(), res, noopNext);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
      }),
    );
  });

  it('falls back to "unknown" correlationId when req.correlationId is absent', () => {
    const res = makeRes();
    const reqWithoutCorrelationId = {} as Request;

    errorHandler(new Error('oops'), reqWithoutCorrelationId, res, noopNext);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ correlationId: 'unknown' }));
  });
});
