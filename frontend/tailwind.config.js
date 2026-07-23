/**
 * @file tailwind.config.js
 * @description Tailwind CSS configuration — Archive / Ink-and-Paper theme.
 *   Maps all design tokens to ds-* utility classes. Adds ink panel tokens
 *   (ink.base/deep/mid/border), extended paper scale, stamp.bg, archive.bg,
 *   text.hint, and danger.bg while preserving all backward-compat aliases.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // -----------------------------------------------------------------------
      // COLORS — Ink & Paper palette
      // -----------------------------------------------------------------------
      colors: {
        ds: {
          // ── Light (paper) surface scale ─────────────────────────────────────
          base:     '#F7F5F0', // warm paper — primary light bg  (= paper.base)
          surface:  '#FFFFFF', // white surface
          elevated: '#FCFBF8', // index card bg
          card:     '#FCFBF8', // alias

          // ── Border / hairline ───────────────────────────────────────────────
          border:   '#D8D4C8', // = paper.border
          hairline: '#D8D4C8', // alias

          // ── Ink (dark surface) scale — for dark panels ──────────────────────
          ink: {
            base:   '#1C1B19', // near-black warm — primary dark surface
            deep:   '#141310', // deeper dark for nested surfaces
            mid:    '#242320', // card surface inside dark panels
            border: '#2C2B29', // border inside dark panels
          },

          // ── Extended paper scale ────────────────────────────────────────────
          paper: {
            deep:   '#EFEDE6', // hero right panel bg
            muted:  '#F0EDEA', // disabled / inactive states
          },

          // ── Text / ink scale ────────────────────────────────────────────────
          text: {
            primary:   '#1C1B19',
            secondary: '#5C5850',
            muted:     '#8A8578',
            hint:      '#6B6862', // muted hint tone — WCAG AA (>=4.5:1) on paper.base and white
            inverse:   '#FFFFFF',
          },

          // ── Stamp — rubber-stamp red-orange (primary CTA, active, processing)
          stamp: {
            DEFAULT: '#FF4D2E',
            bg:      '#FFF3E0', // light bg for stamp/red badge
            10:      'rgba(255,77,46,0.10)',
            20:      'rgba(255,77,46,0.20)',
            90:      'rgba(255,77,46,0.90)',
          },

          // ── Archive — deep green (citations, sources, success, ready) ───────
          archive: {
            DEFAULT: '#2D5A4A',
            bg:      '#E8F5E9', // light bg for archive/green badge
            10:      'rgba(45,90,74,0.10)',
            20:      'rgba(45,90,74,0.20)',
            90:      'rgba(45,90,74,0.90)',
          },

          // ── Highlight — literal highlighter yellow ──────────────────────────
          highlight: '#FFE066',

          // ── Danger ─────────────────────────────────────────────────────────
          danger: {
            DEFAULT: '#C0392B',
            bg:      '#FFEBEE', // light bg for danger states
          },

          // ── Semantic backward-compat aliases (old pages use these) ──────────
          indigo: {
            DEFAULT: '#FF4D2E',
            10:      'rgba(255,77,46,0.10)',
            20:      'rgba(255,77,46,0.20)',
            90:      'rgba(255,77,46,0.90)',
          },
          green: {
            DEFAULT: '#2D5A4A',
            10:      'rgba(45,90,74,0.10)',
            20:      'rgba(45,90,74,0.20)',
          },
          amber: {
            DEFAULT: '#D68910',
            10:      'rgba(214,137,16,0.10)',
          },
          rose: {
            DEFAULT: '#C0392B',
            10:      'rgba(192,57,43,0.10)',
          },

          success: '#2D5A4A',
          error:   '#C0392B',
          warning: '#D68910',
          info:    '#FF4D2E',
        },
      },

      // -----------------------------------------------------------------------
      // TYPOGRAPHY
      // -----------------------------------------------------------------------
      fontFamily: {
        display: ["'Fraunces Variable'", 'Georgia', "'Times New Roman'", 'serif'],
        body:    ["'Space Grotesk'", '-apple-system', 'BlinkMacSystemFont', "'Segoe UI'", 'sans-serif'],
        mono:    ["'Space Mono'", "'Courier New'", 'monospace'],
      },

      fontSize: {
        'ds-xs':      ['12px', { lineHeight: '1.5' }],
        'ds-sm':      ['14px', { lineHeight: '1.5' }],
        'ds-base':    ['16px', { lineHeight: '1.5' }],
        'ds-md':      ['18px', { lineHeight: '1.5' }],
        'ds-lg':      ['22px', { lineHeight: '1.2' }],
        'ds-xl':      ['28px', { lineHeight: '1.2' }],
        'ds-2xl':     ['36px', { lineHeight: '1.1' }],
        'ds-3xl':     ['48px', { lineHeight: '1.1' }],
        'ds-display': ['64px', { lineHeight: '1.0' }],
      },

      fontWeight: {
        'ds-regular':  '400',
        'ds-medium':   '500',
        'ds-semibold': '600',
        'ds-bold':     '700',
        'ds-black':    '900',
      },

      lineHeight: {
        'ds-tight':   '1.2',
        'ds-normal':  '1.5',
        'ds-relaxed': '1.75',
      },

      letterSpacing: {
        'ds-tight':  '-0.02em',
        'ds-normal': '0em',
        'ds-wide':   '0.06em',
        'ds-wider':  '0.10em',
      },

      // -----------------------------------------------------------------------
      // SPACING (4px base grid)
      // -----------------------------------------------------------------------
      spacing: {
        'ds-1':  '4px',
        'ds-2':  '8px',
        'ds-3':  '12px',
        'ds-4':  '16px',
        'ds-5':  '20px',
        'ds-6':  '24px',
        'ds-7':  '28px',
        'ds-8':  '32px',
        'ds-10': '40px',
        'ds-12': '48px',
        'ds-14': '56px',
        'ds-16': '64px',
        'ds-20': '80px',
        'ds-24': '96px',
      },

      // -----------------------------------------------------------------------
      // BORDER RADIUS — sharp by default (paper / print aesthetic)
      // -----------------------------------------------------------------------
      borderRadius: {
        'ds-none': '0px',
        'ds-sm':   '2px',
        'ds-md':   '4px',
        'ds-lg':   '6px',
        'ds-xl':   '12px',
        'ds-full': '9999px',
      },

      // -----------------------------------------------------------------------
      // BOX SHADOWS — paper, not glow
      // -----------------------------------------------------------------------
      boxShadow: {
        'ds-sm':       '0 1px 4px rgba(28,27,25,0.06)',
        'ds-md':       '0 2px 8px rgba(28,27,25,0.06)',
        'ds-lifted':   '0 4px 16px rgba(28,27,25,0.12)',
        'ds-stamp':    '0 1px 4px rgba(255,77,46,0.20)',
        'ds-glow':     '0 2px 8px rgba(28,27,25,0.06)',
        'ds-citation': '0 1px 3px rgba(45,90,74,0.15)',
      },

      // -----------------------------------------------------------------------
      // ANIMATION
      // -----------------------------------------------------------------------
      transitionDuration: {
        'ds-fast':   '100ms',
        'ds-normal': '150ms',
        'ds-slow':   '350ms',
        'ds-flip':   '400ms',
      },

      transitionTimingFunction: {
        'ds-smooth':     'cubic-bezier(0.4, 0, 0.2, 1)',
        'ds-settle':     'cubic-bezier(0.34, 1.56, 0.64, 1)',
        'ds-mechanical': 'cubic-bezier(0.0, 0.0, 0.2, 1)',
      },

      keyframes: {
        'cursor-blink': {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0' },
        },
        'slide-up': {
          from: { transform: 'translateY(10px)', opacity: '0' },
          to:   { transform: 'translateY(0)',    opacity: '1' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(100%)', opacity: '0' },
          to:   { transform: 'translateX(0)',    opacity: '1' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        'paper-drop': {
          '0%':   { transform: 'translateY(12px)', opacity: '0' },
          '80%':  { transform: 'translateY(-3px)', opacity: '1' },
          '100%': { transform: 'translateY(0)',    opacity: '1' },
        },
        'dropzone-pulse': {
          '0%, 100%': { opacity: '0.6' },
          '50%':      { opacity: '1' },
        },
        'card-flip-out': {
          from: { transform: 'rotateY(0deg)' },
          to:   { transform: 'rotateY(-180deg)' },
        },
        'card-flip-in': {
          from: { transform: 'rotateY(180deg)' },
          to:   { transform: 'rotateY(0deg)' },
        },
        'progress-scan': {
          '0%':   { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(400%)' },
        },
        'progress-bar': {
          from: { transform: 'scaleX(1)' },
          to:   { transform: 'scaleX(0)' },
        },
        'string-appear': {
          from: { opacity: '0', strokeDashoffset: '60' },
          to:   { opacity: '1', strokeDashoffset: '0'  },
        },
        'ticker-scroll': {
          from: { transform: 'translateX(0)' },
          to:   { transform: 'translateX(-50%)' },
        },
      },

      animation: {
        'cursor-blink':   'cursor-blink 400ms step-end infinite',
        'slide-up':       'slide-up 200ms cubic-bezier(0.4,0,0.2,1)',
        'slide-in-right': 'slide-in-right 200ms cubic-bezier(0.4,0,0.2,1)',
        'fade-in':        'fade-in 150ms cubic-bezier(0.4,0,0.2,1)',
        'paper-drop':     'paper-drop 280ms cubic-bezier(0.34,1.56,0.64,1)',
        'dropzone-pulse': 'dropzone-pulse 1.5s ease-in-out infinite',
        'progress-scan':  'progress-scan 1.2s linear infinite',
        'spin-smooth':    'progress-scan 1.2s linear infinite',
        'ticker-scroll':  'ticker-scroll 20s linear infinite',
      },

      // -----------------------------------------------------------------------
      // Z-INDEX
      // -----------------------------------------------------------------------
      zIndex: {
        'ds-base':     '0',
        'ds-dropdown': '10',
        'ds-sticky':   '20',
        'ds-overlay':  '30',
        'ds-modal':    '40',
        'ds-toast':    '50',
      },

      // -----------------------------------------------------------------------
      // BREAKPOINTS
      // -----------------------------------------------------------------------
      screens: {
        sm:  '640px',
        md:  '768px',
        lg:  '1024px',
        xl:  '1280px',
      },
    },
  },
  plugins: [],
};
