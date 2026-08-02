import { useState, useEffect, useCallback } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'app_theme';

function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}

function applyTheme(theme: 'light' | 'dark') {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

/** Call once at startup (before React renders) to prevent flash of wrong theme. */
export function initTheme() {
  const stored = (localStorage.getItem(STORAGE_KEY) as ThemeMode | null) ?? 'system';
  applyTheme(resolveTheme(stored));
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(() => {
    return (localStorage.getItem(STORAGE_KEY) as ThemeMode | null) ?? 'system';
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode);
    applyTheme(resolveTheme(mode));
  }, [mode]);

  // Follow OS changes when in "system" mode.
  useEffect(() => {
    if (mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme(resolveTheme('system'));
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [mode]);

  const cycleTheme = useCallback(() => {
    setMode((prev) => (prev === 'light' ? 'dark' : prev === 'dark' ? 'system' : 'light'));
  }, []);

  return { mode, setMode, cycleTheme };
}
