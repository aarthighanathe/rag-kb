/**
 * @file useKeyboardShortcuts.test.ts
 * @description Unit tests for useKeyboardShortcuts hook
 * @author [Author Placeholder]
 * @created 2026-07-01
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useKeyboardShortcuts, type ShortcutHandlers } from '../../hooks/useKeyboardShortcuts';

describe('useKeyboardShortcuts', () => {
  let mockHandlers: ShortcutHandlers;
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let removeEventListenerSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockHandlers = {
      onFocusInput: vi.fn(),
      onSend: vi.fn(),
      onClearInput: vi.fn(),
      onExport: vi.fn(),
      onCopyLast: vi.fn(),
      onToggleHistory: vi.fn(),
    };

    addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
  });

  // Safety net for the tests below that manually mount/unmount a mock input
  // element — a failed assertion between appendChild and the manual
  // removeChild would otherwise leave the mock element in document.body,
  // leaking into subsequent tests' DOM.
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('registers event listener when enabled', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(mockHandlers, true));

    expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));

    unmount();
  });

  it('does not register event listener when disabled', () => {
    renderHook(() => useKeyboardShortcuts(mockHandlers, false));

    expect(addEventListenerSpy).not.toHaveBeenCalled();
  });

  it('removes event listener on unmount', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(mockHandlers, true));

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('calls onFocusInput on Ctrl+K', () => {
    renderHook(() => useKeyboardShortcuts(mockHandlers, true));

    const event = new KeyboardEvent('keydown', { ctrlKey: true, key: 'k' });
    act(() => {
      window.dispatchEvent(event);
    });

    expect(mockHandlers.onFocusInput).toHaveBeenCalled();
  });

  it('calls onSend on Ctrl+Enter when enabled', () => {
    renderHook(() => useKeyboardShortcuts(mockHandlers, true));

    const event = new KeyboardEvent('keydown', { ctrlKey: true, key: 'Enter' });
    act(() => {
      window.dispatchEvent(event);
    });

    expect(mockHandlers.onSend).toHaveBeenCalled();
  });

  it('does not call onSend when disabled', () => {
    renderHook(() => useKeyboardShortcuts(mockHandlers, false));

    const event = new KeyboardEvent('keydown', { ctrlKey: true, key: 'Enter' });
    act(() => {
      window.dispatchEvent(event);
    });

    expect(mockHandlers.onSend).not.toHaveBeenCalled();
  });

  it('calls onClearInput on Escape when focused on query input', () => {
    // Mock a query input element
    const mockInput = document.createElement('textarea');
    mockInput.setAttribute('data-testid', 'query-input');
    document.body.appendChild(mockInput);
    mockInput.focus();

    renderHook(() => useKeyboardShortcuts(mockHandlers, true));

    const event = new KeyboardEvent('keydown', { key: 'Escape' });
    Object.defineProperty(event, 'target', { value: mockInput, writable: false });
    act(() => {
      window.dispatchEvent(event);
    });

    expect(mockHandlers.onClearInput).toHaveBeenCalled();

    document.body.removeChild(mockInput);
  });

  it('calls onExport on Ctrl+Shift+E', () => {
    renderHook(() => useKeyboardShortcuts(mockHandlers, true));

    const event = new KeyboardEvent('keydown', { ctrlKey: true, shiftKey: true, key: 'e' });
    act(() => {
      window.dispatchEvent(event);
    });

    expect(mockHandlers.onExport).toHaveBeenCalled();
  });

  it('calls onCopyLast on Ctrl+Shift+C', () => {
    renderHook(() => useKeyboardShortcuts(mockHandlers, true));

    const event = new KeyboardEvent('keydown', { ctrlKey: true, shiftKey: true, key: 'c' });
    act(() => {
      window.dispatchEvent(event);
    });

    expect(mockHandlers.onCopyLast).toHaveBeenCalled();
  });

  it('does not fire shortcuts when typing in unrelated input', () => {
    // Mock a non-query input element
    const mockInput = document.createElement('input');
    document.body.appendChild(mockInput);
    mockInput.focus();

    renderHook(() => useKeyboardShortcuts(mockHandlers, true));

    const event = new KeyboardEvent('keydown', { ctrlKey: true, key: 'k' });
    Object.defineProperty(event, 'target', { value: mockInput, writable: false });
    act(() => {
      window.dispatchEvent(event);
    });

    expect(mockHandlers.onFocusInput).not.toHaveBeenCalled();

    document.body.removeChild(mockInput);
  });

  it('prevents default browser behavior for shortcuts', () => {
    renderHook(() => useKeyboardShortcuts(mockHandlers, true));

    const event = new KeyboardEvent('keydown', { ctrlKey: true, key: 'k', cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    act(() => {
      window.dispatchEvent(event);
    });

    expect(preventDefaultSpy).toHaveBeenCalled();
  });
});
