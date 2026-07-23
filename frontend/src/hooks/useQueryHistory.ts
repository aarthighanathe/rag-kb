/**
 * @file useQueryHistory.ts
 * @description React hook wrapping queryHistory localStorage
 *   utilities with reactive state for UI updates.
 * @author [Author Placeholder]
 * @created 2026-07-01
 */

import { useState, useCallback } from 'react';
import {
  loadHistory,
  addToHistory as storeAdd,
  removeFromHistory as storeRemove,
  clearHistory as storeClear,
  isStorageAvailable,
  type HistoryEntry,
} from '../utils/queryHistory';

export interface UseQueryHistoryReturn {
  /** Current history entries, most recent first */
  entries: HistoryEntry[];
  /** Add a completed query to history */
  add: (entry: Omit<HistoryEntry, 'id'>) => void;
  /** Remove one entry by ID */
  remove: (id: string) => void;
  /** Clear all history */
  clear: () => void;
  /** Whether localStorage is available */
  storageAvailable: boolean;
}

/**
 * Manages query history with localStorage persistence and
 * reactive React state. State updates immediately on any change.
 * @returns History entries and mutation functions
 */
export function useQueryHistory(): UseQueryHistoryReturn {
  const [entries, setEntries] = useState<HistoryEntry[]>(() => loadHistory());

  const add = useCallback((entry: Omit<HistoryEntry, 'id'>) => {
    storeAdd(entry);
    setEntries(loadHistory());
  }, []);

  const remove = useCallback((id: string) => {
    storeRemove(id);
    setEntries(loadHistory());
  }, []);

  const clear = useCallback(() => {
    storeClear();
    setEntries([]);
  }, []);

  return {
    entries,
    add,
    remove,
    clear,
    storageAvailable: isStorageAvailable(),
  };
}
