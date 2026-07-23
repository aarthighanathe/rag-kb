/**
 * @file llm.test.ts
 * @description Unit tests for the Groq LLM service — prompt building, streaming callbacks, citations
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('groq-sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
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

  it('passes temperature from RAGContext to Groq create call', async () => {
    mockCreate.mockResolvedValue(makeTokenStream([]));

    await streamAnswer(
      { chunks: [makeChunk()], query: 'test', temperature: 0.5 },
      [],
      { onChunk: vi.fn(), onComplete: vi.fn(), onError: vi.fn() },
    );

    const callArgs = mockCreate.mock.calls[0]?.[0] as { temperature: number };
    expect(callArgs.temperature).toBe(0.5);
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
