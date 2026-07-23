/**
 * @file useFaviconState.test.ts
 * @description Tests for the useFaviconState hook.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFaviconState } from '../../hooks/useFaviconState';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockInitFavicon = vi.fn();
const mockSetFaviconState = vi.fn();

vi.mock('../../utils/faviconManager', () => ({
  initFavicon: (...args: unknown[]) => mockInitFavicon(...args),
  setFaviconState: (...args: unknown[]) => mockSetFaviconState(...args),
}));

// Mock useRagStore
let mockUploadQueue: Array<{ status: string }> = [];
vi.mock('../../stores/ragStore', () => ({
  useRagStore: (selector: (s: { uploadQueue: typeof mockUploadQueue }) => unknown) => selector({ uploadQueue: mockUploadQueue }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useFaviconState', () => {
  beforeEach(() => {
    mockUploadQueue = [];
    vi.clearAllMocks();
  });

  it('calls initFavicon on mount', () => {
    renderHook(() => useFaviconState());
    expect(mockInitFavicon).toHaveBeenCalled();
  });

  it('sets idle state when no uploads', () => {
    mockUploadQueue = [];
    renderHook(() => useFaviconState());
    expect(mockSetFaviconState).toHaveBeenCalledWith('idle');
  });

  it('sets processing state when uploads are processing', () => {
    mockUploadQueue = [{ status: 'processing' }];
    renderHook(() => useFaviconState());
    expect(mockSetFaviconState).toHaveBeenCalledWith('processing');
  });

  it('sets ready state when uploads are ready', () => {
    mockUploadQueue = [{ status: 'ready' }];
    renderHook(() => useFaviconState());
    expect(mockSetFaviconState).toHaveBeenCalledWith('ready');
  });

  it('sets error state when uploads have failed', () => {
    mockUploadQueue = [{ status: 'failed' }];
    renderHook(() => useFaviconState());
    expect(mockSetFaviconState).toHaveBeenCalledWith('error');
  });

  it('prefers processing over ready', () => {
    mockUploadQueue = [{ status: 'ready' }, { status: 'processing' }];
    renderHook(() => useFaviconState());
    expect(mockSetFaviconState).toHaveBeenCalledWith('processing');
  });

  it('prefers error over ready', () => {
    mockUploadQueue = [{ status: 'ready' }, { status: 'failed' }];
    renderHook(() => useFaviconState());
    expect(mockSetFaviconState).toHaveBeenCalledWith('error');
  });
});
