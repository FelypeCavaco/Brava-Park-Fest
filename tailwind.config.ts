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
      keyframes: {
        'gradient-x': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        'float-slow': {
          '0%, 100%': { transform: 'translateY(0) translateX(0) rotate(0deg)' },
          '33%': { transform: 'translateY(-18px) translateX(8px) rotate(4deg)' },
          '66%': { transform: 'translateY(10px) translateX(-10px) rotate(-3deg)' },
        },
        'card-in': {
          '0%': { opacity: '0', transform: 'translateY(10px) scale(0.98)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'pop-in': {
          '0%': { opacity: '0', transform: 'scale(0.7)' },
          '60%': { opacity: '1', transform: 'scale(1.08)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgba(178,58,58,0.35)' },
          '100%': { boxShadow: '0 0 0 8px rgba(178,58,58,0)' },
        },
        'logo-drift': {
          '0%, 100%': { transform: 'perspective(600px) rotateY(0deg) rotateX(0deg)' },
          '25%': { transform: 'perspective(600px) rotateY(6deg) rotateX(-3deg)' },
          '75%': { transform: 'perspective(600px) rotateY(-6deg) rotateX(3deg)' },
        },
        'spin-slow': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        'gradient-x': 'gradient-x 8s ease infinite',
        'float-slow': 'float-slow 9s ease-in-out infinite',
        'card-in': 'card-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both',
        'pop-in': 'pop-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both',
        shimmer: 'shimmer 2.5s linear infinite',
        'pulse-ring': 'pulse-ring 1.6s ease-out infinite',
        'logo-drift': 'logo-drift 7s ease-in-out infinite',
        'spin-slow': 'spin-slow 14s linear infinite',
      },
      backgroundSize: {
        '200%': '200% 200%',
      },
    },
  },
  plugins: [],
} satisfies Config
