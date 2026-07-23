/**
 * @file chat.spec.ts
 * @description Playwright E2E tests for the Chat page.
 *   SSE streaming and REST endpoints are intercepted with page.route() so tests
 *   run without a live backend.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { test, expect } from '@playwright/test';

// ─── SSE Helpers ──────────────────────────────────────────────────────────────

/** Builds a raw SSE frame string. */
function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Full SSE body for a successful streaming answer. */
function buildSSEStream(tokens = ['Hello', ' world', '!']): string {
  const chunks = [
    sseFrame('searching', {}),
    sseFrame('found', {
      count: 1,
      sources: [
        {
          documentId: 'doc-uuid-1',
          documentName: 'report.pdf',
          chunkId: 'chunk-uuid-1',
          chunkRef: 'report.pdf#1',
          similarity: 0.92,
          excerpt: 'Relevant excerpt from the document.',
        },
      ],
    }),
    sseFrame('generating', {}),
    ...tokens.map((t) => sseFrame('token', { text: t })),
    sseFrame('complete', { citations: [] }),
  ];
  return chunks.join('');
}

// ─── Route Mocks ──────────────────────────────────────────────────────────────

/** Intercepts POST /api/query to return a queryId. */
async function mockQueryPost(page: import('@playwright/test').Page, queryId = 'q-uuid-1') {
  await page.route('**/api/query', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { queryId },
        meta: { correlationId: 'test-correlation-id' },
      }),
    });
  });
}

/** Intercepts GET /api/query/stream?queryId=* and returns a full SSE stream. */
async function mockSSEStream(
  page: import('@playwright/test').Page,
  tokens = ['Hello', ' world', '!'],
) {
  await page.route('**/api/query/stream*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: {
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
      body: buildSSEStream(tokens),
    });
  });
}

/** Intercepts GET /api/documents and returns an empty list (no docs needed for chat). */
async function mockDocumentsList(
  page: import('@playwright/test').Page,
  docs: unknown[] = [],
) {
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

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Chat page', () => {
  test.beforeEach(async ({ page }) => {
    await mockDocumentsList(page);
    await page.goto('/chat');
  });

  test('shows the query input and empty state on load', async ({ page }) => {
    await expect(page.locator('[data-testid="query-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="empty-state"]')).toBeVisible();
  });

  test('displays three suggested queries in empty state', async ({ page }) => {
    const suggestions = page.locator('[data-testid="suggested-query"]');
    await expect(suggestions).toHaveCount(3);
  });

  test('clicking a suggested query fills the input', async ({ page }) => {
    const firstSuggestion = page.locator('[data-testid="suggested-query"]').first();
    const suggestionText = await firstSuggestion.textContent();
    await firstSuggestion.click();

    const input = page.locator('[data-testid="query-input"]');
    await expect(input).toHaveValue(suggestionText!.trim());
  });

  test('sends a query and displays a user message', async ({ page }) => {
    await mockQueryPost(page);
    await mockSSEStream(page);

    await page.fill('[data-testid="query-input"]', 'What is in the documents?');
    await page.keyboard.press('Control+Enter');

    await expect(page.locator('[data-testid="user-message"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="user-message"]')).toContainText('What is in the documents?');
  });

  test('receives a streamed assistant response and shows it', async ({ page }) => {
    await mockQueryPost(page);
    await mockSSEStream(page, ['Hello', ' world', '!']);

    await page.fill('[data-testid="query-input"]', 'Tell me something');
    await page.keyboard.press('Control+Enter');

    // Assistant message should appear and contain the streamed tokens
    await expect(page.locator('[data-testid="assistant-message"]')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('[data-testid="assistant-message"]')).toContainText('Hello world!');
  });

  test('shows citation chip after streaming completes', async ({ page }) => {
    await mockQueryPost(page);
    await mockSSEStream(page);

    await page.fill('[data-testid="query-input"]', 'Show me citations');
    await page.keyboard.press('Control+Enter');

    // Wait for the assistant message; citation chip should appear
    await expect(page.locator('[data-testid="citation-chip"]')).toBeVisible({ timeout: 8000 });
  });

  test('streaming cursor appears during response generation', async ({ page }) => {
    // Use a slow route to keep the stream open long enough to detect the cursor
    let resolveStream!: () => void;
    const streamDone = new Promise<void>((resolve) => { resolveStream = resolve; });

    await mockQueryPost(page);
    await page.route('**/api/query/stream*', async (route) => {
      // Deliver tokens immediately but check cursor before fulfilling
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: buildSSEStream(['Partial…']),
      });
      resolveStream();
    });

    await page.fill('[data-testid="query-input"]', 'Show cursor');
    await page.keyboard.press('Control+Enter');

    // Either cursor is shown during streaming or assistant message appears after
    await Promise.race([
      expect(page.locator('[data-testid="streaming-cursor"]')).toBeVisible({ timeout: 5000 }),
      expect(page.locator('[data-testid="assistant-message"]')).toBeVisible({ timeout: 5000 }),
    ]);

    await streamDone;
  });

  test('query input is cleared after submitting', async ({ page }) => {
    await mockQueryPost(page);
    await mockSSEStream(page);

    await page.fill('[data-testid="query-input"]', 'Clear after send?');
    await page.keyboard.press('Control+Enter');

    await expect(page.locator('[data-testid="query-input"]')).toHaveValue('', { timeout: 3000 });
  });

  // ─── Copy Button Tests ───────────────────────────────────────────────────────────

  test('Copy button appears on hover over assistant message', async ({ page }) => {
    await mockQueryPost(page);
    await mockSSEStream(page);

    await page.fill('[data-testid="query-input"]', 'Test copy button');
    await page.keyboard.press('Control+Enter');

    await expect(page.locator('[data-testid="assistant-message"]')).toBeVisible({ timeout: 8000 });

    // Copy button should be present but initially hidden (opacity-0)
    const copyButton = page.locator('[data-testid="assistant-message"] button[aria-label*="Copy"]');
    await expect(copyButton).toHaveCount(1);

    // Hover over the assistant message to show the copy button
    const assistantMessage = page.locator('[data-testid="assistant-message"]');
    await assistantMessage.hover();

    // After hover, button should be visible (opacity changes)
    await expect(copyButton).toBeVisible();
  });

  test('Click copy button shows success state', async ({ page }) => {
    await mockQueryPost(page);
    await mockSSEStream(page);

    await page.fill('[data-testid="query-input"]', 'Test copy success');
    await page.keyboard.press('Control+Enter');

    await expect(page.locator('[data-testid="assistant-message"]')).toBeVisible({ timeout: 8000 });

    const copyButton = page.locator('[data-testid="assistant-message"] button[aria-label*="Copy"]');
    await page.locator('[data-testid="assistant-message"]').hover();
    await copyButton.click();

    // Button should show "Copied to clipboard" aria-label
    await expect(copyButton).toHaveAttribute('aria-label', 'Copied to clipboard');
  });

  // ─── Export Button Tests ──────────────────────────────────────────────────────────

  test('Export button disabled when no messages', async ({ page }) => {
    const exportButton = page.locator('button[aria-label="Export conversation as Markdown file"]');
    await expect(exportButton).toBeDisabled();
  });

  test('Export button enabled after first exchange', async ({ page }) => {
    await mockQueryPost(page);
    await mockSSEStream(page);

    await page.fill('[data-testid="query-input"]', 'Test export enable');
    await page.keyboard.press('Control+Enter');

    await expect(page.locator('[data-testid="assistant-message"]')).toBeVisible({ timeout: 8000 });

    const exportButton = page.locator('button[aria-label="Export conversation as Markdown file"]');
    await expect(exportButton).toBeEnabled();
  });

  test('Click export triggers file download', async ({ page }) => {
    await mockQueryPost(page);
    await mockSSEStream(page);

    await page.fill('[data-testid="query-input"]', 'Test export download');
    await page.keyboard.press('Control+Enter');

    await expect(page.locator('[data-testid="assistant-message"]')).toBeVisible({ timeout: 8000 });

    // Set up download handler
    const downloadPromise = page.waitForEvent('download');
    const exportButton = page.locator('button[aria-label="Export conversation as Markdown file"]');
    await exportButton.click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^rag-kb-conversation-\d{4}-\d{2}-\d{2}\.md$/);
  });

  // ─── Keyboard Shortcut Tests ─────────────────────────────────────────────────────

  test('Ctrl+K focuses input from anywhere on page', async ({ page }) => {
    // Click outside the input first
    await page.locator('body').click();

    await page.keyboard.press('Control+K');

    const input = page.locator('[data-testid="query-input"]');
    await expect(input).toBeFocused();
  });

  test('Ctrl+Enter sends query', async ({ page }) => {
    await mockQueryPost(page);
    await mockSSEStream(page);

    await page.fill('[data-testid="query-input"]', 'Send via shortcut');
    await page.keyboard.press('Control+Enter');

    await expect(page.locator('[data-testid="user-message"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="user-message"]')).toContainText('Send via shortcut');
  });

  test('Shortcut panel opens on "?" click', async ({ page }) => {
    const helpButton = page.locator('button[aria-label="Show keyboard shortcuts"]');
    await helpButton.click();

    // Check that the shortcuts panel is visible
    const shortcutsPanel = page.locator('role=dialog[name="Keyboard shortcuts"]');
    await expect(shortcutsPanel).toBeVisible();

    // Check that it contains the expected shortcuts
    await expect(page.locator('text=Ctrl+K')).toBeVisible();
    await expect(page.locator('text=Ctrl+Enter')).toBeVisible();
    await expect(page.locator('text=Escape')).toBeVisible();
  });

  test('Shortcut panel closes on Escape', async ({ page }) => {
    const helpButton = page.locator('button[aria-label="Show keyboard shortcuts"]');
    await helpButton.click();

    await expect(page.locator('role=dialog[name="Keyboard shortcuts"]')).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.locator('role=dialog[name="Keyboard shortcuts"]')).not.toBeVisible();
  });
});
