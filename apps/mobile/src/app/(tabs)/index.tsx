import type { ActivityType } from '@engine';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { ComponentRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAuthState } from '@/auth/api';
import { currentSession, LOCAL_ONLY } from '@/auth/session';
import { useLocalQuery } from '@/db';
import { dayRows, queryActivities, recentActivities } from '@/db/activities';
import { loadSettings, saveSetting, useSettings } from '@/db/settings';
import { distanceValue, formatDay, formatDuration, formatHours, formatSteps, TYPE_LABEL } from '@/lib/format';
import { addDays, heatLevel, heatmapWeeks, monthLabel, periodFor, todayLocal, totals } from '@/lib/stats';
import { evaluateProgress } from '@/progress/evaluate';
import { requestAllPermissionsOnFirstLaunch, useRecordingState } from '@/tracking/useEngine';
import {
  ActivityBadge,
  Button,
  Card,
  ChartCard,
  colors,
  EmptyState,
  Enter,
  MetricCard,
  Pulse,
  radius,
  Screen,
  SectionHeader,
  Segmented,
  Sheet,
  space,
  T,
  Tap,
} from '@/ui';
import { ActivityCard, startLabel, TAB_BAR_SPACE, TYPES, useStartActivity } from '@/ui/activity';
import { AppBar } from '@/ui/appbar';

const CELL = 12;
const GAP = 3;
const HEAT_WEEKS = 53;
const HEAT_COLORS = ['#E8E8E8', '#C4C4C4', '#8E8E8E', '#555555', '#111111'];
const WEEKDAY_ROWS = ['M', '', 'W', '', 'F', '', 'S'];

const WEEK_METRICS = [
  { value: 'distance', label: 'Distance' },
  { value: 'active', label: 'Duration' },
  { value: 'steps', label: 'Steps' },
] as const;
type WeekMetric = (typeof WEEK_METRICS)[number]['value'];

function greeting(now = new Date()) {
  const h = now.getHours();
  if (h < 5) return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function Home() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const settings = useSettings();
  const start = useStartActivity();
  const { snapshot, refresh } = useRecordingState();
  const [chosen, setChosen] = useState<ActivityType | null>(null);
  const [weekMetric, setWeekMetric] = useState<WeekMetric>('distance');
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [daySheet, setDaySheet] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);

  useEffect(() => {
    (async () => {
      const { permissionsAsked } = await loadSettings();
      if (permissionsAsked) return;
      await saveSetting('permissionsAsked', true);
      await requestAllPermissionsOnFirstLaunch();
    })().catch((e) => console.warn('Permission request failed', e));
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
      setSignedOut(!LOCAL_ONLY && getAuthState() === 'signed-out');
      evaluateProgress().catch(() => undefined);
    }, [refresh]),
  );

  const selected: ActivityType = chosen ?? settings.lastActivity ?? settings.defaultActivity;
  const today = todayLocal();
  const units = settings.units;

  const week = useMemo(() => periodFor('week', 0, today, settings.weekStart), [today, settings.weekStart]);
  const weeks = useMemo(() => heatmapWeeks(today, HEAT_WEEKS, settings.weekStart), [today, settings.weekStart]);
  const heatFrom = weeks[0].find(Boolean) ?? today;

  // One day ahead: after flying west, an activity's own date can be later than today's here.
  const { data: heatRows } = useLocalQuery(() => dayRows(heatFrom, addDays(today, 1), 'all'), [heatFrom, today]);
  const { data: recent } = useLocalQuery(() => recentActivities(3), []);
  const { data: dayList } = useLocalQuery(
    () => (daySheet ? queryActivities({ type: 'all', from: daySheet, to: daySheet }) : Promise.resolve([])),
    [daySheet],
  );

  const byDay = useMemo(() => new Map((heatRows ?? []).map((r) => [r.localDate, r])), [heatRows]);
  const todayRow = byDay.get(today);
  const weekRows = useMemo(
    () => (heatRows ?? []).filter((r) => r.localDate >= week.from && r.localDate <= week.to),
    [heatRows, week],
  );
  const weekTotal = totals(weekRows);

  const barValue = (d: string) => {
    const r = byDay.get(d);
    if (!r) return 0;
    return weekMetric === 'distance' ? r.distanceM : weekMetric === 'active' ? r.activeMs : r.steps;
  };
  const bars = week.bars.map((b) => ({ ...b, value: barValue(b.from) }));
  const barMax = Math.max(0, ...bars.map((b) => b.value));
  const formatBar = (v: number) =>
    weekMetric === 'distance'
      ? `${distanceValue(v, units).toFixed(1)} ${units}`
      : weekMetric === 'active'
        ? formatHours(v)
        : formatSteps(Math.round(v));

  const targetM = settings.weeklyTargetKm * (units === 'mi' ? 1609.344 : 1000);
  const targetPct = targetM > 0 ? Math.min(1, weekTotal.distanceM / targetM) : 0;

  // Heatmap intensity follows distance, or time when a day has no distance (e.g. no GPS).
  const heatValue = (d: string) => {
    const r = byDay.get(d);
    if (!r) return 0;
    return r.distanceM > 0 ? r.distanceM : r.activeMs / 600; // ~10 min ≈ 1 km
  };
  const heatMax = useMemo(() => Math.max(0, ...[...byDay.keys()].map(heatValue)), [byDay]); // eslint-disable-line react-hooks/exhaustive-deps
  const heatScroll = useRef<ComponentRef<typeof ScrollView>>(null);

  const recording = snapshot?.state === 'ACTIVE' || snapshot?.state === 'PAUSED';
  const session = currentSession();
  const name = settings.profileName || (session && !session.local ? session.user.name : '') || '';
  const firstName = name.split(/\s+/)[0];
  const picked = pickedDay ? byDay.get(pickedDay) : null;

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
        {/* Header */}
        <AppBar />
        <Enter i={1}>
         
          <T v="label" muted>
            {formatDay(today)}
          </T>
           <T v="title" numberOfLines={1}>
            {greeting()}
            {firstName ? `, ${firstName}` : ''}
          </T>
        </Enter>

        {recording ? (
          <Enter>
            <Tap accessibilityRole="button" onPress={() => router.push('/track')}>
              <Card style={styles.row}>
                <Pulse />
                <T v="heading" style={{ flex: 1 }}>
                  {snapshot?.type ? TYPE_LABEL[snapshot.type] : 'Activity'}{' '}
                  {snapshot?.state === 'PAUSED' ? 'paused' : 'in progress'}
                </T>
                <Ionicons name="chevron-forward" size={18} color={colors.ink} />
              </Card>
            </Tap>
          </Enter>
        ) : null}

        {signedOut ? (
          <Enter>
            <Tap accessibilityRole="button" onPress={() => router.push('/welcome')}>
              <Card style={styles.row}>
                <Ionicons name="cloud-offline-outline" size={18} color={colors.ink} />
                <T v="small" style={{ flex: 1 }}>
                  Sign in to back up. Your activities are safe on this phone.
                </T>
                <Ionicons name="chevron-forward" size={18} color={colors.ink} />
              </Card>
            </Tap>
          </Enter>
        ) : null}

        {/* Start */}
        {!recording ? (
          <Enter i={1}>
            <Card style={{ gap: space.md }}>
              <View style={styles.typeRow}>
                {TYPES.map((t) => {
                  const on = t === selected;
                  return (
                    <Tap
                      key={t}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={TYPE_LABEL[t]}
                      scaleTo={0.94}
                      haptic={!on}
                      onPress={() => setChosen(t)}
                      style={[styles.typeChoice, on && styles.typeChoiceOn]}
                    >
                      <ActivityBadge type={t} size={40} inverted={on} />
                      <T v="small" style={{ fontWeight: on ? '600' : '400' }} muted={!on}>
                        {TYPE_LABEL[t]}
                      </T>
                    </Tap>
                  );
                })}
              </View>
              <Button
                title={startLabel(selected)}
                onPress={() => start(selected)}
                icon={<Ionicons name="play" size={16} color={colors.paper} />}
              />
            </Card>
          </Enter>
        ) : null}

        {/* Today */}
        <Enter i={2}>
          <SectionHeader title="Today" />
        </Enter>
        <Enter i={2} style={styles.grid}>
          <MetricCard
            icon="navigate-outline"
            label="Distance"
            value={distanceValue(todayRow?.distanceM ?? 0, units).toFixed(2)}
            unit={units}
          />
          <MetricCard icon="time-outline" label="Duration" value={formatDuration(todayRow?.activeMs ?? 0)} />
        </Enter>
        <Enter i={3} style={styles.grid}>
          <MetricCard icon="footsteps-outline" label="Steps" value={(todayRow?.steps ?? 0).toLocaleString('en-US')} />
          <MetricCard icon="repeat-outline" label="Sessions" value={String(todayRow?.sessions ?? 0)} />
        </Enter>

        {/* This week */}
        <Enter i={4}>
          <ChartCard
            title="This week"
            subtitle={`${distanceValue(weekTotal.distanceM, units).toFixed(1)} of ${settings.weeklyTargetKm} ${units} target · ${Math.round(targetPct * 100)}%`}
          >
            <View style={styles.targetTrack}>
              <Animated.View layout={LinearTransition.springify()} style={[styles.targetFill, { width: `${targetPct * 100}%` }]} />
            </View>
            <Segmented options={WEEK_METRICS} value={weekMetric} onChange={setWeekMetric} />
            <View style={styles.chart}>
              {bars.map((b) => {
                const on = pickedDay === b.from;
                return (
                  <Pressable
                    key={b.key}
                    accessibilityRole="button"
                    accessibilityLabel={`${formatDay(b.from)}: ${formatBar(b.value)}`}
                    onPress={() => setPickedDay(on ? null : b.from)}
                    style={styles.barColumn}
                  >
                    <View style={styles.barTrack}>
                      <Animated.View
                        layout={LinearTransition.springify().damping(16)}
                        style={[
                          styles.bar,
                          {
                            height: barMax > 0 ? `${Math.max((b.value / barMax) * 100, b.value > 0 ? 4 : 0)}%` : 0,
                            backgroundColor: on || !pickedDay ? colors.ink : '#BDBDBD',
                          },
                        ]}
                      />
                    </View>
                    <T v="small" muted={b.from !== today} style={{ fontWeight: b.from === today ? '600' : '400' }}>
                      {b.label}
                    </T>
                  </Pressable>
                );
              })}
            </View>
            {pickedDay ? (
              <Animated.View entering={FadeIn.duration(200)} style={styles.daySummary}>
                <T v="small" style={{ fontWeight: '600' }}>
                  {formatDay(pickedDay)}
                </T>
                <T v="small" muted>
                  {picked
                    ? `${distanceValue(picked.distanceM, units).toFixed(2)} ${units} · ${formatDuration(picked.activeMs)} · ${formatSteps(picked.steps)} steps · ${picked.sessions} ${picked.sessions === 1 ? 'session' : 'sessions'}`
                    : 'No activity'}
                </T>
                {picked ? (
                  <Tap accessibilityRole="button" onPress={() => setDaySheet(pickedDay)}>
                    <T v="small" style={{ fontWeight: '600' }}>
                      See activities
                    </T>
                  </Tap>
                ) : null}
              </Animated.View>
            ) : (
              <T v="small" muted>
                Week total: {formatBar(bars.reduce((n, b) => n + b.value, 0))}. Tap a day for details.
              </T>
            )}
          </ChartCard>
        </Enter>

        {/* Heatmap */}
        <Enter i={5}>
          <Card style={{ paddingHorizontal: 0, gap: space.md }}>
            <View style={{ paddingHorizontal: space.lg }}>
              <T v="heading">Last 12 months</T>
              <T v="small" muted>
                Darker days had more distance. Tap one to see it.
              </T>
            </View>
            <View style={{ flexDirection: 'row' }}>
              <View style={styles.weekdays}>
                <View style={{ height: 14 }} />
                {WEEKDAY_ROWS.map((d, i) => (
                  <T key={i} v="small" muted style={styles.weekday}>
                    {settings.weekStart === 1 ? d : ['S', '', 'T', '', 'T', '', 'S'][i]}
                  </T>
                ))}
              </View>
              <ScrollView
                ref={heatScroll}
                horizontal
                onContentSizeChange={() => heatScroll.current?.scrollToEnd({ animated: false })}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingRight: space.lg, gap: GAP }}
              >
                {weeks.map((wk, w) => {
                  const first = wk[0];
                  const newMonth = first && (w === 0 || monthLabel(first) !== monthLabel(weeks[w - 1][0] ?? first));
                  return (
                    <View key={w} style={{ gap: GAP }}>
                      <View style={styles.heatMonthSlot}>
                        {newMonth && first ? (
                          <T v="small" muted style={styles.heatMonth} numberOfLines={1}>
                            {monthLabel(first)}
                          </T>
                        ) : null}
                      </View>
                      {wk.map((day, d) => {
                        if (!day) return <View key={d} style={styles.cell} />;
                        const active = byDay.has(day);
                        const level = Math.max(heatLevel(heatValue(day), heatMax), active ? 1 : 0);
                        return (
                          <Pressable
                            key={day}
                            accessibilityLabel={`${formatDay(day)}${active ? '' : ', no activity'}`}
                            disabled={!active}
                            onPress={() => setDaySheet(day)}
                            hitSlop={1}
                          >
                            <View
                              style={[
                                styles.cell,
                                { backgroundColor: HEAT_COLORS[level] },
                                day === today && styles.cellToday,
                              ]}
                            />
                          </Pressable>
                        );
                      })}
                    </View>
                  );
                })}
              </ScrollView>
            </View>
            <View style={styles.legend}>
              <T v="small" muted>
                Less
              </T>
              {HEAT_COLORS.map((c) => (
                <View key={c} style={[styles.cell, { backgroundColor: c }]} />
              ))}
              <T v="small" muted>
                More
              </T>
              <View style={{ flex: 1 }} />
              <View style={[styles.cell, styles.cellToday, { backgroundColor: HEAT_COLORS[0] }]} />
              <T v="small" muted>
                Today
              </T>
            </View>
          </Card>
        </Enter>

        {/* Recent */}
        <Enter i={6}>
          <SectionHeader
            title="Recent activities"
            action={recent?.length ? 'View all' : undefined}
            onAction={() => router.navigate('/activities')}
          />
        </Enter>
        {recent && recent.length === 0 ? (
          <Card>
            <EmptyState
              title="No activities yet"
              body="Your walks, jogs and runs will show up here, with your distance, time and pace."
              action={startLabel(selected)}
              onAction={() => start(selected)}
            />
          </Card>
        ) : (
          (recent ?? []).map((a, i) => (
            <Enter key={a.id} i={7 + i}>
              <ActivityCard
                activity={a}
                units={units}
                onPress={() => router.push({ pathname: '/activity/[id]', params: { id: a.id } })}
              />
            </Enter>
          ))
        )}
      </ScrollView>

      <Sheet visible={!!daySheet} onClose={() => setDaySheet(null)} title={daySheet ? formatDay(daySheet, true) : ''}>
        <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: space.sm }}>
          {(dayList ?? []).map((a) => (
            <ActivityCard
              key={a.id}
              activity={a}
              units={units}
              onPress={() => {
                setDaySheet(null);
                router.push({ pathname: '/activity/[id]', params: { id: a.id } });
              }}
            />
          ))}
          {dayList && dayList.length === 0 ? (
            <T v="small" muted center>
              No activities on this day.
            </T>
          ) : null}
        </ScrollView>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  typeRow: { flexDirection: 'row', gap: space.sm },
  typeChoice: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  typeChoiceOn: { borderColor: colors.ink, backgroundColor: colors.card },
  grid: { flexDirection: 'row', gap: space.md },
  targetTrack: { height: 8, borderRadius: 4, backgroundColor: colors.inactive, overflow: 'hidden' },
  targetFill: { height: '100%', borderRadius: 4, backgroundColor: colors.ink },
  chart: { flexDirection: 'row', height: 140, gap: space.sm },
  barColumn: { flex: 1, alignItems: 'center', gap: 6 },
  barTrack: {
    flex: 1,
    width: '100%',
    justifyContent: 'flex-end',
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: colors.bg,
  },
  bar: { width: '100%', borderRadius: 8 },
  daySummary: { gap: 2, padding: space.md, borderRadius: radius.md, backgroundColor: colors.bg },
  weekdays: { paddingLeft: space.lg, paddingRight: 6, gap: GAP },
  weekday: { height: CELL, fontSize: 9, lineHeight: CELL },
  cell: { width: CELL, height: CELL, borderRadius: 3 },
  cellToday: { borderWidth: 1.5, borderColor: colors.ink },
  heatMonthSlot: { width: CELL, height: 14 },
  heatMonth: { position: 'absolute', left: 0, width: 32, fontSize: 9 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: space.lg },
});
