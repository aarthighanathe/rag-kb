/**
 * @file useCitationHighlight.test.ts
 * @description Unit tests for the useCitationHighlight hook.
 *   Tests bidirectional highlight state between citation markers and IndexCards.
 * @author [Author Placeholder]
 * @created 2026-07-01
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCitationHighlight } from '../../hooks/useCitationHighlight';

describe('useCitationHighlight', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --------------------------------------------------------------------------
  // Initial state
  // --------------------------------------------------------------------------

  it('initializes with activeCitation as null', () => {
    const { result } = renderHook(() => useCitationHighlight());
    expect(result.current.activeCitation).toBeNull();
  });

  it('initializes cardRefs as a Map', () => {
    const { result } = renderHook(() => useCitationHighlight());
    expect(result.current.cardRefs.current).toBeInstanceOf(Map);
  });

  // --------------------------------------------------------------------------
  // onCitationEnter
  // --------------------------------------------------------------------------

  it('onCitationEnter(2) sets activeCitation to 2', () => {
    const { result } = renderHook(() => useCitationHighlight());
    act(() => {
      result.current.onCitationEnter(2);
    });
    expect(result.current.activeCitation).toBe(2);
  });

  it('onCitationEnter updates to new value when called again', () => {
    const { result } = renderHook(() => useCitationHighlight());
    act(() => {
      result.current.onCitationEnter(1);
    });
    expect(result.current.activeCitation).toBe(1);
    act(() => {
      result.current.onCitationEnter(3);
    });
    expect(result.current.activeCitation).toBe(3);
  });

  // --------------------------------------------------------------------------
  // onCardEnter
  // --------------------------------------------------------------------------

  it('onCardEnter(1) sets activeCitation to 1', () => {
    const { result } = renderHook(() => useCitationHighlight());
    act(() => {
      result.current.onCardEnter(1);
    });
    expect(result.current.activeCitation).toBe(1);
  });

  it('onCardEnter can override citation enter', () => {
    const { result } = renderHook(() => useCitationHighlight());
    act(() => {
      result.current.onCitationEnter(2);
    });
    expect(result.current.activeCitation).toBe(2);
    act(() => {
      result.current.onCardEnter(5);
    });
    expect(result.current.activeCitation).toBe(5);
  });

  // --------------------------------------------------------------------------
  // onLeave
  // --------------------------------------------------------------------------

  it('onLeave() sets activeCitation to null', () => {
    const { result } = renderHook(() => useCitationHighlight());
    act(() => {
      result.current.onCitationEnter(2);
    });
    expect(result.current.activeCitation).toBe(2);
    act(() => {
      result.current.onLeave();
    });
    expect(result.current.activeCitation).toBeNull();
  });

  it('onLeave works when activeCitation is already null', () => {
    const { result } = renderHook(() => useCitationHighlight());
    act(() => {
      result.current.onLeave();
    });
    expect(result.current.activeCitation).toBeNull();
  });

  // --------------------------------------------------------------------------
  // onCitationClick
  // --------------------------------------------------------------------------

  it('onCitationClick(1) calls scrollIntoView on card 1 element', () => {
    const { result } = renderHook(() => useCitationHighlight());
    const mockEl = {
      scrollIntoView: vi.fn(),
      classList: { add: vi.fn(), remove: vi.fn() },
    };
    result.current.cardRefs.current.set(1, mockEl as unknown as HTMLElement);

    act(() => {
      result.current.onCitationClick(1);
    });

    expect(mockEl.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'nearest',
    });
  });

  it('onCitationClick(1) adds card-pulse class and removes after 800ms', () => {
    const { result } = renderHook(() => useCitationHighlight());
    const mockEl = {
      scrollIntoView: vi.fn(),
      classList: { add: vi.fn(), remove: vi.fn() },
    };
    result.current.cardRefs.current.set(1, mockEl as unknown as HTMLElement);

    act(() => {
      result.current.onCitationClick(1);
    });

    expect(mockEl.classList.add).toHaveBeenCalledWith('card-pulse');

    act(() => {
      vi.advanceTimersByTime(800);
    });

    expect(mockEl.classList.remove).toHaveBeenCalledWith('card-pulse');
  });

  it('onCitationClick does nothing when card element is not found', () => {
    const { result } = renderHook(() => useCitationHighlight());
    // No card registered for index 99
    expect(() => {
      act(() => {
        result.current.onCitationClick(99);
      });
    }).not.toThrow();
  });

  // --------------------------------------------------------------------------
  // cardRefs registration
  // --------------------------------------------------------------------------

  it('cardRef callback registers element in cardRefs map', () => {
    const { result } = renderHook(() => useCitationHighlight());
    const mockEl = document.createElement('div');
    
    act(() => {
      result.current.cardRefs.current.set(1, mockEl);
    });

    expect(result.current.cardRefs.current.get(1)).toBe(mockEl);
  });

  it('multiple cards can be registered', () => {
    const { result } = renderHook(() => useCitationHighlight());
    const el1 = document.createElement('div');
    const el2 = document.createElement('div');
    const el3 = document.createElement('div');

    act(() => {
      result.current.cardRefs.current.set(1, el1);
      result.current.cardRefs.current.set(2, el2);
      result.current.cardRefs.current.set(3, el3);
    });

    expect(result.current.cardRefs.current.size).toBe(3);
    expect(result.current.cardRefs.current.get(1)).toBe(el1);
    expect(result.current.cardRefs.current.get(2)).toBe(el2);
    expect(result.current.cardRefs.current.get(3)).toBe(el3);
  });

  // --------------------------------------------------------------------------
  // onCardTouch (mobile)
  // --------------------------------------------------------------------------

  it('onCardTouch(1) sets activeCitation to 1', () => {
    const { result } = renderHook(() => useCitationHighlight());
    act(() => {
      result.current.onCardTouch(1);
    });
    expect(result.current.activeCitation).toBe(1);
  });

  it('onCardTouch auto-resets activeCitation after 2 seconds', () => {
    const { result } = renderHook(() => useCitationHighlight());
    act(() => {
      result.current.onCardTouch(1);
    });
    expect(result.current.activeCitation).toBe(1);

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.activeCitation).toBeNull();
  });

  it('onCardTouch resets timer when called again before timeout', () => {
    const { result } = renderHook(() => useCitationHighlight());
    
    act(() => {
      result.current.onCardTouch(1);
    });
    expect(result.current.activeCitation).toBe(1);

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    // Still active because timer was not reached
    expect(result.current.activeCitation).toBe(1);

    act(() => {
      result.current.onCardTouch(2);
    });
    expect(result.current.activeCitation).toBe(2);

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.activeCitation).toBeNull();
  });

  // --------------------------------------------------------------------------
  // Cleanup on unmount
  // --------------------------------------------------------------------------

  it('clears touch timer on unmount', () => {
    const { result, unmount } = renderHook(() => useCitationHighlight());
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    act(() => {
      result.current.onCardTouch(1);
    });

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});
