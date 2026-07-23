/**
 * @file errors.ts
 * @description Domain-specific typed error classes for each RAG pipeline layer
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { AppError } from '../types/index.js';

// ─── Error Code Enums ─────────────────────────────────────────────────────────

export enum ChunkingErrorCode {
  PARSE_FAILED = 'CHUNKING_PARSE_FAILED',
  EMPTY_DOCUMENT = 'CHUNKING_EMPTY_DOCUMENT',
  UNSUPPORTED_FORMAT = 'CHUNKING_UNSUPPORTED_FORMAT',
  ENCODING_ERROR = 'CHUNKING_ENCODING_ERROR',
}

export enum EmbeddingErrorCode {
  API_UNAVAILABLE = 'EMBEDDING_API_UNAVAILABLE',
  RATE_LIMITED = 'EMBEDDING_RATE_LIMITED',
  INVALID_DIMENSION = 'EMBEDDING_INVALID_DIMENSION',
  BATCH_TOO_LARGE = 'EMBEDDING_BATCH_TOO_LARGE',
  EMPTY_INPUT = 'EMBEDDING_EMPTY_INPUT',
  MAX_RETRIES_EXCEEDED = 'EMBEDDING_MAX_RETRIES_EXCEEDED',
}

export enum VectorStoreErrorCode {
  INSERT_FAILED = 'VECTOR_STORE_INSERT_FAILED',
  QUERY_FAILED = 'VECTOR_STORE_QUERY_FAILED',
  NOT_FOUND = 'VECTOR_STORE_NOT_FOUND',
  DELETE_FAILED = 'VECTOR_STORE_DELETE_FAILED',
  CONNECTION_FAILED = 'VECTOR_STORE_CONNECTION_FAILED',
  LENGTH_MISMATCH = 'VECTOR_STORE_LENGTH_MISMATCH',
}

export enum LLMErrorCode {
  STREAM_FAILED = 'LLM_STREAM_FAILED',
  CONTEXT_TOO_LONG = 'LLM_CONTEXT_TOO_LONG',
  MODEL_UNAVAILABLE = 'LLM_MODEL_UNAVAILABLE',
  INVALID_RESPONSE = 'LLM_INVALID_RESPONSE',
}

export enum FileValidationErrorCode {
  INVALID_MAGIC_BYTES = 'FILE_INVALID_MAGIC_BYTES',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  INVALID_FILENAME = 'FILE_INVALID_FILENAME',
  PATH_TRAVERSAL = 'FILE_PATH_TRAVERSAL',
  UNSUPPORTED_TYPE = 'FILE_UNSUPPORTED_TYPE',
  DOUBLE_EXTENSION = 'FILE_DOUBLE_EXTENSION',
  /** Compressed archive with suspicious expansion ratio (> 100:1). Mitigates zip bomb DoS. */
  ZIP_BOMB = 'FILE_ZIP_BOMB',
  /** Filename contains characters that could execute embedded scripts. */
  EMBEDDED_SCRIPT = 'FILE_EMBEDDED_SCRIPT',
}

export enum QueueErrorCode {
  JOB_FAILED = 'QUEUE_JOB_FAILED',
  CONNECTION_FAILED = 'QUEUE_CONNECTION_FAILED',
  ENQUEUE_FAILED = 'QUEUE_ENQUEUE_FAILED',
  WORKER_CRASHED = 'QUEUE_WORKER_CRASHED',
}

// ─── Error Classes ────────────────────────────────────────────────────────────
//
// All errors below extend AppError so the global errorHandler's
// `instanceof AppError` branch catches them and preserves their intended
// statusCode/code instead of collapsing to a generic 500.
//
// Each of the six concrete classes shares identical shape (code/originalError
// fields, constructor signature, Error.captureStackTrace call) — that
// boilerplate lives once in DomainError. Each subclass only supplies its
// `name` (for err.name / instanceof checks) and its own code-enum type
// parameter (so `err.code` narrows to that enum, preserving switch
// exhaustiveness for consumers), plus its own default statusCode.

/**
 * Shared base for all domain-specific pipeline errors. Not exported/thrown
 * directly — each pipeline layer gets a thin named subclass below so
 * `instanceof ChunkingError` etc. and `err.name` keep working exactly as
 * before, while `TCode` narrows `err.code` to that layer's specific enum.
 * @param message - Human-readable description
 * @param name - Concrete subclass name, assigned to `this.name`
 * @param code - Machine-readable code from the subclass's error-code enum
 * @param statusCode - HTTP status code
 * @param originalError - Upstream error that caused this, if any
 */
abstract class DomainError<TCode extends string> extends AppError {
  public readonly code: TCode;
  // exactOptionalPropertyTypes: explicit undefined union required when value can be absent
  public readonly originalError?: Error | undefined;

  constructor(message: string, name: string, code: TCode, statusCode: number, originalError?: Error) {
    super(message, statusCode);
    this.name = name;
    this.code = code;
    this.originalError = originalError;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Thrown when document parsing or text chunking fails.
 * @param message - Human-readable description
 * @param code - Machine-readable code from ChunkingErrorCode
 * @param statusCode - HTTP status code (default 422)
 * @param originalError - Upstream error that caused this, if any
 */
export class ChunkingError extends DomainError<ChunkingErrorCode> {
  constructor(message: string, code: ChunkingErrorCode, statusCode = 422, originalError?: Error) {
    super(message, 'ChunkingError', code, statusCode, originalError);
  }
}

/**
 * Thrown when the HuggingFace embedding API fails or returns invalid data.
 * @param message - Human-readable description
 * @param code - Machine-readable code from EmbeddingErrorCode
 * @param statusCode - HTTP status code (default 503)
 * @param originalError - Upstream error that caused this, if any
 */
export class EmbeddingError extends DomainError<EmbeddingErrorCode> {
  constructor(message: string, code: EmbeddingErrorCode, statusCode = 503, originalError?: Error) {
    super(message, 'EmbeddingError', code, statusCode, originalError);
  }
}

/**
 * Thrown when a Supabase pgvector operation fails.
 * @param message - Human-readable description
 * @param code - Machine-readable code from VectorStoreErrorCode
 * @param statusCode - HTTP status code (default 500)
 * @param originalError - Upstream error that caused this, if any
 */
export class VectorStoreError extends DomainError<VectorStoreErrorCode> {
  constructor(
    message: string,
    code: VectorStoreErrorCode,
    statusCode = 500,
    originalError?: Error,
  ) {
    super(message, 'VectorStoreError', code, statusCode, originalError);
  }
}

/**
 * Thrown when a Groq LLM operation fails (prompt build, streaming, or invalid response).
 * @param message - Human-readable description
 * @param code - Machine-readable code from LLMErrorCode
 * @param statusCode - HTTP status code (default 503)
 * @param originalError - Upstream error that caused this, if any
 */
export class LLMError extends DomainError<LLMErrorCode> {
  constructor(message: string, code: LLMErrorCode, statusCode = 503, originalError?: Error) {
    super(message, 'LLMError', code, statusCode, originalError);
  }
}

/**
 * Thrown when a file fails server-side security or content validation.
 * @param message - Human-readable description
 * @param code - Machine-readable code from FileValidationErrorCode
 * @param statusCode - HTTP status code (default 400)
 * @param originalError - Upstream error that caused this, if any
 */
export class FileValidationError extends DomainError<FileValidationErrorCode> {
  constructor(
    message: string,
    code: FileValidationErrorCode,
    statusCode = 400,
    originalError?: Error,
  ) {
    super(message, 'FileValidationError', code, statusCode, originalError);
  }
}

/**
 * Thrown when a BullMQ queue operation fails (enqueue, worker crash, connection loss).
 * @param message - Human-readable description
 * @param code - Machine-readable code from QueueErrorCode
 * @param statusCode - HTTP status code (default 500)
 * @param originalError - Upstream error that caused this, if any
 */
export class QueueError extends DomainError<QueueErrorCode> {
  constructor(message: string, code: QueueErrorCode, statusCode = 500, originalError?: Error) {
    super(message, 'QueueError', code, statusCode, originalError);
  }
}
