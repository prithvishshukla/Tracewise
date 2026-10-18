import type { Config } from 'tailwindcss';
import { colors as designColors } from './src/lib/design';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: designColors.bg,
        sidebar: designColors.sidebar,
        card: designColors.card,
        elevated: designColors.elevated,
        surface: designColors.card,
        raised: designColors.elevated,
        fg: designColors.fg,
        muted: designColors.muted,
        line: designColors.line,
        accent: designColors.accent,
        accentHover: designColors.accentHover,
        success: designColors.success,
        warning: designColors.warning,
        error: designColors.error,
        cyan: { 400: '#22d3ee' },
        violet: { 400: '#a78bfa' },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'Liberation Mono', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
