/**
 * @file requestContext.test.ts
 * @description Unit tests for the AsyncLocalStorage-backed per-request context
 *   that lets service-layer code observe the current request's correlationId
 *   without receiving it as an explicit parameter.
 * @author [Author Placeholder]
 * @created 2026-08-31
 */

import { describe, it, expect } from 'vitest';
import { runWithRequestContext, getRequestContext } from '../../src/utils/requestContext';

describe('getRequestContext', () => {
  it('returns undefined outside any request context', () => {
    expect(getRequestContext()).toBeUndefined();
  });

  it('returns the context set by runWithRequestContext for code running inside it', () => {
    runWithRequestContext({ correlationId: 'corr-1' }, () => {
      expect(getRequestContext()).toEqual({ correlationId: 'corr-1' });
    });
  });

  it('propagates through nested async calls within the same request', async () => {
    async function deeplyNestedCall(): Promise<string | undefined> {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      return getRequestContext()?.correlationId;
    }

    const result = await runWithRequestContext({ correlationId: 'corr-2' }, () => deeplyNestedCall());

    expect(result).toBe('corr-2');
  });

  it('does not leak context between two concurrent requests', async () => {
    const results: (string | undefined)[] = [];

    async function simulateRequest(correlationId: string): Promise<void> {
      await runWithRequestContext({ correlationId }, async () => {
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
        results.push(getRequestContext()?.correlationId);
      });
    }

    await Promise.all([simulateRequest('req-a'), simulateRequest('req-b'), simulateRequest('req-c')]);

    expect(results.sort()).toEqual(['req-a', 'req-b', 'req-c']);
  });

  it('returns undefined again once the context has exited', () => {
    runWithRequestContext({ correlationId: 'corr-3' }, () => {
      expect(getRequestContext()).toBeDefined();
    });
    expect(getRequestContext()).toBeUndefined();
  });
});
