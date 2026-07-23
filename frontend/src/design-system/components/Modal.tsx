/**
 * @file Modal.tsx
 * @description Accessible modal dialog — Lab Notebook theme.
 *   Sharp corners, no backdrop blur (solid semi-transparent ink overlay),
 *   paper-drop settle animation, white surface with hairline border.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import React, { useRef } from 'react';
import { X } from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';

export interface ModalProps {
  /** Controls open/closed state. */
  open: boolean;
  /** Called when the user closes the modal (Escape, backdrop, or × button). */
  onClose: () => void;
  /** Modal dialog title shown in the header. */
  title: string;
  /** Optional subtitle rendered below the title. */
  subtitle?: string;
  /** Main content area. */
  children: React.ReactNode;
  /** Optional footer — typically action buttons. */
  footer?: React.ReactNode;
  /** Tailwind width class applied to the dialog panel (default: 'max-w-lg'). */
  width?: string;
  /** When true, clicking the backdrop does not close the modal. */
  preventBackdropClose?: boolean;
}

/**
 * Accessible modal with focus trap, Escape handling, and paper-drop animation.
 * @param open               - Visibility state
 * @param onClose            - Close callback
 * @param title              - Dialog label
 * @param subtitle           - Optional description line
 * @param children           - Dialog body content
 * @param footer             - Bottom action area
 * @param width              - Max-width Tailwind class (default: 'max-w-lg')
 * @param preventBackdropClose - Disable backdrop click-to-close
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'max-w-lg',
  preventBackdropClose = false,
}: ModalProps): React.JSX.Element | null {
  const dialogRef     = useRef<HTMLDivElement>(null);
  const titleId       = 'modal-title';

  useFocusTrap(dialogRef, { open, onClose });

  if (!open) return null;

  return (
    <div
      role="presentation"
      aria-hidden="false"
      className="fixed inset-0 z-ds-modal flex items-end sm:items-center justify-center p-4"
    >
      {/* Backdrop — solid semi-transparent, no blur (glass UI = wrong aesthetic) */}
      <div
        aria-hidden="true"
        onClick={() => !preventBackdropClose && onClose()}
        className="absolute inset-0 bg-[rgba(28,27,25,0.45)] animate-fade-in"
      />

      {/* Dialog — white surface, sharp corners, paper-drop settle */}
      <div
        ref={dialogRef}
        data-testid="confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`
          relative w-full ${width}
          bg-ds-surface border border-ds-hairline rounded-[2px] shadow-ds-lifted
          flex flex-col max-h-[85vh]
          animate-paper-drop
        `}
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-ds-4 px-ds-6 pt-ds-5 pb-ds-4 border-b border-ds-hairline shrink-0">
          <div>
            <h2
              id={titleId}
              className="text-ds-lg font-display font-bold text-ds-text-primary leading-ds-tight"
            >
              {title}
            </h2>
            {subtitle && (
              <p className="text-ds-sm font-body text-ds-text-muted mt-ds-1">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="shrink-0 p-1 rounded-[2px] text-ds-text-muted hover:text-ds-text-primary hover:bg-ds-base transition-colors"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-ds-6 py-ds-4">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <footer className="flex items-center justify-end gap-ds-3 px-ds-6 pt-ds-4 pb-ds-5 border-t border-ds-hairline shrink-0">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
