import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0a0f1e',
        surface: '#0f1730',
        raised: '#151f3d',
        line: '#222d52',
        fg: '#e8ecff',
        muted: '#9aa7cc',
        accent: '#5b8def',
        cyan: { 400: '#22d3ee' },
        violet: { 400: '#a78bfa' },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'Liberation Mono', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
