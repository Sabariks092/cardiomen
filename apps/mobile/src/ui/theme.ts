/** The whole app is black and white. Every shade below is white at some opacity over black. */
export const colors = {
  bg: '#000000',
  white: '#FFFFFF',
  black: '#000000',
  text: '#FFFFFF',
  textMuted: 'rgba(255,255,255,0.62)',
  textFaint: 'rgba(255,255,255,0.38)',
  glassTop: 'rgba(255,255,255,0.13)',
  glassBottom: 'rgba(255,255,255,0.045)',
  glassBorder: 'rgba(255,255,255,0.16)',
  glassOverMap: 'rgba(12,12,12,0.74)',
  hairline: 'rgba(255,255,255,0.1)',
  fieldBg: 'rgba(255,255,255,0.07)',
  scrim: 'rgba(0,0,0,0.72)',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 10, md: 16, lg: 24, pill: 999 } as const;

export const type = {
  hero: { fontSize: 56, fontWeight: '200', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  title: { fontSize: 28, fontWeight: '300', letterSpacing: -0.4 },
  heading: { fontSize: 17, fontWeight: '500' },
  body: { fontSize: 15, fontWeight: '400' },
  small: { fontSize: 13, fontWeight: '400' },
  label: { fontSize: 11, fontWeight: '500', letterSpacing: 1.1, textTransform: 'uppercase' },
  stat: { fontSize: 24, fontWeight: '300', fontVariant: ['tabular-nums'] },
} as const;
