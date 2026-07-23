/**
 * @file queryHistory.test.ts
 * @description Unit tests for localStorage-backed query history utilities
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isStorageAvailable,
  loadHistory,
  addToHistory,
  removeFromHistory,
  clearHistory,
} from '../../utils/queryHistory';

const STORAGE_KEY = 'rag-kb:query-history';

const makeEntry = (query: string, overrides?: Partial<{ citationCount: number; confidenceLevel: 'high' | 'medium' | 'low' | 'none' }>) => ({
  query,
  timestamp: new Date().toISOString(),
  citationCount: overrides?.citationCount ?? 3,
  confidenceLevel: overrides?.confidenceLevel ?? 'medium' as const,
});

describe('queryHistory', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('isStorageAvailable', () => {
    it('returns true when localStorage is accessible', () => {
      expect(isStorageAvailable()).toBe(true);
    });

    it('returns false when localStorage throws', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
      expect(isStorageAvailable()).toBe(false);
    });
  });

  describe('loadHistory', () => {
    it('returns empty array when no stored data', () => {
      expect(loadHistory()).toEqual([]);
    });

    it('returns parsed entries from localStorage', () => {
      const entries = [{ id: '1', ...makeEntry('test query') }];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
      expect(loadHistory()).toHaveLength(1);
      expect(loadHistory()[0]?.query).toBe('test query');
    });

    it('clears corrupt data and returns empty array', () => {
      localStorage.setItem(STORAGE_KEY, 'NOT VALID JSON');
      const result = loadHistory();
      expect(result).toEqual([]);
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('clears non-array data and returns empty array', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ not: 'array' }));
      expect(loadHistory()).toEqual([]);
    });
  });

  describe('addToHistory', () => {
    it('adds entry to empty history', () => {
      addToHistory(makeEntry('what is RAG?'));
      const result = loadHistory();
      expect(result).toHaveLength(1);
      expect(result[0]?.query).toBe('what is RAG?');
      expect(result[0]?.id).toBeDefined();
    });

    it('deduplicates by query text (case-insensitive)', () => {
      addToHistory(makeEntry('hello'));
      addToHistory(makeEntry('HELLO'));
      addToHistory(makeEntry('Hello'));
      expect(loadHistory()).toHaveLength(1);
    });

    it('moves duplicate to top with updated metadata', () => {
      addToHistory(makeEntry('query', { citationCount: 1 }));
      addToHistory(makeEntry('other', { citationCount: 5 }));
      addToHistory(makeEntry('query', { citationCount: 3 }));

      const result = loadHistory();
      expect(result).toHaveLength(2);
      expect(result[0]?.query).toBe('query');
      expect(result[0]?.citationCount).toBe(3);
    });

    it('caps entries at 10', () => {
      for (let i = 0; i < 15; i++) {
        addToHistory(makeEntry(`query ${i}`));
      }
      expect(loadHistory()).toHaveLength(10);
      // Most recent (14) should be first
      expect(loadHistory()[0]?.query).toBe('query 14');
    });
  });

  describe('removeFromHistory', () => {
    it('removes entry by id', () => {
      addToHistory(makeEntry('keep'));
      addToHistory(makeEntry('remove'));
      const entries = loadHistory();
      const toRemove = entries.find((e) => e.query === 'remove')!;
      removeFromHistory(toRemove.id);
      const result = loadHistory();
      expect(result).toHaveLength(1);
      expect(result[0]?.query).toBe('keep');
    });
  });

  describe('clearHistory', () => {
    it('clears all entries', () => {
      addToHistory(makeEntry('a'));
      addToHistory(makeEntry('b'));
      clearHistory();
      expect(loadHistory()).toEqual([]);
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
  });
});
