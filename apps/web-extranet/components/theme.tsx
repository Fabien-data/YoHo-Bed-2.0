'use client';

/**
 * Theme system: dark is the product default; light mode is opt-in via the
 * toggle and persists in localStorage. `data-theme` on <html> drives the
 * CSS-variable palette in globals.css.
 */

const THEME_KEY = 'yhb_theme';

/** Inline parser-blocking script — applies the stored theme before first paint (no flash). */
export function ThemeScript() {
  const code = `(function(){try{document.documentElement.dataset.theme=localStorage.getItem('${THEME_KEY}')==='light'?'light':'dark';}catch(e){document.documentElement.dataset.theme='dark';}})();`;
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
    const next = root.dataset.theme === 'light' ? 'dark' : 'light';
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
      className={`rounded-lg p-2 text-ink-2 transition hover:bg-[var(--surface-2)] hover:text-ink ${
        floating ? 'fixed right-4 top-4 z-30' : ''
      }`}
    >
      {/* Sun — visible in dark mode; clicking switches to light. */}
      <svg
        className="when-dark"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
      {/* Moon — visible in light mode; clicking switches to dark. */}
      <svg
        className="when-light"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79" />
      </svg>
    </button>
  );
}
