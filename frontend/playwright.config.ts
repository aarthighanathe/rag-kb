/**
 * @file playwright.config.ts
 * @description Playwright E2E test configuration
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './playwright/e2e',
  // Fetches a Clerk testing token once per run (bypasses bot protection for
  // the disposable e2e test user signed in by auth.spec.ts). Cheap/no-op for
  // every other spec — they don't call clerk.signIn() and never touch it.
  globalSetup: './playwright/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env['CI'],
    timeout: 30_000,
  },
});
