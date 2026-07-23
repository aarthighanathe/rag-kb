/**
 * @file useMobileBreakpoint.test.ts
 * @description Unit tests for useIsMobile hook
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsMobile } from '../../hooks/useMobileBreakpoint';

describe('useIsMobile', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true when window.innerWidth <= 768', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(360);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('returns false when window.innerWidth > 768', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('returns true at exactly 768', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(768);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('updates when window is resized', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1024);
    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(false);

    act(() => {
      vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(600);
      window.dispatchEvent(new Event('resize'));
    });

    expect(result.current).toBe(true);
  });

  it('respects custom breakpoint', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(900);
    const { result } = renderHook(() => useIsMobile(900));
    expect(result.current).toBe(true);
  });

  it('cleans up resize listener on unmount', () => {
    const spy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useIsMobile());
    unmount();
    expect(spy).toHaveBeenCalledWith('resize', expect.any(Function));
  });
});
