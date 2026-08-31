/**
 * @file DeleteModal.test.tsx
 * @description Unit tests for DeleteModal — the destructive-action confirmation modal
 *   shown before deleting one or more documents.
 * @author [Author Placeholder]
 * @created 2026-08-31
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeleteModal } from '../../design-system/components/DeleteModal';
import type { DocumentRecord } from '../../services/api';

const doc1: DocumentRecord = {
  id: 'doc-1234567890',
  filename: 'report.pdf',
  mime_type: 'application/pdf',
  size_bytes: 2048,
  status: 'ready',
  chunk_count: 5,
  created_at: '2026-06-16T10:00:00.000Z',
  updated_at: '2026-06-16T10:00:00.000Z',
  tags: [],
};

const doc2: DocumentRecord = {
  id: 'doc-abcdefghij',
  filename: 'notes.md',
  mime_type: 'text/markdown',
  size_bytes: 512,
  status: 'ready',
  chunk_count: 2,
  created_at: '2026-06-17T10:00:00.000Z',
  updated_at: '2026-06-17T10:00:00.000Z',
  tags: [],
};

describe('DeleteModal', () => {
  it('renders singular confirmation copy for one target', () => {
    render(
      <DeleteModal targets={[doc1]} onConfirm={vi.fn()} onCancel={vi.fn()} isDeleting={false} />,
    );

    expect(screen.getByText('Remove document?')).toBeInTheDocument();
    expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument();
  });

  it('renders plural confirmation copy for multiple targets', () => {
    render(
      <DeleteModal
        targets={[doc1, doc2]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        isDeleting={false}
      />,
    );

    expect(screen.getByText('Remove 2 documents?')).toBeInTheDocument();
  });

  it('lists each target document filename and truncated id', () => {
    render(
      <DeleteModal
        targets={[doc1, doc2]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        isDeleting={false}
      />,
    );

    expect(screen.getByText(/report\.pdf/)).toBeInTheDocument();
    expect(screen.getByText(/notes\.md/)).toBeInTheDocument();
    expect(screen.getByText(/id doc-1234/)).toBeInTheDocument();
  });

  it('confirm button reads "Remove 1 document" for a single target', () => {
    render(
      <DeleteModal targets={[doc1]} onConfirm={vi.fn()} onCancel={vi.fn()} isDeleting={false} />,
    );

    expect(screen.getByTestId('confirm-delete')).toHaveTextContent('Remove 1 document');
  });

  it('confirm button reads "Remove N documents" for multiple targets', () => {
    render(
      <DeleteModal
        targets={[doc1, doc2]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        isDeleting={false}
      />,
    );

    expect(screen.getByTestId('confirm-delete')).toHaveTextContent('Remove 2 documents');
  });

  it('calls onConfirm when the confirm button is clicked', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <DeleteModal targets={[doc1]} onConfirm={onConfirm} onCancel={vi.fn()} isDeleting={false} />,
    );

    await userEvent.click(screen.getByTestId('confirm-delete'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when the cancel button is clicked', async () => {
    const onCancel = vi.fn();
    render(
      <DeleteModal targets={[doc1]} onConfirm={vi.fn()} onCancel={onCancel} isDeleting={false} />,
    );

    await userEvent.click(screen.getByTestId('cancel-delete'));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows a "Removing…" label and disables cancel while isDeleting is true', () => {
    render(
      <DeleteModal targets={[doc1]} onConfirm={vi.fn()} onCancel={vi.fn()} isDeleting={true} />,
    );

    expect(screen.getByTestId('confirm-delete')).toHaveTextContent('Removing…');
    expect(screen.getByTestId('cancel-delete')).toBeDisabled();
  });

  it('prevents backdrop-click close while isDeleting is true', async () => {
    const onCancel = vi.fn();
    const { container } = render(
      <DeleteModal targets={[doc1]} onConfirm={vi.fn()} onCancel={onCancel} isDeleting={true} />,
    );

    const backdrop = container.querySelector('[aria-hidden="true"]');
    expect(backdrop).not.toBeNull();
    await userEvent.click(backdrop as Element);

    expect(onCancel).not.toHaveBeenCalled();
  });

  it('allows backdrop-click close when not deleting', async () => {
    const onCancel = vi.fn();
    const { container } = render(
      <DeleteModal targets={[doc1]} onConfirm={vi.fn()} onCancel={onCancel} isDeleting={false} />,
    );

    const backdrop = container.querySelector('[aria-hidden="true"]');
    expect(backdrop).not.toBeNull();
    await userEvent.click(backdrop as Element);

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('allows Escape to call onCancel when not deleting', async () => {
    const onCancel = vi.fn();
    render(
      <DeleteModal targets={[doc1]} onConfirm={vi.fn()} onCancel={onCancel} isDeleting={false} />,
    );

    await userEvent.keyboard('{Escape}');

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders as an accessible dialog', () => {
    render(
      <DeleteModal targets={[doc1]} onConfirm={vi.fn()} onCancel={vi.fn()} isDeleting={false} />,
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
