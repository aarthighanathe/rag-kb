/**
 * @file RelevanceTimeline.tsx
 * @description Visual timeline showing relevance scores for all retrieved chunks.
 *   Collapsed by default; click to expand. Bars animate in with staggered delay.
 * @author [Author Placeholder]
 * @created 2026-07-01
 */

import React, { useState, useCallback } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ChatCitation } from './ChatMessage';
import { MODEL_SIMILARITY_CEILING, getScoreColor } from '../../utils/calculateConfidence';

export interface RelevanceTimelineProps {
  /** All retrieved citations to display in the timeline */
  citations: ChatCitation[];
  /** Whether the message is still streaming (disables toggle) */
  isStreaming?: boolean;
}

/**
 * Visual bar chart of all retrieved chunks, sorted by similarity descending.
 * Collapsed by default with a toggle button.
 * @param citations - Array of citations to display
 * @param isStreaming - When true, toggle is disabled
 */
export function RelevanceTimeline({
  citations,
  isStreaming = false,
}: RelevanceTimelineProps): React.JSX.Element | null {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleToggle = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  if (citations.length === 0) return null;

  // Sort by similarity descending for consistent display
  const sorted = [...citations].sort((a, b) => b.relevanceScore - a.relevanceScore);
  // Normalise bars against the model ceiling (0.40) — same scale as ConfidenceBar —
  // so a weak retrieval shows short bars across the board rather than one full bar.
  // This gives an honest absolute picture of retrieval quality, not just ranking.

  return (
    <div
      data-testid="relevance-timeline"
      className="mt-ds-3"
      style={{
        fontFamily: "'Space Grotesk', sans-serif",
        fontSize: '12px',
      }}
    >
      {/* Toggle button */}
      <button
        type="button"
        data-testid="timeline-toggle"
        onClick={handleToggle}
        disabled={isStreaming}
        aria-expanded={isExpanded}
        aria-controls="relevance-timeline-content"
        className="flex items-center gap-ds-1 font-mono text-ds-xs"
        style={{
          color: '#5C5850',
          background: 'none',
          border: 'none',
          padding: '2px 0',
          cursor: isStreaming ? 'not-allowed' : 'pointer',
          opacity: isStreaming ? 0.5 : 1,
          transition: 'color 150ms ease',
        }}
        onMouseEnter={(e) => {
          if (!isStreaming) {
            (e.currentTarget as HTMLButtonElement).style.color = '#1C1B19';
          }
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = '#5C5850';
        }}
      >
        {isExpanded ? (
          <ChevronDown size={12} aria-hidden="true" />
        ) : (
          <ChevronRight size={12} aria-hidden="true" />
        )}
        <span
          title="How closely each retrieved passage matched your question. Higher = more relevant."
        >
          Source match scores ({citations.length} {citations.length === 1 ? 'passage' : 'passages'})
        </span>
      </button>

      {/* Collapsible content */}
      {isExpanded && (
        <div
          id="relevance-timeline-content"
          data-testid="relevance-timeline-content"
          className="mt-ds-2"
          role="list"
          aria-label="How well each passage matched your question"
        >
          {sorted.map((citation, i) => {
            const barColor = getScoreColor(citation.relevanceScore);
            // Normalise against model ceiling so bar width reflects absolute quality
            const width = Math.min(100, Math.round((Math.max(0, citation.relevanceScore) / MODEL_SIMILARITY_CEILING) * 100));
            const delay = i * 80; // Staggered entrance

            return (
              <div
                key={citation.id}
                data-testid={`timeline-bar-${i + 1}`}
                role="listitem"
                className="flex items-center gap-ds-2 mb-1"
                style={{
                  animation: `timelineSlideIn 300ms ${delay}ms both`,
                }}
              >
                {/* Citation number */}
                <span
                  className="font-mono text-ds-xs shrink-0"
                  style={{
                    color: '#8A8578',
                    width: '16px',
                    textAlign: 'right',
                  }}
                >
                  {i + 1}
                </span>

                {/* Bar track */}
                <div
                  className="flex-1"
                  style={{
                    height: '6px',
                    background: '#F0EDEA',
                    borderRadius: '2px',
                    overflow: 'hidden',
                  }}
                >
                  {/* Bar fill */}
                  <div
                    data-testid={`timeline-bar-fill-${i + 1}`}
                    style={{
                      height: '100%',
                      width: `${width}%`,
                      background: barColor,
                      borderRadius: '2px',
                      transition: 'width 400ms cubic-bezier(0.4, 0, 0.2, 1)',
                    }}
                  />
                </div>

                {/* Score label */}
                <span
                  className="font-mono text-ds-xs shrink-0"
                  style={{
                    color: barColor,
                    width: '32px',
                    textAlign: 'right',
                  }}
                >
                  {Math.round(citation.relevanceScore * 100)}%
                </span>

                {/* Document name (truncated) */}
                <span
                  className="text-ds-xs truncate shrink-0"
                  style={{
                    color: '#8A8578',
                    maxWidth: '80px',
                  }}
                  title={citation.documentName}
                >
                  {citation.documentName}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
