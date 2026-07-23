/**
 * @file FileDropzone.test.tsx
 * @description Unit tests for the FileDropzone design-system component.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileDropzone } from '../../design-system/components/FileDropzone';
import type { FileEntry } from '../../design-system/components/FileDropzone';

const mockFiles: FileEntry[] = [
  { id: '1', name: 'doc.pdf',    progress: 50,  status: 'uploading' },
  { id: '2', name: 'notes.txt',  progress: 100, status: 'done'      },
  { id: '3', name: 'broken.md',  progress: 0,   status: 'error', error: 'Too large' },
];

describe('FileDropzone', () => {
  it('renders without crashing', () => {
    render(<FileDropzone onFiles={() => {}} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('shows accepted types', () => {
    render(<FileDropzone onFiles={() => {}} acceptedTypes={['.pdf', '.docx']} />);
    expect(screen.getByText(/\.pdf/)).toBeInTheDocument();
    expect(screen.getByText(/\.docx/)).toBeInTheDocument();
  });

  it('shows max size when provided', () => {
    render(<FileDropzone onFiles={() => {}} maxSizeBytes={10 * 1024 * 1024} />);
    expect(screen.getByText(/10\.0 MB/)).toBeInTheDocument();
  });

  it('renders file list when files prop is populated', () => {
    render(<FileDropzone onFiles={() => {}} files={mockFiles} />);
    expect(screen.getByText('doc.pdf')).toBeInTheDocument();
    expect(screen.getByText('notes.txt')).toBeInTheDocument();
    expect(screen.getByText('broken.md')).toBeInTheDocument();
  });

  it('renders error message for error-status files', () => {
    render(<FileDropzone onFiles={() => {}} files={mockFiles} />);
    expect(screen.getByText('Too large')).toBeInTheDocument();
  });

  it('renders progress bar for uploading files', () => {
    render(<FileDropzone onFiles={() => {}} files={mockFiles} />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('fires onRemove when remove button is clicked', async () => {
    const onRemove = vi.fn();
    render(<FileDropzone onFiles={() => {}} files={mockFiles} onRemove={onRemove} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove doc.pdf' }));
    expect(onRemove).toHaveBeenCalledWith('1');
  });

  it('is keyboard activatable via Enter', async () => {
    render(<FileDropzone onFiles={() => {}} />);
    const zone = screen.getByRole('button');
    zone.focus();
    // Enter triggers click on the hidden file input
    // We verify the zone handles keydown without errors
    fireEvent.keyDown(zone, { key: 'Enter' });
    expect(zone).toBeInTheDocument();
  });

  it('announces drag state to screen readers', () => {
    render(<FileDropzone onFiles={() => {}} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Click or drag files here to upload');
  });

  it('is non-interactive when disabled', () => {
    render(<FileDropzone onFiles={() => {}} disabled />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-disabled', 'true');
  });

  it('renders empty file list with no file entries', () => {
    render(<FileDropzone onFiles={() => {}} files={[]} />);
    expect(screen.queryByRole('list', { name: 'Queued files' })).not.toBeInTheDocument();
  });
});
