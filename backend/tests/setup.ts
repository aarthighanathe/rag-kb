/**
 * @file setup.ts
 * @description Vitest global test setup — env vars, safety checks, and log suppression
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { vi, beforeAll, afterAll } from 'vitest';

// ─── Environment variables ─────────────────────────────────────────────────────

process.env['NODE_ENV'] = 'test';
process.env['GROQ_API_KEY'] = 'test-groq-key';
process.env['HUGGINGFACE_TOKEN'] = 'test-hf-token';
process.env['SUPABASE_URL'] = 'https://test.supabase.co';
process.env['SUPABASE_SERVICE_KEY'] = 'test-supabase-key';
process.env['REDIS_URL'] = 'redis://localhost:6379';
process.env['PORT'] = '3001';
process.env['CORS_ORIGIN'] = 'http://localhost:5173';
process.env['MAX_FILE_SIZE_MB'] = '10';
process.env['RATE_LIMIT_WINDOW_MS'] = '60000';
process.env['RATE_LIMIT_MAX_UPLOAD'] = '100';
process.env['RATE_LIMIT_MAX_QUERY'] = '100';
process.env['RATE_LIMIT_MAX_DOCUMENTS'] = '100';
process.env['LOG_LEVEL'] = 'error';
process.env['ADMIN_SECRET'] = 'test-admin-secret-at-least-32-characters-long';
process.env['CLERK_SECRET_KEY'] = 'test-clerk-secret-key';
process.env['CLERK_PUBLISHABLE_KEY'] = 'test-clerk-publishable-key';

// ─── Winston log suppression ──────────────────────────────────────────────────

vi.mock('./src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    http:  vi.fn(),
  },
}));

// ─── Clerk mock ────────────────────────────────────────────────────────────────
//
// Real JWT verification requires a live Clerk instance, so every test authenticates
// with a fake `Bearer valid-<userId>` token. verifyToken() accepts any token of that
// shape and returns the embedded userId as the `sub` claim; anything else is rejected,
// exercising the same 401 path a real invalid/expired Clerk JWT would take.
// See tests/integration/helpers.ts (authedRequest, authHeaderFor) for the request side.

vi.mock('@clerk/backend', () => ({
  verifyToken: async (token: string): Promise<{ sub: string }> => {
    if (token.startsWith('valid-')) {
      return { sub: token.slice('valid-'.length) };
    }
    throw new Error('Invalid test token');
  },
}));

// ─── Production-DB safety guard ───────────────────────────────────────────────

beforeAll(() => {
  const url = process.env['SUPABASE_URL'] ?? '';
  if (url.includes('supabase.co') && !url.includes('test')) {
    throw new Error(
      `SAFETY: SUPABASE_URL "${url}" looks like production. ` +
      'Tests must run against a test instance. Set SUPABASE_URL=https://test.supabase.co.',
    );
  }
});

afterAll(() => {
  // Placeholder for any global cleanup (e.g. open handles, temp files).
  // Currently no shared state is created by tests, so this is a no-op.
});
