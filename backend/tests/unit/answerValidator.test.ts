/**
 * @file answerValidator.test.ts
 * @description Unit tests for post-hoc (async, post-stream) answer validation
 * @author [Author Placeholder]
 * @created 2026-08-23
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RetrievedChunk } from '../../src/types/index';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('groq-sdk', () => ({
  default: class MockGroq {
    chat = { completions: { create: mockCreate } };
  },
}));

vi.mock('../../src/config/env', () => ({
  env: { GROQ_API_KEY: 'test-key' },
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// ─── Import module under test (after mocks) ───────────────────────────────────

import { validateAnswer } from '../../src/services/answerValidator';

function makeChunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    id: 'chunk-1',
    document_id: 'doc-1',
    content: 'Refunds are issued within 14 days of the return request.',
    similarity: 0.3,
    metadata: { char_start: 0, char_end: 50 },
    filename: 'policy.pdf',
    source: 'vector',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('validateAnswer', () => {
  it('returns a neutral valid result when there are no chunks, without calling Groq', async () => {
    const result = await validateAnswer('query', 'answer', []);
    expect(result).toEqual({ isValid: true, confidence: 1.0, issues: [], suggestions: [], durationMs: 0 });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('parses a well-formed JSON validation response', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              issues: [],
              confidence: 0.92,
              suggestions: [],
            }),
          },
        },
      ],
    });

    const result = await validateAnswer(
      'How long do refunds take?',
      'Refunds are issued within 14 days [1].',
      [makeChunk()],
    );

    expect(result.isValid).toBe(true);
    expect(result.confidence).toBe(0.92);
    expect(result.issues).toEqual([]);
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it('clamps a confidence value above 1 to 1', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ issues: [], confidence: 1.5 }) } }],
    });

    const result = await validateAnswer('query', 'answer', [makeChunk()]);

    expect(result.confidence).toBe(1);
  });

  it('clamps a negative confidence value to 0', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ issues: [], confidence: -0.4 }) } }],
    });

    const result = await validateAnswer('query', 'answer', [makeChunk()]);

    expect(result.confidence).toBe(0);
  });

  it('defaults to 0.5 when confidence is a non-finite or non-numeric value', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ issues: [], confidence: 'high' }) } }],
    });

    const result = await validateAnswer('query', 'answer', [makeChunk()]);

    expect(result.confidence).toBe(0.5);
  });

  it('flags an answer with issues as invalid when confidence is below threshold', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              issues: [
                { type: 'hallucination', severity: 'high', message: 'Claims a figure not in context' },
              ],
              confidence: 0.3,
              suggestions: ['Remove the unsupported figure'],
            }),
          },
        },
      ],
    });

    const result = await validateAnswer('query', 'answer with a made-up number', [makeChunk()]);

    expect(result.isValid).toBe(false);
    expect(result.confidence).toBe(0.3);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.type).toBe('hallucination');
    expect(result.issues[0]?.severity).toBe('high');
  });

  it('normalizes an unrecognized issue type/severity from the model to safe defaults', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              issues: [{ type: 'something_weird', severity: 'critical', message: 'oddity' }],
              confidence: 0.5,
            }),
          },
        },
      ],
    });

    const result = await validateAnswer('query', 'answer', [makeChunk()]);

    expect(result.issues[0]?.type).toBe('unsupported_claim');
    expect(result.issues[0]?.severity).toBe('medium');
  });

  it('fails open (isValid: true) when Groq throws', async () => {
    mockCreate.mockRejectedValue(new Error('Groq unavailable'));

    const result = await validateAnswer('query', 'answer', [makeChunk()]);

    expect(result.isValid).toBe(true);
    expect(result.confidence).toBe(0.5);
    expect(result.issues).toEqual([]);
  });

  it('fails open when the model returns empty content', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: '' } }] });

    const result = await validateAnswer('query', 'answer', [makeChunk()]);

    expect(result.isValid).toBe(true);
  });

  it('fails open when the model returns malformed JSON', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 'not json {' } }] });

    const result = await validateAnswer('query', 'answer', [makeChunk()]);

    expect(result.isValid).toBe(true);
  });
});
