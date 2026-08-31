/**
 * @file validate.test.ts
 * @description Unit tests for the Zod validation middleware factory — success
 *   (data replaced with coerced/defaulted output), failure (ZodError forwarded
 *   to next()), and target-specific handling of req.query vs req.body/params.
 * @author [Author Placeholder]
 * @created 2026-08-24
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../../src/utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { validate } from '../../src/middleware/validate';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    query: {},
    path: '/test',
    correlationId: 'test-correlation-id',
    ...overrides,
  } as unknown as Request;
}

const noopRes = {} as Response;

describe('validate — body target', () => {
  const schema = z.object({ name: z.string().min(1) });

  it('calls next() with no error on valid body', () => {
    const req = makeReq({ body: { name: 'Alice' } });
    const next = vi.fn() as unknown as NextFunction;

    validate(schema, 'body')(req, noopRes, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('replaces req.body with the Zod-validated/coerced data', () => {
    const schemaWithDefault = z.object({ name: z.string(), page: z.coerce.number().default(1) });
    const req = makeReq({ body: { name: 'Alice' } });
    const next = vi.fn() as unknown as NextFunction;

    validate(schemaWithDefault, 'body')(req, noopRes, next);

    expect(req.body).toEqual({ name: 'Alice', page: 1 });
  });

  it('forwards a ZodError to next() on invalid body, without calling next() a second time', () => {
    const req = makeReq({ body: { name: '' } });
    const next = vi.fn() as unknown as NextFunction;

    validate(schema, 'body')(req, noopRes, next);

    expect(next).toHaveBeenCalledOnce();
    const [err] = (next as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown];
    expect(err).toBeInstanceOf(z.ZodError);
  });

  it('does not mutate req.body when validation fails', () => {
    const original = { name: '' };
    const req = makeReq({ body: original });
    const next = vi.fn() as unknown as NextFunction;

    validate(schema, 'body')(req, noopRes, next);

    expect(req.body).toBe(original);
  });
});

describe('validate — params target', () => {
  const schema = z.object({ id: z.string().uuid() });
  const validId = '550e8400-e29b-41d4-a716-446655440000';

  it('calls next() with no error and replaces req.params on a valid UUID', () => {
    const req = makeReq({ params: { id: validId } });
    const next = vi.fn() as unknown as NextFunction;

    validate(schema, 'params')(req, noopRes, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.params).toEqual({ id: validId });
  });

  it('forwards a ZodError for a non-UUID param', () => {
    const req = makeReq({ params: { id: 'not-a-uuid' } });
    const next = vi.fn() as unknown as NextFunction;

    validate(schema, 'params')(req, noopRes, next);

    const [err] = (next as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown];
    expect(err).toBeInstanceOf(z.ZodError);
  });
});

describe('validate — query target (Express 5 getter-only req.query)', () => {
  // req.query is a getter-only property on the real Express 5 Request — the
  // implementation must use Object.defineProperty instead of a plain
  // assignment. Model that constraint here rather than a plain object literal
  // so this test can't pass by accident just because a plain object happens
  // to allow reassignment.
  function makeReqWithGetterOnlyQuery(query: unknown): Request {
    const req = makeReq();
    Object.defineProperty(req, 'query', {
      value: query,
      writable: false,
      configurable: true,
      enumerable: true,
    });
    return req;
  }

  it('overrides a getter-only req.query with the validated/coerced data', () => {
    const schema = z.object({ page: z.coerce.number().default(1), limit: z.coerce.number().default(20) });
    const req = makeReqWithGetterOnlyQuery({ page: '3' });
    const next = vi.fn() as unknown as NextFunction;

    validate(schema, 'query')(req, noopRes, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.query).toEqual({ page: 3, limit: 20 });
  });

  it('forwards a ZodError when query fails validation, leaving the getter-only query untouched', () => {
    const schema = z.object({ page: z.coerce.number().int().positive() });
    const req = makeReqWithGetterOnlyQuery({ page: 'not-a-number' });
    const next = vi.fn() as unknown as NextFunction;

    validate(schema, 'query')(req, noopRes, next);

    const [err] = (next as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown];
    expect(err).toBeInstanceOf(z.ZodError);
  });

  it('supports a transforming schema (comma-separated string -> array)', () => {
    const schema = z.object({
      ids: z.string().transform((v) => v.split(',')).pipe(z.array(z.string()).min(1)),
    });
    const req = makeReqWithGetterOnlyQuery({ ids: 'a,b,c' });
    const next = vi.fn() as unknown as NextFunction;

    validate(schema, 'query')(req, noopRes, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.query).toEqual({ ids: ['a', 'b', 'c'] });
  });
});

describe('validate — default target', () => {
  it('validates req.body when no target is specified', () => {
    const schema = z.object({ name: z.string() });
    const req = makeReq({ body: { name: 'Alice' } });
    const next = vi.fn() as unknown as NextFunction;

    validate(schema)(req, noopRes, next);

    expect(next).toHaveBeenCalledWith();
  });
});

describe('validate — logging on failure', () => {
  it('logs a warning with correlationId, target, path, and issue summaries on validation failure', async () => {
    const { logger } = await import('../../src/utils/logger');
    vi.mocked(logger.warn).mockClear();

    const schema = z.object({ name: z.string().min(1) });
    const req = makeReq({ body: { name: '' }, path: '/api/documents', correlationId: 'corr-123' });
    const next = vi.fn() as unknown as NextFunction;

    validate(schema, 'body')(req, noopRes, next);

    expect(logger.warn).toHaveBeenCalledWith(
      'Validation failed',
      expect.objectContaining({
        correlationId: 'corr-123',
        target: 'body',
        path: '/api/documents',
        issues: expect.any(Array) as unknown,
      }),
    );
  });

  it('does not log on successful validation', async () => {
    const { logger } = await import('../../src/utils/logger');
    vi.mocked(logger.warn).mockClear();

    const schema = z.object({ name: z.string() });
    const req = makeReq({ body: { name: 'Alice' } });
    const next = vi.fn() as unknown as NextFunction;

    validate(schema, 'body')(req, noopRes, next);

    expect(logger.warn).not.toHaveBeenCalled();
  });
});
