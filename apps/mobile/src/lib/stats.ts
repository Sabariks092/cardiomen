export type Metric = 'active' | 'distance' | 'steps' | 'sessions';
export type Range = 'week' | 'month' | 'year';
export type WeekStart = 0 | 1; // 0 = Sunday, 1 = Monday

export interface DayRow {
  localDate: string;
  activeMs: number;
  distanceM: number;
  steps: number;
  sessions: number;
}

export interface Bar {
  key: string;
  label: string;
  value: number;
}

export interface Period {
  from: string;
  to: string;
  title: string;
  bars: { key: string; label: string; from: string; to: string }[];
}

const DAY_MS = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const parse = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  return iso(parse(date) + days * DAY_MS);
}

export function startOfWeek(date: string, weekStart: WeekStart): string {
  const dow = new Date(parse(date)).getUTCDay();
  return addDays(date, -((dow - weekStart + 7) % 7));
}

export function todayLocal(now: Date = new Date()): string {
  return iso(now.getTime() - now.getTimezoneOffset() * 60000);
}

/** A period `offset` steps back from today (0 = current, 1 = previous...), split into chart bars. */
export function periodFor(range: Range, offset: number, today: string, weekStart: WeekStart): Period {
  if (range === 'week') {
    const from = addDays(startOfWeek(today, weekStart), -7 * offset);
    const to = addDays(from, 6);
    const bars = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(from, i);
      return { key: d, label: DAYS[new Date(parse(d)).getUTCDay()], from: d, to: d };
    });
    const title = offset === 0 ? 'This week' : offset === 1 ? 'Last week' : `${shortDate(from)} – ${shortDate(to)}`;
    return { from, to, title, bars };
  }

  const t = new Date(parse(today));
  if (range === 'month') {
    const first = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - offset, 1));
    const next = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1));
    const from = iso(first.getTime());
    const to = iso(next.getTime() - DAY_MS);
    const bars = [];
    for (let d = from, i = 1; d <= to; d = addDays(d, 1), i += 1) {
      bars.push({ key: d, label: i === 1 || i % 5 === 0 ? String(i) : '', from: d, to: d });
    }
    return { from, to, title: `${MONTHS[first.getUTCMonth()]} ${first.getUTCFullYear()}`, bars };
  }

  const year = t.getUTCFullYear() - offset;
  const bars = MONTHS.map((m, i) => ({
    key: m,
    label: m[0],
    from: iso(Date.UTC(year, i, 1)),
    to: iso(Date.UTC(year, i + 1, 1) - DAY_MS),
  }));
  return { from: `${year}-01-01`, to: `${year}-12-31`, title: String(year), bars };
}

function shortDate(d: string) {
  const dt = new Date(parse(d));
  return `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
}

export function metricOf(row: DayRow, metric: Metric): number {
  switch (metric) {
    case 'active':
      return row.activeMs;
    case 'distance':
      return row.distanceM;
    case 'steps':
      return row.steps;
    case 'sessions':
      return row.sessions;
  }
}

export function buildBars(period: Period, rows: DayRow[], metric: Metric): Bar[] {
  return period.bars.map((b) => ({
    key: b.key,
    label: b.label,
    value: rows
      .filter((r) => r.localDate >= b.from && r.localDate <= b.to)
      .reduce((sum, r) => sum + metricOf(r, metric), 0),
  }));
}

export function totals(rows: DayRow[]) {
  return rows.reduce(
    (t, r) => ({
      activeMs: t.activeMs + r.activeMs,
      distanceM: t.distanceM + r.distanceM,
      steps: t.steps + r.steps,
      sessions: t.sessions + r.sessions,
    }),
    { activeMs: 0, distanceM: 0, steps: 0, sessions: 0 },
  );
}

/** Weeks of days ending with the current week; future days are null. Oldest week first. */
export function heatmapWeeks(today: string, weekCount: number, weekStart: WeekStart): (string | null)[][] {
  const current = startOfWeek(today, weekStart);
  return Array.from({ length: weekCount }, (_, w) => {
    const start = addDays(current, -7 * (weekCount - 1 - w));
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(start, i);
      return d > today ? null : d;
    });
  });
}

/** 0 = none, 1 to 4 = strength. Relative to your busiest day, so it stays useful at any volume. */
export function heatLevel(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || max <= 0) return 0;
  const ratio = value / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

export function monthLabel(date: string): string {
  return MONTHS[new Date(parse(date)).getUTCMonth()];
}
