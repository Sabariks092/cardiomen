import * as SecureStore from 'expo-secure-store';

/**
 * Cardigo design tokens. Soft: a light page, white cards with gentle shadows, and the palette's
 * ink only where something matters.
 *
 * `ink` is the foreground (text, icons, primary buttons) and `paper` is what sits on ink.
 */
const CLASSIC = {
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
};

export type Colors = { [K in keyof typeof CLASSIC]: string };

/** A palette changes the ink and tints the page to match. Cards and text on ink stay white. */
function tinted(p: {
  ink: string;
  inkSoft: string;
  inkGradientTop: string;
  text: string;
  bg: string;
  soft: string;
  line: string;
  muted: string;
  faint: string;
  scrim: string;
}): Colors {
  return {
    ...CLASSIC,
    ink: p.ink,
    inkSoft: p.inkSoft,
    inkGradientTop: p.inkGradientTop,
    text: p.text,
    textMuted: p.muted,
    textFaint: p.faint,
    bg: p.bg,
    bgSoft: p.soft,
    inactive: p.soft,
    fieldBg: p.soft,
    divider: p.line,
    hairline: p.line,
    scrim: p.scrim,
    danger: p.ink,
  };
}

export const PALETTES = {
  classic: { name: 'Classic', colors: CLASSIC },
  ocean: {
    name: 'Ocean',
    colors: tinted({
      ink: '#0F3D63', inkSoft: '#123F66', inkGradientTop: '#2C6A9C', text: '#0E1B26',
      bg: '#F1F5F9', soft: '#E6EDF3', line: '#DCE5EE', muted: '#7F8FA0', faint: '#B2BECA', scrim: 'rgba(15,61,99,0.35)',
    }),
  },
  forest: {
    name: 'Forest',
    colors: tinted({
      ink: '#1F4D3A', inkSoft: '#21503D', inkGradientTop: '#3E7A60', text: '#13231B',
      bg: '#F2F6F3', soft: '#E6EEE9', line: '#DBE6DF', muted: '#82958A', faint: '#B4C3BA', scrim: 'rgba(31,77,58,0.35)',
    }),
  },
  sunset: {
    name: 'Sunset',
    colors: tinted({
      ink: '#A63D17', inkSoft: '#A93F19', inkGradientTop: '#D7673B', text: '#2A1710',
      bg: '#FBF4F0', soft: '#F4E8E1', line: '#EDDDD3', muted: '#A08C82', faint: '#CDBBB2', scrim: 'rgba(166,61,23,0.35)',
    }),
  },
  berry: {
    name: 'Berry',
    colors: tinted({
      ink: '#56287F', inkSoft: '#592A83', inkGradientTop: '#8250B0', text: '#1F1429',
      bg: '#F6F3F9', soft: '#ECE6F2', line: '#E3DAEC', muted: '#93889E', faint: '#C2B9CB', scrim: 'rgba(86,40,127,0.35)',
    }),
  },
  rose: {
    name: 'Rose',
    colors: tinted({
      ink: '#9C2148', inkSoft: '#9F234A', inkGradientTop: '#C9496F', text: '#2A1219',
      bg: '#FBF3F5', soft: '#F4E6EA', line: '#EDDAE0', muted: '#A1878F', faint: '#CEB8BF', scrim: 'rgba(156,33,72,0.35)',
    }),
  },
} satisfies Record<string, { name: string; colors: Colors }>;

export type PaletteId = keyof typeof PALETTES;

const THEME_KEY = 'ui.palette';

/** Read synchronously, before any screen is drawn, so the app never flashes the wrong colours. */
function savedPalette(): PaletteId {
  try {
    const id = SecureStore.getItem(THEME_KEY);
    return id && id in PALETTES ? (id as PaletteId) : 'classic';
  } catch {
    return 'classic';
  }
}

let current: PaletteId = savedPalette();
let version = 0;
const listeners = new Set<() => void>();

/** The live palette. Mutated in place by setPalette, so `colors.ink` read at render time is current. */
export const colors: Colors = { ...PALETTES[current].colors };

export const paletteId = () => current;
export const themeVersion = () => version;

export function setPalette(id: PaletteId) {
  if (id === current) return;
  current = id;
  Object.assign(colors, PALETTES[id].colors);
  version += 1;
  try {
    SecureStore.setItem(THEME_KEY, id);
  } catch (e) {
    console.warn('Could not save the theme', e);
  }
  listeners.forEach((fn) => fn());
}

export function subscribeTheme(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Wraps a module-level StyleSheet so it's rebuilt after the palette changes. Without this, styles
 * created when a file first loads would keep the old colours.
 */
export function themed<T extends object>(make: () => T): T {
  let built: T | null = null;
  let builtFor = -1;
  const get = () => {
    if (builtFor !== version || !built) {
      built = make();
      builtFor = version;
    }
    return built;
  };
  return new Proxy({} as T, {
    get: (_, key) => get()[key as keyof T],
    has: (_, key) => key in get(),
    ownKeys: () => Reflect.ownKeys(get()),
    getOwnPropertyDescriptor: (_, key) => Reflect.getOwnPropertyDescriptor(get(), key),
  });
}

/** Blends two #RRGGBB colours; t = 0 gives a, t = 1 gives b. */
export function mix(a: string, b: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** Five steps from "nothing" to full ink, for heatmaps and stacked bars. */
export function inkRamp(c: Colors = colors) {
  return [c.divider, mix(c.divider, c.ink, 0.25), mix(c.divider, c.ink, 0.5), mix(c.divider, c.ink, 0.75), c.ink];
}

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
