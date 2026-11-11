/**
 * Everything Cardigo says about your progress is calculated here, from recorded activities only.
 * Pure functions, so every number and every sentence is unit tested.
 */
import { averagePace, distanceValue, formatDuration, formatPace, Units } from './format';
import { addDays, Period, periodFor, startOfWeek, WeekStart } from './stats';
import { haversineM, LngLat, RawPoint } from './track';

export type Kind = 'walk' | 'jog' | 'run';

export interface ActivityLite {
  id: string;
  type: Kind;
  startedAt: number;
  tzOffsetMin: number;
  localDate: string;
  activeMs: number;
  elapsedMs: number;
  distanceM: number;
  steps: number | null;
}

/** A pace only means something over a real distance. Shorter activities are left out of pace stats. */
export const MIN_PACE_DISTANCE_M = 1000;

export interface Summary {
  sessions: number;
  distanceM: number;
  activeMs: number;
  steps: number;
  activeDays: number;
  /** Seconds per km over every activity long enough to have a pace, or null. */
  avgPace: number | null;
  longestM: number;
  longestMs: number;
  /** Fastest average pace of a single activity of at least 1 km, or null. */
  fastestPace: number | null;
}

export function summarize(list: ActivityLite[]): Summary {
  let paceMs = 0;
  let paceM = 0;
  let fastest: number | null = null;
  const days = new Set<string>();
  const s: Summary = {
    sessions: 0,
    distanceM: 0,
    activeMs: 0,
    steps: 0,
    activeDays: 0,
    avgPace: null,
    longestM: 0,
    longestMs: 0,
    fastestPace: null,
  };
  for (const a of list) {
    s.sessions += 1;
    s.distanceM += a.distanceM;
    s.activeMs += a.activeMs;
    s.steps += a.steps ?? 0;
    s.longestM = Math.max(s.longestM, a.distanceM);
    s.longestMs = Math.max(s.longestMs, a.activeMs);
    days.add(a.localDate);
    if (a.distanceM >= MIN_PACE_DISTANCE_M && a.activeMs > 0) {
      paceMs += a.activeMs;
      paceM += a.distanceM;
      const p = averagePace(a.activeMs, a.distanceM);
      if (p != null && (fastest == null || p < fastest)) fastest = p;
    }
  }
  s.activeDays = days.size;
  s.avgPace = paceM > 0 ? averagePace(paceMs, paceM) : null;
  s.fastestPace = fastest;
  return s;
}

export function inRange<T extends { localDate: string }>(list: T[], from: string, to: string): T[] {
  return list.filter((a) => a.localDate >= from && a.localDate <= to);
}

export type RangeKind = 'week' | 'month' | 'year' | 'all';

export interface DateRange {
  from: string;
  to: string;
  title: string;
}

/** The current range (offset 0) or one before it. "All time" has no previous range. */
export function rangeOf(kind: RangeKind, offset: number, today: string, weekStart: WeekStart): DateRange {
  if (kind === 'all') return { from: '0000-01-01', to: '9999-12-31', title: 'All time' };
  const p = periodFor(kind, offset, today, weekStart);
  return { from: p.from, to: p.to, title: p.title };
}

/** Percent change, or null when there's nothing to compare against. */
export function percentChange(current: number, previous: number): number | null {
  if (!(previous > 0)) return null;
  return ((current - previous) / previous) * 100;
}

export interface Comparison {
  distance: number | null;
  duration: number | null;
  sessions: number | null;
  /** Seconds per km. Negative means faster. Null unless both periods have a pace. */
  paceDeltaSec: number | null;
}

export function compare(current: Summary, previous: Summary): Comparison {
  return {
    distance: percentChange(current.distanceM, previous.distanceM),
    duration: percentChange(current.activeMs, previous.activeMs),
    sessions: percentChange(current.sessions, previous.sessions),
    paceDeltaSec:
      current.avgPace != null && previous.avgPace != null ? current.avgPace - previous.avgPace : null,
  };
}

const PERIOD_WORD = { week: 'week', month: 'month', year: 'year' } as const;
const TYPE_NOUN = { walk: 'walks', jog: 'jogs', run: 'runs' } as const;

function unitWord(units: Units) {
  return units === 'mi' ? 'mi' : 'km';
}

/**
 * Plain sentences about the change from the previous period. Says nothing it can't back up: no
 * comparison without activity in both periods, no pace claim without real distance in both.
 */
export function insights(
  list: ActivityLite[],
  current: DateRange,
  previous: DateRange,
  period: 'week' | 'month' | 'year',
  units: Units,
): string[] {
  const cur = summarize(inRange(list, current.from, current.to));
  const prev = summarize(inRange(list, previous.from, previous.to));
  const word = PERIOD_WORD[period];
  const u = unitWord(units);
  const out: string[] = [];
  if (cur.sessions === 0) {
    if (prev.sessions > 0) out.push(`No activities yet this ${word}. Last ${word} you did ${prev.sessions}.`);
    return out;
  }

  if (prev.sessions > 0) {
    const diff = distanceValue(cur.distanceM - prev.distanceM, units);
    if (Math.abs(diff) >= 0.1) {
      out.push(
        `You covered ${Math.abs(diff).toFixed(1)} ${u} ${diff > 0 ? 'more' : 'less'} than last ${word}.`,
      );
    }
    if (cur.avgPace != null && prev.avgPace != null) {
      const unitFactor = units === 'mi' ? 1.609344 : 1;
      const delta = Math.round((cur.avgPace - prev.avgPace) * unitFactor);
      if (Math.abs(delta) >= 5) {
        out.push(
          delta < 0
            ? `Your average pace improved by ${secondsPhrase(-delta)} per ${u}.`
            : `Your average pace was ${secondsPhrase(delta)} per ${u} slower than last ${word}.`,
        );
      }
    }
  }

  out.push(`You were active on ${cur.activeDays} ${cur.activeDays === 1 ? 'day' : 'days'} this ${word}.`);

  if (cur.sessions >= 3) {
    const counts = countBy(inRange(list, current.from, current.to), (a) => a.type);
    const [top, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] as [Kind, number];
    if (n / cur.sessions > 0.5) out.push(`Most of your sessions this ${word} were ${TYPE_NOUN[top]}.`);
  }
  return out;
}

function secondsPhrase(sec: number) {
  if (sec < 60) return `${sec} seconds`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? `${m} min` : `${m} min ${s} s`;
}

function countBy<T>(list: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of list) out[key(t)] = (out[key(t)] ?? 0) + 1;
  return out;
}

export interface TrendPoint {
  key: string;
  label: string;
  distanceM: number;
  activeMs: number;
  /** Null when the bucket has too little distance for a pace to mean anything. */
  pace: number | null;
}

export function trend(list: ActivityLite[], period: Period): TrendPoint[] {
  return period.bars.map((b) => {
    const items = inRange(list, b.from, b.to);
    const s = summarize(items);
    return { key: b.key, label: b.label, distanceM: s.distanceM, activeMs: s.activeMs, pace: s.avgPace };
  });
}

export function typeDistribution(list: ActivityLite[]) {
  const total = list.length;
  return (['walk', 'jog', 'run'] as const).map((type) => {
    const items = list.filter((a) => a.type === type);
    return {
      type,
      sessions: items.length,
      distanceM: items.reduce((n, a) => n + a.distanceM, 0),
      share: total > 0 ? items.length / total : 0,
    };
  });
}

/** Active days in each of the last `weeks` weeks, oldest first. */
export function weeklyConsistency(list: ActivityLite[], today: string, weekStart: WeekStart, weeks = 12) {
  const current = startOfWeek(today, weekStart);
  return Array.from({ length: weeks }, (_, i) => {
    const from = addDays(current, -7 * (weeks - 1 - i));
    const to = addDays(from, 6);
    const days = new Set(inRange(list, from, to).map((a) => a.localDate));
    return { from, activeDays: days.size };
  });
}

// ---------- Records and achievements ----------

export interface Records {
  longestDistance: ActivityLite | null;
  longestDuration: ActivityLite | null;
  fastestPace: { activity: ActivityLite; pace: number } | null;
  mostSteps: ActivityLite | null;
  bestKm: { activityId: string; ms: number } | null;
}

export function personalRecords(list: ActivityLite[], bestKm: { activityId: string; ms: number } | null = null): Records {
  let longestDistance: ActivityLite | null = null;
  let longestDuration: ActivityLite | null = null;
  let fastest: Records['fastestPace'] = null;
  let mostSteps: ActivityLite | null = null;
  for (const a of list) {
    if (a.distanceM > 0 && (!longestDistance || a.distanceM > longestDistance.distanceM)) longestDistance = a;
    if (a.activeMs > 0 && (!longestDuration || a.activeMs > longestDuration.activeMs)) longestDuration = a;
    if (a.steps != null && a.steps > 0 && (!mostSteps || a.steps > (mostSteps.steps ?? 0))) mostSteps = a;
    if (a.distanceM >= MIN_PACE_DISTANCE_M) {
      const p = averagePace(a.activeMs, a.distanceM);
      if (p != null && (!fastest || p < fastest.pace)) fastest = { activity: a, pace: p };
    }
  }
  return { longestDistance, longestDuration, fastestPace: fastest, mostSteps, bestKm };
}

export interface Achievement {
  id: string;
  title: string;
  detail: string;
  achieved: boolean;
  /** 0 to 1, for ones still in progress. */
  progress: number;
  /** When it was earned, if known. */
  achievedOn: string | null;
}

/** Earned from recorded data only. Order matters: list is assumed newest first or any order. */
export function achievements(
  list: ActivityLite[],
  weekStart: WeekStart,
  units: Units,
  bestKm: { activityId: string; ms: number } | null = null,
): Achievement[] {
  const chrono = [...list].sort((a, b) => a.startedAt - b.startedAt);
  const firstWhere = (pred: (a: ActivityLite) => boolean) => chrono.find(pred)?.localDate ?? null;
  const total = chrono.reduce((n, a) => n + a.distanceM, 0);
  const totalReached = (meters: number) => {
    let run = 0;
    for (const a of chrono) {
      run += a.distanceM;
      if (run >= meters) return a.localDate;
    }
    return null;
  };
  const longest = chrono.reduce<ActivityLite | null>((m, a) => (!m || a.distanceM > m.distanceM ? a : m), null);
  const longestSingle = longest?.distanceM ?? 0;

  // Weeks with at least 3 active days.
  const weekDays = new Map<string, Set<string>>();
  for (const a of chrono) {
    const w = startOfWeek(a.localDate, weekStart);
    const set = weekDays.get(w) ?? new Set<string>();
    set.add(a.localDate);
    weekDays.set(w, set);
  }
  const consistentWeeks = [...weekDays.values()].filter((d) => d.size >= 3).length;
  const u = unitWord(units);
  const dist = (m: number) => `${distanceValue(m, units).toFixed(1)} ${u}`;

  const single = (id: string, title: string, meters: number): Achievement => {
    const on = firstWhere((a) => a.distanceM >= meters);
    return {
      id,
      title,
      detail: on ? `Done on ${on}` : `Best so far ${dist(longestSingle)}`,
      achieved: !!on,
      progress: Math.min(1, longestSingle / meters),
      achievedOn: on,
    };
  };
  const cumulative = (id: string, title: string, meters: number): Achievement => {
    const on = totalReached(meters);
    return {
      id,
      title,
      detail: on ? `Reached on ${on}` : `${dist(total)} of ${dist(meters)}`,
      achieved: !!on,
      progress: Math.min(1, total / meters),
      achievedOn: on,
    };
  };
  const weeks = (id: string, title: string, n: number): Achievement => ({
    id,
    title,
    detail: `${Math.min(consistentWeeks, n)} of ${n} weeks with 3+ active days`,
    achieved: consistentWeeks >= n,
    progress: Math.min(1, consistentWeeks / n),
    achievedOn: null,
  });

  const first = chrono[0];
  return [
    {
      id: 'first',
      title: 'First activity',
      detail: first ? `Recorded on ${first.localDate}` : 'Record your first walk, jog or run',
      achieved: !!first,
      progress: first ? 1 : 0,
      achievedOn: first?.localDate ?? null,
    },
    single('first-5k', 'First 5 km', 5000),
    single('first-10k', 'First 10 km', 10000),
    cumulative('total-50', '50 km total', 50000),
    cumulative('total-100', '100 km total', 100000),
    {
      id: 'fastest-km',
      title: 'Fastest kilometre',
      detail: bestKm ? `${formatDuration(bestKm.ms)} for 1 km` : 'Complete a full kilometre',
      achieved: !!bestKm,
      progress: bestKm ? 1 : Math.min(1, longestSingle / 1000),
      achievedOn: null,
    },
    {
      id: 'longest',
      title: 'Longest activity',
      detail: longest ? `${dist(longest.distanceM)} on ${longest.localDate}` : 'Nothing recorded yet',
      achieved: !!longest && longest.distanceM > 0,
      progress: longest && longest.distanceM > 0 ? 1 : 0,
      achievedOn: longest?.localDate ?? null,
    },
    weeks('consistent-1', 'Consistent week', 1),
    weeks('consistent-4', '4 consistent weeks', 4),
    weeks('consistent-12', '12 consistent weeks', 12),
  ];
}

// ---------- Goals ----------

export type GoalKind =
  | 'distance_week'
  | 'distance_month'
  | 'activities_month'
  | 'active_days_week'
  | 'single_distance'
  | 'total_distance';

export interface Goal {
  id: string;
  kind: GoalKind;
  /** Meters for distance goals, a count otherwise. */
  target: number;
  activityType: Kind | null;
  paused: boolean;
  createdAt: number;
  achievedPeriod: string | null;
}

export const GOAL_KINDS: { value: GoalKind; label: string; distance: boolean }[] = [
  { value: 'distance_week', label: 'Weekly distance', distance: true },
  { value: 'distance_month', label: 'Monthly distance', distance: true },
  { value: 'activities_month', label: 'Activities per month', distance: false },
  { value: 'active_days_week', label: 'Active days per week', distance: false },
  { value: 'single_distance', label: 'One continuous activity', distance: true },
  { value: 'total_distance', label: 'Total distance', distance: true },
];

const VERB = { walk: 'Walk', jog: 'Jog', run: 'Run' } as const;

export function goalTitle(g: Pick<Goal, 'kind' | 'target' | 'activityType'>, units: Units): string {
  const d = `${trimNumber(distanceValue(g.target, units))} ${unitWord(units)}`;
  const verb = g.activityType ? VERB[g.activityType] : 'Cover';
  switch (g.kind) {
    case 'distance_week':
      return `${verb} ${d} this week`;
    case 'distance_month':
      return `${verb} ${d} this month`;
    case 'activities_month':
      return `Complete ${g.target} ${g.activityType ? TYPE_NOUN[g.activityType] : 'activities'} this month`;
    case 'active_days_week':
      return `Be active ${g.target} days a week`;
    case 'single_distance':
      return `${verb} ${d} in one go`;
    case 'total_distance':
      return `Reach ${d} in total`;
  }
}

function trimNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export interface GoalProgress {
  current: number;
  target: number;
  fraction: number;
  /** Identifies this goal's period, so a weekly goal can be achieved again each week. */
  periodKey: string;
  done: boolean;
}

export function goalProgress(g: Goal, list: ActivityLite[], today: string, weekStart: WeekStart): GoalProgress {
  const items = g.activityType ? list.filter((a) => a.type === g.activityType) : list;
  let current = 0;
  let periodKey = 'all';
  const week = () => {
    const from = startOfWeek(today, weekStart);
    periodKey = `w:${from}`;
    return inRange(items, from, addDays(from, 6));
  };
  const month = () => {
    const prefix = today.slice(0, 7);
    periodKey = `m:${prefix}`;
    return items.filter((a) => a.localDate.startsWith(prefix));
  };
  switch (g.kind) {
    case 'distance_week':
      current = week().reduce((n, a) => n + a.distanceM, 0);
      break;
    case 'distance_month':
      current = month().reduce((n, a) => n + a.distanceM, 0);
      break;
    case 'activities_month':
      current = month().length;
      break;
    case 'active_days_week':
      current = new Set(week().map((a) => a.localDate)).size;
      break;
    case 'single_distance':
      current = items.reduce((m, a) => Math.max(m, a.distanceM), 0);
      break;
    case 'total_distance':
      current = items.reduce((n, a) => n + a.distanceM, 0);
      break;
  }
  const fraction = g.target > 0 ? Math.min(1, current / g.target) : 0;
  return { current, target: g.target, fraction, periodKey, done: current >= g.target && g.target > 0 };
}

// ---------- Routes ----------

function flatten(lines: LngLat[][]): LngLat[] {
  return lines.flat();
}

function lengthM(points: LngLat[]) {
  let m = 0;
  for (let i = 1; i < points.length; i += 1) m += haversineM(points[i - 1], points[i]);
  return m;
}

/** Evenly spaced points along a route, so routes recorded at different rates compare fairly. */
export function resample(points: LngLat[], count: number): LngLat[] {
  if (points.length < 2) return points;
  const total = lengthM(points);
  if (total === 0) return [points[0]];
  const step = total / (count - 1);
  const out: LngLat[] = [points[0]];
  let walked = 0;
  let target = step;
  for (let i = 1; i < points.length && out.length < count - 1; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const seg = haversineM(a, b);
    while (seg > 0 && walked + seg >= target && out.length < count - 1) {
      const f = (target - walked) / seg;
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
      target += step;
    }
    walked += seg;
  }
  out.push(points[points.length - 1]);
  return out;
}

function meanNearest(from: LngLat[], to: LngLat[]) {
  let sum = 0;
  for (const p of from) {
    let best = Infinity;
    for (const q of to) best = Math.min(best, haversineM(p, q));
    sum += best;
  }
  return sum / from.length;
}

export interface RouteMatch {
  similar: boolean;
  /** Average distance between the two paths, in meters. */
  deviationM: number;
}

/**
 * Same route or not, by shape: similar length, starts and ends near each other, and the paths
 * stay close all the way. Matching distance alone is never enough.
 */
export function routeSimilarity(a: LngLat[][], b: LngLat[][], maxDeviationM = 40): RouteMatch {
  const pa = flatten(a);
  const pb = flatten(b);
  const la = lengthM(pa);
  const lb = lengthM(pb);
  if (pa.length < 2 || pb.length < 2 || la < 200 || lb < 200) return { similar: false, deviationM: Infinity };
  const ratio = la / lb;
  if (ratio < 0.8 || ratio > 1.25) return { similar: false, deviationM: Infinity };
  const ra = resample(pa, 60);
  const rb = resample(pb, 60);
  const ends = Math.max(haversineM(ra[0], rb[0]), haversineM(ra[ra.length - 1], rb[rb.length - 1]));
  if (ends > 150) return { similar: false, deviationM: Infinity };
  const deviationM = Math.max(meanNearest(ra, rb), meanNearest(rb, ra));
  return { similar: deviationM <= maxDeviationM, deviationM };
}

// ---------- Per-track stats ----------

export interface TrackStats {
  bestKmMs: number | null;
  maxSpeedMps: number | null;
  elevationGainM: number | null;
}

/**
 * Best 1 km, top speed and climb, from accepted points in active segments only. Speed is measured
 * over at least 10 seconds, so a single GPS jump can't create a fake top speed.
 */
export function trackStats(points: RawPoint[]): TrackStats {
  const good = points.filter((p) => p.ok);
  // Cumulative active time and distance, never across a pause.
  const cum: { t: number; d: number; seg: number }[] = [];
  let d = 0;
  let t = 0;
  for (let i = 0; i < good.length; i += 1) {
    if (i > 0 && good[i].segment === good[i - 1].segment) {
      d += haversineM([good[i - 1].lng, good[i - 1].lat], [good[i].lng, good[i].lat]);
      t += good[i].t - good[i - 1].t;
    }
    cum.push({ t, d, seg: good[i].segment });
  }

  let bestKmMs: number | null = null;
  let maxSpeed: number | null = null;
  let j = 0;
  let k = 0;
  for (let i = 0; i < cum.length; i += 1) {
    // Shortest time to cover 1000 m starting here.
    while (j < cum.length && cum[j].d - cum[i].d < 1000) j += 1;
    if (j < cum.length) {
      const ms = cum[j].t - cum[i].t;
      if (ms > 0 && (bestKmMs == null || ms < bestKmMs)) bestKmMs = ms;
    }
    // Speed over a window of at least 10 seconds.
    if (k < i) k = i;
    while (k < cum.length && cum[k].t - cum[i].t < 10000) k += 1;
    if (k < cum.length) {
      const sec = (cum[k].t - cum[i].t) / 1000;
      const v = (cum[k].d - cum[i].d) / sec;
      if (sec > 0 && v <= 12 && (maxSpeed == null || v > maxSpeed)) maxSpeed = v;
    }
  }

  // Climb: smoothed altitude, counting only rises past a 3 m hysteresis, so GPS noise adds nothing.
  const alts = good.map((p) => p.alt).filter((a): a is number => a != null);
  let elevationGainM: number | null = null;
  if (alts.length >= 10 && alts.length >= good.length * 0.8) {
    const smooth = alts.map((_, i) => {
      const w = alts.slice(Math.max(0, i - 2), i + 3);
      return w.reduce((n, x) => n + x, 0) / w.length;
    });
    let gain = 0;
    let base = smooth[0];
    for (const a of smooth) {
      if (a - base >= 3) {
        gain += a - base;
        base = a;
      } else if (a < base) {
        base = a;
      }
    }
    elevationGainM = gain;
  }
  return { bestKmMs, maxSpeedMps: maxSpeed, elevationGainM };
}

// ---------- Export ----------

function csvCell(v: string | number | null) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function activitiesCsv(
  list: (ActivityLite & { title: string | null; note: string | null })[],
  units: Units,
): string {
  const u = unitWord(units);
  const header = [
    'id',
    'type',
    'title',
    'date',
    'start_time_utc',
    `distance_${u}`,
    'moving_time',
    'elapsed_time',
    `avg_pace_per_${u}`,
    'steps',
    'note',
  ];
  const rows = list.map((a) =>
    [
      a.id,
      a.type,
      a.title,
      a.localDate,
      new Date(a.startedAt).toISOString(),
      distanceValue(a.distanceM, units).toFixed(3),
      formatDuration(a.activeMs),
      formatDuration(a.elapsedMs),
      a.distanceM >= 10 ? formatPace(averagePace(a.activeMs, a.distanceM), units) : '',
      a.steps,
      a.note,
    ]
      .map(csvCell)
      .join(','),
  );
  return [header.join(','), ...rows].join('\n') + '\n';
}
