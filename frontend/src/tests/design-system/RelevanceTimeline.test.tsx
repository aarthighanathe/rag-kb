/**
 * @file RelevanceTimeline.test.tsx
 * @description Unit tests for the RelevanceTimeline component.
 * @author [Author Placeholder]
 * @created 2026-07-01
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RelevanceTimeline } from '../../design-system/components/RelevanceTimeline';
import type { ChatCitation } from '../../design-system/components/ChatMessage';

const mockCitations: ChatCitation[] = [
  {
    id: 'c1',
    documentName: 'paper.pdf',
    chunkRef: 'Chunk 1',
    relevanceScore: 0.94,
    fullText: 'Full text 1',
  },
  {
    id: 'c2',
    documentName: 'research.pdf',
    chunkRef: 'Chunk 2',
    relevanceScore: 0.87,
    fullText: 'Full text 2',
  },
  {
    id: 'c3',
    documentName: 'notes.md',
    chunkRef: 'Chunk 3',
    relevanceScore: 0.45,
    fullText: 'Full text 3',
  },
];

describe('RelevanceTimeline', () => {
  it('renders nothing when citations are empty', () => {
    const { container } = render(
      <RelevanceTimeline citations={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders toggle button with citation count', () => {
    render(<RelevanceTimeline citations={mockCitations} />);
    expect(screen.getByTestId('timeline-toggle')).toBeInTheDocument();
    // Component renders "N passages" (or "1 passage"), not "N chunks" —
    // text is split across sibling nodes ("3", " ", "passages"), so match
    // the toggle button's accessible text as a whole rather than one string.
    expect(screen.getByTestId('timeline-toggle')).toHaveTextContent(/3\s*passages/);
  });

  it('timeline content is hidden by default', () => {
    render(<RelevanceTimeline citations={mockCitations} />);
    expect(screen.queryByTestId('relevance-timeline-content')).not.toBeInTheDocument();
  });

  it('expands content when toggle is clicked', () => {
    render(<RelevanceTimeline citations={mockCitations} />);
    fireEvent.click(screen.getByTestId('timeline-toggle'));
    expect(screen.getByTestId('relevance-timeline-content')).toBeInTheDocument();
  });

  it('shows all citation bars when expanded', () => {
    render(<RelevanceTimeline citations={mockCitations} />);
    fireEvent.click(screen.getByTestId('timeline-toggle'));
    expect(screen.getByTestId('timeline-bar-1')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-bar-2')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-bar-3')).toBeInTheDocument();
  });

  it('sorts citations by relevance score descending', () => {
    render(<RelevanceTimeline citations={mockCitations} />);
    fireEvent.click(screen.getByTestId('timeline-toggle'));
    // First bar should be highest score (0.94)
    const bar1Score = screen.getByText('94%');
    expect(bar1Score).toBeInTheDocument();
  });

  it('displays score percentage for each bar', () => {
    render(<RelevanceTimeline citations={mockCitations} />);
    fireEvent.click(screen.getByTestId('timeline-toggle'));
    expect(screen.getByText('94%')).toBeInTheDocument();
    expect(screen.getByText('87%')).toBeInTheDocument();
    expect(screen.getByText('45%')).toBeInTheDocument();
  });

  it('toggles aria-expanded on button', () => {
    render(<RelevanceTimeline citations={mockCitations} />);
    const toggle = screen.getByTestId('timeline-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('disables toggle during streaming', () => {
    render(<RelevanceTimeline citations={mockCitations} isStreaming={true} />);
    const toggle = screen.getByTestId('timeline-toggle');
    expect(toggle).toBeDisabled();
  });

  it('shows document name for each bar', () => {
    render(<RelevanceTimeline citations={mockCitations} />);
    fireEvent.click(screen.getByTestId('timeline-toggle'));
    expect(screen.getByText('paper.pdf')).toBeInTheDocument();
    expect(screen.getByText('research.pdf')).toBeInTheDocument();
    expect(screen.getByText('notes.md')).toBeInTheDocument();
  });
});
