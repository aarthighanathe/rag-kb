/**
 * @file FilingReport.tsx
 * @description Post-processing quality summary for an uploaded
 *   document. Shown after status transitions to 'ready'.
 * @author [Author Placeholder]
 * @created 2026-07-01
 */

import { useId, useState } from 'react';
import type { ChunkQualityStats } from '../../services/api';
import { FILING_REPORT, FILING_GRADE, FILING_BAR } from '../../tests/testIds';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FilingReportProps {
  stats: ChunkQualityStats;
  filename: string;
}

// ---------------------------------------------------------------------------
// Grade config
// ---------------------------------------------------------------------------

const GRADE_CONFIG: Record<
  ChunkQualityStats['grade'],
  { bg: string; label: string; description: string }
> = {
  good: {
    bg: '#2D5A4A',
    label: 'GOOD ✓',
    description: 'Most of this document was split into well-sized pieces. Answers drawn from it should be reliable.',
  },
  fair: {
    bg: '#D68910',
    label: 'FAIR',
    description: 'Some pieces of this document came out too short or too long. Answers should still work, but may occasionally miss context.',
  },
  poor: {
    bg: '#FF4D2E',
    label: 'POOR',
    description: 'Most of this document came out too short or too long to search well. Answers based on it may be incomplete or miss the point.',
  },
};

/**
 * Builds a specific, plain-language hint for why quality came out low, when the
 * stats point to a likely cause (near-empty extraction, or chunks running too
 * long) rather than a generic "some chunks were an odd size" note.
 * @param stats - Chunk quality statistics for the document
 * @returns A hint string, or null if no specific cause is detectable
 */
function detectLikelyCause(stats: ChunkQualityStats): string | null {
  if (stats.grade === 'good') return null;
  if (stats.totalChunks <= 2 && stats.avgTokenCount < 20) {
    return 'This usually means the file had almost no readable text — common with scanned or image-only PDFs, password-protected files, or a mostly blank document. Try uploading a text-based version instead.';
  }
  if (stats.longChunkCount / stats.totalChunks > 0.5) {
    return 'Most pieces came out too long — common with dense tables, unbroken walls of text, or files with few paragraph breaks. Answers may include more surrounding text than needed.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Compact filing report card showing chunk quality stats.
 * @param stats - Chunk quality statistics
 * @param filename - Document filename for context
 */
export function FilingReport({ stats, filename }: FilingReportProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const regionId = useId();
  const config = GRADE_CONFIG[stats.grade] ?? GRADE_CONFIG.good;
  const likelyCause = detectLikelyCause(stats);
  const optimal = stats.totalChunks - stats.shortChunkCount - stats.longChunkCount;

  const shortPct = stats.totalChunks > 0 ? (stats.shortChunkCount / stats.totalChunks) * 100 : 0;
  const longPct = stats.totalChunks > 0 ? (stats.longChunkCount / stats.totalChunks) * 100 : 0;
  const optimalPct = 100 - shortPct - longPct;

  return (
    <div style={{ marginTop: '6px' }} data-testid={FILING_REPORT}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          fontFamily: "'Space Mono', monospace",
          fontSize: '10px',
          color: '#8A8578',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '2px 0',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
        }}
        aria-expanded={expanded}
        aria-controls={regionId}
        aria-label={`${expanded ? 'Hide' : 'View'} filing report for ${filename}`}
      >
        {expanded ? '▼' : '▶'} View filing report
      </button>

      {expanded && (
        <div
          id={regionId}
          style={{
            marginTop: '6px',
            background: '#F7F5F0',
            border: '1px solid #D8D4C8',
            padding: '12px 14px',
          }}
          role="region"
          aria-label={`Filing report for ${filename}`}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span
              style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: '9px',
                letterSpacing: '0.1em',
                color: '#8A8578',
                textTransform: 'uppercase',
              }}
            >
              FILING REPORT
            </span>
            <span
              data-testid={FILING_GRADE}
              style={{
                background: config.bg,
                color: '#FFFFFF',
                fontFamily: "'Space Mono', monospace",
                fontSize: '9px',
                fontWeight: 700,
                padding: '2px 6px',
                transform: 'rotate(-1.5deg)',
                display: 'inline-block',
              }}
              title={config.description}
            >
              {config.label}
            </span>
          </div>

          {/* Plain-language explanation — always visible, not hidden behind a hover tooltip */}
          <p style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '12px', color: '#5C5850', lineHeight: 1.5, marginBottom: '10px' }}>
            {config.description}
            {likelyCause && <> {likelyCause}</>}
          </p>

          {/* Stats */}
          <p style={{ fontFamily: "'Space Mono', monospace", fontSize: '11px', color: '#1C1B19', marginBottom: '8px' }}>
            {stats.totalChunks} chunk{stats.totalChunks === 1 ? '' : 's'} · avg {stats.avgTokenCount} tokens per chunk
          </p>

          {/* Distribution bar */}
          <div
            style={{
              height: '6px',
              display: 'flex',
              overflow: 'hidden',
              marginBottom: '6px',
            }}
            role="img"
            aria-label={`Chunk distribution: ${stats.shortChunkCount} short, ${optimal} optimal, ${stats.longChunkCount} long`}
          >
            {shortPct > 0 && (
              <div style={{ width: `${shortPct}%`, background: '#C0392B' }} />
            )}
            {optimalPct > 0 && (
              <div data-testid={FILING_BAR} style={{ width: `${optimalPct}%`, background: '#2D5A4A' }} />
            )}
            {longPct > 0 && (
              <div style={{ width: `${longPct}%`, background: '#D68910' }} />
            )}
          </div>

          {/* Counts */}
          <p style={{ fontFamily: "'Space Mono', monospace", fontSize: '10px', color: '#8A8578' }}>
            {stats.shortChunkCount} too short · {stats.longChunkCount} too long · {optimal} well-sized
          </p>
        </div>
      )}
    </div>
  );
}
