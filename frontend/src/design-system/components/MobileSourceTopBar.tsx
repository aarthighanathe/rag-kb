/**
 * @file MobileSourceTopBar.tsx
 * @description Compact horizontal source bar shown above chat on mobile viewports
 *   (replaces the desktop sidebar at <=768px). Opens the mobile sources drawer.
 * @author [Author Placeholder]
 * @created 2026-08-24
 */

import React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { pluralize } from '../../utils/pluralize';

interface MobileSourceTopBarProps {
  readyCount: number;
  selectedCount: number;
  onOpen: () => void;
}

/**
 * Compact horizontal source bar shown above chat on mobile viewports.
 * @param readyCount - Number of ready documents available
 * @param selectedCount - Number of currently selected document IDs
 * @param onOpen - Opens the full sources drawer
 * @returns Mobile-only top bar element
 */
export function MobileSourceTopBar({
  readyCount,
  selectedCount,
  onOpen,
}: MobileSourceTopBarProps): React.JSX.Element {
  const summary =
    selectedCount > 0
      ? `${selectedCount} of ${readyCount} selected`
      : `${pluralize(readyCount, 'source')} available`;

  return (
    <div
      className="md:hidden flex-shrink-0"
      style={{ background: '#1C1B19', borderBottom: '1px solid #2C2B29' }}
      data-testid="mobile-source-top-bar"
    >
      <button
        type="button"
        onClick={onOpen}
        className="w-full flex items-center justify-between gap-3"
        style={{
          padding: '14px 16px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          minHeight: '56px',
        }}
        aria-label="Open source documents filter"
      >
        <div style={{ minWidth: 0, textAlign: 'left' }}>
          <p
            className="font-display"
            style={{ fontSize: '14px', fontWeight: 900, color: '#F7F5F0', marginBottom: '1px' }}
          >
            Card Catalog
          </p>
          <p
            style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: '10px',
              color: '#8A8578',
            }}
          >
            {summary}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {selectedCount > 0 && (
            <span
              style={{
                background: '#FF4D2E',
                color: '#FFFFFF',
                fontFamily: "'Space Mono', monospace",
                fontSize: '10px',
                borderRadius: '50%',
                width: '18px',
                height: '18px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              aria-hidden="true"
            >
              {selectedCount}
            </span>
          )}
          <SlidersHorizontal size={16} style={{ color: '#8A8578' }} aria-hidden="true" />
        </div>
      </button>
    </div>
  );
}
