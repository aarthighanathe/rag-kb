/**
 * @file ConfidenceBar.tsx
 * @description Horizontal confidence bar showing answer reliability based on
 *   average similarity scores. Renders only on completed messages.
 * @author [Author Placeholder]
 * @created 2026-07-01
 */

import React from 'react';
import { calculateConfidence, type ConfidenceLevel, MODEL_SIMILARITY_CEILING } from '../../utils/calculateConfidence';

export interface ConfidenceBarProps {
  /** Array of similarity scores from retrieved citations */
  similarities: number[];
  /** Whether the message is still streaming (hides bar when true) */
  isStreaming?: boolean;
}

/**
 * Maps confidence level to bar color.
 * @param level - Confidence level
 * @returns CSS color value
 */
function getBarColor(level: ConfidenceLevel): string {
  switch (level) {
    case 'high':
      return '#2D5A4A'; // archive.green
    case 'medium':
      // Darkened from #D68910 (2.82:1 on white — fails WCAG AA). #8A5A00
      // computes to 5.93:1 on white and 5.44:1 on paper.base (#F7F5F0),
      // clearing the 4.5:1 minimum for normal text while staying a
      // recognizably amber/warning tone.
      return '#8A5A00';
    case 'low':
      return '#FF4D2E'; // stamp.red
    case 'very-low':
      return '#C0392B'; // danger
  }
}

/**
 * Horizontal confidence bar with label and optional warning.
 * @param similarities - Array of similarity scores
 * @param isStreaming - When true, renders nothing
 */
export function ConfidenceBar({
  similarities,
  isStreaming = false,
}: ConfidenceBarProps): React.JSX.Element | null {
  if (isStreaming) return null;

  const { average, level, label, warning } = calculateConfidence(similarities);
  const barColor = getBarColor(level);
  // Normalise against the model's practical ceiling (0.40) so a "good" 0.25
  // score renders at ~63% bar width instead of a misleading 25%.
  const normalised = Math.min(1, average / MODEL_SIMILARITY_CEILING);
  const width = Math.round(normalised * 100);

  return (
    <div
      data-testid="confidence-bar"
      className="mt-ds-2"
      style={{
        fontFamily: "'Space Grotesk', sans-serif",
        fontSize: '12px',
        color: '#5C5850',
      }}
    >
      {/* Label row */}
      <div
        className="flex items-center gap-ds-2 mb-1"
        aria-label={`Confidence: ${label}`}
      >
        <span
          className="font-mono text-ds-xs font-medium"
          style={{ color: barColor }}
        >
          {label}
        </span>
        <span
          className="font-mono text-ds-xs text-ds-text-muted"
          title={`Raw similarity score: ${Math.round(average * 100)}% (bar normalised to model ceiling of ${Math.round(MODEL_SIMILARITY_CEILING * 100)}%)`}
        >
          ({Math.round(average * 100)}% avg)
        </span>
      </div>

      {/* Bar track */}
      <div
        data-testid="confidence-bar-track"
        style={{
          height: '4px',
          background: '#F0EDEA',
          borderRadius: '2px',
          overflow: 'hidden',
        }}
        role="progressbar"
        aria-valuenow={Math.round(width)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Confidence level: ${Math.round(width)}%`}
      >
        {/* Bar fill */}
        <div
          data-testid="confidence-bar-fill"
          style={{
            height: '100%',
            width: `${width}%`,
            background: barColor,
            borderRadius: '2px',
            transition: 'width 400ms cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />
      </div>

      {/* Warning message */}
      {warning && (
        <p
          data-testid="confidence-warning"
          className="mt-1 font-mono text-ds-xs"
          style={{ color: '#8A8578', fontStyle: 'italic' }}
          role="alert"
        >
          {warning}
        </p>
      )}
    </div>
  );
}
