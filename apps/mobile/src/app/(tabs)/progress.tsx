import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalQuery } from '@/db';
import { allActivitiesLite } from '@/db/activities';
import { backfillActivityStats, bestKilometre } from '@/db/cardigo';
import { useSettings } from '@/db/settings';
import {
  compare,
  inRange,
  insights,
  personalRecords,
  rangeOf,
  RangeKind,
  summarize,
  trend,
  typeDistribution,
  weeklyConsistency,
} from '@/lib/analytics';
import { distanceValue, formatDay, formatDuration, formatHours, formatPace, TYPE_LABEL, Units } from '@/lib/format';
import { Period, periodFor, todayLocal } from '@/lib/stats';
import {
  Card,
  ChartCard,
  colors,
  EmptyState,
  Enter,
  LoadingState,
  MetricCard,
  RoundButton,
  Screen,
  SectionHeader,
  Segmented,
  space,
  T,
  Tap,
} from '@/ui';
import { AppBar } from '@/ui/appbar';
import { TAB_BAR_SPACE, useOpenActivityPicker } from '@/ui/activity';
import { ActivityGlyph } from '@/ui/activityIcon';
import { BarChart, ConsistencyGrid, LineChart, ShareBar } from '@/ui/charts';

const RANGES = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'all', label: 'All time' },
] as const;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** For "All time", the trend shows the last 12 months. */
function last12Months(today: string): Period {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1;
  const bars = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 11 + i, 1));
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    return {
      key: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
      label: MONTHS[d.getUTCMonth()][0],
      from: d.toISOString().slice(0, 10),
      to: new Date(next.getTime() - 86400000).toISOString().slice(0, 10),
    };
  });
  return { from: bars[0].from, to: bars[11].to, title: 'Last 12 months', bars };
}

function pct(v: number | null) {
  if (v == null) return '—';
  const r = Math.round(v);
  return `${r > 0 ? '+' : ''}${r}%`;
}

export default function Progress() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const openPicker = useOpenActivityPicker();
  const settings = useSettings();
  const units: Units = settings.units;
  const u = units;
  const [range, setRange] = useState<RangeKind>('week');
  const [offset, setOffset] = useState(0);

  const { data: all } = useLocalQuery(allActivitiesLite, []);
  const { data: bestKm } = useLocalQuery(bestKilometre, []);

  // Best-kilometre figures come from the stored tracks, worked out a few at a time.
  useFocusEffect(
    useCallback(() => {
      backfillActivityStats(15).catch(() => undefined);
    }, []),
  );

  const today = todayLocal();
  const current = rangeOf(range, offset, today, settings.weekStart);
  const previous = range === 'all' ? null : rangeOf(range, offset + 1, today, settings.weekStart);

  const view = useMemo(() => {
    const list = all ?? [];
    const items = inRange(list, current.from, current.to);
    const s = summarize(items);
    const prev = previous ? summarize(inRange(list, previous.from, previous.to)) : null;
    const period = range === 'all' ? last12Months(today) : periodFor(range, offset, today, settings.weekStart);
    return {
      items,
      s,
      prev,
      comparison: prev ? compare(s, prev) : null,
      trend: trend(list, period),
      types: typeDistribution(items),
      consistency: weeklyConsistency(list, today, settings.weekStart, 12),
      notes: previous && range !== 'all' ? insights(list, current, previous, range, units) : [],
      records: personalRecords(items, range === 'all' ? (bestKm ?? null) : null),
    };
  }, [all, current.from, current.to, previous?.from, previous?.to, range, offset, today, settings.weekStart, units, bestKm]); // eslint-disable-line react-hooks/exhaustive-deps

  const dist = (m: number) => `${distanceValue(m, units).toFixed(1)} ${u}`;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + space.md,
          paddingHorizontal: space.lg,
          paddingBottom: insets.bottom + TAB_BAR_SPACE,
          gap: space.md,
        }}
        showsVerticalScrollIndicator={false}
      >
        <AppBar />
        <Enter>
          <T v="title">Progress</T>
          <T v="small" muted>
            Track, analyse, improve.
          </T>
        </Enter>

        <Enter i={1}>
          <Segmented
            options={RANGES}
            value={range}
            onChange={(r) => {
              setRange(r);
              setOffset(0);
            }}
          />
        </Enter>

        {range !== 'all' ? (
          <Enter i={1} style={styles.periodRow}>
            <RoundButton label="Previous period" onPress={() => setOffset(offset + 1)}>
              <Ionicons name="chevron-back" size={18} color={colors.ink} />
            </RoundButton>
            <View style={{ alignItems: 'center' }}>
              <T v="heading">{current.title}</T>
              <T v="small" muted>
                {formatDay(current.from)} – {formatDay(current.to)}
              </T>
            </View>
            <RoundButton label="Next period" disabled={offset === 0} onPress={() => setOffset(Math.max(0, offset - 1))}>
              <Ionicons name="chevron-forward" size={18} color={colors.ink} />
            </RoundButton>
          </Enter>
        ) : null}

        {all === undefined ? (
          <LoadingState />
        ) : all.length === 0 ? (
          <Card>
            <EmptyState
              icon="stats-chart-outline"
              title="Your progress starts here"
              body="Record a few activities and Cardigo will chart your distance, time and pace, and tell you how you're improving."
              action="Start an activity"
              onAction={openPicker}
            />
          </Card>
        ) : (
          <>
            <Enter i={2} style={styles.grid}>
              <MetricCard icon="navigate-outline" label="Distance" value={distanceValue(view.s.distanceM, units).toFixed(1)} unit={u} />
              <MetricCard icon="time-outline" label="Duration" value={formatHours(view.s.activeMs)} />
            </Enter>
            <Enter i={2} style={styles.grid}>
              <MetricCard icon="repeat-outline" label="Sessions" value={String(view.s.sessions)} />
              <MetricCard icon="speedometer-outline" label="Average pace" value={formatPace(view.s.avgPace, units)} unit={`/${u}`} />
            </Enter>
            <Enter i={3} style={styles.grid}>
              <MetricCard icon="footsteps-outline" label="Steps" value={view.s.steps.toLocaleString('en-US')} />
              <MetricCard icon="calendar-outline" label="Active days" value={String(view.s.activeDays)} />
            </Enter>
            <Enter i={3} style={styles.grid}>
              <MetricCard icon="trophy-outline" label="Longest" value={distanceValue(view.s.longestM, units).toFixed(2)} unit={u} />
              <MetricCard icon="flash-outline" label="Fastest pace" value={formatPace(view.s.fastestPace, units)} unit={`/${u}`} />
            </Enter>

            {view.comparison && view.prev ? (
              <Enter i={4}>
                <ChartCard title={`Compared with the previous ${range}`} subtitle={view.prev.sessions === 0 ? 'No activities in the previous period, so there is nothing to compare yet.' : undefined}>
                  {view.prev.sessions > 0 ? (
                    <View style={{ gap: space.sm }}>
                      {(
                        [
                          ['Distance', dist(view.prev.distanceM), dist(view.s.distanceM), view.comparison.distance],
                          ['Duration', formatHours(view.prev.activeMs), formatHours(view.s.activeMs), view.comparison.duration],
                          ['Sessions', String(view.prev.sessions), String(view.s.sessions), view.comparison.sessions],
                        ] as const
                      ).map(([label, before, now, change]) => (
                        <View key={label} style={styles.compareRow}>
                          <T v="small" muted style={{ flex: 1 }}>
                            {label}
                          </T>
                          <T v="small" muted style={styles.compareCol}>
                            {before}
                          </T>
                          <T v="small" style={styles.compareCol}>
                            {now}
                          </T>
                          <T v="small" style={[styles.compareCol, { fontWeight: '600' }]}>
                            {pct(change)}
                          </T>
                        </View>
                      ))}
                      <View style={styles.compareRow}>
                        <T v="small" muted style={{ flex: 1 }}>
                          Avg pace /{u}
                        </T>
                        <T v="small" muted style={styles.compareCol}>
                          {formatPace(view.prev.avgPace, units)}
                        </T>
                        <T v="small" style={styles.compareCol}>
                          {formatPace(view.s.avgPace, units)}
                        </T>
                        <T v="small" style={[styles.compareCol, { fontWeight: '600' }]}>
                          {view.comparison.paceDeltaSec == null
                            ? '—'
                            : `${view.comparison.paceDeltaSec <= 0 ? '−' : '+'}${Math.round(Math.abs(view.comparison.paceDeltaSec * (units === 'mi' ? 1.609344 : 1)))}s`}
                        </T>
                      </View>
                    </View>
                  ) : null}
                </ChartCard>
              </Enter>
            ) : null}

            {view.notes.length ? (
              <Enter i={5}>
                <ChartCard title="Insights">
                  {view.notes.map((n) => (
                    <View key={n} style={styles.insight}>
                      <Ionicons name="sparkles-outline" size={15} color={colors.ink} />
                      <T v="small" style={{ flex: 1 }}>
                        {n}
                      </T>
                    </View>
                  ))}
                </ChartCard>
              </Enter>
            ) : null}

            <Enter i={6}>
              <ChartCard title="Distance" subtitle={range === 'all' ? 'Last 12 months' : current.title}>
                <BarChart data={view.trend.map((t) => ({ key: t.key, label: t.label, value: t.distanceM }))} format={dist} />
              </ChartCard>
            </Enter>
            <Enter i={7}>
              <ChartCard title="Duration" subtitle={range === 'all' ? 'Last 12 months' : current.title}>
                <BarChart data={view.trend.map((t) => ({ key: t.key, label: t.label, value: t.activeMs }))} format={formatHours} />
              </ChartCard>
            </Enter>
            <Enter i={8}>
              <ChartCard title="Average pace" subtitle="Higher on the chart is faster">
                <LineChart
                  values={view.trend.map((t) => t.pace)}
                  labels={view.trend.map((t) => t.key)}
                  format={(v) => `${formatPace(v, units)} /${u}`}
                  lowerIsBetter
                />
              </ChartCard>
            </Enter>
            <Enter i={8}>
              <ChartCard title="Activity types" subtitle={`${view.s.sessions} ${view.s.sessions === 1 ? 'session' : 'sessions'} in this period`}>
                <ShareBar
                  parts={view.types.map((t) => ({
                    label: TYPE_LABEL[t.type],
                    icon: <ActivityGlyph type={t.type} size={22} color={colors.ink} />,
                    value: t.sessions,
                    detail: `${t.sessions} · ${dist(t.distanceM)}`,
                  }))}
                />
              </ChartCard>
            </Enter>
            <Enter i={8}>
              <ChartCard title="Weekly consistency" subtitle="Active days in each of the last 12 weeks">
                <ConsistencyGrid weeks={view.consistency} />
              </ChartCard>
            </Enter>

            <Enter i={8}>
              <SectionHeader title="Personal records" />
            </Enter>
            <Enter i={8}>
              <Card style={{ gap: space.sm }}>
                {(
                  [
                    ['Longest distance', view.records.longestDistance ? `${dist(view.records.longestDistance.distanceM)} · ${formatDay(view.records.longestDistance.localDate)}` : '—', view.records.longestDistance?.id],
                    ['Longest duration', view.records.longestDuration ? `${formatDuration(view.records.longestDuration.activeMs)} · ${formatDay(view.records.longestDuration.localDate)}` : '—', view.records.longestDuration?.id],
                    ['Fastest pace', view.records.fastestPace ? `${formatPace(view.records.fastestPace.pace, units)} /${u} · ${formatDay(view.records.fastestPace.activity.localDate)}` : '—', view.records.fastestPace?.activity.id],
                    ...(range === 'all'
                      ? ([['Fastest kilometre', view.records.bestKm ? formatDuration(view.records.bestKm.ms) : '—', view.records.bestKm?.activityId]] as const)
                      : []),
                  ] as const
                ).map(([label, value, id]) => (
                  <Tap
                    key={label}
                    accessibilityRole="button"
                    disabled={!id}
                    onPress={() => id && router.push({ pathname: '/activity/[id]', params: { id } })}
                    style={styles.recordRow}
                  >
                    <T v="small" muted style={{ flex: 1 }}>
                      {label}
                    </T>
                    <T v="small" style={{ fontWeight: '600' }}>
                      {value}
                    </T>
                  </Tap>
                ))}
              </Card>
            </Enter>
          </>
        )}

        <Enter i={8}>
          <SectionHeader title="Goals and more" />
        </Enter>
        <Enter i={8}>
          <Card style={{ padding: space.sm }}>
            <LinkRow icon="flag-outline" label="Goals and achievements" onPress={() => router.push('/goals')} />
            <LinkRow icon="map-outline" label="Routes" onPress={() => router.push('/routes')} />
            <LinkRow icon="person-outline" label="Profile and records" onPress={() => router.push('/profile')} />
          </Card>
        </Enter>
      </ScrollView>
    </Screen>
  );
}

function LinkRow({ icon, label, onPress }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void }) {
  return (
    <Tap accessibilityRole="button" onPress={onPress} scaleTo={0.98} style={styles.link}>
      <View style={styles.linkIcon}>
        <Ionicons name={icon} size={18} color={colors.ink} />
      </View>
      <T style={{ flex: 1 }}>{label}</T>
      <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
    </Tap>
  );
}

const styles = StyleSheet.create({
  periodRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  grid: { flexDirection: 'row', gap: space.md },
  compareRow: { flexDirection: 'row', alignItems: 'center', minHeight: 28 },
  compareCol: { width: 70, textAlign: 'right' },
  insight: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  recordRow: { flexDirection: 'row', alignItems: 'center', minHeight: 36 },
  link: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingHorizontal: space.sm },
  linkIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.inactive,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
