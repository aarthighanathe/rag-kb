/**
 * @file vite-env.d.ts
 * @description Ambient type declarations for Vite's import.meta.env — declares
 *   the app's VITE_* environment variables so they're typed at every call site.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute backend base URL (e.g. a devtunnel forwarding address). Falls back to the '/api' Vite proxy when unset. */
  readonly VITE_API_BASE_URL?: string;
  /** Clerk publishable key (pk_...) — required for the app to mount. */
  readonly VITE_CLERK_PUBLISHABLE_KEY: string;
  /**
   * Max upload size in MB, enforced client-side before the file is even sent.
   * Must be kept in sync with the backend's MAX_FILE_SIZE_MB (backend/src/config/env.ts) —
   * this is a UX-only pre-check; the backend remains the source of truth and
   * re-validates the real limit server-side regardless of this value.
   */
  readonly VITE_MAX_FILE_SIZE_MB?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
