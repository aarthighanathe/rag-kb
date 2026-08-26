/**
 * @file localReranker.test.ts
 * @description Unit tests for local (no-network) chunk re-ranking
 * @author [Author Placeholder]
 * @created 2026-08-23
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RetrievedChunk } from '../../src/types/index';

const mockEnv = vi.hoisted(() => ({ CROSS_ENCODER_ENABLED: true }));

vi.mock('../../src/config/env', () => ({ env: mockEnv }));
vi.mock('../../src/utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { rerankChunks } from '../../src/services/localReranker';

function makeChunk(overrides: Partial<RetrievedChunk>): RetrievedChunk {
  return {
    id: 'chunk-1',
    document_id: 'doc-1',
    content: 'placeholder content',
    similarity: 0.2,
    metadata: { char_start: 0, char_end: 20 },
    filename: 'test.pdf',
    source: 'vector',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnv.CROSS_ENCODER_ENABLED = true;
});

describe('rerankChunks', () => {
  it('returns chunks unchanged (pass-through) when disabled', () => {
    mockEnv.CROSS_ENCODER_ENABLED = false;
    const chunks = [makeChunk({ id: 'a' }), makeChunk({ id: 'b' })];

    const result = rerankChunks('what is the refund policy', chunks, 5);

    expect(result.reranked).toBe(false);
    expect(result.chunks.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('returns an empty result for zero chunks', () => {
    const result = rerankChunks('anything', [], 5);
    expect(result.chunks).toEqual([]);
    expect(result.originalCount).toBe(0);
  });

  it('promotes a chunk with strong keyword overlap over one with only marginally higher similarity', () => {
    const chunks = [
      makeChunk({
        id: 'weak-overlap-high-sim',
        similarity: 0.3,
        content: 'This document discusses unrelated topics about weather patterns.',
      }),
      makeChunk({
        id: 'strong-overlap-lower-sim',
        similarity: 0.25,
        content: 'The refund policy allows customers to request a refund within 30 days of purchase. Refund requests must include a receipt.',
      }),
    ];

    const result = rerankChunks('what is the refund policy', chunks, 2);

    expect(result.reranked).toBe(true);
    expect(result.chunks[0]?.id).toBe('strong-overlap-lower-sim');
  });

  it('respects topK by trimming the result', () => {
    const chunks = [
      makeChunk({ id: 'a', similarity: 0.3 }),
      makeChunk({ id: 'b', similarity: 0.2 }),
      makeChunk({ id: 'c', similarity: 0.1 }),
    ];

    const result = rerankChunks('query text', chunks, 1);

    expect(result.chunks).toHaveLength(1);
    expect(result.rerankedCount).toBe(1);
    expect(result.originalCount).toBe(3);
  });

  it('normalizes vector vs keyword similarity scales before blending', () => {
    // Vector cosine and pg_trgm keyword scores are different metrics — a raw
    // 0.30 pg_trgm score is not "as strong" as a raw 0.30 MiniLM cosine
    // score. Without normalization, a keyword chunk with no term overlap in
    // the tokenizer's eyes but a middling raw score would still out-rank a
    // vector chunk with a much stronger *relative* similarity for its scale.
    const chunks = [
      makeChunk({
        id: 'vector-strong',
        source: 'vector',
        similarity: 0.35, // near the ~0.40 practical ceiling for MiniLM cosine
        content: 'Unrelated filler text with no query terms present at all here.',
      }),
      makeChunk({
        id: 'keyword-weak',
        source: 'keyword',
        similarity: 0.35, // same raw score, but far from pg_trgm's 1.0 ceiling
        content: 'More unrelated filler text without any matching terms either.',
      }),
    ];

    const result = rerankChunks('irrelevant query xyz', chunks, 2);

    // With no term overlap for either chunk, blended score reduces to the
    // normalized similarity — the vector chunk (0.35/0.40 = 0.875) must rank
    // above the keyword chunk (0.35/1.0 = 0.35).
    expect(result.chunks[0]?.id).toBe('vector-strong');
  });

  it('applies a small penalty to very short fragments', () => {
    const chunks = [
      makeChunk({ id: 'short', similarity: 0.3, content: 'refund policy' }),
      makeChunk({
        id: 'long',
        similarity: 0.3,
        content:
          'The refund policy allows customers to request a refund within thirty days of purchase, provided the item is unused and in its original packaging.',
      }),
    ];

    const result = rerankChunks('refund policy', chunks, 2);

    // Both match on terms equally well relative to their length, but the short
    // fragment carries the length penalty, so it should not outrank the long one.
    const shortScoreIndex = result.chunks.findIndex((c) => c.id === 'short');
    const longScoreIndex = result.chunks.findIndex((c) => c.id === 'long');
    expect(longScoreIndex).toBeLessThanOrEqual(shortScoreIndex);
  });
});
