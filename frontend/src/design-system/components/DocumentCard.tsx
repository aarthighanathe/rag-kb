/**
 * @file DocumentCard.tsx
 * @description Card-catalog grid card for a single document on the Documents page.
 * @author [Author Placeholder]
 * @created 2026-08-24
 */

import React from 'react';
import { Trash2 } from 'lucide-react';
import type { DocumentRecord } from '../../services/api';
import {
  extFromMime,
  fmtBytes,
  fmtDate,
  fmtDateTime,
  STATUS_BADGE,
} from '../../utils/documentFormatters';
import { Badge } from './Badge';

/**
 * Grid-view card representing a single document in the archive.
 * @param doc - Document record to render
 * @param selected - Whether this card's checkbox is checked
 * @param onSelect - Toggles this card's selection state
 * @param onDelete - Initiates deletion of this document
 * @param isDuplicateName - True if another document shares this filename
 * @returns Document card element
 */
export function DocumentCard({
  doc,
  selected,
  onSelect,
  onDelete,
  isDuplicateName,
}: {
  doc: DocumentRecord;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  isDuplicateName: boolean;
}): React.JSX.Element {
  const badge = STATUS_BADGE[doc.status];
  const ext = extFromMime(doc.mime_type, doc.filename).toUpperCase();

  return (
    <div
      data-testid="document-card"
      className={`
        relative bg-ds-card border rounded-[2px] px-4 py-4
        transition-all duration-ds-normal
        ${selected ? 'border-ds-stamp shadow-ds-stamp' : 'border-ds-hairline hover:border-ds-stamp/40 hover:shadow-ds-sm'}
      `}
      aria-selected={selected}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onSelect}
        className="accent-[#FF4D2E] absolute top-3 left-3 h-3.5 w-3.5 rounded-none"
        aria-label={`Select ${doc.filename}`}
      />

      <div className="flex items-start justify-between mb-3 pl-5">
        <Badge variant="default" size="sm">
          {ext}
        </Badge>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${doc.filename}`}
          className="text-ds-text-muted hover:text-ds-error transition-colors -mt-1 -mr-1"
        >
          <Trash2 size={12} />
        </button>
      </div>

      <p className="text-ds-sm font-body font-medium text-ds-text-primary truncate mb-1 pl-5">
        {doc.filename}
      </p>

      <p className="text-[10px] font-mono text-ds-text-muted pl-5">
        {doc.chunk_count > 0
          ? `${doc.chunk_count === 1 ? '1 chunk' : `${doc.chunk_count} chunks`} · `
          : ''}
        {fmtBytes(doc.size_bytes)} · {fmtDate(doc.created_at)}
      </p>
      {isDuplicateName && (
        <p className="text-[10px] font-mono text-ds-stamp pl-5 mt-0.5">
          Uploaded {fmtDateTime(doc.created_at)} · id {doc.id.slice(0, 8)}
        </p>
      )}

      <div className="flex items-center mt-3 pl-5">
        <Badge variant={badge.variant} size="sm" dot>
          {badge.label}
        </Badge>
      </div>

      {doc.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2 pl-5">
          {doc.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} variant="default" size="sm">
              {tag}
            </Badge>
          ))}
          {doc.tags.length > 3 && (
            <span className="text-[10px] font-mono text-ds-text-muted self-center">
              +{doc.tags.length - 3}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
