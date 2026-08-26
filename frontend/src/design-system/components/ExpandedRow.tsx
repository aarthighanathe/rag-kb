/**
 * @file ExpandedRow.tsx
 * @description Table-view expanded row detail for a document on the Documents page —
 *   shows a preview of the first few chunks.
 * @author [Author Placeholder]
 * @created 2026-08-24
 */

import React from 'react';
import type { DocumentRecord } from '../../services/api';
import { TagEditor } from './TagEditor';

/**
 * Expanded detail row shown beneath a document's table row when toggled open.
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
          ) : (
            <>
              <p className="text-ds-xs font-mono text-ds-text-muted mb-2">
                First {Math.min(3, doc.chunk_count)} of {doc.chunk_count} chunks
              </p>
              <div className="space-y-2">
                {[1, 2, 3]
                  .filter((n) => n <= doc.chunk_count)
                  .map((n) => (
                    <div
                      key={n}
                      className="bg-ds-card border border-ds-hairline rounded-[2px] px-3 py-2"
                    >
                      <span className="text-[10px] font-mono text-ds-archive">Chunk {n}</span>
                      <p className="text-ds-xs font-mono text-ds-text-muted mt-0.5 italic">
                        (Query the document to see content)
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
