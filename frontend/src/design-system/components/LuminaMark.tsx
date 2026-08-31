/**
 * @file LuminaMark.tsx
 * @description The Lumina brand mark — a dark rounded-square tile with a stylized
 *   book-spine glyph (orange cover + cream spine). Shared inline-SVG source of
 *   truth for the wordmark logo used in AppHeader and Landing — kept visually
 *   identical to public/favicon.svg (the browser-tab/OG icon) so the mark reads
 *   as the same logo everywhere it appears, not two different icons that happen
 *   to share a name.
 * @author [Author Placeholder]
 * @created 2026-08-31
 */

import React from 'react';

export interface LuminaMarkProps {
  /** Pixel size of the (square) mark. Default 18, matching AppHeader's prior BookOpen icon size. */
  size?: number;
  className?: string;
}

/**
 * Renders the Lumina brand mark as inline SVG.
 * @param size - Pixel width/height of the mark
 * @param className - Optional additional class names
 */
export function LuminaMark({ size = 18, className }: LuminaMarkProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      <rect width="32" height="32" rx="6" fill="#1C1B19" />
      <path d="M9 8h9.5a4.5 4.5 0 0 1 4.5 4.5v11.5H13.5A4.5 4.5 0 0 1 9 19.5V8z" fill="#FF4D2E" />
      <rect x="9" y="8" width="4.5" height="16" fill="#F7F5F0" />
    </svg>
  );
}
