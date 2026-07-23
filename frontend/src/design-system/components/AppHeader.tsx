/**
 * @file AppHeader.tsx
 * @description Shared horizontal header for interior app routes (Upload / Chat / Documents).
 *   Dark ink.base (#1C1B19) bar, 50px tall. Left: BookOpen icon + "RAG KB" wordmark.
 *   Vertical divider. Three tab links — inactive: ink.muted, active: stamp.red + 2px bottom bar.
 *   Mobile (<640px): icon-only with aria-label.
 * @updated 2026-06-23
 */

import React, { useRef, useCallback } from 'react';
import { NavLink } from 'react-router-dom';
import { UserButton } from '@clerk/clerk-react';
import { BookOpen, Upload, MessageSquare, FolderOpen } from 'lucide-react';

interface TabDef {
  to: string;
  label: string;
  icon: React.ReactNode;
  ariaLabel: string;
}

const TABS: TabDef[] = [
  { to: '/upload',    label: 'Upload',    ariaLabel: 'Upload',    icon: <Upload        size={14} aria-hidden="true" /> },
  { to: '/chat',      label: 'Chat',      ariaLabel: 'Chat',      icon: <MessageSquare size={14} aria-hidden="true" /> },
  { to: '/documents', label: 'Documents', ariaLabel: 'Documents', icon: <FolderOpen    size={14} aria-hidden="true" /> },
];

/**
 * Shared horizontal header for all interior routes.
 * Active tab has 2px stamp-red bottom border + aria-current="page".
 * Supports arrow-key navigation within the tab strip.
 */
export function AppHeader(): React.JSX.Element {
  const tabListRef = useRef<HTMLElement>(null);

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLAnchorElement>, index: number) => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();

      const tabs = Array.from(
        tabListRef.current?.querySelectorAll<HTMLAnchorElement>('[role="tab"]') ?? [],
      );
      if (tabs.length === 0) return;

      let next = index;
      if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (e.key === 'ArrowLeft')  next = (index - 1 + tabs.length) % tabs.length;
      if (e.key === 'Home')       next = 0;
      if (e.key === 'End')        next = tabs.length - 1;

      tabs[next]?.focus();
    },
    [],
  );

  return (
    <header
      style={{ height: '50px', background: '#1C1B19', flexShrink: 0 }}
      className="w-full flex items-stretch z-ds-sticky"
      aria-label="Application navigation"
    >
      {/* ── Logo ─────────────────────────────────────────────────────────── */}
      {/* Links straight to /upload, not '/' — AppHeader only mounts on interior
          routes, so the user is always signed in here, and '/' would just
          redirect straight back to /upload anyway (see Landing.tsx). Linking
          directly avoids a round-trip that's a visible no-op when already on
          /upload — clicking the logo there would otherwise appear to do nothing. */}
      <NavLink
        to="/upload"
        aria-label="RAG KB — go to Upload"
        className="flex items-center gap-2 px-4 sm:px-5 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset"
        style={{ focusVisibleOutlineColor: '#FF4D2E' } as React.CSSProperties}
      >
        <BookOpen size={18} aria-hidden="true" style={{ color: '#FCFBF8' }} />
        <span
          className="font-display font-black"
          style={{
            fontSize: '20px',
            color: '#F7F5F0',
            fontVariationSettings: "'opsz' 10",
            letterSpacing: '-0.01em',
          }}
        >
          {/* Shorten to 'KB' on narrow mobile, full name on sm+ */}
          <span className="hidden sm:inline">RAG KB</span>
          <span className="inline sm:hidden">KB</span>
        </span>
      </NavLink>

      {/* Vertical divider — desktop only */}
      <div
        className="hidden sm:block self-stretch my-3 shrink-0"
        style={{ width: '1px', background: '#2C2B29' }}
        aria-hidden="true"
      />

      {/* ── Tab strip ─────────────────────────────────────────────────────── */}
      <nav
        ref={tabListRef}
        role="tablist"
        aria-label="Main sections"
        className="flex items-stretch flex-1 sm:flex-none overflow-x-auto"
        style={{ scrollbarWidth: 'none' }}
      >
        {TABS.map((tab, idx) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            role="tab"
            aria-label={tab.ariaLabel}
            onKeyDown={(e) => handleTabKeyDown(e, idx)}
            className={({ isActive }) =>
              [
                'relative flex items-center justify-center md:justify-start gap-1.5',
                'flex-1 md:flex-none px-0 md:px-[22px]',
                'font-body whitespace-nowrap select-none',
                'transition-colors min-w-[48px]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ds-stamp',
                isActive
                  ? 'font-bold'
                  : '',
              ].join(' ')
            }
            style={({ isActive }) => ({
              fontSize: '13px',
              color: isActive ? '#FF4D2E' : '#8A8578',
              height: '50px',
            })}
          >
            {({ isActive }: { isActive: boolean }) => (
              <>
                {/* aria-current must live on the element with role="tab" — we use a data attr approach
                    by adding it via the wrapper. NavLink v6 sets aria-current automatically. */}
                <span style={{ color: isActive ? '#FF4D2E' : '#8A8578' }}>
                  {tab.icon}
                </span>
                {/* Hide label text on mobile (≤768px), show on md+ */}
                <span className="hidden md:inline">{tab.label}</span>

                {/* Active underline bar */}
                {isActive && (
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      height: '2px',
                      background: '#FF4D2E',
                    }}
                  />
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* ── User menu ─────────────────────────────────────────────────────── */}
      <div
        className="flex items-center shrink-0 px-3 sm:px-4"
        style={{ borderLeft: '1px solid #2C2B29' }}
      >
        <UserButton
          afterSignOutUrl="/"
          appearance={{
            variables: {
              colorPrimary: '#FF4D2E',
              borderRadius: '2px',
            },
            elements: {
              avatarBox: { width: '30px', height: '30px' },
            },
          }}
        />
      </div>
    </header>
  );
}
