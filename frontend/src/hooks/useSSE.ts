/**
 * @file useSSE.ts
 * @description React hook for Server-Sent Events via EventSource.
 *   Connects when url is non-null, disconnects when url becomes null or on unmount.
 *   Auto-reconnects on connection loss with exponential backoff (max 3 attempts).
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** All event types emitted by the RAG query SSE stream. */
export type SSEEventType = 'searching' | 'found' | 'generating' | 'token' | 'complete' | 'error';

/** Parsed SSE event with typed data payload. */
export interface SSEEvent {
  type: SSEEventType;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Event payload schemas
// ---------------------------------------------------------------------------

/**
 * Matches the backend's SourceCitation shape (backend/src/types/index.ts) as
 * carried in 'found' (`chunks`) and 'complete' (`citations`) event payloads.
 * Every field is validated but consumers only ever narrow with `.optional()`
 * downstream reads, so a single malformed citation in an array is dropped
 * rather than invalidating the whole event (see `safeParseCitationArray`).
 */
const citationSchema = z.object({
  documentId: z.string(),
  filename: z.string(),
  chunkId: z.string(),
  similarity: z.number(),
  excerpt: z.string(),
  citationNumber: z.number(),
});

const sseDataSchemas = {
  searching: z.object({}).passthrough(),
  found: z.object({ chunks: z.array(z.unknown()).optional() }).passthrough(),
  generating: z.object({}).passthrough(),
  token: z.object({ content: z.string().optional() }).passthrough(),
  complete: z
    .object({
      citations: z.array(z.unknown()).optional(),
      queryLogId: z.string().optional(),
    })
    .passthrough(),
  error: z.object({ message: z.string().optional() }).passthrough(),
} as const satisfies Record<SSEEventType, z.ZodTypeAny>;

/**
 * Validates a raw parsed SSE payload against the schema for its event type.
 * Never throws: a payload that fails the top-level shape check (not just an
 * individual optional field) falls back to an empty object rather than
 * blocking the event entirely — `Chat.tsx`'s per-field `typeof`/`Array.isArray`
 * guards already tolerate missing data, so this is defense in depth at the
 * parse boundary, not a hard gate that could freeze the whole stream on one
 * malformed event.
 * @param type - SSE event type, selects which schema to validate against
 * @param data - Parsed JSON payload from the event
 * @returns The validated data, or an empty object if it didn't match the expected shape
 */
function validateSSEData(type: SSEEventType, data: unknown): Record<string, unknown> {
  const schema = sseDataSchemas[type];
  const result = schema.safeParse(data);
  return result.success ? result.data : {};
}

/**
 * Filters an array of unknown items down to those matching the citation
 * shape, dropping malformed entries individually rather than discarding the
 * whole array over one bad element.
 * @param items - Raw array from a 'found'/'complete' event's `chunks`/`citations` field
 * @returns Only the items that validate as citations
 */
export function safeParseCitations(items: unknown): Array<z.infer<typeof citationSchema>> {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => citationSchema.safeParse(item))
    .filter((r): r is { success: true; data: z.infer<typeof citationSchema> } => r.success)
    .map((r) => r.data);
}

/** Callbacks the consumer provides to handle stream events. */
export interface SSEOptions {
  /** Fired for every parsed event. */
  onEvent: (event: SSEEvent) => void;
  /** Fired when the EventSource connection itself errors (not a server error event). */
  onError: (error: Error) => void;
  /** Fired when a 'complete' event is received from the server. */
  onComplete: () => void;
  /** Maximum reconnection attempts (default: 3). */
  maxRetries?: number;
}

/** Values returned by useSSE. */
export interface SSEControls {
  /** True while an EventSource connection is open. */
  isConnected: boolean;
  /** Immediately closes the connection without reconnecting. */
  disconnect: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manages an EventSource SSE connection tied to a URL.
 *
 * - Connects automatically when `url` becomes a non-null string.
 * - Disconnects when `url` becomes null or the component unmounts.
 * - On connection error, retries up to `maxRetries` times with exponential backoff.
 * - After a 'complete' event, closes gracefully without reconnecting.
 *
 * @param url     - GET URL of the SSE endpoint; null means no connection
 * @param options - Event callbacks and config
 * @returns isConnected flag and manual disconnect function
 */
export function useSSE(url: string | null, options: SSEOptions): SSEControls {
  const { onEvent, onError, onComplete, maxRetries = 3 } = options;

  const [isConnected, setIsConnected] = useState(false);

  // Refs so callbacks inside the closure always see the latest values
  const esRef = useRef<EventSource | null>(null);
  const retryRef = useRef(0);
  const completedRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable refs for the callbacks (so effect deps don't include closures)
  const onEventRef = useRef(onEvent);
  const onErrorRef = useRef(onError);
  const onCompleteRef = useRef(onComplete);
  onEventRef.current = onEvent;
  onErrorRef.current = onError;
  onCompleteRef.current = onComplete;

  const disconnect = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setIsConnected(false);
    retryRef.current = 0;
    completedRef.current = false;
  }, []);

  useEffect(() => {
    if (!url) {
      disconnect();
      return;
    }

    completedRef.current = false;
    retryRef.current = 0;

    const connect = (): void => {
      if (completedRef.current) return;

      const es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => {
        setIsConnected(true);
        retryRef.current = 0;
      };

      // Handle each named event type the server emits
      const eventTypes: SSEEventType[] = [
        'searching',
        'found',
        'generating',
        'token',
        'complete',
        'error',
      ];

      eventTypes.forEach((type) => {
        es.addEventListener(type, (ev: MessageEvent) => {
          // Guard: bail out if this es has been closed/replaced by disconnect() or reconnect
          if (esRef.current !== es) return;
          let data: Record<string, unknown> = {};
          try {
            const parsed: unknown = JSON.parse(ev.data as string);
            data = validateSSEData(type, parsed);
          } catch {
            // Malformed JSON — pass empty data object
          }

          if (type === 'complete') {
            completedRef.current = true;
            es.close();
            esRef.current = null;
            setIsConnected(false);
            onEventRef.current({ type, data });
            onCompleteRef.current();
            return;
          }

          if (type === 'error') {
            // A server-sent 'error' event (e.g. a Groq failure) is terminal —
            // the backend closes the response right after emitting it. Mark
            // completedRef so the native EventSource onerror that follows
            // shortly after is a no-op instead of scheduling a reconnect
            // against a queryId whose stream has already ended: without
            // this, the client burned 3 reconnect attempts and appended a
            // second, delayed, generic error message after the real one.
            completedRef.current = true;
            es.close();
            esRef.current = null;
            setIsConnected(false);
            onEventRef.current({ type, data });
            return;
          }

          onEventRef.current({ type, data });
        });
      });

      es.onerror = () => {
        if (completedRef.current) return;

        es.close();
        esRef.current = null;
        setIsConnected(false);

        const attempt = retryRef.current;
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * 2 ** attempt, 10_000);
          retryRef.current += 1;
          retryTimerRef.current = setTimeout(connect, delay);
        } else {
          onErrorRef.current(new Error(`SSE connection failed after ${maxRetries} attempts`));
        }
      };
    };

    connect();

    return () => {
      disconnect();
    };
  }, [url, maxRetries, disconnect]);

  return { isConnected, disconnect };
}
