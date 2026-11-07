import { MapColors, MONO_DARK } from '@/lib/mapStyle';

/** A share image is this document. Every option in the studio is just an edit to it. */

export type MetricKey = 'distance' | 'duration' | 'pace' | 'steps' | 'date' | 'type' | 'title';

export interface MetricItem {
  key: MetricKey;
  enabled: boolean;
  color?: string;
}

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayerBase {
  id: string;
  frame: Frame; // Fractions of the canvas, so changing the ratio doesn't break a design.
  opacity: number;
  visible: boolean;
  locked: boolean;
}

export interface PhotoFilter {
  preset: FilterPreset;
  brightness: number; // -1 to 1
  contrast: number; // -1 to 1
  saturation: number; // -1 to 1
  warmth: number; // -1 to 1
  vignette: number; // 0 to 1
}

export interface CollageCell {
  uri: string;
  offsetX: number;
  offsetY: number;
  scale: number;
  filter: PhotoFilter;
}

export type MapLayer = LayerBase & {
  kind: 'map';
  colors: MapColors;
  labels: boolean;
  zoomDelta: number;
  panX: number; // Logical map pixels.
  panY: number;
  cornerRadius: number;
};

export type RouteLayer = LayerBase & {
  kind: 'route';
  color: string;
  color2: string | null;
  width: number;
  glow: number;
  markers: boolean;
};

export type MetricsLayer = LayerBase & {
  kind: 'metrics';
  items: MetricItem[];
  layout: 'row' | 'column' | 'grid';
  font: FontKey;
  size: number;
  color: string;
  labelColor: string;
  showLabels: boolean;
  align: Align;
};

export type CollageLayer = LayerBase & {
  kind: 'collage';
  layoutId: string;
  gap: number;
  cornerRadius: number;
  cells: CollageCell[];
};

export type TextLayer = LayerBase & {
  kind: 'text';
  text: string;
  font: FontKey;
  size: number;
  color: string;
  align: Align;
};

export type Layer = MapLayer | RouteLayer | MetricsLayer | CollageLayer | TextLayer;
export type Align = 'start' | 'center' | 'end';
export type FontKey = 'sans' | 'light' | 'bold' | 'condensed' | 'serif' | 'mono';

export type Background =
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; from: string; to: string; angle: number }
  | { kind: 'transparent' };

export interface ShareDoc {
  version: 1;
  ratio: { w: number; h: number };
  exportWidth: 1080 | 2160;
  format: 'png' | 'jpeg';
  background: Background;
  layers: Layer[];
  trimEndsM: number;
  attributionColor: string;
}

/** The canvas is always this wide while laying out; export just multiplies it. */
export const CANVAS_W = 1080;

export function canvasHeight(doc: Pick<ShareDoc, 'ratio'>): number {
  return Math.round((CANVAS_W * doc.ratio.h) / doc.ratio.w);
}

export const RATIOS = [
  { label: '1:1', w: 1, h: 1 },
  { label: '4:5', w: 4, h: 5 },
  { label: '3:4', w: 3, h: 4 },
  { label: '9:16', w: 9, h: 16 },
  { label: '16:9', w: 16, h: 9 },
  { label: '4:3', w: 4, h: 3 },
  { label: '3:2', w: 3, h: 2 },
] as const;

export const FONT_LABEL: Record<FontKey, string> = {
  sans: 'Sans',
  light: 'Light',
  bold: 'Bold',
  condensed: 'Narrow',
  serif: 'Serif',
  mono: 'Mono',
};

export const METRIC_LABEL: Record<MetricKey, string> = {
  distance: 'Distance',
  duration: 'Duration',
  pace: 'Pace',
  steps: 'Steps',
  date: 'Date',
  type: 'Type',
  title: 'Title',
};

type Rect = [number, number, number, number];

/** Collage layouts are data, so a new one needs no new code. Rects are x, y, w, h fractions. */
export const COLLAGE_LAYOUTS: { id: string; count: number; rects: Rect[] }[] = [
  { id: '1', count: 1, rects: [[0, 0, 1, 1]] },
  { id: '2-side', count: 2, rects: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]] },
  { id: '2-stack', count: 2, rects: [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]] },
  { id: '2-big', count: 2, rects: [[0, 0, 1, 0.7], [0, 0.7, 1, 0.3]] },
  { id: '3-left', count: 3, rects: [[0, 0, 0.6, 1], [0.6, 0, 0.4, 0.5], [0.6, 0.5, 0.4, 0.5]] },
  { id: '3-right', count: 3, rects: [[0, 0, 0.4, 0.5], [0, 0.5, 0.4, 0.5], [0.4, 0, 0.6, 1]] },
  { id: '3-top', count: 3, rects: [[0, 0, 1, 0.6], [0, 0.6, 0.5, 0.4], [0.5, 0.6, 0.5, 0.4]] },
  { id: '3-bottom', count: 3, rects: [[0, 0, 0.5, 0.4], [0.5, 0, 0.5, 0.4], [0, 0.4, 1, 0.6]] },
  { id: '3-cols', count: 3, rects: [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]] },
  { id: '3-rows', count: 3, rects: [[0, 0, 1, 1 / 3], [0, 1 / 3, 1, 1 / 3], [0, 2 / 3, 1, 1 / 3]] },
  { id: '4-grid', count: 4, rects: [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]] },
  { id: '4-big', count: 4, rects: [[0, 0, 1, 0.66], [0, 0.66, 1 / 3, 0.34], [1 / 3, 0.66, 1 / 3, 0.34], [2 / 3, 0.66, 1 / 3, 0.34]] },
  { id: '5-mosaic', count: 5, rects: [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 1 / 3, 0.5], [1 / 3, 0.5, 1 / 3, 0.5], [2 / 3, 0.5, 1 / 3, 0.5]] },
  { id: '6-grid', count: 6, rects: [[0, 0, 0.5, 1 / 3], [0.5, 0, 0.5, 1 / 3], [0, 1 / 3, 0.5, 1 / 3], [0.5, 1 / 3, 0.5, 1 / 3], [0, 2 / 3, 0.5, 1 / 3], [0.5, 2 / 3, 0.5, 1 / 3]] },
];

export const MAX_PHOTOS = 6;

export function layoutsFor(count: number) {
  return COLLAGE_LAYOUTS.filter((l) => l.count === Math.min(Math.max(count, 1), MAX_PHOTOS));
}

export function layoutById(id: string, count: number) {
  const fits = layoutsFor(count);
  return fits.find((l) => l.id === id) ?? fits[0];
}

export type FilterPreset = 'original' | 'vivid' | 'warm' | 'cool' | 'fade' | 'mono' | 'noir' | 'sepia';

export const FILTER_PRESETS: { id: FilterPreset; label: string }[] = [
  { id: 'original', label: 'Original' },
  { id: 'vivid', label: 'Vivid' },
  { id: 'warm', label: 'Warm' },
  { id: 'cool', label: 'Cool' },
  { id: 'fade', label: 'Fade' },
  { id: 'mono', label: 'Mono' },
  { id: 'noir', label: 'Noir' },
  { id: 'sepia', label: 'Sepia' },
];

export const NO_FILTER: PhotoFilter = {
  preset: 'original',
  brightness: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
  vignette: 0,
};

type Adjust = { b: number; c: number; s: number; w: number; tint?: [number, number, number] };

const PRESET_ADJUST: Record<FilterPreset, Adjust> = {
  original: { b: 0, c: 0, s: 0, w: 0 },
  vivid: { b: 0, c: 0.15, s: 0.4, w: 0 },
  warm: { b: 0.02, c: 0.05, s: 0.1, w: 0.35 },
  cool: { b: 0, c: 0.05, s: 0, w: -0.35 },
  fade: { b: 0.08, c: -0.25, s: -0.2, w: 0 },
  mono: { b: 0, c: 0.05, s: -1, w: 0 },
  noir: { b: -0.05, c: 0.45, s: -1, w: 0 },
  sepia: { b: 0, c: 0, s: -1, w: 0, tint: [0.16, 0.06, -0.08] },
};

/** A 4x5 color matrix for Skia, combining the preset with the sliders. */
export function colorMatrix(f: PhotoFilter): number[] {
  const p = PRESET_ADJUST[f.preset];
  const saturation = Math.max(0, 1 + p.s + f.saturation);
  const contrast = Math.max(0, 1 + p.c + f.contrast);
  const brightness = p.b + f.brightness * 0.5;
  const warmth = (p.w + f.warmth) * 0.12;

  // Rec. 709 luminance weights.
  const lr = 0.2126;
  const lg = 0.7152;
  const lb = 0.0722;
  const s = saturation;
  const m = [
    lr * (1 - s) + s, lg * (1 - s), lb * (1 - s),
    lr * (1 - s), lg * (1 - s) + s, lb * (1 - s),
    lr * (1 - s), lg * (1 - s), lb * (1 - s) + s,
  ].map((v) => v * contrast);

  const pivot = 0.5 * (1 - contrast) + brightness;
  const tint = p.tint ?? [0, 0, 0];
  return [
    m[0], m[1], m[2], 0, pivot + warmth + tint[0],
    m[3], m[4], m[5], 0, pivot + tint[1],
    m[6], m[7], m[8], 0, pivot - warmth + tint[2],
    0, 0, 0, 1, 0,
  ];
}

let idCounter = 0;
export function newLayerId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

export function defaultMapLayer(): MapLayer {
  return {
    id: newLayerId('map'),
    kind: 'map',
    frame: { x: 0, y: 0, w: 1, h: 1 },
    opacity: 1,
    visible: true,
    locked: true,
    colors: MONO_DARK,
    labels: true,
    zoomDelta: 0,
    panX: 0,
    panY: 0,
    cornerRadius: 0,
  };
}

export function defaultRouteLayer(): RouteLayer {
  return {
    id: newLayerId('route'),
    kind: 'route',
    frame: { x: 0.08, y: 0.08, w: 0.84, h: 0.6 },
    opacity: 1,
    visible: true,
    locked: false,
    color: '#FFFFFF',
    color2: null,
    width: 9,
    glow: 0,
    markers: true,
  };
}

export function defaultMetricsLayer(): MetricsLayer {
  return {
    id: newLayerId('metrics'),
    kind: 'metrics',
    frame: { x: 0.06, y: 0.8, w: 0.88, h: 0.16 },
    opacity: 1,
    visible: true,
    locked: false,
    items: [
      { key: 'distance', enabled: true },
      { key: 'duration', enabled: true },
      { key: 'pace', enabled: true },
      { key: 'steps', enabled: false },
      { key: 'date', enabled: false },
      { key: 'type', enabled: false },
      { key: 'title', enabled: false },
    ],
    layout: 'row',
    font: 'light',
    size: 64,
    color: '#FFFFFF',
    labelColor: 'rgba(255,255,255,0.65)',
    showLabels: true,
    align: 'start',
  };
}

export function defaultCollageLayer(uris: string[]): CollageLayer {
  return {
    id: newLayerId('photos'),
    kind: 'collage',
    frame: { x: 0, y: 0, w: 1, h: 1 },
    opacity: 1,
    visible: true,
    locked: false,
    layoutId: layoutsFor(uris.length)[0].id,
    gap: 6,
    cornerRadius: 0,
    cells: uris.map((uri) => ({ uri, offsetX: 0, offsetY: 0, scale: 1, filter: NO_FILTER })),
  };
}

export function defaultTextLayer(): TextLayer {
  return {
    id: newLayerId('text'),
    kind: 'text',
    frame: { x: 0.08, y: 0.08, w: 0.84, h: 0.12 },
    opacity: 1,
    visible: true,
    locked: false,
    text: 'Morning miles',
    font: 'bold',
    size: 72,
    color: '#FFFFFF',
    align: 'start',
  };
}

export function defaultDoc(): ShareDoc {
  return {
    version: 1,
    ratio: { w: 4, h: 5 },
    exportWidth: 1080,
    format: 'png',
    background: { kind: 'solid', color: '#000000' },
    layers: [defaultMapLayer(), defaultRouteLayer(), defaultMetricsLayer()],
    trimEndsM: 0,
    attributionColor: 'rgba(255,255,255,0.6)',
  };
}

/** A preset keeps the design but not this activity's photos. */
export function toPreset(doc: ShareDoc): ShareDoc {
  return {
    ...doc,
    layers: doc.layers.filter((l) => l.kind !== 'collage').map((l) =>
      l.kind === 'map' ? { ...l, zoomDelta: 0, panX: 0, panY: 0 } : l,
    ),
  };
}

export function isOpaqueExportAllowed(doc: ShareDoc) {
  return doc.background.kind !== 'transparent';
}

/** Transparency needs PNG. A JPEG would silently turn it black. */
export function exportFormat(doc: ShareDoc): 'png' | 'jpeg' {
  return isOpaqueExportAllowed(doc) ? doc.format : 'png';
}

export function clampFrame(f: Frame): Frame {
  const w = Math.max(0.05, Math.min(f.w, 1));
  const h = Math.max(0.03, Math.min(f.h, 1));
  return {
    w,
    h,
    x: Math.max(-w * 0.9, Math.min(f.x, 0.9)),
    y: Math.max(-h * 0.9, Math.min(f.y, 0.95)),
  };
}

/** Topmost visible layer under a point, or null. Locked layers can be selected, not dragged. */
export function hitTest(layers: Layer[], x: number, y: number): Layer | null {
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const l = layers[i];
    if (!l.visible) continue;
    const { frame: f } = l;
    if (x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h) return l;
  }
  return null;
}
