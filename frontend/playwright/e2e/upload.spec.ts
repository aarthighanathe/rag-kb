/**
 * @file upload.spec.ts
 * @description Playwright E2E tests for the Upload page.
 *   API endpoints are intercepted with page.route() so tests run without a live backend.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { test, expect } from '@playwright/test';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal valid PDF magic bytes. */
const PDF_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

/** Intercept the upload endpoint so tests never hit a live backend. */
async function mockUploadSuccess(page: import('@playwright/test').Page) {
  await page.route('**/api/upload', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          documents: [
            { documentId: 'doc-uuid-1', filename: 'sample.pdf', status: 'pending', jobId: 'job-uuid-1' },
          ],
        },
        meta: { correlationId: 'test-correlation-id' },
      }),
    });
  });
}

/** Intercept the documents list endpoint. */
async function mockDocumentsList(page: import('@playwright/test').Page, documents = []) {
  await page.route('**/api/documents*', async (route) => {
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

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Upload page', () => {
  test.beforeEach(async ({ page }) => {
    await mockDocumentsList(page);
    await page.goto('/');
  });

  test('shows the file dropzone on load', async ({ page }) => {
    await expect(page.locator('[data-testid="file-dropzone"]')).toBeVisible();
    await expect(page.locator('[data-testid="file-input"]')).toBeAttached();
  });

  test('selecting a PDF adds it to the pending list', async ({ page }) => {
    await page.setInputFiles('[data-testid="file-input"]', {
      name: 'sample.pdf',
      mimeType: 'application/pdf',
      buffer: PDF_BYTES,
    });

    // The Upload page renders pending files inside the FileDropzone file list
    await expect(page.locator('[data-testid="file-queue-item"]')).toContainText('sample.pdf');
  });

  test('upload button appears when a file is selected', async ({ page }) => {
    await page.setInputFiles('[data-testid="file-input"]', {
      name: 'sample.pdf',
      mimeType: 'application/pdf',
      buffer: PDF_BYTES,
    });

    await expect(page.locator('[data-testid="upload-button"]')).toBeVisible();
  });

  test('clicking upload sends the file and shows processing queue item', async ({ page }) => {
    await mockUploadSuccess(page);

    await page.setInputFiles('[data-testid="file-input"]', {
      name: 'sample.pdf',
      mimeType: 'application/pdf',
      buffer: PDF_BYTES,
    });

    await page.click('[data-testid="upload-button"]');

    // After upload starts, the queue section should appear with the file
    await expect(page.locator('[data-testid="upload-queue-item"]')).toBeVisible({ timeout: 5000 });
  });

  test('rejects a file with an unsupported extension and shows error', async ({ page }) => {
    await page.setInputFiles('[data-testid="file-input"]', {
      name: 'malware.exe',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('MZ\x90\x00'),
    });

    // FileDropzone validates extension and shows rejection error
    await expect(page.locator('[data-testid="file-error"]')).toContainText('not supported', { timeout: 3000 });
  });

  test('shows empty state when no files are selected or queued', async ({ page }) => {
    // No files have been added, so the empty state should be visible
    await expect(page.locator('[data-testid="empty-state"]')).toBeVisible();
  });

  test('multiple files can be added and all appear in the list', async ({ page }) => {
    const files = [
      { name: 'doc1.pdf', mimeType: 'application/pdf', buffer: PDF_BYTES },
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Hello world') },
    ];

    for (const f of files) {
      await page.setInputFiles('[data-testid="file-input"]', f);
    }

    const items = page.locator('[data-testid="file-queue-item"]');
    await expect(items).toHaveCount(2);
  });
});
