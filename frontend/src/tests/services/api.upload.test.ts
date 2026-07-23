/**
 * @file api.upload.test.ts
 * @description Unit tests for uploadDocument's XMLHttpRequest wiring — progress,
 *   success/error parsing, and the timeout guard (regression test: previously
 *   xhr.timeout was never set, so a stalled connection left the UI showing
 *   "Uploading N%" indefinitely with no error and no way to retry).
 * @author [Author Placeholder]
 * @created 2026-07-23
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { uploadDocument } from '../../services/api';

// ---------------------------------------------------------------------------
// Minimal fake XMLHttpRequest — jsdom's real implementation doesn't simulate
// network timeouts, so we drive the exact event/property contract uploadDocument
// depends on (open, timeout, setRequestHeader, upload.onprogress, onload,
// onerror, onabort, ontimeout, send, status, responseText).
// ---------------------------------------------------------------------------

class FakeXHR {
  static instances: FakeXHR[] = [];

  timeout = 0;
  status = 0;
  responseText = '';
  upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;

  openedUrl = '';
  headers: Record<string, string> = {};
  sent = false;

  constructor() {
    FakeXHR.instances.push(this);
  }

  open(_method: string, url: string): void {
    this.openedUrl = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  send(): void {
    this.sent = true;
  }

  // ── Test helpers to simulate server/network behavior ──────────────────────

  simulateSuccess(body: unknown): void {
    this.status = 200;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }

  simulateHttpError(status: number, body: unknown): void {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }

  simulateNetworkError(): void {
    this.onerror?.();
  }

  simulateTimeout(): void {
    this.ontimeout?.();
  }
}

beforeEach(() => {
  FakeXHR.instances = [];
  vi.stubGlobal('XMLHttpRequest', FakeXHR);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const makeFile = (): File => new File(['file content'], 'report.pdf', { type: 'application/pdf' });

/**
 * uploadDocument awaits getAuthToken() (a microtask) before constructing the
 * XHR, so the instance isn't available synchronously after calling it —
 * flush pending microtasks first.
 */
async function waitForXhr(): Promise<FakeXHR> {
  await Promise.resolve();
  await Promise.resolve();
  const xhr = FakeXHR.instances[0];
  if (!xhr) throw new Error('Expected uploadDocument to have constructed an XHR by now');
  return xhr;
}

describe('uploadDocument — timeout configuration', () => {
  it('sets a finite xhr.timeout before sending', async () => {
    const promise = uploadDocument(makeFile());
    const xhr = await waitForXhr();

    expect(xhr.timeout).toBeGreaterThan(0);
    expect(Number.isFinite(xhr.timeout)).toBe(true);

    xhr.simulateSuccess({ success: true, data: { documents: [{ id: 'd1', filename: 'report.pdf', status: 'pending', jobId: 'j1' }] } });
    await promise;
  });

  it('rejects with a descriptive error when the upload times out', async () => {
    const promise = uploadDocument(makeFile());
    const xhr = await waitForXhr();

    xhr.simulateTimeout();

    await expect(promise).rejects.toThrow(/timed out/i);
  });

  it('does not hang forever — ontimeout is wired even though send() never resolves on its own', async () => {
    const promise = uploadDocument(makeFile());
    const xhr = await waitForXhr();

    expect(typeof xhr.ontimeout).toBe('function');

    xhr.simulateTimeout();
    await expect(promise).rejects.toThrow();
  });
});

describe('uploadDocument — existing success/error paths still work', () => {
  it('resolves with the uploaded document on 200', async () => {
    const promise = uploadDocument(makeFile());
    const xhr = await waitForXhr();

    xhr.simulateSuccess({
      success: true,
      data: { documents: [{ id: 'doc-1', filename: 'report.pdf', status: 'pending', jobId: 'job-1' }] },
    });

    await expect(promise).resolves.toEqual({
      documentId: 'doc-1',
      filename: 'report.pdf',
      status: 'pending',
      jobId: 'job-1',
    });
  });

  it('rejects on network error', async () => {
    const promise = uploadDocument(makeFile());
    const xhr = await waitForXhr();

    xhr.simulateNetworkError();

    await expect(promise).rejects.toThrow(/network error/i);
  });

  it('reports upload progress via onProgress', async () => {
    const onProgress = vi.fn();
    const promise = uploadDocument(makeFile(), onProgress);
    const xhr = await waitForXhr();

    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 } as ProgressEvent);

    expect(onProgress).toHaveBeenCalledWith(50);

    xhr.simulateSuccess({ success: true, data: { documents: [{ id: 'd1', filename: 'report.pdf', status: 'pending', jobId: 'j1' }] } });
    await promise;
  });
});
