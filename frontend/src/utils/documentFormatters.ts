/**
 * @file documentFormatters.ts
 * @description Pure formatting helpers and status-badge lookup shared by the
 *   Documents page and its extracted sub-components (DocumentCard, ExpandedRow).
 * @author [Author Placeholder]
 * @created 2026-08-24
 */

import type { DocumentRecord } from '../services/api';

/**
 * Maps each document status to its Badge variant and display label.
 */
export const STATUS_BADGE: Record<
  DocumentRecord['status'],
  { variant: 'default' | 'success' | 'warning' | 'danger' | 'citation'; label: string }
> = {
  pending: { variant: 'default', label: 'Pending' },
  processing: { variant: 'citation', label: 'Processing' },
  ready: { variant: 'success', label: 'Ready' },
  failed: { variant: 'danger', label: 'Failed' },
};

/**
 * Derives a file extension from a MIME type, falling back to the filename's
 * own extension when present.
 * @param mime - MIME type string
 * @param filename - Original filename
 * @returns Lowercase file extension without the leading dot
 */
export function extFromMime(mime: string, filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (ext) return ext;
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('wordproc')) return 'docx';
  if (mime.includes('markdown')) return 'md';
  return 'txt';
}

/**
 * Formats a byte count as a human-readable size string.
 * @param bytes - Size in bytes
 * @returns Formatted size string (B, KB, or MB)
 */
export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/**
 * Formats an ISO date string as a short date (e.g. "Jun 10, 2026").
 * @param iso - ISO 8601 date string
 * @returns Formatted date string
 */
export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Formats an ISO date string as a short date plus time (e.g. "Jun 10, 2026 · 10:00 AM").
 * @param iso - ISO 8601 date string
 * @returns Formatted date-time string
 */
export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

/**
 * Returns true if any other document in the list shares this document's filename —
 * used to show a disambiguating detail (upload time, short ID) wherever duplicates exist.
 * @param doc - Document to check
 * @param all - Full list of documents to check against
 * @returns True if another document in the list shares this filename
 */
export function hasFilenameCollision(doc: DocumentRecord, all: DocumentRecord[]): boolean {
  return all.some((other) => other.id !== doc.id && other.filename === doc.filename);
}
