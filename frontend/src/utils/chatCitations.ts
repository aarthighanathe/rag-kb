/**
 * @file chatCitations.ts
 * @description Converts a store Citation into the ChatCitation shape rendered by
 *   ChatMessage/AssistantMessage on the Chat page.
 * @author [Author Placeholder]
 * @created 2026-08-24
 */

import type { Citation } from '../stores/ragStore';
import type { ChatCitation } from '../design-system/components/ChatMessage';

/**
 * Converts a store Citation into the ChatCitation shape used by chat message components.
 * @param c - Citation as stored in the RAG store
 * @returns Equivalent ChatCitation for rendering
 */
export function toChatCitation(c: Citation): ChatCitation {
  return {
    id: c.chunkId,
    documentName: c.documentName,
    chunkRef: c.chunkRef,
    relevanceScore: c.similarity,
    fullText: c.excerpt,
    citationNumber: c.citationNumber,
  };
}

/**
 * Shallow-by-value comparison of two citation arrays. Chat.tsx rebuilds the
 * `citations` array with a fresh `.map(toChatCitation)` on every render, so a
 * reference check would always report "changed" even when nothing meaningful
 * did. Used by AssistantMessage's `React.memo` comparator so completed
 * messages skip re-rendering (and re-parsing their Markdown) while an
 * unrelated message streams.
 * @param a - Previous citations array
 * @param b - Next citations array
 * @returns True if the arrays are equivalent in content
 */
export function citationsEqual(a: ChatCitation[], b: ChatCitation[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((citation, i) => {
    const other = b[i];
    return (
      other !== undefined &&
      citation.id === other.id &&
      citation.documentName === other.documentName &&
      citation.chunkRef === other.chunkRef &&
      citation.relevanceScore === other.relevanceScore &&
      citation.fullText === other.fullText &&
      citation.chunkIndex === other.chunkIndex
    );
  });
}
