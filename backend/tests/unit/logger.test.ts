/**
 * @file logger.test.ts
 * @description Unit tests for the Winston logger's correlationId auto-injection —
 *   log lines written from within a request's async context pick up its
 *   correlationId automatically, even without an explicit logger.child() call,
 *   while an explicitly-provided correlationId always takes priority.
 * @author [Author Placeholder]
 * @created 2026-08-31
 */

import { describe, it, expect, vi } from 'vitest';
import Transport from 'winston-transport';
import { runWithRequestContext } from '../../src/utils/requestContext';

// tests/setup.ts globally mocks this module (a plain vi.fn() stub, to
// suppress log noise across the suite) — this file specifically tests the
// real Winston pipeline, so it must opt back in to the actual implementation.
vi.unmock('../../src/utils/logger');
const { logger } = await import('../../src/utils/logger');

/** Winston transport that records every info object it receives, for assertions. */
class CapturingTransport extends Transport {
  captured: Record<string, unknown>[] = [];
  override log(info: Record<string, unknown>, callback: () => void): void {
    this.captured.push(info);
    callback();
  }
}

/**
 * Captures the info object Winston's format pipeline produces for one log
 * call. Every call in this file logs at 'error' level — tests/setup.ts sets
 * LOG_LEVEL=error globally, and a level below the logger's configured level
 * is filtered before the format pipeline (and this transport) ever runs.
 */
function captureLogInfo(action: () => void): Record<string, unknown> {
  const capturing = new CapturingTransport();
  logger.add(capturing);
  try {
    action();
  } finally {
    logger.remove(capturing);
  }
  return capturing.captured[0] ?? {};
}

describe('logger correlationId auto-injection', () => {
  it('attaches no correlationId when logging outside any request context', () => {
    const info = captureLogInfo(() => logger.error('no context'));
    expect(info['correlationId']).toBeUndefined();
  });

  it('attaches the current request context correlationId automatically', () => {
    const info = runWithRequestContext({ correlationId: 'corr-auto' }, () =>
      captureLogInfo(() => logger.error('inside request context')),
    );
    expect(info['correlationId']).toBe('corr-auto');
  });

  it('does not override an explicitly-provided correlationId with the context one', () => {
    const info = runWithRequestContext({ correlationId: 'corr-context' }, () =>
      captureLogInfo(() => logger.error('explicit wins', { correlationId: 'corr-explicit' })),
    );
    expect(info['correlationId']).toBe('corr-explicit');
  });

  it('propagates through logger.child() calls made inside a request context', () => {
    const info = runWithRequestContext({ correlationId: 'corr-child' }, () => {
      const child = logger.child({});
      return captureLogInfo(() => child.error('via child logger'));
    });
    expect(info['correlationId']).toBe('corr-child');
  });
});
