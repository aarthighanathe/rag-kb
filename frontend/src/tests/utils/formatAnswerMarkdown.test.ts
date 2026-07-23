/**
 * @file formatAnswerMarkdown.test.ts
 * @description Unit tests for formatAnswerMarkdown utility
 * @author [Author Placeholder]
 * @created 2026-07-01
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatAnswerMarkdown, copyToClipboard } from '../../utils/formatAnswerMarkdown';

describe('formatAnswerMarkdown', () => {
  it('formats answer with 2 citations correctly', () => {
    const result = formatAnswerMarkdown({
      answerText: 'Payment is due within 30 days [1]. Late payments accrue interest [2].',
      citations: [
        { index: 1, filename: 'contract.pdf', chunkIndex: 5, similarity: 0.94 },
        { index: 2, filename: 'contract.pdf', chunkIndex: 6, similarity: 0.81 },
      ],
    });

    expect(result).toContain('Payment is due within 30 days [1]. Late payments accrue interest [2].');
    expect(result).toContain('---');
    expect(result).toContain('Sources:');
    expect(result).toContain('[1] contract.pdf · Chunk 5 · Similarity: 94%');
    expect(result).toContain('[2] contract.pdf · Chunk 6 · Similarity: 81%');
  });

  it('omits Sources section when citations array is empty', () => {
    const result = formatAnswerMarkdown({
      answerText: 'This is a simple answer.',
      citations: [],
    });

    expect(result).toBe('This is a simple answer.');
    expect(result).not.toContain('---');
    expect(result).not.toContain('Sources:');
  });

  it('normalizes Unicode superscript chars to [N] format', () => {
    const result = formatAnswerMarkdown({
      answerText: 'See section ① for details and ② for examples.',
      citations: [
        { index: 1, filename: 'doc.pdf', chunkIndex: 1, similarity: 0.9 },
        { index: 2, filename: 'doc.pdf', chunkIndex: 2, similarity: 0.8 },
      ],
    });

    expect(result).toContain('See section [1] for details and [2] for examples.');
  });

  it('formats similarity score as integer percentage', () => {
    const result = formatAnswerMarkdown({
      answerText: 'Answer [1].',
      citations: [{ index: 1, filename: 'doc.pdf', chunkIndex: 1, similarity: 0.9456 }],
    });

    expect(result).toContain('Similarity: 95%');
  });

  it('preserves line breaks in long answers', () => {
    const result = formatAnswerMarkdown({
      answerText: 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.',
      citations: [],
    });

    expect(result).toContain('First paragraph.\n\nSecond paragraph.\n\nThird paragraph.');
  });
});

describe('copyToClipboard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true on successful copy with Clipboard API', async () => {
    const mockWriteText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: mockWriteText,
      },
    });

    const result = await copyToClipboard('test text');
    expect(result).toBe(true);
    expect(mockWriteText).toHaveBeenCalledWith('test text');
  });

  it('falls back to execCommand when Clipboard API unavailable', async () => {
    Object.assign(navigator, { clipboard: undefined });
    const mockExecCommand = vi.fn().mockReturnValue(true);
    document.execCommand = mockExecCommand;

    const result = await copyToClipboard('test text');
    expect(result).toBe(true);
    expect(mockExecCommand).toHaveBeenCalledWith('copy');
  });

  it('returns false on clipboard error', async () => {
    const mockWriteText = vi.fn().mockRejectedValue(new Error('Clipboard error'));
    Object.assign(navigator, {
      clipboard: {
        writeText: mockWriteText,
      },
    });

    const result = await copyToClipboard('test text');
    expect(result).toBe(false);
  });

  it('returns false when both Clipboard API and execCommand fail', async () => {
    Object.assign(navigator, { clipboard: undefined });
    const mockExecCommand = vi.fn().mockReturnValue(false);
    document.execCommand = mockExecCommand;

    const result = await copyToClipboard('test text');
    expect(result).toBe(false);
  });
});
