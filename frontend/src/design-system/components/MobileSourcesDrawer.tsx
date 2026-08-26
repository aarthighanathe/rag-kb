/**
 * @file MobileSourcesDrawer.tsx
 * @description Mobile off-canvas drawer combining the source-document filter and
 *   query history panel, opened from MobileSourceTopBar on the Chat page.
 * @author [Author Placeholder]
 * @created 2026-08-24
 */

import React, { useRef } from 'react';
import { X } from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { DocFilterPanel, type DocFilterPanelProps } from './DocFilterPanel';
import { QueryHistoryPanel } from './QueryHistoryPanel';

/**
 * Off-canvas drawer (mobile only) combining the document filter and query
 * history panels behind a single "Sources" entry point.
 * @param open - Whether the drawer is open
 * @param onClose - Closes the drawer
 * @param selectedIds - Currently selected document IDs
 * @param onToggle - Toggles a single document's selection
 * @param onSelectAll - Selects or clears all ready documents
 * @param historyEntries - Query history entries to render
 * @param isStreaming - Whether a query is currently streaming
 * @param onRerun - Re-runs a past query
 * @param onDeleteHistory - Removes a single history entry
 * @param onClearHistory - Clears all history entries
 * @param onSearchHistory - Searches the durable backend query history
 * @param historySearchResults - Results of the backend history search
 * @param historySearchLoading - Whether a backend history search is in flight
 * @returns Mobile sources drawer element, or null while closed
 */
export function MobileSourcesDrawer({
  open,
  onClose,
  selectedIds,
  onToggle,
  onSelectAll,
  historyEntries,
  isStreaming,
  onRerun,
  onDeleteHistory,
  onClearHistory,
  onSearchHistory,
  historySearchResults,
  historySearchLoading,
}: DocFilterPanelProps & {
  open: boolean;
  onClose: () => void;
  historyEntries: import('../../utils/queryHistory').HistoryEntry[];
  isStreaming: boolean;
  onRerun: (query: string) => void;
  onDeleteHistory: (id: string) => void;
  onClearHistory: () => void;
  onSearchHistory: (query: string) => void;
  historySearchResults: import('../../utils/queryHistory').HistoryEntry[];
  historySearchLoading: boolean;
}): React.JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus trap must run unconditionally (hooks rule) — it internally no-ops
  // while `open` is false, matching Modal.tsx's behavior for a real dialog:
  // traps Tab/Shift+Tab, moves focus in on open, restores it on close, and
  // closes on Escape.
  useFocusTrap(dialogRef, { open, onClose });

  if (!open) return null;
  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-ds-overlay md:hidden"
      role="dialog"
      aria-label="Source documents"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <aside
        className="absolute left-0 top-0 bottom-0 w-64 flex flex-col shadow-ds-lifted animate-slide-up"
        style={{ background: '#1C1B19' }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px',
            borderBottom: '1px solid #2C2B29',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: '13px',
              fontWeight: 700,
              color: '#F7F5F0',
            }}
          >
            Sources
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sources panel"
            style={{
              color: '#8A8578',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <X size={16} />
          </button>
        </div>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ flexShrink: 0 }}>
            <DocFilterPanel
              selectedIds={selectedIds}
              onToggle={onToggle}
              onSelectAll={onSelectAll}
            />
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <QueryHistoryPanel
              entries={historyEntries}
              isStreaming={isStreaming}
              onRerun={onRerun}
              onRemove={onDeleteHistory}
              onClear={onClearHistory}
              onSearch={onSearchHistory}
              searchResults={historySearchResults}
              searchLoading={historySearchLoading}
            />
          </div>
        </div>
      </aside>
    </div>
  );
}
