/**
 * @file AssistantMessage.tsx
 * @description Assistant message wrapper with citation highlight coordination.
 *   Manages bidirectional highlight state between inline citation markers
 *   and their corresponding IndexCards. State is scoped per message.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import React, { useState, useCallback, useMemo, useEffect, type ComponentPropsWithoutRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { ClipboardIcon as Clipboard, Check, ThumbsUp, ThumbsDown } from 'lucide-react';
import { StreamingCursor } from './StreamingCursor';
import { IndexCard } from './IndexCard';
import { ConfidenceBar } from './ConfidenceBar';
import { RelevanceTimeline } from './RelevanceTimeline';
import { ReQueryButtons } from './ReQueryButtons';
import type { MessageFeedback } from '../../stores/ragStore';
import { useCitationHighlight } from '../../hooks/useCitationHighlight';
import { useChatLayout } from '../../contexts/ChatLayoutContext';
import { parseCitationText } from '../../utils/parseCitationText';
import { formatAnswerMarkdown, copyToClipboard, type Citation as FormatCitation } from '../../utils/formatAnswerMarkdown';
import { useAppToast } from '../../contexts/ToastContext';
import type { ChatCitation } from './ChatMessage';

/** Maximum number of IndexCards visible before "+ N more" link */
const MAX_VISIBLE_CARDS = 3;

export interface AssistantMessageProps {
  /** Message content text */
  content: string;
  /** Citations to render below the message */
  citations: ChatCitation[];
  /** Whether the message is currently streaming */
  isStreaming?: boolean;
  /** ISO-8601 timestamp string */
  timestamp?: string;
  /** Message index for data-testid */
  messageIndex?: number;
  /** Original query text for re-query buttons */
  sourceQuery?: string;
  /** Callback when a re-query variant is clicked */
  onReQuery?: (query: string) => void;
  /**
   * query_logs row id for this answer, from the SSE complete event. Absent
   * (undefined/null) when the query failed to log server-side, when the
   * message predates this feature, or while the message is still streaming —
   * in all of these cases the feedback buttons are not rendered at all,
   * since there's nothing to submit feedback against yet.
   */
  queryLogId?: string | null;
  /** The user's current rating for this answer, if any (reflects prior submissions on revisit). */
  feedback?: MessageFeedback | null;
  /** Called when the user clicks a rating button. Only invoked when queryLogId is present. */
  onFeedback?: (feedback: MessageFeedback) => void;
}

const formatTime = (iso?: string): string => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

interface MarkdownCitationState {
  activeCitation: number | null;
  handlers: import('../../utils/parseCitationText').ParseCitationTextHandlers;
}

/**
 * Carries citation highlight state into the memoized ReactMarkdown tree.
 * Kept as context (not props baked into `components`) so hovering a citation
 * only re-renders CitationText leaves, not the whole markdown output — a
 * `components` object that changes identity on every hover would otherwise
 * give ReactMarkdown a new prop reference each render and force it to
 * discard and rebuild its entire rendered subtree.
 */
const MarkdownCitationContext = React.createContext<MarkdownCitationState>({
  activeCitation: null,
  handlers: { onEnter: () => {}, onLeave: () => {}, onClick: () => {} },
});

/**
 * Renders markdown-element children with citation markers ([N]) turned into
 * interactive CitationMarker components. String children are parsed for
 * citation markers; element children (bold, italic, links, etc.) pass through.
 * @param children - React children from a ReactMarkdown element renderer
 */
function CitationText({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { activeCitation, handlers } = React.useContext(MarkdownCitationContext);
  return (
    <>
      {React.Children.map(children, (child, i) =>
        typeof child === 'string'
          ? React.createElement(
              React.Fragment,
              { key: `citation-text-${i}` },
              ...parseCitationText(child, activeCitation, handlers, false),
            )
          : child,
      )}
    </>
  );
}

interface FeedbackButtonsProps {
  feedback: MessageFeedback | null;
  onFeedback: (feedback: MessageFeedback) => void;
}

/**
 * "Was this helpful?" thumbs up/down pair. One active choice at a time —
 * clicking the already-active option is a no-op (there's no "clear rating"
 * interaction; resubmitting the same value would just be a wasted round trip).
 * Visual language matches the copy button / confidence bar: Space Mono
 * labels, archive green (#2D5A4A) for the active "helpful" state, stamp red
 * (#FF4D2E) for the active "not helpful" state (consistent with how red
 * marks low-confidence elsewhere in this component), hairline borders.
 */
function FeedbackButtons({ feedback, onFeedback }: FeedbackButtonsProps): React.JSX.Element {
  const handleClick = useCallback(
    (value: MessageFeedback) => {
      if (feedback === value) return; // already selected — one active choice at a time
      onFeedback(value);
    },
    [feedback, onFeedback],
  );

  const baseButtonStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    fontFamily: "'Space Mono', monospace",
    fontSize: '10px',
    letterSpacing: '0.02em',
    padding: '4px 10px',
    borderRadius: '2px',
    border: '1px solid #D8D4C8',
    background: 'transparent',
    color: '#8A8578',
    cursor: 'pointer',
    transition: 'all 150ms ease',
  };

  const helpfulActive = feedback === 'helpful';
  const notHelpfulActive = feedback === 'not_helpful';

  return (
    <div
      className="mt-ds-3 flex items-center gap-2"
      role="group"
      aria-label="Rate this answer"
    >
      <span
        style={{
          fontFamily: "'Space Mono', monospace",
          fontSize: '10px',
          color: '#8A8578',
          letterSpacing: '0.02em',
        }}
      >
        Helpful?
      </span>
      <button
        type="button"
        onClick={() => handleClick('helpful')}
        aria-pressed={helpfulActive}
        aria-label={helpfulActive ? 'Marked as helpful' : 'Mark as helpful'}
        style={{
          ...baseButtonStyle,
          borderColor: helpfulActive ? '#2D5A4A' : '#D8D4C8',
          background: helpfulActive ? 'rgba(45,90,74,0.08)' : 'transparent',
          color: helpfulActive ? '#2D5A4A' : '#8A8578',
        }}
        onMouseEnter={(e) => {
          if (!helpfulActive) {
            (e.currentTarget as HTMLButtonElement).style.borderColor = '#1C1B19';
            (e.currentTarget as HTMLButtonElement).style.color = '#1C1B19';
          }
        }}
        onMouseLeave={(e) => {
          if (!helpfulActive) {
            (e.currentTarget as HTMLButtonElement).style.borderColor = '#D8D4C8';
            (e.currentTarget as HTMLButtonElement).style.color = '#8A8578';
          }
        }}
      >
        <ThumbsUp size={12} aria-hidden="true" />
        Yes
      </button>
      <button
        type="button"
        onClick={() => handleClick('not_helpful')}
        aria-pressed={notHelpfulActive}
        aria-label={notHelpfulActive ? 'Marked as not helpful' : 'Mark as not helpful'}
        style={{
          ...baseButtonStyle,
          borderColor: notHelpfulActive ? '#FF4D2E' : '#D8D4C8',
          background: notHelpfulActive ? 'rgba(255,77,46,0.08)' : 'transparent',
          color: notHelpfulActive ? '#FF4D2E' : '#8A8578',
        }}
        onMouseEnter={(e) => {
          if (!notHelpfulActive) {
            (e.currentTarget as HTMLButtonElement).style.borderColor = '#1C1B19';
            (e.currentTarget as HTMLButtonElement).style.color = '#1C1B19';
          }
        }}
        onMouseLeave={(e) => {
          if (!notHelpfulActive) {
            (e.currentTarget as HTMLButtonElement).style.borderColor = '#D8D4C8';
            (e.currentTarget as HTMLButtonElement).style.color = '#8A8578';
          }
        }}
      >
        <ThumbsDown size={12} aria-hidden="true" />
        No
      </button>
    </div>
  );
}

/**
 * Assistant message component with citation-to-source linking.
 * @param content - Message text with citation markers
 * @param citations - Array of source citations
 * @param isStreaming - Whether message is being streamed
 * @param timestamp - Message timestamp
 * @param messageIndex - Index for test ID
 */
function AssistantMessageImpl({
  content,
  citations,
  isStreaming = false,
  timestamp,
  messageIndex,
  sourceQuery,
  onReQuery,
  queryLogId,
  feedback,
  onFeedback,
}: AssistantMessageProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const [showAllCards, setShowAllCards] = useState(false);
  const toast = useAppToast();

  // Citation highlight state (scoped per message)
  const localHighlight = useCitationHighlight();
  const layout = useChatLayout();

  // In split-screen mode, use context-level citation handlers for cross-panel sync
  const activeCitation = layout.splitScreenEnabled ? layout.activeCitation : localHighlight.activeCitation;
  const onCitationEnter = layout.splitScreenEnabled ? layout.onCitationEnter : localHighlight.onCitationEnter;
  const onLeave = layout.splitScreenEnabled ? layout.onCitationLeave : localHighlight.onLeave;
  const onCitationClick = layout.splitScreenEnabled ? layout.onCitationClick : localHighlight.onCitationClick;
  const cardRefs = localHighlight.cardRefs;

  const citationContextValue = useMemo<MarkdownCitationState>(
    () => ({
      activeCitation,
      handlers: { onEnter: onCitationEnter, onLeave, onClick: onCitationClick },
    }),
    [activeCitation, onCitationEnter, onLeave, onCitationClick],
  );

  // Deps are all referentially stable (useCallback/context), so this object
  // never changes identity across renders. That matters: ReactMarkdown is a
  // plain (non-memoized) component, so a `components` prop that changes
  // identity on every citation hover would force it to discard and rebuild
  // its entire rendered subtree — dropping hover/focus state before it can
  // ever be observed. Citation state instead flows in via
  // MarkdownCitationContext, read by the CitationText leaf component, so a
  // hover only re-renders that leaf, not the whole markdown tree.
  const markdownComponents = useMemo(
    () => ({
      // Paragraphs — no extra margin between them
      p: ({ children }: ComponentPropsWithoutRef<'p'>) => (
        <p style={{ marginBottom: '0.5em' }}>
          <CitationText>{children}</CitationText>
        </p>
      ),
      // Bold
      strong: ({ children }: ComponentPropsWithoutRef<'strong'>) => (
        <strong style={{ fontWeight: 700, color: 'inherit' }}>{children}</strong>
      ),
      // Italic
      em: ({ children }: ComponentPropsWithoutRef<'em'>) => (
        <em style={{ fontStyle: 'italic' }}>{children}</em>
      ),
      // Ordered list
      ol: ({ children }: ComponentPropsWithoutRef<'ol'>) => (
        <ol style={{ paddingLeft: '1.5em', marginBottom: '0.5em', listStyleType: 'decimal' }}>{children}</ol>
      ),
      // Unordered list
      ul: ({ children }: ComponentPropsWithoutRef<'ul'>) => (
        <ul style={{ paddingLeft: '1.5em', marginBottom: '0.5em', listStyleType: 'disc' }}>{children}</ul>
      ),
      // List item
      li: ({ children }: ComponentPropsWithoutRef<'li'>) => (
        <li style={{ marginBottom: '0.2em' }}>
          <CitationText>{children}</CitationText>
        </li>
      ),
      // Inline code
      code: ({ children, className }: ComponentPropsWithoutRef<'code'>) =>
        className ? (
          // Fenced code block
          <code
            style={{
              display: 'block',
              background: '#F0EDEA',
              borderRadius: '4px',
              padding: '10px 14px',
              fontFamily: "'Space Mono', monospace",
              fontSize: '12px',
              overflowX: 'auto',
              marginBottom: '0.5em',
            }}
          >{children}</code>
        ) : (
          <code
            style={{
              background: '#F0EDEA',
              borderRadius: '2px',
              padding: '1px 5px',
              fontFamily: "'Space Mono', monospace",
              fontSize: '0.88em',
            }}
          >{children}</code>
        ),
      // Headings
      h1: ({ children }: ComponentPropsWithoutRef<'h1'>) => (
        <h3 style={{ fontWeight: 700, fontSize: '1em', marginBottom: '0.3em', marginTop: '0.8em' }}>{children}</h3>
      ),
      h2: ({ children }: ComponentPropsWithoutRef<'h2'>) => (
        <h3 style={{ fontWeight: 700, fontSize: '1em', marginBottom: '0.3em', marginTop: '0.8em' }}>{children}</h3>
      ),
      h3: ({ children }: ComponentPropsWithoutRef<'h3'>) => (
        <h3 style={{ fontWeight: 700, fontSize: '1em', marginBottom: '0.3em', marginTop: '0.8em' }}>{children}</h3>
      ),
      // Blockquote
      blockquote: ({ children }: ComponentPropsWithoutRef<'blockquote'>) => (
        <blockquote
          style={{
            borderLeft: '3px solid #D8D4C8',
            paddingLeft: '1em',
            color: '#8A8578',
            fontStyle: 'italic',
            marginBottom: '0.5em',
          }}
        >{children}</blockquote>
      ),
      // Horizontal rule
      hr: () => <hr style={{ border: 'none', borderTop: '1px solid #D8D4C8', margin: '0.8em 0' }} />,
    }),
    [],
  );

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

  // Register this message's copy handler as "the last message's copy
  // handler" for the chat-level Ctrl+Shift+C shortcut (Chat.tsx's
  // handleCopyLast), so that shortcut can trigger a copy through context
  // instead of querying the DOM for a copy button. `onReQuery` is only ever
  // supplied by Chat.tsx for the last assistant message (same signal
  // ReQueryButtons already relies on below), and only once streaming has
  // finished is there anything meaningful to copy.
  const isLastCompletedMessage = !isStreaming && Boolean(onReQuery);
  const { registerLastMessageCopyHandler } = layout;
  useEffect(() => {
    if (!isLastCompletedMessage) return undefined;
    registerLastMessageCopyHandler(() => { void handleCopy(); });
    return () => registerLastMessageCopyHandler(null);
  }, [isLastCompletedMessage, registerLastMessageCopyHandler, handleCopy]);

  return (
    <div
      data-testid={`assistant-message-${messageIndex ?? 0}`}
      className="flex justify-start"
      role="listitem"
    >
      <div className="max-w-[90%] group w-full">
        {/* Message body with archive green left border */}
        <div className="relative pl-ds-4 border-l-4 border-ds-archive">
          {/* Copy button — only on completed assistant messages, visible on hover */}
          {!isStreaming && (
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

          {/* Message text — markdown rendered on complete, raw during streaming */}
          {isStreaming ? (
            <p className="text-ds-base font-body text-ds-text-primary leading-ds-relaxed whitespace-pre-wrap pr-6">
              {parseCitationText(
                content,
                activeCitation,
                { onEnter: onCitationEnter, onLeave: onLeave, onClick: onCitationClick },
                true,
              )}
              <StreamingCursor active />
            </p>
          ) : (
            <div className="text-ds-base font-body text-ds-text-primary leading-ds-relaxed pr-6 prose-answer">
              <MarkdownCitationContext.Provider value={citationContextValue}>
                <ReactMarkdown components={markdownComponents}>
                  {content}
                </ReactMarkdown>
              </MarkdownCitationContext.Provider>
            </div>
          )}
        </div>

        {/* IndexCard grid — capped at 3 visible, "+ N more" link */}
        {/* Hidden in split-screen mode (cards shown in SourcePanel instead) */}
        {citations.length > 0 && !layout.hideIndexCards && (
          <div
            className="mt-ds-4"
            aria-label="Retrieved source cards"
          >
            <div
              className="grid gap-ds-3"
              style={{
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              }}
            >
              {citations.slice(0, showAllCards ? citations.length : MAX_VISIBLE_CARDS).map((c, i) => (
                <IndexCard
                  key={c.id}
                  documentName={c.documentName}
                  chunkText={c.fullText ?? c.chunkRef}
                  relevanceScore={c.relevanceScore}
                  chunkRef={c.chunkRef}
                  index={i}
                  citationIndex={i + 1}
                  isActive={activeCitation === i + 1}
                  onEnter={onCitationEnter}
                  onLeave={onLeave}
                  cardRef={(el) => cardRefs.current.set(i + 1, el)}
                />
              ))}
            </div>

            {/* "+ N more" link when cards are truncated */}
            {!showAllCards && citations.length > MAX_VISIBLE_CARDS && (
              <button
                type="button"
                onClick={() => setShowAllCards(true)}
                className="mt-ds-2 font-mono text-ds-xs"
                style={{
                  color: '#5C5850',
                  background: 'none',
                  border: 'none',
                  padding: '2px 0',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  textUnderlineOffset: '2px',
                }}
                aria-label={`Show ${citations.length - MAX_VISIBLE_CARDS} more source cards`}
              >
                + {citations.length - MAX_VISIBLE_CARDS} more
              </button>
            )}
          </div>
        )}

        {/* Confidence bar — only on completed messages */}
        {!isStreaming && citations.length > 0 && (
          <ConfidenceBar
            similarities={citations.map((c) => c.relevanceScore)}
            isStreaming={isStreaming}
          />
        )}

        {/* Relevance timeline — collapsed by default, hidden in split mode */}
        {!isStreaming && citations.length > 0 && !layout.hideTimeline && (
          <RelevanceTimeline
            citations={citations}
            isStreaming={isStreaming}
          />
        )}

        {/* Feedback buttons — only once the answer has finished streaming and
            has a query_logs id to rate against (see queryLogId prop doc) */}
        {!isStreaming && queryLogId && onFeedback && (
          <FeedbackButtons feedback={feedback ?? null} onFeedback={onFeedback} />
        )}

        {/* Re-query buttons — show after streaming completes, only on last assistant message */}
        {!isStreaming && sourceQuery && onReQuery && (
          <ReQueryButtons
            originalQuery={sourceQuery}
            onReQuery={onReQuery}
          />
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
 * (Chat.tsx) rebuilds the `citations` array with a fresh `.map(...)` on
 * every render, so a reference check would always report "changed" even
 * when nothing meaningful did. Comparing length + each field catches real
 * content changes while ignoring the parent's incidental re-allocation.
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
 * Custom equality check for `React.memo`. The parent re-renders this
 * component on every SSE token of the *currently streaming* message, which
 * re-creates the `citations` array and the `onFeedback` closure as new
 * references for every message in the list — not just the one that
 * changed. A default shallow-props comparator would therefore never skip a
 * re-render, defeating the purpose of memoizing. This comparator instead
 * compares the props that actually determine this component's rendered
 * output by value, so completed (non-streaming) messages skip re-rendering
 * (and skip re-parsing their Markdown) while the actively streaming
 * message — whose `content`/`isStreaming` props genuinely change — still
 * re-renders every token.
 * @param prev - Props from the previous render
 * @param next - Props for the candidate next render
 * @returns True if rendering can be skipped (props are equivalent)
 */
function areAssistantMessagePropsEqual(
  prev: Readonly<AssistantMessageProps>,
  next: Readonly<AssistantMessageProps>,
): boolean {
  return (
    prev.content === next.content &&
    prev.isStreaming === next.isStreaming &&
    prev.timestamp === next.timestamp &&
    prev.messageIndex === next.messageIndex &&
    prev.sourceQuery === next.sourceQuery &&
    prev.queryLogId === next.queryLogId &&
    prev.feedback === next.feedback &&
    // Presence, not identity, of the callbacks — Chat.tsx only ever
    // conditionally supplies these (undefined vs. a callback), so whether
    // one is present is a value-meaningful change; which particular
    // closure instance is supplied is not.
    Boolean(prev.onReQuery) === Boolean(next.onReQuery) &&
    Boolean(prev.onFeedback) === Boolean(next.onFeedback) &&
    citationsEqual(prev.citations, next.citations)
  );
}

/**
 * Memoized export. Wrapping in `React.memo` (with the custom comparator
 * above) means the N-1 already-completed assistant messages in a chat
 * thread do not re-run their Markdown parse on every token streamed into
 * the newest message — only the message whose props actually changed
 * value re-renders.
 */
export const AssistantMessage = React.memo(AssistantMessageImpl, areAssistantMessagePropsEqual);
