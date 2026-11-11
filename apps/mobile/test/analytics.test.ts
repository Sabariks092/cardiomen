import { describe, expect, it } from 'vitest';
import {
  achievements,
  ActivityLite,
  activitiesCsv,
  compare,
  Goal,
  goalProgress,
  goalTitle,
  insights,
  percentChange,
  personalRecords,
  rangeOf,
  routeSimilarity,
  summarize,
  trackStats,
  typeDistribution,
  weeklyConsistency,
} from '../src/lib/analytics';
import { LngLat, RawPoint } from '../src/lib/track';

let n = 0;
function act(localDate: string, distanceM: number, activeMs: number, type: ActivityLite['type'] = 'walk', steps: number | null = null): ActivityLite {
  n += 1;
  return {
    id: `a${n}`,
    type,
    startedAt: Date.parse(`${localDate}T07:00:00Z`) + n,
    tzOffsetMin: 0,
    localDate,
    activeMs,
    elapsedMs: activeMs,
    distanceM,
    steps,
  };
}

const MIN = 60_000;

describe('summarize', () => {
  it('totals, active days and paces', () => {
    const s = summarize([
      act('2026-11-09', 5000, 30 * MIN),
      act('2026-11-09', 2000, 20 * MIN),
      act('2026-11-10', 500, 10 * MIN), // too short for pace
    ]);
    expect(s.sessions).toBe(3);
    expect(s.distanceM).toBe(7500);
    expect(s.activeDays).toBe(2);
    expect(s.longestM).toBe(5000);
    // Pace only over activities of 1 km or more: 50 min / 7 km
    expect(s.avgPace).toBeCloseTo((50 * 60) / 7, 5);
    expect(s.fastestPace).toBeCloseTo(360, 5); // 30 min / 5 km
  });

  it('has no pace with nothing long enough', () => {
    expect(summarize([act('2026-11-09', 300, 5 * MIN)]).avgPace).toBeNull();
    expect(summarize([]).avgPace).toBeNull();
  });
});

describe('comparisons', () => {
  it('percent change needs a previous value', () => {
    expect(percentChange(12, 10)).toBeCloseTo(20);
    expect(percentChange(8, 10)).toBeCloseTo(-20);
    expect(percentChange(5, 0)).toBeNull();
  });

  it('pace delta is negative when faster', () => {
    const cur = summarize([act('2026-11-10', 5000, 25 * MIN)]);
    const prev = summarize([act('2026-11-03', 5000, 30 * MIN)]);
    expect(compare(cur, prev).paceDeltaSec).toBeCloseTo(-60);
  });
});

describe('insights', () => {
  const today = '2026-11-11'; // Wednesday
  const cur = rangeOf('week', 0, today, 1);
  const prev = rangeOf('week', 1, today, 1);

  it('says nothing without data', () => {
    expect(insights([], cur, prev, 'week', 'km')).toEqual([]);
  });

  it('does not compare against an empty previous week', () => {
    const out = insights([act('2026-11-10', 3000, 30 * MIN)], cur, prev, 'week', 'km');
    expect(out.join(' ')).not.toMatch(/more|less|improved/);
    expect(out).toContain('You were active on 1 day this week.');
  });

  it('reports distance and pace changes', () => {
    const list = [
      act('2026-11-03', 4000, 40 * MIN), // last week: 10:00 /km
      act('2026-11-09', 4000, 38 * MIN), // this week: 8 km in 76 min = 9:30 /km
      act('2026-11-10', 4000, 38 * MIN),
    ];
    const out = insights(list, cur, prev, 'week', 'km');
    expect(out).toContain('You covered 4.0 km more than last week.');
    expect(out).toContain('Your average pace improved by 30 seconds per km.');
    expect(out).toContain('You were active on 2 days this week.');
  });
});

describe('records and achievements', () => {
  const list = [
    act('2026-10-01', 5200, 40 * MIN, 'jog', 6000),
    act('2026-10-05', 10500, 70 * MIN, 'run'),
    act('2026-10-06', 800, 6 * MIN, 'run'),
  ];

  it('finds personal records, ignoring short activities for pace', () => {
    const r = personalRecords(list);
    expect(r.longestDistance?.distanceM).toBe(10500);
    expect(r.fastestPace?.activity.distanceM).toBe(10500); // 6:40 beats 7:41
    expect(r.mostSteps?.steps).toBe(6000);
  });

  it('earns distance achievements on the right date', () => {
    const a = achievements(list, 1, 'km');
    const byId = Object.fromEntries(a.map((x) => [x.id, x]));
    expect(byId.first.achievedOn).toBe('2026-10-01');
    expect(byId['first-5k'].achievedOn).toBe('2026-10-01');
    expect(byId['first-10k'].achievedOn).toBe('2026-10-05');
    expect(byId['total-50'].achieved).toBe(false);
    expect(byId['total-50'].progress).toBeCloseTo(16500 / 50000);
    expect(byId['fastest-km'].achieved).toBe(false);
  });

  it('nothing is earned with no activities', () => {
    expect(achievements([], 1, 'km').every((x) => !x.achieved)).toBe(true);
  });
});

describe('goals', () => {
  const goal = (kind: Goal['kind'], target: number, activityType: Goal['activityType'] = null): Goal => ({
    id: 'g',
    kind,
    target,
    activityType,
    paused: false,
    createdAt: 0,
    achievedPeriod: null,
  });
  const list = [
    act('2026-11-03', 9000, 60 * MIN, 'walk'), // last week
    act('2026-11-09', 6000, 50 * MIN, 'walk'),
    act('2026-11-10', 4000, 25 * MIN, 'run'),
    act('2026-11-10', 1000, 10 * MIN, 'walk'),
  ];
  const today = '2026-11-11';

  it('weekly distance counts only this week', () => {
    const p = goalProgress(goal('distance_week', 20000), list, today, 1);
    expect(p.current).toBe(11000);
    expect(p.periodKey).toBe('w:2026-11-09');
    expect(p.done).toBe(false);
  });

  it('filters by activity type', () => {
    expect(goalProgress(goal('distance_week', 5000, 'walk'), list, today, 1).current).toBe(7000);
    expect(goalProgress(goal('single_distance', 5000, 'run'), list, today, 1).current).toBe(4000);
  });

  it('active days and monthly counts', () => {
    expect(goalProgress(goal('active_days_week', 5), list, today, 1).current).toBe(2);
    const m = goalProgress(goal('activities_month', 3), list, today, 1);
    expect(m.current).toBe(4);
    expect(m.done).toBe(true);
    expect(m.periodKey).toBe('m:2026-11');
  });

  it('titles read naturally', () => {
    expect(goalTitle(goal('distance_week', 20000, 'walk'), 'km')).toBe('Walk 20 km this week');
    expect(goalTitle(goal('single_distance', 5000, 'run'), 'km')).toBe('Run 5 km in one go');
    expect(goalTitle(goal('activities_month', 15), 'km')).toBe('Complete 15 activities this month');
  });
});

describe('route similarity', () => {
  // A straight 1.1 km line north, sampled at two different rates.
  const line = (steps: number, offsetDeg = 0): LngLat[][] => [
    Array.from({ length: steps + 1 }, (_, i) => [77.5946 + offsetDeg, 12.97 + (0.01 * i) / steps] as LngLat),
  ];

  it('matches the same path recorded differently', () => {
    expect(routeSimilarity(line(20), line(55)).similar).toBe(true);
  });

  it('rejects a parallel street with the same distance', () => {
    // ~110 m east: same length, different route.
    const r = routeSimilarity(line(20), line(20, 0.001));
    expect(r.similar).toBe(false);
  });

  it('rejects very different lengths', () => {
    const short: LngLat[][] = [[[77.5946, 12.97], [77.5946, 12.975]]];
    expect(routeSimilarity(line(20), short).similar).toBe(false);
  });
});

describe('track stats', () => {
  // 2 km north at a steady 4 m/s, one point per second, one segment.
  const pts: RawPoint[] = Array.from({ length: 501 }, (_, i) => ({
    t: i * 1000,
    lat: 12.97 + (i * 4) / 111_195,
    lng: 77.5946,
    acc: 5,
    alt: 900 + i * 0.1, // 50 m climb
    ok: true,
    segment: 1,
  }));

  it('best km, top speed and climb', () => {
    const s = trackStats(pts);
    expect(s.bestKmMs).toBeGreaterThan(249_000);
    expect(s.bestKmMs).toBeLessThan(252_000);
    expect(s.maxSpeedMps).toBeCloseTo(4, 1);
    expect(s.elevationGainM).toBeGreaterThan(45);
    expect(s.elevationGainM).toBeLessThan(52);
  });

  it('ignores a single GPS jump for top speed', () => {
    const jumpy = pts.map((p, i) => (i === 100 ? { ...p, lat: p.lat + 0.0005 } : p)); // 55 m spike
    expect(trackStats(jumpy).maxSpeedMps!).toBeLessThan(12);
  });

  it('no altitude means no climb figure', () => {
    expect(trackStats(pts.map((p) => ({ ...p, alt: null }))).elevationGainM).toBeNull();
  });
});

describe('distribution, consistency and CSV', () => {
  it('type distribution adds up', () => {
    const d = typeDistribution([act('2026-11-01', 1000, MIN, 'walk'), act('2026-11-02', 1000, MIN, 'run')]);
    expect(d.find((x) => x.type === 'walk')?.share).toBe(0.5);
    expect(d.find((x) => x.type === 'jog')?.sessions).toBe(0);
  });

  it('counts active days per week', () => {
    const w = weeklyConsistency(
      [act('2026-11-09', 1, 1), act('2026-11-09', 1, 1), act('2026-11-10', 1, 1)],
      '2026-11-11',
      1,
      2,
    );
    expect(w).toEqual([
      { from: '2026-11-02', activeDays: 0 },
      { from: '2026-11-09', activeDays: 2 },
    ]);
  });

  it('CSV escapes text fields', () => {
    const csv = activitiesCsv([{ ...act('2026-11-01', 5000, 30 * MIN), title: 'Park, "loop"', note: null }], 'km');
    const [header, row] = csv.trim().split('\n');
    expect(header.startsWith('id,type,title,date')).toBe(true);
    expect(row).toContain('"Park, ""loop"""');
    expect(row).toContain('5.000');
    expect(row).toContain('6:00');
  });
});
