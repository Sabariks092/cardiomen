import { describe, expect, it } from 'vitest';
import { averagePace, formatDuration, formatPace, localDateOf } from '../src/lib/format';
import { fitCamera, project, toImagePoint, unproject } from '../src/lib/mapStyle';
import { buildBars, heatLevel, heatmapWeeks, periodFor, startOfWeek, totals } from '../src/lib/stats';
import {
  bboxOf,
  decodeTrack,
  encodeTrack,
  haversineM,
  LngLat,
  previewOf,
  RawPoint,
  simplify,
  splitsOf,
  toGpx,
  toSegments,
  trimEnds,
} from '../src/lib/track';
import { base64ToBytes, bytesToBase64 } from '../src/sync/base64';

function walk(count: number, segment = 1, startT = 1_762_500_000_000): RawPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    t: startT + i * 1000,
    lat: 12.9716 + i * 0.00002,
    lng: 77.5946 + i * 0.00001,
    acc: 5,
    alt: 900,
    ok: true,
    segment,
  }));
}

describe('format', () => {
  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
    expect(formatDuration(-5)).toBe('0:00');
  });

  it('hides pace when there is not enough data', () => {
    expect(formatPace(null)).toBe('--:--');
    expect(formatPace(Infinity)).toBe('--:--');
    expect(formatPace(330)).toBe('5:30');
    expect(averagePace(1000, 2)).toBeNull();
  });

  it('dates an activity where it happened', () => {
    // 20:00 UTC is already the next day in India (+5:30).
    const t = Date.UTC(2026, 10, 7, 20, 0);
    expect(localDateOf(t, 330)).toBe('2026-11-08');
    expect(localDateOf(t, -300)).toBe('2026-11-07');
  });
});

describe('stats', () => {
  it('finds the start of a week, for either setting', () => {
    expect(startOfWeek('2026-11-07', 1)).toBe('2026-11-02'); // A Saturday.
    expect(startOfWeek('2026-11-07', 0)).toBe('2026-11-01');
    expect(startOfWeek('2026-11-02', 1)).toBe('2026-11-02');
  });

  it('builds periods', () => {
    const week = periodFor('week', 0, '2026-11-07', 1);
    expect([week.from, week.to]).toEqual(['2026-11-02', '2026-11-08']);
    expect(periodFor('week', 1, '2026-11-07', 1).from).toBe('2026-10-26');
    const feb = periodFor('month', 9, '2026-11-15', 1);
    expect([feb.from, feb.to, feb.bars.length]).toEqual(['2026-02-01', '2026-02-28', 28]);
    expect(periodFor('year', 0, '2026-11-07', 1).bars).toHaveLength(12);
  });

  it('crosses a year boundary', () => {
    expect(periodFor('month', 11, '2026-11-15', 1).from).toBe('2025-12-01');
  });

  it('sums the right days into bars and totals', () => {
    const period = periodFor('week', 0, '2026-11-07', 1);
    const rows = [
      { localDate: '2026-11-03', activeMs: 100, distanceM: 10, steps: 5, sessions: 1 },
      { localDate: '2026-11-03', activeMs: 50, distanceM: 5, steps: 5, sessions: 1 },
      { localDate: '2026-11-09', activeMs: 999, distanceM: 999, steps: 999, sessions: 9 },
    ];
    expect(buildBars(period, rows, 'active')[1].value).toBe(150);
    expect(buildBars(period, rows, 'sessions').reduce((s, b) => s + b.value, 0)).toBe(2);
    expect(totals(rows.slice(0, 2)).distanceM).toBe(15);
  });

  it('the heatmap ends today and never shows future days', () => {
    const weeks = heatmapWeeks('2026-11-04', 53, 1); // A Wednesday.
    expect(weeks).toHaveLength(53);
    const last = weeks[52];
    expect(last[2]).toBe('2026-11-04');
    expect(last[3]).toBeNull();
    expect(weeks[0][0]).toBe('2025-11-03');
  });

  it('scales heat to the busiest day', () => {
    expect(heatLevel(0, 100)).toBe(0);
    expect(heatLevel(10, 100)).toBe(1);
    expect(heatLevel(100, 100)).toBe(4);
    expect(heatLevel(5, 0)).toBe(0);
  });
});

describe('track encoding', () => {
  it('round-trips with no meaningful loss', () => {
    const points = [...walk(500), ...walk(500, 2, 1_762_501_000_000)];
    points[3].ok = false;
    points[4].acc = null;
    const decoded = decodeTrack(encodeTrack(points));
    expect(decoded).toHaveLength(1000);
    decoded.forEach((p, i) => {
      expect(p.t).toBe(points[i].t);
      expect(p.lat).toBeCloseTo(points[i].lat, 6);
      expect(p.lng).toBeCloseTo(points[i].lng, 6);
      expect(p.ok).toBe(points[i].ok);
      expect(p.segment).toBe(points[i].segment);
    });
    expect(decoded[4].acc).toBeNull();
  });

  it('handles an empty recording', () => {
    expect(decodeTrack(encodeTrack([]))).toEqual([]);
  });

  it('an hour of 1-second points stays small', () => {
    const size = encodeTrack(walk(3600)).length;
    expect(size).toBeLessThan(60_000);
  });
});

describe('route shapes', () => {
  it('leaves a gap at an interruption, instead of a straight line across it', () => {
    const lines = toSegments([...walk(3, 1), ...walk(3, 2)]);
    expect(lines).toHaveLength(2);
  });

  it('draws only accepted points', () => {
    const pts = walk(3);
    pts[1].ok = false;
    expect(toSegments(pts)[0]).toHaveLength(2);
  });

  it('finds the bounding box, or nothing for an empty route', () => {
    expect(bboxOf([])).toBeNull();
    const box = bboxOf([[[1, 2], [3, 0]]])!;
    expect([box.minLng, box.maxLng, box.minLat, box.maxLat]).toEqual([1, 3, 0, 2]);
  });

  it('simplifying keeps the shape and both ends', () => {
    const line: LngLat[] = Array.from({ length: 1000 }, (_, i) => [77 + i * 1e-5, 12 + Math.sin(i / 50) * 1e-3]);
    const out = simplify(line, 1e-5);
    expect(out.length).toBeLessThan(line.length / 2);
    expect(out[0]).toEqual(line[0]);
    expect(out[out.length - 1]).toEqual(line[999]);
  });

  it('previews fit the target', () => {
    const line: LngLat[] = Array.from({ length: 5000 }, (_, i) => [77 + i * 1e-5, 12 + Math.sin(i / 20) * 1e-3]);
    const count = previewOf([line], 200).reduce((n, l) => n + l.length, 0);
    expect(count).toBeLessThanOrEqual(200);
  });

  it('the privacy trim really removes the start and end', () => {
    const line: LngLat[] = Array.from({ length: 101 }, (_, i) => [77.5, 12.9 + i * 0.0001]); // ~1.1 km
    const trimmed = trimEnds([line], 200)[0];
    expect(haversineM(line[0], trimmed[0])).toBeGreaterThanOrEqual(200);
    expect(haversineM(line[100], trimmed[trimmed.length - 1])).toBeGreaterThanOrEqual(200);
    expect(trimmed.length).toBeLessThan(line.length);
  });

  it('a route shorter than the trim shows nothing rather than leaking location', () => {
    const line: LngLat[] = [[77.5, 12.9], [77.5, 12.9005]];
    expect(trimEnds([line], 200)).toEqual([]);
  });

  it('leaves the route alone when the trim is off', () => {
    const lines: LngLat[][] = [[[1, 1], [2, 2]]];
    expect(trimEnds(lines, 0)).toBe(lines);
  });

  it('computes splits, ignoring time across a pause', () => {
    const a = walk(300, 1);
    const b = walk(300, 2, a[299].t + 3_600_000).map((p) => ({ ...p, lat: p.lat + 0.006 }));
    const splits = splitsOf([...a, ...b]);
    expect(splits.length).toBeGreaterThan(0);
    splits.forEach((s) => expect(s.durationMs).toBeLessThan(3_600_000));
  });

  it('GPX is one valid document with multiple tracks and escaped names', () => {
    const gpx = toGpx([
      { name: 'A & B', points: walk(2) },
      { name: 'C', points: walk(2, 2) },
    ]);
    expect(gpx.match(/<gpx /g)).toHaveLength(1);
    expect(gpx.match(/<trk>/g)).toHaveLength(2);
    expect(gpx).toContain('A &amp; B');
  });
});

describe('map math', () => {
  it('project and unproject are inverses', () => {
    const [x, y] = project(77.5946, 12.9716, 15);
    const [lng, lat] = unproject(x, y, 15);
    expect(lng).toBeCloseTo(77.5946, 6);
    expect(lat).toBeCloseTo(12.9716, 6);
  });

  it('the camera center lands exactly mid-image', () => {
    const camera = { lng: 77.59, lat: 12.97, zoom: 14 };
    expect(toImagePoint(77.59, 12.97, camera, 540, 675)).toEqual([270, 337.5]);
  });

  it('a fitted camera keeps the whole route inside the image', () => {
    const box = { minLat: 12.96, minLng: 77.58, maxLat: 12.99, maxLng: 77.62 };
    for (const [w, h] of [[540, 675], [540, 960], [540, 304]]) {
      const camera = fitCamera(box, w, h);
      for (const [lng, lat] of [[box.minLng, box.minLat], [box.maxLng, box.maxLat]]) {
        const [x, y] = toImagePoint(lng, lat, camera, w, h);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(w);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(h);
      }
    }
  });

  it('survives a single-point route', () => {
    const camera = fitCamera({ minLat: 12.9, minLng: 77.5, maxLat: 12.9, maxLng: 77.5 }, 540, 540);
    expect(camera.zoom).toBeLessThanOrEqual(17);
    expect(Number.isFinite(camera.lat)).toBe(true);
  });

  it('double size at zoom +1 shows the same view, so high-res exports stay aligned', () => {
    const camera = { lng: 77.59, lat: 12.97, zoom: 14 };
    const [x1, y1] = toImagePoint(77.6, 12.98, camera, 540, 675);
    const [x2, y2] = toImagePoint(77.6, 12.98, { ...camera, zoom: 15 }, 1080, 1350);
    expect(x2).toBeCloseTo(x1 * 2, 6);
    expect(y2).toBeCloseTo(y1 * 2, 6);
  });
});

describe('base64', () => {
  it('round-trips every length, matching the standard encoding', () => {
    for (let len = 0; len < 50; len += 1) {
      const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 37 + len) % 256);
      const encoded = bytesToBase64(bytes);
      expect(encoded).toBe(Buffer.from(bytes).toString('base64'));
      expect([...base64ToBytes(encoded)]).toEqual([...bytes]);
    }
  });

  it('rejects garbage', () => {
    expect(() => base64ToBytes('@@@@')).toThrow();
  });
});
