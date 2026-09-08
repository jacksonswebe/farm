import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Severity is the product's primary visual language. These are the
        // only colours that carry meaning; everything else is neutral.
        severity: {
          negligible: '#64748b',
          minor: '#0ea5e9',
          moderate: '#f59e0b',
          major: '#f97316',
          catastrophic: '#dc2626',
        },
        brand: { DEFAULT: '#0f766e', dark: '#115e59', light: '#ccfbf1' },
      },
    },
  },
  plugins: [],
} satisfies Config;
