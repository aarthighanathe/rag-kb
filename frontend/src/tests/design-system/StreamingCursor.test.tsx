/**
 * @file StreamingCursor.test.tsx
 * @description Unit tests for the StreamingCursor component.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { StreamingCursor } from '../../design-system/components/StreamingCursor';

describe('StreamingCursor', () => {
  it('renders when active is true (default)', () => {
    const { container } = render(<StreamingCursor />);
    expect(container.firstChild).not.toBeNull();
  });

  it('renders nothing when active is false', () => {
    const { container } = render(<StreamingCursor active={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('is hidden from assistive technology via aria-hidden', () => {
    const { container } = render(<StreamingCursor />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });

  it('accepts a custom className', () => {
    const { container } = render(<StreamingCursor className="my-cursor" />);
    expect(container.firstChild).toHaveClass('my-cursor');
  });
});
