/**
 * @file Button.test.tsx
 * @description Unit tests for the Button design-system component.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '../../design-system/components/Button';

describe('Button', () => {
  it('renders without crashing', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
  });

  it('renders all variants', () => {
    const { rerender } = render(<Button variant="primary">P</Button>);
    expect(screen.getByRole('button')).toBeInTheDocument();

    rerender(<Button variant="secondary">S</Button>);
    expect(screen.getByRole('button')).toBeInTheDocument();

    rerender(<Button variant="ghost">G</Button>);
    expect(screen.getByRole('button')).toBeInTheDocument();

    rerender(<Button variant="danger">D</Button>);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('renders all sizes', () => {
    const { rerender } = render(<Button size="sm">sm</Button>);
    expect(screen.getByRole('button')).toBeInTheDocument();
    rerender(<Button size="md">md</Button>);
    expect(screen.getByRole('button')).toBeInTheDocument();
    rerender(<Button size="lg">lg</Button>);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('fires onClick handler', async () => {
    const handler = vi.fn();
    render(<Button onClick={handler}>Click</Button>);
    await userEvent.click(screen.getByRole('button'));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('does not fire onClick when disabled', async () => {
    const handler = vi.fn();
    render(<Button disabled onClick={handler}>Disabled</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    await userEvent.click(btn);
    expect(handler).not.toHaveBeenCalled();
  });

  it('shows loading spinner and is disabled when loading', () => {
    render(<Button loading>Save</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
  });

  it('renders icon-only button with accessible label', () => {
    render(<Button iconOnly iconLeft={<span>icon</span>} aria-label="Delete" />);
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('is keyboard activatable via Enter', async () => {
    const handler = vi.fn();
    render(<Button onClick={handler}>Press me</Button>);
    const btn = screen.getByRole('button');
    btn.focus();
    await userEvent.keyboard('{Enter}');
    expect(handler).toHaveBeenCalledOnce();
  });
});
