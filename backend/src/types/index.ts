/**
 * @file index.ts
 * @description Shared TypeScript types and custom error classes for the RAG backend
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

// ─── Custom Error Classes ─────────────────────────────────────────────────────

/** Base application error with HTTP status code and optional metadata. */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  // exactOptionalPropertyTypes: explicit undefined union required when value can be absent
  public readonly meta?: Record<string, unknown> | undefined;

  constructor(
    message: string,
    statusCode: number,
    isOperational = true,
    meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.meta = meta;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, meta?: Record<string, unknown>) {
    super(message, 400, true, meta);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, true);
  }
}

export class InternalError extends AppError {
  /**
   * Optional machine-readable sub-code for InternalError's otherwise-generic
   * 'INTERNAL' envelope code — lets clients (e.g. formatUserFacingError)
   * distinguish "DB unreachable" from "schema not migrated" from a truly
   * generic internal failure without re-parsing the human-readable message.
   */
  public readonly code?: string | undefined;

  constructor(message = 'Internal server error', code?: string) {
    super(message, 500, false);
    this.code = code;
  }
}

// ─── Domain Types ─────────────────────────────────────────────────────────────

/** Supported document MIME types. */
export type SupportedMimeType =
  | 'application/pdf'
  | 'text/plain'
  | 'text/markdown'
  | 'text/html'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Document status lifecycle. */
export type DocumentStatus = 'pending' | 'processing' | 'ready' | 'failed';

/** A document record stored in Supabase. */
export interface DocumentRecord {
  id: string;
  filename: string;
  mime_type: SupportedMimeType;
  size_bytes: number;
  status: DocumentStatus;
  chunk_count: number;
  created_at: string;
  updated_at: string;
  error_message?: string;
  /** Auto-derived (from section headings) and/or user-edited tags. Empty array if none. */
  tags: string[];
}

/** Metadata attached to each chunk for citation purposes. */
export interface ChunkMetadata {
  page?: number;
  section?: string;
  char_start: number;
  char_end: number;
}

/** A retrieved chunk with similarity score for RAG context. */
export interface RetrievedChunk {
  id: string;
  document_id: string;
  content: string;
  similarity: number;
  metadata: ChunkMetadata;
  filename: string;
  /**
   * Which retrieval method produced this chunk.
   * 'vector' — cosine similarity (all-MiniLM-L6-v2, scores ~0.04–0.40).
   * 'keyword' — pg_trgm trigram similarity (scores ~0.15–1.0, different scale).
   * Used downstream (classifyRelevanceBand in llm.ts, calculateConfidence on the
   * frontend) to apply origin-appropriate thresholds instead of treating both
   * scales as the same metric.
   */
  source: 'vector' | 'keyword';
}

/** Source citation included with an LLM answer. */
export interface SourceCitation {
  documentId: string;
  filename: string;
  chunkId: string;
  similarity: number;
  excerpt: string;
  /**
   * 1-based position of this chunk in the original retrieval order — the same
   * number the model was shown as `[N]` in the prompt (see buildContextString).
   * Preserved through filterCitationsByModelOutput so the frontend can match a
   * `[N]` marker back to its citation even after out-of-range/uncited entries
   * are dropped and the array is no longer index-aligned with the model's
   * numbering.
   */
  citationNumber: number;
}

/** BullMQ job data payload for document processing. */
export interface DocumentJobData {
  documentId: string;
  storageKey: string;
  fileType: FileType;
  originalName: string;
  correlationId: string;
  /** Owner of the document — carried through for log tracing only; ownership is enforced at upload time. */
  userId: string;
}

/** BullMQ job result after successful processing. */
export interface DocumentJobResult {
  chunkCount: number;
  processingTimeMs: number;
}

/** Snapshot of a BullMQ job's current state and progress. */
export interface JobStatus {
  jobId: string;
  state: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'unknown';
  progress: number;
  result?: DocumentJobResult;
  failedReason?: string;
  timestamp: number;
  finishedOn?: number;
}

// ─── File Handling Types ──────────────────────────────────────────────────────

/** Extension-based file type identifier used for buffer extraction and magic-byte validation. */
export type FileType = 'pdf' | 'docx' | 'txt' | 'md' | 'html';

/** Result of the complete server-side file validation pipeline. */
export interface FileValidationResult {
  isValid: boolean;
  fileType: FileType;
  mimeType: SupportedMimeType;
  sanitizedName: string;
  sizeBytes: number;
}

/** Alias for RetrievedChunk — shape returned by pgvector similarity search. */
export type MatchChunksResult = RetrievedChunk;

/** Allowed values for query_logs.feedback (see 002_add_query_feedback.sql). */
export type QueryFeedback = 'helpful' | 'not_helpful';

/**
 * Full row shape of the `query_logs` table.
 * Append-only analytics record written after each RAG query.
 */
export interface QueryLog {
  id: string;
  query_text: string;
  retrieved_chunk_ids: string[] | null;
  response_preview: string | null;
  latency_ms: number | null;
  created_at: string;
  /** Clerk user ID (sub claim) that issued this query. */
  user_id: string;
  /** User-submitted helpfulness rating. NULL until rated (most rows stay unrated). */
  feedback: QueryFeedback | null;
  /** Post-hoc validation confidence (0-1), written asynchronously after the stream completes. NULL until validated. */
  validation_confidence: number | null;
  /** Count of issues (hallucination/contradiction/etc.) flagged by post-hoc validation. NULL until validated. */
  validation_issue_count: number | null;
}

/**
 * Payload for inserting a query log entry.
 * All analytics fields are optional — the query text is the only requirement.
 */
export type InsertQueryLog = Omit<
  QueryLog,
  'id' | 'created_at' | 'feedback' | 'validation_confidence' | 'validation_issue_count'
> & {
  retrieved_chunk_ids?: string[] | null;
  response_preview?: string | null;
  latency_ms?: number | null;
  /** Never set at insert time — feedback is only added later via setQueryFeedback. */
  feedback?: null;
};

// ─── Request Augmentation ─────────────────────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      correlationId: string;
      /** Set by requireAuth middleware after successful Clerk JWT verification. */
      auth?: {
        userId: string;
        email?: string;
      };
    }
  }
}
