/**
 * @file useMobileBreakpoint.ts
 * @description Detects whether the viewport is at or below a given
 *   breakpoint width (default 768px) with a resize listener.
 * @author [Author Placeholder]
 * @created 2026-07-01
 */

import { useState, useEffect } from 'react';

/**
 * Returns true when the viewport width is <= the breakpoint.
 * @param breakpoint - Width in pixels (default 768)
 * @returns Whether the viewport is mobile-sized
 */
export function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= breakpoint,
  );

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= breakpoint);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [breakpoint]);

  return isMobile;
}
