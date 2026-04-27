/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        pitch: {
          green: '#1a5c35',
          dark: '#0f3d22',
          light: '#2d8a4e',
        },
      },
      animation: {
        'pulse-glow-green': 'pulse-glow-green 2s ease-in-out infinite',
        'pulse-glow-red': 'pulse-glow-red 2s ease-in-out infinite',
        'fade-in-up': 'fade-in-up 0.5s ease-out forwards',
        'scale-in': 'scale-in 0.4s ease-out forwards',
        'text-glow': 'text-glow 2s ease-in-out infinite',
        'float': 'float 3s ease-in-out infinite',
      },
      keyframes: {
        'pulse-glow-green': {
          '0%, 100%': { boxShadow: '0 0 20px rgba(52, 211, 153, 0.3)' },
          '50%': { boxShadow: '0 0 40px rgba(52, 211, 153, 0.6)' },
        },
        'pulse-glow-red': {
          '0%, 100%': { boxShadow: '0 0 20px rgba(239, 68, 68, 0.3)' },
          '50%': { boxShadow: '0 0 40px rgba(239, 68, 68, 0.6)' },
        },
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.9)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'text-glow': {
          '0%, 100%': { textShadow: '0 0 10px currentColor' },
          '50%': { textShadow: '0 0 30px currentColor, 0 0 60px currentColor' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
      },
    },
  },
  plugins: [],
};
