/**
 * @file requestContext.ts
 * @description AsyncLocalStorage-backed per-request context — makes the current
 *   request's correlation ID available to any code running within that
 *   request's async call chain, without threading it through every function
 *   signature. The logger reads from this store to attach correlationId to
 *   every log line automatically, including from service-layer code that
 *   never received a correlationId parameter.
 * @author [Author Placeholder]
 * @created 2026-08-31
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/** Per-request fields available to any code running within that request's async chain. */
export interface RequestContext {
  correlationId: string;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Runs `callback` with `context` available to every function it calls
 * (directly or via further async work) through `getRequestContext()`.
 * @param context - Per-request fields to make available
 * @param callback - The work to run within this context
 * @returns Whatever `callback` returns
 */
export function runWithRequestContext<T>(context: RequestContext, callback: () => T): T {
  return asyncLocalStorage.run(context, callback);
}

/**
 * Returns the current request's context, if code is running within one.
 * Returns undefined outside any request (e.g. startup, a cron job, a test
 * calling a service function directly) — callers must treat correlationId
 * as optional, exactly as they did before this existed.
 * @returns The current RequestContext, or undefined
 */
export function getRequestContext(): RequestContext | undefined {
  return asyncLocalStorage.getStore();
}
