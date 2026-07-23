/**
 * @file QueryHistoryPanel.test.tsx
 * @description Unit tests for QueryHistoryPanel component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryHistoryPanel, type QueryHistoryPanelProps } from '../../design-system/components/QueryHistoryPanel';
import type { HistoryEntry } from '../../utils/queryHistory';

const makeEntries = (...queries: string[]): HistoryEntry[] =>
  queries.map((q, i) => ({
    id: `id-${i}`,
    query: q,
    timestamp: new Date(Date.now() - i * 60_000).toISOString(),
    citationCount: 3,
    confidenceLevel: 'medium' as const,
  }));

function renderPanel(overrides: Partial<QueryHistoryPanelProps> = {}) {
  const defaults: QueryHistoryPanelProps = {
    entries: [],
    onRerun: vi.fn(),
    onRemove: vi.fn(),
    onClear: vi.fn(),
    isStreaming: false,
    ...overrides,
  };
  return { ...defaults, ...render(<QueryHistoryPanel {...defaults} />) };
}

describe('QueryHistoryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('empty state', () => {
    it('renders the section wrapper', () => {
      renderPanel();
      expect(screen.getByTestId('history-section')).toBeInTheDocument();
    });

    it('renders "Recent queries" toggle button', () => {
      renderPanel();
      expect(screen.getByTestId('history-toggle')).toHaveTextContent(/recent queries/i);
    });

    it('does not show entries list when no entries', () => {
      renderPanel();
      expect(screen.queryByRole('list')).not.toBeInTheDocument();
    });
  });

  describe('with entries', () => {
    it('renders entry rows with query text', () => {
      renderPanel({ entries: makeEntries('query A', 'query B') });
      expect(screen.getByText('query A')).toBeInTheDocument();
      expect(screen.getByText('query B')).toBeInTheDocument();
    });

    it('shows citation count for each entry', () => {
      renderPanel({ entries: makeEntries('q1') });
      expect(screen.getByText('3 sources')).toBeInTheDocument();
    });

    it('calls onRerun when entry is clicked', async () => {
      const onRerun = vi.fn();
      renderPanel({ entries: makeEntries('rerun me'), onRerun });
      await userEvent.click(screen.getByText('rerun me'));
      expect(onRerun).toHaveBeenCalledWith('rerun me');
    });

    it('delete button calls onRemove', async () => {
      const onRemove = vi.fn();
      renderPanel({ entries: makeEntries('to delete'), onRemove });
      const deleteBtn = screen.getByTestId('history-delete');
      await userEvent.click(deleteBtn);
      expect(onRemove).toHaveBeenCalledWith('id-0');
    });

    it('clear-all button calls onClear after 2-click confirm', async () => {
      const onClear = vi.fn();
      renderPanel({ entries: makeEntries('q1'), onClear });
      await userEvent.click(screen.getByTestId('history-clear'));
      expect(onClear).not.toHaveBeenCalled();
      await userEvent.click(screen.getByTestId('history-clear'));
      expect(onClear).toHaveBeenCalledOnce();
    });
  });

  describe('streaming disabled', () => {
    it('reduces entry opacity when isStreaming', () => {
      renderPanel({ entries: makeEntries('locked'), isStreaming: true });
      const entry = screen.getByTestId('history-entry');
      expect(entry).toHaveStyle({ opacity: 0.5 });
    });

    it('sets cursor to not-allowed when isStreaming', () => {
      renderPanel({ entries: makeEntries('locked'), isStreaming: true });
      const entry = screen.getByTestId('history-entry');
      expect(entry).toHaveStyle({ cursor: 'not-allowed' });
    });

    it('does not render delete buttons when isStreaming', () => {
      renderPanel({ entries: makeEntries('locked'), isStreaming: true });
      expect(screen.queryByTestId('history-delete')).not.toBeInTheDocument();
    });
  });

  describe('collapse/expand', () => {
    it('toggle button expands/collapses entry list', async () => {
      renderPanel({ entries: makeEntries('q1') });
      const toggle = screen.getByTestId('history-toggle');
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await userEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await userEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
    });
  });

  describe('controlled mode', () => {
    it('uses open/onToggle when provided', async () => {
      const onToggle = vi.fn();
      renderPanel({ entries: makeEntries('q1'), open: true, onToggle });
      const toggle = screen.getByTestId('history-toggle');
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await userEvent.click(toggle);
      expect(onToggle).toHaveBeenCalledOnce();
    });
  });

  describe('confidence dot', () => {
    it('shows confidence dot with aria-label', () => {
      const entries: HistoryEntry[] = [{
        id: 'h1', query: 'q', timestamp: new Date().toISOString(),
        citationCount: 5, confidenceLevel: 'high',
      }];
      renderPanel({ entries });
      expect(screen.getByLabelText('Confidence: high')).toBeInTheDocument();
    });
  });
});
