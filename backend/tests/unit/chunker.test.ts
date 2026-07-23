/**
 * @file chunker.test.ts
 * @description Unit tests for the text chunking and document extraction service
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// pdf-parse and mammoth are redirected to __mocks__/ via vitest.config.ts resolve.alias.
// No vi.mock() calls needed — the alias intercepts at module resolution level.
import pdfParse from 'pdf-parse';
import * as mammoth from 'mammoth';

import {
  estimateTokenCount,
  splitByHierarchy,
  createChunks,
  extractTextFromPDF,
  extractTextFromDocx,
  extractTextFromMarkdown,
  extractTextFromTxt,
  extractText,
} from '../../src/services/chunker';
import { ChunkingError } from '../../src/utils/errors';

// ─── Inline fixtures ──────────────────────────────────────────────────────────

const SAMPLE_TXT = [
  'Introduction to Retrieval-Augmented Generation',
  '',
  'Retrieval-Augmented Generation (RAG) is an AI framework that combines',
  'retrieval-based and generative models.',
].join('\n');

const SAMPLE_MD = [
  '# RAG Knowledge Base',
  '',
  'This document describes the **RAG** system.',
  '',
  '```python',
  'print("should be stripped")',
  '```',
  '',
  '[Click here](https://example.com) for more info.',
].join('\n');

// ─── estimateTokenCount ───────────────────────────────────────────────────────

describe('estimateTokenCount', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokenCount('')).toBe(0);
  });

  it('returns a positive count for non-empty text', () => {
    expect(estimateTokenCount('hello world')).toBeGreaterThan(0);
  });

  it('returns a higher count for longer text', () => {
    const short = estimateTokenCount('hi');
    const long = estimateTokenCount('this is a much longer sentence with many more words in it');
    expect(long).toBeGreaterThan(short);
  });

  it('uses ceiling of text.length / 4', () => {
    expect(estimateTokenCount('abcd')).toBe(1);
    expect(estimateTokenCount('abcde')).toBe(2);
    expect(estimateTokenCount('abcdefgh')).toBe(2);
  });
});

// ─── splitByHierarchy ─────────────────────────────────────────────────────────

describe('splitByHierarchy', () => {
  it('splits on the coarsest separator first', () => {
    const text = 'paragraph one\n\nparagraph two\n\nparagraph three';
    const result = splitByHierarchy(text, ['\n\n', '\n', ' ']);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe('paragraph one');
    expect(result[2]).toBe('paragraph three');
  });

  it('returns empty array for empty input', () => {
    expect(splitByHierarchy('', ['\n\n'])).toEqual([]);
    expect(splitByHierarchy('   ', ['\n\n'])).toEqual([]);
  });

  it('falls back to the next separator when primary produces no split', () => {
    const text = 'line one\nline two\nline three';
    const result = splitByHierarchy(text, ['\n\n', '\n']);
    expect(result).toHaveLength(3);
  });

  it('returns the whole text when no separator applies', () => {
    const text = 'single indivisible block';
    const result = splitByHierarchy(text, ['\n\n']);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(text);
  });

  it('trims whitespace from each segment', () => {
    const text = '  alpha  \n\n  beta  ';
    const result = splitByHierarchy(text, ['\n\n']);
    expect(result[0]).toBe('alpha');
    expect(result[1]).toBe('beta');
  });

  it('recursively splits a paragraph exceeding the default 512-token threshold', () => {
    // ~600 tokens (2400 chars / 4) — exceeds the default threshold, so the
    // paragraph-level split alone isn't enough; it must fall through to
    // sentence splitting on '. '.
    const bigParagraph = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} in one long paragraph`).join('. ');
    const result = splitByHierarchy(bigParagraph, ['\n\n', '. ']);
    expect(result.length).toBeGreaterThan(1);
  });

  it('respects a custom maxTokens threshold instead of the hardcoded default', () => {
    // Regression test: splitByHierarchy previously hardcoded 512 as the
    // recursive-split threshold regardless of what chunkSize the caller
    // configured, so a custom chunkSize silently had no effect on this check.
    const text = 'one two three four five. six seven eight nine ten';
    // ~13 tokens total — small enough that the default 512 threshold would
    // never trigger a further split, but a tiny custom maxTokens should.
    const withDefault = splitByHierarchy(text, ['\n\n', '. ', ' ']);
    const withTinyThreshold = splitByHierarchy(text, ['\n\n', '. ', ' '], 2);

    expect(withDefault.length).toBeLessThan(withTinyThreshold.length);
  });

  it('passes createChunks\' configured chunkSize through as the maxTokens threshold', () => {
    // ~200 tokens of a single unbroken sentence-separated block — under the
    // default 512-token threshold, but over a small custom chunkSize, so
    // createChunks(text, { chunkSize: 20 }) must produce more/smaller chunks
    // than the default chunkSize (512) would, proving chunkSize actually
    // reaches splitByHierarchy's recursive-split check.
    const text = Array.from({ length: 20 }, (_, i) => `word${i} word${i} word${i} word${i} word${i}`).join('. ');

    const defaultChunks = createChunks(text);
    const smallChunkSizeChunks = createChunks(text, {
      chunkSize: 20,
      chunkOverlap: 5,
      separator: ['\n\n', '. ', ' '],
    });

    expect(smallChunkSizeChunks.length).toBeGreaterThan(defaultChunks.length);
  });
});

// ─── createChunks ─────────────────────────────────────────────────────────────

describe('createChunks', () => {
  it('returns empty array for empty input', () => {
    expect(createChunks('')).toHaveLength(0);
    expect(createChunks('   ')).toHaveLength(0);
  });

  it('each chunk carries a zero-based sequential index', () => {
    const text = Array.from({ length: 10 }, (_, i) => `paragraph ${i}`).join('\n\n');
    const chunks = createChunks(text, { chunkSize: 5, chunkOverlap: 1, separator: ['\n\n', ' '] });
    chunks.forEach((chunk, i) => expect(chunk.index).toBe(i));
  });

  it('chunk.tokenCount matches estimateTokenCount(chunk.content)', () => {
    const text = 'hello world '.repeat(30);
    const chunks = createChunks(text, { chunkSize: 20, chunkOverlap: 5, separator: [' '] });
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBe(estimateTokenCount(chunk.content));
    }
  });

  it('no chunk significantly exceeds chunkSize tokens', () => {
    const text = 'word '.repeat(600);
    const opts = { chunkSize: 64, chunkOverlap: 16, separator: ['\n\n', '\n', ' '] };
    const chunks = createChunks(text, opts);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(opts.chunkSize + 25);
    }
  });

  it('handles unicode text without throwing', () => {
    const text = '日本語テキスト\n\n한국어 텍스트\n\nالنص العربي\n\nCyrillic текст';
    expect(() =>
      createChunks(text, { chunkSize: 512, chunkOverlap: 50, separator: ['\n\n'] }),
    ).not.toThrow();
    expect(
      createChunks(text, { chunkSize: 512, chunkOverlap: 50, separator: ['\n\n'] }).length,
    ).toBeGreaterThan(0);
  });

  it('handles very long documents without error', () => {
    const text = 'sentence end here. '.repeat(2000);
    const chunks = createChunks(text, { chunkSize: 128, chunkOverlap: 32, separator: ['. ', ' '] });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('handles special characters without throwing', () => {
    const text = 'Price: $100 & tax\n\nPath: C:\\folder\\file.txt\n\n<html>test</html>';
    expect(() => createChunks(text)).not.toThrow();
  });

  it('metadata has char_start and char_end', () => {
    const text = 'paragraph one\n\nparagraph two';
    const chunks = createChunks(text, { chunkSize: 512, chunkOverlap: 0, separator: ['\n\n'] });
    for (const chunk of chunks) {
      expect(typeof chunk.metadata.char_start).toBe('number');
      expect(typeof chunk.metadata.char_end).toBe('number');
    }
  });

  // Regression: char_start/char_end were computed from the length of the
  // re-joined, whitespace-collapsed chunk text rather than a real index into
  // `text`, so any paragraph break or irregular spacing made offsets drift
  // and compound across chunks. These assert the source-text substring at
  // [char_start, char_end) actually contains the chunk's words in order.
  function expectOffsetsMatchSource(text: string, opts: Parameters<typeof createChunks>[1]): void {
    const chunks = createChunks(text, opts);
    for (const chunk of chunks) {
      const { char_start, char_end } = chunk.metadata;
      expect(char_start).toBeGreaterThanOrEqual(0);
      expect(char_end).toBeLessThanOrEqual(text.length);
      expect(char_end).toBeGreaterThan(char_start);

      const actualSlice = text.slice(char_start, char_end);
      const contentWords = chunk.content.split(/\s+/).filter(Boolean);
      const actualWords = actualSlice.split(/\s+/).filter(Boolean);
      let ai = 0;
      for (const cw of contentWords) {
        while (ai < actualWords.length && !actualWords[ai]?.includes(cw)) ai++;
        expect(ai).toBeLessThan(actualWords.length);
        ai++;
      }
    }
  }

  it('char_start/char_end index into the real source text across paragraph breaks', () => {
    const paras = Array.from(
      { length: 15 },
      (_, i) => `Paragraph ${i} begins here. This is sentence two of paragraph ${i}, containing   extra   spaces.`,
    );
    expectOffsetsMatchSource(paras.join('\n\n'), { chunkSize: 40, chunkOverlap: 10, separator: ['\n\n', '. ', ' '] });
  });

  it('char_start/char_end stay accurate under heavy overlap (no compounding drift)', () => {
    const paras = Array.from(
      { length: 20 },
      (_, i) => `Section ${i}: this contains several words for chunk testing purposes and more filler text`,
    );
    expectOffsetsMatchSource(paras.join('\n\n'), { chunkSize: 15, chunkOverlap: 10, separator: ['\n\n', ' '] });
  });

  it('char_start/char_end are correct with irregular whitespace (tabs, multi-newlines, multi-spaces)', () => {
    const text = '\n\n   Leading whitespace paragraph.\n\n\n\tTabbed paragraph here.\n\n  Multiple   spaces   inside   this   one.  \n\n'
      + 'word '.repeat(200);
    expectOffsetsMatchSource(text, { chunkSize: 20, chunkOverlap: 5, separator: ['\n\n', '. ', ' '] });
  });

  it('char_start/char_end resolve to the correct occurrence when segments repeat verbatim', () => {
    const text = Array.from({ length: 10 }, () => 'This exact paragraph repeats identically every single time without variation').join('\n\n');
    expectOffsetsMatchSource(text, { chunkSize: 8, chunkOverlap: 3, separator: ['\n\n', ' '] });
  });
});

// ─── extractTextFromMarkdown ──────────────────────────────────────────────────

describe('extractTextFromMarkdown', () => {
  it('returns empty string for empty input', () => {
    expect(extractTextFromMarkdown('')).toBe('');
    expect(extractTextFromMarkdown('   ')).toBe('');
  });

  it('strips ATX headers', () => {
    const result = extractTextFromMarkdown('# Heading 1\n\n## Heading 2\n\nBody text');
    expect(result).not.toContain('#');
    expect(result).toContain('Heading 1');
    expect(result).toContain('Body text');
  });

  it('strips fenced code blocks entirely', () => {
    const result = extractTextFromMarkdown('Text\n\n```python\nprint("hidden")\n```\n\nMore text');
    expect(result).not.toContain('print');
    expect(result).not.toContain('```');
    expect(result).toContain('Text');
    expect(result).toContain('More text');
  });

  it('converts links to their display text', () => {
    const result = extractTextFromMarkdown('[click here](https://example.com)');
    expect(result).toContain('click here');
    expect(result).not.toContain('https://');
  });

  it('strips bold and italic markers', () => {
    const result = extractTextFromMarkdown('This is **bold** and _italic_ text.');
    expect(result).toContain('bold');
    expect(result).toContain('italic');
    expect(result).not.toContain('**');
  });

  it('processes the sample markdown fixture', () => {
    const result = extractTextFromMarkdown(SAMPLE_MD);
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('RAG Knowledge Base');
    expect(result).not.toContain('#');
    expect(result).not.toContain('```');
  });
});

// ─── extractTextFromTxt ───────────────────────────────────────────────────────

describe('extractTextFromTxt', () => {
  it('returns trimmed text unchanged', () => {
    expect(extractTextFromTxt('hello world')).toBe('hello world');
  });

  it('normalises CRLF to LF', () => {
    const result = extractTextFromTxt('line1\r\nline2\r\nline3');
    expect(result).not.toContain('\r');
    expect(result).toContain('line1\nline2\nline3');
  });

  it('normalises lone CR to LF', () => {
    const result = extractTextFromTxt('line1\rline2');
    expect(result).not.toContain('\r');
    expect(result).toContain('\n');
  });

  it('processes the sample text fixture', () => {
    const result = extractTextFromTxt(SAMPLE_TXT);
    expect(result).toContain('Retrieval-Augmented Generation');
  });
});

// ─── extractTextFromPDF ───────────────────────────────────────────────────────

describe('extractTextFromPDF', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns extracted text on success', async () => {
    vi.mocked(pdfParse).mockResolvedValue({
      text: 'PDF extracted content',
      numpages: 1,
      numrender: 1,
      info: {},
      metadata: {},
      version: '1.4',
    } as Awaited<ReturnType<typeof pdfParse>>);

    const result = await extractTextFromPDF(Buffer.from('%PDF-1.4'));
    expect(result).toBe('PDF extracted content');
  });

  it('throws ChunkingError when pdfParse rejects', async () => {
    vi.mocked(pdfParse).mockRejectedValue(new Error('corrupt PDF'));
    await expect(extractTextFromPDF(Buffer.from(''))).rejects.toBeInstanceOf(ChunkingError);
  });

  it('normalises CRLF in the extracted PDF text', async () => {
    vi.mocked(pdfParse).mockResolvedValue({
      text: 'line1\r\nline2',
      numpages: 1,
      numrender: 1,
      info: {},
      metadata: {},
      version: '1.4',
    } as Awaited<ReturnType<typeof pdfParse>>);

    const result = await extractTextFromPDF(Buffer.from('%PDF'));
    expect(result).not.toContain('\r');
  });
});

// ─── extractTextFromDocx ──────────────────────────────────────────────────────

describe('extractTextFromDocx', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns extracted text from mammoth on success', async () => {
    vi.mocked(mammoth.extractRawText).mockResolvedValue({
      value: 'DOCX extracted content',
      messages: [],
    });

    const result = await extractTextFromDocx(Buffer.from('PK\x03\x04'));
    expect(result).toBe('DOCX extracted content');
  });

  it('throws ChunkingError when mammoth rejects', async () => {
    vi.mocked(mammoth.extractRawText).mockRejectedValue(new Error('bad zip'));
    await expect(extractTextFromDocx(Buffer.from(''))).rejects.toBeInstanceOf(ChunkingError);
  });
});

// ─── extractText dispatcher ───────────────────────────────────────────────────

describe('extractText', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dispatches to PDF extractor for "pdf" type', async () => {
    vi.mocked(pdfParse).mockResolvedValue({
      text: 'pdf content',
      numpages: 1,
      numrender: 1,
      info: {},
      metadata: {},
      version: '1.4',
    } as Awaited<ReturnType<typeof pdfParse>>);

    expect(await extractText(Buffer.from('%PDF'), 'pdf')).toBe('pdf content');
  });

  it('dispatches to DOCX extractor for "docx" type', async () => {
    vi.mocked(mammoth.extractRawText).mockResolvedValue({ value: 'docx content', messages: [] });
    expect(await extractText(Buffer.from('PK\x03\x04'), 'docx')).toBe('docx content');
  });

  it('handles "txt" type as plain text passthrough', async () => {
    expect(await extractText(Buffer.from('plain text'), 'txt')).toBe('plain text');
  });

  it('handles "md" type and strips markdown syntax', async () => {
    const result = await extractText(Buffer.from('# Title\n\nBody'), 'md');
    expect(result).toContain('Title');
    expect(result).not.toContain('#');
  });
});
