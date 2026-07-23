/**
 * @file useToast.ts
 * @description React hook that manages a toast notification queue.
 *   Supports auto-dismiss, manual dismiss, and stacking multiple toasts.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { useCallback, useState } from 'react';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  /** Unique identifier for this toast. */
  id: string;
  /** Semantic variant controlling color and icon. */
  variant: ToastVariant;
  /** Primary message text. */
  message: string;
  /** Optional secondary description. */
  description?: string;
  /** Auto-dismiss duration in ms (0 = no auto-dismiss). */
  duration: number;
}

export interface ToastOptions {
  /** Semantic variant (default: 'info'). */
  variant?: ToastVariant;
  /** Optional secondary description. */
  description?: string;
  /** Auto-dismiss delay in ms (default: 4000, 0 = persistent). */
  duration?: number;
}

export interface UseToastReturn {
  /** Current toast stack (newest last). */
  toasts: Toast[];
  /** Push a new toast onto the stack. Returns the toast id. */
  toast: (message: string, options?: ToastOptions) => string;
  /** Remove a specific toast by id. */
  dismiss: (id: string) => void;
  /** Remove all toasts. */
  dismissAll: () => void;
}

let counter = 0;
const nextId = () => `toast-${++counter}`;

/**
 * Hook for managing a toast notification stack.
 * @returns toasts array plus toast / dismiss / dismissAll helpers
 */
export function useToast(): UseToastReturn {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismissAll = useCallback(() => setToasts([]), []);

  const toast = useCallback(
    (message: string, options: ToastOptions = {}): string => {
      const id = nextId();
      const duration = options.duration ?? 4000;

      const entry: Toast = {
        id,
        message,
        variant:     options.variant     ?? 'info',
        description: options.description,
        duration,
      };

      setToasts((prev) => [...prev, entry]);

      if (duration > 0) {
        setTimeout(() => dismiss(id), duration);
      }

      return id;
    },
    [dismiss],
  );

  return { toasts, toast, dismiss, dismissAll };
}
