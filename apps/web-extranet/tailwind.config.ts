import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: 'var(--brand)',
        'brand-ink': 'var(--brand-ink)',
        teal: 'var(--teal)',
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        ink: 'var(--ink)',
        'ink-2': 'var(--ink-2)',
        'ink-3': 'var(--ink-3)',
        line: 'var(--line)',
        'line-strong': 'var(--line-strong)',
        avail: 'var(--avail)',
        'avail-ink': 'var(--avail-ink)',
        low: 'var(--low)',
        'low-ink': 'var(--low-ink)',
        closed: 'var(--closed)',
        'closed-ink': 'var(--closed-ink)',
        info: 'var(--info)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        xl: '12px',
      },
    },
  },
  plugins: [],
};

export default config;
