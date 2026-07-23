/**
 * @file Upload.test.tsx
 * @description Tests for the Upload page — rendering, file validation, queue progression.
 *   Updated to match actual page copy: heading "Acquisitions Desk", button "File N document(s)",
 *   empty recent-filings text "No documents filed yet".
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Upload } from '../../pages/Upload';
import { useRagStore } from '../../stores/ragStore';
import { ToastProvider } from '../../contexts/ToastContext';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../stores/ragStore', () => ({
  useRagStore: vi.fn(),
}));

vi.mock('../../contexts/ToastContext', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAppToast:   () => ({ toast: vi.fn(), dismiss: vi.fn(), dismissAll: vi.fn(), toasts: [] }),
}));

const mockStore = {
  uploadQueue:      [],
  addToUploadQueue: vi.fn(),
  startUpload:      vi.fn().mockResolvedValue({ succeeded: 1, failed: 0 }),
  retryQueueItem:   vi.fn().mockResolvedValue({ succeeded: 1, failed: 0 }),
  removeFromQueue:  vi.fn(),
  documents:        [],
  documentsLoading: false,
  documentsError:   null,
  fetchDocuments:   vi.fn().mockResolvedValue(undefined),
  deleteDocument:   vi.fn(),
};

function renderUpload() {
  (useRagStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockStore);
  Object.assign(useRagStore, {
    getState: vi.fn(() => ({
      ...mockStore,
      addToUploadQueue: mockStore.addToUploadQueue,
      startUpload: mockStore.startUpload,
      retryQueueItem: mockStore.retryQueueItem,
    })),
  });
  return render(
    <MemoryRouter>
      <ToastProvider>
        <Upload />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStore.uploadQueue      = [];
  mockStore.documents        = [];
  mockStore.documentsLoading = false;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Upload page — rendering', () => {
  it('renders the "Acquisitions Desk" page heading', () => {
    renderUpload();
    // h1 reads "Acquisitions Desk", not "Upload documents"
    expect(screen.getByRole('heading', { name: /acquisitions desk/i })).toBeInTheDocument();
  });

  it('shows the FileDropzone', () => {
    renderUpload();
    expect(document.querySelector('input[type="file"]')).toBeInTheDocument();
  });

  it('shows "No documents filed yet" when recent docs list is empty', () => {
    renderUpload();
    expect(screen.getByText(/no documents filed yet/i)).toBeInTheDocument();
  });

  it('shows recent documents when documents exist', () => {
    mockStore.documents = [
      {
        id: '1', filename: 'report.pdf', mime_type: 'application/pdf',
        size_bytes: 1024, status: 'ready', chunk_count: 5,
        created_at: '2026-06-16T00:00:00Z', updated_at: '2026-06-16T00:00:00Z',
      },
    ] as never;
    renderUpload();
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
  });
});

describe('Upload page — FileDropzone file selection', () => {
  it('accepts a valid PDF file', async () => {
    renderUpload();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['content'], 'test.pdf', { type: 'application/pdf' });
    await userEvent.upload(input, file);
    await waitFor(() => {
      expect(screen.getByText('test.pdf')).toBeInTheDocument();
    });
  });

  it('shows "File 1 document" upload button after a file is selected', async () => {
    renderUpload();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['content'], 'doc.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    await userEvent.upload(input, file);
    await waitFor(() => {
      // Button label is "File 1 document" (not "Upload 1 file")
      expect(screen.getByRole('button', { name: /file 1 document/i })).toBeInTheDocument();
    });
  });
});

describe('Upload page — upload queue', () => {
  it('renders queue items when uploadQueue has entries', () => {
    mockStore.uploadQueue = [
      { id: 'q1', file: new File([''], 'data.txt'), progress: 50, status: 'uploading' },
    ] as never;
    renderUpload();
    expect(screen.getByText('data.txt')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('shows "Uploading" badge during upload', () => {
    mockStore.uploadQueue = [
      { id: 'q2', file: new File([''], 'upload.pdf'), progress: 30, status: 'uploading' },
    ] as never;
    renderUpload();
    expect(screen.getByText(/uploading/i)).toBeInTheDocument();
  });

  it('does not show a progress bar when item is ready (ready items filtered from active queue)', () => {
    mockStore.uploadQueue = [
      { id: 'q3', file: new File([''], 'done.pdf'), progress: 100, status: 'ready' },
    ] as never;
    renderUpload();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('shows error message on failed item', () => {
    mockStore.uploadQueue = [
      {
        id: 'q4', file: new File([''], 'fail.pdf'),
        progress: 0, status: 'failed', error: 'Server rejected the file',
      },
    ] as never;
    renderUpload();
    expect(screen.getByText('Server rejected the file')).toBeInTheDocument();
  });

  it('never renders "[object Object]" when error is an object (defensive guard)', () => {
    mockStore.uploadQueue = [
      {
        id: 'q4b',
        file: new File([''], 'bad.pdf'),
        progress: 0,
        status: 'failed',
        error: { code: 'X', message: 'ignored' } as never,
      },
    ] as never;
    renderUpload();
    expect(screen.queryByText(/\[object Object\]/i)).not.toBeInTheDocument();
    expect(screen.getByText(/upload failed — please retry/i)).toBeInTheDocument();
  });

  it('shows Retry button on failed items and re-triggers upload without duplicating', async () => {
    const file = new File([''], 'retry-me.pdf', { type: 'application/pdf' });
    mockStore.uploadQueue = [
      { id: 'q6', file, progress: 0, status: 'failed', error: 'Magic bytes mismatch' },
    ] as never;

    renderUpload();

    const retryBtn = screen.getByRole('button', { name: /retry upload of retry-me.pdf/i });
    expect(retryBtn).toBeInTheDocument();

    await userEvent.click(retryBtn);

    expect(mockStore.retryQueueItem).toHaveBeenCalledWith('q6');
    expect(mockStore.addToUploadQueue).not.toHaveBeenCalled();
  });

  it('remove button calls removeFromQueue', async () => {
    mockStore.uploadQueue = [
      { id: 'q5', file: new File([''], 'removeme.txt'), progress: 0, status: 'uploading' },
    ] as never;
    renderUpload();
    const removeBtn = screen.getByRole('button', { name: /remove removeme.txt/i });
    await userEvent.click(removeBtn);
    expect(mockStore.removeFromQueue).toHaveBeenCalledWith('removeme.txt');
  });
});

describe('Upload page — upload trigger', () => {
  it('calls addToUploadQueue and startUpload when "File document" button clicked', async () => {
    renderUpload();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
    await userEvent.upload(input, file);

    // Button says "File 1 document" not "Upload 1 file"
    const uploadBtn = await screen.findByRole('button', { name: /file 1 document/i });
    await userEvent.click(uploadBtn);

    await waitFor(() => {
      expect(mockStore.addToUploadQueue).toHaveBeenCalledWith([file]);
      expect(mockStore.startUpload).toHaveBeenCalled();
    });
  });
});
