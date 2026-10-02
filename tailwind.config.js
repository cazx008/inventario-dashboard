/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        page: '#0F172A',
        surface: '#1E293B',
        surfaceHigh: '#1C2B3C',
        surfaceHighest: '#273647',
        borderSubtle: '#334155',
        brand: {
          400: '#4EDEA3',
          500: '#10B981',
          600: '#059669'
        },
        signal: {
          red: '#EF4444',
          orange: '#F59E0B',
          yellow: '#EAB308',
          blue: '#3B82F6',
          purple: '#8B5CF6'
        }
      },
      fontFamily: {
        sans: ['Geist', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['Geist Mono', 'JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      screens: {
        print: { raw: 'print' }
      }
    },
  },
  plugins: [],
}
