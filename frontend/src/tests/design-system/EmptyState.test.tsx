/**
 * @file EmptyState.test.tsx
 * @description Unit tests for the EmptyState design-system component.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from '../../design-system/components/EmptyState';

describe('EmptyState', () => {
  it('renders without crashing', () => {
    render(<EmptyState icon={<span>icon</span>} title="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('renders title', () => {
    render(<EmptyState icon={<span />} title="No documents" />);
    expect(screen.getByRole('heading', { name: 'No documents' })).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(
      <EmptyState icon={<span />} title="Empty" description="Upload something to continue." />,
    );
    expect(screen.getByText('Upload something to continue.')).toBeInTheDocument();
  });

  it('does not render description when omitted', () => {
    render(<EmptyState icon={<span />} title="Empty" />);
    expect(screen.queryByRole('paragraph')).toBeNull();
  });

  it('renders action slot', () => {
    render(
      <EmptyState
        icon={<span />}
        title="Empty"
        action={<button type="button">Upload</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument();
  });

  it('has accessible status role', () => {
    render(<EmptyState icon={<span />} title="No results" />);
    expect(screen.getByRole('status', { name: 'No results' })).toBeInTheDocument();
  });
});
