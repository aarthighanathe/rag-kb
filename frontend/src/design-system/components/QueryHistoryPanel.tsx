/**
 * @file QueryHistoryPanel.tsx
 * @description Collapsible panel showing recent query history
 *   with one-click re-run and individual delete support.
 * @author [Author Placeholder]
 * @created 2026-07-01
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
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
}

/**
 * Maps confidence level to a dot color.
 * @param level - Confidence level
 * @returns CSS color string
 */
function getConfidenceDotColor(level: HistoryEntry['confidenceLevel']): string {
  switch (level) {
    case 'high':     return '#2D5A4A';
    case 'medium':   return '#D68910';
    case 'low':      return '#FF4D2E';
    case 'very-low': return '#FF4D2E';
    case 'none':
    default:         return '#8A8578';
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
}: QueryHistoryPanelProps): React.JSX.Element {
  const [internalExpanded, setInternalExpanded] = useState(entries.length > 0);
  const isControlled = controlledOpen !== undefined && onToggle !== undefined;
  const isExpanded = isControlled ? controlledOpen : internalExpanded;
  const [confirmingClear, setConfirmingClear] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

      {/* Entries list */}
      {isExpanded && (
        <div
          id="history-entries-list"
          role="list"
          aria-label="Query history"
        >
          {entries.length === 0 ? (
            <p
              style={{
                padding: '10px 18px',
                fontFamily: "'Space Mono', monospace",
                fontSize: '10px',
                color: '#8A8578',
                fontStyle: 'italic',
              }}
            >
              No recent queries yet.
            </p>
          ) : (
            <>
              {entries.map((entry) => (
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

                  {/* Delete button — visible on hover */}
                  {!isStreaming && (
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

              {/* Clear all button */}
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
            </>
          )}
        </div>
      )}
    </div>
  );
}
