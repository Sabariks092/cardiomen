import type { ActivityType } from '@engine';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { ComponentRef, useCallback, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAuthState } from '@/auth/api';
import { LOCAL_ONLY } from '@/auth/session';
import { dayRows } from '@/db/activities';
import { useLocalQuery } from '@/db';
import { useSettings } from '@/db/settings';
import { distanceValue, formatHours, TYPE_LABEL, Units } from '@/lib/format';
import {
  addDays,
  buildBars,
  heatLevel,
  heatmapWeeks,
  Metric,
  metricOf,
  monthLabel,
  periodFor,
  Range,
  todayLocal,
  totals,
} from '@/lib/stats';
import { useEngineSnapshot } from '@/tracking/useEngine';
import { colors, Glass, radius, Screen, Segmented, space, Stat, T } from '@/ui';

const CELL = 13;
const GAP = 3;
const HEAT_WEEKS = 53;
const HEAT_COLORS = [
  'rgba(255,255,255,0.07)',
  'rgba(255,255,255,0.28)',
  'rgba(255,255,255,0.5)',
  'rgba(255,255,255,0.75)',
  '#FFFFFF',
];

const METRICS = [
  { value: 'active', label: 'Time' },
  { value: 'distance', label: 'Distance' },
  { value: 'steps', label: 'Steps' },
  { value: 'sessions', label: 'Sessions' },
] as const;
const RANGES = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
] as const;
const TYPES = [
  { value: 'all', label: 'All' },
  { value: 'walk', label: 'Walk' },
  { value: 'jog', label: 'Jog' },
  { value: 'run', label: 'Run' },
] as const;

function formatMetric(value: number, metric: Metric, units: Units): string {
  switch (metric) {
    case 'active':
      return formatHours(value);
    case 'distance':
      return `${distanceValue(value, units).toFixed(1)} ${units}`;
    default:
      return Math.round(value).toLocaleString('en-US');
  }
}

export default function Home() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const settings = useSettings();
  const [metric, setMetric] = useState<Metric>('active');
  const [range, setRange] = useState<Range>('week');
  const [type, setType] = useState<ActivityType | 'all'>('all');
  const [offset, setOffset] = useState(0);
  const [menu, setMenu] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const { snapshot, refresh } = useEngineSnapshot();

  useFocusEffect(
    useCallback(() => {
      refresh();
      setSignedOut(!LOCAL_ONLY && getAuthState() === 'signed-out');
    }, [refresh]),
  );

  const today = todayLocal();
  const period = useMemo(
    () => periodFor(range, offset, today, settings.weekStart),
    [range, offset, today, settings.weekStart],
  );
  const weeks = useMemo(
    () => heatmapWeeks(addDays(today, 1), HEAT_WEEKS, settings.weekStart),
    [today, settings.weekStart],
  );
  const heatFrom = weeks[0].find(Boolean) ?? today;

  // One day ahead: after flying west, an activity's own date can be later than today's here.
  const heatTo = addDays(today, 1);
  const { data: heatRows } = useLocalQuery(() => dayRows(heatFrom, heatTo, type), [heatFrom, heatTo, type]);
  const { data: rows } = useLocalQuery(
    () => dayRows(period.from, period.to, type),
    [period.from, period.to, type],
  );

  const heatValues = useMemo(() => {
    const map = new Map<string, number>();
    heatRows?.forEach((r) => map.set(r.localDate, metricOf(r, metric)));
    return map;
  }, [heatRows, metric]);
  const heatMax = useMemo(() => Math.max(0, ...heatValues.values()), [heatValues]);
  const activeDays = useMemo(() => new Set(heatRows?.map((r) => r.localDate)), [heatRows]);

  const bars = useMemo(() => buildBars(period, rows ?? [], metric), [period, rows, metric]);
  const barMax = Math.max(0, ...bars.map((b) => b.value));
  const sum = useMemo(() => totals(rows ?? []), [rows]);

  const heatScroll = useRef<ComponentRef<typeof ScrollView>>(null);

  const recording = snapshot?.state === 'ACTIVE' || snapshot?.state === 'PAUSED';

  const startTracking = (t: ActivityType) => {
    setMenu(false);
    router.push({ pathname: '/track', params: { type: t } });
  };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + space.lg,
          paddingHorizontal: space.lg,
          paddingBottom: insets.bottom + 110,
          gap: space.md,
        }}
        showsVerticalScrollIndicator={false}
      >
        <T v="title">Cardiomen</T>

        {recording ? (
          <Pressable accessibilityRole="button" onPress={() => router.push('/track')}>
            <Glass style={styles.recording}>
              <View style={styles.liveDot} />
              <T v="heading" style={{ flex: 1 }}>
                {snapshot?.type ? TYPE_LABEL[snapshot.type] : 'Activity'}{' '}
                {snapshot?.state === 'PAUSED' ? 'paused' : 'recording'}
              </T>
              <Ionicons name="chevron-forward" size={18} color={colors.white} />
            </Glass>
          </Pressable>
        ) : null}

        {signedOut ? (
          <Pressable accessibilityRole="button" onPress={() => router.push('/welcome')}>
            <Glass style={styles.recording}>
              <Ionicons name="cloud-offline-outline" size={18} color={colors.white} />
              <T style={{ flex: 1 }}>Sign in to back up. Your activities are safe on this phone.</T>
              <Ionicons name="chevron-forward" size={18} color={colors.white} />
            </Glass>
          </Pressable>
        ) : null}

        <Glass style={{ paddingHorizontal: 0 }}>
          <T v="label" muted style={{ paddingHorizontal: space.lg, marginBottom: space.md }}>
            Last 12 months
          </T>
          <ScrollView
            ref={heatScroll}
            horizontal
            onContentSizeChange={() => heatScroll.current?.scrollToEnd({ animated: false })}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: space.lg, gap: GAP }}
          >
            {weeks.map((week, w) => {
              const first = week[0];
              const newMonth =
                first && (w === 0 || monthLabel(first) !== monthLabel(weeks[w - 1][0] ?? first));
              return (
                <View key={w} style={{ gap: GAP }}>
                  <View style={styles.heatMonthSlot}>
                    {newMonth && first ? (
                      <T v="label" faint style={styles.heatMonth} numberOfLines={1}>
                        {monthLabel(first)}
                      </T>
                    ) : null}
                  </View>
                  {week.map((day, d) => {
                    if (!day) return <View key={d} style={styles.cell} />;
                    // A day with an activity always shows, even if this metric is 0 for it (e.g. no steps).
                    const active = activeDays.has(day);
                    const level = Math.max(heatLevel(heatValues.get(day) ?? 0, heatMax), active ? 1 : 0);
                    return (
                      <Pressable
                        key={day}
                        accessibilityLabel={day}
                        disabled={!active}
                        onPress={() => router.push({ pathname: '/activities', params: { date: day } })}
                        hitSlop={1}
                      >
                        <View style={[styles.cell, { backgroundColor: HEAT_COLORS[level] }]} />
                      </Pressable>
                    );
                  })}
                </View>
              );
            })}
          </ScrollView>
        </Glass>

        <Segmented
          options={METRICS}
          value={metric}
          onChange={setMetric}
        />

        <Glass>
          <View style={styles.periodRow}>
            <Pressable accessibilityLabel="Previous period" hitSlop={12} onPress={() => setOffset(offset + 1)}>
              <Ionicons name="chevron-back" size={20} color={colors.white} />
            </Pressable>
            <T v="heading">{period.title}</T>
            <Pressable
              accessibilityLabel="Next period"
              hitSlop={12}
              disabled={offset === 0}
              onPress={() => setOffset(offset - 1)}
            >
              <Ionicons name="chevron-forward" size={20} color={offset === 0 ? colors.textFaint : colors.white} />
            </Pressable>
          </View>

          <View style={styles.chart}>
            {bars.map((b) => (
              <View key={b.key} style={styles.barColumn}>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.bar,
                      {
                        height: barMax > 0 ? `${Math.max((b.value / barMax) * 100, b.value > 0 ? 3 : 0)}%` : 0,
                      },
                    ]}
                  />
                </View>
                <T v="label" faint style={{ fontSize: 9, letterSpacing: 0 }} numberOfLines={1}>
                  {b.label || ' '}
                </T>
              </View>
            ))}
          </View>

          <View style={styles.totals}>
            <Stat label="Time" value={formatHours(sum.activeMs)} />
            <Stat label={settings.units} value={distanceValue(sum.distanceM, settings.units).toFixed(1)} />
            <Stat label="Steps" value={sum.steps.toLocaleString('en-US')} />
            <Stat label="Sessions" value={String(sum.sessions)} />
          </View>
          <T v="small" faint style={{ marginTop: space.sm }}>
            {METRICS.find((m) => m.value === metric)?.label}: peak {formatMetric(barMax, metric, settings.units)}
          </T>
        </Glass>

        <Segmented
          options={RANGES}
          value={range}
          onChange={(r) => {
            setRange(r);
            setOffset(0);
          }}
        />
        <Segmented options={TYPES} value={type} onChange={setType} />
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Track an activity"
        onPress={() => (recording ? router.push('/track') : setMenu(true))}
        style={[styles.fab, { bottom: Math.max(insets.bottom, space.md) + 2 }]}
      >
        <Ionicons name={recording ? 'radio-button-on' : 'add'} size={30} color={colors.black} />
      </Pressable>

      <Modal transparent visible={menu} animationType="fade" onRequestClose={() => setMenu(false)} statusBarTranslucent>
        <Pressable accessibilityLabel="Close" style={styles.scrim} onPress={() => setMenu(false)}>
          <View style={[styles.menu, { paddingBottom: insets.bottom + space.lg }]}>
            {(['walk', 'jog', 'run'] as const).map((t) => (
              <Pressable
                key={t}
                accessibilityRole="button"
                accessibilityLabel={`Track ${TYPE_LABEL[t].toLowerCase()}`}
                onPress={() => startTracking(t)}
                style={styles.menuItem}
              >
                <Ionicons
                  name={t === 'walk' ? 'walk-outline' : t === 'jog' ? 'speedometer-outline' : 'flash-outline'}
                  size={22}
                  color={colors.white}
                />
                <T v="heading" style={{ flex: 1 }}>
                  Track {TYPE_LABEL[t].toLowerCase()}
                </T>
                <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  recording: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  liveDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.white },
  cell: { width: CELL, height: CELL, borderRadius: 3 },
  heatMonthSlot: { width: CELL, height: 14 },
  heatMonth: { position: 'absolute', left: 0, width: 32, fontSize: 9, letterSpacing: 0 },
  periodRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.lg },
  chart: { flexDirection: 'row', height: 150, alignItems: 'stretch', gap: 3 },
  barColumn: { flex: 1, alignItems: 'center', gap: 6 },
  barTrack: { flex: 1, width: '100%', justifyContent: 'flex-end', alignItems: 'center' },
  bar: { width: '76%', maxWidth: 26, backgroundColor: colors.white, borderRadius: 4 },
  totals: {
    flexDirection: 'row',
    marginTop: space.lg,
    paddingTop: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    gap: space.sm,
  },
  fab: {
    position: 'absolute',
    right: space.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
  },
  scrim: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  menu: {
    backgroundColor: '#151515',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    padding: space.md,
    gap: space.xs,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    minHeight: 60,
    paddingHorizontal: space.md,
  },
});
