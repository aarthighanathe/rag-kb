/**
 * @file useKeyboardShortcuts.ts
 * @description Global keyboard shortcut handler for the Chat page.
 *   Attaches to window keydown, respects input focus to avoid conflicts.
 * @author [Author Placeholder]
 * @created 2026-07-01
 */

import { useEffect } from 'react';

/**
 * Callback functions for keyboard shortcut actions.
 */
export interface ShortcutHandlers {
  /** Focus the query input */
  onFocusInput: () => void;
  /** Send the current query */
  onSend: () => void;
  /** Clear the query input */
  onClearInput: () => void;
  /** Export conversation */
  onExport: () => void;
  /** Copy last assistant answer */
  onCopyLast: () => void;
  /** Toggle query history panel */
  onToggleHistory: () => void;
}

/**
 * Registers keyboard shortcuts for the Chat page.
 * Cleans up event listeners on unmount.
 * @param handlers - Callback functions for each shortcut action
 * @param enabled - Whether shortcuts are active (false during streaming)
 */
export function useKeyboardShortcuts(
  handlers: ShortcutHandlers,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent): void => {
      const { metaKey, ctrlKey, key, shiftKey } = event;
      const cmdOrCtrl = metaKey || ctrlKey;
      // Shift changes event.key casing for letters (e.g. Shift+e -> 'E'),
      // so compare case-insensitively rather than against a lowercase literal.
      const lowerKey = key.toLowerCase();

      // Check if target is an input/textarea/select that is NOT the query input
      const target = event.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
      const isQueryInput = target.getAttribute && target.getAttribute('data-testid') === 'query-input';

      // Skip shortcuts if typing in unrelated input
      if (isInput && !isQueryInput) return;

      // Cmd/Ctrl + K: Focus query input
      if (cmdOrCtrl && !shiftKey && lowerKey === 'k') {
        event.preventDefault();
        handlers.onFocusInput();
        return;
      }

      // Cmd/Ctrl + Enter: Send query
      if (cmdOrCtrl && lowerKey === 'enter') {
        event.preventDefault();
        handlers.onSend();
        return;
      }

      // Escape: Clear focused input
      if (key === 'Escape' && isQueryInput) {
        event.preventDefault();
        handlers.onClearInput();
        return;
      }

      // Cmd/Ctrl + Shift + E: Export conversation
      if (cmdOrCtrl && shiftKey && lowerKey === 'e') {
        event.preventDefault();
        handlers.onExport();
        return;
      }

      // Cmd/Ctrl + Shift + C: Copy last answer
      if (cmdOrCtrl && shiftKey && lowerKey === 'c') {
        event.preventDefault();
        handlers.onCopyLast();
        return;
      }

      // Cmd/Ctrl + H: Toggle query history panel
      if (cmdOrCtrl && !shiftKey && lowerKey === 'h') {
        event.preventDefault();
        handlers.onToggleHistory();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handlers, enabled]);
}
