/**
 * @file SourcePanel.test.tsx
 * @description Unit tests for SourcePanel component (split-screen right panel)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SourcePanel, type SourcePanelProps } from '../../design-system/components/SourcePanel';
import { ChatLayoutProvider } from '../../contexts/ChatLayoutContext';
import type { Citation } from '../../stores/ragStore';

vi.mock('../../contexts/ToastContext', () => ({
  useAppToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), dismissAll: vi.fn(), toasts: [] }),
}));

const layoutDefaults = {
  splitScreenEnabled: true,
  hideIndexCards: true,
  hideTimeline: true,
  activeCitation: null as number | null,
  onCitationEnter: vi.fn(),
  onCitationLeave: vi.fn(),
  onCitationClick: vi.fn(),
  registerLastMessageCopyHandler: vi.fn(),
  copyLastMessage: vi.fn(),
};

function renderPanel(overrides: Partial<SourcePanelProps> = {}) {
  const props: SourcePanelProps = {
    liveChunks: [],
    queryPhase: 'idle',
    ...overrides,
  };
  return render(
    <ChatLayoutProvider value={layoutDefaults}>
      <SourcePanel {...props} />
    </ChatLayoutProvider>,
  );
}

const makeChunks = (...names: string[]): Citation[] =>
  names.map((name, i) => ({
    documentId: `doc-${i}`,
    documentName: name,
    chunkId: `chunk-${i}`,
    chunkRef: `Chunk ${i + 1}`,
    similarity: 0.9 - i * 0.1,
    excerpt: `Excerpt from ${name}`,
  }));

describe('SourcePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders idle state with empty message', () => {
    renderPanel({ queryPhase: 'idle' });
    expect(screen.getByText(/sources appear here/i)).toBeInTheDocument();
  });

  it('renders searching indicator when queryPhase is searching', () => {
    renderPanel({ queryPhase: 'searching' });
    expect(screen.getByText(/searching knowledge base/i)).toBeInTheDocument();
    expect(screen.getByTestId('source-searching')).toBeInTheDocument();
  });

  it('renders IndexCards when liveChunks exist', () => {
    renderPanel({ liveChunks: makeChunks('report.pdf'), queryPhase: 'streaming' });
    expect(screen.getAllByTestId('source-panel-card')).toHaveLength(1);
  });

  it('renders multiple cards', () => {
    renderPanel({ liveChunks: makeChunks('a.pdf', 'b.pdf'), queryPhase: 'streaming' });
    expect(screen.getAllByTestId('source-panel-card')).toHaveLength(2);
  });

  it('renders confidence bar when chunks exist and not searching', () => {
    renderPanel({ liveChunks: makeChunks('report.pdf'), queryPhase: 'streaming' });
    expect(screen.getByTestId('source-confidence')).toBeInTheDocument();
  });

  it('does not render confidence bar during searching phase', () => {
    renderPanel({ liveChunks: makeChunks('report.pdf'), queryPhase: 'searching' });
    expect(screen.queryByTestId('source-confidence')).not.toBeInTheDocument();
  });

  it('renders count badge when chunks exist', () => {
    renderPanel({ liveChunks: makeChunks('a.pdf', 'b.pdf'), queryPhase: 'complete' });
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows "SOURCE DOCUMENTS" header', () => {
    renderPanel();
    expect(screen.getByText('SOURCE DOCUMENTS')).toBeInTheDocument();
  });

  it('shows relevance timeline when chunks exist', () => {
    renderPanel({ liveChunks: makeChunks('report.pdf'), queryPhase: 'complete' });
    expect(screen.getByTestId('relevance-timeline')).toBeInTheDocument();
  });

  it('complete phase keeps cards visible', () => {
    renderPanel({ liveChunks: makeChunks('report.pdf'), queryPhase: 'complete' });
    expect(screen.getAllByText(/report\.pdf/).length).toBeGreaterThan(0);
  });
});
