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
  extractTextFromHtml,
  extractText,
  stripHeaderFooterNoise,
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
  '# Lumina',
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

  it('uses gpt-tokenizer (cl100k_base), not the old chars/4 heuristic', () => {
    // Regression: token counts previously came from a 1-token-≈-4-chars
    // heuristic. gpt-tokenizer's real subword encoding gives materially
    // different (generally more accurate) counts for the same input — this
    // pins a known-correct cl100k_base count rather than re-deriving chars/4.
    expect(estimateTokenCount('hello world')).toBe(2);
  });

  it('gives a noticeably different (non chars/4) count for repeated short words', () => {
    // "abcdefgh" as a single unbroken token is 1 real subword token via
    // cl100k_base, not the chars/4 heuristic's answer of 2 — demonstrates the
    // two approaches diverge, which is the whole point of the tokenizer swap.
    expect(estimateTokenCount('abcdefgh')).not.toBe(Math.ceil('abcdefgh'.length / 4));
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

  // Regression: a Markdown table's rows were previously handed straight to
  // splitByHierarchy like any other block of lines, so a small chunkSize
  // could tear a table apart mid-row, losing column context for every row
  // split away from its header. Tables are now kept as one atomic segment.
  describe('table atomicity', () => {
    const TABLE = [
      '| Plan | Price | Seats |',
      '| --- | --- | --- |',
      '| Free | $0 | 1 |',
      '| Pro | $20 | 5 |',
      '| Team | $50 | 20 |',
    ].join('\n');

    it('keeps an entire Markdown table within a single chunk even with a small chunkSize', () => {
      const text = `Intro paragraph before the table.\n\n${TABLE}\n\nOutro paragraph after the table.`;
      const chunks = createChunks(text, { chunkSize: 8, chunkOverlap: 2, separator: ['\n\n', '\n', ' '] });

      const tableChunk = chunks.find((c) => c.content.includes('Free') && c.content.includes('Pro'));
      expect(tableChunk).toBeDefined();
      // Every row must land in the same chunk as the header — none split away.
      expect(tableChunk?.content).toContain('Plan');
      expect(tableChunk?.content).toContain('Free');
      expect(tableChunk?.content).toContain('Pro');
      expect(tableChunk?.content).toContain('Team');
    });

    it('does not corrupt surrounding prose when a table is present', () => {
      const text = `Intro paragraph before the table.\n\n${TABLE}\n\nOutro paragraph after the table.`;
      const chunks = createChunks(text, { chunkSize: 512, chunkOverlap: 50, separator: ['\n\n', '\n', ' '] });
      const allContent = chunks.map((c) => c.content).join(' ');
      expect(allContent).toContain('Intro paragraph before the table');
      expect(allContent).toContain('Outro paragraph after the table');
    });

    // Regression: MARKDOWN_TABLE_REGEX previously ran over the whole document
    // with no awareness of [CODE] blocks, so table-shaped content inside a
    // code sample (e.g. a tutorial documenting `| a | b |`-style output) got
    // torn out of the code block and treated as an atomic table segment —
    // corrupting the exact code-block preservation the same fix was meant to
    // guarantee. Code spans are now protected before table detection runs.
    it('does not let table detection tear apart a [CODE] block containing pipe-table-shaped text', () => {
      const text = 'Intro.\n\n[CODE]\n| Col1 | Col2 |\n|------|------|\n| a    | b    |\n[/CODE]\n\nOutro.';
      const chunks = createChunks(text, { chunkSize: 8, chunkOverlap: 2, separator: ['\n\n', '\n', ' '] });

      const codeChunk = chunks.find((c) => c.content.includes('[CODE]'));
      expect(codeChunk).toBeDefined();
      expect(codeChunk?.content).toContain('[/CODE]');
      expect(codeChunk?.content).toContain('Col1');
      expect(codeChunk?.content).toContain('a    | b');
    });

    // Regression: two tables back-to-back with no blank line between them
    // previously merged into a single match, because the data-row
    // continuation greedily consumed the second table's header+separator
    // rows as if they were more data rows of the first table.
    it('keeps two adjacent tables (no blank line between) as two separate atomic segments', () => {
      const text = '| A | B |\n|---|---|\n| 1 | 2 |\n| C | D |\n|---|---|\n| 3 | 4 |';
      const chunks = createChunks(text, { chunkSize: 6, chunkOverlap: 1, separator: ['\n\n', '\n', ' '] });

      const firstTableChunk = chunks.find((c) => c.content.includes('| A | B |'));
      const secondTableChunk = chunks.find((c) => c.content.includes('| C | D |'));
      expect(firstTableChunk).toBeDefined();
      expect(secondTableChunk).toBeDefined();
      // The first table's chunk must not have swallowed the second table's header.
      expect(firstTableChunk?.content).not.toContain('| C | D |');
    });

    // Regression: MARKDOWN_TABLE_REGEX previously anchored to a literal
    // line-start pipe (^\|), so a table indented under a list item (or any
    // leading whitespace) was invisible to detection and could still be torn
    // apart by the normal separator hierarchy.
    it('detects and protects a table indented under a list item', () => {
      const text = '- Pricing:\n  | Plan | Price |\n  |------|-------|\n  | Free | $0 |\n  | Pro | $20 |';
      const chunks = createChunks(text, { chunkSize: 6, chunkOverlap: 1, separator: ['\n\n', '\n', ' '] });

      const tableChunk = chunks.find((c) => c.content.includes('Free') && c.content.includes('Pro'));
      expect(tableChunk).toBeDefined();
      expect(tableChunk?.content).toContain('Plan');
    });
  });

  describe('whitespace-aligned plain-text table atomicity (PDF/DOCX extraction shape)', () => {
    // Simulates the column-aligned-with-spaces shape pdf-parse/mammoth
    // produce for a table that had real layout in the source, with no '|'
    // delimiter to key a regex off.
    const WS_TABLE = [
      'Plan      Price     Seats',
      'Free      $0        1',
      'Pro       $20       5',
      'Team      $50       20',
    ].join('\n');

    it('keeps an entire whitespace-aligned table within a single chunk', () => {
      const text = `Intro paragraph before the table.\n\n${WS_TABLE}\n\nOutro paragraph after the table.`;
      const chunks = createChunks(text, { chunkSize: 8, chunkOverlap: 2, separator: ['\n\n', '\n', ' '] });

      const tableChunk = chunks.find((c) => c.content.includes('Free') && c.content.includes('Pro'));
      expect(tableChunk).toBeDefined();
      expect(tableChunk?.content).toContain('Plan');
      expect(tableChunk?.content).toContain('Team');
    });

    it('does not corrupt surrounding prose when a whitespace table is present', () => {
      const text = `Intro paragraph before the table.\n\n${WS_TABLE}\n\nOutro paragraph after the table.`;
      const chunks = createChunks(text, { chunkSize: 512, chunkOverlap: 50, separator: ['\n\n', '\n', ' '] });
      const allContent = chunks.map((c) => c.content).join(' ');
      expect(allContent).toContain('Intro paragraph before the table');
      expect(allContent).toContain('Outro paragraph after the table');
    });

    it('does not treat two consecutive lines with matching column count as a table (below MIN_TABLE_ROWS)', () => {
      const text = 'Alpha      Beta\nGamma      Delta';
      const chunks = createChunks(text, { chunkSize: 512, chunkOverlap: 0, separator: ['\n\n', '\n', ' '] });
      // With only 2 rows the whole thing should still be treated as ordinary
      // prose (one chunk, not protected as a table) — the join uses a single
      // space, so line breaks collapse but content survives.
      expect(chunks.map((c) => c.content).join(' ')).toContain('Alpha');
      expect(chunks.map((c) => c.content).join(' ')).toContain('Delta');
    });

    it('does not double-detect a whitespace table inside an already-protected Markdown table', () => {
      // A Markdown table's cells are pipe-delimited but may still contain
      // runs of 2+ spaces for alignment — it must be consumed once by
      // MARKDOWN_TABLE_REGEX, not re-split by the whitespace-table detector.
      const text = [
        '| Plan   | Price |',
        '| ------ | ----- |',
        '| Free   | $0    |',
        '| Pro    | $20   |',
      ].join('\n');
      const chunks = createChunks(text, { chunkSize: 8, chunkOverlap: 1, separator: ['\n\n', '\n', ' '] });

      const tableChunk = chunks.find((c) => c.content.includes('Free'));
      expect(tableChunk).toBeDefined();
      expect(tableChunk?.content).toContain('Plan');
      expect(tableChunk?.content).toContain('Pro');
    });

    it('does not misdetect ordinary indented/aligned prose as a table', () => {
      const text = [
        'This is a normal sentence with some spacing.',
        'Another normal sentence follows here too.',
        'A third unrelated sentence about something else.',
      ].join('\n');
      const chunks = createChunks(text, { chunkSize: 512, chunkOverlap: 0, separator: ['\n\n', '\n', ' '] });
      expect(chunks).toHaveLength(1);
    });
  });

  // ─── Section-aware boundaries ─────────────────────────────────────────────

  describe('section-aware chunking', () => {
    it('never merges two "Section: " headings from a Markdown source into one chunk', () => {
      const text = [
        'Section: Introduction',
        'This part introduces the topic in a short paragraph.',
        'Section: Conclusion',
        'This part wraps things up in a short paragraph.',
      ].join('\n\n');

      const chunks = createChunks(text, { chunkSize: 512, chunkOverlap: 20, separator: ['\n\n', '\n', ' '] });

      const introChunk = chunks.find((c) => c.content.includes('introduces the topic'));
      const conclusionChunk = chunks.find((c) => c.content.includes('wraps things up'));
      expect(introChunk).toBeDefined();
      expect(conclusionChunk).toBeDefined();
      expect(introChunk).not.toBe(conclusionChunk);
      expect(introChunk?.content).not.toContain('Section: Conclusion');
    });

    it('populates metadata.section with the most recent heading', () => {
      const text = [
        'Section: Pricing',
        'The basic plan costs ten dollars per month for individual users.',
      ].join('\n\n');

      const chunks = createChunks(text, { chunkSize: 512, chunkOverlap: 0, separator: ['\n\n', '\n', ' '] });

      expect(chunks[0]?.metadata.section).toBe('Pricing');
    });

    it('leaves metadata.section undefined when the document has no headings', () => {
      const text = 'Just a plain paragraph with no heading markers anywhere in it.';
      const chunks = createChunks(text, { chunkSize: 512, chunkOverlap: 0, separator: ['\n\n', ' '] });
      expect(chunks[0]?.metadata.section).toBeUndefined();
    });

    it('carries the same section label across multiple chunks within one long section', () => {
      const longParagraph = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} about pricing details`).join('. ');
      const text = ['Section: Pricing', longParagraph].join('\n\n');

      const chunks = createChunks(text, { chunkSize: 20, chunkOverlap: 2, separator: ['\n\n', '. ', ' '] });

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.metadata.section).toBe('Pricing');
      }
    });

    it('detects a numbered heading in plain (non-Markdown) text as a section boundary', () => {
      const text = [
        '1. Getting Started',
        'This section explains how to begin using the product.',
        '2. Advanced Usage',
        'This section covers advanced configuration options.',
      ].join('\n\n');

      const chunks = createChunks(text, { chunkSize: 512, chunkOverlap: 10, separator: ['\n\n', '\n', ' '] });

      const firstChunk = chunks.find((c) => c.content.includes('begin using'));
      const secondChunk = chunks.find((c) => c.content.includes('advanced configuration'));
      expect(firstChunk).toBeDefined();
      expect(secondChunk).toBeDefined();
      expect(firstChunk).not.toBe(secondChunk);
    });

    it('does not misdetect an ordinary declarative sentence as a heading', () => {
      // Short, capitalized, no trailing punctuation on its own line-ish
      // content — but this one is a real sentence with mid-line punctuation,
      // so it must not force a chunk boundary.
      const text = 'The quick brown fox jumps over the lazy dog near the river.';
      const chunks = createChunks(text, { chunkSize: 512, chunkOverlap: 0, separator: ['\n\n', ' '] });
      expect(chunks).toHaveLength(1);
    });
  });

  // ─── Dynamic overlap sizing ────────────────────────────────────────────────

  describe('dynamic overlap sizing', () => {
    it('carries little to no overlap across a table→prose boundary compared to prose→prose', () => {
      const table = '| A | B |\n|---|---|\n| 1 | 2 |';
      const prose = Array.from({ length: 20 }, (_, i) => `Filler sentence number ${i} about nothing in particular`).join('. ');

      const textWithTable = [table, prose].join('\n\n');
      const textAllProse = [prose, prose].join('\n\n');

      const opts = { chunkSize: 15, chunkOverlap: 8, separator: ['\n\n', '. ', ' '] };
      const afterTable = createChunks(textWithTable, opts);
      const afterProse = createChunks(textAllProse, opts);

      // Find the chunk immediately following the boundary in each case and
      // compare how much of the *previous* segment's tail leaked into it.
      const tableBoundaryChunk = afterTable[1]?.content ?? '';
      const proseBoundaryChunk = afterProse[1]?.content ?? '';

      // The table-boundary chunk should not start by re-including table content
      // (overlap was suppressed), whereas prose-to-prose overlap is expected.
      expect(tableBoundaryChunk).not.toContain('| A | B |');
      expect(afterProse.length).toBeGreaterThan(1);
      expect(proseBoundaryChunk.length).toBeGreaterThan(0);
    });

    it('starts a fresh chunk with no overlap immediately after a forced heading boundary', () => {
      const text = [
        'Section: First',
        'Some introductory prose that runs on for a little while here.',
        'Section: Second',
        'Some more prose in the second section.',
      ].join('\n\n');

      const chunks = createChunks(text, { chunkSize: 512, chunkOverlap: 50, separator: ['\n\n', '. ', ' '] });

      const secondChunk = chunks.find((c) => c.metadata.section === 'Second');
      expect(secondChunk).toBeDefined();
      expect(secondChunk?.content).not.toContain('introductory prose');
    });
  });
});

// ─── extractTextFromMarkdown ──────────────────────────────────────────────────

describe('extractTextFromMarkdown', () => {
  it('returns empty string for empty input', () => {
    expect(extractTextFromMarkdown('')).toBe('');
    expect(extractTextFromMarkdown('   ')).toBe('');
  });

  it('converts ATX headers to a plain-text "Section: " marker instead of deleting them', () => {
    // Regression: headers were previously stripped of their '#' marker with
    // no replacement, so a header's text became indistinguishable from body
    // prose — the chunker had no signal to split on section boundaries, and
    // a reader/LLM couldn't tell a heading from a sentence. "Section: " keeps
    // that signal as plain text.
    const result = extractTextFromMarkdown('# Heading 1\n\n## Heading 2\n\nBody text');
    expect(result).not.toContain('#');
    expect(result).toContain('Section: Heading 1');
    expect(result).toContain('Section: Heading 2');
    expect(result).toContain('Body text');
  });

  it('keeps fenced code block content, wrapped in [CODE]/[/CODE] markers instead of deleting it', () => {
    // Regression: code blocks were previously deleted outright, so an
    // uploaded doc with a config example or code snippet lost that content
    // before it ever reached the chunker/embedder. It's now kept as plain
    // text (unusable to the LLM as syntax-highlighted code either way) so it
    // can still be retrieved and quoted back.
    const result = extractTextFromMarkdown('Text\n\n```python\nprint("hidden")\n```\n\nMore text');
    expect(result).toContain('print("hidden")');
    expect(result).toContain('[CODE]');
    expect(result).toContain('[/CODE]');
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
    expect(result).toContain('Section: Lumina');
    expect(result).not.toContain('#');
    expect(result).not.toContain('```');
  });

  it('keeps bullet list markers as a normalised "- " prefix instead of stripping them', () => {
    // Regression: bullet markers were previously stripped with no
    // replacement, so a bulleted list collapsed into indistinguishable
    // plain lines and lost its list structure entirely.
    const result = extractTextFromMarkdown('- First step\n* Second step\n+ Third step');
    expect(result).toContain('- First step');
    expect(result).toContain('- Second step');
    expect(result).toContain('- Third step');
  });

  it('keeps numbered list markers unchanged', () => {
    const result = extractTextFromMarkdown('1. First step\n2. Second step');
    expect(result).toContain('1. First step');
    expect(result).toContain('2. Second step');
  });
});

// ─── extractTextFromHtml ──────────────────────────────────────────────────────

describe('extractTextFromHtml', () => {
  it('returns empty string for empty/whitespace-only input', () => {
    expect(extractTextFromHtml('')).toBe('');
    expect(extractTextFromHtml('   ')).toBe('');
  });

  it('strips tags and keeps text content', () => {
    const result = extractTextFromHtml('<p>Hello <b>world</b></p>');
    expect(result).toContain('Hello');
    expect(result).toContain('world');
    expect(result).not.toContain('<p>');
    expect(result).not.toContain('<b>');
  });

  it('converts headers into "Section: " markers, matching the Markdown convention', () => {
    const result = extractTextFromHtml('<h1>Introduction</h1><p>Body text.</p>');
    expect(result).toContain('Section: Introduction');
  });

  it('drops <script> and <style> contents entirely', () => {
    const result = extractTextFromHtml('<script>alert("x")</script><style>.a{color:red}</style><p>Real content</p>');
    expect(result).not.toContain('alert');
    expect(result).not.toContain('color:red');
    expect(result).toContain('Real content');
  });

  it('strips HTML comments', () => {
    const result = extractTextFromHtml('<!-- a comment --><p>Visible text</p>');
    expect(result).not.toContain('a comment');
    expect(result).toContain('Visible text');
  });

  it('converts <li> items to "- " prefixed lines', () => {
    const result = extractTextFromHtml('<ul><li>First</li><li>Second</li></ul>');
    expect(result).toContain('- First');
    expect(result).toContain('- Second');
  });

  it('converts <br> and block-level closing tags into line breaks', () => {
    const result = extractTextFromHtml('<p>Line one</p><p>Line two</p>');
    const lines = result.split('\n').filter((l) => l.trim().length > 0);
    expect(lines).toContain('Line one');
    expect(lines).toContain('Line two');
  });

  it('decodes common HTML entities', () => {
    const result = extractTextFromHtml('<p>Tom &amp; Jerry &mdash; a &quot;classic&quot;</p>');
    expect(result).toContain('Tom & Jerry');
    expect(result).toContain('—');
    expect(result).toContain('"classic"');
  });

  it('converts a <table> into whitespace-aligned rows the table detector can pick up', () => {
    const html = '<table><tr><th>Plan</th><th>Price</th></tr><tr><td>Free</td><td>$0</td></tr></table>';
    const result = extractTextFromHtml(html);
    expect(result).toContain('Plan');
    expect(result).toContain('Price');
    expect(result).toContain('Free');
  });

  it('collapses excess blank lines', () => {
    const result = extractTextFromHtml('<p>A</p>\n\n\n\n<p>B</p>');
    expect(result).not.toMatch(/\n{3,}/);
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
    } as unknown as Awaited<ReturnType<typeof pdfParse>>);

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
    } as unknown as Awaited<ReturnType<typeof pdfParse>>);

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
    } as unknown as Awaited<ReturnType<typeof pdfParse>>);

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

  it('dispatches to HTML extractor for "html" type', async () => {
    const result = await extractText(Buffer.from('<h1>Title</h1><p>Body</p>'), 'html');
    expect(result).toContain('Section: Title');
    expect(result).toContain('Body');
  });
});

// ─── stripHeaderFooterNoise ───────────────────────────────────────────────────

describe('stripHeaderFooterNoise', () => {
  it('removes a bare page-number line', () => {
    const text = 'Some content here.\n\n3\n\nMore content follows.';
    expect(stripHeaderFooterNoise(text)).not.toMatch(/^3$/m);
  });

  it('removes "Page N of M" and "- N -" page-number shapes', () => {
    const text = ['Body text one.', 'Page 3 of 12', 'Body text two.', '- 4 -', 'Body text three.'].join('\n');
    const result = stripHeaderFooterNoise(text);
    expect(result).not.toContain('Page 3 of 12');
    expect(result).not.toContain('- 4 -');
    expect(result).toContain('Body text one.');
    expect(result).toContain('Body text three.');
  });

  it('leaves a short line alone when it only appears once or twice', () => {
    // Build a long-enough document (>=4 approximate pages) so repeat
    // detection is active, but the short line itself only appears once.
    const filler = Array.from({ length: 200 }, (_, i) => `Filler sentence number ${i} with unrelated content.`);
    const text = [...filler.slice(0, 50), 'Important Note', ...filler.slice(50)].join('\n');
    expect(stripHeaderFooterNoise(text)).toContain('Important Note');
  });

  it('removes a short line that repeats across most of a long document (running header/footer)', () => {
    // 8 "pages" worth of lines (approxLinesPerPage=40 -> 320 lines), with a
    // running footer inserted once per ~40-line block, well past the
    // MIN_BLOCKS_FOR_REPEAT_DETECTION and MIN_REPEAT_FRACTION thresholds.
    const pages: string[] = [];
    for (let page = 0; page < 8; page++) {
      const pageLines = Array.from({ length: 39 }, (_, i) => `Page ${page} body line ${i} with real content.`);
      pages.push(...pageLines, 'Confidential - Internal Use Only');
    }
    const text = pages.join('\n');

    const result = stripHeaderFooterNoise(text);
    expect(result).not.toContain('Confidential - Internal Use Only');
    expect(result).toContain('Page 0 body line 0 with real content.');
  });

  it('does not apply repeat-based detection on a short document', () => {
    // Fewer than MIN_BLOCKS_FOR_REPEAT_DETECTION approximate pages — even a
    // 3x-repeated short line should survive, since repetition on a short
    // document is not a reliable header/footer signal.
    const text = ['Warning: read carefully.', 'Body one.', 'Warning: read carefully.', 'Body two.', 'Warning: read carefully.'].join('\n');
    expect(stripHeaderFooterNoise(text)).toContain('Warning: read carefully.');
  });

  it('preserves blank lines (paragraph structure)', () => {
    const text = 'Paragraph one.\n\nParagraph two.';
    expect(stripHeaderFooterNoise(text)).toBe(text);
  });

  it('leaves ordinary body text with no noise completely unchanged', () => {
    const text = 'A perfectly normal document.\nWith a few lines.\nAnd nothing suspicious.';
    expect(stripHeaderFooterNoise(text)).toBe(text);
  });
});
