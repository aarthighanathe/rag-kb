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
}: CitationMarkerProps): React.JSX.Element {
  const handleMouseEnter = useCallback(() => {
    if (!disabled) onEnter(index);
  }, [disabled, onEnter, index]);

  const handleMouseLeave = useCallback(() => {
    if (!disabled) onLeave();
  }, [disabled, onLeave]);

  const handleClick = useCallback(() => {
    if (!disabled) onClick(index);
  }, [disabled, onClick, index]);

  const handleFocus = useCallback(() => {
    if (!disabled) onEnter(index);
  }, [disabled, onEnter, index]);

  const handleBlur = useCallback(() => {
    if (!disabled) onLeave();
  }, [disabled, onLeave]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick(index);
      }
    },
    [disabled, onClick, index],
  );

  if (disabled) {
    // Non-interactive rendering during streaming
    return (
      <sup
        data-testid={`citation-marker-${index}`}
        style={{
          background: '#2D5A4A',
          color: '#fff',
          fontFamily: "'Space Mono', monospace",
          fontSize: '8px',
          borderRadius: '50%',
          padding: '1px 4px',
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
        fontSize: '8px',
        borderRadius: '50%',
        padding: '1px 4px',
        verticalAlign: 'super',
        margin: '0 2px',
        cursor: 'pointer',
        transform: isActive ? 'scale(1.2)' : 'scale(1)',
        boxShadow: isActive ? '0 0 0 3px rgba(255,77,46,0.25)' : 'none',
        transition: 'all 150ms ease',
        position: 'relative',
        display: 'inline-block',
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
