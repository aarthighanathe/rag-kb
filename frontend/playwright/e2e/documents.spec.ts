/**
 * @file documents.spec.ts
 * @description Playwright E2E tests for the Documents management page.
 *   API endpoints are intercepted with page.route() so tests run without a live backend.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { test, expect } from '@playwright/test';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const DOC_READY = {
  id: 'doc-uuid-1',
  filename: 'annual-report.pdf',
  status: 'ready',
  chunk_count: 12,
  size_bytes: 204800,
  created_at: '2026-06-01T10:00:00.000Z',
};

const DOC_PROCESSING = {
  id: 'doc-uuid-2',
  filename: 'meeting-notes.txt',
  status: 'processing',
  chunk_count: 0,
  size_bytes: 4096,
  created_at: '2026-06-10T14:30:00.000Z',
};

// ─── Route Mocks ──────────────────────────────────────────────────────────────

/** Intercepts GET /api/documents and returns the supplied document list. */
async function mockDocumentsList(
  page: import('@playwright/test').Page,
  documents: unknown[] = [],
) {
  await page.route('**/api/documents*', async (route) => {
    if (route.request().method() === 'DELETE') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: documents,
        meta: { page: 1, total: documents.length, correlationId: 'test-correlation-id' },
      }),
    });
  });
}

/** Intercepts DELETE /api/documents/:id and returns success. */
async function mockDeleteDocument(page: import('@playwright/test').Page, deletedId: string) {
  await page.route(`**/api/documents/${deletedId}`, async (route) => {
    if (route.request().method() === 'DELETE') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { documentId: deletedId },
          meta: { correlationId: 'test-correlation-id' },
        }),
      });
    } else {
      await route.continue();
    }
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Documents page', () => {
  test('shows an empty state when there are no documents', async ({ page }) => {
    await mockDocumentsList(page, []);
    await page.goto('/documents');

    await expect(page.locator('[data-testid="empty-state"]')).toBeVisible();
  });

  test('shows document rows when documents exist', async ({ page }) => {
    await mockDocumentsList(page, [DOC_READY, DOC_PROCESSING]);
    await page.goto('/documents');

    const rows = page.locator('[data-testid="document-row"]');
    await expect(rows).toHaveCount(2);
  });

  test('shows a ready status badge for a ready document', async ({ page }) => {
    await mockDocumentsList(page, [DOC_READY]);
    await page.goto('/documents');

    await expect(page.locator('[data-testid="status-badge-ready"]')).toBeVisible();
  });

  test('shows a status badge for a processing document', async ({ page }) => {
    await mockDocumentsList(page, [DOC_PROCESSING]);
    await page.goto('/documents');

    // Processing docs use the generic 'status-badge' testid (not 'status-badge-ready')
    await expect(page.locator('[data-testid="status-badge"]')).toBeVisible();
  });

  test('displays the filename in each document row', async ({ page }) => {
    await mockDocumentsList(page, [DOC_READY, DOC_PROCESSING]);
    await page.goto('/documents');

    await expect(page.locator('[data-testid="document-row"]').nth(0)).toContainText('annual-report.pdf');
    await expect(page.locator('[data-testid="document-row"]').nth(1)).toContainText('meeting-notes.txt');
  });

  test('clicking delete opens the confirmation modal', async ({ page }) => {
    await mockDocumentsList(page, [DOC_READY]);
    await page.goto('/documents');

    await page.locator('[data-testid="delete-button"]').first().click();

    await expect(page.locator('[data-testid="confirm-modal"]')).toBeVisible();
  });

  test('cancelling delete closes the modal and keeps the row', async ({ page }) => {
    await mockDocumentsList(page, [DOC_READY, DOC_PROCESSING]);
    await page.goto('/documents');

    await page.locator('[data-testid="delete-button"]').first().click();
    await expect(page.locator('[data-testid="confirm-modal"]')).toBeVisible();

    await page.locator('[data-testid="cancel-delete"]').click();

    await expect(page.locator('[data-testid="confirm-modal"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="document-row"]')).toHaveCount(2);
  });

  test('confirming delete removes the document row', async ({ page }) => {
    // Start with two docs; delete the first one
    let firstRequest = true;
    await page.route('**/api/documents*', async (route) => {
      const method = route.request().method();
      const url = route.request().url();

      if (method === 'DELETE' && url.includes(DOC_READY.id)) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { documentId: DOC_READY.id },
            meta: { correlationId: 'test-correlation-id' },
          }),
        });
        return;
      }

      // GET /api/documents: first load returns both; subsequent loads return only the second
      if (method === 'GET') {
        const docs = firstRequest ? [DOC_READY, DOC_PROCESSING] : [DOC_PROCESSING];
        firstRequest = false;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: docs,
            meta: { page: 1, total: docs.length, correlationId: 'test-correlation-id' },
          }),
        });
        return;
      }

      await route.continue();
    });

    await page.goto('/documents');
    await expect(page.locator('[data-testid="document-row"]')).toHaveCount(2);

    // Click delete on the first row
    await page.locator('[data-testid="delete-button"]').first().click();
    await expect(page.locator('[data-testid="confirm-modal"]')).toBeVisible();

    await page.locator('[data-testid="confirm-delete"]').click();

    // After confirmation and list refresh, only one row should remain
    await expect(page.locator('[data-testid="document-row"]')).toHaveCount(1, { timeout: 5000 });
  });

  test('refresh button reloads the document list', async ({ page }) => {
    let callCount = 0;
    await page.route('**/api/documents*', async (route) => {
      callCount++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: callCount === 1 ? [DOC_READY] : [DOC_READY, DOC_PROCESSING],
          meta: { page: 1, total: callCount === 1 ? 1 : 2, correlationId: 'test-correlation-id' },
        }),
      });
    });

    await page.goto('/documents');
    await expect(page.locator('[data-testid="document-row"]')).toHaveCount(1);

    // Trigger a manual refresh
    await page.locator('[data-testid="refresh-button"]').click();

    // Second call returns two documents
    await expect(page.locator('[data-testid="document-row"]')).toHaveCount(2, { timeout: 5000 });
  });
});
