/**
 * @file useDocumentSimilarity.test.ts
 * @description Unit tests for useDocumentSimilarity — fetch success/error/loading state,
 *   the surfaceErrors toggle, out-of-order request guarding, and reset().
 * @author [Author Placeholder]
 * @created 2026-08-31
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useDocumentSimilarity } from '../../hooks/useDocumentSimilarity';
import type { SimilarityPair } from '../../services/api';

const getDocumentSimilarityMock = vi.fn();

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual<typeof import('../../services/api')>('../../services/api');
  return {
    ...actual,
    getDocumentSimilarity: (...args: unknown[]) => getDocumentSimilarityMock(...args),
  };
});

const samplePairs: SimilarityPair[] = [
  { documentA: 'doc-1', documentB: 'doc-2', similarity: 0.92 },
];

beforeEach(() => {
  getDocumentSimilarityMock.mockReset();
});

describe('useDocumentSimilarity — initial state', () => {
  it('starts with empty pairs, not loading, no error, not capped', () => {
    const { result } = renderHook(() => useDocumentSimilarity(true));

    expect(result.current.pairs).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.capped).toBe(false);
  });
});

describe('useDocumentSimilarity — successful fetch', () => {
  it('sets loading true while in flight, then populates pairs and capped on success', async () => {
    let resolveFetch: (v: { pairs: SimilarityPair[]; capped: boolean }) => void = () => {};
    getDocumentSimilarityMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const { result } = renderHook(() => useDocumentSimilarity(true));

    let fetchPromise!: Promise<void>;
    act(() => {
      fetchPromise = result.current.fetch(0.8);
    });
    expect(result.current.loading).toBe(true);

    resolveFetch({ pairs: samplePairs, capped: true });
    await act(async () => {
      await fetchPromise;
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.pairs).toEqual(samplePairs);
    expect(result.current.capped).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('calls getDocumentSimilarity with the given threshold', async () => {
    getDocumentSimilarityMock.mockResolvedValue({ pairs: [], capped: false });
    const { result } = renderHook(() => useDocumentSimilarity(true));

    await act(async () => {
      await result.current.fetch(0.65);
    });

    expect(getDocumentSimilarityMock).toHaveBeenCalledWith(0.65);
  });
});

describe('useDocumentSimilarity — error handling (surfaceErrors: true)', () => {
  it('sets error message on failure and clears loading', async () => {
    getDocumentSimilarityMock.mockRejectedValue(new Error('Network down'));
    const { result } = renderHook(() => useDocumentSimilarity(true));

    await act(async () => {
      await result.current.fetch(0.8);
    });

    expect(result.current.error).toBe('Network down');
    expect(result.current.loading).toBe(false);
  });

  it('falls back to a generic message for a non-Error rejection', async () => {
    getDocumentSimilarityMock.mockRejectedValue('some string rejection');
    const { result } = renderHook(() => useDocumentSimilarity(true));

    await act(async () => {
      await result.current.fetch(0.8);
    });

    expect(result.current.error).toBe('Failed to compute similarity');
  });

  it('clears a previous error at the start of a new fetch', async () => {
    getDocumentSimilarityMock.mockRejectedValueOnce(new Error('first failure'));
    const { result } = renderHook(() => useDocumentSimilarity(true));

    await act(async () => {
      await result.current.fetch(0.8);
    });
    expect(result.current.error).toBe('first failure');

    let resolveFetch: (v: { pairs: SimilarityPair[]; capped: boolean }) => void = () => {};
    getDocumentSimilarityMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    act(() => {
      void result.current.fetch(0.8);
    });

    expect(result.current.error).toBeNull();
    resolveFetch({ pairs: [], capped: false });
  });
});

describe('useDocumentSimilarity — surfaceErrors: false', () => {
  it('swallows the error — error stays null on failure', async () => {
    getDocumentSimilarityMock.mockRejectedValue(new Error('background check failed'));
    const { result } = renderHook(() => useDocumentSimilarity(false));

    await act(async () => {
      await result.current.fetch(0.9);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});

describe('useDocumentSimilarity — out-of-order request guarding', () => {
  it('discards a stale response when a newer fetch has already started', async () => {
    let resolveFirst: (v: { pairs: SimilarityPair[]; capped: boolean }) => void = () => {};
    let resolveSecond: (v: { pairs: SimilarityPair[]; capped: boolean }) => void = () => {};

    getDocumentSimilarityMock
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSecond = resolve;
        }),
      );

    const { result } = renderHook(() => useDocumentSimilarity(true));

    let firstPromise!: Promise<void>;
    let secondPromise!: Promise<void>;
    act(() => {
      firstPromise = result.current.fetch(0.5);
    });
    act(() => {
      secondPromise = result.current.fetch(0.9);
    });

    // Second (newer) call resolves first with its own pairs.
    const secondPairs: SimilarityPair[] = [
      { documentA: 'doc-a', documentB: 'doc-b', similarity: 0.99 },
    ];
    resolveSecond({ pairs: secondPairs, capped: false });
    await act(async () => {
      await secondPromise;
    });
    expect(result.current.pairs).toEqual(secondPairs);

    // Stale first call resolves after — must NOT overwrite the newer result.
    resolveFirst({ pairs: samplePairs, capped: true });
    await act(async () => {
      await firstPromise;
    });

    expect(result.current.pairs).toEqual(secondPairs);
    expect(result.current.capped).toBe(false);
  });
});

describe('useDocumentSimilarity — reset', () => {
  it('clears pairs, capped, and error back to initial state', async () => {
    getDocumentSimilarityMock.mockResolvedValue({ pairs: samplePairs, capped: true });
    const { result } = renderHook(() => useDocumentSimilarity(true));

    await act(async () => {
      await result.current.fetch(0.8);
    });
    expect(result.current.pairs).toEqual(samplePairs);

    act(() => {
      result.current.reset();
    });

    expect(result.current.pairs).toEqual([]);
    expect(result.current.capped).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('waitFor resolves once loading settles after reset is called mid-fetch', async () => {
    getDocumentSimilarityMock.mockResolvedValue({ pairs: samplePairs, capped: false });
    const { result } = renderHook(() => useDocumentSimilarity(true));

    act(() => {
      void result.current.fetch(0.8);
    });
    act(() => {
      result.current.reset();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
  });
});
