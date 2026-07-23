/**
 * @file Documents.tsx
 * @description Documents management page — Lab Notebook theme.
 *   Card-catalog grid view by default (toggle to table), stats bar, custom-styled
 *   filters (Select component), bulk delete with Modal confirmation, inline chunk expansion.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import React, { useEffect, useCallback, useState, useRef, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import {
  RefreshCw, Trash2, ChevronDown, ChevronUp,
  FolderOpen, FileText, LayoutGrid, List, Network, WifiOff,
} from 'lucide-react';
import { Button } from '../design-system/components/Button';
import { Badge } from '../design-system/components/Badge';
import { Modal } from '../design-system/components/Modal';
import { EmptyState } from '../design-system/components/EmptyState';
import { LoadingSpinner } from '../design-system/components/LoadingSpinner';
import { Select } from '../design-system/components/Select';
import { useShallow } from 'zustand/react/shallow';
import { useRagStore } from '../stores/ragStore';
import { useAppToast } from '../contexts/ToastContext';
import { getDocumentSimilarity, type SimilarityPair, type DocumentRecord } from '../services/api';
import { pluralize } from '../utils/pluralize';


// Lazy-load the heavy relation map component
const LazyRelationMap = lazy(() =>
  import('../design-system/components/DocumentRelationMap').then((m) => ({ default: m.DocumentRelationMap })),
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SortKey      = 'filename' | 'created_at' | 'status';
type SortDir      = 'asc' | 'desc';
type StatusFilter = 'all' | DocumentRecord['status'];
type TypeFilter   = 'all' | 'pdf' | 'docx' | 'txt' | 'md';
type ViewMode     = 'grid' | 'table' | 'map';

// ---------------------------------------------------------------------------
// Filter option arrays for the custom Select component
// ---------------------------------------------------------------------------

const STATUS_OPTIONS = [
  { value: 'all',        label: 'All statuses' },
  { value: 'pending',    label: 'pending' },
  { value: 'processing', label: 'processing' },
  { value: 'ready',      label: 'ready' },
  { value: 'failed',     label: 'failed' },
];

const TYPE_OPTIONS = [
  { value: 'all',  label: 'All types' },
  { value: 'pdf',  label: 'PDF' },
  { value: 'docx', label: 'DOCX' },
  { value: 'txt',  label: 'TXT' },
  { value: 'md',   label: 'Markdown' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_BADGE: Record<DocumentRecord['status'], { variant: 'default' | 'success' | 'warning' | 'danger' | 'citation'; label: string }> = {
  pending:    { variant: 'default',  label: 'Pending' },
  processing: { variant: 'citation', label: 'Processing' },
  ready:      { variant: 'success',  label: 'Ready' },
  failed:     { variant: 'danger',   label: 'Failed' },
};

function extFromMime(mime: string, filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (ext) return ext;
  if (mime.includes('pdf'))      return 'pdf';
  if (mime.includes('wordproc')) return 'docx';
  if (mime.includes('markdown')) return 'md';
  return 'txt';
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024)      return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

/**
 * Returns true if any other document in the list shares this document's filename —
 * used to show a disambiguating detail (upload time, short ID) wherever duplicates exist.
 */
function hasFilenameCollision(doc: DocumentRecord, all: DocumentRecord[]): boolean {
  return all.some((other) => other.id !== doc.id && other.filename === doc.filename);
}

// ---------------------------------------------------------------------------
// Delete modal
// ---------------------------------------------------------------------------

function DeleteModal({ targets, onConfirm, onCancel, isDeleting }: {
  targets: DocumentRecord[];
  onConfirm: () => Promise<void>;
  onCancel: () => void;
  isDeleting: boolean;
}): React.JSX.Element {
  return (
    <Modal
      open
      onClose={onCancel}
      title={targets.length === 1 ? 'Remove document?' : `Remove ${targets.length} documents?`}
      subtitle="This action cannot be undone."
      preventBackdropClose={isDeleting}
      footer={
        <>
          <Button data-testid="cancel-delete" variant="secondary" onClick={onCancel} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            data-testid="confirm-delete"
            variant="danger"
            loading={isDeleting}
            onClick={() => void onConfirm()}
          >
            {isDeleting ? 'Removing…' : `Remove ${targets.length === 1 ? '1 document' : `${targets.length} documents`}`}
          </Button>
        </>
      }
    >
      <ul className="flex flex-col gap-1.5 text-ds-sm font-body text-ds-text-secondary max-h-40 overflow-y-auto">
        {targets.map((d) => (
          <li key={d.id} className="font-mono text-ds-xs">
            <span className="truncate block">· {d.filename}</span>
            <span className="text-ds-text-muted pl-3">
              {fmtDateTime(d.created_at)} · id {d.id.slice(0, 8)}
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Grid card
// ---------------------------------------------------------------------------

function DocumentCard({
  doc, selected, onSelect, onDelete, isDuplicateName,
}: {
  doc: DocumentRecord;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  isDuplicateName: boolean;
}): React.JSX.Element {
  const badge = STATUS_BADGE[doc.status];
  const ext   = extFromMime(doc.mime_type, doc.filename).toUpperCase();

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
        <Badge variant="default" size="sm">{ext}</Badge>
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
        {doc.chunk_count > 0 ? `${doc.chunk_count === 1 ? '1 chunk' : `${doc.chunk_count} chunks`} · ` : ''}
        {fmtBytes(doc.size_bytes)} · {fmtDate(doc.created_at)}
      </p>
      {isDuplicateName && (
        <p className="text-[10px] font-mono text-ds-stamp pl-5 mt-0.5">
          Uploaded {fmtDateTime(doc.created_at)} · id {doc.id.slice(0, 8)}
        </p>
      )}

      <div className="flex items-center mt-3 pl-5">
        <Badge variant={badge.variant} size="sm" dot>{badge.label}</Badge>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expanded row (table view)
// ---------------------------------------------------------------------------

function ExpandedRow({ doc, colSpan }: { doc: DocumentRecord; colSpan: number }): React.JSX.Element {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 pb-4 pt-0 bg-ds-base">
        <div className="border border-ds-hairline rounded-[2px] p-4">
          {doc.chunk_count === 0 ? (
            <p className="text-ds-xs font-body text-ds-text-muted italic">No chunks yet — still processing.</p>
          ) : (
            <>
              <p className="text-ds-xs font-mono text-ds-text-muted mb-2">
                First {Math.min(3, doc.chunk_count)} of {doc.chunk_count} chunks
              </p>
              <div className="space-y-2">
                {[1, 2, 3].filter((n) => n <= doc.chunk_count).map((n) => (
                  <div key={n} className="bg-ds-card border border-ds-hairline rounded-[2px] px-3 py-2">
                    <span className="text-[10px] font-mono text-ds-archive">Chunk {n}</span>
                    <p className="text-ds-xs font-mono text-ds-text-muted mt-0.5 italic">(Query the document to see content)</p>
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

// ---------------------------------------------------------------------------
// Sortable column header (table view)
// ---------------------------------------------------------------------------

function ColHeader({
  label, sortable = false, col,
  sortKey, sortDir, onSort,
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
      <th scope="col" className="px-4 py-3 text-left text-ds-xs font-body text-ds-text-muted uppercase tracking-ds-wider whitespace-nowrap">
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
        {isActive && (sortDir === 'asc'
          ? <ChevronUp size={11} aria-hidden="true" />
          : <ChevronDown size={11} aria-hidden="true" />)}
      </button>
    </th>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Documents management page — card-catalog grid by default with table toggle.
 * @returns Documents page JSX
 */
export function Documents(): React.JSX.Element {
  const { documents, documentsLoading, documentsError, fetchDocuments, deleteDocument } = useRagStore(
    useShallow((s) => ({
      documents: s.documents,
      documentsLoading: s.documentsLoading,
      documentsError: s.documentsError,
      fetchDocuments: s.fetchDocuments,
      deleteDocument: s.deleteDocument,
    })),
  );
  const { toast } = useAppToast();

  const [sortKey, setSortKey]               = useState<SortKey>('created_at');
  const [sortDir, setSortDir]               = useState<SortDir>('desc');
  const [statusFilter, setStatusFilter]     = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter]         = useState<TypeFilter>('all');
  const [expanded, setExpanded]             = useState<Set<string>>(new Set());
  const [selected, setSelected]             = useState<Set<string>>(new Set());
  const [deleteTargets, setDeleteTargets]   = useState<DocumentRecord[]>([]);
  const [isDeleting, setIsDeleting]         = useState(false);
  const [viewMode, setViewMode]             = useState<ViewMode>('grid');

  // ── Relation map state ──────────────────────────────────────────────────
  const [similarityPairs, setSimilarityPairs] = useState<SimilarityPair[]>([]);
  const [similarityLoading, setSimilarityLoading] = useState(false);
  const [similarityError, setSimilarityError] = useState<string | null>(null);

  useEffect(() => { void fetchDocuments(); }, [fetchDocuments]);

  // ── Fetch similarity data ─────────────────────────────────────────────
  const fetchSimilarity = useCallback(async () => {
    const readyDocs = documents.filter((d) => d.status === 'ready');
    if (readyDocs.length < 2) {
      setSimilarityPairs([]);
      return;
    }
    setSimilarityLoading(true);
    setSimilarityError(null);
    try {
      const { pairs } = await getDocumentSimilarity(0.3);
      setSimilarityPairs(pairs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to compute similarity';
      setSimilarityError(msg);
    } finally {
      setSimilarityLoading(false);
    }
  }, [documents]);

  // Auto-fetch once per map-view entry — a legitimate zero-pairs result must
  // not be mistaken for "stale" and re-trigger the fetch forever.
  const hasFetchedSimilarityRef = useRef(false);

  useEffect(() => {
    if (viewMode !== 'map') hasFetchedSimilarityRef.current = false;
  }, [viewMode]);

  useEffect(() => {
    if (viewMode === 'map' && !hasFetchedSimilarityRef.current && !similarityLoading) {
      hasFetchedSimilarityRef.current = true;
      void fetchSimilarity();
    }
  }, [viewMode, similarityLoading, fetchSimilarity]);

  const toggleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      else setSortDir('asc');
      return key;
    });
  }, []);

  const filtered = documents
    .filter((d) => statusFilter === 'all' || d.status === statusFilter)
    .filter((d) => typeFilter === 'all' || extFromMime(d.mime_type, d.filename) === typeFilter);

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'filename')   cmp = a.filename.localeCompare(b.filename);
    if (sortKey === 'created_at') cmp = a.created_at.localeCompare(b.created_at);
    if (sortKey === 'status')     cmp = a.status.localeCompare(b.status);
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const allChecked  = sorted.length > 0 && sorted.every((d) => selected.has(d.id));
  const someChecked = sorted.some((d) => selected.has(d.id));

  const toggleSelect    = useCallback((id: string) => {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(sorted.map((d) => d.id)));
  }, [allChecked, sorted]);

  const toggleExpand    = useCallback((id: string) => {
    setExpanded((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }, []);

  const initiateDelete  = useCallback((docs: DocumentRecord[]) => { setDeleteTargets(docs); }, []);

  const confirmDelete   = useCallback(async () => {
    setIsDeleting(true);
    let failed = 0;
    await Promise.all(
      deleteTargets.map(async (doc) => { try { await deleteDocument(doc.id); } catch { failed += 1; } }),
    );
    setIsDeleting(false);
    setDeleteTargets([]);
    setSelected((prev) => { const n = new Set(prev); deleteTargets.forEach((d) => n.delete(d.id)); return n; });
    if (failed === 0) {
      toast(`Removed ${deleteTargets.length} document${deleteTargets.length !== 1 ? 's' : ''}`, { variant: 'success' });
    } else {
      toast(`${failed} deletion(s) failed`, { variant: 'error' });
    }
  }, [deleteTargets, deleteDocument, toast]);

  const selectedDocs = sorted.filter((d) => selected.has(d.id));

  // A fetch failure with zero cached documents means we don't actually know the
  // archive's contents — that's distinct from a confirmed-empty archive, so it
  // gets its own state instead of the "no documents yet" empty state.
  const hasConnectionError = Boolean(documentsError) && documents.length === 0;

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: '#F7F5F0' }}>

      {/* Page header strip */}
      <div
        className="px-4 sm:px-8"
        style={{ background: '#FFFFFF', borderBottom: '1px solid #D8D4C8', padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', position: 'sticky', top: 0, zIndex: 10 }}
      >
        <div>
          <h1
            className="font-display"
            style={{ fontSize: '32px', fontWeight: 900, fontStyle: 'italic', color: '#1C1B19', letterSpacing: '-0.02em' }}
          >
            Archive
          </h1>
          <p style={{ fontFamily: "'Space Mono', monospace", fontSize: '11px', color: '#8A8578', marginTop: '2px' }}>
            {pluralize(documents.length, 'document')} · {pluralize(documents.reduce((s,d)=>s+d.chunk_count,0), 'chunk')} · {documents.filter(d=>d.status==='ready').length} ready
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', border: '1px solid #D8D4C8', overflow: 'hidden' }}>
            <button type="button" onClick={() => setViewMode('grid')} aria-label="Grid view" aria-pressed={viewMode === 'grid'}
              style={{ padding: '6px 10px', background: viewMode === 'grid' ? '#FF4D2E' : '#FFFFFF', color: viewMode === 'grid' ? '#FFFFFF' : '#8A8578', border: 'none', cursor: 'pointer' }}>
              <LayoutGrid size={14} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setViewMode('table')} aria-label="Table view" aria-pressed={viewMode === 'table'}
              style={{ padding: '6px 10px', background: viewMode === 'table' ? '#FF4D2E' : '#FFFFFF', color: viewMode === 'table' ? '#FFFFFF' : '#8A8578', border: 'none', cursor: 'pointer' }}>
              <List size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              data-testid="map-toggle"
              onClick={() => setViewMode('map')}
              aria-label="Relation map view"
              aria-pressed={viewMode === 'map'}
              style={{ padding: '6px 10px', background: viewMode === 'map' ? '#FF4D2E' : '#FFFFFF', color: viewMode === 'map' ? '#FFFFFF' : '#8A8578', border: 'none', cursor: 'pointer' }}
            >
              <Network size={14} aria-hidden="true" />
            </button>
          </div>

          {someChecked && (
            <Button variant="danger" size="sm" iconLeft={<Trash2 size={12} />}
              onClick={() => initiateDelete(selectedDocs)} aria-label={`Remove ${selectedDocs.length} selected document(s)`}>
              Remove {selectedDocs.length}
            </Button>
          )}
          <Button data-testid="refresh-button" variant="secondary" size="sm"
            iconLeft={<RefreshCw size={12} className={documentsLoading ? 'animate-spin' : ''} />}
            onClick={() => void fetchDocuments()} disabled={documentsLoading} aria-label="Refresh document list">
            Refresh
          </Button>
        </div>
      </div>

      {/* Full-width stats bar */}
      {documents.length > 0 && (
        <div
          className="grid grid-cols-2 sm:grid-cols-4"
          style={{ borderBottom: '1px solid #D8D4C8' }}
          aria-label="Document statistics"
        >
          {[
            { label: 'TOTAL DOCUMENTS', value: documents.length, color: '#1C1B19' },
            { label: 'INDEXED CHUNKS',  value: documents.reduce((s,d)=>s+d.chunk_count,0).toLocaleString(), color: '#1C1B19' },
            { label: 'READY TO QUERY', value: documents.filter(d=>d.status==='ready').length, color: '#2D5A4A' },
            { label: 'PROCESSING',     value: documents.filter(d=>d.status==='processing').length, color: documents.filter(d=>d.status==='processing').length > 0 ? '#FF4D2E' : '#B8B4AC' },
          ].map(({ label, value, color }, i, arr) => (
            <div key={label} style={{ background: '#FFFFFF', padding: '18px 32px', borderRight: i < arr.length-1 ? '1px solid #D8D4C8' : 'none' }}>
              <p style={{ fontFamily: "'Space Mono', monospace", fontSize: '28px', fontWeight: 700, color, lineHeight: 1.2 }}>{value}</p>
              <p style={{ fontFamily: "'Space Mono', monospace", fontSize: '10px', color: '#8A8578', letterSpacing: '0.1em', marginTop: '2px' }}>{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* A refresh failure with documents still on screen gets an inline banner —
          the table below is stale but not wrong, so it stays visible. */}
      {documentsError && documents.length > 0 && (
        <div
          style={{ margin: '16px 32px 0', padding: '12px 16px', background: '#FFEBEE', border: '1px solid #C0392B', fontFamily: "'Space Grotesk', sans-serif", fontSize: '14px', color: '#C0392B' }}
          role="alert"
        >
          {typeof documentsError === 'string' ? documentsError : 'An error occurred loading documents.'}
        </div>
      )}

      {/* Filters — hidden during a connection error since there is nothing loaded to filter */}
      {!hasConnectionError && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', padding: '16px 32px', alignItems: 'center' }} aria-label="Filters">
          <Select
            options={STATUS_OPTIONS}
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as StatusFilter)}
            aria-label="Filter by status"
            data-testid="status-filter"
          />
          <Select
            options={TYPE_OPTIONS}
            value={typeFilter}
            onChange={(v) => setTypeFilter(v as TypeFilter)}
            aria-label="Filter by file type"
            data-testid="type-filter"
          />
        </div>
      )}

      {/* Loading */}
      {documentsLoading && documents.length === 0 && (
        <div className="flex justify-center py-16" aria-busy="true">
          <LoadingSpinner size="lg" label="Loading archive…" />
        </div>
      )}

      {/* Connection error — distinct from "confirmed empty" since we never got an answer */}
      {!documentsLoading && hasConnectionError && (
        <EmptyState
          icon={<WifiOff size={36} />}
          title="Can't reach the server"
          description={typeof documentsError === 'string' ? documentsError : 'The backend may be offline.'}
          action={
            <Button
              data-testid="empty-state-retry"
              variant="secondary"
              size="sm"
              iconLeft={<RefreshCw size={12} />}
              onClick={() => void fetchDocuments()}
            >
              Retry
            </Button>
          }
        />
      )}

      {/* Empty state — contained, no floating orphan */}
      {!documentsLoading && !hasConnectionError && (documents.length === 0 || (sorted.length === 0 && viewMode !== 'map')) && (
        <EmptyState
          icon={<FolderOpen size={36} />}
          title={documents.length === 0 ? 'Archive is empty' : 'No results'}
          description={
            documents.length === 0
              ? 'File your first document to get started.'
              : 'Try adjusting your filters.'
          }
          action={
            documents.length === 0 ? (
              <Link
                to="/upload"
                className="inline-flex items-center gap-2 bg-ds-stamp text-white text-ds-sm font-body px-4 py-2 rounded-[2px] hover:shadow-ds-stamp transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-stamp focus-visible:ring-offset-2"
              >
                Upload documents
              </Link>
            ) : undefined
          }
        />
      )}

      {/* ── Grid view ── */}
      {sorted.length > 0 && viewMode === 'grid' && (
        <div style={{ padding: '16px 32px 32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: "'Space Mono', monospace", fontSize: '11px', color: '#8A8578', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={allChecked}
                ref={(el) => { if (el) el.indeterminate = !allChecked && someChecked; }}
                onChange={toggleSelectAll}
                style={{ accentColor: '#FF4D2E', width: '14px', height: '14px' }}
                aria-label="Select all documents"
              />
              Select all ({sorted.length})
            </label>
          </div>

          {/* 1-col → 2-col → 3-col → 4-col */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" style={{ gap: 0, border: '1px solid #D8D4C8' }}>
            {sorted.map((doc) => (
              <DocumentCard
                key={doc.id}
                doc={doc}
                selected={selected.has(doc.id)}
                onSelect={() => toggleSelect(doc.id)}
                onDelete={() => initiateDelete([doc])}
                isDuplicateName={hasFilenameCollision(doc, sorted)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Table view — horizontal scroll on narrow viewports ── */}
      {sorted.length > 0 && viewMode === 'table' && (
        <div style={{ padding: '0 32px 32px' }}>
          <div className="border border-ds-hairline overflow-x-auto">
          <table className="w-full border-collapse min-w-[640px]" aria-label="Documents table">
            <thead className="bg-ds-card border-b border-ds-hairline">
              <tr>
                <th scope="col" className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    ref={(el) => { if (el) el.indeterminate = !allChecked && someChecked; }}
                    onChange={toggleSelectAll}
                    className="accent-[#FF4D2E] h-3.5 w-3.5 rounded-none"
                    aria-label="Select all documents"
                  />
                </th>
                <ColHeader label="Name"     sortable col="filename"   sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <ColHeader label="Type"                               />
                <ColHeader label="Size"                               />
                <ColHeader label="Chunks"                             />
                <ColHeader label="Status"   sortable col="status"     sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <ColHeader label="Uploaded" sortable col="created_at" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <th scope="col" className="px-4 py-3 w-20"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((doc) => {
                const badge = STATUS_BADGE[doc.status];
                const ext   = extFromMime(doc.mime_type, doc.filename).toUpperCase();
                const isExp = expanded.has(doc.id);
                const isDupe = hasFilenameCollision(doc, sorted);

                return (
                  <React.Fragment key={doc.id}>
                    <tr
                      data-testid="document-row"
                      className={`border-b border-ds-hairline transition-colors ${selected.has(doc.id) ? 'bg-ds-stamp/5' : 'hover:bg-ds-base'}`}
                      aria-selected={selected.has(doc.id)}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(doc.id)}
                          onChange={() => toggleSelect(doc.id)}
                          className="accent-[#FF4D2E] h-3.5 w-3.5 rounded-none"
                          aria-label={`Select ${doc.filename}`}
                        />
                      </td>

                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => toggleExpand(doc.id)}
                          className="flex items-center gap-2 text-left hover:text-ds-stamp transition-colors min-w-0"
                          aria-expanded={isExp}
                          aria-label={`${isExp ? 'Collapse' : 'Expand'} details for ${doc.filename}`}
                        >
                          <FileText size={13} className="text-ds-text-muted shrink-0" aria-hidden="true" />
                          <span className="flex flex-col min-w-0">
                            <span className="text-ds-sm font-body text-ds-text-primary max-w-[240px] truncate">{doc.filename}</span>
                            {isDupe && (
                              <span className="text-[10px] font-mono text-ds-stamp">id {doc.id.slice(0, 8)}</span>
                            )}
                          </span>
                          {isExp
                            ? <ChevronUp   size={11} className="text-ds-text-muted shrink-0" aria-hidden="true" />
                            : <ChevronDown size={11} className="text-ds-text-muted shrink-0" aria-hidden="true" />}
                        </button>
                      </td>

                      <td className="px-4 py-3"><Badge variant="default" size="sm">{ext}</Badge></td>
                      <td className="px-4 py-3 text-ds-xs font-mono text-ds-text-secondary whitespace-nowrap">{fmtBytes(doc.size_bytes)}</td>
                      <td className="px-4 py-3 text-ds-xs font-mono text-ds-text-secondary">{doc.chunk_count > 0 ? doc.chunk_count.toLocaleString() : '—'}</td>

                      <td className="px-4 py-3">
                        <Badge
                          data-testid={doc.status === 'ready' ? 'status-badge-ready' : 'status-badge'}
                          variant={badge.variant} size="sm" dot
                        >
                          {badge.label}
                        </Badge>
                      </td>

                      <td className="px-4 py-3 text-ds-xs font-mono text-ds-text-secondary whitespace-nowrap">
                        {isDupe ? fmtDateTime(doc.created_at) : fmtDate(doc.created_at)}
                      </td>

                      <td className="px-4 py-3">
                        <Button data-testid="delete-button" variant="ghost" size="sm" iconOnly
                          className="min-w-[44px] min-h-[44px] -m-[8.5px]"
                          onClick={() => initiateDelete([doc])} aria-label={`Delete ${doc.filename}`}>
                          <Trash2 size={13} className="text-ds-error" />
                        </Button>
                      </td>
                    </tr>

                    {isExp && <ExpandedRow key={`${doc.id}-exp`} doc={doc} colSpan={8} />}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* ── Map view ── */}
      {documents.length > 0 && viewMode === 'map' && (
        <div style={{ padding: '16px 32px 32px' }}>
          {similarityError && (
            <div
              role="alert"
              style={{ marginBottom: 16, padding: '12px 16px', background: '#FFEBEE', border: '1px solid #C0392B', fontFamily: "'Space Grotesk', sans-serif", fontSize: 14, color: '#C0392B' }}
            >
              {similarityError}
            </div>
          )}
          {similarityLoading && (
            <div className="flex justify-center py-16" aria-busy="true">
              <LoadingSpinner size="lg" label="Computing document similarity…" />
            </div>
          )}
          {!similarityLoading && documents.filter((d) => d.status === 'ready').length < 2 && (
            <EmptyState
              icon={<Network size={36} />}
              title="Not enough documents"
              description="Upload at least 2 ready documents to see the relation map."
            />
          )}
          {!similarityLoading && documents.filter((d) => d.status === 'ready').length >= 2 && (
            <Suspense
              fallback={
                <div className="flex justify-center py-16" aria-busy="true">
                  <LoadingSpinner size="lg" label="Loading relation map…" />
                </div>
              }
            >
              <LazyRelationMap
                pairs={similarityPairs}
                documents={documents}
                onRecompute={() => void fetchSimilarity()}
                isComputing={similarityLoading}
              />
            </Suspense>
          )}
        </div>
      )}

      {deleteTargets.length > 0 && (
        <DeleteModal
          targets={deleteTargets}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTargets([])}
          isDeleting={isDeleting}
        />
      )}
    </div>
  );
}
