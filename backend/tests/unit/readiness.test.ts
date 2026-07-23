/**
 * @file readiness.test.ts
 * @description Unit tests for the dependency readiness checks (Supabase, Redis,
 *   HuggingFace, Groq) backing the /api/health endpoint
 * @author [Author Placeholder]
 * @created 2026-07-23
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockFrom, mockModelsList, mockRedisInfo } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockModelsList: vi.fn(),
  mockRedisInfo: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn().mockImplementation(() => ({ from: mockFrom })),
}));

vi.mock('groq-sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    models: { list: mockModelsList },
  })),
}));

vi.mock('@queues/documentQueue', () => ({
  getQueue: vi.fn().mockReturnValue({
    client: Promise.resolve({ info: mockRedisInfo }),
  }),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { checkReadiness } from '../../src/utils/readiness';

// ─── Setup ────────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mockFetch);

  // Default: every dependency healthy.
  const chain = { select: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ error: null }) };
  mockFrom.mockReturnValue(chain);
  mockModelsList.mockResolvedValue({ data: [] });
  mockRedisInfo.mockResolvedValue('redis_version:7.0.0');
  mockFetch.mockResolvedValue({ ok: true, status: 200 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('checkReadiness', () => {
  it('returns ok when all four dependencies are reachable', async () => {
    const result = await checkReadiness();

    expect(result.status).toBe('ok');
    expect(result.checks.supabase.status).toBe('ok');
    expect(result.checks.redis.status).toBe('ok');
    expect(result.checks.huggingface.status).toBe('ok');
    expect(result.checks.groq.status).toBe('ok');
  });

  // Regression: checkReadiness previously only probed Supabase and Redis, so
  // a revoked HuggingFace token or a Groq outage left /api/health reporting
  // 200 while every upload/query silently failed with no health signal.
  it('reports huggingface as errored when the model-info request fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 });

    const result = await checkReadiness();

    expect(result.status).toBe('error');
    expect(result.checks.huggingface.status).toBe('error');
    expect(result.checks.huggingface.error).toContain('401');
    // Other dependencies remain unaffected.
    expect(result.checks.supabase.status).toBe('ok');
    expect(result.checks.groq.status).toBe('ok');
  });

  it('reports huggingface as errored when the fetch call throws (network failure)', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await checkReadiness();

    expect(result.status).toBe('error');
    expect(result.checks.huggingface.status).toBe('error');
    expect(result.checks.huggingface.error).toContain('ECONNREFUSED');
  });

  it('reports groq as errored when models.list() rejects (invalid API key)', async () => {
    mockModelsList.mockRejectedValue(new Error('401 Invalid API Key'));

    const result = await checkReadiness();

    expect(result.status).toBe('error');
    expect(result.checks.groq.status).toBe('error');
    expect(result.checks.groq.error).toContain('Invalid API Key');
    expect(result.checks.huggingface.status).toBe('ok');
  });

  it('still reports supabase/redis errors independently of the new checks', async () => {
    mockRedisInfo.mockRejectedValue(new Error('NOAUTH Authentication required'));

    const result = await checkReadiness();

    expect(result.status).toBe('error');
    expect(result.checks.redis.status).toBe('error');
    expect(result.checks.huggingface.status).toBe('ok');
    expect(result.checks.groq.status).toBe('ok');
  });
});
