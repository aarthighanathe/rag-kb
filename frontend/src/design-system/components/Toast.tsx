/**
 * @file Toast.tsx
 * @description Toast notification — Lab Notebook theme.
 *   Styled as a small torn sticky note: slight rotation (1deg), card background,
 *   hairline border, paper-drop slide-in from bottom-right with overshoot easing.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import React, { useEffect, useRef } from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import type { Toast as ToastType, ToastVariant } from './useToast';

export interface ToastProps {
  /** Toast data object from useToast. */
  toast: ToastType;
  /** Callback to remove this toast from the stack. */
  onDismiss: (id: string) => void;
}

export interface ToastContainerProps {
  /** Array of active toasts. */
  toasts: ToastType[];
  /** Dismiss callback forwarded to each Toast. */
  onDismiss: (id: string) => void;
}

const variantIcon: Record<ToastVariant, React.ReactNode> = {
  success: <CheckCircle   size={15} aria-hidden="true" />,
  error:   <AlertCircle   size={15} aria-hidden="true" />,
  warning: <AlertTriangle size={15} aria-hidden="true" />,
  info:    <Info          size={15} aria-hidden="true" />,
};

const variantIconColor: Record<ToastVariant, string> = {
  success: 'text-ds-archive',
  error:   'text-ds-error',
  warning: 'text-ds-warning',
  info:    'text-ds-stamp',
};

const progressClasses: Record<ToastVariant, string> = {
  success: 'bg-ds-archive',
  error:   'bg-ds-error',
  warning: 'bg-ds-warning',
  info:    'bg-ds-stamp',
};

/**
 * Individual toast notification — sticky-note style with slight rotation.
 * @param toast     - Toast data from useToast hook
 * @param onDismiss - Called when user clicks × or timer expires
 */
export function ToastItem({ toast, onDismiss }: ToastProps): React.JSX.Element {
  const progressRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (toast.duration <= 0 || !progressRef.current) return;
    const el = progressRef.current;
    el.style.transition = `transform ${toast.duration}ms linear`;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.transform = 'scaleX(0)';
      });
    });
  }, [toast.duration]);

  const isError = toast.variant === 'error';

  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      aria-atomic="true"
      className="
        toast-note
        relative flex items-start gap-ds-3 overflow-hidden
        bg-ds-card border border-ds-hairline rounded-[2px] shadow-ds-lifted
        px-ds-4 py-ds-3 min-w-[270px] max-w-[360px]
        animate-paper-drop
      "
    >
      {/* Icon */}
      <span className={`shrink-0 mt-0.5 ${variantIconColor[toast.variant]}`}>
        {variantIcon[toast.variant]}
      </span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-ds-sm font-body font-medium text-ds-text-primary">
          {toast.message}
        </p>
        {toast.description && (
          <p className="text-ds-xs font-body text-ds-text-secondary mt-0.5">
            {toast.description}
          </p>
        )}
      </div>

      {/* Dismiss */}
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="shrink-0 text-ds-text-muted hover:text-ds-text-primary transition-colors mt-0.5"
      >
        <X size={13} aria-hidden="true" />
      </button>

      {/* Auto-dismiss progress hairline */}
      {toast.duration > 0 && (
        <div
          ref={progressRef}
          aria-hidden="true"
          className={`absolute bottom-0 left-0 right-0 h-px origin-left ${progressClasses[toast.variant]}`}
          style={{ transform: 'scaleX(1)' }}
        />
      )}
    </div>
  );
}

/**
 * Portal-style container positioning all active toasts in the bottom-right.
 * @param toasts    - Active toast array from useToast
 * @param onDismiss - Forwarded dismiss callback
 */
export function ToastContainer({ toasts, onDismiss }: ToastContainerProps): React.JSX.Element {
  return (
    <div
      aria-label="Notifications"
      className="fixed bottom-ds-6 right-ds-6 z-ds-toast flex flex-col gap-ds-3 pointer-events-none"
    >
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem toast={t} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}
