import type { Config } from 'tailwindcss';
import preset from '@yohobed/ui/tailwind-preset';

const config: Config = {
  presets: [preset as Config],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    // The design system ships as source, so its classes must be scanned from here or they are
    // tree-shaken out of the stylesheet and every @yohobed/ui component renders unstyled.
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
};

export default config;
