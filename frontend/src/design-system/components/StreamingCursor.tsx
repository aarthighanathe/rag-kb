/**
 * @file StreamingCursor.tsx
 * @description Blinking underscore cursor for LLM streaming output — Lab Notebook theme.
 *   Uses Space Mono and stamp color. Restrained, not glowing.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import React from 'react';

export interface StreamingCursorProps {
  /** When false the cursor is hidden (streaming has stopped). */
  active?: boolean;
  /** Additional CSS classes. */
  className?: string;
}

/**
 * Blinking underscore cursor for streaming LLM output.
 * @param active    - Controls visibility (default: true)
 * @param className - Extra CSS classes
 */
export function StreamingCursor({
  active = true,
  className = '',
}: StreamingCursorProps): React.JSX.Element | null {
  if (!active) return null;

  return (
    <span
      data-testid="streaming-cursor"
      aria-hidden="true"
      className={`inline-block font-mono text-ds-stamp animate-cursor-blink ml-0.5 ${className}`}
    >
      _
    </span>
  );
}
