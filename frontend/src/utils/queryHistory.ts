/**
 * @file queryHistory.ts
 * @description Manages persistent query history in localStorage.
 *   Stores last 10 unique queries with metadata for re-run display.
 * @author [Author Placeholder]
 * @created 2026-07-01
 */

import type { ConfidenceLevel } from './calculateConfidence';

export interface HistoryEntry {
  /** Unique ID for this entry */
  id: string;
  /** The query text */
  query: string;
  /** ISO timestamp when query was made */
  timestamp: string;
  /** Number of citations returned (0 if unknown) */
  citationCount: number;
  /** Confidence level from the answer */
  confidenceLevel: ConfidenceLevel | 'none';
}

const STORAGE_KEY = 'rag-kb:query-history';
const MAX_ENTRIES = 10;

/**
 * Checks if localStorage is available and writable.
 * @returns true if available, false if blocked (private browsing etc.)
 */
export function isStorageAvailable(): boolean {
  try {
    const testKey = '__storage_test__';
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Loads query history from localStorage.
 * Returns empty array if storage is unavailable or data is corrupt.
 * @returns Array of HistoryEntry, most recent first
 */
export function loadHistory(): HistoryEntry[] {
  if (!isStorageAvailable()) return [];

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      localStorage.removeItem(STORAGE_KEY);
      return [];
    }

    // Validate shape of each entry
    const valid = parsed.every(
      (entry): entry is HistoryEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as Record<string, unknown>).id === 'string' &&
        typeof (entry as Record<string, unknown>).query === 'string' &&
        typeof (entry as Record<string, unknown>).timestamp === 'string' &&
        typeof (entry as Record<string, unknown>).citationCount === 'number' &&
        typeof (entry as Record<string, unknown>).confidenceLevel === 'string',
    );

    if (!valid) {
      localStorage.removeItem(STORAGE_KEY);
      return [];
    }

    return parsed as HistoryEntry[];
  } catch {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Swallow cleanup error
    }
    return [];
  }
}

/**
 * Adds a new query to history. Deduplicates by query text —
 * if the same query exists, moves it to the top with updated
 * timestamp and metadata. Trims to MAX_ENTRIES.
 * @param entry - New history entry to add (without id — generated internally)
 */
export function addToHistory(entry: Omit<HistoryEntry, 'id'>): void {
  if (!isStorageAvailable()) return;

  try {
    const existing = loadHistory();
    const trimmedQuery = entry.query.trim().toLowerCase();

    // Remove any existing entry with the same query (case-insensitive)
    const filtered = existing.filter(
      (e) => e.query.trim().toLowerCase() !== trimmedQuery,
    );

    // Create new entry with generated ID
    const newEntry: HistoryEntry = {
      ...entry,
      id: crypto.randomUUID(),
    };

    // Prepend (most recent first) and trim to max
    const updated = [newEntry, ...filtered].slice(0, MAX_ENTRIES);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Storage write failed — silently ignore
  }
}

/**
 * Removes a single entry from history by ID.
 * @param id - Entry ID to remove
 */
export function removeFromHistory(id: string): void {
  if (!isStorageAvailable()) return;

  try {
    const existing = loadHistory();
    const updated = existing.filter((e) => e.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Storage write failed — silently ignore
  }
}

/**
 * Clears all query history from localStorage.
 */
export function clearHistory(): void {
  if (!isStorageAvailable()) return;

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage write failed — silently ignore
  }
}
