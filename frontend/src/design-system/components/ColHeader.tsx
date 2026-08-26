/**
 * @file ColHeader.tsx
 * @description Sortable table column header for the Documents page's table view.
 * @author [Author Placeholder]
 * @created 2026-08-24
 */

import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

export type SortKey = 'filename' | 'created_at' | 'status';
export type SortDir = 'asc' | 'desc';

/**
 * Table column header, optionally sortable — renders a sort button with an
 * active-direction chevron when `sortable` and `col` are provided.
 * @param label - Column display label
 * @param sortable - Whether this column can be sorted
 * @param col - Sort key this column corresponds to
 * @param sortKey - Currently active sort key
 * @param sortDir - Currently active sort direction
 * @param onSort - Invoked with `col` when the header is activated
 * @returns Table header cell element
 */
export function ColHeader({
  label,
  sortable = false,
  col,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  sortable?: boolean;
  col?: SortKey;
  sortKey?: SortKey;
  sortDir?: SortDir;
  onSort?: (k: SortKey) => void;
}): React.JSX.Element {
  const isActive = sortable && !!col && col === sortKey;
  const ariaSort = isActive ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined;

  if (!sortable || !col || !onSort) {
    return (
      <th
        scope="col"
        className="px-4 py-3 text-left text-ds-xs font-body text-ds-text-muted uppercase tracking-ds-wider whitespace-nowrap"
      >
        {label}
      </th>
    );
  }

  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className="px-4 py-3 text-left text-ds-xs font-body text-ds-text-muted uppercase tracking-ds-wider whitespace-nowrap"
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        className="flex items-center gap-1 hover:text-ds-text-primary transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-stamp focus-visible:ring-offset-1"
        aria-label={`Sort by ${label}${isActive ? `, currently sorted ${sortDir === 'asc' ? 'ascending' : 'descending'}` : ''}`}
      >
        {label}
        {isActive &&
          (sortDir === 'asc' ? (
            <ChevronUp size={11} aria-hidden="true" />
          ) : (
            <ChevronDown size={11} aria-hidden="true" />
          ))}
      </button>
    </th>
  );
}
