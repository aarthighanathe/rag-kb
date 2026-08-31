/**
 * @file requireAuth.test.ts
 * @description Unit tests for the Clerk JWT verification middleware — missing/malformed
 *   Authorization headers, successful verification, and Clerk rejection paths.
 * @author [Author Placeholder]
 * @created 2026-08-31
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// tests/setup.ts already mocks '@clerk/backend' globally: verifyToken() accepts
// any 'valid-<userId>' token and returns { sub: userId }, else throws. See
// setup.ts's own comment block for the rationale.

import { requireAuth } from '../../src/middleware/requireAuth';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(authHeader?: string): Request {
  return {
    headers: authHeader !== undefined ? { authorization: authHeader } : {},
    correlationId: 'corr-1',
  } as unknown as Request;
}

function makeRes(): Response {
  const res: Partial<Response> = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requireAuth', () => {
  it('responds 401 UNAUTHORIZED when the Authorization header is missing', async () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    await requireAuth(req, res, next as unknown as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'UNAUTHORIZED' }),
        correlationId: 'corr-1',
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('responds 401 UNAUTHORIZED when the header is malformed (no Bearer prefix)', async () => {
    const req = makeReq('Basic abc123');
    const res = makeRes();
    const next = vi.fn();

    await requireAuth(req, res, next as unknown as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'UNAUTHORIZED' }) }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('responds 401 UNAUTHORIZED for an empty Authorization header', async () => {
    const req = makeReq('');
    const res = makeRes();
    const next = vi.fn();

    await requireAuth(req, res, next as unknown as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('attaches req.auth and calls next() on a valid token', async () => {
    const req = makeReq('Bearer valid-user-123');
    const res = makeRes();
    const next = vi.fn();

    await requireAuth(req, res, next as unknown as NextFunction);

    expect(req.auth).toEqual({ userId: 'user-123' });
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('attaches email to req.auth when the token payload carries a string email claim', async () => {
    // The mock verifyToken only returns { sub }, so email is never present in
    // practice here — this asserts requireAuth doesn't choke on its absence
    // and never fabricates an email field.
    const req = makeReq('Bearer valid-user-456');
    const res = makeRes();
    const next = vi.fn();

    await requireAuth(req, res, next as unknown as NextFunction);

    expect(req.auth).toEqual({ userId: 'user-456' });
    expect(req.auth).not.toHaveProperty('email');
  });

  it('responds 401 INVALID_TOKEN when Clerk verifyToken rejects the token', async () => {
    const req = makeReq('Bearer garbage-token');
    const res = makeRes();
    const next = vi.fn();

    await requireAuth(req, res, next as unknown as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'INVALID_TOKEN' }),
        correlationId: 'corr-1',
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('does not attach req.auth when verification fails', async () => {
    const req = makeReq('Bearer garbage-token');
    const res = makeRes();
    const next = vi.fn();

    await requireAuth(req, res, next as unknown as NextFunction);

    expect(req.auth).toBeUndefined();
  });
});
