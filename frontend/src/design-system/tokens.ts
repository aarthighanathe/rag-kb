/**
 * @file tokens.ts
 * @description Design system tokens — "Archive / Ink-and-Paper" theme v2.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

export const ink = {
  base:      '#1C1B19',
  deep:      '#141310',
  mid:       '#242320',
  border:    '#2C2B29',
  primary:   '#1C1B19',
  secondary: '#5C5850',
  muted:     '#8A8578',
  // WCAG AA requires >=4.5:1 for normal text. #6B6862 computes to 5.10:1 on
  // paper.base (#F7F5F0) and 5.55:1 on white — still a distinct mid-grey
  // "hint" tone, lighter than ink.muted (#8A8578 fails at 2.86:1) and well
  // short of ink.primary's near-black weight.
  hint:      '#6B6862',
} as const;

export const paper = {
  base:    '#F7F5F0',
  surface: '#FCFBF8',
  deep:    '#EFEDE6',
  border:  '#D8D4C8',
  muted:   '#F0EDEA',
} as const;

export const stamp = {
  red:    '#FF4D2E',
  redBg:  '#FFF3E0',
  10:     'rgba(255,77,46,0.10)',
  20:     'rgba(255,77,46,0.20)',
  40:     'rgba(255,77,46,0.40)',
  90:     'rgba(255,77,46,0.90)',
} as const;

export const archive = {
  green:   '#2D5A4A',
  greenBg: '#E8F5E9',
  10:      'rgba(45,90,74,0.10)',
  20:      'rgba(45,90,74,0.20)',
  90:      'rgba(45,90,74,0.90)',
} as const;

export const danger = {
  DEFAULT: '#C0392B',
  bg:      '#FFEBEE',
  10:      'rgba(192,57,43,0.10)',
  30:      'rgba(192,57,43,0.30)',
} as const;

export const white = '#FFFFFF' as const;

export const colorSemantic = {
  error:   { bg: danger.bg,       text: danger.DEFAULT, border: danger[30] },
  success: { bg: archive.greenBg, text: archive.green,  border: archive[20] },
  info:    { bg: stamp.redBg,     text: stamp.red,      border: stamp[20]  },
  warning: { bg: 'rgba(214,137,16,0.08)', text: '#D68910', border: 'rgba(214,137,16,0.30)' },
} as const;

export const fontFamily = {
  display: "'Fraunces Variable', Georgia, 'Times New Roman', serif",
  body:    "'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  mono:    "'Space Mono', 'Courier New', monospace",
} as const;

export const fontSize = {
  xs: '12px', sm: '14px', base: '16px', md: '18px',
  lg: '22px', xl: '28px', '2xl': '36px', '3xl': '48px', display: '64px',
} as const;

export const fontWeight = { regular: 400, medium: 500, semibold: 600, bold: 700, black: 900 } as const;
export const lineHeight  = { tight: 1.2, normal: 1.5, relaxed: 1.75 } as const;
export const letterSpacing = { tight: '-0.02em', normal: '0em', wide: '0.06em', wider: '0.10em' } as const;

export const spacing = {
  1: '4px', 2: '8px', 3: '12px', 4: '16px', 5: '20px', 6: '24px',
  7: '28px', 8: '32px', 10: '40px', 12: '48px', 14: '56px',
  16: '64px', 20: '80px', 24: '96px',
} as const;

export const borderRadius = {
  none: '0px', sm: '0px', md: '0px', lg: '0px', xl: '0px', full: '9999px',
} as const;

export const shadow = {
  card:       '0 2px 8px rgba(28,27,25,0.06)',
  lifted:     '0 4px 16px rgba(28,27,25,0.12)',
  stamp:      '0 1px 4px rgba(255,77,46,0.20)',
  stampHover: '0 4px 12px rgba(255,77,46,0.35)',
  darkHover:  '0 4px 12px rgba(28,27,25,0.20)',
  inset:      'inset 0 1px 3px rgba(28,27,25,0.08)',
  indexCard:  '0 3px 8px rgba(28,27,25,0.08)',
} as const;

export const duration = { fast: '100ms', normal: '150ms', slow: '350ms', flip: '400ms' } as const;
export const easing   = {
  smooth: 'cubic-bezier(0.4, 0, 0.2, 1)',
  settle: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  mechanical: 'cubic-bezier(0.0, 0.0, 0.2, 1)',
} as const;

export const stampRotation = {
  stampBadge: '-8deg', toastNote: '1deg',
  cardA: '-1.2deg', cardB: '0.8deg', cardC: '-1deg', cardD: '1.2deg',
  badgeA: '-8deg', badgeB: '5deg',
} as const;

export const zIndex = { base: 0, dropdown: 10, sticky: 20, overlay: 30, modal: 40, toast: 50 } as const;
export const breakpoint = { sm: '640px', md: '768px', lg: '1024px', xl: '1280px' } as const;
