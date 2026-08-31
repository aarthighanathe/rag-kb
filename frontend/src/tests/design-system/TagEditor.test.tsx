/**
 * @file TagEditor.test.tsx
 * @description Focused unit tests for TagEditor, mounted standalone (not via the
 *   Documents page) — adding a tag via Enter, rejecting blank/whitespace tags,
 *   removing an existing tag, and the updateDocumentTags call each triggers.
 * @author [Author Placeholder]
 * @created 2026-08-31
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TagEditor } from '../../design-system/components/TagEditor';
import { useRagStore } from '../../stores/ragStore';
import { ToastProvider } from '../../contexts/ToastContext';
import type { DocumentRecord } from '../../services/api';

vi.mock('../../stores/ragStore', () => ({ useRagStore: vi.fn() }));

const updateDocumentTagsMock = vi.fn();

function mockStore(): void {
  const state = { updateDocumentTags: updateDocumentTagsMock };
  // Mirror real Zustand selector behavior: TagEditor calls
  // useRagStore((s) => s.updateDocumentTags), so the mock must invoke the
  // selector against a state object rather than returning a flat value.
  (useRagStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state),
  );
}

function renderTagEditor(doc: DocumentRecord): ReturnType<typeof render> {
  return render(
    <ToastProvider>
      <TagEditor doc={doc} />
    </ToastProvider>,
  );
}

const baseDoc: DocumentRecord = {
  id: 'doc-1',
  filename: 'report.pdf',
  mime_type: 'application/pdf',
  size_bytes: 2048,
  status: 'ready',
  chunk_count: 5,
  created_at: '2026-06-16T10:00:00.000Z',
  updated_at: '2026-06-16T10:00:00.000Z',
  tags: [],
};

beforeEach(() => {
  updateDocumentTagsMock.mockReset();
  updateDocumentTagsMock.mockResolvedValue(undefined);
  mockStore();
});

describe('TagEditor', () => {
  it('renders existing tags as removable chips', () => {
    renderTagEditor({ ...baseDoc, tags: ['pricing', 'faq'] });

    expect(screen.getByText('pricing')).toBeInTheDocument();
    expect(screen.getByText('faq')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove tag pricing' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove tag faq' })).toBeInTheDocument();
  });

  it('adds a tag when Enter is pressed in the input', async () => {
    renderTagEditor(baseDoc);
    const user = userEvent.setup();
    const input = screen.getByRole('textbox', { name: 'New tag' });

    await user.type(input, 'billing{Enter}');

    await waitFor(() => {
      expect(updateDocumentTagsMock).toHaveBeenCalledWith('doc-1', ['billing']);
    });
  });

  it('adds a tag when the Add-tag button is clicked', async () => {
    renderTagEditor(baseDoc);
    const user = userEvent.setup();
    const input = screen.getByRole('textbox', { name: 'New tag' });

    await user.type(input, 'urgent');
    await user.click(screen.getByRole('button', { name: 'Add tag' }));

    await waitFor(() => {
      expect(updateDocumentTagsMock).toHaveBeenCalledWith('doc-1', ['urgent']);
    });
  });

  it('clears the input after adding a tag', async () => {
    renderTagEditor(baseDoc);
    const user = userEvent.setup();
    const input = screen.getByRole('textbox', { name: 'New tag' }) as HTMLInputElement;

    await user.type(input, 'billing{Enter}');

    await waitFor(() => expect(input.value).toBe(''));
  });

  it('rejects a blank tag — does not call the API', async () => {
    renderTagEditor(baseDoc);
    const user = userEvent.setup();
    const input = screen.getByRole('textbox', { name: 'New tag' });

    await user.click(input);
    await user.keyboard('{Enter}');

    expect(updateDocumentTagsMock).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only tag — does not call the API', async () => {
    renderTagEditor(baseDoc);
    const user = userEvent.setup();
    const input = screen.getByRole('textbox', { name: 'New tag' });

    await user.type(input, '   {Enter}');

    expect(updateDocumentTagsMock).not.toHaveBeenCalled();
  });

  it('trims leading/trailing whitespace from an accepted tag', async () => {
    renderTagEditor(baseDoc);
    const user = userEvent.setup();
    const input = screen.getByRole('textbox', { name: 'New tag' });

    await user.type(input, '  billing  {Enter}');

    await waitFor(() => {
      expect(updateDocumentTagsMock).toHaveBeenCalledWith('doc-1', ['billing']);
    });
  });

  it('rejects a duplicate tag that already exists on the document', async () => {
    renderTagEditor({ ...baseDoc, tags: ['billing'] });
    const user = userEvent.setup();
    const input = screen.getByRole('textbox', { name: 'New tag' });

    await user.type(input, 'billing{Enter}');

    expect(updateDocumentTagsMock).not.toHaveBeenCalled();
  });

  it('removes an existing tag when its remove button is clicked', async () => {
    renderTagEditor({ ...baseDoc, tags: ['pricing', 'faq'] });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Remove tag pricing' }));

    await waitFor(() => {
      expect(updateDocumentTagsMock).toHaveBeenCalledWith('doc-1', ['faq']);
    });
  });

  it('disables add controls once the 20-tag limit is reached', () => {
    const tags = Array.from({ length: 20 }, (_, i) => `tag-${i}`);
    renderTagEditor({ ...baseDoc, tags });

    expect(screen.getByRole('textbox', { name: 'New tag' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add tag' })).toBeDisabled();
  });

  it('shows an error toast when updateDocumentTags rejects', async () => {
    updateDocumentTagsMock.mockRejectedValue(new Error('Server unavailable'));
    renderTagEditor(baseDoc);
    const user = userEvent.setup();
    const input = screen.getByRole('textbox', { name: 'New tag' });

    await user.type(input, 'billing{Enter}');

    await waitFor(() => {
      expect(screen.getByText('Server unavailable')).toBeInTheDocument();
    });
  });

  it('has an accessible label naming the document', () => {
    renderTagEditor(baseDoc);
    expect(screen.getByLabelText('Tags for report.pdf')).toBeInTheDocument();
  });
});
