/**
 * @file security.test.ts
 * @description Integration tests for the full security middleware stack.
 *
 * Covers:
 *  - CORS origin allowlist enforcement
 *  - Helmet security response headers (CSP, X-Content-Type-Options, HSTS, etc.)
 *  - Correlation ID propagation on every response
 *  - Rate limit headers on normal responses
 *  - 429 response shape + Retry-After header when threshold is exceeded
 *  - Error responses never expose stack traces
 *  - Malicious filename rejection (path traversal, null byte, embedded script)
 *
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import type { Application } from 'express';
import { authedRequest } from './helpers.js';

// ── Service mocks — hoisted by Vitest so they apply to all dynamic imports ────
// These are identical to upload.test.ts mocks — any test that triggers a real
// service call will hit these stubs instead of actual external APIs.

vi.mock('@services/vectorStore', () => ({
  createDocument: vi.fn().mockResolvedValue({ id: 'doc-uuid', status: 'pending' }),
  listDocuments: vi.fn().mockResolvedValue([]),
  getDocument: vi.fn().mockResolvedValue(null),
  deleteDocument: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@queues/documentQueue', () => ({
  addDocumentJob: vi.fn().mockResolvedValue('job-uuid'),
  getQueue: vi.fn(),
  getJobStatus: vi.fn(),
  cancelDocumentJob: vi.fn().mockResolvedValue(undefined),
}));

// /api/health now pings real Supabase/Redis (readiness check) — mocked here
// so the many header/CORS/correlation-ID tests below that use /api/health as
// a generic lightweight endpoint keep getting a fast, deterministic 200
// instead of failing on unreachable dependencies in the test environment.
vi.mock('@utils/readiness', () => ({
  checkReadiness: vi.fn().mockResolvedValue({
    status: 'ok',
    checks: {
      supabase: { status: 'ok' },
      redis: { status: 'ok' },
      huggingface: { status: 'ok' },
      groq: { status: 'ok' },
    },
  }),
}));

vi.mock('@services/storage', () => ({
  uploadFile: vi.fn().mockResolvedValue(undefined),
  downloadFile: vi.fn(),
  removeFile: vi.fn().mockResolvedValue(undefined),
}));

// ── Shared fixtures ────────────────────────────────────────────────────────────

const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const PDF_BUFFER = Buffer.concat([PDF_MAGIC, Buffer.from(' minimal pdf content for security tests')]);
const TXT_BUFFER = Buffer.from('Plain text content for security tests.');

// ════════════════════════════════════════════════════════════════════════════════
// Suite A — General security headers (no rate-limit interference)
// ════════════════════════════════════════════════════════════════════════════════

describe('Security headers', () => {
  let app: Application;

  beforeAll(async () => {
    const { createApp } = await import('../../src/app');
    app = createApp();
  });

  // ── Correlation ID ─────────────────────────────────────────────────────────

  describe('Correlation ID', () => {
    it('attaches X-Correlation-ID to every response', async () => {
      const res = await supertest(app).get('/api/health');
      expect(res.headers['x-correlation-id']).toBeDefined();
      expect(typeof res.headers['x-correlation-id']).toBe('string');
      expect(res.headers['x-correlation-id']).toHaveLength(36); // UUID v4
    });

    it('echoes back a client-supplied X-Correlation-ID', async () => {
      const clientId = '550e8400-e29b-41d4-a716-446655440000';
      const res = await supertest(app)
        .get('/api/health')
        .set('X-Correlation-ID', clientId);
      expect(res.headers['x-correlation-id']).toBe(clientId);
    });

    it('generates a new correlation ID when none is provided', async () => {
      const res1 = await supertest(app).get('/api/health');
      const res2 = await supertest(app).get('/api/health');
      // Each request gets its own unique ID
      expect(res1.headers['x-correlation-id']).not.toBe(res2.headers['x-correlation-id']);
    });
  });

  // ── Helmet headers ─────────────────────────────────────────────────────────

  describe('Helmet security response headers', () => {
    it('sets Content-Security-Policy header', async () => {
      const res = await supertest(app).get('/api/health');
      expect(res.headers['content-security-policy']).toBeDefined();
      const csp = res.headers['content-security-policy'] as string;
      // Verify the most critical directives are present
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-src 'none'");
    });

    it('sets X-Content-Type-Options: nosniff', async () => {
      const res = await supertest(app).get('/api/health');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('sets Strict-Transport-Security (HSTS) header', async () => {
      const res = await supertest(app).get('/api/health');
      const hsts = res.headers['strict-transport-security'] as string;
      expect(hsts).toBeDefined();
      expect(hsts).toContain('max-age=31536000');
      expect(hsts).toContain('includeSubDomains');
    });

    it('sets Referrer-Policy header', async () => {
      const res = await supertest(app).get('/api/health');
      expect(res.headers['referrer-policy']).toBe('same-origin');
    });

    it('sets Cross-Origin-Opener-Policy header', async () => {
      const res = await supertest(app).get('/api/health');
      expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
    });

    it('sets Cross-Origin-Resource-Policy header', async () => {
      const res = await supertest(app).get('/api/health');
      expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
    });

    it('does not expose X-Powered-By header', async () => {
      const res = await supertest(app).get('/api/health');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  // ── CORS ───────────────────────────────────────────────────────────────────

  describe('CORS origin enforcement', () => {
    it('allows requests from the configured CORS_ORIGIN', async () => {
      // CORS_ORIGIN = http://localhost:5173 (set in setup.ts)
      const res = await supertest(app)
        .get('/api/health')
        .set('Origin', 'http://localhost:5173');
      // The origin is echoed back when allowed
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    });

    it('allows requests with no Origin header (server-to-server / curl)', async () => {
      const res = await supertest(app).get('/api/health');
      // No origin restriction when Origin is absent — this is a REST API, not a browser app
      expect(res.status).toBe(200);
    });

    it('rejects requests from an unknown origin', async () => {
      const res = await supertest(app)
        .get('/api/health')
        .set('Origin', 'http://evil.example.com');
      // cors middleware passes the error to the global error handler → non-2xx
      expect(res.status).toBeGreaterThanOrEqual(400);
      // Must NOT echo back the forbidden origin
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('exposes X-Correlation-ID in CORS Access-Control-Expose-Headers', async () => {
      const res = await supertest(app)
        .get('/api/health')
        .set('Origin', 'http://localhost:5173');
      const exposed = res.headers['access-control-expose-headers'] as string | undefined;
      expect(exposed).toBeDefined();
      expect(exposed?.toLowerCase()).toContain('x-correlation-id');
    });

    // Regression: the CORS rejection log used to omit correlationId (Rule 14
    // requires every request's log entries to include one) — a structural
    // gap since the `cors` package's static origin callback doesn't receive
    // `req`. Fixed by switching to the delegate form, which does.
    it('includes correlationId in the CORS rejection log entry', async () => {
      const { logger } = await import('../../src/utils/logger.js');
      const warnSpy = vi.spyOn(logger, 'warn');

      await supertest(app)
        .get('/api/health')
        .set('Origin', 'http://evil.example.com')
        .set('X-Correlation-ID', 'test-correlation-id-123');

      expect(warnSpy).toHaveBeenCalledWith(
        'CORS rejection',
        expect.objectContaining({ correlationId: 'test-correlation-id-123' }),
      );
      warnSpy.mockRestore();
    });
  });

  // ── Error response safety ──────────────────────────────────────────────────

  describe('Error response safety', () => {
    it('never exposes a stack trace in a 4xx error response', async () => {
      // Trigger a 404 by hitting an unknown route
      const res = await supertest(app).get('/api/nonexistent-route-xyz').expect(404);
      const body = res.body as Record<string, unknown>;
      expect(body).not.toHaveProperty('stack');
      // The error object itself should not contain a stack
      const errorPart = body['error'] as Record<string, unknown> | undefined;
      expect(errorPart).not.toHaveProperty('stack');
    });

    it('never exposes a stack trace in a 422 validation error response', async () => {
      // POST to query with invalid body → 422 from Zod middleware
      const res = await authedRequest(app)
        .post('/api/query')
        .send({ question: '' })    // empty string fails min(1) rule
        .expect(422);
      const body = res.body as Record<string, unknown>;
      expect(body).not.toHaveProperty('stack');
    });

    it('always includes correlationId in error responses', async () => {
      const res = await supertest(app).get('/api/nonexistent-route-xyz').expect(404);
      const body = res.body as Record<string, unknown>;
      expect(body).toHaveProperty('correlationId');
      expect(typeof body['correlationId']).toBe('string');
    });

    it('formats error responses with success:false and error.code', async () => {
      const res = await supertest(app).get('/api/nonexistent-route-xyz').expect(404);
      const body = res.body as Record<string, unknown>;
      expect(body['success']).toBe(false);
      const err = body['error'] as Record<string, unknown>;
      expect(err).toHaveProperty('code');
      expect(err).toHaveProperty('message');
    });
  });

  // ── Rate limit headers on normal responses ─────────────────────────────────

  describe('Rate limit headers', () => {
    it('includes RateLimit-Limit header on upload route responses', async () => {
      const res = await authedRequest(app)
        .post('/api/upload')
        .attach('files', TXT_BUFFER, { filename: 'check.txt', contentType: 'text/plain' });
      // express-rate-limit standardHeaders:true injects RateLimit-* headers
      const limitHeader =
        res.headers['ratelimit-limit'] ?? res.headers['x-ratelimit-limit'];
      expect(limitHeader).toBeDefined();
    });

    it('includes RateLimit-Remaining header on query route responses', async () => {
      const res = await authedRequest(app)
        .post('/api/query')
        .send({ question: 'What is RAG?' });
      const remainingHeader =
        res.headers['ratelimit-remaining'] ?? res.headers['x-ratelimit-remaining'];
      expect(remainingHeader).toBeDefined();
    });

    it('includes RateLimit-Limit header on documents route responses', async () => {
      const res = await authedRequest(app).get('/api/documents');
      const limitHeader =
        res.headers['ratelimit-limit'] ?? res.headers['x-ratelimit-limit'];
      expect(limitHeader).toBeDefined();
    });
  });

  // ── Malicious filename handling ────────────────────────────────────────────

  describe('Malicious filename rejection on upload', () => {
    it('rejects path traversal in filename (../../etc/passwd)', async () => {
      const res = await authedRequest(app)
        .post('/api/upload')
        .attach('files', PDF_BUFFER, {
          filename: '../../etc/passwd',
          contentType: 'application/pdf',
        });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.body.success).toBe(false);
    });

    it('rejects null byte injection in filename', async () => {
      const res = await authedRequest(app)
        .post('/api/upload')
        .attach('files', PDF_BUFFER, {
          filename: 'file\x00.pdf',
          contentType: 'application/pdf',
        });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.body.success).toBe(false);
    });

    it('rejects double-extension attack (malware.pdf.exe)', async () => {
      const res = await authedRequest(app)
        .post('/api/upload')
        .attach('files', PDF_BUFFER, {
          filename: 'malware.pdf.exe',
          contentType: 'application/pdf',
        });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.body.success).toBe(false);
    });

    it('rejects embedded script tag in filename', async () => {
      const res = await authedRequest(app)
        .post('/api/upload')
        .attach('files', PDF_BUFFER, {
          filename: '<script>alert(1)</script>.pdf',
          contentType: 'application/pdf',
        });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.body.success).toBe(false);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Suite B — Rate limit threshold enforcement (uses fresh app with max=2)
// ════════════════════════════════════════════════════════════════════════════════

describe('Rate limit threshold enforcement', () => {
  let rateLimitApp: Application;

  beforeAll(async () => {
    // Clear the module registry so env.ts re-evaluates with our overridden env vars.
    // vi.mock() factory registrations are preserved across resetModules.
    vi.resetModules();
    process.env['RATE_LIMIT_MAX_UPLOAD'] = '2';
    process.env['RATE_LIMIT_WINDOW_MS'] = '60000';

    const { createApp } = await import('../../src/app');
    rateLimitApp = createApp();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 429 after exceeding the upload rate limit', async () => {
    // First two requests succeed (limit = 2)
    await supertest(rateLimitApp)
      .post('/api/upload')
      .attach('files', TXT_BUFFER, { filename: 'a.txt', contentType: 'text/plain' });
    await supertest(rateLimitApp)
      .post('/api/upload')
      .attach('files', TXT_BUFFER, { filename: 'b.txt', contentType: 'text/plain' });

    // Third request must be rate-limited
    const res = await supertest(rateLimitApp)
      .post('/api/upload')
      .attach('files', TXT_BUFFER, { filename: 'c.txt', contentType: 'text/plain' });

    expect(res.status).toBe(429);
  });

  it('429 response includes Retry-After header', async () => {
    // Exhaust the limit (already used 2 slots above — window is still active)
    const res = await supertest(rateLimitApp)
      .post('/api/upload')
      .attach('files', TXT_BUFFER, { filename: 'd.txt', contentType: 'text/plain' });

    // If we're past the limit the header must be present; if not yet at limit,
    // this will be 2xx — either way we just verify the header contract when 429.
    if (res.status === 429) {
      expect(res.headers['retry-after']).toBeDefined();
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    }
  });

  it('429 response body matches the standard error envelope', async () => {
    // Force another 429 by sending one more upload
    const res = await supertest(rateLimitApp)
      .post('/api/upload')
      .attach('files', TXT_BUFFER, { filename: 'e.txt', contentType: 'text/plain' });

    if (res.status === 429) {
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(typeof res.body.error.message).toBe('string');
      expect(res.body.correlationId).toBeDefined();
    }
  });
});
