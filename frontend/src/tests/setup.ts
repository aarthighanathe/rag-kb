/**
 * @file setup.ts
 * @description Vitest + jsdom test setup for frontend component tests
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import React from 'react';
import { vi } from 'vitest';
import '@testing-library/jest-dom';

// ─── Clerk mock ────────────────────────────────────────────────────────────────
//
// Component tests render pages/components in isolation (no real ClerkProvider,
// no network). Every Clerk hook/component used in the app is stubbed here so
// rendering doesn't throw "must be wrapped in <ClerkProvider>". Defaults model
// a signed-out visitor (isLoaded: true, isSignedIn: false) — Landing.tsx redirects
// signed-in visitors straight to /upload via <Navigate>, so a "signed in" default
// would make every Landing render bail out before any of its content mounts,
// breaking the page's own test suite. Nothing else in the app depends on the
// default being signed-in; override per-test with vi.mocked(useAuth) if needed.

vi.mock('@clerk/clerk-react', () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => children,
  SignedIn: ({ children }: { children: React.ReactNode }) => children,
  SignedOut: () => null,
  RedirectToSignIn: () => null,
  useAuth: () => ({
    isSignedIn: false,
    isLoaded: true,
    getToken: async () => 'mock-test-token',
  }),
  useUser: () => ({ isSignedIn: false, isLoaded: true, user: null }),
  UserButton: () => React.createElement('div', { 'data-testid': 'mock-user-button' }),
  SignIn: () => React.createElement('div', { 'data-testid': 'mock-sign-in' }),
}));

// EventSource is not implemented in JSDOM — provide a stub so vi.spyOn can
// replace it in tests that need it (useSSE.test.ts mocks the whole thing).
if (typeof globalThis.EventSource === 'undefined') {
  class EventSourceStub {
    static readonly CONNECTING = 0;
    static readonly OPEN       = 1;
    static readonly CLOSED     = 2;
    readonly CONNECTING = 0;
    readonly OPEN       = 1;
    readonly CLOSED     = 2;
    readyState = 0;
    url: string;
    withCredentials = false;
    onopen: ((ev: Event) => void) | null = null;
    onmessage: ((ev: MessageEvent) => void) | null = null;
    onerror: ((ev: Event) => void) | null = null;
    constructor(url: string, _init?: EventSourceInit) { this.url = url; }
    addEventListener(_: string, __: EventListenerOrEventListenerObject) {}
    removeEventListener(_: string, __: EventListenerOrEventListenerObject) {}
    dispatchEvent(_: Event) { return true; }
    close() { this.readyState = 2; }
  }
  // @ts-expect-error — intentional global stub for JSDOM
  globalThis.EventSource = EventSourceStub;
}
