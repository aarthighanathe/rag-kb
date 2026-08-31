/**
 * @file useFocusTrap.test.ts
 * @description Unit tests for useFocusTrap — Tab/Shift+Tab cycling within the container,
 *   initial focus on open, Escape handling, focus restoration and listener cleanup on
 *   close/unmount, and body-scroll locking. This hook is shared by Modal, drawers, and
 *   CitationChip, so a regression here is an accessibility regression across surfaces.
 * @author [Author Placeholder]
 * @created 2026-08-31
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFocusTrap } from '../../hooks/useFocusTrap';

/** Builds a container with three focusable buttons and attaches it to the DOM. */
function buildContainer(): HTMLDivElement {
  const container = document.createElement('div');
  container.innerHTML = `
    <button id="first">First</button>
    <button id="middle">Middle</button>
    <button id="last">Last</button>
  `;
  document.body.appendChild(container);
  return container;
}

function fireKeydown(key: string, opts: Partial<KeyboardEventInit> = {}): void {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts });
  act(() => {
    document.dispatchEvent(event);
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

afterEach(() => {
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

describe('useFocusTrap — initial focus', () => {
  it('moves focus to the first focusable element when opened', async () => {
    const container = buildContainer();
    const containerRef = { current: container };
    const onClose = vi.fn();

    renderHook(() => useFocusTrap(containerRef, { open: true, onClose }));

    // Initial focus happens inside requestAnimationFrame.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(document.activeElement).toBe(container.querySelector('#first'));
  });

  it('does not move focus when closed', async () => {
    const container = buildContainer();
    const outsideButton = document.createElement('button');
    document.body.appendChild(outsideButton);
    outsideButton.focus();
    const containerRef = { current: container };

    renderHook(() => useFocusTrap(containerRef, { open: false, onClose: vi.fn() }));

    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(document.activeElement).toBe(outsideButton);
  });
});

describe('useFocusTrap — Tab/Shift+Tab cycling', () => {
  it('wraps focus from the last element to the first on Tab', () => {
    const container = buildContainer();
    const containerRef = { current: container };
    const last = container.querySelector<HTMLButtonElement>('#last')!;
    const first = container.querySelector<HTMLButtonElement>('#first')!;

    renderHook(() => useFocusTrap(containerRef, { open: true, onClose: vi.fn() }));

    last.focus();
    fireKeydown('Tab');

    expect(document.activeElement).toBe(first);
  });

  it('wraps focus from the first element to the last on Shift+Tab', () => {
    const container = buildContainer();
    const containerRef = { current: container };
    const first = container.querySelector<HTMLButtonElement>('#first')!;
    const last = container.querySelector<HTMLButtonElement>('#last')!;

    renderHook(() => useFocusTrap(containerRef, { open: true, onClose: vi.fn() }));

    first.focus();
    fireKeydown('Tab', { shiftKey: true });

    expect(document.activeElement).toBe(last);
  });

  it('does not interfere with Tab on a middle element (browser default behavior applies)', () => {
    const container = buildContainer();
    const containerRef = { current: container };
    const middle = container.querySelector<HTMLButtonElement>('#middle')!;

    renderHook(() => useFocusTrap(containerRef, { open: true, onClose: vi.fn() }));

    middle.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    act(() => {
      document.dispatchEvent(event);
    });

    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });

  it('ignores Tab when the container has no focusable elements', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const containerRef = { current: container };

    renderHook(() => useFocusTrap(containerRef, { open: true, onClose: vi.fn() }));

    expect(() => fireKeydown('Tab')).not.toThrow();
  });
});

describe('useFocusTrap — Escape', () => {
  it('calls onClose when Escape is pressed', () => {
    const container = buildContainer();
    const containerRef = { current: container };
    const onClose = vi.fn();

    renderHook(() => useFocusTrap(containerRef, { open: true, onClose }));
    fireKeydown('Escape');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls the latest onClose even if it changes across re-renders without re-registering the effect', () => {
    const container = buildContainer();
    const containerRef = { current: container };
    const firstOnClose = vi.fn();
    const secondOnClose = vi.fn();

    const { rerender } = renderHook(
      ({ onClose }) => useFocusTrap(containerRef, { open: true, onClose }),
      { initialProps: { onClose: firstOnClose } },
    );

    rerender({ onClose: secondOnClose });
    fireKeydown('Escape');

    expect(firstOnClose).not.toHaveBeenCalled();
    expect(secondOnClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when the trap is closed', () => {
    const container = buildContainer();
    const containerRef = { current: container };
    const onClose = vi.fn();

    renderHook(() => useFocusTrap(containerRef, { open: false, onClose }));
    fireKeydown('Escape');

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('useFocusTrap — cleanup', () => {
  it('restores focus to the previously focused element when closed', async () => {
    const container = buildContainer();
    const outsideButton = document.createElement('button');
    document.body.appendChild(outsideButton);
    outsideButton.focus();
    const containerRef = { current: container };

    const { rerender } = renderHook(
      ({ open }) => useFocusTrap(containerRef, { open, onClose: vi.fn() }),
      { initialProps: { open: true } },
    );

    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(document.activeElement).toBe(container.querySelector('#first'));

    rerender({ open: false });

    expect(document.activeElement).toBe(outsideButton);
  });

  it('removes the keydown listener on unmount so Escape no longer triggers onClose', () => {
    const container = buildContainer();
    const containerRef = { current: container };
    const onClose = vi.fn();

    const { unmount } = renderHook(() => useFocusTrap(containerRef, { open: true, onClose }));
    unmount();
    fireKeydown('Escape');

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('useFocusTrap — body scroll lock', () => {
  it('locks body scroll (overflow: hidden) while open by default', () => {
    const container = buildContainer();
    const containerRef = { current: container };

    renderHook(() => useFocusTrap(containerRef, { open: true, onClose: vi.fn() }));

    expect(document.body.style.overflow).toBe('hidden');
  });

  it('restores body scroll when closed', () => {
    const container = buildContainer();
    const containerRef = { current: container };

    const { rerender } = renderHook(
      ({ open }) => useFocusTrap(containerRef, { open, onClose: vi.fn() }),
      { initialProps: { open: true } },
    );
    expect(document.body.style.overflow).toBe('hidden');

    rerender({ open: false });
    expect(document.body.style.overflow).toBe('');
  });

  it('restores body scroll on unmount', () => {
    const container = buildContainer();
    const containerRef = { current: container };

    const { unmount } = renderHook(() =>
      useFocusTrap(containerRef, { open: true, onClose: vi.fn() }),
    );
    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('does not lock body scroll when lockBodyScroll is false', () => {
    const container = buildContainer();
    const containerRef = { current: container };

    renderHook(() =>
      useFocusTrap(containerRef, { open: true, onClose: vi.fn(), lockBodyScroll: false }),
    );

    expect(document.body.style.overflow).toBe('');
  });
});
