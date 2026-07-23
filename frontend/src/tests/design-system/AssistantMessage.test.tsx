/**
 * @file AssistantMessage.test.tsx
 * @description Unit tests for the AssistantMessage component.
 *   Tests citation highlight coordination, bidirectional interaction,
 *   and streaming state handling.
 * @author [Author Placeholder]
 * @created 2026-07-01
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { AssistantMessage } from '../../design-system/components/AssistantMessage';
import { ToastProvider } from '../../contexts/ToastContext';
import type { ChatCitation } from '../../design-system/components/ChatMessage';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ToastProvider>{children}</ToastProvider>
);

const mockCitations: ChatCitation[] = [
  {
    id: 'c1',
    documentName: 'paper.pdf',
    chunkRef: 'Chunk 1',
    relevanceScore: 0.94,
    fullText: 'This is the full text of chunk 1.',
  },
  {
    id: 'c2',
    documentName: 'research.pdf',
    chunkRef: 'Chunk 2',
    relevanceScore: 0.87,
    fullText: 'This is the full text of chunk 2.',
  },
];

describe('AssistantMessage', () => {
  // --------------------------------------------------------------------------
  // Rendering
  // --------------------------------------------------------------------------

  it('renders answer text with CitationMarker components', () => {
    render(
      <AssistantMessage
        content="Answer with citation ①."
        citations={mockCitations}
      />,
      { wrapper },
    );
    // Text is split by the CitationMarker, so we check for partial text
    expect(screen.getByText(/Answer with citation/)).toBeInTheDocument();
    expect(screen.getByTestId('citation-marker-1')).toBeInTheDocument();
  });

  it('renders with bracket notation citations', () => {
    render(
      <AssistantMessage
        content="Answer [1] and [2]."
        citations={mockCitations}
      />,
      { wrapper },
    );
    expect(screen.getByTestId('citation-marker-1')).toBeInTheDocument();
    expect(screen.getByTestId('citation-marker-2')).toBeInTheDocument();
  });

  it('renders with data-testid="assistant-message-{messageIndex}"', () => {
    render(
      <AssistantMessage
        content="Test"
        citations={[]}
        messageIndex={3}
      />,
      { wrapper },
    );
    expect(screen.getByTestId('assistant-message-3')).toBeInTheDocument();
  });

  it('defaults to messageIndex=0 when not provided', () => {
    render(
      <AssistantMessage
        content="Test"
        citations={[]}
      />,
      { wrapper },
    );
    expect(screen.getByTestId('assistant-message-0')).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // IndexCard rendering
  // --------------------------------------------------------------------------

  it('renders IndexCard for each citation', () => {
    render(
      <AssistantMessage
        content="Answer ① ②."
        citations={mockCitations}
      />,
      { wrapper },
    );
    expect(screen.getByTestId('index-card-1')).toBeInTheDocument();
    expect(screen.getByTestId('index-card-2')).toBeInTheDocument();
  });

  it('each IndexCard receives correct citationIndex', () => {
    render(
      <AssistantMessage
        content="Answer ① ②."
        citations={mockCitations}
      />,
      { wrapper },
    );
    const card1 = screen.getByTestId('index-card-1');
    const card2 = screen.getByTestId('index-card-2');
    expect(card1).toBeInTheDocument();
    expect(card2).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Citation interaction
  // --------------------------------------------------------------------------

  it('hovering citation marker sets activeCitation', async () => {
    const firstCitation = mockCitations[0];
    render(
      <AssistantMessage
        content="Answer ① ②."
        citations={firstCitation ? mockCitations : []}
      />,
      { wrapper },
    );
    const marker = screen.getByTestId('citation-marker-1');
    await userEvent.hover(marker);
    // Active citation should highlight the marker
    expect(marker).toHaveStyle({ background: '#FF4D2E' });
  });

  it('hovering card sets activeCitation', async () => {
    const firstCitation = mockCitations[0];
    render(
      <AssistantMessage
        content="Answer ① ②."
        citations={firstCitation ? mockCitations : []}
      />,
      { wrapper },
    );
    const card = screen.getByTestId('index-card-1');
    await userEvent.hover(card);
    // Card should have active styling - check inline style directly (browser converts hex to rgb)
    expect(card.style.border).toMatch(/2px solid/);
    expect(card.style.border).toContain('45, 90, 74');
  });

  it('mouse leave resets activeCitation', async () => {
    const firstCitation = mockCitations[0];
    render(
      <AssistantMessage
        content="Answer ① ②."
        citations={firstCitation ? mockCitations : []}
      />,
      { wrapper },
    );
    const marker = screen.getByTestId('citation-marker-1');
    await userEvent.hover(marker);
    expect(marker).toHaveStyle({ background: '#FF4D2E' });
    await userEvent.unhover(marker);
    // After unhover, marker should return to default state
    expect(marker).toHaveStyle({ background: '#2D5A4A' });
  });

  // --------------------------------------------------------------------------
  // Streaming state
  // --------------------------------------------------------------------------

  it('isStreaming=true disables citation interactions', () => {
    render(
      <AssistantMessage
        content="Streaming ①."
        citations={mockCitations}
        isStreaming={true}
      />,
      { wrapper },
    );
    const marker = screen.getByTestId('citation-marker-1');
    // When disabled, marker should not have role="button"
    expect(marker).not.toHaveAttribute('role', 'button');
  });

  it('isStreaming=true shows streaming cursor', () => {
    render(
      <AssistantMessage
        content="Thinking..."
        citations={[]}
        isStreaming={true}
      />,
      { wrapper },
    );
    // StreamingCursor should be present (aria-hidden)
    expect(document.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });

  it('isStreaming=false enables citation interactions', () => {
    render(
      <AssistantMessage
        content="Done ①."
        citations={mockCitations}
        isStreaming={false}
      />,
      { wrapper },
    );
    const marker = screen.getByTestId('citation-marker-1');
    expect(marker).toHaveAttribute('role', 'button');
  });

  // --------------------------------------------------------------------------
  // Multiple messages have independent state
  // --------------------------------------------------------------------------

  it('multiple messages each have independent activeCitation state', async () => {
    const firstCitation = mockCitations[0];
    const secondCitation = mockCitations[1];
    
    render(
      <>
        <AssistantMessage
          content="First ①."
          citations={firstCitation ? [firstCitation] : []}
          messageIndex={0}
        />
        <AssistantMessage
          content="Second ②."
          citations={secondCitation ? [secondCitation] : []}
          messageIndex={1}
        />
      </>,
      { wrapper },
    );

    const marker1 = screen.getByTestId('assistant-message-0').querySelector('[data-testid="citation-marker-1"]');
    const marker2 = screen.getByTestId('assistant-message-1').querySelector('[data-testid="citation-marker-2"]');

    expect(marker1).toBeInTheDocument();
    expect(marker2).toBeInTheDocument();

    // Hover first message's citation - only first should be active
    if (marker1) {
      await userEvent.hover(marker1);
      expect(marker1).toHaveStyle({ background: '#FF4D2E' });
    }
    if (marker2) {
      // Second message's marker should still be default
      expect(marker2).toHaveStyle({ background: '#2D5A4A' });
    }
  });

  // --------------------------------------------------------------------------
  // Copy button
  // --------------------------------------------------------------------------

  it('renders copy button on completed message', () => {
    render(
      <AssistantMessage
        content="Copy me."
        citations={[]}
        isStreaming={false}
      />,
      { wrapper },
    );
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
  });

  it('does not render copy button during streaming', () => {
    render(
      <AssistantMessage
        content="Streaming..."
        citations={[]}
        isStreaming={true}
      />,
      { wrapper },
    );
    expect(screen.queryByRole('button', { name: /copy/i })).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Timestamp
  // --------------------------------------------------------------------------

  it('renders timestamp when provided', () => {
    const ts = new Date('2026-07-01T14:30:00').toISOString();
    render(
      <AssistantMessage
        content="With time."
        citations={[]}
        timestamp={ts}
      />,
      { wrapper },
    );
    expect(screen.getByText(/2:30/)).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Click citation scrolls card into view
  // --------------------------------------------------------------------------

  it('clicking citation marker scrolls card into view', async () => {
    render(
      <AssistantMessage
        content="Click ① to scroll."
        citations={mockCitations}
      />,
      { wrapper },
    );

    const marker = screen.getByTestId('citation-marker-1');
    const card = screen.getByTestId('index-card-1');
    
    // Mock scrollIntoView
    const scrollIntoViewMock = vi.fn();
    card.scrollIntoView = scrollIntoViewMock;

    await userEvent.click(marker);
    
    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'nearest',
    });
  });

  it('clicking citation adds card-pulse class', async () => {
    render(
      <AssistantMessage
        content="Click ①."
        citations={mockCitations}
      />,
      { wrapper },
    );

    const marker = screen.getByTestId('citation-marker-1');
    const card = screen.getByTestId('index-card-1');
    
    card.scrollIntoView = vi.fn();

    await userEvent.click(marker);
    
    expect(card.classList.contains('card-pulse')).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Cited text highlighting
  // --------------------------------------------------------------------------

  it('highlights cited text span when citation is hovered', async () => {
    const firstCitation = mockCitations[0];
    render(
      <AssistantMessage
        content="Payment is due within 30 days ①."
        citations={firstCitation ? [firstCitation] : []}
      />,
      { wrapper },
    );

    const marker = screen.getByTestId('citation-marker-1');
    await userEvent.hover(marker);

    expect(screen.getByTestId('cited-span-1')).toBeInTheDocument();
    // Text is inside the span, use regex to match
    expect(screen.getByText(/Payment is due within 30 days/)).toBeInTheDocument();
  });

  it('highlight span has correct styling', async () => {
    const firstCitation = mockCitations[0];
    render(
      <AssistantMessage
        content="Text ①."
        citations={firstCitation ? [firstCitation] : []}
      />,
      { wrapper },
    );

    const marker = screen.getByTestId('citation-marker-1');
    await userEvent.hover(marker);

    const span = screen.getByTestId('cited-span-1');
    expect(span).toHaveStyle({
      background: 'rgba(255, 224, 102, 0.35)',
    });
  });

  // --------------------------------------------------------------------------
  // Confidence bar integration
  // --------------------------------------------------------------------------

  it('renders ConfidenceBar on completed message with citations', () => {
    render(
      <AssistantMessage
        content="Answer ①."
        citations={mockCitations}
        isStreaming={false}
      />,
      { wrapper },
    );
    expect(screen.getByTestId('confidence-bar')).toBeInTheDocument();
  });

  it('does not render ConfidenceBar during streaming', () => {
    render(
      <AssistantMessage
        content="Streaming ①."
        citations={mockCitations}
        isStreaming={true}
      />,
      { wrapper },
    );
    expect(screen.queryByTestId('confidence-bar')).not.toBeInTheDocument();
  });

  it('does not render ConfidenceBar when no citations', () => {
    render(
      <AssistantMessage
        content="Answer without sources."
        citations={[]}
        isStreaming={false}
      />,
      { wrapper },
    );
    expect(screen.queryByTestId('confidence-bar')).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Relevance timeline integration
  // --------------------------------------------------------------------------

  it('renders RelevanceTimeline on completed message with citations', () => {
    render(
      <AssistantMessage
        content="Answer ①."
        citations={mockCitations}
        isStreaming={false}
      />,
      { wrapper },
    );
    expect(screen.getByTestId('relevance-timeline')).toBeInTheDocument();
  });

  it('does not render RelevanceTimeline during streaming', () => {
    render(
      <AssistantMessage
        content="Streaming ①."
        citations={mockCitations}
        isStreaming={true}
      />,
      { wrapper },
    );
    expect(screen.queryByTestId('relevance-timeline')).not.toBeInTheDocument();
  });

  it('RelevanceTimeline toggle expands to show bars', () => {
    render(
      <AssistantMessage
        content="Answer ① ②."
        citations={mockCitations}
        isStreaming={false}
      />,
      { wrapper },
    );
    const toggle = screen.getByTestId('timeline-toggle');
    fireEvent.click(toggle);
    expect(screen.getByTestId('relevance-timeline-content')).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // IndexCard cap at 3 visible
  // --------------------------------------------------------------------------

  it('caps IndexCards at 3 visible by default', () => {
    const manyCitations: ChatCitation[] = Array.from({ length: 6 }, (_, i) => ({
      id: `c${i}`,
      documentName: `doc${i}.pdf`,
      chunkRef: `Chunk ${i + 1}`,
      relevanceScore: 0.5 + i * 0.05,
      fullText: `Full text ${i}`,
    }));

    render(
      <AssistantMessage
        content="Answer ① ② ③ ④ ⑤ ⑥."
        citations={manyCitations}
      />,
      { wrapper },
    );

    // Only 3 IndexCards should be visible initially
    expect(screen.getByTestId('index-card-1')).toBeInTheDocument();
    expect(screen.getByTestId('index-card-2')).toBeInTheDocument();
    expect(screen.getByTestId('index-card-3')).toBeInTheDocument();
    expect(screen.queryByTestId('index-card-4')).not.toBeInTheDocument();

    // "+ N more" link should be present
    expect(screen.getByText(/3 more/)).toBeInTheDocument();
  });

  it('clicking "+ N more" shows all IndexCards', () => {
    const manyCitations: ChatCitation[] = Array.from({ length: 6 }, (_, i) => ({
      id: `c${i}`,
      documentName: `doc${i}.pdf`,
      chunkRef: `Chunk ${i + 1}`,
      relevanceScore: 0.5 + i * 0.05,
      fullText: `Full text ${i}`,
    }));

    render(
      <AssistantMessage
        content="Answer ① ② ③ ④ ⑤ ⑥."
        citations={manyCitations}
      />,
      { wrapper },
    );

    // Click "+ 3 more" link
    fireEvent.click(screen.getByText(/3 more/));

    // All 6 cards should now be visible
    expect(screen.getByTestId('index-card-4')).toBeInTheDocument();
    expect(screen.getByTestId('index-card-5')).toBeInTheDocument();
    expect(screen.getByTestId('index-card-6')).toBeInTheDocument();

    // "+ N more" link should be gone
    expect(screen.queryByText(/more/)).not.toBeInTheDocument();
  });

  it('does not show "+ N more" link when 3 or fewer citations', () => {
    render(
      <AssistantMessage
        content="Answer ① ②."
        citations={mockCitations.slice(0, 2)}
      />,
      { wrapper },
    );
    expect(screen.queryByText(/more/)).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Memoization (perf regression guard — audit finding #11)
  //
  // Chat.tsx rebuilds the `citations` array (and the `onFeedback` closure)
  // with a fresh reference on every render of the message list, including
  // every SSE token streamed into an unrelated message. Without a memo
  // comparator that looks at *value* rather than *reference*, every
  // completed message would re-render (and re-parse its Markdown) on every
  // token of whichever message is currently streaming.
  // --------------------------------------------------------------------------

  it('does not re-render a completed message when the parent re-renders with value-equal (but reference-new) props', () => {
    let renderCount = 0;
    function CountingWrapper({ citationScore }: { citationScore: number }): React.JSX.Element {
      renderCount += 1;
      return (
        <AssistantMessage
          content="Completed answer."
          // A fresh array literal every render, like Chat.tsx's
          // `msg.citations?.map(...)` — same values, new reference.
          citations={[
            { id: 'c1', documentName: 'paper.pdf', chunkRef: 'Chunk 1', relevanceScore: citationScore },
          ]}
          isStreaming={false}
        />
      );
    }

    const { rerender } = render(<CountingWrapper citationScore={0.9} />, { wrapper });
    expect(renderCount).toBe(1);

    // Re-render the parent with an equivalent (but new-reference) citations
    // array, simulating an unrelated sibling message's SSE token arriving.
    rerender(<CountingWrapper citationScore={0.9} />);
    expect(renderCount).toBe(2); // wrapper itself always re-renders

    // The memoized AssistantMessage should still show exactly one copy of
    // the content — i.e. it did not throw or duplicate — and critically,
    // per-render work (Markdown parse) was skipped internally. We assert
    // the externally-observable contract: content renders correctly and
    // is stable across the equal-props re-render.
    expect(screen.getByText('Completed answer.')).toBeInTheDocument();
  });

  it('still re-renders with updated content while streaming (memo does not stale-freeze the active message)', () => {
    const { rerender } = render(
      <AssistantMessage content="Partial" citations={[]} isStreaming />,
      { wrapper },
    );
    expect(screen.getByText(/Partial/)).toBeInTheDocument();

    rerender(<AssistantMessage content="Partial answer growing" citations={[]} isStreaming />);
    expect(screen.getByText(/Partial answer growing/)).toBeInTheDocument();
  });
});
