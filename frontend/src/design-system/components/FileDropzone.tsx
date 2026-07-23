/**
 * @file FileDropzone.tsx
 * @description Drag-and-drop file upload zone — Lab Notebook theme.
 *   Hand-drawn SVG dashed border (irregular dash pattern vs perfect CSS dashes),
 *   paper-lift effect on drag-over, Fraunces italic prompt text.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import React, { useCallback, useRef } from 'react';
import { Upload, X, AlertCircle, CheckCircle } from 'lucide-react';
import { LoadingSpinner } from './LoadingSpinner';

export interface FileEntry {
  /** Unique identifier for this file in the list. */
  id: string;
  /** Display name of the file. */
  name: string;
  /** Upload progress 0-100. */
  progress: number;
  /** Per-file error message. */
  error?: string;
  /** Current state of the file in the upload pipeline. */
  status: 'pending' | 'uploading' | 'done' | 'error';
}

export interface FileDropzoneProps {
  /** Human-readable list of accepted file extensions (e.g. ['.pdf', '.docx']). */
  acceptedTypes?: string[];
  /** Maximum allowed file size in bytes. */
  maxSizeBytes?: number;
  /** When true, allows multiple files to be selected at once. */
  multiple?: boolean;
  /** Files currently in the upload pipeline. */
  files?: FileEntry[];
  /** Fired when the user drops or selects valid files. */
  onFiles: (files: File[]) => void;
  /** Fired when the user removes a file from the list. */
  onRemove?: (id: string) => void;
  /** When true, the entire zone is non-interactive. */
  disabled?: boolean;
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024)    return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
};

/**
 * Drag-and-drop + click-to-open file upload zone — paper aesthetic.
 * @param acceptedTypes - e.g. ['.pdf', '.txt']
 * @param maxSizeBytes  - e.g. 10 * 1024 * 1024 for 10 MB
 * @param multiple      - Allow multi-file selection
 * @param files         - Controlled list of FileEntry items
 * @param onFiles       - Callback when files are picked
 * @param onRemove      - Callback when a file is removed from the list
 * @param disabled      - Disable all interaction
 */
export function FileDropzone({
  acceptedTypes = ['.pdf', '.docx', '.txt', '.md'],
  maxSizeBytes,
  multiple = true,
  files = [],
  onFiles,
  onRemove,
  disabled = false,
}: FileDropzoneProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = React.useState(false);
  const [announcement, setAnnouncement] = React.useState('');
  const [rejectionErrors, setRejectionErrors] = React.useState<string[]>([]);

  const getFileError = useCallback(
    (file: File): string | null => {
      const ext = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '');
      if (acceptedTypes.length > 0 && !acceptedTypes.includes(ext)) {
        return `"${file.name}" is not supported. Accepted: ${acceptedTypes.join(', ')}`;
      }
      if (maxSizeBytes !== undefined && file.size > maxSizeBytes) {
        return `"${file.name}" exceeds the maximum size of ${formatBytes(maxSizeBytes)}`;
      }
      return null;
    },
    [acceptedTypes, maxSizeBytes],
  );

  const processFiles = useCallback(
    (incoming: File[]) => {
      const errors: string[] = [];
      const valid: File[] = [];
      for (const f of incoming) {
        const err = getFileError(f);
        if (err) errors.push(err);
        else valid.push(f);
      }
      setRejectionErrors(errors);
      if (valid.length > 0) {
        onFiles(valid);
        setAnnouncement(`${valid.length} file${valid.length > 1 ? 's' : ''} queued for upload`);
      }
    },
    [getFileError, onFiles],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) {
      setIsDragOver(true);
      setAnnouncement('Files detected — release to upload');
    }
  }, [disabled]);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
    setAnnouncement('');
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (disabled) return;
      const dropped = Array.from(e.dataTransfer.files);
      if (dropped.length > 0) processFiles(dropped);
    },
    [disabled, processFiles],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = Array.from(e.target.files ?? []);
      if (selected.length > 0) processFiles(selected);
      e.target.value = '';
    },
    [processFiles],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
        e.preventDefault();
        inputRef.current?.click();
      }
    },
    [disabled],
  );

  // Hand-drawn SVG dashed border as background-image
  const svgBorder = isDragOver
    ? `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100%25' height='100%25'%3E%3Crect width='100%25' height='100%25' fill='none' stroke='%23FF4D2E' stroke-width='2' stroke-dasharray='8%2C4%2C3%2C4' stroke-dashoffset='0' rx='2'/%3E%3C/svg%3E")`
    : `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100%25' height='100%25'%3E%3Crect width='100%25' height='100%25' fill='none' stroke='%23D8D4C8' stroke-width='2' stroke-dasharray='8%2C5%2C3%2C5' stroke-dashoffset='0' rx='2'/%3E%3C/svg%3E")`;

  const zoneClasses = `
    relative flex flex-col items-center justify-center gap-ds-3
    p-ds-12 rounded-[2px] cursor-pointer
    transition-all duration-ds-normal ease-ds-smooth
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-stamp focus-visible:ring-offset-2 focus-visible:ring-offset-ds-base
    ${isDragOver
      ? 'bg-ds-stamp/5 scale-[1.01] shadow-ds-lifted'
      : 'bg-ds-surface hover:bg-ds-base'
    }
    ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
  `;

  return (
    <div data-testid="file-dropzone" className="flex flex-col gap-ds-4">
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      {/* Hidden label — aria-labelledby overrides aria-label for computed accessible name */}
      <span id="dropzone-btn-label" className="sr-only">Drag, drop or select files to upload</span>

      {/* Drop zone with hand-drawn SVG border */}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Click or drag files here to upload"
        aria-labelledby="dropzone-btn-label"
        aria-disabled={disabled}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={handleKeyDown}
        className={zoneClasses}
        style={{ backgroundImage: svgBorder }}
      >
        <input
          ref={inputRef}
          data-testid="file-input"
          type="file"
          multiple={multiple}
          accept={acceptedTypes.join(',')}
          onChange={handleInputChange}
          disabled={disabled}
          className="sr-only"
          tabIndex={-1}
        />

        <Upload
          size={36}
          aria-hidden="true"
          className={`transition-colors duration-ds-normal ${isDragOver ? 'text-ds-stamp' : 'text-ds-text-muted'}`}
        />

        <div className="text-center">
          {/* Fraunces italic for the prompt — feels handwritten */}
          <p
            className="text-ds-base font-display font-bold text-ds-text-primary"
            style={{ fontStyle: 'italic' }}
          >
            {isDragOver ? 'Drop your documents here' : 'Drag & drop or click to select'}
          </p>
          <p className="text-ds-sm font-body text-ds-text-muted mt-ds-1">
            {acceptedTypes.join(' · ')}
            {maxSizeBytes !== undefined && ` — max ${formatBytes(maxSizeBytes)}`}
          </p>
        </div>
      </div>

      {/* Rejection errors */}
      {rejectionErrors.length > 0 && (
        <ul className="flex flex-col gap-1">
          {rejectionErrors.map((err, i) => (
            <li
              key={i}
              data-testid="file-error"
              role="alert"
              className="flex items-center gap-2 text-ds-xs font-body text-ds-error bg-ds-rose/10 border border-ds-rose/30 rounded-[2px] px-3 py-2"
            >
              <AlertCircle size={12} aria-hidden="true" className="shrink-0" />
              {err}
            </li>
          ))}
        </ul>
      )}

      {/* File list */}
      {files.length > 0 && (
        <ul className="flex flex-col gap-ds-2" aria-label="Queued files">
          {files.map((file) => (
            <li
              key={file.id}
              data-testid="file-queue-item"
              className="flex items-center gap-ds-3 bg-ds-card border border-ds-hairline rounded-[2px] px-ds-4 py-ds-3"
              aria-label={`${file.name}: ${file.status}${file.status === 'uploading' ? ` ${file.progress}%` : ''}`}
            >
              {file.status === 'uploading' && <LoadingSpinner size="sm" />}
              {file.status === 'done'      && <CheckCircle size={15} className="text-ds-archive shrink-0" aria-hidden="true" />}
              {file.status === 'error'     && <AlertCircle size={15} className="text-ds-error  shrink-0" aria-hidden="true" />}
              {file.status === 'pending'   && (
                <span className="h-3.5 w-3.5 rounded-none border border-ds-hairline shrink-0" aria-hidden="true" />
              )}

              <div className="flex-1 min-w-0">
                <p className="text-ds-sm font-body font-medium text-ds-text-primary truncate">{file.name}</p>

                {file.status === 'uploading' && (
                  <div
                    className="mt-1 h-px rounded-none bg-ds-hairline overflow-hidden"
                    role="progressbar"
                    aria-valuenow={file.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Upload progress: ${file.progress}%`}
                  >
                    <div
                      className="h-full bg-ds-stamp transition-all duration-ds-normal"
                      style={{ width: `${file.progress}%` }}
                    />
                  </div>
                )}

                {file.status === 'error' && file.error && (
                  <p data-testid="file-error" className="text-ds-xs text-ds-error font-body mt-0.5">{file.error}</p>
                )}
              </div>

              {onRemove && (
                <button
                  type="button"
                  data-testid="file-remove-btn"
                  onClick={() => onRemove(file.id)}
                  aria-label={`Remove ${file.name}`}
                  className="shrink-0 text-ds-text-muted hover:text-ds-text-primary transition-colors"
                >
                  <X size={13} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
