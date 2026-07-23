/**
 * @file App.tsx
 * @description Root application component — routing shell, error boundary, Suspense,
 *   and global Toast provider. The persistent sidebar has been replaced with the
 *   horizontal AppHeader rendered only on interior routes (/upload, /chat, /documents).
 *   The landing page (/) has its own minimal header.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import React, { Component, Suspense, useEffect, type ErrorInfo } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { SignedIn, SignedOut, RedirectToSignIn, useAuth } from '@clerk/clerk-react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { AppHeader } from './design-system/components/AppHeader';
import { LoadingSpinner } from './design-system/components/LoadingSpinner';
import { Button } from './design-system/components/Button';
import { ToastProvider } from './contexts/ToastContext';
import { useFaviconState } from './hooks/useFaviconState';
import { clientLog } from './utils/clientLogger';
import { registerTokenGetter } from './services/api';

// Lazy-loaded pages
const Landing    = React.lazy(() => import('./pages/Landing').then((m) => ({ default: m.Landing })));
const Upload     = React.lazy(() => import('./pages/Upload').then((m) => ({ default: m.Upload })));
const Chat       = React.lazy(() => import('./pages/Chat').then((m) => ({ default: m.Chat })));
const Documents  = React.lazy(() => import('./pages/Documents').then((m) => ({ default: m.Documents })));
const DesignSystem = React.lazy(() => import('./pages/DesignSystem').then((m) => ({ default: m.DesignSystemShowcase })));
const SignInPage = React.lazy(() => import('./pages/SignIn').then((m) => ({ default: m.SignInPage })));

// ---------------------------------------------------------------------------
// Error boundary
// ---------------------------------------------------------------------------

interface ErrState { hasError: boolean; error: Error | null }

/**
 * Class-based error boundary — catches render errors and shows a recovery UI.
 */
class AppErrorBoundary extends Component<{ children: React.ReactNode }, ErrState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    clientLog('error', '[ErrorBoundary]', error, info.componentStack);
  }

  handleReset = (): void => { this.setState({ hasError: false, error: null }); };

  override render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="flex flex-col items-center justify-center min-h-[60vh] gap-6 px-8 text-center"
        >
          <div className="flex items-center justify-center h-20 w-20 rounded-ds-xl bg-ds-rose/10 border border-ds-rose/30">
            <AlertTriangle size={36} className="text-ds-rose" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-ds-xl font-display font-semibold text-ds-text-primary">
              Something went wrong
            </h2>
            <p className="text-ds-sm font-body text-ds-text-secondary mt-2 max-w-sm">
              {this.state.error?.message ?? 'An unexpected error occurred.'}
            </p>
          </div>
          <Button variant="secondary" iconLeft={<RefreshCw size={14} />} onClick={this.handleReset}>
            Try again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Page loading fallback
// ---------------------------------------------------------------------------

function PageSpinner(): React.JSX.Element {
  return (
    <div className="flex items-center justify-center min-h-[60vh]" aria-busy="true">
      <LoadingSpinner size="lg" label="Loading page…" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Auth wiring — bridges Clerk's token getter into the plain-TS api.ts client
// ---------------------------------------------------------------------------

/** Registers Clerk's getToken with api.ts so every fetch call can attach a Bearer token. Renders nothing. */
function AuthTokenBridge(): null {
  const { getToken } = useAuth();

  useEffect(() => {
    registerTokenGetter(getToken);
  }, [getToken]);

  return null;
}

/** Wraps a route element so signed-out users are redirected to /sign-in. */
function ProtectedRoute({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <>
      <SignedIn>{children}</SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  );
}

// ---------------------------------------------------------------------------
// Interior layout — AppHeader + scrollable content
// ---------------------------------------------------------------------------

/**
 * Shell wrapping interior routes (Upload / Chat / Documents).
 * Renders AppHeader at the top; content fills the remaining viewport height.
 */
function InteriorShell({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-ds-base">
      <AppHeader />
      {/* No max-width wrapper — full-bleed layouts handled per page */}
      <main id="main-content" className="flex-1 overflow-hidden min-h-0 w-full">
        {children}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// App root
// ---------------------------------------------------------------------------

/**
 * Root App — BrowserRouter, ToastProvider, error boundary, lazy-loaded routes.
 * Landing page uses its own standalone layout; interior routes share InteriorShell.
 */
export default function App(): React.JSX.Element {
  useFaviconState();

  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthTokenBridge />
        <AppErrorBoundary>
          <Suspense fallback={<PageSpinner />}>
            <Routes>
              {/* Landing — no shared header, own minimal nav, public */}
              <Route path="/" element={<Landing />} />

              {/* Sign-in — Clerk's SignIn component owns its own subpaths */}
              <Route path="/sign-in/*" element={<SignInPage />} />

              {/* Interior routes — share horizontal AppHeader, require auth */}
              <Route
                path="/upload"
                element={
                  <ProtectedRoute>
                    <InteriorShell>
                      <Upload />
                    </InteriorShell>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/chat"
                element={
                  <ProtectedRoute>
                    <InteriorShell>
                      <Chat />
                    </InteriorShell>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/documents"
                element={
                  <ProtectedRoute>
                    <InteriorShell>
                      <Documents />
                    </InteriorShell>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/design-system"
                element={
                  <InteriorShell>
                    <DesignSystem />
                  </InteriorShell>
                }
              />
            </Routes>
          </Suspense>
        </AppErrorBoundary>
      </ToastProvider>
    </BrowserRouter>
  );
}
