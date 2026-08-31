/**
 * @file ChatMessage.test.tsx
 * @description Unit tests for the ChatMessage design-system component.
 *   ChatMessage renders user messages only — assistant rendering (copy
 *   button, citations, streaming cursor, Markdown) lives in
 *   AssistantMessage.tsx and is covered by AssistantMessage.test.tsx.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ChatMessage } from '../../design-system/components/ChatMessage';
import { ToastProvider } from '../../contexts/ToastContext';

describe('ChatMessage', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ToastProvider>{children}</ToastProvider>
  );

  it('renders user message without crashing', () => {
    render(<ChatMessage role="user" content="Hello" />, { wrapper });
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('does not render copy button on user messages', () => {
    render(<ChatMessage role="user" content="I sent this." />, { wrapper });
    expect(
      screen.queryByRole('button', { name: 'Copy answer as Markdown' }),
    ).not.toBeInTheDocument();
  });

  it('renders timestamp when provided', () => {
    const ts = new Date('2026-06-16T14:30:00').toISOString();
    render(<ChatMessage role="user" content="Hey" timestamp={ts} />, { wrapper });
    expect(screen.getByText(/2:30/)).toBeInTheDocument();
  });

  it('renders without a timestamp', () => {
    render(<ChatMessage role="user" content="No time" />, { wrapper });
    expect(screen.getByText('No time')).toBeInTheDocument();
  });

  it('applies additional className to the root element', () => {
    const { container } = render(
      <ChatMessage role="user" content="Styled" className="custom-class" />,
      { wrapper },
    );
    expect(container.querySelector('.custom-class')).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Memoization (perf regression guard — audit finding #11)
  // --------------------------------------------------------------------------

  it('renders correctly across a parent re-render with equivalent props', () => {
    function Wrapper({ text }: { text: string }): React.JSX.Element {
      return <ChatMessage role="user" content={text} />;
    }

    const { rerender } = render(<Wrapper text="Hello" />, { wrapper });
    expect(screen.getByText('Hello')).toBeInTheDocument();

    // Same values — mirrors Chat.tsx rebuilding message props on every
    // render while an unrelated (assistant) message streams.
    rerender(<Wrapper text="Hello" />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('reflects updated content across re-renders', () => {
    const { rerender } = render(<ChatMessage role="user" content="First" />, { wrapper });
    expect(screen.getByText('First')).toBeInTheDocument();

    rerender(<ChatMessage role="user" content="First edited" />);
    expect(screen.getByText('First edited')).toBeInTheDocument();
  });
});
