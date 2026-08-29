'use client';

import { MoonStars, Sun } from '@phosphor-icons/react';

/**
 * Theme system: light is the product default; dark mode is opt-in via the
 * toggle and persists in localStorage. `data-theme` on <html> drives the
 * CSS-variable palette in globals.css.
 */

const THEME_KEY = 'yhb_theme';

/** Inline parser-blocking script — applies the stored theme before first paint (no flash). */
export function ThemeScript() {
  const code = `(function(){try{document.documentElement.dataset.theme=localStorage.getItem('${THEME_KEY}')==='dark'?'dark':'light';}catch(e){document.documentElement.dataset.theme='light';}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}

/**
 * Sun/moon theme switch. Stateless: the visible icon is chosen by the
 * `when-dark`/`when-light` rules in globals.css, so SSR and hydration never
 * disagree about the stored theme.
 */
export function ThemeToggle({ floating = false }: { floating?: boolean }) {
  function toggle() {
    const root = document.documentElement;
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage unavailable (private mode) — the choice just won't persist.
    }
  }

  return (
    <button
      onClick={toggle}
      aria-label="Toggle light or dark theme"
      title="Toggle theme"
      className={`rounded-lg p-2 text-ink-2 transition hover:bg-surface-2 hover:text-ink ${
        floating ? 'fixed right-4 top-4 z-30' : ''
      }`}
    >
      {/* Sun — visible in dark mode; clicking switches to light. */}
      <Sun className="when-dark" size={18} weight="regular" />
      {/* Moon — visible in light mode; clicking switches to dark. */}
      <MoonStars className="when-light" size={18} weight="regular" />
    </button>
  );
}
