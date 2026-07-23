/**
 * @file vite.config.ts
 * @description Vite configuration — React plugin, path aliases, proxy for backend API
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@components': resolve(__dirname, 'src/design-system/components'),
      '@hooks': resolve(__dirname, 'src/hooks'),
      '@pages': resolve(__dirname, 'src/pages'),
      '@stores': resolve(__dirname, 'src/stores'),
      '@services': resolve(__dirname, 'src/services'),
      '@utils': resolve(__dirname, 'src/utils'),
      '@tests': resolve(__dirname, 'src/tests'),
      '@tokens': resolve(__dirname, 'src/design-system/tokens'),
    },
  },
  server: {
    port: 5173,
    // Vite 6 rejects requests whose Host header it doesn't recognize. Allow any
    // devtunnels.ms subdomain so the dev server responds when opened through a
    // VS Code port-forwarded URL (random subdomain per tunnel session).
    allowedHosts: ['.devtunnels.ms'],
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'ES2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          router: ['react-router-dom'],
          zustand: ['zustand'],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts'],
    exclude: ['node_modules/**', 'playwright/**', 'dist/**'],
    // Without this, a test that spies on/mocks useAuth, Date.now, timers, or
    // the EventSource stub leaks that state into subsequent tests in the same
    // file/worker unless it manually calls vi.restoreAllMocks() — a missed
    // cleanup call away from test-order-dependent false passes. restoreMocks
    // restores the original implementation (not just clearing call history)
    // after every test, which also covers vi.spyOn usages.
    restoreMocks: true,
  },
});
