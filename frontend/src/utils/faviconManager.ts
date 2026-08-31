/**
 * @file faviconManager.ts
 * @description Canvas-based dynamic favicon manager. Generates a small colored
 *   circle on the favicon to indicate processing status.
 * @author [Author Placeholder]
 * @created 2026-07-01
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FaviconState = 'idle' | 'processing' | 'ready' | 'error';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let originalHref: string | null = null;
let baseImage: HTMLImageElement | null = null;
let animationFrame: number | null = null;
let pulsePhase = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATE_COLORS: Record<FaviconState, string> = {
  idle: '#B8B4AC',
  processing: '#D68910',
  ready: '#2D5A4A',
  error: '#FF4D2E',
};

const DOT_RADIUS = 4;
const CANVAS_SIZE = 32;

/**
 * Creates a 32x32 canvas favicon with a colored dot in the bottom-right corner.
 */
function generateFavicon(state: FaviconState, alpha = 1): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // Draw the base "R" icon from the existing favicon (preloaded once in initFavicon)
  if (baseImage?.complete) {
    try {
      ctx.drawImage(baseImage, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
    } catch {
      // fallback — blank canvas
    }
  }

  // Draw the status dot in bottom-right
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(CANVAS_SIZE - DOT_RADIUS - 1, CANVAS_SIZE - DOT_RADIUS - 1, DOT_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = STATE_COLORS[state];
  ctx.fill();

  return canvas;
}

/**
 * Sets the favicon link element's href to a data URL from the canvas.
 */
function setFavicon(canvas: HTMLCanvasElement): void {
  const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null;
  if (!link) return;
  link.href = canvas.toDataURL('image/png');
}

// ---------------------------------------------------------------------------
// Pulse animation
// ---------------------------------------------------------------------------

function pulseLoop(): void {
  pulsePhase = (pulsePhase + 0.05) % (Math.PI * 2);
  const alpha = 0.5 + 0.5 * Math.sin(pulsePhase);
  setFavicon(generateFavicon('processing', alpha));
  animationFrame = requestAnimationFrame(pulseLoop);
}

function startPulse(): void {
  if (animationFrame !== null) return;
  pulsePhase = 0;
  // Drawing before baseImage has loaded would animate a blank favicon with
  // only the pulsing dot, no book icon — wait for the same `load` event
  // drawStateFavicon relies on before starting the per-frame draw loop.
  if (baseImage && !baseImage.complete) {
    baseImage.addEventListener('load', pulseLoop, { once: true });
    return;
  }
  pulseLoop();
}

function stopPulse(): void {
  if (animationFrame !== null) {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initializes the favicon manager by caching the current favicon.
 * Call once on app mount.
 */
export function initFavicon(): void {
  const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null;
  if (link && !originalHref) {
    originalHref = link.href;
    baseImage = new Image();
    baseImage.src = originalHref;
  }
}

/**
 * Restores the favicon link's href to the original static asset it had
 * before any canvas-drawn state overlay was applied.
 */
function restoreOriginalFavicon(): void {
  const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null;
  if (link && originalHref) {
    link.href = originalHref;
  }
}

/**
 * Draws and applies a state-overlay favicon once the base image has finished
 * loading. If it's already loaded, draws immediately; otherwise waits for
 * its `load` event — drawing an incomplete image onto the canvas silently
 * produces a blank favicon with only the status dot, no book icon, which is
 * indistinguishable from a broken favicon in the browser tab.
 * @param state - Status to render as the overlay dot
 * @param alpha - Dot opacity, used by the processing pulse animation
 */
function drawStateFavicon(state: FaviconState, alpha = 1): void {
  if (baseImage && !baseImage.complete) {
    baseImage.addEventListener('load', () => setFavicon(generateFavicon(state, alpha)), {
      once: true,
    });
    return;
  }
  setFavicon(generateFavicon(state, alpha));
}

/**
 * Sets the favicon to reflect the given processing state.
 * - idle: no upload activity — restores the plain static favicon rather than
 *   redrawing a canvas copy of it, since there's nothing to signal
 * - processing: amber pulsing dot
 * - ready: green dot
 * - error: red dot
 */
export function setFaviconState(state: FaviconState): void {
  stopPulse();

  if (state === 'idle') {
    restoreOriginalFavicon();
  } else if (state === 'processing') {
    startPulse();
  } else {
    drawStateFavicon(state);
  }
}
