import { describe, expect, it } from 'vitest';
import {
  applyStyle,
  canvasHeight,
  clampFrame,
  COLLAGE_LAYOUTS,
  colorMatrix,
  currentStyle,
  defaultCollageLayer,
  defaultDoc,
  defaultMapLayer,
  defaultMetricsLayer,
  exportFormat,
  hitTest,
  layoutById,
  layoutsFor,
  MAX_PHOTOS,
  NO_FILTER,
  toPreset,
} from '../src/share/doc';
import { createHistory, push, redo, undo } from '../src/share/history';

describe('share document', () => {
  it('every ratio gives the right canvas', () => {
    expect(canvasHeight({ ratio: { w: 1, h: 1 } })).toBe(1080);
    expect(canvasHeight({ ratio: { w: 9, h: 16 } })).toBe(1920);
    expect(canvasHeight({ ratio: { w: 16, h: 9 } })).toBe(608);
  });

  it('transparency always exports as PNG, even if JPEG was chosen', () => {
    const doc = { ...defaultDoc(), format: 'jpeg' as const };
    expect(exportFormat(doc)).toBe('jpeg');
    expect(exportFormat({ ...doc, background: { kind: 'transparent' } })).toBe('png');
  });

  it('presets keep the design and drop this activity’s photos and camera', () => {
    const doc = defaultDoc();
    const map = doc.layers.find((l) => l.kind === 'map')!;
    Object.assign(map, { panX: 50, zoomDelta: 2 });
    doc.layers.push(defaultCollageLayer(['file:///a.jpg']));
    const preset = toPreset(doc);
    expect(preset.layers.some((l) => l.kind === 'collage')).toBe(false);
    const presetMap = preset.layers.find((l) => l.kind === 'map');
    expect(presetMap).toMatchObject({ panX: 0, zoomDelta: 0 });
  });

  it('frames stay reachable and a sensible size', () => {
    const f = clampFrame({ x: 5, y: -5, w: 0.0001, h: 9 });
    expect(f.w).toBeGreaterThanOrEqual(0.05);
    expect(f.h).toBeLessThanOrEqual(1);
    expect(f.x).toBeLessThanOrEqual(0.9);
    expect(f.y + f.h).toBeGreaterThan(0);
  });

  it('tapping picks the topmost visible layer', () => {
    const map = defaultMapLayer();
    const metrics = defaultMetricsLayer();
    expect(hitTest([map, metrics], 0.5, 0.9)?.id).toBe(metrics.id);
    expect(hitTest([map, metrics], 0.5, 0.1)?.id).toBe(map.id);
    expect(hitTest([map, { ...metrics, visible: false }], 0.5, 0.9)?.id).toBe(map.id);
    expect(hitTest([metrics], 0.5, 0.1)).toBeNull();
  });
});

describe('collage layouts', () => {
  it('every count up to the max has a layout', () => {
    for (let n = 1; n <= MAX_PHOTOS; n += 1) expect(layoutsFor(n).length).toBeGreaterThan(0);
  });

  it('each layout has one rect per photo, covers the frame and never overlaps', () => {
    for (const layout of COLLAGE_LAYOUTS) {
      expect(layout.rects).toHaveLength(layout.count);
      const area = layout.rects.reduce((sum, [, , w, h]) => sum + w * h, 0);
      expect(area).toBeCloseTo(1, 5);
      layout.rects.forEach(([x, y, w, h]) => {
        expect(x + w).toBeLessThanOrEqual(1.000001);
        expect(y + h).toBeLessThanOrEqual(1.000001);
      });
      layout.rects.forEach((a, i) =>
        layout.rects.forEach((b, j) => {
          if (i >= j) return;
          const overlapX = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
          const overlapY = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
          expect(overlapX > 1e-6 && overlapY > 1e-6).toBe(false);
        }),
      );
    }
  });

  it('a stale layout falls back when the photo count changes', () => {
    expect(layoutById('4-grid', 2).count).toBe(2);
    expect(layoutById('2-side', 2).id).toBe('2-side');
  });
});

describe('photo filters', () => {
  const apply = (m: number[], [r, g, b]: number[]) => [
    m[0] * r + m[1] * g + m[2] * b + m[4],
    m[5] * r + m[6] * g + m[7] * b + m[9],
    m[10] * r + m[11] * g + m[12] * b + m[14],
  ];

  it('Original changes nothing', () => {
    const out = apply(colorMatrix(NO_FILTER), [0.2, 0.5, 0.8]);
    expect(out[0]).toBeCloseTo(0.2);
    expect(out[1]).toBeCloseTo(0.5);
    expect(out[2]).toBeCloseTo(0.8);
  });

  it('Mono removes all color', () => {
    const [r, g, b] = apply(colorMatrix({ ...NO_FILTER, preset: 'mono', contrast: 0 }), [0.9, 0.1, 0.3]);
    expect(r).toBeCloseTo(g);
    expect(g).toBeCloseTo(b);
  });

  it('brightness brightens, warmth warms', () => {
    const base = [0.5, 0.5, 0.5];
    expect(apply(colorMatrix({ ...NO_FILTER, brightness: 0.5 }), base)[0]).toBeGreaterThan(0.5);
    const warm = apply(colorMatrix({ ...NO_FILTER, warmth: 1 }), base);
    expect(warm[0]).toBeGreaterThan(warm[2]);
  });

  it('never produces a negative saturation, whatever the sliders say', () => {
    const m = colorMatrix({ ...NO_FILTER, preset: 'mono', saturation: -1 });
    expect(m.every(Number.isFinite)).toBe(true);
    const [r, g] = apply(m, [1, 0, 0]);
    expect(r).toBeCloseTo(g);
  });
});

describe('undo history', () => {
  it('undoes and redoes', () => {
    let h = createHistory(1);
    h = push(h, 2, null, 0);
    h = push(h, 3, null, 1000);
    expect(undo(h).present).toBe(2);
    expect(redo(undo(h)).present).toBe(3);
  });

  it('one slider drag is one undo step', () => {
    let h = createHistory(0);
    for (let i = 1; i <= 20; i += 1) h = push(h, i, 'slider', i * 16);
    expect(h.present).toBe(20);
    expect(undo(h).present).toBe(0);
  });

  it('a pause or a different control starts a new step', () => {
    let h = createHistory(0);
    h = push(h, 1, 'a', 0);
    h = push(h, 2, 'a', 5000);
    expect(undo(h).present).toBe(1);
    h = push(h, 3, 'b', 5001);
    expect(undo(h).present).toBe(2);
  });

  it('a new edit clears redo, and undo at the start is harmless', () => {
    let h = createHistory(0);
    h = push(h, 1, null, 0);
    h = push(undo(h), 2, null, 1);
    expect(h.future).toEqual([]);
    expect(undo(createHistory(5)).present).toBe(5);
  });
});

describe('share styles', () => {
  const layer = (doc: ReturnType<typeof defaultDoc>, kind: string) => doc.layers.find((l) => l.kind === kind)!;
  const index = (doc: ReturnType<typeof defaultDoc>, kind: string) => doc.layers.findIndex((l) => l.kind === kind);

  it('photo + route puts the photo behind the route and metrics, with no map', () => {
    const doc = applyStyle(defaultDoc(), 'photo-route', ['file:///a.jpg']);
    expect(layer(doc, 'map').visible).toBe(false);
    expect(layer(doc, 'collage').visible).toBe(true);
    expect(index(doc, 'collage')).toBeLessThan(index(doc, 'route'));
    expect(index(doc, 'collage')).toBeLessThan(index(doc, 'metrics'));
    expect(layer(doc, 'route').locked).toBe(false);
    expect(currentStyle(doc)).toBe('photo-route');
  });

  it('photo + map shows the map as a movable part of the image, over the photo', () => {
    const doc = applyStyle(defaultDoc(), 'photo-map', ['file:///a.jpg']);
    const map = layer(doc, 'map');
    expect(map.visible && !map.locked).toBe(true);
    expect(map.frame.w).toBeLessThan(1);
    expect(index(doc, 'collage')).toBeLessThan(index(doc, 'map'));
    expect(index(doc, 'map')).toBeLessThan(index(doc, 'route'));
    expect(currentStyle(doc)).toBe('photo-map');
  });

  it('the map box stays square on every ratio', () => {
    for (const ratio of [{ w: 1, h: 1 }, { w: 9, h: 16 }, { w: 4, h: 5 }]) {
      const doc = applyStyle({ ...defaultDoc(), ratio }, 'photo-map', ['file:///a.jpg']);
      const { w, h } = layer(doc, 'map').frame;
      expect(w * 1080).toBeCloseTo((h * 1080 * ratio.h) / ratio.w, 3);
    }
  });

  it('switching styles never loses photos', () => {
    let doc = applyStyle(defaultDoc(), 'photo-route', ['file:///a.jpg', 'file:///b.jpg']);
    doc = applyStyle(doc, 'map');
    expect(layer(doc, 'collage').visible).toBe(false);
    expect(currentStyle(doc)).toBe('map');
    doc = applyStyle(doc, 'photo-route');
    expect(layer(doc, 'collage').visible).toBe(true);
    expect((layer(doc, 'collage') as { cells: unknown[] }).cells).toHaveLength(2);
  });

  it('the transparent style exports as PNG, and leaving it restores a background', () => {
    let doc = applyStyle({ ...defaultDoc(), format: 'jpeg' }, 'sticker');
    expect(exportFormat(doc)).toBe('png');
    expect(currentStyle(doc)).toBe('sticker');
    doc = applyStyle(doc, 'map');
    expect(doc.background.kind).toBe('solid');
  });

  it('keeps extra layers such as text', () => {
    const base = defaultDoc();
    base.layers.push({ ...defaultMapLayer(), id: 'x', kind: 'text', text: 'Hi', font: 'sans', size: 40, color: '#fff', align: 'start' } as never);
    expect(applyStyle(base, 'photo-route', ['file:///a.jpg']).layers.some((l) => l.id === 'x')).toBe(true);
  });
});
