module.exports = {
  content: [
    './src/**/*.{js,jsx,ts,tsx}',
    './index.html'
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: '#64748B',
        secondary: '#94A3B8',
        accent: '#F97316',
        background: '#F8FAFC',
        surface: '#FFFFFF',
        'text-primary': '#334155',
        'text-secondary': '#64748B',
        'text-muted': '#94A3B8',
        success: '#10B981',
        warning: '#F59E0B',
        danger: '#EF4444',
        info: '#3B82F6',
        defect: {
          crack: '#DC2626',
          corrosion: '#EA580C',
          pitting: '#D97706',
          scratch: '#7C3AED',
          dent: '#2563EB',
          wear: '#0891B2',
          rust: '#CA8A04',
          hole: '#DB2777',
          deformation: '#7C2D12',
          other: '#525252'
        }
      },
      fontFamily: {
        sans: ['Fira Sans', 'system-ui', 'sans-serif'],
        mono: ['Fira Code', 'monospace']
      }
    }
  },
  plugins: []
};
