/**
 * @file ChatMessage.tsx
 * @description User chat message component — Lab Notebook theme.
 *   Right-aligned, card bg, hairline border. Assistant messages are rendered
 *   by AssistantMessage.tsx instead (citation highlighting, IndexCard grid,
 *   confidence bar, etc. — behavior this component does not need for the
 *   simple user-message case).
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import React from 'react';
import { formatMessageTime as formatTime } from '../../utils/formatMessageTime';

export interface ChatCitation {
  /** Unique key for the citation. */
  id: string;
  /** Source document filename. */
  documentName: string;
  /** Chunk / page reference. */
  chunkRef: string;
  /** Semantic relevance 0-1. */
  relevanceScore: number;
  /** Full chunk text for expansion. */
  fullText?: string;
  /** Chunk index for export formatting. */
  chunkIndex?: number;
  /**
   * 1-based citation number matching the `[N]` marker the model actually
   * emitted in its answer text — distinct from array position, which shifts
   * once uncited/hallucinated entries are filtered out server-side.
   */
  citationNumber: number;
}

export interface ChatMessageProps {
  /**
   * Kept as a discriminant (rather than dropped) so existing call sites that
   * narrow a wider `'user' | 'assistant'` role (e.g. Chat.tsx's
   * `if (msg.role === 'assistant') {...} else {...}`) type-check unchanged.
   * Assistant rendering itself lives in AssistantMessage.tsx.
   */
  role: 'user';
  /** Message text content. */
  content: string;
  /** ISO-8601 timestamp string. */
  timestamp?: string;
  /** Additional CSS classes on the root element. */
  className?: string;
}

/**
 * User message bubble in the chat interface — right-aligned, card
 * background, hairline border.
 * @param content   - Text body of the message
 * @param timestamp - ISO-8601 message time
 */
function ChatMessageImpl({
  content,
  timestamp,
  className = '',
}: ChatMessageProps): React.JSX.Element {
  return (
    <div data-testid="user-message" className={`flex justify-end ${className}`} role="listitem">
      <div className="max-w-[75%]">
        <div className="bg-ds-card border border-ds-hairline rounded-[2px] px-ds-4 py-ds-3">
          <p className="text-ds-base font-body text-ds-text-primary leading-ds-relaxed whitespace-pre-wrap">
            {content}
          </p>
        </div>
        {timestamp && (
          <p className="text-ds-xs font-mono text-ds-text-muted mt-1 text-right">
            {formatTime(timestamp)}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Custom equality check for `React.memo`. Cheap value comparison (no
 * citations to compare — user messages never carry any) so the list-level
 * memoization introduced for AssistantMessage extends consistently to user
 * messages too.
 * @param prev - Props from the previous render
 * @param next - Props for the candidate next render
 * @returns True if rendering can be skipped (props are equivalent)
 */
function areChatMessagePropsEqual(
  prev: Readonly<ChatMessageProps>,
  next: Readonly<ChatMessageProps>,
): boolean {
  return (
    prev.role === next.role &&
    prev.content === next.content &&
    prev.timestamp === next.timestamp &&
    prev.className === next.className
  );
}

/**
 * Memoized export — see `areChatMessagePropsEqual` for why a custom
 * comparator (rather than the React.memo default) is required here.
 */
export const ChatMessage = React.memo(ChatMessageImpl, areChatMessagePropsEqual);
