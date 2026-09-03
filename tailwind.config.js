/** @type {import('tailwindcss').Config} */

// Semantic color helper: reads an RGB-channel CSS variable and supports
// Tailwind opacity modifiers (e.g. `bg-accent/10`).
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: token('bg'),
        surface: {
          DEFAULT: token('surface'),
          2: token('surface-2'),
          3: token('surface-3'),
        },
        overlay: token('overlay'),
        border: {
          DEFAULT: token('border'),
          strong: token('border-strong'),
        },
        fg: {
          DEFAULT: token('fg'),
          muted: token('fg-muted'),
          subtle: token('fg-subtle'),
        },
        accent: {
          DEFAULT: token('accent'),
          fg: token('accent-fg'),
        },
        danger: token('danger'),
        success: token('success'),
        warning: token('warning'),
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
    },
  },
  plugins: [],
};
