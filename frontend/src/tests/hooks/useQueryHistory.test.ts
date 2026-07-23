/**
 * @file useQueryHistory.test.ts
 * @description Unit tests for useQueryHistory React hook
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useQueryHistory } from '../../hooks/useQueryHistory';

const makeEntry = (query: string) => ({
  query,
  timestamp: new Date().toISOString(),
  citationCount: 2,
  confidenceLevel: 'medium' as const,
});

describe('useQueryHistory', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with empty entries', () => {
    const { result } = renderHook(() => useQueryHistory());
    expect(result.current.entries).toEqual([]);
  });

  it('loads existing entries from localStorage', () => {
    localStorage.setItem('rag-kb:query-history', JSON.stringify([
      { id: 'existing', ...makeEntry('existing query') },
    ]));
    const { result } = renderHook(() => useQueryHistory());
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0]?.query).toBe('existing query');
  });

  it('add() appends entry and updates state', () => {
    const { result } = renderHook(() => useQueryHistory());
    act(() => { result.current.add(makeEntry('new query')); });
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0]?.query).toBe('new query');
  });

  it('remove() removes entry by id', () => {
    const { result } = renderHook(() => useQueryHistory());
    act(() => { result.current.add(makeEntry('keep')); });
    act(() => { result.current.add(makeEntry('remove')); });
    const id = result.current.entries[0]?.id ?? ''; // 'remove' is most recent
    act(() => { result.current.remove(id); });
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0]?.query).toBe('keep');
  });

  it('clear() removes all entries', () => {
    const { result } = renderHook(() => useQueryHistory());
    act(() => { result.current.add(makeEntry('a')); });
    act(() => { result.current.add(makeEntry('b')); });
    act(() => { result.current.clear(); });
    expect(result.current.entries).toEqual([]);
  });

  it('entries are sorted most-recent-first', () => {
    const { result } = renderHook(() => useQueryHistory());
    act(() => { result.current.add(makeEntry('first')); });
    act(() => { result.current.add(makeEntry('second')); });
    expect(result.current.entries[0]?.query).toBe('second');
    expect(result.current.entries[1]?.query).toBe('first');
  });

  it('persists to localStorage after add', () => {
    const { result } = renderHook(() => useQueryHistory());
    act(() => { result.current.add(makeEntry('persisted')); });
    const stored = JSON.parse(localStorage.getItem('rag-kb:query-history')!);
    expect(stored).toHaveLength(1);
    expect(stored[0].query).toBe('persisted');
  });

  it('reports storageAvailable correctly', () => {
    const { result } = renderHook(() => useQueryHistory());
    expect(result.current.storageAvailable).toBe(true);
  });
});
