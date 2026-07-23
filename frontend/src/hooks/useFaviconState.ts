/**
 * @file useFaviconState.ts
 * @description React hook that observes upload queue status and drives the
 *   dynamic favicon state via faviconManager.
 * @author [Author Placeholder]
 * @created 2026-07-01
 */

import { useEffect } from 'react';
import { useRagStore } from '../stores/ragStore';
import { initFavicon, setFaviconState, type FaviconState } from '../utils/faviconManager';

/**
 * Observes upload queue status and updates the browser favicon accordingly.
 */
export function useFaviconState(): void {
  const uploadQueue = useRagStore((s) => s.uploadQueue);

  useEffect(() => {
    initFavicon();
  }, []);

  useEffect(() => {
    const hasProcessing = uploadQueue.some((u) => u.status === 'processing');
    const hasReady = uploadQueue.some((u) => u.status === 'ready');
    const hasFailed = uploadQueue.some((u) => u.status === 'failed');

    let state: FaviconState = 'idle';
    if (hasProcessing) state = 'processing';
    else if (hasFailed) state = 'error';
    else if (hasReady) state = 'ready';

    setFaviconState(state);
  }, [uploadQueue]);
}
