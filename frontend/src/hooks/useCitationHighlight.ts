/**
 * @file useCitationHighlight.ts
 * @description Manages bidirectional highlight state between inline
 * citation markers and their corresponding source IndexCards.
 * State is scoped per assistant message via a shared ref/state.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { useState, useRef, useCallback, useEffect } from 'react';

export interface UseCitationHighlightReturn {
  /** Currently hovered/focused citation index (1-based), or null */
  activeCitation: number | null;
  /** Set the active citation on hover/focus of a citation marker */
  onCitationEnter: (index: number) => void;
  /** Set the active citation on hover/focus of an IndexCard */
  onCardEnter: (index: number) => void;
  /** Clear active citation on mouse leave / blur */
  onLeave: () => void;
  /** Scroll card N into view and pulse it */
  onCitationClick: (index: number) => void;
  /** Touch-specific: set active citation with auto-reset timer */
  onCardTouch: (index: number) => void;
  /** Ref map: attach to each IndexCard container by citation index */
  cardRefs: React.MutableRefObject<Map<number, HTMLElement | null>>;
}

/**
 * Provides bidirectional highlight state for citation ↔ card linking.
 * Designed to be used once per assistant message instance.
 * @returns Handlers and state for citation highlight coordination
 */
export function useCitationHighlight(): UseCitationHighlightReturn {
  const [activeCitation, setActiveCitation] = useState<number | null>(null);
  const cardRefs = useRef<Map<number, HTMLElement | null>>(new Map());
  const touchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any pending touch timer on unmount
  useEffect(() => {
    return () => {
      if (touchTimerRef.current) {
        clearTimeout(touchTimerRef.current);
      }
    };
  }, []);

  const onCitationEnter = useCallback((index: number) => {
    setActiveCitation(index);
  }, []);

  const onCardEnter = useCallback((index: number) => {
    setActiveCitation(index);
  }, []);

  const onLeave = useCallback(() => {
    setActiveCitation(null);
  }, []);

  const onCitationClick = useCallback((index: number) => {
    const el = cardRefs.current.get(index);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      // Trigger pulse animation via a temporary CSS class
      el.classList.add('card-pulse');
      setTimeout(() => {
        el.classList.remove('card-pulse');
      }, 800);
    }
  }, []);

  // Touch-specific handler for mobile: auto-reset after 2 seconds
  const onCardTouch = useCallback((index: number) => {
    // Clear any existing timer
    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
    }

    setActiveCitation(index);

    // Auto-reset after 2 seconds to simulate hover on touch devices
    touchTimerRef.current = setTimeout(() => {
      setActiveCitation(null);
      touchTimerRef.current = null;
    }, 2000);
  }, []);

  return {
    activeCitation,
    onCitationEnter,
    onCardEnter,
    onLeave,
    onCitationClick,
    onCardTouch,
    cardRefs,
  };
}
