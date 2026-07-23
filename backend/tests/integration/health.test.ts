/**
 * @file health.test.ts
 * @description Integration tests for /health (pure liveness) and /api/health (readiness)
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import supertest from 'supertest';
import type { Application } from 'express';

const { mockCheckReadiness } = vi.hoisted(() => ({ mockCheckReadiness: vi.fn() }));

vi.mock('@utils/readiness', () => ({
  checkReadiness: mockCheckReadiness,
}));

let app: Application;

beforeAll(async () => {
  // Dynamically import after setup.ts has set env vars
  const { createApp } = await import('../../src/app');
  app = createApp();
});

afterEach(() => {
  mockCheckReadiness.mockReset();
});

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await supertest(app).get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok' });
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('returns X-Correlation-ID header', async () => {
    const res = await supertest(app).get('/health').expect(200);
    expect(res.headers['x-correlation-id']).toBeDefined();
  });
});

describe('GET /api/health', () => {
  it('returns 200 when all dependencies are reachable', async () => {
    mockCheckReadiness.mockResolvedValue({
      status: 'ok',
      checks: {
        supabase: { status: 'ok' },
        redis: { status: 'ok' },
        huggingface: { status: 'ok' },
        groq: { status: 'ok' },
      },
    });

    const res = await supertest(app).get('/api/health').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.checks).toEqual({
      supabase: { status: 'ok' },
      redis: { status: 'ok' },
      huggingface: { status: 'ok' },
      groq: { status: 'ok' },
    });
  });

  it('returns 503 when Redis is unreachable', async () => {
    mockCheckReadiness.mockResolvedValue({
      status: 'error',
      checks: {
        supabase: { status: 'ok' },
        redis: { status: 'error', error: 'NOAUTH Authentication required' },
        huggingface: { status: 'ok' },
        groq: { status: 'ok' },
      },
    });

    const res = await supertest(app).get('/api/health').expect(503);
    expect(res.body.success).toBe(false);
    expect(res.body.data.status).toBe('error');
    expect(res.body.data.checks.redis.status).toBe('error');
  });

  it('returns 503 when Supabase is unreachable', async () => {
    mockCheckReadiness.mockResolvedValue({
      status: 'error',
      checks: {
        supabase: { status: 'error', error: 'fetch failed' },
        redis: { status: 'ok' },
        huggingface: { status: 'ok' },
        groq: { status: 'ok' },
      },
    });

    const res = await supertest(app).get('/api/health').expect(503);
    expect(res.body.success).toBe(false);
    expect(res.body.data.checks.supabase.status).toBe('error');
  });

  // Regression: checkReadiness previously never probed HuggingFace or Groq,
  // so a revoked token or provider outage left this endpoint reporting 200
  // while uploads/queries silently failed.
  it('returns 503 when HuggingFace is unreachable', async () => {
    mockCheckReadiness.mockResolvedValue({
      status: 'error',
      checks: {
        supabase: { status: 'ok' },
        redis: { status: 'ok' },
        huggingface: { status: 'error', error: 'HuggingFace model-info returned 401' },
        groq: { status: 'ok' },
      },
    });

    const res = await supertest(app).get('/api/health').expect(503);
    expect(res.body.success).toBe(false);
    expect(res.body.data.checks.huggingface.status).toBe('error');
  });

  it('returns 503 when Groq is unreachable', async () => {
    mockCheckReadiness.mockResolvedValue({
      status: 'error',
      checks: {
        supabase: { status: 'ok' },
        redis: { status: 'ok' },
        huggingface: { status: 'ok' },
        groq: { status: 'error', error: '401 Invalid API Key' },
      },
    });

    const res = await supertest(app).get('/api/health').expect(503);
    expect(res.body.success).toBe(false);
    expect(res.body.data.checks.groq.status).toBe('error');
  });
});
