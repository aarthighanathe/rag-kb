/**
 * @file queryRewriter.test.ts
 * @description Unit tests for the optional HyDE-lite query rewriter service
 * @author [Author Placeholder]
 * @created 2026-08-23
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockCreate, mockEnv } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockEnv: { QUERY_REWRITE_ENABLED: false, GROQ_API_KEY: 'test-key' },
}));

vi.mock('groq-sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

vi.mock('../../src/config/env', () => ({ env: mockEnv }));

vi.mock('../../src/utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// ─── Import module under test (after mocks) ───────────────────────────────────

import { rewriteQueryForRetrieval } from '../../src/services/queryRewriter';

beforeEach(() => {
  vi.clearAllMocks();
  mockEnv.QUERY_REWRITE_ENABLED = false;
});

describe('rewriteQueryForRetrieval', () => {
  it('returns the original query unchanged when the feature flag is disabled', async () => {
    mockEnv.QUERY_REWRITE_ENABLED = false;
    const result = await rewriteQueryForRetrieval('What is the refund policy?');
    expect(result).toBe('What is the refund policy?');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns the rewritten statement when the flag is enabled and Groq succeeds', async () => {
    mockEnv.QUERY_REWRITE_ENABLED = true;
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'Refunds are issued within a specific policy window.' } }],
    });

    const result = await rewriteQueryForRetrieval('What is the refund policy?');
    expect(result).toBe('Refunds are issued within a specific policy window.');
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it('falls back to the original query when Groq returns empty content', async () => {
    mockEnv.QUERY_REWRITE_ENABLED = true;
    mockCreate.mockResolvedValue({ choices: [{ message: { content: '' } }] });

    const result = await rewriteQueryForRetrieval('What is the refund policy?');
    expect(result).toBe('What is the refund policy?');
  });

  it('falls back to the original query when Groq throws', async () => {
    mockEnv.QUERY_REWRITE_ENABLED = true;
    mockCreate.mockRejectedValue(new Error('Groq unavailable'));

    const result = await rewriteQueryForRetrieval('What is the refund policy?');
    expect(result).toBe('What is the refund policy?');
  });

  it('never throws, even when the underlying call rejects', async () => {
    mockEnv.QUERY_REWRITE_ENABLED = true;
    mockCreate.mockRejectedValue(new Error('timeout'));

    await expect(rewriteQueryForRetrieval('test query')).resolves.toBe('test query');
  });

  describe('contextual retrieval (history-aware rewrite)', () => {
    it('does not call Groq with a history block when history is empty', async () => {
      mockEnv.QUERY_REWRITE_ENABLED = true;
      mockCreate.mockResolvedValue({ choices: [{ message: { content: 'rewritten' } }] });

      await rewriteQueryForRetrieval('What is the price?', []);

      const call = mockCreate.mock.calls[0]?.[0];
      const userMessage = call.messages.find((m: { role: string }) => m.role === 'user');
      expect(userMessage.content).toBe('What is the price?');
      expect(userMessage.content).not.toContain('Conversation so far');
    });

    it('folds prior turns into the rewrite prompt when history is present', async () => {
      mockEnv.QUERY_REWRITE_ENABLED = true;
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'What is the price of the Pro plan?' } }],
      });

      const history = [
        { role: 'user' as const, content: 'Tell me about the Pro plan.' },
        { role: 'assistant' as const, content: 'The Pro plan includes unlimited storage.' },
      ];

      const result = await rewriteQueryForRetrieval('What about the price?', history);

      const call = mockCreate.mock.calls[0]?.[0];
      const userMessage = call.messages.find((m: { role: string }) => m.role === 'user');
      expect(userMessage.content).toContain('Conversation so far');
      expect(userMessage.content).toContain('Tell me about the Pro plan.');
      expect(userMessage.content).toContain('Current question: What about the price?');
      expect(result).toBe('What is the price of the Pro plan?');
    });

    it('only includes the most recent turns, capped, when history is long', async () => {
      mockEnv.QUERY_REWRITE_ENABLED = true;
      mockCreate.mockResolvedValue({ choices: [{ message: { content: 'rewritten' } }] });

      const history: Array<{ role: 'user' | 'assistant'; content: string }> = Array.from(
        { length: 10 },
        (_, i) => ({
          role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
          content: `Turn ${i}`,
        }),
      );

      await rewriteQueryForRetrieval('follow-up question', history);

      const call = mockCreate.mock.calls[0]?.[0];
      const userMessage = call.messages.find((m: { role: string }) => m.role === 'user');
      expect(userMessage.content).not.toContain('Turn 0');
      expect(userMessage.content).toContain('Turn 9');
    });

    it('falls back to the original query when history is present but Groq fails', async () => {
      mockEnv.QUERY_REWRITE_ENABLED = true;
      mockCreate.mockRejectedValue(new Error('Groq unavailable'));

      const history = [{ role: 'user' as const, content: 'prior turn' }];
      const result = await rewriteQueryForRetrieval('follow-up', history);

      expect(result).toBe('follow-up');
    });

    it('defaults to no history when the parameter is omitted', async () => {
      mockEnv.QUERY_REWRITE_ENABLED = false;
      await expect(rewriteQueryForRetrieval('plain query')).resolves.toBe('plain query');
    });
  });
});
