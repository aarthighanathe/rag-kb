/**
 * @file LoadingSpinner.test.tsx
 * @description Unit tests for the LoadingSpinner design-system component.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoadingSpinner } from '../../design-system/components/LoadingSpinner';

describe('LoadingSpinner', () => {
  it('renders without crashing', () => {
    render(<LoadingSpinner />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('uses default label "Loading…"', () => {
    render(<LoadingSpinner />);
    expect(screen.getByRole('status', { name: 'Loading…' })).toBeInTheDocument();
  });

  it('accepts a custom label', () => {
    render(<LoadingSpinner label="Processing file" />);
    expect(screen.getByRole('status', { name: 'Processing file' })).toBeInTheDocument();
  });

  it('renders all sizes', () => {
    const { rerender } = render(<LoadingSpinner size="sm" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    rerender(<LoadingSpinner size="md" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    rerender(<LoadingSpinner size="lg" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders all color variants', () => {
    const { rerender } = render(<LoadingSpinner color="indigo" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    rerender(<LoadingSpinner color="green" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    rerender(<LoadingSpinner color="white" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
