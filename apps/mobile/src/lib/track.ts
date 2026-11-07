import { gzip, ungzip } from 'pako';

export interface RawPoint {
  t: number;
  lat: number;
  lng: number;
  acc: number | null;
  alt?: number | null;
  ok: boolean;
  segment: number;
}

export type LngLat = [number, number];

const COORD = 1e7;

function deltas(values: number[]): number[] {
  return values.map((v, i) => (i === 0 ? v : v - values[i - 1]));
}

function undelta(values: number[]): number[] {
  const out: number[] = [];
  values.forEach((v, i) => out.push(i === 0 ? v : out[i - 1] + v));
  return out;
}

// The document is only digits and JSON punctuation, so no text encoder is needed on any platform.
function asciiToBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bytes;
}

function bytesToAscii(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  }
  return parts.join('');
}

/** Track blob format v1: gzip of JSON with delta-encoded integer columns. */
export function encodeTrack(points: RawPoint[]): Uint8Array {
  const doc = {
    v: 1,
    t: deltas(points.map((p) => p.t)),
    lat: deltas(points.map((p) => Math.round(p.lat * COORD))),
    lng: deltas(points.map((p) => Math.round(p.lng * COORD))),
    acc: points.map((p) => (p.acc == null ? -1 : Math.round(p.acc))),
    alt: points.map((p) => (p.alt == null ? null : Math.round(p.alt))),
    ok: points.map((p) => (p.ok ? 1 : 0)),
    seg: deltas(points.map((p) => p.segment)),
  };
  return gzip(asciiToBytes(JSON.stringify(doc)));
}

export function decodeTrack(blob: Uint8Array): RawPoint[] {
  const doc = JSON.parse(bytesToAscii(ungzip(blob)));
  if (doc.v !== 1) throw new Error(`Unknown track format ${doc.v}`);
  const t = undelta(doc.t);
  const lat = undelta(doc.lat);
  const lng = undelta(doc.lng);
  const seg = undelta(doc.seg);
  return t.map((time, i) => ({
    t: time,
    lat: lat[i] / COORD,
    lng: lng[i] / COORD,
    acc: doc.acc[i] < 0 ? null : doc.acc[i],
    alt: doc.alt[i],
    ok: doc.ok[i] === 1,
    segment: seg[i],
  }));
}

/** Route lines, one per segment. A gap is left where the activity was paused or interrupted. */
export function toSegments(points: Pick<RawPoint, 'lat' | 'lng' | 'ok' | 'segment'>[]): LngLat[][] {
  const lines: LngLat[][] = [];
  let currentSegment: number | null = null;
  for (const p of points) {
    if (!p.ok) continue;
    if (p.segment !== currentSegment) {
      lines.push([]);
      currentSegment = p.segment;
    }
    lines[lines.length - 1].push([p.lng, p.lat]);
  }
  return lines.filter((l) => l.length > 0);
}

export function routeGeoJSON(lines: LngLat[][]): GeoJSON.Feature<GeoJSON.MultiLineString> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'MultiLineString', coordinates: lines.filter((l) => l.length > 1) },
  };
}

export interface Bbox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export function bboxOf(lines: LngLat[][]): Bbox | null {
  let b: Bbox | null = null;
  for (const line of lines) {
    for (const [lng, lat] of line) {
      if (!b) b = { minLat: lat, minLng: lng, maxLat: lat, maxLng: lng };
      else {
        b.minLat = Math.min(b.minLat, lat);
        b.maxLat = Math.max(b.maxLat, lat);
        b.minLng = Math.min(b.minLng, lng);
        b.maxLng = Math.max(b.maxLng, lng);
      }
    }
  }
  return b;
}

/** Ramer-Douglas-Peucker on degrees, scaled for latitude. Iterative so long routes can't overflow. */
export function simplify(line: LngLat[], toleranceDeg: number): LngLat[] {
  if (line.length < 3) return line;
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  const scale = Math.cos((line[0][1] * Math.PI) / 180);
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let worstD = toleranceDeg * toleranceDeg;
    const ax = line[a][0] * scale;
    const ay = line[a][1];
    const dx = line[b][0] * scale - ax;
    const dy = line[b][1] - ay;
    const len = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i += 1) {
      const px = line[i][0] * scale - ax;
      const py = line[i][1] - ay;
      const u = len === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / len));
      const ex = px - u * dx;
      const ey = py - u * dy;
      const d = ex * ex + ey * ey;
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst > 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return line.filter((_, i) => keep[i] === 1);
}

/** Simplifies until a route fits in about `target` points, for thumbnails and lists. */
export function previewOf(lines: LngLat[][], target = 200): LngLat[][] {
  const count = (ls: LngLat[][]) => ls.reduce((n, l) => n + l.length, 0);
  let tolerance = 0.00002;
  let out = lines;
  while (count(out) > target && tolerance < 1) {
    const t = tolerance;
    out = lines.map((l) => simplify(l, t));
    tolerance *= 2;
  }
  return out;
}

/** Hides the start and end of a shared route, so an image doesn't reveal where you live. */
export function trimEnds(lines: LngLat[][], meters: number): LngLat[][] {
  if (meters <= 0) return lines;
  const flat = lines.map((l) => [...l]);
  const eat = (line: LngLat[], fromStart: boolean, budget: number) => {
    while (line.length > 1 && budget > 0) {
      const a = fromStart ? line[0] : line[line.length - 1];
      const b = fromStart ? line[1] : line[line.length - 2];
      budget -= haversineM(a, b);
      if (fromStart) line.shift();
      else line.pop();
    }
    return budget;
  };
  let budget = meters;
  for (let i = 0; i < flat.length && budget > 0; i += 1) {
    budget = eat(flat[i], true, budget);
    if (budget > 0) flat[i] = [];
  }
  budget = meters;
  for (let i = flat.length - 1; i >= 0 && budget > 0; i -= 1) {
    budget = eat(flat[i], false, budget);
    if (budget > 0) flat[i] = [];
  }
  return flat.filter((l) => l.length > 1);
}

export function haversineM(a: LngLat, b: LngLat): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

export interface Split {
  km: number;
  durationMs: number;
}

/** Time per full kilometer, using accepted points in active segments only. */
export function splitsOf(points: RawPoint[]): Split[] {
  const good = points.filter((p) => p.ok);
  const splits: Split[] = [];
  let meters = 0;
  let elapsed = 0;
  let lastSplitElapsed = 0;
  for (let i = 1; i < good.length; i += 1) {
    const a = good[i - 1];
    const b = good[i];
    if (a.segment !== b.segment) continue;
    meters += haversineM([a.lng, a.lat], [b.lng, b.lat]);
    elapsed += b.t - a.t;
    if (meters >= (splits.length + 1) * 1000) {
      splits.push({ km: splits.length + 1, durationMs: elapsed - lastSplitElapsed });
      lastSplitElapsed = elapsed;
    }
  }
  return splits;
}

/** One valid GPX file holding any number of activities, each as its own track. */
export function toGpx(tracks: { name: string; points: RawPoint[] }[]): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const trk = tracks.map(({ name, points }) => {
    const segments = new Map<number, string[]>();
    for (const p of points) {
      if (!p.ok) continue;
      const list = segments.get(p.segment) ?? [];
      list.push(`<trkpt lat="${p.lat}" lon="${p.lng}"><time>${new Date(p.t).toISOString()}</time></trkpt>`);
      segments.set(p.segment, list);
    }
    const body = [...segments.values()].map((pts) => `<trkseg>${pts.join('')}</trkseg>`).join('');
    return `<trk><name>${escape(name)}</name>${body}</trk>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Cardiomen" xmlns="http://www.topografix.com/GPX/1/1">${trk.join('')}</gpx>\n`;
}
