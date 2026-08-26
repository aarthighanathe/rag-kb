/**
 * @file QueryHistoryPanel.tsx
 * @description Collapsible panel showing recent query history
 *   with one-click re-run and individual delete support.
 * @author [Author Placeholder]
 * @created 2026-07-01
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react';
import type { HistoryEntry } from '../../utils/queryHistory';
import { timeAgo } from '../../utils/timeAgo';

export interface QueryHistoryPanelProps {
  /** History entries, most recent first */
  entries: HistoryEntry[];
  /** Called when user clicks an entry to re-run the query */
  onRerun: (query: string) => void;
  /** Called when user removes a single entry */
  onRemove: (id: string) => void;
  /** Called when user clears all history */
  onClear: () => void;
  /** Whether streaming is in progress (disables interactions) */
  isStreaming: boolean;
  /** Optional controlled expanded state (when provided, onToggle must also be provided) */
  open?: boolean;
  /** Optional toggle handler for controlled expanded state */
  onToggle?: () => void;
  /**
   * Optional backend search over the caller's full query history (not just
   * the local entries prop, which is capped to the last 10). When provided,
   * a search input renders above the entry list; typing a term calls this
   * with the debounced search text and swaps the displayed list to
   * `searchResults` until the search box is cleared, at which point the
   * panel reverts to showing `entries` as before. Omit both props entirely
   * to keep the panel's original local-only behavior unchanged.
   */
  onSearch?: (query: string) => void;
  /** Search results to display while a search term is active (ignored if `onSearch` is not provided). */
  searchResults?: HistoryEntry[];
  /** Whether a search request is in flight. */
  searchLoading?: boolean;
}

/**
 * Maps confidence level to a dot color.
 * @param level - Confidence level
 * @returns CSS color string
 */
function getConfidenceDotColor(level: HistoryEntry['confidenceLevel']): string {
  switch (level) {
    case 'high':
      return '#2D5A4A';
    case 'medium':
      return '#D68910';
    case 'low':
      return '#FF4D2E';
    case 'very-low':
      return '#FF4D2E';
    case 'none':
    default:
      return '#8A8578';
  }
}

/**
 * Query history panel with collapsible section, entry rows, and clear-all.
 * @param entries - History entries to display
 * @param onRerun - Handler for re-running a query
 * @param onRemove - Handler for removing an entry
 * @param onClear - Handler for clearing all history
 * @param isStreaming - Disables all interactions when true
 */
export function QueryHistoryPanel({
  entries,
  onRerun,
  onRemove,
  onClear,
  isStreaming,
  open: controlledOpen,
  onToggle,
  onSearch,
  searchResults,
  searchLoading,
}: QueryHistoryPanelProps): React.JSX.Element {
  const [internalExpanded, setInternalExpanded] = useState(entries.length > 0);
  const isControlled = controlledOpen !== undefined && onToggle !== undefined;
  const isExpanded = isControlled ? controlledOpen : internalExpanded;
  const [confirmingClear, setConfirmingClear] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [searchText, setSearchText] = useState('');
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSearchActive = onSearch !== undefined && searchText.trim().length > 0;
  const displayedEntries = isSearchActive ? (searchResults ?? []) : entries;

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchText(value);
      if (!onSearch) return;
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = setTimeout(() => onSearch(value), 300);
    },
    [onSearch],
  );

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, []);

  // Auto-expand on mount when entries exist (uncontrolled mode only)
  const hasMountedRef = useRef(false);
  useEffect(() => {
    if (hasMountedRef.current) return;
    hasMountedRef.current = true;
    if (!isControlled && entries.length > 0 && !internalExpanded) {
      setInternalExpanded(true);
    }
  }, [entries.length, internalExpanded, isControlled]);

  // Cleanup confirm timer on unmount
  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  const handleToggle = useCallback(() => {
    if (isControlled && onToggle) {
      onToggle();
    } else {
      setInternalExpanded((prev) => !prev);
    }
  }, [isControlled, onToggle]);

  const handleClear = useCallback(() => {
    if (!confirmingClear) {
      setConfirmingClear(true);
      confirmTimerRef.current = setTimeout(() => {
        setConfirmingClear(false);
      }, 3000);
    } else {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      setConfirmingClear(false);
      onClear();
    }
  }, [confirmingClear, onClear]);

  const handleEntryClick = useCallback(
    (query: string) => {
      if (isStreaming) return;
      onRerun(query);
    },
    [isStreaming, onRerun],
  );

  const handleDelete = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      onRemove(id);
    },
    [onRemove],
  );

  const handleEntryKeyDown = useCallback(
    (e: React.KeyboardEvent, query: string) => {
      if (isStreaming) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onRerun(query);
      }
    },
    [isStreaming, onRerun],
  );

  const handleDeleteKeyDown = useCallback(
    (e: React.KeyboardEvent, id: string) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        onRemove(id);
      }
    },
    [onRemove],
  );

  return (
    <div
      data-testid="history-section"
      style={{
        background: '#1C1B19',
        borderTop: '1px solid #2C2B29',
        flexShrink: 0,
      }}
    >
      {/* Section header toggle */}
      <button
        type="button"
        data-testid="history-toggle"
        onClick={handleToggle}
        aria-expanded={isExpanded}
        aria-controls="history-entries-list"
        className="w-full flex items-center justify-between"
        style={{
          padding: '10px 18px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: '#8A8578',
          fontFamily: "'Space Mono', monospace",
          fontSize: '9px',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          transition: 'color 150ms ease',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = '#F7F5F0';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = '#8A8578';
        }}
      >
        <span>Recent queries</span>
        {isExpanded ? (
          <ChevronDown size={12} aria-hidden="true" />
        ) : (
          <ChevronRight size={12} aria-hidden="true" />
        )}
      </button>

      {/* Search input — only rendered when the caller opted in via onSearch;
          searches the full backend history, not just the local `entries`
          this panel otherwise shows (capped to the last 10). */}
      {isExpanded && onSearch && (
        <div style={{ padding: '0 18px 8px' }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search
              size={12}
              style={{ position: 'absolute', left: '8px', color: '#8A8578', pointerEvents: 'none' }}
              aria-hidden="true"
            />
            <input
              type="search"
              data-testid="history-search-input"
              aria-label="Search all past queries"
              placeholder="Search all past queries…"
              value={searchText}
              onChange={(e) => handleSearchChange(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 8px 6px 26px',
                background: '#141310',
                border: '1px solid #2C2B29',
                color: '#F7F5F0',
                fontFamily: "'Space Grotesk', sans-serif",
                fontSize: '11px',
                outline: 'none',
              }}
            />
          </div>
        </div>
      )}

      {/* Entries list */}
      {isExpanded && (
        <div id="history-entries-list" role="list" aria-label="Query history">
          {isSearchActive && searchLoading ? (
            <p
              style={{
                padding: '10px 18px',
                fontFamily: "'Space Mono', monospace",
                fontSize: '10px',
                color: '#8A8578',
                fontStyle: 'italic',
              }}
            >
              Searching…
            </p>
          ) : displayedEntries.length === 0 ? (
            <p
              style={{
                padding: '10px 18px',
                fontFamily: "'Space Mono', monospace",
                fontSize: '10px',
                color: '#8A8578',
                fontStyle: 'italic',
              }}
            >
              {isSearchActive ? 'No past queries match your search.' : 'No recent queries yet.'}
            </p>
          ) : (
            <>
              {displayedEntries.map((entry) => (
                <div
                  key={entry.id}
                  data-testid="history-entry"
                  role="listitem"
                  tabIndex={isStreaming ? -1 : 0}
                  className="group"
                  onClick={() => handleEntryClick(entry.query)}
                  onKeyDown={(e) => handleEntryKeyDown(e, entry.query)}
                  style={{
                    position: 'relative',
                    padding: '10px 18px',
                    borderLeft: '3px solid transparent',
                    cursor: isStreaming ? 'not-allowed' : 'pointer',
                    opacity: isStreaming ? 0.5 : 1,
                    transition: 'all 150ms ease',
                  }}
                  onMouseEnter={(e) => {
                    if (isStreaming) return;
                    (e.currentTarget as HTMLDivElement).style.borderLeftColor = '#FF4D2E';
                    (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,77,46,0.04)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLDivElement).style.borderLeftColor = 'transparent';
                    (e.currentTarget as HTMLDivElement).style.background = 'transparent';
                  }}
                >
                  {/* Query text */}
                  <p
                    style={{
                      fontFamily: "'Space Grotesk', sans-serif",
                      fontSize: '12px',
                      color: '#B8B4AC',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: 'calc(100% - 28px)',
                    }}
                  >
                    {entry.query}
                  </p>

                  {/* Metadata row */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      marginTop: '2px',
                      fontFamily: "'Space Mono', monospace",
                      fontSize: '9px',
                      color: 'rgba(184,180,172,0.7)',
                    }}
                  >
                    {/* Confidence dot */}
                    <span
                      style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        background: getConfidenceDotColor(entry.confidenceLevel),
                        flexShrink: 0,
                      }}
                      aria-label={`Confidence: ${entry.confidenceLevel}`}
                    />
                    <span>{entry.citationCount} sources</span>
                    <span>·</span>
                    <span>{timeAgo(entry.timestamp)}</span>
                  </div>

                  {/* Delete button — visible on hover. Hidden while showing
                      backend search results: those rows aren't part of the
                      local 10-entry cache onRemove operates on. */}
                  {!isStreaming && !isSearchActive && (
                    <button
                      type="button"
                      data-testid="history-delete"
                      onClick={(e) => handleDelete(e, entry.id)}
                      onKeyDown={(e) => handleDeleteKeyDown(e, entry.id)}
                      aria-label="Remove from history"
                      className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-stamp"
                      style={{
                        position: 'absolute',
                        right: '14px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        width: '28px',
                        height: '28px',
                        minWidth: '28px',
                        minHeight: '28px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'none',
                        border: 'none',
                        color: '#8A8578',
                        cursor: 'pointer',
                        fontFamily: "'Space Mono', monospace",
                        fontSize: '11px',
                        transition: 'opacity 150ms ease, color 150ms ease',
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.color = '#FF4D2E';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.color = '#8A8578';
                      }}
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  )}
                </div>
              ))}

              {/* Clear all button — hidden while showing backend search
                  results, since onClear only clears the local 10-entry cache. */}
              {!isSearchActive && (
                <button
                  type="button"
                  data-testid="history-clear"
                  onClick={handleClear}
                  aria-label="Clear all query history"
                  style={{
                    width: '100%',
                    padding: '8px 18px',
                    background: 'none',
                    border: 'none',
                    borderTop: '1px solid #2C2B29',
                    cursor: 'pointer',
                    fontFamily: "'Space Mono', monospace",
                    fontSize: '9px',
                    color: confirmingClear ? '#FF4D2E' : '#8A8578',
                    textAlign: 'center',
                    transition: 'color 150ms ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!confirmingClear) {
                      (e.currentTarget as HTMLButtonElement).style.color = '#FF4D2E';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!confirmingClear) {
                      (e.currentTarget as HTMLButtonElement).style.color = '#8A8578';
                    }
                  }}
                >
                  {confirmingClear ? 'Sure? Click to clear all' : 'Clear all'}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
