/**
 * @file CitationChip.test.tsx
 * @description Unit tests for the CitationChip design-system component.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CitationChip } from '../../design-system/components/CitationChip';

const baseProps = {
  documentName: 'research.pdf',
  chunkRef: 'p.14',
  relevanceScore: 0.87,
};

describe('CitationChip', () => {
  it('renders without crashing', () => {
    render(<CitationChip {...baseProps} />);
    expect(screen.getByText('research.pdf')).toBeInTheDocument();
  });

  it('renders document name and chunk ref', () => {
    render(<CitationChip {...baseProps} />);
    expect(screen.getByText('research.pdf')).toBeInTheDocument();
    expect(screen.getByText('p.14')).toBeInTheDocument();
  });

  it('has an accessible label including doc name and relevance', () => {
    render(<CitationChip {...baseProps} index={0} />);
    expect(
      screen.getByRole('button', { name: /citation 1.*research\.pdf.*87%/i }),
    ).toBeInTheDocument();
  });

  it('renders relevance meter element', () => {
    render(<CitationChip {...baseProps} />);
    expect(screen.getByRole('meter')).toBeInTheDocument();
  });

  it('opens side panel when fullText is provided and chip is clicked', async () => {
    render(<CitationChip {...baseProps} fullText="This is the source chunk text." />);
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('This is the source chunk text.')).toBeInTheDocument();
  });

  it('closes side panel when × button is clicked', async () => {
    render(<CitationChip {...baseProps} fullText="Some text." />);
    await userEvent.click(screen.getByRole('button', { name: /citation/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Close citation panel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not open panel when no fullText', async () => {
    render(<CitationChip {...baseProps} />);
    await userEvent.click(screen.getByRole('button'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows citation index + 1 in label', () => {
    render(<CitationChip {...baseProps} index={4} />);
    expect(screen.getByRole('button', { name: /citation 5/i })).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // String-line connector
  // --------------------------------------------------------------------------

  describe('string-line connector', () => {
    it('connector is not visible initially', () => {
      render(<CitationChip {...baseProps} />);
      expect(screen.queryByTestId('citation-string-connector')).not.toBeInTheDocument();
    });

    it('connector appears on mouse enter', async () => {
      render(<CitationChip {...baseProps} />);
      await userEvent.hover(screen.getByTestId('citation-chip'));
      expect(screen.getByTestId('citation-string-connector')).toBeInTheDocument();
    });

    it('connector disappears on mouse leave', async () => {
      render(<CitationChip {...baseProps} />);
      await userEvent.hover(screen.getByTestId('citation-chip'));
      expect(screen.getByTestId('citation-string-connector')).toBeInTheDocument();
      await userEvent.unhover(screen.getByTestId('citation-chip'));
      expect(screen.queryByTestId('citation-string-connector')).not.toBeInTheDocument();
    });

    it('connector appears on focus', () => {
      render(<CitationChip {...baseProps} />);
      const btn = screen.getByTestId('citation-chip');
      fireEvent.focus(btn);
      expect(screen.getByTestId('citation-string-connector')).toBeInTheDocument();
    });

    it('connector disappears on blur', () => {
      render(<CitationChip {...baseProps} />);
      const btn = screen.getByTestId('citation-chip');
      fireEvent.focus(btn);
      expect(screen.getByTestId('citation-string-connector')).toBeInTheDocument();
      fireEvent.blur(btn);
      expect(screen.queryByTestId('citation-string-connector')).not.toBeInTheDocument();
    });

    it('connector is aria-hidden (decorative)', async () => {
      render(<CitationChip {...baseProps} />);
      await userEvent.hover(screen.getByTestId('citation-chip'));
      const connector = screen.getByTestId('citation-string-connector');
      expect(connector).toHaveAttribute('aria-hidden', 'true');
    });
  });
});
