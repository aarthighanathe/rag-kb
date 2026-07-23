/**
 * @file FilingReport.test.tsx
 * @description Tests for the FilingReport component showing chunk quality statistics.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilingReport } from '../../design-system/components/FilingReport';
import { FILING_GRADE, FILING_BAR } from '../testIds';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const goodStats = {
  totalChunks: 12,
  avgTokenCount: 320,
  minTokenCount: 180,
  maxTokenCount: 450,
  shortChunkCount: 0,
  longChunkCount: 1,
  grade: 'good' as const,
};

const poorStats = {
  totalChunks: 12,
  avgTokenCount: 200,
  minTokenCount: 10,
  maxTokenCount: 1500,
  shortChunkCount: 4,
  longChunkCount: 2,
  grade: 'poor' as const,
};

function expandReport(): void {
  const toggleButton = screen.getByRole('button', { name: /view filing report/i });
  fireEvent.click(toggleButton);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FilingReport', () => {
  it('renders toggle button', () => {
    render(<FilingReport stats={goodStats} filename="test.pdf" />);
    expect(screen.getByRole('button', { name: /view filing report/i })).toBeInTheDocument();
  });

  it('shows grade badge after expansion', () => {
    render(<FilingReport stats={goodStats} filename="test.pdf" />);
    expandReport();
    expect(screen.getByTestId(FILING_GRADE)).toHaveTextContent('GOOD');
  });

  it('renders with archive green background for good grade', () => {
    render(<FilingReport stats={goodStats} filename="test.pdf" />);
    expandReport();
    const badge = screen.getByTestId(FILING_GRADE);
    expect(badge.style.background).toMatch(/rgb\(45, 90, 74\)/);
  });

  it('renders with stamp red background for poor grade', () => {
    render(<FilingReport stats={poorStats} filename="test.pdf" />);
    expandReport();
    const badge = screen.getByTestId(FILING_GRADE);
    expect(badge.style.background).toMatch(/rgb\(255, 77, 46\)/);
  });

  it('shows distribution bar with high percentage for good chunk ratio', () => {
    render(<FilingReport stats={goodStats} filename="test.pdf" />);
    expandReport();
    const bar = screen.getByTestId(FILING_BAR);
    // good: 0 short, 1 long → optimal = 11, optimalPct = 11/12 * 100 ≈ 91.67%
    expect(parseFloat(bar.style.width)).toBeGreaterThan(90);
  });

  it('shows distribution bar with lower percentage for poor chunk ratio', () => {
    render(<FilingReport stats={poorStats} filename="test.pdf" />);
    expandReport();
    const bar = screen.getByTestId(FILING_BAR);
    // poor: 4 short, 2 long → optimal = 6, optimalPct = 6/12 * 100 = 50%
    expect(parseFloat(bar.style.width)).toBeCloseTo(50, 0);
  });

  it('shows stats after expansion', () => {
    render(<FilingReport stats={goodStats} filename="test.pdf" />);
    expandReport();
    expect(screen.getByText(/12 chunks/)).toBeInTheDocument();
  });

  it('has correct rotation transform on grade badge', () => {
    render(<FilingReport stats={goodStats} filename="test.pdf" />);
    expandReport();
    const badge = screen.getByTestId(FILING_GRADE);
    expect(badge.style.transform).toBe('rotate(-1.5deg)');
  });
});
