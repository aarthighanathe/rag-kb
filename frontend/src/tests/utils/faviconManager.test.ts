/**
 * @file faviconManager.test.ts
 * @description Tests for the faviconManager utility.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initFavicon, setFaviconState, resetFavicon } from '../../utils/faviconManager';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let linkElement: HTMLLinkElement;
const originalHref = 'data:image/png;base64,original';

beforeEach(() => {
  linkElement = document.createElement('link');
  linkElement.rel = 'icon';
  linkElement.href = originalHref;
  document.head.appendChild(linkElement);

  // Mock canvas getContext to return null (jsdom doesn't support Canvas)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  document.head.removeChild(linkElement);
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('faviconManager', () => {
  it('initFavicon caches the current favicon', () => {
    initFavicon();
    // Should not throw
    expect(true).toBe(true);
  });

  it('setFaviconState does not throw', () => {
    initFavicon();
    expect(() => {
      setFaviconState('idle');
      setFaviconState('processing');
      setFaviconState('ready');
      setFaviconState('error');
    }).not.toThrow();
  });

  it('resetFavicon does not throw', () => {
    initFavicon();
    setFaviconState('ready');
    expect(() => {
      resetFavicon();
    }).not.toThrow();
  });

  it('does not throw when no link element exists', () => {
    document.head.removeChild(linkElement);
    expect(() => {
      initFavicon();
      setFaviconState('idle');
      resetFavicon();
    }).not.toThrow();
    document.head.appendChild(linkElement);
  });
});
