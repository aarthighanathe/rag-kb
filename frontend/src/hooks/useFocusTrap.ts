/**
 * @file useFocusTrap.ts
 * @description Reusable focus-trap hook for modal-like overlays — traps Tab/Shift+Tab
 *   focus within a container, moves focus in on open, restores focus to the previously
 *   focused element on close, and handles Escape. Extracted from Modal.tsx's
 *   originally inline implementation so non-Modal overlays (e.g. mobile drawers) can
 *   share the same accessible behavior instead of reimplementing it.
 * @author [Author Placeholder]
 * @created 2026-07-23
 */

import { useEffect, useRef, useCallback, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export interface UseFocusTrapOptions {
  /** Whether the trap is active (i.e. the dialog/drawer is open). */
  open: boolean;
  /** Called when the user presses Escape. */
  onClose: () => void;
  /** When true (default), locks body scroll while open. */
  lockBodyScroll?: boolean;
}

/**
 * Traps keyboard focus within `containerRef` while `open` is true.
 * @param containerRef - Ref to the dialog/drawer container element
 * @param options - Open state, close callback, and scroll-lock toggle
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  { open, onClose, lockBodyScroll = true }: UseFocusTrapOptions,
): void {
  const previousFocus = useRef<HTMLElement | null>(null);

  // Latest onClose in a ref rather than a useCallback dependency — an
  // unmemoized onClose closure from the parent (the common pattern) must not
  // re-trigger the open/close effect below on every parent re-render, which
  // would restore-then-re-steal focus (visible flicker) while the modal
  // stays open. The keydown listener always reads the current ref value, so
  // Escape still calls the latest onClose without needing it as a dependency.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCloseRef.current(); return; }
      if (e.key !== 'Tab' || !containerRef.current) return;

      const focusable = Array.from(
        containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last  = focusable[focusable.length - 1];

      if (first && last && e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (first && last && !e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [containerRef],
  );

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement;
    document.addEventListener('keydown', handleKeyDown);
    requestAnimationFrame(() => {
      const first = containerRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    });
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus.current?.focus();
    };
  }, [open, handleKeyDown, containerRef]);

  useEffect(() => {
    if (!lockBodyScroll) return;
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open, lockBodyScroll]);
}
