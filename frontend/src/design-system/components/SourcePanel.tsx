/**
 * @file SourcePanel.tsx
 * @description The right panel in split-screen mode. Shows source
 *   chunks for the current or most recent query, updating live
 *   as chunks arrive during streaming.
 * @author [Author Placeholder]
 * @created 2026-07-01
 */

import React, { useCallback, useRef } from 'react';
import { BookOpen } from 'lucide-react';
import { IndexCard } from './IndexCard';
import { ConfidenceBar } from './ConfidenceBar';
import { RelevanceTimeline } from './RelevanceTimeline';
import { useChatLayout } from '../../contexts/ChatLayoutContext';
import type { Citation } from '../../stores/ragStore';
import type { ChatCitation } from './ChatMessage';

export interface SourcePanelProps {
  /** Live chunks for the current streaming query */
  liveChunks: Citation[];
  /** SSE phase determining panel state */
  queryPhase: 'idle' | 'searching' | 'streaming' | 'complete';
}

function toChatCitation(c: Citation, i: number): ChatCitation {
  return {
    id: c.chunkId,
    documentName: c.documentName,
    chunkRef: c.chunkRef,
    relevanceScore: c.similarity,
    fullText: c.excerpt,
    chunkIndex: i + 1,
  };
}

/**
 * Live source panel shown in split-screen mode.
 * Displays IndexCards for the current query's chunks as they arrive.
 * @param liveChunks - Retrieved citation chunks
 * @param queryPhase - Current SSE phase
 */
export function SourcePanel({
  liveChunks,
  queryPhase,
}: SourcePanelProps): React.JSX.Element {
  const { activeCitation, onCitationEnter, onCitationLeave } = useChatLayout();
  const cardRefs = useRef<Map<number, HTMLElement | null>>(new Map());

  const similarities = liveChunks.map((c) => c.similarity);

  const handleCardEnter = useCallback((index: number) => {
    onCitationEnter(index);
  }, [onCitationEnter]);

  const handleCardLeave = useCallback(() => {
    onCitationLeave();
  }, [onCitationLeave]);

  return (
    <div
      data-testid="source-panel"
      className="flex flex-col h-full overflow-hidden"
      style={{
        background: '#F7F5F0',
        borderLeft: '1px solid #D8D4C8',
        padding: '20px 24px',
        overflowY: 'auto',
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-2 mb-3"
        style={{ flexShrink: 0 }}
      >
        <span
          style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: '9px',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: '#8A8578',
          }}
        >
          SOURCE DOCUMENTS
        </span>
        {liveChunks.length > 0 && (
          <span
            style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: '9px',
              background: '#2D5A4A',
              color: '#FFFFFF',
              borderRadius: '50%',
              padding: '1px 6px',
              lineHeight: '14px',
            }}
          >
            {liveChunks.length}
          </span>
        )}
      </div>
      <div style={{ borderTop: '1px solid #D8D4C8', marginBottom: '16px' }} />

      {/* ── State: idle ────────────────────────────────────────────────────── */}
      {queryPhase === 'idle' && liveChunks.length === 0 && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            gap: '12px',
          }}
        >
          <BookOpen size={32} style={{ color: '#B8B4AC' }} aria-hidden="true" />
          <p
            style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: '11px',
              color: '#B8B4AC',
              fontStyle: 'italic',
              maxWidth: '180px',
              lineHeight: '1.6',
            }}
          >
            Sources appear here as your answer streams.
          </p>
        </div>
      )}

      {/* ── State: searching ───────────────────────────────────────────────── */}
      {queryPhase === 'searching' && liveChunks.length === 0 && (
        <div
          data-testid="source-searching"
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
          }}
        >
          <p
            style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: '11px',
              color: '#8A8578',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#FF4D2E', animation: 'pulse 1.5s infinite' }} aria-hidden="true" />
            Searching knowledge base
          </p>
          {/* Indeterminate progress bar */}
          <div
            style={{
              width: '120px',
              height: '3px',
              background: '#F0EDEA',
              borderRadius: '2px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: '30%',
                height: '100%',
                background: '#FF4D2E',
                borderRadius: '2px',
                animation: 'search-sweep 1.5s ease-in-out infinite',
              }}
            />
          </div>
        </div>
      )}

      {/* ── State: streaming / complete — cards + timeline ──────────────────── */}
      {liveChunks.length > 0 && (
        <>
          {/* Confidence bar (compact) */}
          {!queryPhase.includes('searching') && similarities.length > 0 && (
            <div data-testid="source-confidence" className="mb-4">
              <ConfidenceBar
                similarities={similarities}
                isStreaming={queryPhase === 'streaming'}
              />
            </div>
          )}

          {/* IndexCards — full width, staggered animation */}
          <div className="flex flex-col gap-3 mb-4">
            {liveChunks.map((chunk, i) => (
              <div
                key={chunk.chunkId}
                data-testid="source-panel-card"
                style={{
                  animation: `card-slide-in 200ms ease-out ${i * 150}ms both`,
                }}
              >
                <IndexCard
                  documentName={chunk.documentName}
                  chunkText={chunk.excerpt}
                  relevanceScore={chunk.similarity}
                  chunkRef={`Chunk ${i + 1}`}
                  index={i}
                  citationIndex={i + 1}
                  isActive={activeCitation === i + 1}
                  onEnter={handleCardEnter}
                  onLeave={handleCardLeave}
                  cardRef={(el) => cardRefs.current.set(i + 1, el)}
                  className="w-full"
                />
              </div>
            ))}
          </div>

          {/* RelevanceTimeline */}
          <RelevanceTimeline
            citations={liveChunks.map((c, i) => toChatCitation(c, i))}
            isStreaming={queryPhase === 'streaming'}
          />
        </>
      )}
    </div>
  );
}
