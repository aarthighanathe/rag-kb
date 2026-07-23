/**
 * @file ReQueryButtons.test.tsx
 * @description Tests for the ReQueryButtons component showing re-query variants.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReQueryButtons } from '../../design-system/components/ReQueryButtons';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReQueryButtons', () => {
  const mockReQuery = vi.fn();
  const originalQuery = 'What is the policy on vacation?';

  it('renders 3 variant buttons', () => {
    render(<ReQueryButtons originalQuery={originalQuery} onReQuery={mockReQuery} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);
  });

  it('includes the original query in each variant', () => {
    render(<ReQueryButtons originalQuery={originalQuery} onReQuery={mockReQuery} />);
    // Each button contains the original query text
    const buttons = screen.getAllByRole('button');
    for (const btn of buttons) {
      expect(btn.textContent).toContain('vacation');
    }
  });

  it('calls onReQuery with the clicked variant text', () => {
    render(<ReQueryButtons originalQuery={originalQuery} onReQuery={mockReQuery} />);
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]!);
    expect(mockReQuery).toHaveBeenCalledWith(expect.stringContaining('Summarize'));
  });

  it('uses the original query in the variant text', () => {
    const query = 'How many employees do we have?';
    render(<ReQueryButtons originalQuery={query} onReQuery={mockReQuery} />);
    const buttons = screen.getAllByRole('button');
    for (const btn of buttons) {
      expect(btn.textContent).toContain('employees');
    }
  });
});
