import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * The YoHoBed Tailwind preset. Every consuming app layers this on top of its
 * own `content` globs; all values resolve to the CSS custom properties defined
 * in the app's globals.css, so both themes come along for free.
 */
const preset: Omit<Config, 'content'> = {
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        ink: 'var(--ink)',
        'ink-2': 'var(--ink-2)',
        'ink-3': 'var(--ink-3)',
        line: 'var(--line)',
        'line-strong': 'var(--line-strong)',
        brand: 'var(--brand)',
        'brand-ink': 'var(--brand-ink)',
        'brand-soft': 'var(--brand-soft)',
        brass: 'var(--brass)',
        'brass-ink': 'var(--brass-ink)',
        'brass-soft': 'var(--brass-soft)',
        avail: 'var(--avail)',
        'avail-ink': 'var(--avail-ink)',
        'avail-soft': 'var(--avail-soft)',
        low: 'var(--low)',
        'low-ink': 'var(--low-ink)',
        'low-soft': 'var(--low-soft)',
        closed: 'var(--closed)',
        'closed-ink': 'var(--closed-ink)',
        'closed-soft': 'var(--closed-soft)',
        info: 'var(--info)',
        'info-ink': 'var(--info-ink)',
        'info-soft': 'var(--info-soft)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'IBM Plex Sans', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'IBM Plex Mono', 'Cascadia Code', 'Consolas', 'monospace'],
      },
      borderRadius: {
        lg: 'var(--radius-control)',
        xl: 'var(--radius-surface)',
        '2xl': 'var(--radius-overlay)',
      },
      boxShadow: {
        card: 'var(--shadow-1)',
        raised: 'var(--shadow-2)',
        overlay: 'var(--shadow-3)',
      },
      transitionTimingFunction: {
        smooth: 'var(--ease-smooth)',
        spring: 'var(--ease-spring)',
      },
      transitionDuration: {
        '1': 'var(--dur-1)',
        '2': 'var(--dur-2)',
        '3': 'var(--dur-3)',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'slide-up-fade': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.97)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.6s linear infinite',
        'slide-up-fade': 'slide-up-fade var(--dur-2) var(--ease-smooth)',
        'scale-in': 'scale-in var(--dur-2) var(--ease-smooth)',
      },
    },
  },
  plugins: [animate],
};

export default preset;
