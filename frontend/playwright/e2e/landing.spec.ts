/**
 * @file landing.spec.ts
 * @description Playwright E2E tests for the redesigned Landing page — hero
 *   copy, CTA navigation, the "THE DIFFERENCE" before/after section, stats
 *   bar, and responsive overflow.
 * @author [Author Placeholder]
 * @created 2026-07-05
 */

import { test, expect } from '@playwright/test';

test('hero headline renders correctly', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('Ask your');
});

test('Start for free CTA sends a signed-out visitor to /sign-in', async ({ page }) => {
  await page.goto('/');
  await page.click('[data-testid="hero-cta-primary"]');
  await expect(page).toHaveURL(/\/sign-in/);
});

test('difference section renders 3 rows', async ({ page }) => {
  await page.goto('/');
  const rows = page.locator('[data-testid="difference-row"]');
  await expect(rows).toHaveCount(3);
});

test('difference section has no feature grid', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-testid="feature-card"]')).toHaveCount(0);
});

test('difference section stacks on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  const firstRow = page.locator('[data-testid="difference-row"]').first();
  const box = await firstRow.boundingBox();
  expect(box?.height).toBeGreaterThan(200);
});

test('stats bar shows 4 stats', async ({ page }) => {
  await page.goto('/');
  const stats = page.locator('[data-testid="stat-item"]');
  await expect(stats).toHaveCount(4);
});

test('landing page has no horizontal overflow at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test('Open app nav link visible', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-testid="nav-open-app"]')).toBeVisible();
});
