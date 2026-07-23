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
 * @returns React.ReactNode array safe to render inside a <p>
 */
export function parseCitationText(
  text: string,
  activeCitation: number | null,
  handlers: ParseCitationTextHandlers,
  disabled = false,
): React.ReactNode[] {
  if (!text) return [];

  const nodes: React.ReactNode[] = [];

  // Fresh regex instance per call — CITATION_MARKER_REGEX is a shared /g
  // pattern with stateful .lastIndex, unsafe to reuse directly across calls.
  const citationRegex = new RegExp(CITATION_MARKER_REGEX);

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let citationIndex = 0;
  
  while ((match = citationRegex.exec(text)) !== null) {
    // Add text before this citation
    const textBefore = text.slice(lastIndex, match.index);
    if (textBefore) {
      // Check if this text segment should be highlighted
      // It's highlighted if the NEXT citation (the one we just found) is active
      const nextCitationIndex = citationIndex + 1;
      const isHighlighted = activeCitation === nextCitationIndex;
      
      if (isHighlighted) {
        nodes.push(
          <span
            key={`span-${citationIndex}`}
            data-testid={`cited-span-${nextCitationIndex}`}
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
    
    // Determine the citation number
    let citationNumber: number;
    if (match[2]) {
      // Bracket notation: [1], [2], etc.
      citationNumber = parseInt(match[2], 10);
    } else if (match[1]) {
      // Unicode superscript: ①, ②, etc.
      citationNumber = superscriptToNumber(match[1]);
    } else {
      // Fallback (shouldn't happen with the regex pattern)
      citationNumber = citationIndex + 1;
    }
    
    citationIndex = citationNumber;
    
    // Add the CitationMarker component
    nodes.push(
      <CitationMarker
        key={`citation-${citationIndex}`}
        index={citationIndex}
        isActive={activeCitation === citationIndex}
        onEnter={handlers.onEnter}
        onLeave={handlers.onLeave}
        onClick={handlers.onClick}
        disabled={disabled}
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
