/**
 * @file CitationChip.tsx
 * @description Citation marker component — Lab Notebook theme.
 *   Visually: a small superscript circular number badge in archive green.
 *   On hover/focus: reveals a dangling "string line" SVG connector below the badge.
 *   On click: opens the full-text side panel (preserves all existing behavior).
 *   All existing test-required structure is preserved (button role, meter, document name text).
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import React, { useState } from 'react';
import { X } from 'lucide-react';

export interface CitationChipProps {
  /** Source document filename. */
  documentName: string;
  /** Chunk or page identifier. */
  chunkRef: string;
  /** Relevance score 0-1. */
  relevanceScore: number;
  /** Full chunk text shown in the expanded side panel. */
  fullText?: string;
  /** Zero-based index used as the visible citation number [n+1]. */
  index?: number;
  /** Additional CSS classes. */
  className?: string;
}

const scoreColor = (score: number): string => {
  if (score >= 0.8) return 'text-ds-archive';
  if (score >= 0.5) return 'text-ds-warning';
  return 'text-ds-error';
};

const scoreBarBg = (score: number): string => {
  if (score >= 0.8) return 'bg-ds-archive';
  if (score >= 0.5) return 'bg-ds-warning';
  return 'bg-ds-error';
};

/**
 * Inline citation marker — superscript number badge with string-line connector on hover.
 * @param documentName  - Filename of source document
 * @param chunkRef      - Page / chunk identifier string
 * @param relevanceScore - 0-1 semantic similarity score
 * @param fullText      - Complete chunk text for the expansion panel
 * @param index         - 0-based position — displayed as [index+1]
 */
export function CitationChip({
  documentName,
  chunkRef,
  relevanceScore,
  fullText,
  index = 0,
  className = '',
}: CitationChipProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [showConnector, setShowConnector] = useState(false);
  const pct = Math.round(relevanceScore * 100);
  const panelId = `citation-panel-${index}`;
  const num = index + 1;

  return (
    <>
      {/* Citation marker wrapper — positioned for the string connector */}
      <span className={`relative inline-flex items-center flex-wrap gap-1.5 ${className}`}>
        {/* Superscript number badge — the primary visual element */}
        <button
          type="button"
          data-testid="citation-chip"
          onClick={() => fullText && setExpanded(true)}
          onMouseEnter={() => setShowConnector(true)}
          onMouseLeave={() => setShowConnector(false)}
          onFocus={() => setShowConnector(true)}
          onBlur={() => setShowConnector(false)}
          aria-expanded={expanded}
          aria-controls={fullText ? panelId : undefined}
          aria-label={`Citation ${num}: ${documentName} ${chunkRef} — ${pct}% relevance`}
          className={`
            inline-flex items-center justify-center
            w-5 h-5 rounded-full
            bg-ds-archive text-white
            text-[10px] font-mono font-bold
            transition-all duration-ds-fast
            hover:scale-110 hover:shadow-ds-citation
            focus-visible:outline-2 focus-visible:outline-ds-stamp focus-visible:outline-offset-1
            ${fullText ? 'cursor-pointer' : 'cursor-default'}
          `}
        >
          {num}

          {/* Hidden text for test compatibility — getByText('research.pdf') finds this */}
          <span className="sr-only">{documentName} {chunkRef}</span>
        </button>

        {/* Document name + chunk ref — visible label next to the badge */}
        <span className="text-ds-xs font-mono text-ds-archive truncate min-w-0 max-w-[100px] sm:max-w-[160px]">
          {documentName}
        </span>
        <span className="text-ds-xs font-mono text-ds-text-muted shrink-0">
          {chunkRef}
        </span>

        {/* Relevance meter — required by tests, rendered small */}
        <span
          className="shrink-0 h-1 w-8 rounded-none bg-ds-hairline overflow-hidden"
          role="meter"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${pct}% relevance`}
        >
          <span
            className={`block h-full ${scoreBarBg(relevanceScore)}`}
            style={{ width: `${pct}%` }}
          />
        </span>

        {/* Relevance percentage — styled label */}
        <span className={`text-[10px] font-mono shrink-0 ${scoreColor(relevanceScore)}`}>
          {pct}%
        </span>

        {/* String-line connector SVG — renders on hover/focus of the citation badge */}
        {showConnector && (
          <span
            aria-hidden="true"
            data-testid="citation-string-connector"
            className="pointer-events-none absolute left-2.5 top-full z-10"
            style={{ top: '100%' }}
          >
            <svg
              width="16"
              height="48"
              viewBox="0 0 16 48"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              style={{ display: 'block' }}
            >
              <path
                d="M 8,0 C 6,12 10,20 7,32 C 5,40 9,44 8,48"
                stroke="#FF4D2E"
                strokeOpacity="0.60"
                strokeWidth="1.5"
                strokeLinecap="round"
                fill="none"
                style={{
                  strokeDasharray: 60,
                  strokeDashoffset: 0,
                  animation: 'string-appear 200ms ease-out forwards',
                }}
              />
            </svg>
          </span>
        )}
      </span>

      {/* Full-text expansion panel */}
      {expanded && fullText && (
        <div
          id={panelId}
          role="dialog"
          aria-label={`Source text: ${documentName}`}
          aria-modal="true"
          className="fixed inset-y-0 right-0 z-ds-overlay w-80 bg-ds-surface border-l border-ds-hairline shadow-ds-lifted flex flex-col animate-slide-in-right"
        >
          <header className="flex items-center justify-between px-ds-4 py-ds-3 border-b border-ds-hairline">
            <div>
              <p className="text-ds-sm font-body font-semibold text-ds-text-primary truncate max-w-[180px]">
                {documentName}
              </p>
              <p className="text-ds-xs font-mono text-ds-text-muted">
                {chunkRef} · {pct}%
              </p>
            </div>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-label="Close citation panel"
              className="text-ds-text-muted hover:text-ds-text-primary transition-colors p-1"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto p-ds-4">
            <p className="text-ds-sm font-mono text-ds-text-secondary leading-ds-relaxed whitespace-pre-wrap">
              {fullText}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
