/**
 * @file IndexCard.tsx
 * @description Index card component — the signature element of the Lab Notebook theme.
 *   Each retrieved chunk renders as a physical index card with:
 *   - Deterministic pseudo-random rotation (stable across re-renders)
 *   - Torn-paper top edge via clip-path
 *   - Rubber-stamp relevance percentage badge (top-right, rotated -8deg)
 *   - Paperclip icon on the top match (index 0)
 *   - 3D flip animation to reveal full chunk text on the back
 *   - Full keyboard accessibility (Enter/Space to flip, aria-pressed)
 *   - Respects prefers-reduced-motion: instant fade swap instead of 3D flip
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import React, { useState, useCallback, useId } from 'react';
import { FileText, FileCode, FileType, ArrowLeft } from 'lucide-react';

export interface IndexCardProps {
  /** The chunk content shown on the front (preview, 2 lines) and back (full). */
  chunkText: string;
  /** Source document filename. */
  documentName: string;
  /** Relevance score 0–1 (drives the stamp badge percentage). */
  relevanceScore: number;
  /** Zero-based index. Index 0 shows the paperclip. Used for rotation seed too. */
  index?: number;
  /** Chunk/page reference string. */
  chunkRef?: string;
  /** Additional CSS classes on the root element. */
  className?: string;
  /** Citation index this card corresponds to (1-based) */
  citationIndex?: number;
  /** Whether this card is currently highlighted */
  isActive?: boolean;
  /** Called on mouseenter */
  onEnter?: (index: number) => void;
  /** Called on mouseleave */
  onLeave?: () => void;
  /** Called on touch (mobile tap) with auto-reset */
  onTouch?: (index: number) => void;
  /** Ref callback for scroll-into-view support */
  cardRef?: (el: HTMLElement | null) => void;
}

// ---------------------------------------------------------------------------
// Deterministic pseudo-random rotation
// Seeded by documentName + index so rotation is stable across re-renders.
// ---------------------------------------------------------------------------

/** Simple djb2 hash → integer. */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h = h & 0x7fffffff; // keep positive
  }
  return h;
}

/**
 * Returns a rotation in degrees between -1.5 and +1.5, seeded by chunk identity.
 * @param documentName - Seed string 1
 * @param index        - Seed integer
 */
function getCardRotation(documentName: string, index: number): number {
  const seed = hashString(`${documentName}::${index}`);
  // Map [0, 2^31) → [-1.5, 1.5]
  return ((seed % 300) / 100) - 1.5;
}

// ---------------------------------------------------------------------------
// File-type icon helper
// ---------------------------------------------------------------------------

function DocTypeIcon({ name }: { name: string }): React.JSX.Element {
  const ext = name.split('.').pop()?.toLowerCase();
  const cls = 'shrink-0 text-ds-text-muted';
  if (ext === 'md')   return <FileCode   size={14} className={cls} aria-hidden="true" />;
  if (ext === 'docx') return <FileType   size={14} className={cls} aria-hidden="true" />;
  return               <FileText size={14} className={cls} aria-hidden="true" />;
}

// ---------------------------------------------------------------------------
// Paperclip SVG (only rendered on index 0 — top match)
// ---------------------------------------------------------------------------

function Paperclip(): React.JSX.Element {
  return (
    <svg
      width="18"
      height="36"
      viewBox="0 0 18 36"
      fill="none"
      aria-hidden="true"
      className="absolute -top-4 left-3 z-10 drop-shadow-sm"
    >
      <path
        d="M9 2 C4.5 2 2 5 2 9 L2 28 C2 32.4 5.6 35 9 35 C12.4 35 16 32.4 16 28 L16 8"
        stroke="#8A8578"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M9 5 C6 5 5 7 5 9 L5 28 C5 30.8 6.9 32 9 32 C11.1 32 13 30.8 13 28 L13 9"
        stroke="#8A8578"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Index card — renders a retrieved chunk as a physical index card with 3D flip.
 * @param chunkText       - Source chunk text content
 * @param documentName    - Filename of source document
 * @param relevanceScore  - 0–1 semantic relevance score
 * @param index           - Zero-based position (0 gets paperclip)
 * @param chunkRef        - Page / chunk identifier
 */
export function IndexCard({
  chunkText,
  documentName,
  relevanceScore,
  index = 0,
  chunkRef,
  className = '',
  citationIndex,
  isActive = false,
  onEnter,
  onLeave,
  cardRef,
}: IndexCardProps): React.JSX.Element {
  const [isFlipped, setIsFlipped] = useState(false);
  const cardId = useId();
  const frontId = `${cardId}-front`;
  const backId  = `${cardId}-back`;

  const pct = Math.round(relevanceScore * 100);
  const rotation = getCardRotation(documentName, index);
  const isTopMatch = index === 0;

  // Register ref callback for scroll-into-view support
  const rootRef = useCallback((el: HTMLElement | null) => {
    if (cardRef) cardRef(el);
  }, [cardRef]);

  const handleMouseEnter = useCallback(() => {
    if (onEnter && citationIndex !== undefined) {
      onEnter(citationIndex);
    }
  }, [onEnter, citationIndex]);

  const handleMouseLeave = useCallback(() => {
    if (onLeave) onLeave();
  }, [onLeave]);

  // Detect reduced-motion preference
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const handleFlip = useCallback(() => {
    setIsFlipped((prev) => !prev);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleFlip();
      }
    },
    [handleFlip],
  );

  // Relevance stamp color
  const stampBg = isActive
    ? 'bg-ds-archive text-white'
    : pct >= 80
      ? 'bg-ds-stamp text-white'
      : pct >= 50
        ? 'bg-ds-warning text-white'
        : 'bg-ds-text-muted text-white';

  // Active card border and shadow styles
  const activeStyles = isActive
    ? {
        border: '2px solid #2D5A4A',
        boxShadow: '0 0 0 3px rgba(45,90,74,0.15), 0 4px 16px rgba(28,27,25,0.12)',
        transform: `rotate(${rotation}deg) translateY(-4px)`,
      }
    : {
        border: '1px solid #D8D4C8',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        transform: `rotate(${rotation}deg)`,
      };

  // Shared card surface classes
  const cardSurface =
    'w-full min-h-[140px] bg-ds-card border border-ds-hairline ' +
    'shadow-ds-md rounded-[2px] torn-top overflow-hidden';

  // ---------------- Reduced-motion: simple fade swap ----------------
  if (prefersReducedMotion) {
    return (
      <div
        ref={rootRef}
        data-testid={`index-card-${citationIndex ?? index}`}
        className={`relative pt-2 ${className}`}
        style={activeStyles}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {isTopMatch && <Paperclip />}

        <button
          type="button"
          aria-pressed={isFlipped}
          aria-label={isFlipped ? `Back of card: ${documentName}` : `Card: ${documentName}, ${pct}% relevance. Press to see full text.`}
          onClick={handleFlip}
          onKeyDown={handleKeyDown}
          className={`${cardSurface} text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-ds-stamp focus-visible:outline-offset-2`}
          style={{
            transition: 'all 200ms ease',
          }}
        >
          {/* Stamp badge — with 'match' label for clarity */}
          <div
            className={`absolute top-3 right-3 stamp-badge rounded-full w-9 h-9 flex items-center justify-center text-[10px] font-mono font-bold ${stampBg}`}
            aria-hidden="true"
            title={`${pct}% relevance match to your query`}
          >
            {pct}%
          </div>

          {!isFlipped ? (
            // Front
            <div data-testid="index-card-front" className="p-3 pt-4">
              <div className="flex items-center gap-1.5 mb-2 pr-10">
                <DocTypeIcon name={documentName} />
                <span className="text-ds-xs font-body font-medium text-ds-text-primary truncate">
                  {documentName}{chunkRef ? ` · ${chunkRef}` : ''}
                </span>
              </div>
              <p className="text-ds-xs font-mono text-ds-text-secondary leading-relaxed line-clamp-3">
                {chunkText}
              </p>
            </div>
          ) : (
            // Back
            <div data-testid="index-card-back" className="p-3 pt-4 h-full flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-mono text-ds-text-muted uppercase tracking-widest">
                  Full text
                </span>
                <span className="text-[10px] font-body text-ds-stamp flex items-center gap-1">
                  <ArrowLeft size={10} aria-hidden="true" />
                  Back
                </span>
              </div>
              <p className="text-ds-xs font-mono text-ds-text-secondary leading-relaxed overflow-y-auto flex-1 max-h-48">
                {chunkText}
              </p>
            </div>
          )}
        </button>
      </div>
    );
  }

  // ---------------- Full 3D flip animation ----------------
  return (
    <div
      ref={rootRef}
      data-testid={`index-card-${citationIndex ?? index}`}
      className={`relative pt-2 card-scene ${className}`}
      style={activeStyles}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {isTopMatch && <Paperclip />}

      {/* Stamp badge — on top of scene (always visible) */}
      <div
        className={`absolute top-5 right-3 z-20 stamp-badge rounded-full w-9 h-9 flex items-center justify-center text-[10px] font-mono font-bold ${stampBg} shadow-ds-stamp`}
        aria-hidden="true"
        title={`${pct}% relevance match to your query`}
        style={{
          transition: 'background 150ms ease',
        }}
      >
        {pct}%
      </div>

      {/* 3D flip container */}
      <div
        className={`card-flipper w-full ${isFlipped ? 'is-flipped' : ''}`}
        style={{ minHeight: '140px' }}
      >
        {/* Front face */}
        <button
          id={frontId}
          data-testid="index-card-front"
          type="button"
          aria-pressed={isFlipped}
          aria-label={`Card: ${documentName}, ${pct}% relevance. Press to see full text.`}
          onClick={handleFlip}
          onKeyDown={handleKeyDown}
          className={`card-face w-full text-left cursor-pointer ${cardSurface} focus-visible:outline-2 focus-visible:outline-ds-stamp focus-visible:outline-offset-2`}
        >
          <div className="p-3 pt-4">
            <div className="flex items-center gap-1.5 mb-2 pr-10">
              <DocTypeIcon name={documentName} />
              <span className="text-ds-xs font-body font-medium text-ds-text-primary truncate">
                {documentName}{chunkRef ? ` · ${chunkRef}` : ''}
              </span>
            </div>
            <p className="text-ds-xs font-mono text-ds-text-secondary leading-relaxed line-clamp-3">
              {chunkText}
            </p>
          </div>
        </button>

        {/* Back face */}
        <button
          id={backId}
          data-testid="index-card-back"
          type="button"
          aria-pressed={isFlipped}
          aria-label={`Back of card: ${documentName}. Press to return to front.`}
          onClick={handleFlip}
          onKeyDown={handleKeyDown}
          className={`card-face card-face-back text-left cursor-pointer ${cardSurface} focus-visible:outline-2 focus-visible:outline-ds-stamp focus-visible:outline-offset-2`}
        >
          <div className="p-3 pt-4 h-full flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono text-ds-text-muted uppercase tracking-widest">
                Full text · {documentName}
              </span>
            </div>
            <p className="text-ds-xs font-mono text-ds-text-secondary leading-relaxed overflow-y-auto flex-1 max-h-48">
              {chunkText}
            </p>
            <div className="mt-2 pt-2 border-t border-ds-hairline flex items-center gap-1 text-[10px] font-body text-ds-stamp">
              <ArrowLeft size={10} aria-hidden="true" />
              <span>Back</span>
            </div>
          </div>
        </button>
      </div>
    </div>
  );
}
