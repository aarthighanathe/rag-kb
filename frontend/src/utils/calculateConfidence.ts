/**
 * @file calculateConfidence.ts
 * @description Calculates answer confidence level based on average similarity
 *   scores of retrieved chunks. Thresholds tuned for all-MiniLM-L6-v2 embeddings.
 * @author [Author Placeholder]
 * @created 2026-07-01
 */

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'very-low';

export interface ConfidenceResult {
  /** Average similarity score across all citations */
  average: number;
  /** Normalized confidence level */
  level: ConfidenceLevel;
  /** Human-readable label */
  label: string;
  /** Warning message shown below threshold */
  warning: string | null;
}

/**
 * Practical ceiling for all-MiniLM-L6-v2 cosine similarity.
 * The theoretical max is 1.0, but in asymmetric question/passage retrieval
 * this model rarely exceeds 0.40. We normalise the confidence bar against
 * this value so a "good" 0.25 score renders at ~63% bar width rather than
 * a misleading 25%.
 */
export const MODEL_SIMILARITY_CEILING = 0.40;

/**
 * Thresholds recalibrated for all-MiniLM-L6-v2 (sentence-transformers).
 *
 * OpenAI text-embedding-* models score 0.7–0.9 for strong matches.
 * all-MiniLM-L6-v2 scores 0.25–0.40 for strong matches in Q&A retrieval.
 *
 * - High   : avg >= 0.25  — strong semantic match, answer is reliable
 * - Medium : avg >= 0.12  — moderate match, answer is usually relevant
 * - Low    : avg >= 0.04  — weak but not empty; answer may be partial
 * - Very-low: avg < 0.04  — essentially noise; results unreliable
 */
export const THRESHOLDS = {
  high: 0.25,
  medium: 0.12,
  low: 0.04,
} as const;

/**
 * Bar/badge colours for each confidence band, keyed the same as THRESHOLDS
 * plus a 'veryLow' band below `THRESHOLDS.low`. Single source of truth so
 * any component rendering a confidence-derived colour (ConfidenceBar,
 * RelevanceTimeline, etc.) stays in sync when thresholds are retuned.
 */
export const THRESHOLD_COLORS = {
  high: '#2D5A4A',    // archive.green — high confidence
  medium: '#D68910',  // amber — moderate
  low: '#FF4D2E',     // stamp.red — low
  veryLow: '#C0392B', // danger — very low
} as const;

/**
 * Maps a raw similarity score to its confidence-band colour using the same
 * THRESHOLDS as calculateConfidence, so callers needn't duplicate the cutoffs.
 * @param score - Raw similarity score 0-1
 * @returns CSS colour string for the score's confidence band
 */
export function getScoreColor(score: number): string {
  if (score >= THRESHOLDS.high) return THRESHOLD_COLORS.high;
  if (score >= THRESHOLDS.medium) return THRESHOLD_COLORS.medium;
  if (score >= THRESHOLDS.low) return THRESHOLD_COLORS.low;
  return THRESHOLD_COLORS.veryLow;
}

/**
 * Calculates confidence from an array of similarity scores.
 * @param similarities - Array of similarity scores (clamped to [0, 1] by the SQL GREATEST fix)
 * @returns ConfidenceResult with average, level, label, and optional warning
 */
export function calculateConfidence(
  similarities: number[],
): ConfidenceResult {
  if (similarities.length === 0) {
    return {
      average: 0,
      level: 'very-low',
      label: 'No sources',
      warning: 'No sources were retrieved for this answer.',
    };
  }

  const sum = similarities.reduce((acc, s) => acc + s, 0);
  const average = sum / similarities.length;

  let level: ConfidenceLevel;
  let label: string;
  let warning: string | null = null;

  if (average >= THRESHOLDS.high) {
    level = 'high';
    label = 'High confidence';
  } else if (average >= THRESHOLDS.medium) {
    level = 'medium';
    label = 'Moderate confidence';
  } else if (average >= THRESHOLDS.low) {
    level = 'low';
    label = 'Low confidence';
    warning = 'The AI found some content but the match to your question is weak. Try rephrasing or asking something more specific.';
  } else {
    level = 'very-low';
    label = 'Very low confidence';
    warning = 'The AI could not find a strong match in your documents. Try rephrasing your question or check that the right documents are selected.';
  }

  return { average, level, label, warning };
}

