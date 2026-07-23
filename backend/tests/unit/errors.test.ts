/**
 * @file errors.test.ts
 * @description Unit tests for the domain-specific pipeline error classes — status codes,
 *   code enums, and instanceof/name identity for each layer's error subclass.
 * @author [Author Placeholder]
 * @created 2026-07-23
 */

import { describe, it, expect } from 'vitest';
import {
  ChunkingError,
  ChunkingErrorCode,
  EmbeddingError,
  EmbeddingErrorCode,
  VectorStoreError,
  VectorStoreErrorCode,
  LLMError,
  LLMErrorCode,
  FileValidationError,
  FileValidationErrorCode,
  QueueError,
  QueueErrorCode,
} from '../../src/utils/errors.js';
import { AppError } from '../../src/types/index.js';

describe('ChunkingError', () => {
  it('defaults to statusCode 422', () => {
    const err = new ChunkingError('bad doc', ChunkingErrorCode.EMPTY_DOCUMENT);
    expect(err.statusCode).toBe(422);
    expect(err.name).toBe('ChunkingError');
    expect(err.code).toBe(ChunkingErrorCode.EMPTY_DOCUMENT);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
  });

  it('accepts an explicit statusCode and wraps an originalError', () => {
    const original = new Error('parse failure');
    const err = new ChunkingError('bad doc', ChunkingErrorCode.PARSE_FAILED, 400, original);
    expect(err.statusCode).toBe(400);
    expect(err.originalError).toBe(original);
  });

  it('captures a stack trace', () => {
    const err = new ChunkingError('bad doc', ChunkingErrorCode.UNSUPPORTED_FORMAT);
    expect(err.stack).toBeDefined();
    expect(err.stack).toContain('ChunkingError');
  });
});

describe('EmbeddingError', () => {
  it('defaults to statusCode 503', () => {
    const err = new EmbeddingError('HF down', EmbeddingErrorCode.API_UNAVAILABLE);
    expect(err.statusCode).toBe(503);
    expect(err.name).toBe('EmbeddingError');
    expect(err.code).toBe(EmbeddingErrorCode.API_UNAVAILABLE);
  });

  it('supports the RATE_LIMITED code with a 429 status', () => {
    const err = new EmbeddingError('rate limited', EmbeddingErrorCode.RATE_LIMITED, 429);
    expect(err.statusCode).toBe(429);
    expect(err.code).toBe(EmbeddingErrorCode.RATE_LIMITED);
  });

  it('is an instanceof AppError', () => {
    const err = new EmbeddingError('x', EmbeddingErrorCode.EMPTY_INPUT, 400);
    expect(err).toBeInstanceOf(AppError);
  });
});

describe('VectorStoreError', () => {
  it('defaults to statusCode 500', () => {
    const err = new VectorStoreError('insert failed', VectorStoreErrorCode.INSERT_FAILED);
    expect(err.statusCode).toBe(500);
    expect(err.name).toBe('VectorStoreError');
    expect(err.code).toBe(VectorStoreErrorCode.INSERT_FAILED);
  });

  it('supports NOT_FOUND with a 404 status', () => {
    const err = new VectorStoreError('not found', VectorStoreErrorCode.NOT_FOUND, 404);
    expect(err.statusCode).toBe(404);
  });
});

describe('LLMError', () => {
  it('defaults to statusCode 503', () => {
    const err = new LLMError('groq failed', LLMErrorCode.STREAM_FAILED);
    expect(err.statusCode).toBe(503);
    expect(err.name).toBe('LLMError');
    expect(err.code).toBe(LLMErrorCode.STREAM_FAILED);
  });
});

describe('FileValidationError', () => {
  it('defaults to statusCode 400', () => {
    const err = new FileValidationError(
      'bad magic bytes',
      FileValidationErrorCode.INVALID_MAGIC_BYTES,
    );
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe('FileValidationError');
    expect(err.code).toBe(FileValidationErrorCode.INVALID_MAGIC_BYTES);
  });

  it('supports every documented error code', () => {
    const codes = Object.values(FileValidationErrorCode);
    for (const code of codes) {
      const err = new FileValidationError('msg', code);
      expect(err.code).toBe(code);
    }
  });
});

describe('QueueError', () => {
  it('defaults to statusCode 500', () => {
    const err = new QueueError('enqueue failed', QueueErrorCode.ENQUEUE_FAILED);
    expect(err.statusCode).toBe(500);
    expect(err.name).toBe('QueueError');
    expect(err.code).toBe(QueueErrorCode.ENQUEUE_FAILED);
  });
});

describe('shared DomainError behaviour', () => {
  it('each error class exposes isOperational as an AppError (true by default)', () => {
    const err = new ChunkingError('x', ChunkingErrorCode.EMPTY_DOCUMENT);
    expect(err.isOperational).toBe(true);
  });

  it('leaves originalError undefined when not provided', () => {
    const err = new QueueError('x', QueueErrorCode.WORKER_CRASHED);
    expect(err.originalError).toBeUndefined();
  });

  it('serializes message correctly via the base Error contract', () => {
    const err = new VectorStoreError('chunk fetch failed', VectorStoreErrorCode.QUERY_FAILED);
    expect(err.message).toBe('chunk fetch failed');
    expect(String(err)).toContain('chunk fetch failed');
  });
});
