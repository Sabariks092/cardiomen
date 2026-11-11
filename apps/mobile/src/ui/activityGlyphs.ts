/**
 * Cardigo's activity figures, drawn on a 48 × 48 grid and facing right. Each wears a headband tied
 * at the back of the head, with two tails: they hang for a walk, wave for a jog and stream straight
 * back for a run. Shared by the app (Skia) and the preview script, so it's plain data.
 */
export type GlyphType = 'walk' | 'jog' | 'run';

export interface Glyph {
  head: { cx: number; cy: number; r: number };
  /** The band across the head, drawn as a cut in the background colour. */
  band: [number, number, number, number];
  /** The knot at the back of the head. */
  knot: { cx: number; cy: number; r: number };
  /** The two tails, as SVG paths. */
  tails: [string, string];
  /** Torso, arms and legs, as SVG paths. */
  limbs: string[];
}

export const GLYPHS: Record<GlyphType, Glyph> = {
  walk: {
    head: { cx: 26, cy: 8.6, r: 4.6 },
    band: [20.4, 8.5, 31.6, 6.9],
    knot: { cx: 20.9, cy: 8.9, r: 1.9 },
    tails: ['M20.6 9.2 C19 9.8 18.3 11.2 17.7 12.8', 'M21.4 10.2 C20.5 11.2 20.3 12.5 20.1 14'],
    limbs: [
      'M25.8 14.6 L24.4 26.2',
      'M25.4 17 L21.2 21.6 L19.4 25.4',
      'M25.4 17 L29.6 21.4 L33 22',
      'M24.4 26.2 L28 34.4 L28.6 42.4 L32 42.6',
      'M24.4 26.2 L21.2 34.2 L18 41.4',
    ],
  },
  jog: {
    head: { cx: 28, cy: 8.6, r: 4.4 },
    band: [22.6, 8.8, 33.6, 6.6],
    knot: { cx: 23.1, cy: 9.1, r: 1.9 },
    tails: ['M22.8 9.2 C21 8.7 19.8 10 17.6 9.9', 'M23.3 10.2 C21.8 11.4 20.4 11.9 18.4 12.5'],
    limbs: [
      'M26.6 14.4 L23.6 25.6',
      'M26 16.8 L30.4 20.6 L34.2 17.6',
      'M26 16.8 L21.4 20.2 L18.6 17.6',
      'M23.6 25.6 L29.8 31.2 L28.6 39.6 L31.8 40.4',
      'M23.6 25.6 L19.8 33.4 L13.6 35.4',
    ],
  },
  run: {
    head: { cx: 31, cy: 8.6, r: 4.3 },
    band: [25.4, 9.2, 36.4, 6.2],
    knot: { cx: 26, cy: 9.6, r: 1.9 },
    tails: ['M25.6 9.4 C23.2 8.4 21.4 9.8 17.8 8.8', 'M26 10.4 C23.6 11.6 21.8 11.2 18.4 12.6'],
    limbs: [
      'M28.8 14.2 L23 25.2',
      'M27.8 16.6 L33.6 19.6 L38 15.8',
      'M27.8 16.6 L21 16.8 L17.6 21.8',
      'M23 25.2 L31.6 29.4 L31 38.6',
      'M23 25.2 L17.4 33 L8.6 35.8',
    ],
  },
};
