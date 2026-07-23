/**
 * @file formatAnswerMarkdown.ts
 * @description Formats a chat answer and its citations as clean Markdown
 *   for clipboard export
 * @author [Author Placeholder]
 * @created 2026-07-01
 */

import { normalizeCitationMarkers } from './citationMarkers';

/**
 * Citation data structure for formatting.
 */
export interface Citation {
  /** Citation index number */
  index: number;
  /** Source document filename */
  filename: string;
  /** Chunk index in the document */
  chunkIndex: number;
  /** Semantic similarity score (0-1) */
  similarity: number;
}

/**
 * Options for formatting an answer with citations.
 */
export interface FormatOptions {
  /** The answer text content */
  answerText: string;
  /** Array of citations to format as footnotes */
  citations: Citation[];
}

/**
 * Converts a RAG answer with citations into clipboard-ready Markdown.
 * Inline superscript citation markers (①②③ or [1][2][3]) are
 * normalised to [N] footnote style.
 * @param options - Answer text and citation array
 * @returns Formatted Markdown string
 */
export function formatAnswerMarkdown(options: FormatOptions): string {
  const { answerText, citations } = options;

  const normalizedText = normalizeCitationMarkers(answerText);

  // If no citations, return just the answer text
  if (citations.length === 0) {
    return normalizedText;
  }

  // Build the Sources section
  const sourcesSection = citations
    .map(
      (c) =>
        `[${c.index}] ${c.filename} · Chunk ${c.chunkIndex} · Similarity: ${Math.round(c.similarity * 100)}%`
    )
    .join('\n');

  return `${normalizedText}\n\n---\n\nSources:\n${sourcesSection}`;
}

/**
 * Writes text to the system clipboard using the Clipboard API,
 * falling back to document.execCommand for older browsers.
 * @param text - Text to copy
 * @returns Promise resolving to true on success, false on failure
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    // Try modern Clipboard API first
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }

    // Fallback for older browsers
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);

    return successful;
  } catch {
    // Silently fail - the caller will handle showing a toast
    return false;
  }
}
