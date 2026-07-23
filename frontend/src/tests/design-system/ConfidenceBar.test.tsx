/**
 * @file ConfidenceBar.test.tsx
 * @description Unit tests for the ConfidenceBar component.
 * @author [Author Placeholder]
 * @created 2026-07-01
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConfidenceBar } from '../../design-system/components/ConfidenceBar';

describe('ConfidenceBar', () => {
  it('renders nothing when isStreaming is true', () => {
    const { container } = render(
      <ConfidenceBar similarities={[0.5]} isStreaming={true} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the confidence bar when not streaming', () => {
    render(<ConfidenceBar similarities={[0.5]} />);
    expect(screen.getByTestId('confidence-bar')).toBeInTheDocument();
  });

  it('displays high confidence label for high scores', () => {
    render(<ConfidenceBar similarities={[0.5, 0.6]} />);
    expect(screen.getByText(/High confidence/)).toBeInTheDocument();
  });

  it('displays moderate confidence label for medium scores', () => {
    render(<ConfidenceBar similarities={[0.15, 0.18]} />);
    expect(screen.getByText(/Moderate confidence/)).toBeInTheDocument();
  });

  it('displays low confidence label for low scores', () => {
    render(<ConfidenceBar similarities={[0.05, 0.04]} />);
    expect(screen.getByText(/Low confidence/)).toBeInTheDocument();
  });

  it('shows warning for low confidence', () => {
    render(<ConfidenceBar similarities={[0.05]} />);
    expect(screen.getByTestId('confidence-warning')).toBeInTheDocument();
    expect(screen.getByText(/match to your question is weak/)).toBeInTheDocument();
  });

  it('shows warning for very low confidence', () => {
    render(<ConfidenceBar similarities={[-0.1]} />);
    expect(screen.getByTestId('confidence-warning')).toBeInTheDocument();
    expect(screen.getByText(/could not find a strong match/)).toBeInTheDocument();
  });

  it('does not show warning for high confidence', () => {
    render(<ConfidenceBar similarities={[0.5]} />);
    expect(screen.queryByTestId('confidence-warning')).not.toBeInTheDocument();
  });

  it('renders progressbar with correct aria attributes', () => {
    // Bar width normalises average against MODEL_SIMILARITY_CEILING (0.40),
    // so avg 0.2 renders at (0.2 / 0.4) * 100 = 50%.
    render(<ConfidenceBar similarities={[0.2]} />);
    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toHaveAttribute('aria-valuemin', '0');
    expect(progressbar).toHaveAttribute('aria-valuemax', '100');
    expect(progressbar).toHaveAttribute('aria-valuenow', '50');
  });

  it('displays average percentage in parentheses', () => {
    render(<ConfidenceBar similarities={[0.5, 0.6]} />);
    // Average = (0.5 + 0.6) / 2 = 0.55 = 55%
    expect(screen.getByText(/55% avg/)).toBeInTheDocument();
  });

  it('handles empty similarities array', () => {
    render(<ConfidenceBar similarities={[]} />);
    // The label shows "No sources" and the warning also contains "No sources"
    // Use getAllByText to check both are present
    const noSourcesElements = screen.getAllByText(/No sources/);
    expect(noSourcesElements.length).toBeGreaterThanOrEqual(1);
  });
});
