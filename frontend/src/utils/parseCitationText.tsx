/**
 * @file parseCitationText.tsx
 * @description Parses assistant answer text containing citation
 * markers and returns a React node array with interactive
 * CitationMarker components in place of raw markers.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import React from 'react';
import { CitationMarker } from '../design-system/components/CitationMarker';
import { CITATION_MARKER_REGEX, superscriptToNumber } from './citationMarkers';

export interface ParseCitationTextHandlers {
  onEnter: (index: number) => void;
  onLeave: () => void;
  onClick: (index: number) => void;
}

/**
 * Splits answer text on citation patterns (①②③ Unicode superscripts
 * OR [1][2][3] bracket notation — handle both) and returns an array
 * of strings and CitationMarker elements.
 *
 * @param text - Raw answer text with citation markers
 * @param activeCitation - Currently highlighted citation index or null
 * @param handlers - onEnter, onLeave, onClick from useCitationHighlight
 * @param disabled - Whether interactions are disabled (e.g., during streaming)
 * @param citationCount - Number of real sources in the citations array. A
 *   marker number beyond this range (an LLM-hallucinated citation, e.g. [15]
 *   when only 5 sources exist) has no matching IndexCard to jump to, so it
 *   renders as visually flagged and non-interactive rather than a marker
 *   whose click/hover silently does nothing. Pass `undefined` (streaming,
 *   count not yet known) to skip the check.
 * @returns React.ReactNode array safe to render inside a <p>
 */
export function parseCitationText(
  text: string,
  activeCitation: number | null,
  handlers: ParseCitationTextHandlers,
  disabled = false,
  citationCount?: number,
): React.ReactNode[] {
  if (!text) return [];

  const nodes: React.ReactNode[] = [];

  // Fresh regex instance per call — CITATION_MARKER_REGEX is a shared /g
  // pattern with stateful .lastIndex, unsafe to reuse directly across calls.
  const citationRegex = new RegExp(CITATION_MARKER_REGEX);

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let citationOrdinal = 0;

  while ((match = citationRegex.exec(text)) !== null) {
    // Determine the citation number for the marker we just matched — needed
    // before deciding whether to highlight the preceding text, since the
    // preceding text is only ever highlighted for the upcoming marker's own
    // number (not a running position counter, which breaks on repeated or
    // out-of-order numbers like "...[1]...[1]...[2]").
    let citationNumber: number;
    if (match[2]) {
      // Bracket notation: [1], [2], etc.
      citationNumber = parseInt(match[2], 10);
    } else if (match[1]) {
      // Unicode superscript: ①, ②, etc.
      citationNumber = superscriptToNumber(match[1]);
    } else {
      // Fallback (shouldn't happen with the regex pattern)
      citationNumber = citationOrdinal + 1;
    }

    // Add text before this citation
    const textBefore = text.slice(lastIndex, match.index);
    if (textBefore) {
      const isHighlighted = activeCitation === citationNumber;

      if (isHighlighted) {
        nodes.push(
          <span
            key={`span-${citationOrdinal}`}
            data-testid={`cited-span-${citationNumber}`}
            style={{
              background: 'rgba(255, 224, 102, 0.35)',
              borderRadius: '2px',
              padding: '1px 2px',
              margin: '0 -2px',
              transition: 'background 200ms ease',
            }}
          >
            {textBefore}
          </span>,
        );
      } else {
        nodes.push(textBefore);
      }
    }

    citationOrdinal += 1;

    const isHallucinated =
      citationCount !== undefined && (citationNumber < 1 || citationNumber > citationCount);

    // Add the CitationMarker component
    nodes.push(
      <CitationMarker
        key={`citation-${citationOrdinal}`}
        index={citationNumber}
        isActive={activeCitation === citationNumber}
        onEnter={handlers.onEnter}
        onLeave={handlers.onLeave}
        onClick={handlers.onClick}
        disabled={disabled}
        isHallucinated={isHallucinated}
      />,
    );

    lastIndex = citationRegex.lastIndex;
  }

  // Add remaining text after the last citation
  const textAfter = text.slice(lastIndex);
  if (textAfter) {
    nodes.push(textAfter);
  }

  return nodes;
}
