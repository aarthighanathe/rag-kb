/**
 * @file ToastContext.tsx
 * @description Global toast context — wraps the app so any component can fire
 *   toast notifications without prop-drilling the useToast hook.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import React, { createContext, useContext } from 'react';
import { useToast, type UseToastReturn } from '../design-system/components/useToast';
import { ToastContainer } from '../design-system/components/Toast';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ToastContext = createContext<UseToastReturn | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Renders the toast container and exposes the toast API to the component tree.
 * Place this once at the app root.
 * @param children - Application subtree
 */
export function ToastProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const toastApi = useToast();

  return (
    <ToastContext.Provider value={toastApi}>
      {children}
      <ToastContainer toasts={toastApi.toasts} onDismiss={toastApi.dismiss} />
    </ToastContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Consumer hook
// ---------------------------------------------------------------------------

/**
 * Returns the app-wide toast API.
 * Must be used inside a <ToastProvider>.
 * @returns toast, dismiss, dismissAll, and toasts array
 */
export function useAppToast(): UseToastReturn {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useAppToast must be used within a ToastProvider');
  }
  return ctx;
}
