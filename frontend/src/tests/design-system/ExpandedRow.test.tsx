/**
 * @file ExpandedRow.test.tsx
 * @description Unit tests for ExpandedRow — chunk-preview fetch on mount, loading/error/empty
 *   states, and that it no longer renders the old hardcoded placeholder text.
 * @author [Author Placeholder]
 * @created 2026-08-31
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ExpandedRow } from '../../design-system/components/ExpandedRow';
import { ToastProvider } from '../../contexts/ToastContext';
import type { DocumentRecord, ChunkPreview } from '../../services/api';

const getDocumentChunkPreviewsMock = vi.fn();

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual<typeof import('../../services/api')>('../../services/api');
  return {
    ...actual,
    getDocumentChunkPreviews: (...args: unknown[]) => getDocumentChunkPreviewsMock(...args),
  };
});

function renderRow(doc: DocumentRecord): ReturnType<typeof render> {
  return render(
    <ToastProvider>
      <table>
        <tbody>
          <ExpandedRow doc={doc} colSpan={8} />
        </tbody>
      </table>
    </ToastProvider>,
  );
}

const baseDoc: DocumentRecord = {
  id: 'doc-1',
  filename: 'report.pdf',
  mime_type: 'application/pdf',
  size_bytes: 2048,
  status: 'ready',
  chunk_count: 2,
  created_at: '2026-06-16T10:00:00.000Z',
  updated_at: '2026-06-16T10:00:00.000Z',
  tags: [],
};

beforeEach(() => {
  getDocumentChunkPreviewsMock.mockReset();
});

describe('ExpandedRow', () => {
  it('shows a "still processing" message without fetching when chunk_count is 0', () => {
    renderRow({ ...baseDoc, chunk_count: 0 });

    expect(screen.getByText(/no chunks yet/i)).toBeInTheDocument();
    expect(getDocumentChunkPreviewsMock).not.toHaveBeenCalled();
  });

  it('shows a loading state, then renders real chunk previews from the API', async () => {
    const chunks: ChunkPreview[] = [
      {
        id: 'chunk-1',
        chunkIndex: 0,
        contentPreview: 'Real chunk content here',
        truncated: false,
        tokenCount: 10,
      },
      {
        id: 'chunk-2',
        chunkIndex: 1,
        contentPreview: 'Second chunk…',
        truncated: true,
        tokenCount: 42,
      },
    ];
    let resolveFetch: (value: ChunkPreview[]) => void = () => {};
    getDocumentChunkPreviewsMock.mockReturnValue(
      new Promise<ChunkPreview[]>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    renderRow(baseDoc);

    expect(screen.getByText(/loading chunks/i)).toBeInTheDocument();

    resolveFetch(chunks);

    await waitFor(() => {
      expect(screen.getByText('Real chunk content here')).toBeInTheDocument();
    });
    expect(screen.getByText('Second chunk…')).toBeInTheDocument();
    expect(screen.getByText('Chunk 1')).toBeInTheDocument();
    expect(screen.getByText('Chunk 2')).toBeInTheDocument();
    expect(screen.getByText(/first 2 of 2 chunks/i)).toBeInTheDocument();

    // The old hardcoded placeholder must never appear now that real content is fetched.
    expect(screen.queryByText(/query the document to see content/i)).not.toBeInTheDocument();
    expect(getDocumentChunkPreviewsMock).toHaveBeenCalledWith('doc-1');
  });

  it('shows an error message when the fetch fails', async () => {
    getDocumentChunkPreviewsMock.mockRejectedValue(new Error('network down'));

    renderRow(baseDoc);

    await waitFor(() => {
      expect(screen.getByText(/couldn't load chunk previews/i)).toBeInTheDocument();
    });
  });
});
