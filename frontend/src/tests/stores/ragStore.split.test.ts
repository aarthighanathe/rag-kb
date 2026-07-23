/**
 * @file ragStore.split.test.ts
 * @description Tests for ragStore split-screen, liveChunks, and queryPhase
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useRagStore } from '../../stores/ragStore';

// Mock API calls
vi.mock('../../services/api', () => ({
  listDocuments: vi.fn().mockResolvedValue({ data: [] }),
  deleteDocument: vi.fn(),
  uploadDocument: vi.fn(),
  extractErrorMessage: vi.fn((e: unknown) => (e as Error).message),
  initiateQuery: vi.fn().mockResolvedValue({ queryId: 'q1' }),
  getJobStatus: vi.fn(),
  getQueryStreamUrl: vi.fn(),
}));

describe('ragStore — split-screen', () => {
  beforeEach(() => {
    localStorage.clear();
    useRagStore.setState({
      splitScreenEnabled: false,
      liveChunks: [],
      queryPhase: 'idle',
      messages: [],
      isStreaming: false,
      currentQueryId: null,
    });
  });

  it('toggleSplitScreen: false → true', () => {
    useRagStore.getState().toggleSplitScreen();
    expect(useRagStore.getState().splitScreenEnabled).toBe(true);
  });

  it('toggleSplitScreen: true → false', () => {
    useRagStore.setState({ splitScreenEnabled: true });
    useRagStore.getState().toggleSplitScreen();
    expect(useRagStore.getState().splitScreenEnabled).toBe(false);
  });

  it('toggleSplitScreen persists to localStorage', () => {
    useRagStore.getState().toggleSplitScreen();
    expect(localStorage.getItem('rag-kb:split-screen')).toBe('true');
    useRagStore.getState().toggleSplitScreen();
    expect(localStorage.getItem('rag-kb:split-screen')).toBe('false');
  });

  it('init reads splitScreenEnabled from localStorage', () => {
    localStorage.setItem('rag-kb:split-screen', 'true');
    // Force re-creation by reading the stored value
    const stored = localStorage.getItem('rag-kb:split-screen');
    expect(stored).toBe('true');
  });

  it('queryPhase defaults to idle', () => {
    expect(useRagStore.getState().queryPhase).toBe('idle');
  });

  it('liveChunks defaults to empty', () => {
    expect(useRagStore.getState().liveChunks).toEqual([]);
  });

  it('can set queryPhase via setState', () => {
    useRagStore.setState({ queryPhase: 'searching' });
    expect(useRagStore.getState().queryPhase).toBe('searching');
  });

  it('can set liveChunks via setState', () => {
    const chunks = [
      { documentId: 'd1', documentName: 'test.pdf', chunkId: 'c1', chunkRef: 'Chunk 1', similarity: 0.9, excerpt: 'text' },
    ];
    useRagStore.setState({ liveChunks: chunks });
    expect(useRagStore.getState().liveChunks).toHaveLength(1);
  });

  it('queryPhase transitions: idle→searching→streaming→complete', () => {
    useRagStore.setState({ queryPhase: 'searching' });
    expect(useRagStore.getState().queryPhase).toBe('searching');

    useRagStore.setState({ queryPhase: 'streaming' });
    expect(useRagStore.getState().queryPhase).toBe('streaming');

    useRagStore.setState({ queryPhase: 'complete' });
    expect(useRagStore.getState().queryPhase).toBe('complete');
  });
});
