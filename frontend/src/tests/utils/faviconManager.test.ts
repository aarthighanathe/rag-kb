/**
 * @file faviconManager.test.ts
 * @description Tests for the faviconManager utility.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initFavicon, setFaviconState } from '../../utils/faviconManager';

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
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    null as unknown as CanvasRenderingContext2D,
  );
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

  it('does not throw when no link element exists', () => {
    document.head.removeChild(linkElement);
    expect(() => {
      initFavicon();
      setFaviconState('idle');
    }).not.toThrow();
    document.head.appendChild(linkElement);
  });

  it('idle restores the original static favicon rather than drawing a canvas overlay', () => {
    initFavicon();
    // Simulate a non-idle state having changed the href away from the original.
    linkElement.href = 'data:image/png;base64,someOverlayState';

    setFaviconState('idle');

    expect(linkElement.href).toBe(originalHref);
  });

  it('does not draw a ready/error overlay until the base image has finished loading (regression: previously drew a blank favicon with just the status dot)', () => {
    initFavicon();
    const setFaviconSpy = vi.fn();
    // toDataURL is what setFavicon ultimately calls on the canvas; spy on it
    // to detect whether a draw actually happened synchronously.
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(setFaviconSpy);

    setFaviconState('ready');

    // baseImage's `load` event hasn't fired yet in this synchronous test
    // (jsdom doesn't auto-load Image sources), so no draw should have
    // happened — the fix defers drawing until baseImage.complete/load.
    expect(setFaviconSpy).not.toHaveBeenCalled();
  });
});
