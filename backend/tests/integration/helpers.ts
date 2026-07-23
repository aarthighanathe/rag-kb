/**
 * @file helpers.ts
 * @description Shared test utilities for integration tests — app factory, SSE parser,
 *              typed Supabase mock, Groq stream mock, and HuggingFace response mock.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { vi } from 'vitest';
import supertest from 'supertest';
import type { Application } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RetrievedChunk } from '../../src/types/index.js';

// ─── Auth ─────────────────────────────────────────────────────────────────────
//
// Pairs with the @clerk/backend mock in tests/setup.ts: verifyToken() accepts any
// `valid-<userId>` bearer token and echoes <userId> back as the sub claim.

/** Default authenticated user for tests that don't care about a specific userId. */
export const TEST_USER_ID = 'test-user-1';

/** A second distinct user — used by IDOR / cross-user isolation tests. */
export const OTHER_TEST_USER_ID = 'test-user-2';

/** Builds an Authorization header for the given userId (defaults to TEST_USER_ID). */
export function authHeaderFor(userId: string = TEST_USER_ID): { Authorization: string } {
  return { Authorization: `Bearer valid-${userId}` };
}

/** Ready-to-spread Authorization header for TEST_USER_ID — the common case. */
export const AUTH_HEADER = authHeaderFor(TEST_USER_ID);

/**
 * Thin supertest wrapper that attaches a valid Authorization header to every
 * request, so existing call sites only need `supertest(app)` swapped for
 * `authedRequest(app)` rather than a `.set(...)` added to every call.
 * @param app - Express application under test
 * @param userId - Which authenticated user to act as (default TEST_USER_ID)
 */
export function authedRequest(app: Application, userId: string = TEST_USER_ID) {
  const agent = supertest(app);
  const header = authHeaderFor(userId);
  return {
    get: (url: string) => agent.get(url).set(header),
    post: (url: string) => agent.post(url).set(header),
    delete: (url: string) => agent.delete(url).set(header),
    put: (url: string) => agent.put(url).set(header),
    patch: (url: string) => agent.patch(url).set(header),
  };
}

// ─── App factory ──────────────────────────────────────────────────────────────

/**
 * Creates and returns the Express application configured for testing.
 * Import lazily so that vi.mock() hoisting happens before module resolution.
 * @returns Configured Express application instance
 */
export async function createTestApp(): Promise<Application> {
  const { createApp } = await import('../../src/app.js');
  return createApp();
}

// ─── SSE event collector ──────────────────────────────────────────────────────

/** A parsed SSE event with its type and JSON-decoded data payload. */
export interface ParsedSSEEvent {
  event: string;
  data: unknown;
}

/**
 * Parses a raw SSE response body string into an array of typed events.
 * Each SSE block is separated by a blank line.
 * @param body - Raw response body string from a supertest SSE request
 * @returns Ordered array of parsed events
 */
export function collectSSEEvents(body: string): ParsedSSEEvent[] {
  const events: ParsedSSEEvent[] = [];
  const blocks = body.split('\n\n').filter(Boolean);

  for (const block of blocks) {
    const lines = block.split('\n');
    const eventLine = lines.find((l) => l.startsWith('event:'));
    const dataLine  = lines.find((l) => l.startsWith('data:'));

    if (eventLine && dataLine) {
      try {
        events.push({
          event: eventLine.replace('event:', '').trim(),
          data:  JSON.parse(dataLine.replace('data:', '').trim()) as unknown,
        });
      } catch {
        // Ignore blocks with non-JSON data
      }
    }
  }

  return events;
}

// ─── Supabase mock ────────────────────────────────────────────────────────────

/** Fluent Supabase query-chain mock (all terminal methods default to success). */
export interface MockChain {
  select:  ReturnType<typeof vi.fn>;
  insert:  ReturnType<typeof vi.fn>;
  update:  ReturnType<typeof vi.fn>;
  delete:  ReturnType<typeof vi.fn>;
  upsert:  ReturnType<typeof vi.fn>;
  eq:      ReturnType<typeof vi.fn>;
  single:  ReturnType<typeof vi.fn>;
  order:   ReturnType<typeof vi.fn>;
  range:   ReturnType<typeof vi.fn>;
}

export interface MockSupabaseClient {
  from:    ReturnType<typeof vi.fn>;
  rpc:     ReturnType<typeof vi.fn>;
  chain:   MockChain;
}

/**
 * Returns a typed mock Supabase client with sensible success defaults.
 * Individual tests can override `.single`, `.range`, `.rpc` etc. per-case.
 * @param sampleDocument - Default document returned by `.single()`
 * @returns Mock Supabase client and its underlying chain for per-test overrides
 */
export function mockSupabase(sampleDocument?: Record<string, unknown>): MockSupabaseClient {
  const chain: MockChain = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    upsert: vi.fn(),
    eq:     vi.fn(),
    single: vi.fn(),
    order:  vi.fn(),
    range:  vi.fn(),
  };

  const from = vi.fn().mockReturnValue(chain);
  const rpc  = vi.fn().mockResolvedValue({ data: [], error: null });

  // Default chain routing
  chain.select.mockReturnValue(chain);
  chain.insert.mockReturnValue(chain);
  chain.update.mockReturnValue(chain);
  chain.delete.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.upsert.mockResolvedValue({ error: null });

  // Terminal defaults
  chain.single.mockResolvedValue({
    data: sampleDocument ?? { id: 'doc-1', filename: 'test.pdf', status: 'pending' },
    error: null,
  });
  chain.range.mockResolvedValue({
    data: sampleDocument ? [sampleDocument] : [],
    error: null,
    count: sampleDocument ? 1 : 0,
  });

  return { from, rpc, chain };
}

// ─── Groq stream mock ─────────────────────────────────────────────────────────

/**
 * Creates an async generator that emits the given tokens as Groq stream delta chunks.
 * Ends with a stop signal, matching the shape of groq-sdk's streaming response.
 * @param tokens - String tokens to emit one at a time
 * @returns Async iterable of Groq stream chunk objects
 */
export async function* mockGroqStream(
  tokens: string[],
): AsyncGenerator<{ choices: Array<{ delta: { content?: string }; finish_reason: string | null }> }> {
  for (const token of tokens) {
    yield { choices: [{ delta: { content: token }, finish_reason: null }] };
  }
  yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
}

// ─── HuggingFace response mock ────────────────────────────────────────────────

/**
 * Builds a minimal mock `Response` object that resolves to the given embedding array.
 * Pass directly as the return value of `global.fetch` in unit tests.
 * @param embedding - 384-dimensional embedding vector (or any array for error testing)
 * @param status    - HTTP status code (default 200)
 * @returns Mock Response-shaped object
 */
export function mockHuggingFace(embedding: number[], status = 200): Response {
  const body = [embedding];
  return {
    ok:     status >= 200 && status < 300,
    status,
    json:   () => Promise.resolve(body),
    text:   () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

/**
 * Returns a valid 384-dimensional embedding vector filled with the given value.
 * @param fill - Value to fill (default 0.1)
 * @returns 384-element number array
 */
export function make384dEmbedding(fill = 0.1): number[] {
  return Array.from({ length: 384 }, () => fill);
}

// ─── Chunk fixture ────────────────────────────────────────────────────────────

/**
 * Creates a minimal RetrievedChunk fixture for integration tests.
 * @param overrides - Partial overrides for the default values
 * @returns Typed RetrievedChunk
 */
export function makeRetrievedChunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    id:                'chunk-uuid-1',
    document_id:       'doc-uuid-1',
    content:           'The main finding is that revenue grew by 20%.',
    similarity:        0.92,
    metadata:          { char_start: 0, char_end: 45 },
    filename:          'report.pdf',
    ...overrides,
  };
}
