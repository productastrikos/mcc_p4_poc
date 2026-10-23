import React, { createContext, useContext, useState } from 'react';

/* Theme switching (ASTRIKOS-UI-THEME §5.7): data-theme lives on <body>,
   the choice persists, and dark is the default. public/index.html applies
   the same rule before first paint. */
const KEY = 'astrikos-theme';

export function applyTheme(mode /* 'dark' | 'light' */) {
  document.body.setAttribute('data-theme', mode);
  try { localStorage.setItem(KEY, mode); } catch {}
}

export function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch {}
  const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  applyTheme(saved || (prefersLight ? 'light' : 'dark'));
}

const ThemeContext = createContext({ theme: 'dark', toggleTheme: () => {} });

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => document.body.getAttribute('data-theme') || 'dark');

  // The attribute changes before the re-render, so charts read the new colours.
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setTheme(next);
  };

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
