/**
 * @file security.test.ts
 * @description Direct unit tests for securityMiddleware()'s CORS delegate — asserts the
 *   allowed HTTP `methods` array explicitly (regression guard: a prior bug shipped with
 *   PATCH silently missing from this array, breaking tag editing in production without
 *   any test catching it) and the ALLOW_DEVTUNNEL_CORS-gated devtunnel-origin allowlist.
 *   Complements tests/integration/security.test.ts, which exercises the same middleware
 *   end-to-end through supertest but never asserts the exact `methods` array.
 * @author [Author Placeholder]
 * @created 2026-08-31
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Application } from 'express';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { corsMock, helmetMock } = vi.hoisted(() => ({
  corsMock: vi.fn(() => 'cors-middleware'),
  helmetMock: vi.fn(() => 'helmet-middleware'),
}));

vi.mock('cors', () => ({ default: corsMock }));
vi.mock('helmet', () => ({ default: helmetMock }));

vi.mock('../../src/utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// ─── Types for the captured CORS delegate ─────────────────────────────────────

type CorsCallback = (err: Error | null, options?: Record<string, unknown>) => void;
type CorsDelegate = (req: { headers: Record<string, string | undefined> }, cb: CorsCallback) => void;

/** Minimal fake Express Application — enough surface for securityMiddleware(). */
function makeApp(): Application {
  return {
    use: vi.fn(),
    disable: vi.fn(),
  } as unknown as Application;
}

/** Invokes the captured CORS delegate and resolves with (err, options). */
function runCorsDelegate(
  delegate: CorsDelegate,
  origin: string | undefined,
  correlationIdHeader?: string,
): Promise<{ err: Error | null; options: Record<string, unknown> | undefined }> {
  return new Promise((resolve) => {
    const headers: Record<string, string | undefined> = {};
    if (origin !== undefined) headers['origin'] = origin;
    if (correlationIdHeader !== undefined) headers['x-correlation-id'] = correlationIdHeader;
    delegate({ headers }, (err, options) => resolve({ err, options }));
  });
}

/** Returns the CORS delegate function captured by the most recent securityMiddleware() call. */
function getCapturedDelegate(): CorsDelegate {
  const call = corsMock.mock.calls[0] as [CorsDelegate] | undefined;
  if (!call) throw new Error('cors() was not called');
  return call[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('securityMiddleware — CORS delegate', () => {
  it('allows GET, POST, PATCH, and DELETE — regression guard for the PATCH-omission bug', async () => {
    process.env['CORS_ORIGIN'] = 'http://localhost:5173';
    process.env['ALLOW_DEVTUNNEL_CORS'] = 'false';
    const { securityMiddleware } = await import('../../src/middleware/security');

    securityMiddleware(makeApp());
    const delegate = getCapturedDelegate();
    const { err, options } = await runCorsDelegate(delegate, 'http://localhost:5173');

    expect(err).toBeNull();
    expect(options?.['methods']).toEqual(['GET', 'POST', 'PATCH', 'DELETE']);
  });

  it('allows the configured CORS_ORIGIN', async () => {
    process.env['CORS_ORIGIN'] = 'http://localhost:5173';
    process.env['ALLOW_DEVTUNNEL_CORS'] = 'false';
    const { securityMiddleware } = await import('../../src/middleware/security');

    securityMiddleware(makeApp());
    const delegate = getCapturedDelegate();
    const { err, options } = await runCorsDelegate(delegate, 'http://localhost:5173');

    expect(err).toBeNull();
    expect(options?.['origin']).toBe(true);
    expect(options?.['credentials']).toBe(false);
  });

  it('allows requests with no Origin header (server-to-server)', async () => {
    process.env['CORS_ORIGIN'] = 'http://localhost:5173';
    process.env['ALLOW_DEVTUNNEL_CORS'] = 'false';
    const { securityMiddleware } = await import('../../src/middleware/security');

    securityMiddleware(makeApp());
    const delegate = getCapturedDelegate();
    const { err, options } = await runCorsDelegate(delegate, undefined);

    expect(err).toBeNull();
    expect(options).toBeDefined();
  });

  it('rejects an unknown origin', async () => {
    process.env['CORS_ORIGIN'] = 'http://localhost:5173';
    process.env['ALLOW_DEVTUNNEL_CORS'] = 'false';
    const { securityMiddleware } = await import('../../src/middleware/security');

    securityMiddleware(makeApp());
    const delegate = getCapturedDelegate();
    const { err } = await runCorsDelegate(delegate, 'http://evil.example.com');

    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toContain('evil.example.com');
  });

  it('logs the CORS rejection with the correlationId from the request header', async () => {
    process.env['CORS_ORIGIN'] = 'http://localhost:5173';
    process.env['ALLOW_DEVTUNNEL_CORS'] = 'false';
    const { securityMiddleware } = await import('../../src/middleware/security');
    const { logger } = await import('../../src/utils/logger');

    securityMiddleware(makeApp());
    const delegate = getCapturedDelegate();
    await runCorsDelegate(delegate, 'http://evil.example.com', 'my-corr-id');

    expect(logger.warn).toHaveBeenCalledWith(
      'CORS rejection',
      expect.objectContaining({ origin: 'http://evil.example.com', correlationId: 'my-corr-id' }),
    );
  });

  describe('devtunnel origin gating (ALLOW_DEVTUNNEL_CORS)', () => {
    it('rejects a *.devtunnels.ms origin when ALLOW_DEVTUNNEL_CORS is false (default)', async () => {
      process.env['CORS_ORIGIN'] = 'http://localhost:5173';
      process.env['ALLOW_DEVTUNNEL_CORS'] = 'false';
      const { securityMiddleware } = await import('../../src/middleware/security');

      securityMiddleware(makeApp());
      const delegate = getCapturedDelegate();
      const { err } = await runCorsDelegate(delegate, 'https://abc123-5173.devtunnels.ms');

      expect(err).toBeInstanceOf(Error);
    });

    it('allows a *.devtunnels.ms origin when ALLOW_DEVTUNNEL_CORS is true', async () => {
      process.env['CORS_ORIGIN'] = 'http://localhost:5173';
      process.env['ALLOW_DEVTUNNEL_CORS'] = 'true';
      const { securityMiddleware } = await import('../../src/middleware/security');

      securityMiddleware(makeApp());
      const delegate = getCapturedDelegate();
      const { err, options } = await runCorsDelegate(delegate, 'https://abc123-5173.devtunnels.ms');

      expect(err).toBeNull();
      expect(options?.['origin']).toBe(true);
    });

    it('still rejects a non-devtunnel unknown origin even when ALLOW_DEVTUNNEL_CORS is true', async () => {
      process.env['CORS_ORIGIN'] = 'http://localhost:5173';
      process.env['ALLOW_DEVTUNNEL_CORS'] = 'true';
      const { securityMiddleware } = await import('../../src/middleware/security');

      securityMiddleware(makeApp());
      const delegate = getCapturedDelegate();
      const { err } = await runCorsDelegate(delegate, 'http://evil.example.com');

      expect(err).toBeInstanceOf(Error);
    });

    it('rejects a devtunnel-lookalike origin that does not match the exact subdomain pattern', async () => {
      process.env['CORS_ORIGIN'] = 'http://localhost:5173';
      process.env['ALLOW_DEVTUNNEL_CORS'] = 'true';
      const { securityMiddleware } = await import('../../src/middleware/security');

      securityMiddleware(makeApp());
      const delegate = getCapturedDelegate();
      // Not https, or has a path/extra segment after the host — must not match.
      const { err } = await runCorsDelegate(delegate, 'http://abc123.devtunnels.ms.evil.com');

      expect(err).toBeInstanceOf(Error);
    });
  });
});

describe('securityMiddleware — app wiring', () => {
  it('disables the X-Powered-By header', async () => {
    process.env['CORS_ORIGIN'] = 'http://localhost:5173';
    process.env['ALLOW_DEVTUNNEL_CORS'] = 'false';
    const { securityMiddleware } = await import('../../src/middleware/security');
    const app = makeApp();

    securityMiddleware(app);

    expect(app.disable).toHaveBeenCalledWith('x-powered-by');
  });

  it('applies helmet and cors middleware to the app', async () => {
    process.env['CORS_ORIGIN'] = 'http://localhost:5173';
    process.env['ALLOW_DEVTUNNEL_CORS'] = 'false';
    const { securityMiddleware } = await import('../../src/middleware/security');
    const app = makeApp();

    securityMiddleware(app);

    expect(helmetMock).toHaveBeenCalledTimes(1);
    expect(corsMock).toHaveBeenCalledTimes(1);
    expect(app.use).toHaveBeenCalledWith('helmet-middleware');
    expect(app.use).toHaveBeenCalledWith('cors-middleware');
  });
});
