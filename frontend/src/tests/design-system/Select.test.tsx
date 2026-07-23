/**
 * @file Select.test.tsx
 * @description Tests for the custom Select component — option rendering, onChange,
 *   aria-label, disabled state, label association, and focus behavior.
 * @author [Author Placeholder]
 * @created 2026-06-20
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Select } from '../../design-system/components/Select';

const OPTIONS = [
  { value: 'all',        label: 'All' },
  { value: 'ready',      label: 'Ready' },
  { value: 'processing', label: 'Processing' },
  { value: 'failed',     label: 'Failed' },
];

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe('Select — rendering', () => {
  it('renders a native select element', () => {
    render(<Select options={OPTIONS} value="all" onChange={vi.fn()} aria-label="Status" />);
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeInTheDocument();
  });

  it('renders all provided options', () => {
    render(<Select options={OPTIONS} value="all" onChange={vi.fn()} aria-label="Status" />);
    const select = screen.getByRole('combobox');
    const optionEls = Array.from(select.querySelectorAll('option'));
    expect(optionEls.map((o) => o.textContent)).toEqual(['All', 'Ready', 'Processing', 'Failed']);
  });

  it('reflects the provided value as selected', () => {
    render(<Select options={OPTIONS} value="ready" onChange={vi.fn()} aria-label="Status" />);
    expect(screen.getByRole('combobox')).toHaveValue('ready');
  });

  it('renders a visible label when label prop is supplied', () => {
    render(<Select options={OPTIONS} value="all" onChange={vi.fn()} label="Filter" />);
    expect(screen.getByText('Filter')).toBeInTheDocument();
  });

  it('associates the label with the select via htmlFor/id', () => {
    render(<Select options={OPTIONS} value="all" onChange={vi.fn()} label="Pick one" />);
    const label  = screen.getByText('Pick one');
    const select = screen.getByRole('combobox');
    expect(label).toHaveAttribute('for', select.id);
  });

  it('accepts a data-testid', () => {
    render(<Select options={OPTIONS} value="all" onChange={vi.fn()} aria-label="Status" data-testid="my-select" />);
    expect(screen.getByTestId('my-select')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Behavior
// ---------------------------------------------------------------------------

describe('Select — behavior', () => {
  it('calls onChange with the selected value when user picks an option', async () => {
    const handleChange = vi.fn();
    render(<Select options={OPTIONS} value="all" onChange={handleChange} aria-label="Status" />);

    await userEvent.selectOptions(screen.getByRole('combobox'), 'ready');
    expect(handleChange).toHaveBeenCalledWith('ready');
  });

  it('calls onChange with the correct value for a non-first option', async () => {
    const handleChange = vi.fn();
    render(<Select options={OPTIONS} value="ready" onChange={handleChange} aria-label="Status" />);

    await userEvent.selectOptions(screen.getByRole('combobox'), 'failed');
    expect(handleChange).toHaveBeenCalledWith('failed');
  });
});

// ---------------------------------------------------------------------------
// Disabled state
// ---------------------------------------------------------------------------

describe('Select — disabled state', () => {
  it('renders in a disabled state when disabled prop is true', () => {
    render(<Select options={OPTIONS} value="all" onChange={vi.fn()} aria-label="Status" disabled />);
    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('does not call onChange when disabled', async () => {
    const handleChange = vi.fn();
    render(<Select options={OPTIONS} value="all" onChange={handleChange} aria-label="Status" disabled />);
    await userEvent.selectOptions(screen.getByRole('combobox'), 'ready');
    expect(handleChange).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

describe('Select — accessibility', () => {
  it('uses aria-label when no visible label is provided', () => {
    render(<Select options={OPTIONS} value="all" onChange={vi.fn()} aria-label="Filter by status" />);
    expect(screen.getByRole('combobox', { name: 'Filter by status' })).toBeInTheDocument();
  });

  it('does not set aria-label when a visible label is used (avoids duplicate)', () => {
    render(<Select options={OPTIONS} value="all" onChange={vi.fn()} label="Status" aria-label="Status" />);
    const select = screen.getByRole('combobox');
    // When label prop is present, aria-label is suppressed (label provides accessible name)
    expect(select).not.toHaveAttribute('aria-label');
  });
});
