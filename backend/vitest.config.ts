/**
 * @file vitest.config.ts
 * @description Vitest configuration for backend unit and integration tests
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'threads',
    setupFiles: ['./tests/setup.ts'],
    typecheck: {
      tsconfig: './tsconfig.test.json',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', 'tests/', 'src/swagger/'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
    include: ['tests/**/*.test.ts'],
    testTimeout: 10000,
  },
  resolve: {
    alias: [
      { find: 'pdf-parse', replacement: resolve(__dirname, '__mocks__/pdf-parse') },
      { find: 'mammoth',   replacement: resolve(__dirname, '__mocks__/mammoth') },
      { find: /^@services\/(.*)/, replacement: resolve(__dirname, 'src/services') + '/$1' },
      { find: /^@middleware\/(.*)/, replacement: resolve(__dirname, 'src/middleware') + '/$1' },
      { find: /^@schemas\/(.*)/, replacement: resolve(__dirname, 'src/schemas') + '/$1' },
      { find: /^@utils\/(.*)/, replacement: resolve(__dirname, 'src/utils') + '/$1' },
      { find: /^@types\/(.*)/, replacement: resolve(__dirname, 'src/types') + '/$1' },
      { find: /^@queues\/(.*)/, replacement: resolve(__dirname, 'src/queues') + '/$1' },
      { find: /^@config\/(.*)/, replacement: resolve(__dirname, 'src/config') + '/$1' },
      { find: /^@routes\/(.*)/, replacement: resolve(__dirname, 'src/routes') + '/$1' },
    ],
  },
});
