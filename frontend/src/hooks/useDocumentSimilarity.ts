/**
 * @file useDocumentSimilarity.ts
 * @description React hook wrapping getDocumentSimilarity with cancellation-safe
 *   fetch/loading/error state, shared by the relation map and near-duplicate
 *   detection on the Documents page (same endpoint, different thresholds).
 * @author [Author Placeholder]
 * @created 2026-08-25
 */

import { useCallback, useRef, useState } from 'react';
import { getDocumentSimilarity, type SimilarityPair } from '../services/api';

export interface UseDocumentSimilarityReturn {
  /** Pairs returned by the last successful fetch. */
  pairs: SimilarityPair[];
  /** Whether a fetch is currently in flight. */
  loading: boolean;
  /** Error message from the last failed fetch, or null. Never set when `surfaceErrors` is false. */
  error: string | null;
  /** Whether the last successful fetch reported the result set was capped. */
  capped: boolean;
  /**
   * Runs the fetch for the given threshold. Resolves once state has been
   * updated (or the fetch was superseded by a newer call/cleanup).
   */
  fetch: (threshold: number) => Promise<void>;
  /** Clears pairs/capped/error back to their initial empty state. */
  reset: () => void;
}

/**
 * Fetches pairwise document similarity at a given threshold, guarding
 * against out-of-order updates from overlapping calls (a stale in-flight
 * fetch's result is discarded if a newer call has since started).
 * @param surfaceErrors - When false, fetch failures are swallowed rather than
 *   populating `error` — for background/non-critical checks that shouldn't
 *   surface an error banner (e.g. near-duplicate detection).
 * @returns Similarity state and a function to trigger a fetch
 */
export function useDocumentSimilarity(surfaceErrors: boolean): UseDocumentSimilarityReturn {
  const [pairs, setPairs] = useState<SimilarityPair[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capped, setCapped] = useState(false);

  // Guards against an older, slower fetch resolving after a newer one has
  // already started and applying its (stale) result on top.
  const requestIdRef = useRef(0);

  const fetchPairs = useCallback(
    async (threshold: number): Promise<void> => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      if (surfaceErrors) setError(null);
      try {
        const { pairs: result, capped: wasCapped } = await getDocumentSimilarity(threshold);
        if (requestIdRef.current !== requestId) return;
        setPairs(result);
        setCapped(wasCapped);
      } catch (err) {
        if (requestIdRef.current !== requestId) return;
        if (surfaceErrors) {
          const msg = err instanceof Error ? err.message : 'Failed to compute similarity';
          setError(msg);
        }
      } finally {
        if (requestIdRef.current === requestId) setLoading(false);
      }
    },
    [surfaceErrors],
  );

  const reset = useCallback(() => {
    setPairs([]);
    setCapped(false);
    setError(null);
  }, []);

  return { pairs, loading, error, capped, fetch: fetchPairs, reset };
}
