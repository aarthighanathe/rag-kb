/**
 * @file llm.test.ts
 * @description Unit tests for the Groq LLM service — prompt building, streaming callbacks, citations
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockCreate, MockAPIError } = vi.hoisted(() => {
  const mockCreate = vi.fn();
  // Mirrors groq-sdk's real APIError shape closely enough for `instanceof`
  // checks and `.status`/`.error` access in llm.ts's error classification.
  class MockAPIError extends Error {
    status: number;
    error: unknown;
    constructor(status: number, error: unknown, message?: string) {
      super(message ?? `${status} error`);
      this.status = status;
      this.error = error;
    }
  }
  return { mockCreate, MockAPIError };
});

vi.mock('groq-sdk', () => ({
  default: class MockGroq {
    chat = { completions: { create: mockCreate } };
  },
  APIError: MockAPIError,
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// ─── Import module under test ─────────────────────────────────────────────────

import {
  buildSystemPrompt,
  buildContextString,
  buildUserPrompt,
  buildMessages,
  streamAnswer,
  extractCitations,
  extractCitedIndices,
  filterCitationsByModelOutput,
  RELEVANCE_BAND_THRESHOLDS,
  type ConversationTurn,
} from '../../src/services/llm';
import { LLMError, LLMErrorCode } from '../../src/utils/errors';
import type { RetrievedChunk } from '../../src/types/index';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const makeChunk = (overrides: Partial<RetrievedChunk> = {}): RetrievedChunk => ({
  id: 'chunk-1',
  document_id: 'doc-1',
  content: 'RAG is a framework that combines retrieval with generation.',
  similarity: 0.92,
  metadata: { char_start: 0, char_end: 57 },
  filename: 'rag-overview.pdf',
  source: 'vector',
  ...overrides,
});

/** Creates an async generator that yields the given tokens then a stop signal. */
async function* makeTokenStream(tokens: string[]) {
  for (const token of tokens) {
    yield { choices: [{ delta: { content: token }, finish_reason: null }] };
  }
  yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
}

beforeEach(() => vi.clearAllMocks());

// ─── RELEVANCE_BAND_THRESHOLDS ─────────────────────────────────────────────────

describe('RELEVANCE_BAND_THRESHOLDS', () => {
  it('matches frontend/src/utils/calculateConfidence.ts THRESHOLDS exactly', () => {
    // These two constants live in separate runtimes (backend vs. browser bundle)
    // and can't share an import. If this fails, update BOTH files together —
    // the LLM's self-reported relevance band and the UI confidence badge must agree.
    expect(RELEVANCE_BAND_THRESHOLDS).toEqual({
      high: 0.25,
      medium: 0.12,
      low: 0.04,
    });
  });
});

// ─── buildSystemPrompt ────────────────────────────────────────────────────────

describe('buildSystemPrompt', () => {
  it('returns a non-empty string', () => {
    const prompt = buildSystemPrompt();
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('encodes the context-only rule', () => {
    const prompt = buildSystemPrompt();
    expect(prompt.toLowerCase()).toMatch(/only|context/);
  });

  it('encodes the no-hallucination rule', () => {
    const prompt = buildSystemPrompt();
    expect(prompt.toLowerCase()).toMatch(/hallucinate|fabricate/);
  });

  it('instructs the model to hedge when passages are marked low relevance', () => {
    const prompt = buildSystemPrompt();
    expect(prompt.toLowerCase()).toMatch(/relevance/);
    expect(prompt.toLowerCase()).toMatch(/hedge|does not clearly cover/);
  });

  it('instructs the model to surface disagreement between sources', () => {
    const prompt = buildSystemPrompt();
    expect(prompt.toLowerCase()).toMatch(/disagree/);
  });

  it('includes few-shot examples covering a normal answer, a low-relevance hedge, and a contradiction', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('Few-Shot Examples:');
    // Normal cited-answer example
    expect(prompt).toMatch(/Context:.*Question:.*Answer:/s);
    // Hedged low-relevance example
    expect(prompt.toLowerCase()).toContain('does not clearly cover');
    // Contradiction example
    expect(prompt.toLowerCase()).toContain('sources disagree');
  });
});

// ─── buildContextString ───────────────────────────────────────────────────────

describe('buildContextString', () => {
  it('includes the document filename and chunk content', () => {
    const chunk = makeChunk();
    const result = buildContextString([chunk]);
    expect(result).toContain(chunk.filename);
    expect(result).toContain(chunk.content);
  });

  it('includes bracketed numeric citation labels matching the frontend parser', () => {
    const chunk = makeChunk();
    const result = buildContextString([chunk]);
    expect(result).toMatch(/^\[1\]/);
  });

  it('returns empty string for empty chunk array', () => {
    expect(buildContextString([])).toBe('');
  });

  it('labels a high-similarity chunk as high relevance', () => {
    const result = buildContextString([makeChunk({ similarity: 0.30 })]);
    expect(result).toContain('relevance: high');
  });

  it('labels a mid-similarity chunk as medium relevance', () => {
    const result = buildContextString([makeChunk({ similarity: 0.15 })]);
    expect(result).toContain('relevance: medium');
  });

  it('labels a low-similarity chunk as low relevance', () => {
    const result = buildContextString([makeChunk({ similarity: 0.05 })]);
    expect(result).toContain('relevance: low');
  });

  it('labels a near-zero-similarity chunk as very-low relevance', () => {
    const result = buildContextString([makeChunk({ similarity: 0.01 })]);
    expect(result).toContain('relevance: very-low');
  });

  it('uses the same thresholds as the frontend confidence indicator (0.25 / 0.12 / 0.04 boundaries)', () => {
    expect(buildContextString([makeChunk({ similarity: 0.25 })])).toContain('relevance: high');
    expect(buildContextString([makeChunk({ similarity: 0.249 })])).toContain('relevance: medium');
    expect(buildContextString([makeChunk({ similarity: 0.12 })])).toContain('relevance: medium');
    expect(buildContextString([makeChunk({ similarity: 0.119 })])).toContain('relevance: low');
    expect(buildContextString([makeChunk({ similarity: 0.04 })])).toContain('relevance: low');
    expect(buildContextString([makeChunk({ similarity: 0.039 })])).toContain('relevance: very-low');
  });
});

// ─── buildUserPrompt ──────────────────────────────────────────────────────────

describe('buildUserPrompt', () => {
  it('contains the user query', () => {
    const chunks = [makeChunk()];
    const result = buildUserPrompt({ chunks, query: 'What is RAG?' });
    expect(result).toContain('What is RAG?');
  });

  it('contains the context block', () => {
    const chunks = [makeChunk()];
    const result = buildUserPrompt({ chunks, query: 'What is RAG?' });
    expect(result).toContain('Context:');
    expect(result).toContain(chunks[0]!.content);
  });
});

// ─── buildMessages ────────────────────────────────────────────────────────────

describe('buildMessages', () => {
  it('starts with a system message', () => {
    const msgs = buildMessages({ chunks: [makeChunk()], query: 'test' }, []);
    expect(msgs[0]?.role).toBe('system');
  });

  it('renders history as a single untrusted-context user message, never under an assistant role', () => {
    const history: ConversationTurn[] = [
      { role: 'user',      content: 'First question' },
      { role: 'assistant', content: 'First answer' },
    ];
    const msgs = buildMessages({ chunks: [makeChunk()], query: 'Second question' }, history);
    // Client-supplied history (including turns it labels "assistant") is never
    // spliced into the message array under a genuine assistant role — see
    // formatHistoryAsUntrustedContext in llm.ts. Only a real model response from
    // *this* turn's own completion may ever carry role: 'assistant'.
    expect(msgs.some((m) => m.role === 'assistant')).toBe(false);

    // Index 0 = system; 1 = history block (user); 2 = context; 3 = current query
    expect(msgs[1]?.role).toBe('user');
    expect(msgs[1]?.content).toContain('First question');
    expect(msgs[1]?.content).toContain('First answer');
    expect(msgs[1]?.content).toMatch(/untrusted/i);
  });

  it('caps history at 6 turns (3 exchanges) folded into one message', () => {
    const history: ConversationTurn[] = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Turn ${i}`,
    }));
    const msgs = buildMessages({ chunks: [makeChunk()], query: 'Latest question' }, history);
    // system(1) + history_block(1) + context_user(1) + query_user(1) = 4
    expect(msgs.length).toBe(4);
    const historyMsg = msgs[1];
    expect(historyMsg?.content).not.toContain('Turn 0');
    expect(historyMsg?.content).not.toContain('Turn 1');
    expect(historyMsg?.content).not.toContain('Turn 2');
    expect(historyMsg?.content).not.toContain('Turn 3');
    expect(historyMsg?.content).toContain('Turn 8');
    expect(historyMsg?.content).toContain('Turn 9');
  });

  it('ends with the current user question as the last message', () => {
    const msgs = buildMessages({ chunks: [makeChunk()], query: 'The user question' }, []);
    const last = msgs[msgs.length - 1];
    expect(last?.role).toBe('user');
    expect(last?.content).toBe('The user question');
  });

  it('includes context string in a user message before the query', () => {
    const chunk = makeChunk();
    const msgs = buildMessages({ chunks: [chunk], query: 'test' }, []);
    // Should have a context user message containing the chunk filename
    const contextMsg = msgs.find(
      (m) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('source passages'),
    );
    expect(contextMsg).toBeDefined();
  });

  it('produces only system + context + query when history is empty', () => {
    const msgs = buildMessages({ chunks: [makeChunk()], query: 'test' }, []);
    // system + context_user + query_user = 3
    expect(msgs.length).toBe(3);
  });
});

// ─── streamAnswer ─────────────────────────────────────────────────────────────

describe('streamAnswer', () => {
  it('calls onChunk for each streamed token', async () => {
    const tokens = ['Hello', ' ', 'world', '!'];
    mockCreate.mockResolvedValue(makeTokenStream(tokens));

    const onChunk = vi.fn();
    const onComplete = vi.fn();
    const onError = vi.fn();

    await streamAnswer(
      { chunks: [makeChunk()], query: 'test' },
      [],
      { onChunk, onComplete, onError },
    );

    expect(onChunk).toHaveBeenCalledTimes(tokens.length);
    expect(onChunk).toHaveBeenNthCalledWith(1, 'Hello');
    expect(onChunk).toHaveBeenNthCalledWith(2, ' ');
  });

  it('calls onComplete with the full assembled text', async () => {
    mockCreate.mockResolvedValue(makeTokenStream(['Hello', ' world']));

    const onComplete = vi.fn();
    await streamAnswer(
      { chunks: [makeChunk()], query: 'test' },
      [],
      { onChunk: vi.fn(), onComplete, onError: vi.fn() },
    );

    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledWith('Hello world');
  });

  it('calls onError and re-throws LLMError when Groq fails', async () => {
    mockCreate.mockRejectedValue(new Error('Groq unavailable'));

    const onError = vi.fn();
    await expect(
      streamAnswer(
        { chunks: [makeChunk()], query: 'test' },
        [],
        { onChunk: vi.fn(), onComplete: vi.fn(), onError },
      ),
    ).rejects.toBeInstanceOf(LLMError);

    expect(onError).toHaveBeenCalledOnce();
    const err = onError.mock.calls[0]?.[0] as LLMError;
    expect(err.code).toBe(LLMErrorCode.STREAM_FAILED);
  });

  it('classifies a 401 Groq APIError as AUTH_FAILED (not a generic 503)', async () => {
    mockCreate.mockRejectedValue(new MockAPIError(401, { message: 'Invalid API Key' }));

    const onError = vi.fn();
    await expect(
      streamAnswer({ chunks: [makeChunk()], query: 'test' }, [], {
        onChunk: vi.fn(),
        onComplete: vi.fn(),
        onError,
      }),
    ).rejects.toBeInstanceOf(LLMError);

    const err = onError.mock.calls[0]?.[0] as LLMError;
    expect(err.code).toBe(LLMErrorCode.AUTH_FAILED);
    expect(err.statusCode).toBe(401);
  });

  it('classifies a 429 Groq APIError as RATE_LIMITED', async () => {
    mockCreate.mockRejectedValue(new MockAPIError(429, { message: 'Rate limit exceeded' }));

    const onError = vi.fn();
    await expect(
      streamAnswer({ chunks: [makeChunk()], query: 'test' }, [], {
        onChunk: vi.fn(),
        onComplete: vi.fn(),
        onError,
      }),
    ).rejects.toBeInstanceOf(LLMError);

    const err = onError.mock.calls[0]?.[0] as LLMError;
    expect(err.code).toBe(LLMErrorCode.RATE_LIMITED);
    expect(err.statusCode).toBe(429);
  });

  it('classifies a 404 Groq APIError as MODEL_UNAVAILABLE (e.g. a deprecated/renamed model ID)', async () => {
    mockCreate.mockRejectedValue(new MockAPIError(404, { message: 'model not found' }));

    const onError = vi.fn();
    await expect(
      streamAnswer({ chunks: [makeChunk()], query: 'test' }, [], {
        onChunk: vi.fn(),
        onComplete: vi.fn(),
        onError,
      }),
    ).rejects.toBeInstanceOf(LLMError);

    const err = onError.mock.calls[0]?.[0] as LLMError;
    expect(err.code).toBe(LLMErrorCode.MODEL_UNAVAILABLE);
  });

  it('classifies a 400 Groq APIError with a context-length error code as CONTEXT_TOO_LONG', async () => {
    mockCreate.mockRejectedValue(
      new MockAPIError(400, { code: 'context_length_exceeded', message: 'too many tokens' }),
    );

    const onError = vi.fn();
    await expect(
      streamAnswer({ chunks: [makeChunk()], query: 'test' }, [], {
        onChunk: vi.fn(),
        onComplete: vi.fn(),
        onError,
      }),
    ).rejects.toBeInstanceOf(LLMError);

    const err = onError.mock.calls[0]?.[0] as LLMError;
    expect(err.code).toBe(LLMErrorCode.CONTEXT_TOO_LONG);
  });

  it('classifies a generic 400 Groq APIError as INVALID_RESPONSE', async () => {
    mockCreate.mockRejectedValue(new MockAPIError(400, { message: 'bad request' }));

    const onError = vi.fn();
    await expect(
      streamAnswer({ chunks: [makeChunk()], query: 'test' }, [], {
        onChunk: vi.fn(),
        onComplete: vi.fn(),
        onError,
      }),
    ).rejects.toBeInstanceOf(LLMError);

    const err = onError.mock.calls[0]?.[0] as LLMError;
    expect(err.code).toBe(LLMErrorCode.INVALID_RESPONSE);
  });

  it('falls back to STREAM_FAILED for a Groq APIError with an unrecognized status', async () => {
    mockCreate.mockRejectedValue(new MockAPIError(502, { message: 'bad gateway' }));

    const onError = vi.fn();
    await expect(
      streamAnswer({ chunks: [makeChunk()], query: 'test' }, [], {
        onChunk: vi.fn(),
        onComplete: vi.fn(),
        onError,
      }),
    ).rejects.toBeInstanceOf(LLMError);

    const err = onError.mock.calls[0]?.[0] as LLMError;
    expect(err.code).toBe(LLMErrorCode.STREAM_FAILED);
  });

  it('always uses the default temperature for the Groq create call', async () => {
    mockCreate.mockResolvedValue(makeTokenStream([]));

    await streamAnswer(
      { chunks: [makeChunk()], query: 'test' },
      [],
      { onChunk: vi.fn(), onComplete: vi.fn(), onError: vi.fn() },
    );

    const callArgs = mockCreate.mock.calls[0]?.[0] as { temperature: number };
    expect(callArgs.temperature).toBe(0.1);
  });

  it('includes history content in the Groq call when provided, without an assistant-role turn', async () => {
    mockCreate.mockResolvedValue(makeTokenStream(['ok']));

    const history: ConversationTurn[] = [
      { role: 'user',      content: 'Prior question' },
      { role: 'assistant', content: 'Prior answer' },
    ];

    await streamAnswer(
      { chunks: [makeChunk()], query: 'New question' },
      history,
      { onChunk: vi.fn(), onComplete: vi.fn(), onError: vi.fn() },
    );

    const callArgs = mockCreate.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const roles = callArgs.messages.map((m) => m.role);
    // system, user(history block), user(context), user(query) — no genuine
    // assistant turn: this call streams zero tokens before onComplete fires,
    // so nothing in this request should ever carry role: 'assistant'.
    expect(roles).toContain('system');
    expect(roles).not.toContain('assistant');
    const historyMsg = callArgs.messages.find((m) => m.content.includes('Prior question'));
    expect(historyMsg?.role).toBe('user');
    expect(historyMsg?.content).toContain('Prior answer');
  });
});

// ─── extractCitations ─────────────────────────────────────────────────────────

describe('extractCitations', () => {
  it('returns one citation per chunk', () => {
    const chunks = [makeChunk({ id: 'c1' }), makeChunk({ id: 'c2' })];
    const citations = extractCitations(chunks);
    expect(citations).toHaveLength(2);
  });

  it('citation includes documentId, filename, chunkId, similarity and excerpt', () => {
    const chunk = makeChunk();
    const [citation] = extractCitations([chunk]);
    expect(citation?.documentId).toBe(chunk.document_id);
    expect(citation?.filename).toBe(chunk.filename);
    expect(citation?.chunkId).toBe(chunk.id);
    expect(citation?.similarity).toBe(0.92);
    expect(typeof citation?.excerpt).toBe('string');
  });

  it('truncates long excerpts to 200 chars and appends ellipsis', () => {
    const longContent = 'x'.repeat(300);
    const chunk = makeChunk({ content: longContent });
    const [citation] = extractCitations([chunk]);
    expect(citation?.excerpt.length).toBeLessThanOrEqual(201); // 200 chars + ellipsis char
    expect(citation?.excerpt).toContain('…');
  });

  it('rounds similarity to 3 decimal places', () => {
    const chunk = makeChunk({ similarity: 0.919876 });
    const [citation] = extractCitations([chunk]);
    expect(citation?.similarity).toBe(0.92);
  });
});

// ─── extractCitedIndices ──────────────────────────────────────────────────────

describe('extractCitedIndices', () => {
  it('extracts a single citation number', () => {
    expect(extractCitedIndices('The answer is here [1].')).toEqual([1]);
  });

  it('extracts multiple citation numbers in first-appearance order', () => {
    expect(extractCitedIndices('See [2] and [1], also [3].')).toEqual([2, 1, 3]);
  });

  it('deduplicates repeated markers', () => {
    expect(extractCitedIndices('[1] confirms this, and [1] again.')).toEqual([1]);
  });

  it('returns an empty array when no markers are present', () => {
    expect(extractCitedIndices('No citations in this answer.')).toEqual([]);
  });

  it('ignores non-numeric or malformed brackets', () => {
    expect(extractCitedIndices('See [note] and [1].')).toEqual([1]);
  });

  // Regression: the regex previously matched any `[N]` with no context
  // awareness, so markdown footnote-definition syntax ("[1]: http://...")
  // was indistinguishable from a real citation marker.
  it('ignores markdown footnote-definition syntax ([N]:)', () => {
    expect(extractCitedIndices('See the source [1]: http://example.com for details.')).toEqual([]);
  });

  it('still extracts a real citation elsewhere in text that also contains a footnote definition', () => {
    expect(extractCitedIndices('As shown in [2].\n\n[1]: http://example.com')).toEqual([2]);
  });

  // Regression: the regex previously matched any `[N]` with no context
  // awareness, so an array-index code reference like "arr[1]" was
  // indistinguishable from a real citation marker.
  it('ignores array-index-style code references (word char immediately before [N])', () => {
    expect(extractCitedIndices('The code does `arr[1]` to access the second element.')).toEqual([]);
  });

  it('still extracts a real citation adjacent to, but not touching, code-like text', () => {
    expect(extractCitedIndices('Per the docs [1], arr[2] returns the third element.')).toEqual([1]);
  });
});

// ─── filterCitationsByModelOutput ─────────────────────────────────────────────

describe('filterCitationsByModelOutput', () => {
  const citations = [
    { documentId: 'd1', filename: 'a.pdf', chunkId: 'c1', similarity: 0.3, excerpt: 'A', citationNumber: 1 },
    { documentId: 'd2', filename: 'b.pdf', chunkId: 'c2', similarity: 0.2, excerpt: 'B', citationNumber: 2 },
    { documentId: 'd3', filename: 'c.pdf', chunkId: 'c3', similarity: 0.1, excerpt: 'C', citationNumber: 3 },
  ];

  it('keeps only citations the model actually referenced', () => {
    const result = filterCitationsByModelOutput(citations, 'Per [1] and [3], this is true.');
    expect(result.map((c) => c.chunkId)).toEqual(['c1', 'c3']);
  });

  it('preserves original retrieval order regardless of citation order in text', () => {
    const result = filterCitationsByModelOutput(citations, 'Per [3] and [1], this is true.');
    expect(result.map((c) => c.chunkId)).toEqual(['c1', 'c3']);
  });

  it('falls back to the full list when the model cited nothing', () => {
    const result = filterCitationsByModelOutput(citations, 'No sources needed for this.');
    expect(result).toEqual(citations);
  });

  it('drops out-of-range hallucinated citation numbers', () => {
    const result = filterCitationsByModelOutput(citations, 'Per [1] and [7], this is true.');
    expect(result.map((c) => c.chunkId)).toEqual(['c1']);
  });

  it('falls back to the full list when every cited number is out of range', () => {
    const result = filterCitationsByModelOutput(citations, 'Per [9] alone.');
    expect(result).toEqual(citations);
  });
});
