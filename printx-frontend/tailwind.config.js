/** @type {import('tailwindcss').Config} */

/* ============================================================
   PRINTX LOCKED THEME — Deep Navy / Slate
   ------------------------------------------------------------
   Backgrounds : #0B132B (base) · #0F172A (elevated) · #1E293B (card)
   Borders     : #1E2D4A
   Accents     : Cyan #06B6D4 → Teal #14B8A6 · Electric Blue #2563EB
   Badges      : Amber Gold #F59E0B · Mint Emerald #10B981
   Danger      : Crimson #DC2626
   NO ORANGE. Do not introduce orange-*, or hexes outside this map.
   ============================================================ */

module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Base backgrounds (locked)
        base: {
          DEFAULT: '#0B132B',   // page background
          elevated: '#0F172A',  // elevated surfaces / sidebar end
        },
        // Card surfaces (locked)
        card: {
          DEFAULT: '#1E293B',
          hover: '#243147',
          border: '#1E2D4A',
        },
        // Accents (locked)
        accent: {
          cool: '#06B6D4',       // cyan
          coolDeep: '#0891B2',
          teal: '#14B8A6',       // teal
          blue: '#2563EB',       // electric blue
          amber: '#F59E0B',      // amber gold badge accent
        },
        // Status (locked)
        status: {
          green: '#10B981',      // mint emerald — paid/completed
          amber: '#F59E0B',      // amber gold — pending
          red: '#DC2626',        // crimson — cancelled/failed
        },
        // Legacy aliases kept so existing class names keep working
        primary: {
          50: '#ECFEFF',
          100: '#CFFAFE',
          200: '#A5F3FC',
          300: '#67E8F9',
          400: '#22D3EE',
          500: '#06B6D4',
          600: '#0891B2',
          700: '#0E7490',
          800: '#155E75',
          900: '#164E63',
        },
        dark: {
          navy: '#0B132B',
          accent: '#1E293B',
          card: '#1E293B',
        },
        surface: {
          white: '#ffffff',
          light: '#F1F5F9',
          gray: '#E2E8F0',
        },
        background: {
          DEFAULT: '#F8FAFC',
          dark: '#0B132B',
        },
        text: {
          DEFAULT: '#0F172A',
          dark: '#F8FAFC',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
      },
      spacing: {
        13: '3.25rem',
      },
      borderRadius: {
        '3xl': '1.5rem',
        '4xl': '2rem',
      },
      boxShadow: {
        card: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        'card-hover': '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        glow: '0 0 40px rgba(6, 182, 212, 0.3)',
        'glow-lg': '0 0 60px rgba(6, 182, 212, 0.4)',
        'glow-amber': '0 0 30px rgba(245, 158, 11, 0.25)',
        'dark-card': '0 4px 6px -1px rgba(0, 0, 0, 0.4), 0 2px 4px -1px rgba(0, 0, 0, 0.3)',
        'dark-glow': '0 0 40px rgba(6, 182, 212, 0.25)',
        'dark-glow-amber': '0 0 25px rgba(245, 158, 11, 0.2)',
        depth: 'inset 0 1px 0 0 rgba(255, 255, 255, 0.03)',
      },
      backgroundImage: {
        'gradient-cool': 'linear-gradient(135deg, #06B6D4 0%, #2563EB 100%)',
        'gradient-teal': 'linear-gradient(135deg, #06B6D4 0%, #14B8A6 100%)',
        'gradient-card': 'linear-gradient(180deg, rgba(30, 41, 59, 0.85) 0%, rgba(11, 19, 43, 0.95) 100%)',
        'gradient-sidebar': 'linear-gradient(180deg, #0F172A 0%, #0B132B 100%)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'bounce-subtle': 'bounce 2s infinite',
        scan: 'scan 2s ease-in-out infinite',
        'spin-slow': 'spin 3s linear infinite',
        'glow-pulse': 'glow-pulse 2s ease-in-out infinite',
      },
      keyframes: {
        scan: {
          '0%, 100%': { transform: 'translateY(0%)' },
          '50%': { transform: 'translateY(100%)' },
        },
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 20px rgba(6, 182, 212, 0.3)' },
          '50%': { boxShadow: '0 0 40px rgba(6, 182, 212, 0.5)' },
        },
      },
    },
  },
  plugins: [],
};
