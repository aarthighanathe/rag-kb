/**
 * @file Modal.test.tsx
 * @description Unit tests for the Modal design-system component.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from '../../design-system/components/Modal';

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  title: 'Test Modal',
  children: <p>Modal body content</p>,
};

describe('Modal', () => {
  it('renders when open is true', () => {
    render(<Modal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Test Modal')).toBeInTheDocument();
  });

  it('renders nothing when open is false', () => {
    render(<Modal {...defaultProps} open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders children in the body', () => {
    render(<Modal {...defaultProps} />);
    expect(screen.getByText('Modal body content')).toBeInTheDocument();
  });

  it('renders subtitle when provided', () => {
    render(<Modal {...defaultProps} subtitle="Subtitle text" />);
    expect(screen.getByText('Subtitle text')).toBeInTheDocument();
  });

  it('renders footer when provided', () => {
    render(<Modal {...defaultProps} footer={<button>Confirm</button>} />);
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
  });

  it('calls onClose when × button is clicked', async () => {
    const onClose = vi.fn();
    render(<Modal {...defaultProps} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when Escape is pressed', async () => {
    const onClose = vi.fn();
    render(<Modal {...defaultProps} onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('has correct ARIA attributes', () => {
    render(<Modal {...defaultProps} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'modal-title');
  });

  it('does not close on backdrop click when preventBackdropClose is true', async () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal {...defaultProps} onClose={onClose} preventBackdropClose />,
    );
    const backdrop = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    await userEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('focuses first focusable element on open (close button)', async () => {
    render(<Modal {...defaultProps} />);
    // The × button in the header is the first focusable element in the dialog DOM
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close dialog' }));
    });
  });

  it('does not steal focus back to the close button when re-rendered with a new onClose closure while open', async () => {
    const { rerender } = render(
      <Modal {...defaultProps} onClose={() => {}} footer={<button>Confirm</button>} />,
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close dialog' }));
    });

    // Simulate the user tabbing to a different focusable element inside the modal
    const confirmButton = screen.getByRole('button', { name: 'Confirm' });
    act(() => confirmButton.focus());
    expect(document.activeElement).toBe(confirmButton);

    // Re-render with a brand-new onClose closure (the common unmemoized-parent
    // pattern) — this must NOT re-run the open effect and steal focus back to
    // the close button.
    rerender(<Modal {...defaultProps} onClose={() => {}} footer={<button>Confirm</button>} />);

    expect(document.activeElement).toBe(confirmButton);
  });
});
