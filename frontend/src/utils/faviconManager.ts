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
  idle:     '#B8B4AC',
  processing: '#D68910',
  ready:    '#2D5A4A',
  error:    '#FF4D2E',
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
 * Sets the favicon to reflect the given processing state.
 * - idle: muted gray dot
 * - processing: amber pulsing dot
 * - ready: green dot
 * - error: red dot
 */
export function setFaviconState(state: FaviconState): void {
  stopPulse();

  if (state === 'processing') {
    startPulse();
  } else {
    setFavicon(generateFavicon(state));
  }
}

/**
 * Resets the favicon to its original state (no dot).
 */
export function resetFavicon(): void {
  stopPulse();
  const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null;
  if (link && originalHref) {
    link.href = originalHref;
  }
}
