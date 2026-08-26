/**
 * @file DocFilterPanel.tsx
 * @description Source-document catalog panel (dark sidebar) for the Chat page —
 *   lets the user select which ready documents a query should search.
 * @author [Author Placeholder]
 * @created 2026-08-24
 */

import React, { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useRagStore } from '../../stores/ragStore';
import { pluralize } from '../../utils/pluralize';
import { LoadingSpinner } from './LoadingSpinner';

export interface DocFilterPanelProps {
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: (all: boolean) => void;
}

/**
 * Dark sidebar listing ready documents with checkboxes to include/exclude
 * them from the next query.
 * @param selectedIds - Currently selected document IDs
 * @param onToggle - Toggles a single document's selection
 * @param onSelectAll - Selects or clears all ready documents
 * @returns Source catalog panel element
 */
export function DocFilterPanel({
  selectedIds,
  onToggle,
  onSelectAll,
}: DocFilterPanelProps): React.JSX.Element {
  const { documents, documentsLoading, fetchDocuments } = useRagStore(
    useShallow((s) => ({
      documents: s.documents,
      documentsLoading: s.documentsLoading,
      fetchDocuments: s.fetchDocuments,
    })),
  );
  const readyDocs = documents.filter((d) => d.status === 'ready');
  const allSelected = readyDocs.length > 0 && readyDocs.every((d) => selectedIds.has(d.id));

  useEffect(() => {
    void fetchDocuments();
  }, [fetchDocuments]);

  return (
    <aside
      style={{
        background: '#1C1B19',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
      aria-label="Source documents filter"
    >
      {/* Header */}
      <div style={{ padding: '16px 18px', borderBottom: '1px solid #2C2B29', flexShrink: 0 }}>
        <h2
          className="font-display"
          style={{ fontSize: '16px', fontWeight: 900, color: '#F7F5F0', marginBottom: '2px' }}
        >
          Sources
        </h2>
        <p
          style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '11px', color: '#8A8578' }}
        >
          Choose which documents to search
        </p>
      </div>

      {/* All documents row */}
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '11px 18px',
          background: allSelected ? '#242320' : 'transparent',
          borderLeft: allSelected ? '3px solid #FF4D2E' : '3px solid transparent',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        <input
          type="checkbox"
          checked={allSelected}
          onChange={(e) => onSelectAll(e.target.checked)}
          style={{ accentColor: '#FF4D2E', width: '14px', height: '14px', flexShrink: 0 }}
          aria-label="Select all documents"
        />
        <span
          style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: '13px',
            fontWeight: 600,
            color: '#F7F5F0',
            flex: 1,
          }}
        >
          All documents
        </span>
        <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '9px', color: '#8A8578' }}>
          {readyDocs.length}
        </span>
        {documentsLoading && <LoadingSpinner size="sm" />}
      </label>

      {/* Individual doc list */}
      <ul
        style={{ flex: 1, overflowY: 'auto', listStyle: 'none', padding: 0, margin: 0 }}
        role="list"
      >
        {readyDocs.length === 0 && !documentsLoading && (
          <li
            style={{
              padding: '32px 18px',
              textAlign: 'center',
              fontFamily: "'Space Mono', monospace",
              fontSize: '11px',
              color: '#8A8578',
              fontStyle: 'italic',
            }}
          >
            No ready documents yet.
            <br />
            Upload and process files first.
          </li>
        )}
        {readyDocs.map((doc) => {
          const checked = selectedIds.has(doc.id);
          return (
            <li key={doc.id} role="listitem">
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  padding: '10px 18px',
                  borderLeft: checked ? '3px solid rgba(255,77,46,0.6)' : '3px solid transparent',
                  cursor: 'pointer',
                  borderBottom: '1px solid rgba(44,43,41,0.6)',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(doc.id)}
                  style={{
                    accentColor: '#FF4D2E',
                    width: '14px',
                    height: '14px',
                    marginTop: '1px',
                    flexShrink: 0,
                  }}
                  aria-label={`Include ${doc.filename}`}
                />
                <div style={{ minWidth: 0 }}>
                  <p
                    style={{
                      fontFamily: "'Space Grotesk', sans-serif",
                      fontSize: '12px',
                      color: checked ? '#F7F5F0' : '#8A8578',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {doc.filename}
                  </p>
                  <p
                    style={{
                      fontFamily: "'Space Mono', monospace",
                      fontSize: '9px',
                      color: '#B8B4AC',
                    }}
                  >
                    {doc.chunk_count} {doc.chunk_count === 1 ? 'passage' : 'passages'}
                  </p>
                </div>
              </label>
            </li>
          );
        })}
      </ul>

      {/* Footer */}
      <div
        style={{
          marginTop: 'auto',
          borderTop: '1px solid #2C2B29',
          padding: '12px 18px',
          flexShrink: 0,
        }}
      >
        <p style={{ fontFamily: "'Space Mono', monospace", fontSize: '10px', color: '#8A8578' }}>
          {pluralize(readyDocs.length, 'document')} ·{' '}
          {pluralize(
            readyDocs.reduce((s, d) => s + d.chunk_count, 0),
            'passage',
          )}{' '}
          indexed
        </p>
      </div>
    </aside>
  );
}
