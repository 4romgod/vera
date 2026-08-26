export const palette = {
  canvas: '#090B0E',
  canvasRaised: '#0D1014',
  surface: '#12171C',
  surfaceRaised: '#171D22',
  surfaceStrong: '#1C242A',
  line: '#252D32',
  lineSoft: 'rgba(255,255,255,0.075)',
  text: '#F7F6F2',
  textSoft: '#CCCAC2',
  muted: '#949188',
  faint: '#6B6962',
  accent: '#F2CF63',
  accentStrong: '#FFE59A',
  accentLine: '#6C5A27',
  accentSurface: '#272210',
  accentSurfaceStrong: '#3A3218',
  danger: '#F0A0A0',
  dangerSurface: '#321C20',
  warning: '#E8A45C',
  warningSurface: '#2C2015',
  scrim: 'rgba(0,0,0,0.68)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  pill: 999,
} as const;

export const layout = {
  sidebarWidth: 304,
  inspectorWidth: 420,
  conversationWidth: 820,
  compactBreakpoint: 880,
  touchTarget: 44,
} as const;

export const shadow = {
  raised: '0 12px 40px rgba(0, 0, 0, 0.28)',
  floating: '0 18px 60px rgba(0, 0, 0, 0.38)',
} as const;
