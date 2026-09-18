import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#241B33',
        paper: '#F5F2FA',
        surface: '#FFFFFF',
        line: '#E2DBEE',
        muted: '#6E6880',
        purple: {
          DEFAULT: '#6D28D9',
          dark: '#4C1D95',
          light: '#EEE6FB',
        },
        green: {
          DEFAULT: '#7CB92E',
          dark: '#4F7A16',
          light: '#EDF6DD',
        },
        orange: {
          DEFAULT: '#F2900C',
          light: '#FCEBD3',
        },
        teal: {
          DEFAULT: '#1F7A5C',
          light: '#E1F0EA',
        },
        amber: {
          DEFAULT: '#B8720A',
          light: '#FBEDD8',
        },
        danger: {
          DEFAULT: '#B23A3A',
          light: '#F8E5E5',
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        sans: ['Inter', 'sans-serif'],
      },
      borderRadius: {
        card: '10px',
      },
    },
  },
  plugins: [],
} satisfies Config
