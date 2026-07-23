/**
 * @file global-setup.ts
 * @description Playwright global setup — fetches a Clerk testing token once per
 *   test run so individual specs can sign in a real (disposable) test user via
 *   @clerk/testing without hitting Clerk's bot-protection/CAPTCHA layer.
 *   Reads CLERK_SECRET_KEY / VITE_CLERK_PUBLISHABLE_KEY from .env.local (same
 *   values used by the app itself — clerkSetup() loads them automatically).
 * @author [Author Placeholder]
 * @created 2026-07-18
 */

import { clerkSetup } from '@clerk/testing/playwright';

export default async function globalSetup(): Promise<void> {
  await clerkSetup();
}
