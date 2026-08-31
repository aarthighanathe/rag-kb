/**
 * @file apiFetchTimeout.test.ts
 * @description Unit tests for apiFetch's default request timeout — a hung
 *   fetch (backend stall, dropped proxy connection) must abort instead of
 *   leaving the caller waiting indefinitely.
 * @author [Author Placeholder]
 * @created 2026-08-30
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { listDocuments, extractErrorMessage } from '../../services/api';

describe('apiFetch default timeout', () => {
  const originalFetch = globalThis.fetch;
  const originalAbortSignalTimeout = AbortSignal.timeout;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    AbortSignal.timeout = originalAbortSignalTimeout;
  });

  it('aborts a request that never resolves once the default timeout elapses', async () => {
    // Force the timeout signal to fire immediately, rather than fighting
    // AbortSignal.timeout()'s real platform-timer internals (which fake
    // timers don't control) — the point under test is that apiFetch wires
    // the timeout signal into fetch()'s options and surfaces the resulting
    // TimeoutError, not the literal 30s duration.
    AbortSignal.timeout = () =>
      AbortSignal.abort(new DOMException('signal timed out', 'TimeoutError'));

    // A fetch that hangs forever unless aborted, mirroring a real stalled
    // network call — resolves only via the forwarded abort signal.
    globalThis.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(init.signal.reason);
            return;
          }
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal!.reason);
          });
        }),
    ) as typeof fetch;

    const err = await listDocuments().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DOMException);
    expect((err as DOMException).name).toBe('TimeoutError');
    expect(extractErrorMessage(err)).toMatch(/took too long/i);
  });

  it('does not abort a request that resolves well within the timeout', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ documents: [], total: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as typeof fetch;

    await expect(listDocuments()).resolves.toEqual({ documents: [], total: 0 });
  });
});
