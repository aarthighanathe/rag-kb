/**
 * @file rateLimit.test.ts
 * @description Unit tests for the rate-limit middleware instances — drives each
 *   limiter with a fake req/res past its configured `max` and asserts the 429
 *   response envelope, Retry-After header, and per-limiter thresholds sourced
 *   from env.ts.
 * @author [Author Placeholder]
 * @created 2026-08-24
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../../src/utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import {
  globalRateLimit,
  uploadRateLimit,
  queryRateLimit,
  documentsRateLimit,
  adminRateLimit,
} from '../../src/middleware/rateLimit';
import { env } from '../../src/config/env';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal fake Response — enough surface for express-rate-limit + our handler. */
function makeRes(): Response {
  const headers: Record<string, string | number> = {};
  const res: Partial<Response> = {
    setHeader: vi.fn((name: string, value: string | number) => {
      headers[name] = value;
      return res as Response;
    }),
    getHeader: vi.fn((name: string) => headers[name]),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return res as Response;
}

function makeReq(ip: string): Request {
  return { ip, path: '/test', correlationId: 'corr-1', headers: {}, app: { get: () => false } } as unknown as Request;
}

/**
 * Drives a limiter with `count` sequential requests from a single fake IP,
 * awaiting each call so express-rate-limit's internal store updates before
 * the next request. Returns the responses in order.
 */
async function fireRequests(
  limiter: (req: Request, res: Response, next: NextFunction) => void,
  count: number,
  ip: string,
): Promise<Response[]> {
  const responses: Response[] = [];
  for (let i = 0; i < count; i++) {
    const req = makeReq(ip);
    const res = makeRes();
    const next = vi.fn();
    // express-rate-limit's handler is async internally (store operations);
    // give it a microtask tick to settle before the next request.
    limiter(req, res, next as unknown as NextFunction);
    await new Promise((resolve) => setImmediate(resolve));
    responses.push(res);
  }
  return responses;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('rateLimit — 429 response envelope', () => {
  it('returns a 429 with the consistent error envelope once the limit is exceeded', async () => {
    // adminRateLimit is a fixed 20/window, independent of env — cheapest to
    // exhaust without needing to read env.RATE_LIMIT_MAX_* here.
    const responses = await fireRequests(adminRateLimit, 21, '10.0.0.1');
    const limited = responses[responses.length - 1]!;

    expect(limited.status).toHaveBeenCalledWith(429);
    expect(limited.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'RATE_LIMIT_EXCEEDED' }),
        correlationId: 'corr-1',
      }),
    );
  });

  it('sets a Retry-After header (seconds) on the limited response', async () => {
    const responses = await fireRequests(adminRateLimit, 21, '10.0.0.2');
    const limited = responses[responses.length - 1]!;

    expect(limited.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number) as unknown);
  });

  it('does not rate-limit requests under the threshold', async () => {
    const responses = await fireRequests(adminRateLimit, 5, '10.0.0.3');
    for (const res of responses) {
      expect(res.status).not.toHaveBeenCalledWith(429);
    }
  });

  it('falls back to "unknown" correlationId when req.correlationId is absent', async () => {
    const req = { ip: '10.0.0.4', path: '/test', headers: {}, app: { get: () => false } } as unknown as Request;
    // Exhaust the limit for this IP first.
    for (let i = 0; i < 20; i++) {
      adminRateLimit(makeReq('10.0.0.4'), makeRes(), vi.fn() as unknown as NextFunction);
      await new Promise((resolve) => setImmediate(resolve));
    }
    const res = makeRes();
    adminRateLimit(req, res, vi.fn() as unknown as NextFunction);
    await new Promise((resolve) => setImmediate(resolve));

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ correlationId: 'unknown' }));
  });
});

describe('rateLimit — per-limiter thresholds sourced from env', () => {
  it('uploadRateLimit allows exactly env.RATE_LIMIT_MAX_UPLOAD requests before limiting', async () => {
    const max = env.RATE_LIMIT_MAX_UPLOAD;
    const responses = await fireRequests(uploadRateLimit, max + 1, '10.0.1.1');
    const allButLast = responses.slice(0, max);
    const last = responses[responses.length - 1]!;

    for (const res of allButLast) expect(res.status).not.toHaveBeenCalledWith(429);
    expect(last.status).toHaveBeenCalledWith(429);
  });

  it('queryRateLimit allows exactly env.RATE_LIMIT_MAX_QUERY requests before limiting', async () => {
    const max = env.RATE_LIMIT_MAX_QUERY;
    const responses = await fireRequests(queryRateLimit, max + 1, '10.0.1.2');
    const allButLast = responses.slice(0, max);
    const last = responses[responses.length - 1]!;

    for (const res of allButLast) expect(res.status).not.toHaveBeenCalledWith(429);
    expect(last.status).toHaveBeenCalledWith(429);
  });

  it('documentsRateLimit allows exactly env.RATE_LIMIT_MAX_DOCUMENTS requests before limiting', async () => {
    const max = env.RATE_LIMIT_MAX_DOCUMENTS;
    const responses = await fireRequests(documentsRateLimit, max + 1, '10.0.1.3');
    const allButLast = responses.slice(0, max);
    const last = responses[responses.length - 1]!;

    for (const res of allButLast) expect(res.status).not.toHaveBeenCalledWith(429);
    expect(last.status).toHaveBeenCalledWith(429);
  }, 15000);

  it('adminRateLimit is fixed at 20 regardless of env (guards X-Admin-Secret brute-forcing)', async () => {
    const responses = await fireRequests(adminRateLimit, 21, '10.0.1.4');
    const allButLast = responses.slice(0, 20);
    const last = responses[responses.length - 1]!;

    for (const res of allButLast) expect(res.status).not.toHaveBeenCalledWith(429);
    expect(last.status).toHaveBeenCalledWith(429);
  });
});

describe('rateLimit — keys requests by IP', () => {
  it('tracks separate quotas for different IPs', async () => {
    // Exhaust the limit for one IP.
    await fireRequests(adminRateLimit, 20, '10.0.2.1');
    // A different IP must still have its own fresh quota.
    const res = makeRes();
    adminRateLimit(makeReq('10.0.2.2'), res, vi.fn() as unknown as NextFunction);
    await new Promise((resolve) => setImmediate(resolve));

    expect(res.status).not.toHaveBeenCalledWith(429);
  });
});

describe('rateLimit — instances exist for every documented route group', () => {
  it('exports globalRateLimit, uploadRateLimit, queryRateLimit, documentsRateLimit, adminRateLimit', () => {
    expect(typeof globalRateLimit).toBe('function');
    expect(typeof uploadRateLimit).toBe('function');
    expect(typeof queryRateLimit).toBe('function');
    expect(typeof documentsRateLimit).toBe('function');
    expect(typeof adminRateLimit).toBe('function');
  });
});
