/**
 * @file Badge.test.tsx
 * @description Unit tests for the Badge design-system component.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '../../design-system/components/Badge';

describe('Badge', () => {
  it('renders without crashing', () => {
    render(<Badge>Ready</Badge>);
    expect(screen.getByText('Ready')).toBeInTheDocument();
  });

  it('renders all variants', () => {
    const variants = ['default', 'success', 'warning', 'danger', 'citation'] as const;
    for (const variant of variants) {
      const { unmount } = render(<Badge variant={variant}>{variant}</Badge>);
      expect(screen.getByText(variant)).toBeInTheDocument();
      unmount();
    }
  });

  it('renders both sizes', () => {
    const { rerender } = render(<Badge size="sm">sm</Badge>);
    expect(screen.getByText('sm')).toBeInTheDocument();
    rerender(<Badge size="md">md</Badge>);
    expect(screen.getByText('md')).toBeInTheDocument();
  });

  it('renders dot indicator when dot=true', () => {
    const { container } = render(<Badge dot>Active</Badge>);
    const dot = container.querySelector('[aria-hidden="true"]');
    expect(dot).toBeInTheDocument();
  });

  it('does not render dot by default', () => {
    render(<Badge>Status</Badge>);
    expect(screen.queryByText('Status')?.previousElementSibling).toBeNull();
  });

  it('accepts and applies custom className', () => {
    const { container } = render(<Badge className="custom-class">Test</Badge>);
    expect(container.firstChild).toHaveClass('custom-class');
  });
});
