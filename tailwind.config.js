/** @type {import('tailwindcss').Config} */
// Tailwind colours point at the CSS variables in src/theme/theme.css, so
// utilities such as `text-success`, `bg-surface` or `border-primary`
// follow the active theme. Change colours in theme.css, not here.
// The stock ramps are re-pointed at the Astrikos brand (ASTRIKOS-UI-THEME §5.2),
// so a stray `bg-slate-800` or `text-purple-400` still lands on-brand.
const token = (name) => `var(--${name})`;

const graphite = { 50:'#F7F7FA',100:'#E8E6F2',200:'#D6D6D6',300:'#B4B4B4',400:'#8E8E8E',500:'#6E6E6E',600:'#4A4A4A',700:'#333333',800:'#242424',900:'#1A1A1A',950:'#121212' };
const periwinkle = { 50:'#F2F0FF',100:'#E4DFFF',200:'#D9D3FF',300:'#C8BEFF',400:'#BCB0FF',500:'#A597FF',600:'#7B5FE0',700:'#6849CC',800:'#5B3FB8',900:'#463091',950:'#2A1C5C' };
const brandGreen = { 50:'#E8FBF0',100:'#C6F5DA',200:'#94EBBB',300:'#6EE7A4',400:'#34D47C',500:'#0EBC53',600:'#0BA648',700:'#098A3C',800:'#076B2F',900:'#054F23',950:'#032E14' };
const brandRed = { 50:'#FDEEEE',100:'#F9D5D5',200:'#F2B4B4',300:'#EFA8A8',400:'#E86A6A',500:'#D43434',600:'#BE2E2E',700:'#A82828',800:'#8A2020',900:'#6B1919',950:'#3F0F0F' };
const brandAmber = { 50:'#FEF7EA',100:'#FCEBCB',200:'#F8D89B',300:'#F5C87A',400:'#F0B65C',500:'#E8A33D',600:'#C4882F',700:'#A87226',800:'#87591D',900:'#664215',950:'#3D270C' };
const brandOrange = { 50:'#FEF3EB',100:'#FCE2CE',200:'#F8C79F',300:'#F5B681',400:'#F2A365',500:'#EE8B3D',600:'#CC7430',700:'#A85E27',800:'#854A1F',900:'#633717',950:'#3B210E' };
const brandAzure = { 50:'#EFF4FF',100:'#DAE5FF',200:'#BFD2FF',300:'#A6C4FF',400:'#8AAEFF',500:'#6E9BFF',600:'#5C87F0',700:'#4A72D6',800:'#3A5CAD',900:'#2B4483',950:'#1A294F' };
const brandTeal = { 50:'#E9FBF8',100:'#C9F4ED',200:'#A3ECE0',300:'#8FE9DA',400:'#6FD9C8',500:'#4FC9BA',600:'#2F9E91',700:'#25837A',800:'#1D6660',900:'#154B47',950:'#0C2C2A' };

module.exports = {
  content: ['./public/index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /* Template tokens (follow the active theme) */
        primary:   { DEFAULT: token('color-primary'), soft: token('color-primary-soft') },
        accent:    { DEFAULT: token('color-accent'),  soft: token('color-accent-soft') },
        success:   { DEFAULT: token('color-success'), soft: token('color-success-soft') },
        warning:   { DEFAULT: token('color-warning'), soft: token('color-warning-soft') },
        danger:    { DEFAULT: token('color-danger'),  soft: token('color-danger-soft') },
        info:      { DEFAULT: token('color-info'),    soft: token('color-info-soft') },
        page:      token('color-bg'),
        surface:   { DEFAULT: token('color-surface'), raised: token('color-surface-raised') },
        line:      { DEFAULT: token('color-border'),  strong: token('color-border-strong') },
        fg:        { DEFAULT: token('color-text'), muted: token('color-text-muted'), faint: token('color-text-faint') },

        /* Brand tokens */
        astrikos: {
          ink:'#353248', carbon:'#2F2E33', steel:'#565559', mist:'#E8E6F2', paper:'#F7F7FA',
          lilac:'#D9D3FF', periwinkle:'#A597FF', iris:'#8B82C3', slate:'#7D7A91',
          go:'#0EBC53', stop:'#D43434',
        },
        /* Live CSS-variable aliases */
        app: {
          bg: token('app-bg'), panel: token('app-panel'), surface: token('app-surface'),
          'surface-soft': token('app-surface-soft'), 'surface-raised': token('app-surface-raised'),
          elevated: token('app-bg-elevated'), border: token('app-border'),
          'border-strong': token('app-border-strong'), text: token('app-text'),
          muted: token('app-text-muted'), faint: token('app-text-faint'),
          accent: token('app-accent'), success: token('app-success'),
          warning: token('app-warning'), danger: token('app-danger'), info: token('app-info'),
        },

        /* Stock ramps, re-pointed at the brand */
        slate: graphite, gray: graphite, zinc: graphite, stone: graphite,
        neutral: { ...graphite, DEFAULT: token('color-neutral'), soft: token('color-neutral-soft') },
        purple: periwinkle, violet: periwinkle, indigo: periwinkle, fuchsia: periwinkle, pink: periwinkle,
        green: brandGreen, emerald: brandGreen, lime: brandGreen,
        red: brandRed, rose: brandRed,
        amber: brandAmber, yellow: brandAmber, orange: brandOrange,
        blue: brandAzure, sky: brandAzure,
        teal: brandTeal, cyan: brandTeal,
      },
      borderColor: {
        DEFAULT: token('color-border'),
      },
      fontFamily: {
        display: ['"Lexend Deca"', 'system-ui', 'sans-serif'],
        sans: ['Lato', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        'brand-h1':    ['4rem',     { lineHeight: '1.05', letterSpacing: '-0.03em', fontWeight: '700' }],
        'brand-h2':    ['2rem',     { lineHeight: '1.15', letterSpacing: '-0.02em', fontWeight: '700' }],
        'brand-h3':    ['1.25rem',  { lineHeight: '1.25', letterSpacing: '-0.01em', fontWeight: '700' }],
        'brand-h4':    ['0.75rem',  { lineHeight: '1.35', letterSpacing: '0.02em',  fontWeight: '700' }],
        'brand-body':  ['1rem',     { lineHeight: '1.6' }],
        'brand-body2': ['0.875rem', { lineHeight: '1.55' }],
        'brand-tiny':  ['0.625rem', { lineHeight: '1.4', letterSpacing: '0.04em' }],
      },
      /* One radius family: 6 / 8 / 9 / 10 / 12 / 14 / 999 (§4.2) */
      borderRadius: {
        sm: '6px', DEFAULT: '6px', md: '8px', lg: '9px', xl: '12px', '2xl': '14px', '3xl': '14px', full: '999px',
        brand: '10px', panel: '14px',
      },
      boxShadow: {
        'app-xs': token('app-shadow-xs'), 'app-sm': token('app-shadow-sm'),
        'app-md': token('app-shadow-md'), 'app-lg': token('app-shadow-lg'),
        'app-edge': token('app-edge-light'),
        sm: token('app-shadow-xs'), DEFAULT: token('app-shadow-sm'), md: token('app-shadow-md'),
        lg: token('app-shadow-lg'), xl: token('app-shadow-lg'),
      },
      backgroundImage: {
        'astrikos-chrome': 'linear-gradient(135deg,#F7F7FA 0%,#C9C4DC 18%,#8E89A6 38%,#F2F0F7 52%,#9B95B4 68%,#5B5770 86%,#B4AFC8 100%)',
        'astrikos-ink': 'linear-gradient(160deg,#353248 0%,#221E31 55%,#17141F 100%)',
      },
      keyframes: { 'astrikos-sheen': { '0%': { backgroundPosition: '0% 50%' }, '100%': { backgroundPosition: '200% 50%' } } },
    },
  },
  plugins: [],
};
