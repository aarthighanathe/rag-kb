/**
 * @file auth.spec.ts
 * @description Playwright E2E tests for the Clerk auth-gated redirect flow —
 *   the single most load-bearing user-facing flow in the app (every protected
 *   route depends on it), previously with zero automated coverage.
 *
 *   Signed-out cases hit real protected routes with no session (no mocking
 *   needed — Clerk's <SignedOut>/<RedirectToSignIn> in App.tsx does the work).
 *   Signed-in cases use @clerk/testing's clerk.signIn() against a dedicated,
 *   disposable test user (see frontend/.env.local E2E_CLERK_USER_EMAIL) —
 *   a real Clerk session, not a mock of Clerk's hooks. globalSetup in
 *   playwright.config.ts fetches the testing token this relies on.
 *
 *   API calls on the protected pages are intercepted with page.route(), same
 *   convention as chat.spec.ts / documents.spec.ts, since no live backend is
 *   assumed to be running for e2e.
 * @author [Author Placeholder]
 * @created 2026-07-18
 */

import { test, expect, type Page } from '@playwright/test';
import { clerk } from '@clerk/testing/playwright';

const E2E_EMAIL = process.env['E2E_CLERK_USER_EMAIL'];

/** Every route App.tsx wraps in <ProtectedRoute> (SignedIn/SignedOut/RedirectToSignIn). */
const PROTECTED_ROUTES = ['/chat', '/documents', '/upload'] as const;

/** Intercepts GET /api/documents so signed-in page loads don't depend on a live backend. */
async function mockDocumentsList(page: Page, docs: unknown[] = []): Promise<void> {
  await page.route('**/api/documents*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: docs,
        meta: { page: 1, total: docs.length, correlationId: 'test-correlation-id' },
      }),
    });
  });
}

/** Signs in the dedicated e2e test user via Clerk's real backend-issued sign-in ticket. */
async function signInTestUser(page: Page): Promise<void> {
  if (!E2E_EMAIL) {
    throw new Error(
      'E2E_CLERK_USER_EMAIL is not set. See frontend/.env.example — this test needs ' +
        'a dedicated Clerk test user, never a real account.',
    );
  }
  // clerk.signIn() reads window.Clerk, so the page must already be on an
  // app URL that mounts <ClerkProvider> before this is called.
  await page.goto('/');
  await clerk.loaded({ page });
  await clerk.signIn({ page, emailAddress: E2E_EMAIL });
}

// ── 1. Signed-out user hits a protected route ──────────────────────────────

test.describe('Signed-out user hitting a protected route', () => {
  for (const route of PROTECTED_ROUTES) {
    test(`${route} redirects to /sign-in`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/sign-in/);
    });
  }
});

// ── 2. Signed-out user hits /sign-in directly ──────────────────────────────

test.describe('Signed-out user hitting /sign-in directly', () => {
  test('loads the sign-in form with no redirect loop', async ({ page }) => {
    await page.goto('/sign-in');

    // Stays on /sign-in (does not bounce elsewhere), and Clerk's <SignIn>
    // form actually renders — not just "not the protected page".
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByRole('heading', { name: /sign in/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    // No loop: URL settles and stays settled — give it a beat and re-check.
    const urlAfterLoad = page.url();
    await page.waitForTimeout(1000);
    expect(page.url()).toBe(urlAfterLoad);
  });
});

// ── 3. Signed-in user hits a protected route ───────────────────────────────

test.describe('Signed-in user hitting a protected route', () => {
  test.beforeEach(async ({ page }) => {
    await mockDocumentsList(page);
    await signInTestUser(page);
  });

  test('/chat loads the actual page content, no redirect', async ({ page }) => {
    await page.goto('/chat');
    await expect(page).toHaveURL(/\/chat$/);
    await expect(page.locator('[data-testid="query-input"]')).toBeVisible();
  });

  test('/documents loads the actual page content, no redirect', async ({ page }) => {
    await page.goto('/documents');
    await expect(page).toHaveURL(/\/documents$/);
    await expect(page.getByText('Archive', { exact: true }).first()).toBeVisible();
  });

  test('/upload loads the actual page content, no redirect', async ({ page }) => {
    await page.goto('/upload');
    await expect(page).toHaveURL(/\/upload$/);
    await expect(page.getByText('Acquisitions Desk', { exact: true }).first()).toBeVisible();
  });
});

// ── 4. Signed-in user hits /sign-in directly ───────────────────────────────

test.describe('Signed-in user hitting /sign-in directly', () => {
  test('redirects away instead of showing the sign-in form', async ({ page }) => {
    await mockDocumentsList(page);
    await signInTestUser(page);

    await page.goto('/sign-in');

    // SignInPage sets forceRedirectUrl="/upload" — Clerk's <SignIn> redirects
    // an already-authenticated visitor there rather than rendering the form.
    await expect(page).toHaveURL(/\/upload/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /sign in/i })).not.toBeVisible();
  });
});

// ── 5. Deep-link preservation ───────────────────────────────────────────────
//
// Confirmed by direct observation (not assumed): RedirectToSignIn appends the
// originating URL as a `redirect_url` query param on Clerk's hosted sign-in
// page (e.g. .../sign-in?...#/?redirect_url=http%3A%2F%2Flocalhost%3A5173%2Fchat).
// This is Clerk's own RedirectToSignIn behavior, not custom app logic — the
// app never reads or re-applies that param itself. Testing the actual
// post-sign-in landing page is therefore a test of Clerk's hosted UI, not of
// this app's code, so it's out of scope here; this test verifies only the
// one thing that IS this app's behavior: the param is present when the
// redirect is constructed.

test.describe('Deep-link preservation on the signed-out redirect', () => {
  test('the protected URL the user was headed to is preserved as redirect_url', async ({ page }) => {
    await page.goto('/chat');
    await expect(page).toHaveURL(/\/sign-in/);

    const url = new URL(page.url());
    // Clerk's hosted sign-in encodes state after the hash fragment; check
    // the full href rather than parsing searchParams off a bare pathname.
    expect(decodeURIComponent(url.href)).toContain('redirect_url=http://localhost:5173/chat');
  });
});
