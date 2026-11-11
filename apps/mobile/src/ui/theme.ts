/**
 * Cardigo design tokens. Monochrome and soft: a light grey page, white cards with gentle shadows,
 * and black only where something matters.
 *
 * `ink` is the foreground (text, icons, primary buttons) and `paper` is what sits on ink.
 */
export const colors = {
  bg: '#F4F4F4',
  bgSoft: '#EEEEEE',
  card: '#FFFFFF',
  ink: '#111111',
  inkSoft: '#171717',
  inkGradientTop: '#3A3A3A',
  paper: '#FFFFFF',
  text: '#111111',
  textMuted: '#929292',
  textFaint: '#B8B8B8',
  divider: '#E8E8E8',
  inactive: '#EEEEEE',
  glassTop: '#FFFFFF',
  glassBottom: '#FBFBFB',
  glassSheen: '#FFFFFF',
  glassBorder: 'rgba(0,0,0,0.04)',
  glassOverMap: 'rgba(255,255,255,0.94)',
  hairline: '#E8E8E8',
  fieldBg: '#EEEEEE',
  scrim: 'rgba(17,17,17,0.35)',
  danger: '#111111',
} as const;

/** Soft, wide shadows: they lift white cards off the grey without drawing a hard edge. */
export const shadow = {
  card: '0px 8px 24px rgba(0,0,0,0.06), 0px 1px 2px rgba(0,0,0,0.04)',
  raised: '0px 12px 32px rgba(0,0,0,0.12), 0px 2px 6px rgba(0,0,0,0.06)',
  button: '0px 8px 18px rgba(0,0,0,0.22), 0px 1px 2px rgba(0,0,0,0.18)',
  inset: 'inset 0px 2px 4px rgba(0,0,0,0.06)',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 10, md: 16, lg: 22, xl: 28, pill: 999 } as const;

/** Poppins in every weight we use. Android picks a face by family name, never by fontWeight. */
export const fonts = {
  light: 'Poppins-Light',
  regular: 'Poppins-Regular',
  medium: 'Poppins-Medium',
  semibold: 'Poppins-SemiBold',
  bold: 'Poppins-Bold',
} as const;

export function fontFor(weight: string | number | undefined): string {
  const w = typeof weight === 'number' ? weight : weight === 'bold' ? 700 : weight ? parseInt(weight, 10) || 400 : 400;
  if (w <= 300) return fonts.light;
  if (w < 500) return fonts.regular;
  if (w < 600) return fonts.medium;
  if (w < 700) return fonts.semibold;
  return fonts.bold;
}

export const type = {
  hero: { fontSize: 54, fontFamily: fonts.light, letterSpacing: -1.5, fontVariant: ['tabular-nums'] },
  title: { fontSize: 28, fontFamily: fonts.bold, letterSpacing: -0.6 },
  heading: { fontSize: 16, fontFamily: fonts.semibold, letterSpacing: -0.2 },
  body: { fontSize: 14, fontFamily: fonts.regular },
  small: { fontSize: 12, fontFamily: fonts.regular },
  label: { fontSize: 10, fontFamily: fonts.medium, letterSpacing: 1, textTransform: 'uppercase' },
  stat: { fontSize: 22, fontFamily: fonts.regular, letterSpacing: -0.4, fontVariant: ['tabular-nums'] },
  metric: { fontSize: 30, fontFamily: fonts.light, letterSpacing: -0.8, fontVariant: ['tabular-nums'] },
} as const;

/** Spring used for every press and selection, so the whole app moves with one feel. */
export const spring = { damping: 18, stiffness: 260, mass: 0.7 } as const;
