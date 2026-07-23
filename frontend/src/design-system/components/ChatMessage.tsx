/**
 * @file ChatMessage.tsx
 * @description Chat message component — Lab Notebook theme.
 *   User messages: right-aligned, card bg, hairline border.
 *   Assistant messages: left-aligned, 4px archive green left border (librarian margin note).
 *   Citations render as CitationChip badges + IndexCard grid below the message.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import React, { useState, useCallback } from 'react';
import { ClipboardIcon as Clipboard, Check } from 'lucide-react';
import { StreamingCursor } from './StreamingCursor';
import { CitationChip } from './CitationChip';
import { IndexCard } from './IndexCard';
import { formatAnswerMarkdown, copyToClipboard, type Citation as FormatCitation } from '../../utils/formatAnswerMarkdown';
import { useAppToast } from '../../contexts/ToastContext';

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
}

export interface ChatMessageProps {
  /** Determines layout and styling. */
  role: 'user' | 'assistant';
  /** Message text content (may be partial during streaming). */
  content: string;
  /** When true, renders the streaming cursor at the end of content. */
  streaming?: boolean;
  /** Citations to render after the message body (assistant only). */
  citations?: ChatCitation[];
  /** ISO-8601 timestamp string. */
  timestamp?: string;
  /** Additional CSS classes on the root element. */
  className?: string;
}

const formatTime = (iso?: string): string => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

/**
 * Single message in the chat interface.
 * @param role       - 'user' | 'assistant'
 * @param content    - Text body of the message
 * @param streaming  - When true, appends blinking cursor
 * @param citations  - Array of source citations (assistant only)
 * @param timestamp  - ISO-8601 message time
 */
function ChatMessageImpl({
  role,
  content,
  streaming = false,
  citations = [],
  timestamp,
  className = '',
}: ChatMessageProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const toast = useAppToast();

  const handleCopy = useCallback(async () => {
    // Convert ChatCitation to FormatCitation
    const formatCitations: FormatCitation[] = citations.map((c, i) => {
      const parsed = parseInt(c.chunkRef.replace(/\D/g, ''), 10);
      return {
        index: i + 1,
        filename: c.documentName,
        chunkIndex: c.chunkIndex ?? (Number.isNaN(parsed) ? i + 1 : parsed),
        similarity: c.relevanceScore,
      };
    });

    const markdownText = formatAnswerMarkdown({ answerText: content, citations: formatCitations });
    const success = await copyToClipboard(markdownText);

    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } else {
      toast.toast('Copy failed — try selecting text manually', {
        variant: 'error',
      });
    }
  }, [content, citations, toast]);

  // ── User message ──────────────────────────────────────────────────────────
  if (role === 'user') {
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

  // ── Assistant message — librarian margin note style ───────────────────────
  return (
    <div data-testid="assistant-message" className={`flex justify-start ${className}`} role="listitem">
      <div className="max-w-[90%] group w-full">

        {/* Message body with archive green left border */}
        <div className="relative pl-ds-4 border-l-4 border-ds-archive">
          {/* Copy button — only on completed assistant messages, visible on hover */}
          {!streaming && (
            <button
              type="button"
              onClick={handleCopy}
              aria-label={copied ? 'Copied to clipboard' : 'Copy answer as Markdown'}
              className="
                absolute top-2 right-2
                opacity-0 group-hover:opacity-100
                w-7 h-7 flex items-center justify-center
                bg-transparent border border-ds-hairline rounded-[2px]
                text-ds-text-muted hover:text-ds-text-primary hover:border-ds-base
                transition-opacity duration-150
                focus-visible:opacity-100
              "
              style={{
                borderColor: copied ? '#2D5A4A' : undefined,
                color: copied ? '#2D5A4A' : undefined,
              }}
            >
              {copied ? (
                <Check size={14} aria-hidden="true" />
              ) : (
                <Clipboard size={14} aria-hidden="true" />
              )}
              {/* Tooltip */}
              <span
                className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap"
                style={{
                  fontFamily: "'Space Mono', monospace",
                  fontSize: '10px',
                  background: '#1C1B19',
                  color: '#F7F5F0',
                  padding: '3px 8px',
                  borderRadius: '2px',
                  pointerEvents: 'none',
                }}
                aria-hidden="true"
              >
                {copied ? 'Copied!' : 'Copy as Markdown'}
              </span>
            </button>
          )}

          {/* Message text */}
          <p className="text-ds-base font-body text-ds-text-primary leading-ds-relaxed whitespace-pre-wrap pr-6">
            {content}
            {streaming && <StreamingCursor active />}
          </p>

          {/* Inline citation badge row — superscript numbers above the IndexCards */}
          {citations.length > 0 && (
            <div
              className="flex flex-wrap gap-ds-3 mt-ds-3 pt-ds-2 border-t border-ds-hairline"
              aria-label="Source citations"
            >
              {citations.map((c, i) => (
                <CitationChip
                  key={c.id}
                  documentName={c.documentName}
                  chunkRef={c.chunkRef}
                  relevanceScore={c.relevanceScore}
                  fullText={c.fullText}
                  index={i}
                />
              ))}
            </div>
          )}
        </div>

        {/* IndexCard grid — one card per citation */}
        {citations.length > 0 && (
          <div
            className="mt-ds-4 grid gap-ds-3"
            style={{
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            }}
            aria-label="Retrieved source cards"
          >
            {citations.map((c, i) => (
              <IndexCard
                key={c.id}
                documentName={c.documentName}
                chunkText={c.fullText ?? c.chunkRef}
                relevanceScore={c.relevanceScore}
                chunkRef={c.chunkRef}
                index={i}
              />
            ))}
          </div>
        )}

        {timestamp && (
          <p className="text-ds-xs font-mono text-ds-text-muted mt-1">
            {formatTime(timestamp)}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Shallow-by-value comparison of two citation arrays. The parent
 * (Chat.tsx) rebuilds this array with a fresh `.map(...)` on every render,
 * so a reference check would always report "changed" — comparing length
 * and each field instead lets equivalent-content arrays count as equal.
 * @param a - Previous citations array
 * @param b - Next citations array
 * @returns True if the arrays are equivalent in content
 */
function citationsEqual(a: ChatCitation[], b: ChatCitation[]): boolean {
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

/**
 * Custom equality check for `React.memo`. The parent list re-renders every
 * message component on each SSE token of the currently streaming message,
 * re-creating the `citations` array as a new reference each time even for
 * unrelated, already-completed messages. A default shallow-props
 * comparator would therefore never skip a re-render. This comparator
 * compares by value instead, so completed messages skip re-rendering while
 * the actively streaming message (whose `content`/`streaming` props
 * genuinely change) still re-renders every token.
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
    prev.streaming === next.streaming &&
    prev.timestamp === next.timestamp &&
    prev.className === next.className &&
    citationsEqual(prev.citations ?? [], next.citations ?? [])
  );
}

/**
 * Memoized export — see `areChatMessagePropsEqual` for why a custom
 * comparator (rather than the React.memo default) is required here.
 */
export const ChatMessage = React.memo(ChatMessageImpl, areChatMessagePropsEqual);
