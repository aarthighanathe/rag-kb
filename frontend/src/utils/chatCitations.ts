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
  };
}
