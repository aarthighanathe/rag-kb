/**
 * @file chunker.ts
 * @description Document parsing and text chunking service — converts raw files into
 *              overlapping text segments suitable for embedding
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { encode } from 'gpt-tokenizer';
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
 * Estimates the token count for a string using gpt-tokenizer's cl100k_base
 * encoding — a real subword tokenizer, not an exact match for the Groq
 * model actually in use (see MODEL_ID in llm.ts; no lightweight pure-JS
 * implementation of its own tokenizer is available), but far closer to
 * real token counts than the previous 1-token-≈-4-chars heuristic, especially
 * for non-English text where the char-count heuristic diverges most.
 * @param text - Input text
 * @returns Token count (always ≥ 0)
 */
export function estimateTokenCount(text: string): number {
  if (text.length === 0) return 0;
  return encode(text).length;
}

/** Character length above which {@link estimateTokenCountBounded} falls back to the chars/4 heuristic. */
const TOKEN_ESTIMATE_CHAR_CAP = 200_000;

/**
 * Estimates token count like {@link estimateTokenCount}, but falls back to the
 * O(1) chars/4 heuristic for very large inputs so the real tokenizer never
 * blocks the event loop encoding tens of thousands of tokens for a value
 * that's only used for a threshold comparison or a stored annotation.
 * @param text - Input text
 * @returns Token count (always ≥ 0)
 */
function estimateTokenCountBounded(text: string): number {
  return text.length <= TOKEN_ESTIMATE_CHAR_CAP
    ? estimateTokenCount(text)
    : Math.ceil(text.length / 4);
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
    const partTokens = estimateTokenCountBounded(part);
    if (rest.length > 0 && partTokens > maxTokens) {
      return splitByHierarchy(part, rest, maxTokens);
    }
    return [part];
  });
}

// ─── Table-Aware Segmentation ─────────────────────────────────────────────────

/**
 * Matches a `[CODE]...[/CODE]` block (see extractTextFromMarkdown) as one
 * atomic span. Detected and protected before table matching runs, so a code
 * sample that happens to contain pipe-table-shaped content (e.g. a tutorial
 * documenting a data structure, or literal `| a | b |`-style output) is never
 * torn apart by MARKDOWN_TABLE_REGEX matching inside it — by the time table
 * detection sees the text, code spans have already been carved out and are
 * skipped entirely.
 */
const CODE_BLOCK_REGEX = /\[CODE\][\s\S]*?\[\/CODE\]/g;

/**
 * Matches a Markdown table block: a header row, a separator row (dashes/pipes/
 * colons), and one or more data rows, each on its own line. Tables rarely
 * benefit from being split mid-block — a row torn from its header loses all
 * column context — so these are kept as a single non-splittable segment
 * rather than being handed to splitByHierarchy, which would otherwise tear
 * the block apart on its '\n' separator like any other run of lines.
 *
 * Allows optional leading whitespace before the first `|` so a table nested
 * under a list item (e.g. `  | A | B |`) is still recognised — a bare `^\|`
 * anchor would silently miss any indented table.
 *
 * The data-row continuation `(?:...)+` is deliberately NOT allowed to consume
 * a line that itself looks like a new table's header+separator pair (i.e. a
 * pipe row immediately followed by a dash/colon separator row) — without that
 * guard, two adjacent tables with no blank line between them would greedily
 * merge into a single match, misreading the second table's header as another
 * data row of the first.
 */
const MARKDOWN_TABLE_REGEX =
  /^[ \t]*\|.*\|[ \t]*\n[ \t]*\|[ \t:|-]+\|[ \t]*\n(?:(?![ \t]*\|.*\|[ \t]*\n[ \t]*\|[ \t:|-]+\|)[ \t]*\|.*\|[ \t]*\n?)+/gm;

/**
 * Splits a line into cells on runs of 2+ spaces or a tab — the shape
 * `pdf-parse`/plain-text extraction produces for a table that had real
 * column alignment in the source layout, since there's no delimiter
 * character (no `|`) to key off the way Markdown tables have. A single
 * space is deliberately not a splitter, since that would tear apart
 * ordinary multi-word cell values and prose alike.
 * @param line - One line of text
 * @returns Non-empty trimmed cell values, in order
 */
function splitWhitespaceAlignedCells(line: string): string[] {
  return line
    .split(/\t| {2,}/)
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
}

/** Minimum consecutive lines with a stable column count before the block is treated as a table, not a coincidental alignment. */
const MIN_TABLE_ROWS = 3;

/**
 * Detects a whitespace/tab-aligned plain-text table — the shape PDF/DOCX
 * extraction produces for a table that had real column layout in the source
 * (no Markdown `|` delimiters to key off, unlike MARKDOWN_TABLE_REGEX).
 * A run of MIN_TABLE_ROWS+ consecutive non-blank lines that each split into
 * the same number of cells (≥2 columns) via splitWhitespaceAlignedCells is
 * treated as one table block — chosen over a per-line regex since "same
 * column count repeated across several lines" isn't expressible as a single
 * line-local pattern the way a Markdown table's `|`/`-` separator row is.
 * @param text - Source text to scan
 * @returns Ordered spans covering the whole input, tagged 'table' or null
 */
function detectWhitespaceTables(text: string): Array<{ text: string; tag: 'table' | null }> {
  const lines = text.split('\n');
  const spans: Array<{ text: string; tag: 'table' | null }> = [];
  let plainStart = 0;
  let i = 0;

  const flushPlain = (endExclusive: number): void => {
    if (endExclusive > plainStart) {
      spans.push({ text: lines.slice(plainStart, endExclusive).join('\n'), tag: null });
    }
  };

  while (i < lines.length) {
    const cellCounts = splitWhitespaceAlignedCells(lines[i] ?? '').length;
    if (cellCounts < 2) {
      i++;
      continue;
    }

    let j = i + 1;
    while (j < lines.length && splitWhitespaceAlignedCells(lines[j] ?? '').length === cellCounts) {
      j++;
    }

    const rowCount = j - i;
    if (rowCount >= MIN_TABLE_ROWS) {
      flushPlain(i);
      spans.push({ text: lines.slice(i, j).join('\n'), tag: 'table' });
      plainStart = j;
    }
    i = j;
  }

  flushPlain(lines.length);
  return spans;
}

/**
 * Splits text into an ordered sequence of protected (code or table) and
 * plain spans, given a detector regex, so a protected block is never handed
 * to splitByHierarchy (which would tear it apart on '\n' like any other run
 * of lines).
 * @param text - Source text to scan
 * @param detector - Global regex identifying protected block boundaries
 * @param tag - Label attached to protected spans, for the caller to branch on
 * @returns Ordered spans covering the whole input, tagged protected/plain
 */
function splitProtectedSpans(
  text: string,
  detector: RegExp,
  tag: string,
): Array<{ text: string; tag: string | null }> {
  const spans: Array<{ text: string; tag: string | null }> = [];
  let cursor = 0;

  for (const match of text.matchAll(detector)) {
    const start = match.index;
    if (start > cursor) spans.push({ text: text.slice(cursor, start), tag: null });
    spans.push({ text: match[0], tag });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) spans.push({ text: text.slice(cursor), tag: null });

  return spans;
}

/** A chunker-ready segment tagged with what kind of content it is. */
interface TaggedSegment {
  text: string;
  /** 'code'/'table' for a protected atomic block, 'heading' for a section boundary, null for ordinary prose. */
  tag: 'code' | 'table' | 'heading' | null;
}

/**
 * Segments text into chunker-ready pieces, keeping any `[CODE]` block or
 * Markdown table intact as a single segment while running the normal
 * separator hierarchy over everything else. Code blocks are protected first
 * so table detection never runs against text inside one — see
 * CODE_BLOCK_REGEX's doc comment for why that ordering matters. Plain-text
 * segments that look like a section heading (see isSectionHeading) are
 * tagged 'heading' rather than 'code'/'table'/null, so createChunks can treat
 * them as a forced chunk boundary instead of letting a heading get buried in
 * the middle of a chunk.
 * @param text - Full document text
 * @param separators - Separator hierarchy for unprotected text
 * @param maxTokens - Recursive-split threshold for unprotected text
 * @returns Flat array of tagged segments in document order
 */
function segmentWithTableAwareness(
  text: string,
  separators: string[],
  maxTokens: number,
): TaggedSegment[] {
  const codeSpans = splitProtectedSpans(text, CODE_BLOCK_REGEX, 'code');

  return codeSpans.flatMap((codeSpan): TaggedSegment[] => {
    if (codeSpan.tag === 'code') {
      const trimmed = codeSpan.text.trim();
      return trimmed.length === 0 ? [] : [{ text: trimmed, tag: 'code' }];
    }

    const tableSpans = splitProtectedSpans(codeSpan.text, MARKDOWN_TABLE_REGEX, 'table');
    return tableSpans.flatMap((span): TaggedSegment[] => {
      const trimmed = span.text.trim();
      if (trimmed.length === 0) return [];
      if (span.tag === 'table') return [{ text: trimmed, tag: 'table' }];

      // No Markdown table matched this span — check for a whitespace/tab-
      // aligned plain-text table (the shape PDF/DOCX extraction produces,
      // with no '|' delimiter to key a regex off) before falling through to
      // the normal separator hierarchy.
      return detectWhitespaceTables(span.text).flatMap((wsSpan): TaggedSegment[] => {
        const wsTrimmed = wsSpan.text.trim();
        if (wsTrimmed.length === 0) return [];
        if (wsSpan.tag === 'table') return [{ text: wsTrimmed, tag: 'table' }];
        return splitByHierarchy(wsSpan.text, separators, maxTokens).map((seg) => ({
          text: seg,
          tag: isSectionHeading(seg) ? ('heading' as const) : null,
        }));
      });
    });
  });
}

// ─── Section-Aware Boundaries ─────────────────────────────────────────────────

/** The plain-text marker `extractTextFromMarkdown` produces for ATX headers. */
const MD_SECTION_MARKER_REGEX = /^Section: .+$/;

/**
 * A numbered or "Chapter N" heading, e.g. "1. Getting Started", "1.2.3 Setup",
 * "Chapter 4: Tools". No upper bound on the heading text's length beyond what
 * a single line already implies (segments spanning multiple lines are
 * rejected before this regex ever runs, in isSectionHeading) — a long,
 * mixed-case numbered heading is still a heading, and capping length here
 * only pushed it into BARE_TITLE_REGEX, which requires every word
 * capitalized and would reject it anyway.
 */
const NUMBERED_HEADING_REGEX = /^(?:\d+(?:\.\d+)*\.?|Chapter\s+\d+:?)\s+\S.{1,300}$/;

/**
 * A short run of 2-8 words that are EACH capitalized (Title Case) or
 * ALL-CAPS — e.g. "Advanced Usage", "PRICING TIERS". Deliberately requires
 * *every* word to start capitalized, not just the first: an ordinary prose
 * fragment like "Sentence number 0 about pricing details" (only its first
 * word capitalized, the rest lowercase) must not match, since that shape is
 * exactly what a sentence-level split of ordinary prose produces — only a
 * genuine title reliably capitalizes every word.
 */
const BARE_TITLE_REGEX =
  /^(?:[A-Z][a-z0-9,'&-]*|[A-Z0-9,'&-]{2,})(?:\s+(?:[A-Z][a-z0-9,'&-]*|[A-Z0-9,'&-]{2,}|a|an|the|of|and|or|for|in|on|to)){1,7}$/;

/**
 * Returns true if `segment` is a single-line section heading, so the chunker
 * can treat it as a hard boundary rather than letting it get merged into the
 * tail of the previous chunk. Excludes anything containing sentence-ending
 * punctuation (a heading doesn't end in ". "/"! "/"? " mid-line) to avoid
 * false positives on short declarative sentences, and requires the bare-title
 * form to be a multi-word phrase so a single-word fragment produced by
 * space-level splitting is never misdetected as a heading.
 * @param segment - A single segment from segmentWithTableAwareness
 * @returns True if this segment should start a new chunk
 */
function isSectionHeading(segment: string): boolean {
  const trimmed = segment.trim();
  if (trimmed.includes('\n')) return false;
  if (MD_SECTION_MARKER_REGEX.test(trimmed) || NUMBERED_HEADING_REGEX.test(trimmed)) return true;

  // The bare-title form (no numbering/marker prefix) is the ambiguous case —
  // a real heading never contains sentence-ending punctuation, so this guard
  // only applies here, not to the numbered/marker forms above (a numbered
  // heading like "1. Getting Started" legitimately contains ". ").
  if (/[.!?]\s/.test(trimmed) || /[.!?]$/.test(trimmed)) return false;
  return BARE_TITLE_REGEX.test(trimmed);
}

/**
 * Extracts the human-readable heading text from a segment already confirmed
 * by isSectionHeading, stripping the "Section: " prefix if present.
 * @param segment - A segment confirmed to be a section heading
 * @returns Heading text for ChunkMetadata.section
 */
function headingText(segment: string): string {
  const trimmed = segment.trim();
  return trimmed.startsWith('Section: ') ? trimmed.slice('Section: '.length) : trimmed;
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
 * @param segments - Ordered, non-overlapping tagged segments from segmentWithTableAwareness
 * @returns One CharSpan per segment, same order and length as `segments`
 */
function resolveSegmentSpans(text: string, segments: TaggedSegment[]): CharSpan[] {
  const spans: CharSpan[] = [];
  let cursor = 0;

  for (const { text: seg } of segments) {
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
 * @param tokenCounts - Pre-computed token count per segment, same order/length
 * @param chunkOverlap - Maximum overlap tokens to carry forward
 * @returns The trailing window to prepend to the next chunk
 */
function buildOverlapWindow(
  segments: string[],
  spans: CharSpan[],
  tokenCounts: number[],
  chunkOverlap: number,
): OverlapWindow {
  const overlapSegs: string[] = [];
  const overlapSpans: CharSpan[] = [];
  let overlapTokens = 0;

  for (let i = segments.length - 1; i >= 0; i--) {
    // Reuse the cached count — avoids re-calling encode() (BPE tokenization)
    // once per segment on every overlap build, which was the 2-4x regression
    // introduced when the codebase replaced the O(1) chars/4 heuristic with
    // real gpt-tokenizer encoding.
    const segTokens = tokenCounts[i] ?? estimateTokenCount(segments[i] ?? '');
    if (overlapTokens + segTokens > chunkOverlap) break;
    overlapSegs.unshift(segments[i] ?? '');
    const span = spans[i];
    if (span) overlapSpans.unshift(span);
    overlapTokens += segTokens;
  }

  return { segs: overlapSegs, spans: overlapSpans, tokens: overlapTokens };
}

/**
 * True if appending one more segment of `segTokens` would push the
 * in-progress chunk over `chunkSize`.
 * @param currentTokens - Tokens already accumulated in the in-progress chunk
 * @param segTokens - Token count of the next candidate segment
 * @param chunkSize - Configured target chunk size
 * @returns Whether the size limit would be exceeded
 */
function currentTokensExceed(currentTokens: number, segTokens: number, chunkSize: number): boolean {
  return currentTokens + segTokens > chunkSize;
}

/**
 * Chooses how much overlap (in tokens) to carry across a chunk boundary.
 * A table/code block is self-contained — a reader never needs the prose
 * immediately before a table to understand the table itself — so carrying
 * normal-sized overlap across that boundary just wastes tokens restating
 * context the next chunk doesn't need. Prose-to-prose boundaries keep the
 * full configured overlap so mid-sentence/mid-idea cuts still get
 * surrounding context. A forced heading boundary starts the next chunk fresh
 * with no overlap — a new section shouldn't open with trailing content from
 * the previous one.
 * @param forceBoundary - True if this flush was triggered by a heading, not a size limit
 * @param lastSegmentTag - Tag of the segment that just filled the flushed chunk
 * @param chunkOverlap - The configured overlap target
 * @returns Overlap tokens to carry into the next chunk
 */
function computeEffectiveOverlap(
  forceBoundary: boolean,
  lastSegmentTag: TaggedSegment['tag'],
  chunkOverlap: number,
): number {
  if (forceBoundary) return 0;
  if (lastSegmentTag === 'table' || lastSegmentTag === 'code') return Math.floor(chunkOverlap / 4);
  return chunkOverlap;
}

/** Mutable in-progress-chunk state threaded through createChunks' main loop. */
interface ChunkBuilderState {
  segments: string[];
  spans: CharSpan[];
  segmentTokens: number[];
  tokens: number;
  /** Section active when this in-progress chunk's first segment was appended. */
  startSection: string | undefined;
  /** Tag of the most recently appended segment — drives dynamic overlap sizing on the next flush. */
  lastSegmentTag: TaggedSegment['tag'];
  /** Most recent heading seen anywhere so far, carried into metadata.section until the next heading. */
  currentSection: string | undefined;
}

/**
 * Flushes the current chunk (if non-empty) and reseeds `state` with the
 * trailing overlap window, so the main loop in createChunks stays a flat
 * per-segment decision (force boundary vs. size limit) instead of also
 * inlining the flush/rebuild mechanics — keeping createChunks' cyclomatic
 * complexity within the project's limit.
 * @param state - Mutable chunk-builder state, updated in place
 * @param chunks - Output array flush() appends completed chunks onto
 * @param forceBoundary - True if this flush was triggered by a heading
 * @param chunkOverlap - The configured overlap target
 */
function flushAndCarryOverlap(
  state: ChunkBuilderState,
  chunks: TextChunk[],
  forceBoundary: boolean,
  chunkOverlap: number,
): void {
  if (state.segments.length === 0) return;

  const content = state.segments.join(' ');
  const charStart = state.spans[0]?.start ?? 0;
  const charEnd = state.spans[state.spans.length - 1]?.end ?? charStart + content.length;

  const metadata: ChunkMetadata = { char_start: charStart, char_end: charEnd };
  if (state.startSection !== undefined) metadata.section = state.startSection;

  chunks.push({
    content,
    index: chunks.length,
    // Re-encode the joined content (a join can differ from summing individual
    // segment token counts because subword boundaries shift at segment joints).
    tokenCount: estimateTokenCountBounded(content),
    metadata,
  });

  const effectiveOverlap = computeEffectiveOverlap(
    forceBoundary,
    state.lastSegmentTag,
    chunkOverlap,
  );
  const { segs, spans, tokens } = buildOverlapWindow(
    state.segments,
    state.spans,
    state.segmentTokens,
    effectiveOverlap,
  );
  state.segments = segs;
  state.spans = spans;
  // Slice the cached token counts to match the kept overlap segments.
  state.segmentTokens = state.segmentTokens.slice(state.segmentTokens.length - segs.length);
  state.tokens = tokens;
  state.startSection = state.currentSection;
}

/**
 * Processes one tagged segment against the in-progress chunk: flushes and
 * carries overlap if the segment would overflow the chunk (either by size or
 * by being a heading that forces a boundary), then appends the segment.
 * Extracted from createChunks' loop body so the loop itself stays a single
 * call — inlining this logic pushed createChunks over the project's
 * cyclomatic-complexity limit.
 * @param state - Mutable chunk-builder state, updated in place
 * @param chunks - Output array completed chunks are appended onto
 * @param taggedSegment - The segment being processed this iteration
 * @param span - The segment's resolved character span in the source text
 * @param chunkSize - Configured target chunk size
 * @param chunkOverlap - Configured overlap target
 */
function appendSegment(
  state: ChunkBuilderState,
  chunks: TextChunk[],
  taggedSegment: TaggedSegment,
  span: CharSpan,
  chunkSize: number,
  chunkOverlap: number,
): void {
  const segment = taggedSegment.text;
  const segTokens = estimateTokenCount(segment);

  // A heading is a hard boundary: never let it get absorbed into the tail of
  // the previous chunk, so metadata.section always reflects the section a
  // chunk's content actually came from rather than the one that happened to
  // precede it. Only forces a flush if the current chunk already has content
  // — a heading as the very first segment just starts the (only) chunk normally.
  const forceBoundary = taggedSegment.tag === 'heading' && state.segments.length > 0;

  if (
    (forceBoundary || currentTokensExceed(state.tokens, segTokens, chunkSize)) &&
    state.segments.length > 0
  ) {
    flushAndCarryOverlap(state, chunks, forceBoundary, chunkOverlap);
  }

  if (taggedSegment.tag === 'heading') {
    state.currentSection = headingText(segment);
  }
  if (state.segments.length === 0) state.startSection = state.currentSection;
  state.lastSegmentTag = taggedSegment.tag;

  state.segments.push(segment);
  state.spans.push(span);
  state.segmentTokens.push(segTokens);
  state.tokens += segTokens;
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

  const segments = segmentWithTableAwareness(text, separator, chunkSize);
  const segmentSpans = resolveSegmentSpans(text, segments);

  const chunks: TextChunk[] = [];
  // Parallel token-count cache lives on `state.segmentTokens`: holds the BPE
  // token count for each of state.segments, computed once when the segment
  // is first pushed. Avoids re-calling estimateTokenCount (which runs
  // gpt-tokenizer's encode()) in buildOverlapWindow and flushAndCarryOverlap,
  // where the same count is needed again but the segment text hasn't changed.
  const state: ChunkBuilderState = {
    segments: [],
    spans: [],
    segmentTokens: [],
    tokens: 0,
    startSection: undefined,
    lastSegmentTag: null,
    currentSection: undefined,
  };

  for (let i = 0; i < segments.length; i++) {
    const taggedSegment = segments[i] ?? { text: '', tag: null };
    const span = segmentSpans[i] ?? { start: 0, end: 0 };
    appendSegment(state, chunks, taggedSegment, span, chunkSize, chunkOverlap);
  }

  flushAndCarryOverlap(state, chunks, false, chunkOverlap);

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

/** Matches a line that is only a page-number artifact — "3", "Page 3", "Page 3 of 12", "- 3 -". */
const PAGE_NUMBER_LINE_REGEX = /^(?:page\s+)?\d{1,4}(?:\s+of\s+\d{1,4})?$|^-\s*\d{1,4}\s*-$/i;

/** A candidate noise line is short enough to plausibly be a header/footer, not body prose. */
const MAX_NOISE_LINE_LENGTH = 80;

/**
 * Minimum fraction of a document's pages a short line must repeat across
 * (verbatim) before it's treated as a running header/footer rather than a
 * real short sentence that happens to recur (e.g. a repeated warning
 * callout). `pdf-parse` has no page-boundary markers in its plain-text
 * output, so "pages" here is approximated as the document split into
 * roughly-equal-sized blocks — good enough to distinguish "appears on
 * most pages" from "appears once or twice."
 */
const MIN_REPEAT_FRACTION = 0.4;

/** Below this many blocks, repetition-based detection is too noisy on a short document to trust — skip it entirely. */
const MIN_BLOCKS_FOR_REPEAT_DETECTION = 4;

/**
 * Strips running headers/footers and page-number artifacts that `pdf-parse`
 * concatenates into the plain-text output once per page. Two independent
 * signals are used: (1) a line matching a page-number shape ("Page 3 of 12",
 * "- 3 -") is always dropped, regardless of frequency; (2) a short line
 * (≤ MAX_NOISE_LINE_LENGTH chars) that recurs verbatim across at least
 * MIN_REPEAT_FRACTION of the document's approximate "pages" is dropped as a
 * running header/footer (e.g. a document title repeated on every page, a
 * "Confidential — Internal Use Only" footer). A short line that only
 * appears once or twice is left alone — that's normal body content
 * (a heading, a short standalone sentence), not page furniture.
 * @param text - Raw extracted text, already normalised to '\n' line endings
 * @returns Text with detected header/footer/page-number noise removed
 */
export function stripHeaderFooterNoise(text: string): string {
  const lines = text.split('\n');
  const nonEmptyLines = lines.filter((l) => l.trim().length > 0);

  // Approximate "pages" as fixed-size blocks of non-empty lines — pdf-parse's
  // plain-text output carries no page-boundary markers to split on directly.
  const approxLinesPerPage = 40;
  const approxPageCount = Math.max(1, Math.ceil(nonEmptyLines.length / approxLinesPerPage));

  const candidateCounts = new Map<string, number>();
  if (approxPageCount >= MIN_BLOCKS_FOR_REPEAT_DETECTION) {
    for (const rawLine of nonEmptyLines) {
      const line = rawLine.trim();
      if (line.length === 0 || line.length > MAX_NOISE_LINE_LENGTH) continue;
      candidateCounts.set(line, (candidateCounts.get(line) ?? 0) + 1);
    }
  }

  const repeatThreshold = approxPageCount * MIN_REPEAT_FRACTION;
  const isRunningHeaderFooter = (trimmed: string): boolean =>
    approxPageCount >= MIN_BLOCKS_FOR_REPEAT_DETECTION &&
    (candidateCounts.get(trimmed) ?? 0) >= repeatThreshold &&
    (candidateCounts.get(trimmed) ?? 0) >= 3; // never flag on a tiny doc where the fraction math degenerates

  return lines
    .filter((rawLine) => {
      const trimmed = rawLine.trim();
      if (trimmed.length === 0) return true; // preserve blank lines (paragraph structure)
      if (PAGE_NUMBER_LINE_REGEX.test(trimmed)) return false;
      if (isRunningHeaderFooter(trimmed)) return false;
      return true;
    })
    .join('\n');
}

/**
 * Extracts plain text from a PDF file buffer using pdf-parse.
 * @param buffer - Raw PDF file bytes
 * @returns Extracted text with normalised line endings, headers/footers/page numbers stripped
 * @throws {ChunkingError} If the buffer cannot be parsed as a PDF
 */
export async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  try {
    const { default: pdfParse } = await import('pdf-parse');
    const result = await pdfParse(buffer);
    const normalised = result.text.replace(/\r\n/g, '\n').trim();
    return sanitizeExtractedText(stripHeaderFooterNoise(normalised));
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
 * Strips Markdown syntax that carries no useful signal once flattened to plain
 * text (links, images, emphasis markers) while preserving syntax that carries
 * structure a chunk-splitter or reader can still use: ATX headers become a
 * plain-text "Section: " prefix instead of vanishing (so a chunk boundary can
 * still be drawn on section starts, and a reader can still tell a heading from
 * body text), fenced code blocks keep their content wrapped in `[CODE]`/
 * `[/CODE]` markers instead of being deleted outright, and list markers are
 * kept (as `- ` / `1. `) instead of stripped, so a numbered procedure doesn't
 * collapse into indistinguishable lines. Links/images/emphasis are still
 * flattened to their display text since the markup itself adds no retrievable
 * meaning once chunked.
 * @param text - Raw Markdown source
 * @returns Plain text with structural cues preserved as plain-text markers
 */
export function extractTextFromMarkdown(text: string): string {
  if (text.trim().length === 0) return '';

  return text
    .replace(
      /```(\w*)\n([\s\S]*?)```/g,
      (_m, _lang: string, code: string) => `[CODE]\n${code.trim()}\n[/CODE]`,
    ) // fenced code blocks — keep content
    .replace(/`([^`]+)`/g, '$1') // inline code → plain text
    .replace(/^(#{1,6})\s+(.+)$/gm, 'Section: $2') // ATX headers → plain-text section marker
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1') // images → alt text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → link text
    .replace(/[*_]{1,2}([^*_\n]+)[*_]{1,2}/g, '$1') // bold / italic
    .replace(/^[-*+]\s+/gm, '- ') // bullet list markers → normalised '- '
    .replace(/^>\s+/gm, '') // blockquotes
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n') // collapse blank lines
    .trim();
}

/**
 * Minimal HTML entity decode covering the handful of entities that actually
 * appear in real-world documents — not a full HTML5 entity table, since a
 * knowledge-base upload is prose/documentation, not an arbitrary web page
 * exercising the full entity set.
 * @param text - Text containing HTML entities
 * @returns Text with common entities decoded to their literal characters
 */
function decodeCommonHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…');
}

/**
 * Strips HTML markup down to plain text, preserving the same structural
 * conventions `extractTextFromMarkdown` uses so downstream chunking (section-
 * aware boundaries, table detection) treats HTML-sourced and Markdown-sourced
 * documents uniformly: `<h1>`-`<h6>` become "Section: " markers, `<table>`
 * rows become newline-separated cell rows(picked up by the whitespace-table
 * detector in segmentWithTableAwareness), and block-level elements (`<p>`,
 * `<div>`, `<li>`, `<br>`) become line breaks so content doesn't collapse
 * into one run-on line. `<script>`/`<style>` contents are dropped entirely —
 * never indexed, since it's code/CSS, not document content. This is a plain
 * regex stripper, not a real HTML/DOM parser — it will not handle malformed
 * markup or deeply nested layout tables gracefully, but a knowledge-base
 * upload is expected to be reasonably well-formed prose/documentation, not
 * an arbitrary scraped web page.
 * @param html - Raw HTML source
 * @returns Plain text with structural cues preserved as plain-text markers
 */
export function extractTextFromHtml(html: string): string {
  if (html.trim().length === 0) return '';

  let sanitizedHtml = html;
  let previous: string;
  // Repeatedly strip script, style, and comments to handle nested/malformed markup
  do {
    previous = sanitizedHtml;
    sanitizedHtml = sanitizedHtml
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');
  } while (sanitizedHtml !== previous);

  return sanitizedHtml
    .replace(
      /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi,
      (_m, inner: string) => `\nSection: ${inner.replace(/<[^>]+>/g, '').trim()}\n`,
    )
    .replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (_m, inner: string) => {
      const cells = [...inner.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
        (c[1] ?? '').replace(/<[^>]+>/g, '').trim(),
      );
      return `\n${cells.join('   ')}\n`; // 3-space gap — matches splitWhitespaceAlignedCells' 2+-space cell delimiter
    })
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, '') // strip all remaining tags
    .split('\n')
    .map((line) => decodeCommonHtmlEntities(line).trim())
    .join('\n')
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
    case 'html':
      return extractTextFromHtml(buffer.toString('utf-8'));
    default: {
      const exhaustive: never = fileType;
      throw new ChunkingError(
        `Unsupported file type: ${String(exhaustive)}`,
        ChunkingErrorCode.UNSUPPORTED_FORMAT,
      );
    }
  }
}
