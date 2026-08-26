/**
 * @file StatusBar.tsx
 * @description Inline streaming-status indicator shown below the Chat page's message
 *   list while a query is searching, has found sources, or is generating an answer.
 * @author [Author Placeholder]
 * @created 2026-08-24
 */

import React from 'react';
import { LoadingSpinner } from './LoadingSpinner';

export type StreamPhase = 'idle' | 'searching' | 'found' | 'generating';

/**
 * Compact status pill reflecting the current query streaming phase.
 * @param phase - Current streaming phase
 * @param foundCount - Number of relevant passages found, shown during the 'found' phase
 * @returns Status bar element, or null while idle
 */
export function StatusBar({
  phase,
  foundCount,
}: {
  phase: StreamPhase;
  foundCount?: number;
}): React.JSX.Element | null {
  if (phase === 'idle') return null;
  return (
    <div className="flex justify-center px-7 pb-2 shrink-0">
      <div
        className="bg-ds-card border border-ds-hairline text-ds-text-muted font-mono text-[10px] px-3.5 py-1 flex items-center gap-2"
        aria-live="polite"
        aria-atomic="true"
      >
        <LoadingSpinner size="sm" />
        {phase === 'searching' && <span>◉ Searching your documents…</span>}
        {phase === 'found' && (
          <span className="text-ds-archive font-medium">
            ◉ Found {foundCount ?? 0} relevant {foundCount === 1 ? 'passage' : 'passages'}
          </span>
        )}
        {phase === 'generating' && <span>◉ Writing answer…</span>}
      </div>
    </div>
  );
}
