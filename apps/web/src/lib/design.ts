// src/lib/design.ts
export const colors = {
  bg: '#101110',            // main background
  sidebar: '#141512',       // sidebar background
  card: '#191B18',          // card background
  elevated: '#22241F',      // elevated surfaces
  fg: '#F5F3ED',            // primary text
  muted: '#A09F96',         // secondary text
  line: '#30322B',          // borders
  accent: '#C6F277',        // primary accent (lime)
  accentHover: '#D5FF8C',   // accent hover
  success: '#8BCF85',       // success
  warning: '#E9B96E',       // warning
  error: '#E77970',         // error
} as const;

export const spacing = {
  xs: '0.25rem',
  sm: '0.5rem',
  md: '1rem',
  lg: '1.5rem',
  xl: '2rem',
  '2xl': '3rem',
};

export const radius = '4px';
export const shadow = '0 1px 3px rgba(0,0,0,0.12)';
