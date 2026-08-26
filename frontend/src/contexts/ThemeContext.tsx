/**
 * @file ThemeContext.tsx
 * @description Theme context for managing dark/light mode with automatic detection
 * @author [Author Placeholder]
 * @created 2026-08-23
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  mode: ThemeMode;
  resolvedTheme: 'light' | 'dark';
  setMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const THEME_STORAGE_KEY = 'lumina-theme-mode';

/**
 * Detects system theme preference using matchMedia
 * @returns 'dark' if system prefers dark mode, 'light' otherwise
 */
function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Resolves the effective theme based on mode and system preference
 * @param mode - User's theme preference
 * @returns Resolved theme ('light' or 'dark')
 */
function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') return getSystemTheme();
  return mode;
}

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultMode?: ThemeMode;
}

export function ThemeProvider({
  children,
  defaultMode = 'system',
}: ThemeProviderProps): React.JSX.Element {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return defaultMode;
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored as ThemeMode;
    }
    return defaultMode;
  });

  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() => resolveTheme(mode));

  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode);
    localStorage.setItem(THEME_STORAGE_KEY, newMode);
  }, []);

  const toggleTheme = useCallback(() => {
    if (mode === 'light') {
      setMode('dark');
    } else if (mode === 'dark') {
      setMode('light');
    } else {
      // If in system mode, toggle to the opposite of current system preference
      const system = getSystemTheme();
      setMode(system === 'light' ? 'dark' : 'light');
    }
  }, [mode]);

  // Update resolved theme when mode or system preference changes
  useEffect(() => {
    const newResolvedTheme = resolveTheme(mode);
    setResolvedTheme(newResolvedTheme);

    // Apply theme to document root
    const root = document.documentElement;
    root.setAttribute('data-theme', newResolvedTheme);

    // Listen for system theme changes when in system mode
    if (mode === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = () => {
        setResolvedTheme(mediaQuery.matches ? 'dark' : 'light');
        root.setAttribute('data-theme', mediaQuery.matches ? 'dark' : 'light');
      };

      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [mode]);

  return (
    <ThemeContext.Provider value={{ mode, resolvedTheme, setMode, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * Hook to access theme context
 * @throws Error if used outside ThemeProvider
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
