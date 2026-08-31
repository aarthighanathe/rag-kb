/**
 * @file CitationMarker.tsx
 * @description Inline citation superscript that participates in
 * bidirectional highlight with its corresponding IndexCard.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import React, { useCallback } from 'react';

export interface CitationMarkerProps {
  /** 1-based citation index */
  index: number;
  /** Whether this citation is currently active (hovered/focused) */
  isActive: boolean;
  /** Called on mouseenter and focus */
  onEnter: (index: number) => void;
  /** Called on mouseleave and blur */
  onLeave: () => void;
  /** Called on click — scrolls card into view */
  onClick: (index: number) => void;
  /** Whether interactions are disabled (e.g., during streaming) */
  disabled?: boolean;
  /**
   * True when this marker's number has no corresponding source in the
   * citations array (an LLM-hallucinated citation, e.g. [15] when only 5
   * sources exist). Rendered as visually distinct and non-interactive —
   * there is no card to jump to.
   */
  isHallucinated?: boolean;
}

/**
 * Inline citation superscript marker with bidirectional highlight support.
 * @param index - 1-based citation number
 * @param isActive - Whether this citation is currently highlighted
 * @param onEnter - Handler for hover/focus events
 * @param onLeave - Handler for mouse leave/blur events
 * @param onClick - Handler for click events
 * @param disabled - Whether to disable all interactions
 */
export function CitationMarker({
  index,
  isActive,
  onEnter,
  onLeave,
  onClick,
  disabled = false,
  isHallucinated = false,
}: CitationMarkerProps): React.JSX.Element {
  // A hallucinated citation number has no matching source card — treat it as
  // non-interactive the same way a disabled (streaming) marker is, rather
  // than wiring up handlers that silently no-op on click/hover.
  const interactive = !disabled && !isHallucinated;

  const handleMouseEnter = useCallback(() => {
    if (interactive) onEnter(index);
  }, [interactive, onEnter, index]);

  const handleMouseLeave = useCallback(() => {
    if (interactive) onLeave();
  }, [interactive, onLeave]);

  const handleClick = useCallback(() => {
    if (interactive) onClick(index);
  }, [interactive, onClick, index]);

  const handleFocus = useCallback(() => {
    if (interactive) onEnter(index);
  }, [interactive, onEnter, index]);

  const handleBlur = useCallback(() => {
    if (interactive) onLeave();
  }, [interactive, onLeave]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!interactive) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick(index);
      }
    },
    [interactive, onClick, index],
  );

  if (isHallucinated) {
    // Visually distinct (amber, dashed ring via boxShadow) and
    // non-interactive — no card exists at this number to jump to.
    return (
      <sup
        data-testid={`citation-marker-${index}`}
        aria-label={`Citation ${index} — source not found`}
        title="This citation number doesn't match any source"
        style={{
          background: '#B8860B',
          color: '#fff',
          fontFamily: "'Space Mono', monospace",
          fontSize: '11px',
          fontWeight: 700,
          lineHeight: 1,
          borderRadius: '50%',
          minWidth: '16px',
          height: '16px',
          padding: '0 3px',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          verticalAlign: 'super',
          margin: '0 2px',
          opacity: 0.7,
          cursor: 'help',
        }}
      >
        {index}
      </sup>
    );
  }

  if (disabled) {
    // Non-interactive rendering during streaming
    return (
      <sup
        data-testid={`citation-marker-${index}`}
        style={{
          background: '#2D5A4A',
          color: '#fff',
          fontFamily: "'Space Mono', monospace",
          fontSize: '11px',
          fontWeight: 700,
          lineHeight: 1,
          borderRadius: '50%',
          minWidth: '16px',
          height: '16px',
          padding: '0 3px',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          verticalAlign: 'super',
          margin: '0 2px',
        }}
      >
        {index}
      </sup>
    );
  }

  return (
    <sup
      data-testid={`citation-marker-${index}`}
      className="group"
      role="button"
      aria-label={`Citation ${index} — click to jump to source`}
      tabIndex={0}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      style={{
        background: isActive ? '#FF4D2E' : '#2D5A4A',
        color: '#fff',
        fontFamily: "'Space Mono', monospace",
        fontSize: '11px',
        fontWeight: 700,
        lineHeight: 1,
        borderRadius: '50%',
        minWidth: '16px',
        height: '16px',
        padding: '0 3px',
        verticalAlign: 'super',
        margin: '0 2px',
        cursor: 'pointer',
        transform: isActive ? 'scale(1.2)' : 'scale(1)',
        boxShadow: isActive ? '0 0 0 3px rgba(255,77,46,0.25)' : 'none',
        transition: 'all 150ms ease',
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {index}
      {/* Tooltip */}
      <span
        style={{
          position: 'absolute',
          bottom: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          fontFamily: "'Space Mono', monospace",
          fontSize: '10px',
          background: '#1C1B19',
          color: '#F7F5F0',
          padding: '3px 8px',
          borderRadius: '2px',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          marginBottom: '4px',
          opacity: '0',
          transition: 'opacity 150ms ease',
        }}
        className="group-hover:opacity-100"
        aria-hidden="true"
      >
        Jump to source
      </span>
    </sup>
  );
}
