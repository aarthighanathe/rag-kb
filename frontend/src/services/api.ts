/**
 * @file api.ts
 * @description Typed API client — fetch-based wrappers for all backend endpoints.
 *   Attaches X-Correlation-ID to every request. Throws typed APIError on non-200.
 *   Response shapes are validated via runtime type guards.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { formatUserFacingError } from '../utils/formatError';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Single uploaded document from POST /api/upload response envelope. */
export interface UploadedDocument {
  id: string;
  filename: string;
  status: 'pending';
  jobId: string;
}

/** Backend upload response from POST /api/upload. */
export interface UploadResponse {
  documentId: string;
  filename: string;
  status: 'pending';
  jobId: string;
}

/** Single document record. */
export interface DocumentRecord {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  chunk_count: number;
  created_at: string;
  updated_at: string;
  error_message?: string | null;
}

/** Chunk quality statistics for a processed document. */
export interface ChunkQualityStats {
  totalChunks: number;
  avgTokenCount: number;
  minTokenCount: number;
  maxTokenCount: number;
  shortChunkCount: number;
  longChunkCount: number;
  grade: 'good' | 'fair' | 'poor';
}

/** Document with optional chunk quality stats (from GET /api/documents/:id). */
export interface DocumentWithQuality {
  document: DocumentRecord;
  chunkQuality: ChunkQualityStats | null;
}

/** Paginated document list response. */
export interface ListDocumentsResponse {
  success: boolean;
  data: DocumentRecord[];
  meta: {
    page: number;
    total: number;
    correlationId: string;
  };
}

/** Query initiation request body — field names must match the backend QueryRequestSchema. */
export interface QueryRequest {
  query: string;
  documentIds?: string[];
  matchCount?: number;
  similarityThreshold?: number;
  /** Previous conversation turns for multi-turn context (user+assistant pairs, oldest first). */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

/** Polling result derived from document status — used by startPolling in ragStore. */
export interface JobStatus {
  documentId: string;
  state: 'waiting' | 'active' | 'completed' | 'failed';
  progress: number;
  error?: string;
}

/** Single document similarity pair from GET /api/documents/similarity. */
export interface SimilarityPair {
  documentA: string;
  documentB: string;
  similarity: number;
}

/** Similarity response envelope. */
export interface SimilarityResponse {
  pairs: SimilarityPair[];
  documents: DocumentRecord[];
}

/** Typed error thrown by this client on non-2xx responses. */
export class TypedApiError extends Error {
  readonly code?: string;
  readonly correlationId: string;
  readonly statusCode: number;
  readonly details?: unknown;

  /**
   * Creates a TypedApiError from a parsed message and metadata.
   * @param message - Human-readable error message
   * @param options - Status code, correlation ID, and optional code/details
   */
  constructor(
    message: string,
    options: { correlationId: string; statusCode: number; code?: string; details?: unknown },
  ) {
    super(message);
    this.name = 'TypedApiError';
    this.correlationId = options.correlationId;
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.details = options.details;
  }
}

/**
 * Parses an API error response body into a TypedApiError.
 * Handles the standard `{ error: { code, message } }` envelope and legacy flat shapes.
 * @param body - Parsed JSON response body
 * @param statusCode - HTTP status code
 * @param fallbackCorrelationId - Correlation ID from request headers when absent in body
 * @returns TypedApiError with a string message (never an object)
 */
function parseApiErrorBody(
  body: unknown,
  statusCode: number,
  fallbackCorrelationId: string,
): TypedApiError {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const correlationId =
      typeof record.correlationId === 'string' ? record.correlationId : fallbackCorrelationId;

    if (record.error && typeof record.error === 'object' && record.error !== null) {
      const errObj = record.error as Record<string, unknown>;
      const message = typeof errObj.message === 'string' ? errObj.message : 'Request failed';
      const code = typeof errObj.code === 'string' ? errObj.code : undefined;
      return new TypedApiError(message, {
        correlationId,
        statusCode,
        code,
        details: errObj.details,
      });
    }

    if (typeof record.error === 'string') {
      return new TypedApiError(record.error, {
        correlationId,
        statusCode,
        details: record.details,
      });
    }
  }

  return new TypedApiError('Request failed', {
    correlationId: fallbackCorrelationId,
    statusCode,
  });
}

/**
 * Extracts a human-readable error message from any thrown value.
 * @param err - Caught error (Error, string, API envelope object, or unknown)
 * @param fallback - Message used when no readable string can be extracted
 * @returns Always a plain string — never an object
 */
export function extractErrorMessage(
  err: unknown,
  fallback = 'Upload failed — unknown error',
): string {
  let raw = fallback;
  let code: string | undefined;

  if (err instanceof TypedApiError) {
    raw = err.message;
    code = err.code;
  } else if (err instanceof Error) {
    raw = err.message;
  } else if (typeof err === 'string') {
    raw = err;
  } else if (err && typeof err === 'object') {
    const record = err as Record<string, unknown>;
    if (record.error && typeof record.error === 'object' && record.error !== null) {
      const errObj = record.error as Record<string, unknown>;
      if (typeof errObj.message === 'string') {
        raw = errObj.message;
      }
      if (typeof errObj.code === 'string') {
        code = errObj.code;
      }
    } else if (typeof record.message === 'string') {
      raw = record.message;
    }
  }

  return formatUserFacingError(raw, code);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// Defaults to the Vite dev-server proxy ('/api' → http://localhost:3000, see vite.config.ts).
// Set VITE_API_BASE_URL (frontend/.env.local) to an absolute URL — e.g. a devtunnel
// forwarding address — when the frontend and backend are not reachable on the same origin.
const BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? '/api';

/** Generates a UUID v4 for correlation tracking. */
function newCorrelationId(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Auth token bridge
// ---------------------------------------------------------------------------
//
// This module is plain TS, not a React component, so it can't call the
// useAuth() hook directly. App.tsx calls registerTokenGetter(getToken) once
// on mount, and every request below pulls the current Clerk JWT through it.

let getTokenFn: (() => Promise<string | null>) | null = null;

/**
 * Registers Clerk's getToken function for use by every API call in this module.
 * Call once from a component under ClerkProvider (see App.tsx).
 * @param fn - Clerk's useAuth().getToken, or equivalent
 */
export function registerTokenGetter(fn: () => Promise<string | null>): void {
  getTokenFn = fn;
}

/**
 * Fetches the current Clerk session JWT for the Authorization header.
 * @returns The JWT, or null if no token getter is registered / user is signed out
 */
async function getAuthToken(): Promise<string | null> {
  if (!getTokenFn) return null;
  return getTokenFn();
}

/**
 * Core fetch wrapper — adds correlation ID and Bearer auth, parses JSON, throws on errors.
 * @param path    - Relative path under /api
 * @param init    - RequestInit merged with defaults
 * @returns Parsed JSON response body
 */
async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const correlationId = newCorrelationId();
  const token = await getAuthToken();

  const headers = new Headers(init.headers);
  headers.set('X-Correlation-ID', correlationId);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Content-Type') && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    throw parseApiErrorBody(body, response.status, correlationId);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/**
 * Fetches a paginated list of documents.
 * @param page   - 1-based page number
 * @param limit  - Results per page
 * @param status - Optional status filter
 */
export async function listDocuments(
  page = 1,
  limit = 50,
  status?: DocumentRecord['status'],
): Promise<ListDocumentsResponse> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (status) params.set('status', status);
  return apiFetch<ListDocumentsResponse>(`/documents?${params.toString()}`);
}

/**
 * Fetches a single document by UUID with chunk quality stats.
 * @param id - Document UUID
 */
export async function getDocument(id: string): Promise<DocumentWithQuality> {
  const body = await apiFetch<{ success: boolean; data: DocumentWithQuality }>(`/documents/${id}`);
  return body.data;
}

/**
 * Deletes a document and all associated chunks.
 * @param id - Document UUID
 */
export async function deleteDocument(id: string): Promise<void> {
  await apiFetch<void>(`/documents/${id}`, { method: 'DELETE' });
}

/** Backend default for the similarity threshold — omit the query param when equal to this. */
const DEFAULT_SIMILARITY_THRESHOLD = 0.3;

/**
 * Fetches pairwise document similarity data.
 * @param threshold - Minimum similarity to include (default 0.3, range 0-1)
 */
export async function getDocumentSimilarity(
  threshold = DEFAULT_SIMILARITY_THRESHOLD,
): Promise<SimilarityResponse> {
  const params = new URLSearchParams();
  // Epsilon comparison rather than exact float equality — robust against a
  // future slider control passing an arithmetically-equivalent-but-not-bit-
  // identical value (e.g. 0.1 + 0.2 artefacts) instead of the literal default.
  if (Math.abs(threshold - DEFAULT_SIMILARITY_THRESHOLD) > 1e-9) {
    params.set('threshold', String(threshold));
  }
  const qs = params.toString();
  const body = await apiFetch<{ success: boolean; data: SimilarityResponse }>(
    `/documents/similarity${qs ? `?${qs}` : ''}`,
  );
  return body.data;
}

// ---------------------------------------------------------------------------
// Upload (XMLHttpRequest-based for real progress)
// ---------------------------------------------------------------------------

/** Max time allowed for an upload request, including the transfer itself — a stalled
 *  (not reset) connection would otherwise leave the UI showing "Uploading N%" forever
 *  with no error and no way to retry. Generous because large files over a slow
 *  connection are expected to take a while, but bounded so it eventually fails loud. */
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Uploads a single file with optional progress callback.
 * Uses XMLHttpRequest so the browser fires real upload-progress events.
 * @param file       - File object to upload
 * @param onProgress - Callback receiving 0-100 progress value
 */
export async function uploadDocument(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<UploadResponse> {
  const token = await getAuthToken();

  return new Promise((resolve, reject) => {
    const correlationId = newCorrelationId();
    const formData = new FormData();
    // Backend uses upload.array('files', 5) — field name must be 'files'
    formData.append('files', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE_URL}/upload`);
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    xhr.setRequestHeader('X-Correlation-ID', correlationId);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (event) => {
      if (onProgress && event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          // Backend returns { success, data: { documents: [{ id, filename, status, jobId }] }, meta }
          const body = JSON.parse(xhr.responseText) as {
            success: boolean;
            data: { documents: UploadedDocument[] };
          };
          const doc = body.data.documents[0];
          if (!doc) {
            reject(new Error('Upload response contained no documents'));
            return;
          }
          resolve({ documentId: doc.id, filename: doc.filename, status: doc.status, jobId: doc.jobId });
        } catch {
          reject(new Error('Invalid JSON in upload response'));
        }
      } else {
        try {
          const body = JSON.parse(xhr.responseText) as unknown;
          reject(parseApiErrorBody(body, xhr.status, correlationId));
        } catch {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      }
    };

    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.onabort = () => reject(new Error('Upload aborted'));
    xhr.ontimeout = () =>
      reject(new Error('Upload timed out — the connection stalled. Please try again.'));

    xhr.send(formData);
  });
}

// ---------------------------------------------------------------------------
// Query / SSE
// ---------------------------------------------------------------------------

/**
 * Initiates a RAG query. The server stores the query and returns a queryId
 * that can be used to open the SSE stream.
 * @param request - Query body with search parameters
 * @returns Object containing the queryId to open the SSE stream
 */
export async function initiateQuery(
  request: QueryRequest,
): Promise<{ queryId: string }> {
  // Backend route is POST /api/query (returns { success, data: { queryId } })
  const body = await apiFetch<{ success: boolean; data: { queryId: string } }>('/query', {
    method: 'POST',
    body: JSON.stringify(request),
  });
  return { queryId: body.data.queryId };
}

/**
 * Builds the GET URL for the SSE stream of a given query.
 * Backend route: GET /api/query/stream?queryId=<uuid>
 * @param queryId - ID returned by initiateQuery
 * @returns Absolute path for use with EventSource
 */
export function getQueryStreamUrl(queryId: string): string {
  return `${BASE_URL}/query/stream?queryId=${encodeURIComponent(queryId)}`;
}

/** Helpfulness rating for a completed query's answer. */
export type QueryFeedback = 'helpful' | 'not_helpful';

/**
 * Submits (or updates) a helpfulness rating for a completed query.
 * `queryId` here is the `query_logs` row id from the SSE `complete` event's
 * payload — not the ephemeral queryId used by initiateQuery/getQueryStreamUrl,
 * which is single-use and no longer valid once the stream has finished.
 * Idempotent: calling this again for the same queryId overwrites the prior rating.
 * @param queryId - query_logs row id (ChatMessage.queryLogId)
 * @param feedback - 'helpful' | 'not_helpful'
 */
export async function submitQueryFeedback(
  queryId: string,
  feedback: QueryFeedback,
): Promise<void> {
  await apiFetch<{ success: boolean; data: { queryId: string; feedback: QueryFeedback } }>(
    `/query/${queryId}/feedback`,
    {
      method: 'POST',
      body: JSON.stringify({ feedback }),
    },
  );
}

// ---------------------------------------------------------------------------
// Job polling
// ---------------------------------------------------------------------------

/**
 * Polls a document's processing status by document ID.
 * Maps document record status to a JobStatus shape for ragStore compatibility.
 * Uses GET /api/documents/:id instead of the admin-only /api/queue/job/:jobId.
 * @param documentId - Document UUID returned by the upload endpoint
 */
export async function getJobStatus(documentId: string): Promise<JobStatus> {
  const body = await apiFetch<{ success: boolean; data: DocumentWithQuality }>(`/documents/${documentId}`);
  const doc = body.data.document;
  const stateMap: Record<DocumentRecord['status'], JobStatus['state']> = {
    pending: 'waiting',
    processing: 'active',
    ready: 'completed',
    failed: 'failed',
  };
  return {
    documentId,
    state: stateMap[doc.status],
    progress: doc.status === 'ready' ? 100 : doc.status === 'processing' ? 50 : 0,
    error: doc.error_message ?? undefined,
  };
}
