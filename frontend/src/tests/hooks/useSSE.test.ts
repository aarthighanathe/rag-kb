/**
 * @file useSSE.test.ts
 * @description Unit tests for the useSSE hook — connection lifecycle, event parsing,
 *   reconnect logic, and unmount cleanup.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSSE, safeParseCitations, type SSEOptions } from '../../hooks/useSSE';

// ---------------------------------------------------------------------------
// EventSource mock
// ---------------------------------------------------------------------------

class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;
  onopen: (() => void) | null = null;
  onerror: ((e: Event) => void) | null = null;

  private listeners: Record<string, Array<(e: MessageEvent) => void>> = {};

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: (e: MessageEvent) => void): void {
    this.listeners[type] = this.listeners[type] ?? [];
    this.listeners[type].push(handler);
  }

  /** Test helper — simulates a server event. */
  emit(type: string, data: unknown): void {
    const event = { data: JSON.stringify(data) } as MessageEvent;
    this.listeners[type]?.forEach((h) => h(event));
  }

  /** Test helper — simulates connection open. */
  triggerOpen(): void {
    this.onopen?.();
  }

  /** Test helper — simulates a connection error. */
  triggerError(): void {
    this.onerror?.(new Event('error'));
  }

  close = vi.fn();
  readyState = 0;
}

beforeEach(() => {
  MockEventSource.instances = [];
  (
    vi.spyOn(globalThis, 'EventSource') as unknown as {
      mockImplementation: (impl: unknown) => void;
    }
  ).mockImplementation(function (this: unknown, ...args: unknown[]) {
    return new MockEventSource(args[0] as string) as unknown as EventSource;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noop = (): void => {
  /* noop */
};

function defaultOptions(overrides: Partial<SSEOptions> = {}): SSEOptions {
  return {
    onEvent: noop,
    onError: noop,
    onComplete: noop,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useSSE — connection lifecycle', () => {
  it('does not create EventSource when url is null', () => {
    renderHook(() => useSSE(null, defaultOptions()));
    expect(MockEventSource.instances.length).toBe(0);
  });

  it('creates EventSource when url is provided', () => {
    renderHook(() => useSSE('/api/query/abc/stream', defaultOptions()));
    expect(MockEventSource.instances.length).toBe(1);
    expect(MockEventSource.instances[0]!.url).toBe('/api/query/abc/stream');
  });

  it('isConnected becomes true after open event', async () => {
    const { result } = renderHook(() => useSSE('/api/query/123/stream', defaultOptions()));
    expect(result.current.isConnected).toBe(false);

    await act(async () => {
      MockEventSource.instances[0]!.triggerOpen();
    });

    expect(result.current.isConnected).toBe(true);
  });

  it('closes EventSource on unmount and isConnected becomes false', async () => {
    const { result, unmount } = renderHook(() => useSSE('/api/query/xyz/stream', defaultOptions()));

    await act(async () => {
      MockEventSource.instances[0]!.triggerOpen();
    });

    expect(result.current.isConnected).toBe(true);
    unmount();

    expect(MockEventSource.instances[0]!.close).toHaveBeenCalled();
  });

  it('disconnect() closes connection immediately', async () => {
    const { result } = renderHook(() => useSSE('/api/query/abc/stream', defaultOptions()));

    await act(async () => {
      MockEventSource.instances[0]!.triggerOpen();
    });

    act(() => {
      result.current.disconnect();
    });

    expect(MockEventSource.instances[0]!.close).toHaveBeenCalled();
    expect(result.current.isConnected).toBe(false);
  });

  it('closes EventSource when url changes to null', async () => {
    let url: string | null = '/api/query/test/stream';
    const { rerender } = renderHook(() => useSSE(url, defaultOptions()));

    await act(async () => {
      MockEventSource.instances[0]!.triggerOpen();
    });

    url = null;
    rerender();

    expect(MockEventSource.instances[0]!.close).toHaveBeenCalled();
  });
});

describe('useSSE — event parsing', () => {
  it('fires onEvent for each recognised event type', async () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE('/api/query/stream', defaultOptions({ onEvent })));

    const es = MockEventSource.instances[0]!;
    await act(async () => {
      es.emit('searching', { phase: 'searching' });
      es.emit('found', { count: 3 });
      es.emit('generating', {});
      es.emit('token', { text: 'Hello' });
    });

    expect(onEvent).toHaveBeenCalledTimes(4);
    expect(onEvent).toHaveBeenNthCalledWith(1, { type: 'searching', data: { phase: 'searching' } });
    expect(onEvent).toHaveBeenNthCalledWith(4, { type: 'token', data: { text: 'Hello' } });
  });

  it('fires onComplete and closes on complete event', async () => {
    const onComplete = vi.fn();
    const { result } = renderHook(() =>
      useSSE('/api/query/stream', defaultOptions({ onComplete })),
    );

    const es = MockEventSource.instances[0]!;
    await act(async () => {
      es.triggerOpen();
      es.emit('complete', {});
    });

    expect(onComplete).toHaveBeenCalledOnce();
    expect(es.close).toHaveBeenCalled();
    expect(result.current.isConnected).toBe(false);
  });

  it('fires onEvent for error type (server error, not connection error)', async () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE('/api/query/stream', defaultOptions({ onEvent })));

    await act(async () => {
      MockEventSource.instances[0]!.emit('error', { message: 'LLM timeout' });
    });

    expect(onEvent).toHaveBeenCalledWith({ type: 'error', data: { message: 'LLM timeout' } });
  });

  // Regression: a server 'error' event used to be treated as non-terminal, so
  // the native EventSource onerror that follows shortly after (the backend
  // closes the response right after emitting 'error') would schedule a
  // reconnect against an already-finished stream — 3 wasted round-trips and
  // a duplicate, delayed error appended after the real one.
  it('closes the connection and treats a server error event as terminal (no reconnect after)', async () => {
    vi.useFakeTimers();
    const onEvent = vi.fn();
    const { result } = renderHook(() => useSSE('/api/query/stream', defaultOptions({ onEvent })));

    const es = MockEventSource.instances[0]!;
    await act(async () => {
      es.triggerOpen();
      es.emit('error', { message: 'Groq failure' });
    });

    expect(es.close).toHaveBeenCalled();
    expect(result.current.isConnected).toBe(false);

    // The backend closing the response fires the native onerror shortly
    // after — this must be a no-op, not a reconnect attempt.
    await act(async () => {
      es.triggerError();
      vi.advanceTimersByTime(15_000);
    });

    expect(MockEventSource.instances.length).toBe(1);
    vi.useRealTimers();
  });

  it('gracefully handles malformed JSON in event data', async () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE('/api/query/stream', defaultOptions({ onEvent })));

    const es = MockEventSource.instances[0]!;
    await act(async () => {
      // Simulate a raw event with invalid JSON
      const handler = (
        es as unknown as { listeners: Record<string, Array<(e: MessageEvent) => void>> }
      ).listeners['token']?.[0];
      handler?.({ data: '{invalid json' } as MessageEvent);
    });

    // Should call onEvent with empty data object rather than throwing
    expect(onEvent).toHaveBeenCalledWith({ type: 'token', data: {} });
  });

  it('falls back to an empty data object when the top-level payload does not match the event schema', async () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE('/api/query/stream', defaultOptions({ onEvent })));

    const es = MockEventSource.instances[0]!;
    await act(async () => {
      // A raw array is valid JSON but not an object matching any event schema.
      const handler = (
        es as unknown as { listeners: Record<string, Array<(e: MessageEvent) => void>> }
      ).listeners['token']?.[0];
      handler?.({ data: JSON.stringify(['not', 'an', 'object']) } as MessageEvent);
    });

    expect(onEvent).toHaveBeenCalledWith({ type: 'token', data: {} });
  });

  it('passes through a well-formed found event with a chunks array unchanged', async () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE('/api/query/stream', defaultOptions({ onEvent })));

    const chunk = {
      documentId: 'doc-1',
      filename: 'report.pdf',
      chunkId: 'chunk-1',
      similarity: 0.9,
      excerpt: 'Some excerpt text.',
    };
    await act(async () => {
      MockEventSource.instances[0]!.emit('found', { chunks: [chunk] });
    });

    expect(onEvent).toHaveBeenCalledWith({ type: 'found', data: { chunks: [chunk] } });
  });
});

describe('safeParseCitations', () => {
  const validCitation = {
    documentId: 'doc-1',
    filename: 'report.pdf',
    chunkId: 'chunk-1',
    similarity: 0.9,
    excerpt: 'Some excerpt text.',
    citationNumber: 1,
  };

  it('returns an empty array for non-array input', () => {
    expect(safeParseCitations(undefined)).toEqual([]);
    expect(safeParseCitations(null)).toEqual([]);
    expect(safeParseCitations('not an array')).toEqual([]);
  });

  it('returns valid citations unchanged', () => {
    expect(safeParseCitations([validCitation])).toEqual([validCitation]);
  });

  it('drops individual malformed entries while keeping valid ones', () => {
    const malformed = { documentId: 'doc-2' }; // missing required fields
    expect(safeParseCitations([validCitation, malformed])).toEqual([validCitation]);
  });

  it('returns an empty array when every entry is malformed', () => {
    expect(safeParseCitations([{ foo: 'bar' }, 42, null])).toEqual([]);
  });
});

describe('useSSE — reconnect logic', () => {
  it('reconnects on connection error (attempt 1)', async () => {
    vi.useFakeTimers();
    renderHook(() => useSSE('/api/query/stream', defaultOptions()));

    const first = MockEventSource.instances[0]!;
    await act(async () => {
      first.triggerError();
    });

    // After backoff delay, a new EventSource should be created
    await act(async () => {
      vi.advanceTimersByTime(1200); // first retry: 1000ms
    });

    expect(MockEventSource.instances.length).toBe(2);
    vi.useRealTimers();
  });

  it('calls onError after exhausting all retries', async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    renderHook(() => useSSE('/api/query/stream', defaultOptions({ onError, maxRetries: 2 })));

    // Trigger error on each attempt
    for (let i = 0; i < 3; i++) {
      const es = MockEventSource.instances[MockEventSource.instances.length - 1]!;
      await act(async () => {
        es.triggerError();
      });
      await act(async () => {
        vi.advanceTimersByTime(15_000);
      });
    }

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('failed') }),
    );
    vi.useRealTimers();
  });

  it('grows the retry delay exponentially rather than retrying at a constant interval', async () => {
    vi.useFakeTimers();
    renderHook(() => useSSE('/api/query/stream', defaultOptions({ maxRetries: 3 })));

    // Attempt 1: delay is 1000 * 2**0 = 1000ms. Advancing only 900ms must NOT
    // yet trigger a reconnect — this is what a regression to a constant
    // (e.g. always-1000ms) backoff would still pass, so it alone isn't proof
    // of exponential growth, but it's the baseline the next attempt is
    // checked against.
    await act(async () => {
      MockEventSource.instances[0]!.triggerError();
    });
    await act(async () => {
      vi.advanceTimersByTime(900);
    });
    expect(MockEventSource.instances.length).toBe(1);
    await act(async () => {
      vi.advanceTimersByTime(200);
    }); // crosses the 1000ms mark
    expect(MockEventSource.instances.length).toBe(2);

    // Attempt 2: delay is 1000 * 2**1 = 2000ms. Under constant backoff this
    // would already have fired by 1000ms; asserting it hasn't distinguishes
    // exponential growth from a flat retry interval.
    await act(async () => {
      MockEventSource.instances[1]!.triggerError();
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(MockEventSource.instances.length).toBe(2);
    await act(async () => {
      vi.advanceTimersByTime(1100);
    }); // crosses the 2000ms mark
    expect(MockEventSource.instances.length).toBe(3);

    vi.useRealTimers();
  });

  it('stops reconnecting once maxRetries is reached, capping instances at maxRetries + 1', async () => {
    vi.useFakeTimers();
    renderHook(() => useSSE('/api/query/stream', defaultOptions({ maxRetries: 2 })));

    // Drive well past the point where a 4th connection could appear if the
    // cap were off by one (or missing entirely).
    for (let i = 0; i < 5; i++) {
      const es = MockEventSource.instances[MockEventSource.instances.length - 1]!;
      await act(async () => {
        es.triggerError();
      });
      await act(async () => {
        vi.advanceTimersByTime(15_000);
      });
    }

    // Initial connection + exactly maxRetries reconnects, never more.
    expect(MockEventSource.instances.length).toBe(3);
    vi.useRealTimers();
  });
});

describe('useSSE — cleanup', () => {
  it('clears retry timer on unmount to prevent memory leaks', async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    const { unmount } = renderHook(() => useSSE('/api/query/stream', defaultOptions()));

    await act(async () => {
      MockEventSource.instances[0]!.triggerError(); // schedules retry timer
    });

    unmount(); // should clear the timer

    expect(clearTimeoutSpy).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('does not fire callbacks after unmount', async () => {
    const onEvent = vi.fn();
    const { unmount } = renderHook(() => useSSE('/api/query/stream', defaultOptions({ onEvent })));

    unmount();

    // Attempt to emit after unmount (es still exists in our mock)
    const es = MockEventSource.instances[0];
    if (es) {
      await act(async () => {
        es.emit('token', { text: 'ghost' });
      });
    }

    // onEvent should NOT have been called post-unmount
    expect(onEvent).not.toHaveBeenCalled();
  });
});
