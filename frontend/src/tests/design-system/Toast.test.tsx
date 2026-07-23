/**
 * @file Toast.test.tsx
 * @description Unit tests for Toast components and useToast hook.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderHook } from '@testing-library/react';
import { ToastItem, ToastContainer } from '../../design-system/components/Toast';
import { useToast } from '../../design-system/components/useToast';
import type { Toast } from '../../design-system/components/useToast';

const makeToast = (overrides: Partial<Toast> = {}): Toast => ({
  id: 'test-toast',
  message: 'Something happened',
  variant: 'info',
  duration: 4000,
  ...overrides,
});

describe('ToastItem', () => {
  it('renders without crashing', () => {
    render(<ToastItem toast={makeToast()} onDismiss={() => {}} />);
    expect(screen.getByText('Something happened')).toBeInTheDocument();
  });

  it('renders all variants', () => {
    const variants = ['success', 'error', 'warning', 'info'] as const;
    for (const variant of variants) {
      const { unmount } = render(
        <ToastItem toast={makeToast({ variant, message: variant })} onDismiss={() => {}} />,
      );
      expect(screen.getByText(variant)).toBeInTheDocument();
      unmount();
    }
  });

  it('renders description when provided', () => {
    render(
      <ToastItem
        toast={makeToast({ description: 'Details here' })}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText('Details here')).toBeInTheDocument();
  });

  it('calls onDismiss when × button is clicked', async () => {
    const onDismiss = vi.fn();
    render(<ToastItem toast={makeToast()} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(onDismiss).toHaveBeenCalledWith('test-toast');
  });

  it('has aria-live="polite"', () => {
    const { container } = render(<ToastItem toast={makeToast()} onDismiss={() => {}} />);
    expect(container.querySelector('[aria-live="polite"]')).toBeInTheDocument();
  });
});

describe('ToastContainer', () => {
  it('renders multiple toasts', () => {
    const toasts = [
      makeToast({ id: 't1', message: 'First' }),
      makeToast({ id: 't2', message: 'Second', variant: 'success' }),
    ];
    render(<ToastContainer toasts={toasts} onDismiss={() => {}} />);
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });

  it('renders empty container with no toasts', () => {
    render(<ToastContainer toasts={[]} onDismiss={() => {}} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('useToast', () => {
  it('starts with no toasts', () => {
    const { result } = renderHook(() => useToast());
    expect(result.current.toasts).toHaveLength(0);
  });

  it('adds a toast when toast() is called', () => {
    const { result } = renderHook(() => useToast());
    act(() => { result.current.toast('Hello'); });
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0]?.message).toBe('Hello');
  });

  it('dismisses a specific toast by id', () => {
    const { result } = renderHook(() => useToast());
    let id = '';
    act(() => { id = result.current.toast('Removable'); });
    act(() => { result.current.dismiss(id); });
    expect(result.current.toasts).toHaveLength(0);
  });

  it('dismissAll clears all toasts', () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.toast('A');
      result.current.toast('B');
    });
    act(() => { result.current.dismissAll(); });
    expect(result.current.toasts).toHaveLength(0);
  });

  it('auto-dismisses after duration', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToast());
    act(() => { result.current.toast('Auto', { duration: 1000 }); });
    expect(result.current.toasts).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(1001); });
    expect(result.current.toasts).toHaveLength(0);
    vi.useRealTimers();
  });

  it('persistent toast (duration=0) is not auto-dismissed', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToast());
    act(() => { result.current.toast('Sticky', { duration: 0 }); });
    act(() => { vi.advanceTimersByTime(10000); });
    expect(result.current.toasts).toHaveLength(1);
    vi.useRealTimers();
  });
});
