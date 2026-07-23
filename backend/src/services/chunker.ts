/**
 * @file chunker.ts
 * @description Document parsing and text chunking service — converts raw files into
 *              overlapping text segments suitable for embedding
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { ChunkingError, ChunkingErrorCode } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import type { FileType, ChunkMetadata } from '../types/index.js';

// ─── Interfaces ───────────────────────────────────────────────────────────────

/** Token-based chunking options for the hierarchical splitter. */
export interface ChunkOptions {
  /** Target token count per chunk (default 512). */
  chunkSize: number;
  /** Token overlap between adjacent chunks (default 50). */
  chunkOverlap: number;
  /** Separator hierarchy tried in order, coarsest to finest. */
  separator: string[];
}

/** A text chunk produced by either chunking strategy. */
export interface TextChunk {
  content: string;
  /** Zero-based position of this chunk in the document. */
  index: number;
  /** Estimated token count for this chunk. */
  tokenCount: number;
  metadata: ChunkMetadata;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  chunkSize: 512,
  chunkOverlap: 50,
  separator: ['\n\n', '\n', '. ', ' '],
};

// ─── Token Estimation ─────────────────────────────────────────────────────────

/**
 * Estimates the token count for a string using the 1 token ≈ 4 chars heuristic.
 * Accurate enough for English; may underestimate for dense CJK text.
 * @param text - Input text
 * @returns Estimated token count (always ≥ 0)
 */
export function estimateTokenCount(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

// ─── Hierarchical Splitter ────────────────────────────────────────────────────

/**
 * Splits text using a separator hierarchy, trying coarser splits first.
 * When a piece exceeds `maxTokens` estimated tokens it is recursively split on the next separator.
 * @param text - Text to split
 * @param separators - Separator strings in priority order (coarsest first)
 * @param maxTokens - Token threshold above which a piece is recursively split further.
 *   Defaults to DEFAULT_CHUNK_OPTIONS.chunkSize (512) — callers driving a custom
 *   chunkSize (createChunks) must pass it explicitly so this threshold tracks the
 *   configured target instead of silently diverging from it.
 * @returns Flat array of text segments with leading/trailing whitespace trimmed
 */
export function splitByHierarchy(
  text: string,
  separators: string[],
  maxTokens: number = DEFAULT_CHUNK_OPTIONS.chunkSize,
): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (separators.length === 0) return [trimmed];

  const [sep, ...rest] = separators;
  // sep is always defined here: the `separators.length === 0` guard above ensures it
  const parts = trimmed
    .split(sep!)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  // Splitting didn't divide the text — try the next separator
  if (parts.length <= 1) return splitByHierarchy(trimmed, rest, maxTokens);

  return parts.flatMap((part) => {
    if (rest.length > 0 && estimateTokenCount(part) > maxTokens) {
      return splitByHierarchy(part, rest, maxTokens);
    }
    return [part];
  });
}

// ─── Token-Based Chunking ─────────────────────────────────────────────────────

/** A half-open [start, end) character span into the original source text. */
interface CharSpan {
  start: number;
  end: number;
}

/**
 * Resolves each segment's real [start, end) span in the source text, once,
 * in strict forward order. `splitByHierarchy` trims each segment and
 * discards the original separators (blank lines, multi-space runs, tabs), so
 * `segments.join(' ')` does not appear verbatim in `text` — offsets must be
 * located directly rather than reconstructed from joined-segment lengths.
 * Segments are produced in document order and are non-overlapping in the
 * source, so a monotonically-advancing cursor always finds the correct
 * occurrence even when a segment's text (e.g. a single repeated word)
 * recurs elsewhere in the document.
 * @param text - Full document text
 * @param segments - Ordered, non-overlapping segments from splitByHierarchy
 * @returns One CharSpan per segment, same order and length as `segments`
 */
function resolveSegmentSpans(text: string, segments: string[]): CharSpan[] {
  const spans: CharSpan[] = [];
  let cursor = 0;

  for (const seg of segments) {
    if (seg.length === 0) {
      spans.push({ start: cursor, end: cursor });
      continue;
    }
    const start = text.indexOf(seg, cursor);
    if (start === -1) {
      // Should not happen (segments derive from `text`), but degrade
      // gracefully rather than desync every subsequent span.
      spans.push({ start: cursor, end: cursor + seg.length });
      continue;
    }
    const end = start + seg.length;
    spans.push({ start, end });
    cursor = end;
  }

  return spans;
}

/** Segments + spans carried over from one chunk into the next, as overlap context. */
interface OverlapWindow {
  segs: string[];
  spans: CharSpan[];
  tokens: number;
}

/**
 * Takes the trailing segments of the just-flushed chunk (up to `chunkOverlap`
 * tokens, working backward) to seed the next chunk's overlap context.
 * @param segments - The just-flushed chunk's segments, in order
 * @param spans - Matching CharSpans, same order/length as `segments`
 * @param chunkOverlap - Maximum overlap tokens to carry forward
 * @returns The trailing window to prepend to the next chunk
 */
function buildOverlapWindow(segments: string[], spans: CharSpan[], chunkOverlap: number): OverlapWindow {
  const overlapSegs: string[] = [];
  const overlapSpans: CharSpan[] = [];
  let overlapTokens = 0;

  for (let i = segments.length - 1; i >= 0; i--) {
    const segTokens = estimateTokenCount(segments[i] ?? '');
    if (overlapTokens + segTokens > chunkOverlap) break;
    overlapSegs.unshift(segments[i] ?? '');
    const span = spans[i];
    if (span) overlapSpans.unshift(span);
    overlapTokens += segTokens;
  }

  return { segs: overlapSegs, spans: overlapSpans, tokens: overlapTokens };
}

/**
 * Assembles hierarchical segments into overlapping chunks of the target token size.
 * Each chunk carries an estimated token count and its position index.
 * @param text - Full document text
 * @param options - Chunking parameters
 * @returns Array of text chunks in document order
 */
export function createChunks(
  text: string,
  options: ChunkOptions = DEFAULT_CHUNK_OPTIONS,
): TextChunk[] {
  const { chunkSize, chunkOverlap, separator } = options;

  if (text.trim().length === 0) return [];

  const segments = splitByHierarchy(text, separator, chunkSize);
  const segmentSpans = resolveSegmentSpans(text, segments);

  const chunks: TextChunk[] = [];
  let currentSegments: string[] = [];
  let currentSpans: CharSpan[] = [];
  let currentTokens = 0;

  const flush = (): void => {
    if (currentSegments.length === 0) return;

    const content = currentSegments.join(' ');
    const charStart = currentSpans[0]?.start ?? 0;
    const charEnd = currentSpans[currentSpans.length - 1]?.end ?? charStart + content.length;

    chunks.push({
      content,
      index: chunks.length,
      tokenCount: estimateTokenCount(content),
      metadata: { char_start: charStart, char_end: charEnd },
    });
  };

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i] ?? '';
    const span = segmentSpans[i] ?? { start: 0, end: 0 };
    const segTokens = estimateTokenCount(segment);

    if (currentTokens + segTokens > chunkSize && currentSegments.length > 0) {
      flush();
      const { segs, spans, tokens } = buildOverlapWindow(currentSegments, currentSpans, chunkOverlap);
      currentSegments = segs;
      currentSpans = spans;
      currentTokens = tokens;
    }

    currentSegments.push(segment);
    currentSpans.push(span);
    currentTokens += segTokens;
  }

  flush();

  logger.debug('Chunks created', { count: chunks.length, textLength: text.length });
  return chunks;
}

// ─── Text Extractors (Buffer-Based) ──────────────────────────────────────────

/**
 * Strips characters that Postgres's `text`/`json` types cannot store, so
 * extracted content is always safe to upsert as a Supabase JSON payload.
 * Removes NUL bytes (rejected by Postgres text columns) and unpaired
 * UTF-16 surrogates (rejected by JSON serialisation) sometimes produced by
 * malformed PDF font encodings.
 * @param text - Raw extracted text
 * @returns Text safe for JSON serialisation and Postgres storage
 */
function sanitizeExtractedText(text: string): string {
  return text
    .replace(/\x00/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
}

/**
 * Extracts plain text from a PDF file buffer using pdf-parse.
 * @param buffer - Raw PDF file bytes
 * @returns Extracted text with normalised line endings
 * @throws {ChunkingError} If the buffer cannot be parsed as a PDF
 */
export async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  try {
    const { default: pdfParse } = await import('pdf-parse');
    const result = await pdfParse(buffer);
    return sanitizeExtractedText(result.text.replace(/\r\n/g, '\n').trim());
  } catch (err) {
    if (err instanceof ChunkingError) throw err;
    throw new ChunkingError(
      `PDF parsing failed: ${err instanceof Error ? err.message : String(err)}`,
      ChunkingErrorCode.PARSE_FAILED,
      422,
      err instanceof Error ? err : undefined,
    );
  }
}

/**
 * Extracts plain text from a DOCX file buffer using mammoth.
 * @param buffer - Raw DOCX file bytes
 * @returns Extracted text with normalised line endings
 * @throws {ChunkingError} If the buffer cannot be parsed as a DOCX
 */
export async function extractTextFromDocx(buffer: Buffer): Promise<string> {
  try {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    if (result.messages.length > 0) {
      logger.warn('DOCX parse warnings', { messages: result.messages });
    }
    return result.value.replace(/\r\n/g, '\n').trim();
  } catch (err) {
    if (err instanceof ChunkingError) throw err;
    throw new ChunkingError(
      `DOCX parsing failed: ${err instanceof Error ? err.message : String(err)}`,
      ChunkingErrorCode.PARSE_FAILED,
      422,
      err instanceof Error ? err : undefined,
    );
  }
}

/**
 * Strips common Markdown syntax and returns clean prose text.
 * @param text - Raw Markdown source
 * @returns Plain text with headers, links, code blocks, and emphasis removed
 */
export function extractTextFromMarkdown(text: string): string {
  if (text.trim().length === 0) return '';

  return text
    .replace(/```[\s\S]*?```/g, '') // fenced code blocks
    .replace(/`[^`]+`/g, '') // inline code
    .replace(/^#{1,6}\s+/gm, '') // ATX headers
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1') // images → alt text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → link text
    .replace(/[*_]{1,2}([^*_\n]+)[*_]{1,2}/g, '$1') // bold / italic
    .replace(/^[-*+]\s+/gm, '') // bullet list markers
    .replace(/^\d+\.\s+/gm, '') // numbered list markers
    .replace(/^>\s+/gm, '') // blockquotes
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n') // collapse blank lines
    .trim();
}

/**
 * Normalises a plain-text string by standardising line endings.
 * @param text - Raw text content
 * @returns Normalised text
 */
export function extractTextFromTxt(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

/**
 * Dispatches buffer extraction to the correct handler based on file type.
 * @param buffer - Raw file bytes
 * @param fileType - Extension-based file type identifier
 * @returns Extracted plain text
 * @throws {ChunkingError} If the file type is unsupported or extraction fails
 */
export async function extractText(buffer: Buffer, fileType: FileType): Promise<string> {
  switch (fileType) {
    case 'pdf':
      return extractTextFromPDF(buffer);
    case 'docx':
      return extractTextFromDocx(buffer);
    case 'txt':
      return extractTextFromTxt(buffer.toString('utf-8'));
    case 'md':
      return extractTextFromMarkdown(buffer.toString('utf-8'));
    default: {
      const exhaustive: never = fileType;
      throw new ChunkingError(
        `Unsupported file type: ${String(exhaustive)}`,
        ChunkingErrorCode.UNSUPPORTED_FORMAT,
      );
    }
  }
}
