/**
 * @file citationMarkers.ts
 * @description Shared citation-marker recognition — the superscript-glyph range
 *   and [N]-bracket notation the LLM's answer text can use to cite a source,
 *   plus the char-code arithmetic to convert a superscript glyph to its number.
 *   Single source of truth so a future change to the marker glyph/range or
 *   citation count ceiling only needs to happen in one place.
 * @author [Author Placeholder]
 * @created 2026-07-23
 */

/**
 * Matches a citation marker: either a Unicode circled-digit superscript
 * (①–⑩, U+2460–U+2469) or bracket notation ([1]–[N]). Capture group 1 is the
 * superscript glyph itself (when matched); capture group 2 is the digits
 * inside a bracket marker (when matched).
 */
export const CITATION_MARKER_REGEX = /([①-⑩]|\[(\d+)\])/g;

/** First code point in the circled-digit superscript range (①). */
const SUPERSCRIPT_BASE_CODE = 0x2460;

/**
 * Converts a single circled-digit superscript glyph (①, ②, …) to its 1-based
 * citation number.
 * @param glyph - A single superscript character in the ①–⑩ range
 * @returns The citation number the glyph represents
 */
export function superscriptToNumber(glyph: string): number {
  return glyph.charCodeAt(0) - SUPERSCRIPT_BASE_CODE + 1;
}

/**
 * Normalizes all citation markers in a string to `[N]` bracket notation —
 * converts any Unicode superscript markers and leaves existing `[N]` markers
 * as-is.
 * @param text - Text potentially containing superscript and/or bracket markers
 * @returns Text with every citation marker in `[N]` form
 */
export function normalizeCitationMarkers(text: string): string {
  return text.replace(/[①-⑩]/g, (glyph) => `[${superscriptToNumber(glyph)}]`);
}
