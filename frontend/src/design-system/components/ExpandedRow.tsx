/**
 * @file ExpandedRow.tsx
 * @description Table-view expanded row detail for a document on the Documents page —
 *   shows a preview of the first few chunks.
 * @author [Author Placeholder]
 * @created 2026-08-24
 */

import React, { useEffect, useState } from 'react';
import type { ChunkPreview, DocumentRecord } from '../../services/api';
import { getDocumentChunkPreviews, extractErrorMessage } from '../../services/api';
import { clientLog } from '../../utils/clientLogger';
import { TagEditor } from './TagEditor';
import { LoadingSpinner } from './LoadingSpinner';

/**
 * Expanded detail row shown beneath a document's table row when toggled open.
 * Fetches real chunk previews from GET /api/documents/:id/chunks on mount —
 * this component only mounts while its row is expanded (see Documents.tsx),
 * so the fetch is already naturally lazy without an extra "load more" click.
 * @param doc - Document whose details are being shown
 * @param colSpan - Number of columns the detail cell should span
 * @returns Expanded row element
 */
export function ExpandedRow({
  doc,
  colSpan,
}: {
  doc: DocumentRecord;
  colSpan: number;
}): React.JSX.Element {
  const [chunks, setChunks] = useState<ChunkPreview[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (doc.chunk_count === 0) return;

    let cancelled = false;
    setChunks(null);
    setError(null);

    getDocumentChunkPreviews(doc.id)
      .then((result) => {
        if (!cancelled) setChunks(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        clientLog('error', '[ExpandedRow] Failed to load chunk previews', err);
        setError(extractErrorMessage(err));
      });

    return () => {
      cancelled = true;
    };
  }, [doc.id, doc.chunk_count]);

  return (
    <tr>
      <td colSpan={colSpan} className="px-4 pb-4 pt-0 bg-ds-base">
        <div className="border border-ds-hairline rounded-[2px] p-4">
          <div className="mb-3 pb-3 border-b border-ds-hairline">
            <TagEditor doc={doc} />
          </div>
          {doc.chunk_count === 0 ? (
            <p className="text-ds-xs font-body text-ds-text-muted italic">
              No chunks yet — still processing.
            </p>
          ) : error ? (
            <p className="text-ds-xs font-body text-ds-error">
              Couldn&apos;t load chunk previews: {error}
            </p>
          ) : chunks === null ? (
            <div className="flex items-center gap-2 py-2">
              <LoadingSpinner size="sm" label="Loading chunk previews…" />
              <span className="text-ds-xs font-mono text-ds-text-muted">Loading chunks…</span>
            </div>
          ) : (
            <>
              <p className="text-ds-xs font-mono text-ds-text-muted mb-2">
                First {chunks.length} of {doc.chunk_count} chunks
              </p>
              <div className="space-y-2">
                {chunks.map((chunk) => (
                  <div
                    key={chunk.id}
                    className="bg-ds-card border border-ds-hairline rounded-[2px] px-3 py-2"
                  >
                    <span className="text-[10px] font-mono text-ds-archive">
                      Chunk {chunk.chunkIndex + 1}
                    </span>
                    <p className="text-ds-xs font-mono text-ds-text-muted mt-0.5">
                      {chunk.contentPreview || <span className="italic">(empty chunk)</span>}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
          {doc.error_message && (
            <p className="text-ds-xs font-body text-ds-error mt-2">{doc.error_message}</p>
          )}
        </div>
      </td>
    </tr>
  );
}
