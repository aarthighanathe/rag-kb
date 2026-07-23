/**
 * @file Documents.test.tsx
 * @description Tests for the Documents page — grid/table rendering, delete modal,
 *   bulk selection, empty states, sort/filter controls, and responsive view toggle.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Documents } from '../../pages/Documents';
import { useRagStore } from '../../stores/ragStore';
import type { DocumentRecord } from '../../services/api';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../stores/ragStore', () => ({ useRagStore: vi.fn() }));

vi.mock('../../contexts/ToastContext', () => ({
  useAppToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), dismissAll: vi.fn(), toasts: [] }),
}));

const deleteDocumentMock = vi.fn().mockResolvedValue(undefined);
const fetchDocumentsMock = vi.fn().mockResolvedValue(undefined);

const sampleDocs: DocumentRecord[] = [
  {
    id: 'doc-1', filename: 'annual_report.pdf', mime_type: 'application/pdf',
    size_bytes: 204_800, status: 'ready', chunk_count: 12,
    created_at: '2026-06-10T10:00:00Z', updated_at: '2026-06-10T10:00:00Z',
  },
  {
    id: 'doc-2', filename: 'notes.md', mime_type: 'text/markdown',
    size_bytes: 1024, status: 'processing', chunk_count: 0,
    created_at: '2026-06-14T08:00:00Z', updated_at: '2026-06-14T08:00:00Z',
  },
  {
    id: 'doc-3', filename: 'spec.docx',
    mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size_bytes: 51_200, status: 'failed', chunk_count: 0,
    created_at: '2026-06-15T12:00:00Z', updated_at: '2026-06-15T12:00:00Z',
    error_message: 'Parsing error',
  },
];

function buildStore(overrides: object = {}) {
  return {
    documents:        sampleDocs,
    documentsLoading: false,
    documentsError:   null,
    fetchDocuments:   fetchDocumentsMock,
    deleteDocument:   deleteDocumentMock,
    ...overrides,
  };
}

function renderDocuments(storeOverrides: object = {}) {
  (useRagStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
    buildStore(storeOverrides),
  );
  return render(
    <MemoryRouter>
      <Documents />
    </MemoryRouter>,
  );
}

/** Switch to table view so table-specific assertions work. */
async function switchToTableView() {
  await userEvent.click(screen.getByRole('button', { name: /table view/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe('Documents page — rendering', () => {
  it('renders the "Archive" page heading', () => {
    renderDocuments();
    // The h1 says "Archive" (the page title), not "Documents"
    expect(screen.getByRole('heading', { name: /archive/i })).toBeInTheDocument();
  });

  it('renders document filenames in grid view (default)', () => {
    renderDocuments();
    expect(screen.getByText('annual_report.pdf')).toBeInTheDocument();
    expect(screen.getByText('notes.md')).toBeInTheDocument();
    expect(screen.getByText('spec.docx')).toBeInTheDocument();
  });

  it('renders the documents table when table view is selected', async () => {
    renderDocuments();
    await switchToTableView();
    expect(screen.getByRole('table', { name: /documents table/i })).toBeInTheDocument();
  });

  it('renders a row for each document in table view', async () => {
    renderDocuments();
    await switchToTableView();
    expect(screen.getByText('annual_report.pdf')).toBeInTheDocument();
    expect(screen.getByText('notes.md')).toBeInTheDocument();
    expect(screen.getByText('spec.docx')).toBeInTheDocument();
  });

  it('renders stats bar', () => {
    renderDocuments();
    expect(screen.getByLabelText(/document statistics/i)).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument(); // total docs count
  });

  it('shows status badges', () => {
    renderDocuments();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('Processing')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Empty states
// ---------------------------------------------------------------------------

describe('Documents page — empty state', () => {
  it('shows "Archive is empty" title when no documents', () => {
    renderDocuments({ documents: [] });
    expect(screen.getByText(/archive is empty/i)).toBeInTheDocument();
  });

  it('shows upload CTA link in empty state', () => {
    renderDocuments({ documents: [] });
    expect(screen.getByRole('link', { name: /upload documents/i })).toBeInTheDocument();
  });

  it('links upload CTA to /upload', () => {
    renderDocuments({ documents: [] });
    const link = screen.getByRole('link', { name: /upload documents/i });
    expect(link).toHaveAttribute('href', '/upload');
  });

  it('shows loading spinner while loading', () => {
    renderDocuments({ documents: [], documentsLoading: true });
    expect(screen.getByLabelText(/loading archive/i)).toBeInTheDocument();
  });

  it('shows the plain empty state with no error banner when the fetch succeeds with zero documents', () => {
    renderDocuments({ documents: [], documentsError: null });
    expect(screen.getByText(/archive is empty/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/can't reach the server/i)).not.toBeInTheDocument();
  });

  it('shows "No results" when filter has no matches', async () => {
    renderDocuments({ documents: [sampleDocs[0]] });
    const statusSelect = screen.getByRole('combobox', { name: /filter by status/i });
    await userEvent.selectOptions(statusSelect, 'failed');
    expect(screen.getByText(/no results/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

describe('Documents page — error state', () => {
  it('renders documentsError string defensively', () => {
    renderDocuments({ documentsError: 'Network error' });
    expect(screen.getByRole('alert')).toHaveTextContent('Network error');
  });

  it('renders fallback text when documentsError is non-string (defensive Bug 1 guard)', () => {
    // Simulates runtime edge case where a non-string reaches the renderer
    renderDocuments({ documentsError: { message: 'oops' } as unknown as string });
    expect(screen.getByRole('alert')).toHaveTextContent(/an error occurred/i);
  });
});

describe('Documents page — connection error state', () => {
  it('shows a dedicated "can\'t reach the server" state instead of "Archive is empty" when fetch fails with no cached documents', () => {
    renderDocuments({ documents: [], documentsError: 'Could not reach the server. Ensure the backend is running on port 3000.' });
    expect(screen.getByText(/can't reach the server/i)).toBeInTheDocument();
    expect(screen.queryByText(/archive is empty/i)).not.toBeInTheDocument();
  });

  it('does not show the misleading upload CTA during a connection error', () => {
    renderDocuments({ documents: [], documentsError: 'Could not reach the server.' });
    expect(screen.queryByRole('link', { name: /upload documents/i })).not.toBeInTheDocument();
  });

  it('offers a retry action that re-fetches documents', async () => {
    renderDocuments({ documents: [], documentsError: 'Could not reach the server.' });
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(fetchDocumentsMock).toHaveBeenCalled();
  });

  it('keeps the inline banner (not the full-page state) when a refresh fails but documents are still cached', () => {
    renderDocuments({ documentsError: 'Could not reach the server.' });
    expect(screen.getByRole('alert')).toHaveTextContent(/could not reach the server/i);
    expect(screen.queryByText(/can't reach the server/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Delete — single document
// ---------------------------------------------------------------------------

describe('Documents page — delete single document', () => {
  it('shows delete confirmation modal with "Remove document?" title', async () => {
    renderDocuments();
    await switchToTableView();
    const deleteButtons = screen.getAllByRole('button', { name: /delete annual_report\.pdf/i });
    await userEvent.click(deleteButtons[0]!);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/remove document\?/i)).toBeInTheDocument();
  });

  it('calls deleteDocument on modal confirm', async () => {
    renderDocuments();
    await switchToTableView();
    const deleteBtn = screen.getAllByRole('button', { name: /delete annual_report\.pdf/i })[0]!;
    await userEvent.click(deleteBtn);

    const confirmBtn = screen.getByRole('button', { name: /remove 1 document/i });
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      expect(deleteDocumentMock).toHaveBeenCalledWith('doc-1');
    });
  });

  it('closes modal on cancel without deleting', async () => {
    renderDocuments();
    await switchToTableView();
    const deleteBtn = screen.getAllByRole('button', { name: /delete annual_report\.pdf/i })[0]!;
    await userEvent.click(deleteBtn);

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(deleteDocumentMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Bulk select
// ---------------------------------------------------------------------------

describe('Documents page — bulk select', () => {
  it('select-all checkbox selects all visible grid cards', async () => {
    renderDocuments();
    const selectAll = screen.getByRole('checkbox', { name: /select all documents/i });
    await userEvent.click(selectAll);

    const rowCheckboxes = screen.getAllByRole('checkbox', { name: /select .+/i });
    rowCheckboxes.forEach((cb) => expect(cb).toBeChecked());
  });

  it('"Remove N" bulk button appears after selecting rows', async () => {
    renderDocuments();
    const selectAll = screen.getByRole('checkbox', { name: /select all documents/i });
    await userEvent.click(selectAll);

    // Button label is "Remove 3" (not "Delete 3")
    expect(screen.getByRole('button', { name: /remove 3/i })).toBeInTheDocument();
  });

  it('bulk delete shows confirmation modal listing selected files', async () => {
    renderDocuments();
    await userEvent.click(screen.getByRole('checkbox', { name: /select all documents/i }));
    await userEvent.click(screen.getByRole('button', { name: /remove 3/i }));

    const dialog = screen.getByRole('dialog');
    // Modal title is "Remove 3 documents?" (not "delete")
    expect(within(dialog).getByText(/remove 3 documents\?/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/annual_report\.pdf/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Expand row (table view only)
// ---------------------------------------------------------------------------

describe('Documents page — expand row (table view)', () => {
  it('clicking a filename button in table view expands chunk preview', async () => {
    renderDocuments();
    await switchToTableView();
    const nameBtn = screen.getByRole('button', { name: /expand.*annual_report\.pdf/i });
    await userEvent.click(nameBtn);
    expect(screen.getByText(/chunk 1/i)).toBeInTheDocument();
  });

  it('clicking again collapses the row', async () => {
    renderDocuments();
    await switchToTableView();
    const nameBtn = screen.getByRole('button', { name: /expand.*annual_report\.pdf/i });
    await userEvent.click(nameBtn);
    await userEvent.click(nameBtn);
    expect(screen.queryByText(/chunk 1/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Filter controls (custom Select renders native <select> internally)
// ---------------------------------------------------------------------------

describe('Documents page — filter controls', () => {
  it('renders status filter combobox', () => {
    renderDocuments();
    expect(screen.getByRole('combobox', { name: /filter by status/i })).toBeInTheDocument();
  });

  it('renders type filter combobox', () => {
    renderDocuments();
    expect(screen.getByRole('combobox', { name: /filter by file type/i })).toBeInTheDocument();
  });

  it('filtering by status shows only matching documents', async () => {
    renderDocuments();
    const statusSelect = screen.getByRole('combobox', { name: /filter by status/i });
    await userEvent.selectOptions(statusSelect, 'ready');

    expect(screen.getByText('annual_report.pdf')).toBeInTheDocument();
    expect(screen.queryByText('notes.md')).not.toBeInTheDocument();
    expect(screen.queryByText('spec.docx')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Sort (table view)
// ---------------------------------------------------------------------------

describe('Documents page — sort (table view)', () => {
  it('clicking the Name sort button toggles sort direction on the column header', async () => {
    renderDocuments();
    await switchToTableView();
    // The sort button is the real focusable/interactive element (Rule 20 —
    // keyboard accessibility); `aria-sort` lives on the parent <th> per the
    // ARIA columnheader pattern, so it's asserted on the header while the
    // click/keyboard interaction happens on the button.
    const nameHeader = screen.getByRole('columnheader', { name: /name/i });
    const sortButton = within(nameHeader).getByRole('button', { name: /sort by name/i });
    await userEvent.click(sortButton);
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');
    await userEvent.click(sortButton);
    expect(nameHeader).toHaveAttribute('aria-sort', 'descending');
  });

  it('the sort button is keyboard-focusable and activates via Enter', async () => {
    renderDocuments();
    await switchToTableView();
    const nameHeader = screen.getByRole('columnheader', { name: /name/i });
    const sortButton = within(nameHeader).getByRole('button', { name: /sort by name/i });
    sortButton.focus();
    expect(sortButton).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');
  });
});
