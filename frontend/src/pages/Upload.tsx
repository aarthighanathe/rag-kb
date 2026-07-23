/**
 * @file Upload.tsx
 * @description Document upload page — full-bleed two-panel layout.
 *   Left: paper.base main upload area. Right: ink.base dark "Recent Filings" sidebar (320px).
 *   Preserves all existing upload logic, queue, and store hooks.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { useEffect, useCallback, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2, FileSearch, Cog, MessageCircle,
} from 'lucide-react';
import { FileDropzone, type FileEntry } from '../design-system/components/FileDropzone';
import { LoadingSpinner } from '../design-system/components/LoadingSpinner';
import { FilingReport } from '../design-system/components/FilingReport';
import { useShallow } from 'zustand/react/shallow';
import { useRagStore, type UploadItem } from '../stores/ragStore';
import { useAppToast } from '../contexts/ToastContext';
import { estimateProcessingSeconds, formatETA } from '../utils/estimateETA';
import { timeAgo } from '../utils/timeAgo';
import { pluralize } from '../utils/pluralize';
import { useIsMobile } from '../hooks/useMobileBreakpoint';
import { getDocument, type ChunkQualityStats, type DocumentRecord } from '../services/api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACCEPTED_TYPES = ['.pdf', '.txt', '.md', '.docx'];
/**
 * Client-side pre-check only — the backend independently enforces its own
 * MAX_FILE_SIZE_MB (backend/src/config/env.ts) as the source of truth. Keep
 * this env var's value in sync with that one; default of 10 mirrors the
 * backend's default so an unset env var still matches out of the box.
 */
const MAX_SIZE_MB = Number.parseInt(import.meta.env.VITE_MAX_FILE_SIZE_MB ?? '10', 10);
const MAX_SIZE = MAX_SIZE_MB * 1024 * 1024;

function fmtBytes(bytes: number): string {
  if (bytes < 1024)      return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function getExtBadgeStyle(name: string): React.CSSProperties {
  const ext = name.split('.').pop()?.toLowerCase();
  const styles: Record<string, React.CSSProperties> = {
    pdf:  { background: '#FFF3E0', color: '#E65100' },
    docx: { background: '#E3F2FD', color: '#0D47A1' },
    txt:  { background: '#F3E5F5', color: '#6A1B9A' },
    md:   { background: '#E8F5E9', color: '#1B5E20' },
  };
  return styles[ext ?? ''] ?? { background: '#F0EDEA', color: '#5C5850' };
}

function getStatusBorderColor(status: UploadItem['status']): string {
  switch (status) {
    case 'uploading':  return '#FF4D2E';
    case 'processing': return '#FF4D2E';
    case 'ready':      return '#2D5A4A';
    case 'failed':     return '#C0392B';
    default:           return '#D8D4C8';
  }
}

function getDocStatusBorderColor(status: DocumentRecord['status']): string {
  switch (status) {
    case 'ready':      return '#2D5A4A';
    case 'processing': return '#FF4D2E';
    case 'failed':     return '#C0392B';
    default:           return '#8A8578';
  }
}

function getFileTypeForETA(filename: string): 'pdf' | 'docx' | 'txt' | 'md' {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'docx') return 'docx';
  if (ext === 'md' || ext === 'markdown') return 'md';
  return 'txt';
}

const STATUS_BADGE: Record<UploadItem['status'], { variant: 'default' | 'success' | 'warning' | 'danger' | 'citation'; label: string }> = {
  queued:     { variant: 'default',  label: 'Queued' },
  uploading:  { variant: 'citation', label: 'Uploading' },
  processing: { variant: 'default',  label: 'Processing' },
  ready:      { variant: 'success',  label: 'Ready' },
  failed:     { variant: 'danger',   label: 'Failed' },
};

// ---------------------------------------------------------------------------
// Queue item row (left panel)
// ---------------------------------------------------------------------------

function QueueRow({ item }: { item: UploadItem }): React.JSX.Element {
  const { removeFromQueue, retryQueueItem } = useRagStore(
    useShallow((s) => ({
      removeFromQueue: s.removeFromQueue,
      retryQueueItem: s.retryQueueItem,
    })),
  );
  const badge = STATUS_BADGE[item.status];
  const borderColor = getStatusBorderColor(item.status);
  const extStyle = getExtBadgeStyle(item.file.name);
  const ext = (item.file.name.split('.').pop()?.toUpperCase()) ?? 'FILE';

  // ── ETA state for processing items ────────────────────────────────────────
  const [etaText, setEtaText] = useState<string | null>(null);
  const [simProgress, setSimProgress] = useState<number>(item.progress);

  // ── Chunk quality stats for ready items ───────────────────────────────────
  const [qualityStats, setQualityStats] = useState<ChunkQualityStats | null>(null);

  useEffect(() => {
    if (item.status !== 'processing' || !item.processingStartedAt) {
      setEtaText(null);
      setSimProgress(item.progress);
      return;
    }

    const fileType = getFileTypeForETA(item.file.name);
    const estimated = estimateProcessingSeconds(item.fileSizeBytes, fileType);

    const tick = () => {
      const elapsed = (Date.now() - item.processingStartedAt!) / 1000;
      const remaining = Math.max(0, estimated - elapsed);
      setEtaText(remaining <= 0 ? 'any moment now' : formatETA(remaining));
      setSimProgress(Math.min(90, (elapsed / estimated) * 90));
    };

    tick();
    const intervalId = setInterval(tick, 5000);
    return () => clearInterval(intervalId);
  }, [item.status, item.processingStartedAt, item.fileSizeBytes, item.file.name, item.progress]);

  // Jump to 100% when ready
  useEffect(() => {
    if (item.status === 'ready') setSimProgress(100);
  }, [item.status]);

  // Fetch quality stats when item becomes ready
  useEffect(() => {
    if (item.status === 'ready' && item.documentId && !qualityStats) {
      let cancelled = false;
      getDocument(item.documentId)
        .then((res) => {
          // A fast navigate-away before this resolves must not set state on
          // an unmounted component's stale closure.
          if (!cancelled) setQualityStats(res.chunkQuality);
        })
        .catch(() => { /* ignore — stats are non-critical */ });
      return () => {
        cancelled = true;
      };
    }
    return undefined;
  }, [item.status, item.documentId, qualityStats]);

  const displayProgress = item.status === 'processing' ? simProgress : item.progress;

  return (
    <li
      data-testid="upload-queue-item"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
        background: '#FFFFFF',
        border: '1px solid #D8D4C8',
        borderLeft: `4px solid ${borderColor}`,
        padding: '12px 16px',
        marginBottom: '6px',
        flexDirection: 'column',
      }}
      aria-label={`${item.file.name}: ${badge.label}`}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%' }}>
        {/* File type badge */}
        <span
          style={{
            ...extStyle,
            fontFamily: "'Space Mono', monospace",
            fontSize: '10px',
            fontWeight: 700,
            padding: '2px 6px',
            flexShrink: 0,
          }}
        >
          {ext}
        </span>

        {/* Middle */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: '13px',
              fontWeight: 600,
              color: '#1C1B19',
              marginBottom: '5px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {item.file.name}
          </p>

          {(item.status === 'uploading' || item.status === 'processing') && (
            <div style={{ marginTop: '4px' }}>
              <div
                style={{ height: '3px', background: '#F0EDEA', marginBottom: '3px', overflow: 'hidden', position: 'relative' }}
                role="progressbar"
                aria-valuenow={Math.round(displayProgress)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Upload progress: ${Math.round(displayProgress)}%`}
              >
                <div
                  style={{
                    height: '100%',
                    background: '#FF4D2E',
                    width: item.status === 'processing' ? '30%' : `${displayProgress}%`,
                    transition: item.status === 'processing' ? 'none' : 'width 150ms ease',
                    ...(item.status === 'processing' ? { position: 'absolute', animation: 'indeterminate 1.5s ease-in-out infinite' } : {}),
                  }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                {item.status === 'uploading' ? (
                  <>
                    <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '10px', color: '#6B5B4E' }}>
                      {item.fileSizeBytes
                        ? `${formatETA(estimateProcessingSeconds(item.fileSizeBytes, (item.file.name.split('.').pop()?.toLowerCase() ?? 'txt') as 'pdf' | 'docx' | 'txt' | 'md') * (1 - displayProgress / 100))} remaining`
                        : ''}
                    </span>
                    <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '10px', color: '#6B5B4E', fontVariantNumeric: 'tabular-nums' }}>
                      {Math.round(displayProgress)}%
                    </span>
                  </>
                ) : (
                  <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '10px', color: '#6B5B4E' }}>
                    Chewing… ~{(() => {
                      const elapsed = Date.now() - (item.processingStartedAt ?? 0);
                      const eta = Math.max(0, 20 - elapsed / 1000);
                      return formatETA(eta);
                    })()} left
                  </span>
                )}
              </div>
            </div>
          )}

          {item.status === 'ready' && (
            <p style={{ fontFamily: "'Space Mono', monospace", fontSize: '10px', color: '#2D5A4A' }}>
              ✓ Filed · {item.file.size > 0 ? fmtBytes(item.file.size) : ''}
              {item.file.size > 0 ? ` · ${item.file.name.split('.').pop()?.toUpperCase()}` : ''}
            </p>
          )}

          {item.status === 'failed' && (
            <p style={{ fontFamily: "'Space Mono', monospace", fontSize: '10px', color: '#C0392B' }}>
              ✗ Failed ·{' '}
              <span>
                {typeof item.error === 'string'
                  ? item.error
                  : 'Upload failed — please retry'}
              </span>
            </p>
          )}

          {(item.status === 'queued') && (
            <p style={{ fontFamily: "'Space Mono', monospace", fontSize: '10px', color: '#8A8578' }}>
              {fmtBytes(item.file.size)}
            </p>
          )}
        </div>

        {/* Right */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
          {item.status === 'uploading' && (
            <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '10px', color: '#FF4D2E' }}>
              Uploading · {item.progress}%
            </span>
          )}
          {item.status === 'processing' && (
            <span
              style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: '10px',
                color: etaText === 'almost done' ? '#2D5A4A' : '#FF4D2E',
              }}
            >
              {etaText ?? 'Processing'}
            </span>
          )}
          {item.status === 'ready' && <CheckCircle2 size={16} style={{ color: '#2D5A4A' }} aria-hidden="true" />}
          {item.status === 'failed' && (
            <button
              type="button"
              style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: '10px',
                color: '#FF4D2E',
                background: 'transparent',
                border: '1px solid #FF4D2E',
                padding: '3px 8px',
                cursor: 'pointer',
              }}
              aria-label={`Retry upload of ${item.file.name}`}
              onClick={() => { void retryQueueItem(item.id); }}
            >
              Retry
            </button>
          )}
          <button
            type="button"
            onClick={() => removeFromQueue(item.file.name)}
            aria-label={`Remove ${item.file.name}`}
            style={{ color: '#8A8578', background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}
          >
            ×
          </button>
        </div>
      </div>

      {/* Filing Report — shown when ready and stats loaded */}
      {item.status === 'ready' && qualityStats && (
        <div style={{ width: '100%', paddingLeft: '28px' }}>
          <FilingReport stats={qualityStats} filename={item.file.name} />
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Right panel: Recent Filings dark sidebar
// ---------------------------------------------------------------------------

function RecentFilingsPanel({
  documents,
  documentsLoading,
  totalDocs,
  totalChunks,
  readyCount,
}: {
  documents: DocumentRecord[];
  documentsLoading: boolean;
  totalDocs: number;
  totalChunks: number;
  readyCount: number;
}): React.JSX.Element {
  const recentDocs = documents.slice(0, 8);
  const [expanded, setExpanded] = useState(false);

  return (
    <aside
      style={{
        background: '#1C1B19',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
      className="w-full md:w-[260px] lg:w-[320px] md:flex-shrink-0 md:h-full"
      aria-label="Recent filings sidebar"
    >
      {/* Header — acts as accordion toggle on mobile */}
      <div
        style={{
          padding: '16px 20px',
          borderBottom: '1px solid #2C2B29',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: '10px',
            letterSpacing: '0.12em',
            color: '#FF4D2E',
            textTransform: 'uppercase',
          }}
        >
          RECENT FILINGS ({recentDocs.length})
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Link
            to="/documents"
            style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: '11px',
              color: '#8A8578',
              textDecoration: 'none',
            }}
            aria-label="View all documents"
          >
            View all →
          </Link>
          {/* Accordion toggle — mobile only */}
          <button
            type="button"
            className="md:hidden flex"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? 'Collapse recent filings' : 'Expand recent filings'}
            style={{
              background: 'none',
              border: 'none',
              color: '#8A8578',
              cursor: 'pointer',
              fontSize: '14px',
              alignItems: 'center',
            }}
          >
            {expanded ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {/* Document list — hidden on mobile when collapsed */}
      <div
        style={{ flex: 1, padding: '16px 20px', overflowY: 'auto', flexDirection: 'column', gap: '10px' }}
        className={expanded ? 'flex' : 'hidden md:flex'}
      >
        {documentsLoading && recentDocs.length === 0 ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}>
            <LoadingSpinner size="md" label="Loading recent documents" />
          </div>
        ) : recentDocs.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '32px 0' }}>
            <p style={{ fontFamily: "'Space Mono', monospace", fontSize: '11px', color: '#8A8578', fontStyle: 'italic', marginBottom: '8px' }}>
              No documents filed yet.
            </p>
            <p style={{ fontFamily: "'Space Mono', monospace", fontSize: '10px', color: '#B8B4AC' }}>
              Upload your first file →
            </p>
          </div>
        ) : (
          recentDocs.map((doc) => {
            const borderColor = getDocStatusBorderColor(doc.status);
            const statusLabel = doc.status.charAt(0).toUpperCase() + doc.status.slice(1);
            const statusColor = doc.status === 'ready' ? '#2D5A4A' : doc.status === 'processing' ? '#FF4D2E' : doc.status === 'failed' ? '#C0392B' : '#8A8578';

            return (
              <div
                key={doc.id}
                style={{
                  background: '#242320',
                  border: '1px solid #2C2B29',
                  borderLeft: `3px solid ${borderColor}`,
                  padding: '12px 14px',
                }}
                aria-label={`${doc.filename}, status: ${doc.status}`}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                  <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '10px', color: statusColor }}>
                    {statusLabel}
                  </span>
                  <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '10px', color: '#8A8578' }}>
                    {timeAgo(doc.created_at)}
                  </span>
                </div>
                <p
                  style={{
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#F7F5F0',
                    marginBottom: '2px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {doc.filename}
                </p>
                <p style={{ fontFamily: "'Space Mono', monospace", fontSize: '10px', color: '#8A8578' }}>
                  {doc.chunk_count > 0 ? `${pluralize(doc.chunk_count, 'chunk')} · ` : ''}{fmtBytes(doc.size_bytes)}
                </p>
              </div>
            );
          })
        )}
      </div>

      {/* Stats footer */}
      <div
        style={{
          borderTop: '1px solid #2C2B29',
          padding: '14px 20px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          flexShrink: 0,
        }}
      >
        {[
          { label: 'DOCS',   value: totalDocs,   color: '#F7F5F0' },
          { label: 'CHUNKS', value: totalChunks.toLocaleString(), color: '#F7F5F0' },
          { label: 'READY',  value: readyCount,  color: '#2D5A4A' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ textAlign: 'center' }}>
            <p style={{ fontFamily: "'Space Mono', monospace", fontSize: '22px', fontWeight: 700, color, lineHeight: 1.2 }}>
              {value}
            </p>
            <p style={{ fontFamily: "'Space Mono', monospace", fontSize: '9px', color: '#8A8578', letterSpacing: '0.08em', marginTop: '2px' }}>
              {label}
            </p>
          </div>
        ))}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Upload page — full-bleed two-panel layout.
 * Left: paper.base upload area (flex 1). Right: ink.base recent filings (320px).
 */
export function Upload(): React.JSX.Element {
  const { uploadQueue, addToUploadQueue, startUpload, documents, fetchDocuments, documentsLoading } =
    useRagStore(
      useShallow((s) => ({
        uploadQueue: s.uploadQueue,
        addToUploadQueue: s.addToUploadQueue,
        startUpload: s.startUpload,
        documents: s.documents,
        fetchDocuments: s.fetchDocuments,
        documentsLoading: s.documentsLoading,
      })),
    );
  const { toast } = useAppToast();

  const [pendingFiles, setPendingFiles]         = useState<File[]>([]);
  const [isStartingUpload, setIsStartingUpload] = useState(false);
  const [isDragOver, setIsDragOver]             = useState(false);
  const notifiedReadyIds = useRef<Set<string>>(new Set());
  const isNarrow = useIsMobile(480);

  useEffect(() => { void fetchDocuments(); }, [fetchDocuments]);

  // Fire a completion toast the moment a queued file finishes processing —
  // the queue row otherwise just quietly moves from "Filing Queue" to "Just Filed".
  useEffect(() => {
    for (const item of uploadQueue) {
      if (item.status === 'ready' && !notifiedReadyIds.current.has(item.id)) {
        notifiedReadyIds.current.add(item.id);
        toast('Document ready', {
          variant: 'success',
          description: `${item.file.name} was filed and is ready to query.`,
        });
      }
    }
  }, [uploadQueue, toast]);

  const fileEntries: FileEntry[] = pendingFiles.map((f) => ({
    id: f.name, name: f.name, progress: 0, status: 'pending',
  }));

  const handleFiles = useCallback((incoming: File[]) => {
    setPendingFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name));
      const deduped  = incoming.filter((f) => !existing.has(f.name));
      return [...prev, ...deduped].slice(0, 5);
    });
  }, []);

  const handleRemove = useCallback((id: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.name !== id));
  }, []);

  const handleUpload = useCallback(async () => {
    if (pendingFiles.length === 0) return;
    const fileCount = pendingFiles.length;
    setIsStartingUpload(true);
    addToUploadQueue(pendingFiles);
    setPendingFiles([]);
    try {
      const { succeeded, failed } = await startUpload();
      if (failed > 0 && succeeded === 0) {
        toast('Upload failed', {
          variant: 'error',
          description: `${pluralize(failed, 'file')} couldn't be uploaded. Check the filing queue for details.`,
        });
      } else if (failed > 0) {
        toast('Partial upload failure', {
          variant: 'error',
          description: `${succeeded} filed, ${failed} failed. See the filing queue for details.`,
        });
      } else {
        toast('Documents catalogued', {
          variant: 'success',
          description: `${pluralize(succeeded, 'file')} queued for processing`,
        });
      }
    } catch {
      toast('Upload error', {
        variant: 'error',
        description: `${pluralize(fileCount, 'file')} couldn't be uploaded`,
      });
    } finally {
      setIsStartingUpload(false);
    }
  }, [pendingFiles, addToUploadQueue, startUpload, toast]);

  const activeQueue = uploadQueue.filter((i) => i.status !== 'ready');
  const totalDocs   = documents.length;
  const totalChunks = documents.reduce((s, d) => s + d.chunk_count, 0);
  const readyCount  = documents.filter((d) => d.status === 'ready').length;

  return (
    <div
      className="flex flex-col md:flex-row"
      style={{
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* ── Left panel ────────────────────────────────────────────────────── */}
      <div
        style={{
          background: '#F7F5F0',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          flex: 1,
          minWidth: 0,
        }}
      >
        {/* Page header strip */}
        <div
          style={{
            background: '#FFFFFF',
            borderBottom: '1px solid #D8D4C8',
            padding: isNarrow ? '16px 20px' : '20px 32px',
            display: 'flex',
            flexDirection: isNarrow ? 'column' : 'row',
            alignItems: isNarrow ? 'stretch' : 'baseline',
            justifyContent: 'space-between',
            gap: isNarrow ? '14px' : 0,
            flexShrink: 0,
          }}
        >
          <div>
            <h1
              className="font-display"
              style={{ fontSize: isNarrow ? '24px' : '32px', fontWeight: 900, fontStyle: 'italic', color: '#1C1B19', letterSpacing: '-0.02em' }}
            >
              Acquisitions Desk
            </h1>
            <p style={{ fontFamily: "'Space Mono', monospace", fontSize: '11px', color: '#8A8578', marginTop: '2px' }}>
              PDF · DOCX · TXT · MD — {MAX_SIZE_MB} MB per file, max 5
            </p>
          </div>

          {/* Upload button — primary CTA */}
          <button
            data-testid="upload-button"
            type="button"
            disabled={pendingFiles.length === 0 || isStartingUpload}
            onClick={() => void handleUpload()}
            aria-label={`File ${pendingFiles.length} document${pendingFiles.length !== 1 ? 's' : ''}`}
            style={{
              background: pendingFiles.length === 0 ? '#F0EDEA' : '#FF4D2E',
              color: pendingFiles.length === 0 ? '#B8B4AC' : '#FFFFFF',
              border: 'none',
              padding: '10px 22px',
              fontFamily: "'Space Grotesk', sans-serif",
              fontWeight: 700,
              fontSize: '13px',
              cursor: pendingFiles.length === 0 ? 'not-allowed' : 'pointer',
              transition: 'all 150ms ease',
              flexShrink: 0,
              width: isNarrow ? '100%' : 'auto',
            }}
          >
            {isStartingUpload ? 'Filing…' : `File document${pendingFiles.length !== 1 ? 's' : ''} →`}
          </button>
        </div>

        {/* Scrollable content area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>

          {/* Drop zone */}
          <div
            style={{
              border: `2px dashed ${isDragOver ? '#FF4D2E' : '#D8D4C8'}`,
              position: 'relative',
              minHeight: '180px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              padding: '40px',
              marginBottom: '24px',
              transition: 'border-color 150ms ease',
              background: isDragOver ? 'rgba(255,77,46,0.03)' : '#FFFFFF',
            }}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={() => setIsDragOver(false)}
          >
            {/* Accent dashed top strip */}
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: '3px',
                background: 'repeating-linear-gradient(90deg, #FF4D2E 0px, #FF4D2E 14px, transparent 14px, transparent 36px)',
              }}
            />

            {/* FileDropzone component (handles actual file selection logic) */}
            <FileDropzone
              acceptedTypes={ACCEPTED_TYPES}
              maxSizeBytes={MAX_SIZE}
              multiple
              files={fileEntries}
              onFiles={handleFiles}
              onRemove={pendingFiles.length > 0 ? handleRemove : undefined}
              disabled={isStartingUpload}
            />
          </div>

          {/* What happens next — fills the empty state before anything is queued */}
          {activeQueue.length === 0 && uploadQueue.filter((i) => i.status === 'ready').length === 0 && (
            <section
              aria-label="What happens after you upload"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '1px',
                background: '#D8D4C8',
                border: '1px solid #D8D4C8',
              }}
            >
              {[
                { Icon: FileSearch, title: 'Validated', body: 'Every file is checked against its real content, not just the extension — before anything is stored.' },
                { Icon: Cog, title: 'Chunked & embedded', body: 'Split into 512-token passages and embedded automatically. No configuration needed.' },
                { Icon: MessageCircle, title: 'Ready to ask', body: 'Once processing finishes, head to Chat and ask questions in plain language.' },
              ].map(({ Icon, title, body }) => (
                <div key={title} style={{ background: '#FFFFFF', padding: '20px' }}>
                  <Icon size={16} style={{ color: '#FF4D2E' }} aria-hidden="true" />
                  <p style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '13px', fontWeight: 700, color: '#1C1B19', marginTop: '10px', marginBottom: '4px' }}>
                    {title}
                  </p>
                  <p style={{ fontFamily: "'Iowan Old Style', Georgia, serif", fontSize: '12.5px', color: '#8A8578', lineHeight: 1.5 }}>
                    {body}
                  </p>
                </div>
              ))}
            </section>
          )}

          {/* Filing Queue */}
          {activeQueue.length > 0 && (
            <section style={{ marginBottom: '24px' }}>
              <p
                style={{
                  fontFamily: "'Space Mono', monospace",
                  fontSize: '10px',
                  letterSpacing: '0.12em',
                  color: '#8A8578',
                  textTransform: 'uppercase',
                  marginBottom: '10px',
                }}
              >
                FILING QUEUE
              </p>
              <ul aria-live="polite" aria-label="Upload progress list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {activeQueue.map((item) => <QueueRow key={item.id} item={item} />)}
              </ul>
            </section>
          )}

          {/* Recently uploaded docs (from queue, ready state) */}
          {uploadQueue.filter((i) => i.status === 'ready').length > 0 && (
            <section>
              <p style={{ fontFamily: "'Space Mono', monospace", fontSize: '10px', letterSpacing: '0.12em', color: '#8A8578', textTransform: 'uppercase', marginBottom: '10px' }}>
                JUST FILED
              </p>
              <ul aria-label="Recently filed documents" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {uploadQueue.filter((i) => i.status === 'ready').map((item) => (
                  <QueueRow key={item.id} item={item} />
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      {/* ── Right panel — dark sidebar (always visible) ───────────────────── */}
      <RecentFilingsPanel
        documents={documents}
        documentsLoading={documentsLoading}
        totalDocs={totalDocs}
        totalChunks={totalChunks}
        readyCount={readyCount}
      />
      <style>{`
        @keyframes indeterminate {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(250%); }
          100% { transform: translateX(-100%); }
        }
      `}</style>
    </div>
  );
}
