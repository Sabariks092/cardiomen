import Ionicons from '@expo/vector-icons/Ionicons';
import { File, Paths } from 'expo-file-system';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInLeft, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalQuery } from '@/db';
import { Activity, getActivity, getTrackBlob, queryActivities, setDeleted, updateActivity } from '@/db/activities';
import { getActivityStats, saveRoute, savedRouteFor } from '@/db/cardigo';
import { useSettings } from '@/db/settings';
import { routeSimilarity } from '@/lib/analytics';
import {
  averagePace,
  formatDay,
  formatDistance,
  formatDuration,
  formatPace,
  formatSpeed,
  formatStartTime,
  formatSteps,
  speedUnit,
  TYPE_LABEL,
  Units,
} from '@/lib/format';
import { decodeTrack, RawPoint, splitsOf, toGpx, toSegments } from '@/lib/track';
import { downloadTrackIfMissing, requestSync } from '@/sync/worker';
import {
  ActivityBadge,
  Button,
  Card,
  colors,
  Divider,
  Enter,
  Field,
  MetricCard,
  radius,
  RoundButton,
  Screen,
  SectionHeader,
  Segmented,
  Sheet,
  space,
  T,
  Tap,
} from '@/ui';
import { AppBar } from '@/ui/appbar';
import { RouteMap } from '@/ui/maps';
import { resetTo } from '@/ui/nav';

const TYPES = [
  { value: 'walk', label: 'Walk' },
  { value: 'jog', label: 'Jog' },
  { value: 'run', label: 'Run' },
] as const;

export default function ActivityDetail() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id, fresh } = useLocalSearchParams<{ id: string; fresh?: string }>();
  const { units } = useSettings();
  const { data: activity } = useLocalQuery(() => getActivity(id), [id]);
  const { data: stats } = useLocalQuery(() => getActivityStats(id), [id]);
  const { data: saved } = useLocalQuery(() => savedRouteFor(id), [id]);
  const [points, setPoints] = useState<RawPoint[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [naming, setNaming] = useState(false);
  const [undo, setUndo] = useState(false);

  useEffect(() => {
    (async () => {
      const blob = (await getTrackBlob(id)) ?? (await downloadTrackIfMissing(id));
      setPoints(blob ? decodeTrack(blob) : []);
    })().catch((e) => {
      console.warn('Could not read route', e);
      setPoints([]);
    });
  }, [id]);

  const lines = useMemo(
    () => (points?.length ? toSegments(points) : (activity?.previewRoute ?? [])),
    [points, activity?.previewRoute],
  );
  const splits = useMemo(() => (points ? splitsOf(points) : []), [points]);

  // Earlier activities on the same route, by shape rather than by distance.
  const { data: sameRoute } = useLocalQuery(async () => {
    if (!activity?.bbox || activity.distanceM < 200) return [];
    const b = activity.bbox;
    const candidates = await queryActivities({ type: 'all', to: activity.localDate });
    return candidates.filter(
      (c) =>
        c.id !== activity.id &&
        c.startedAt < activity.startedAt &&
        c.bbox &&
        c.bbox.minLat < b.maxLat &&
        c.bbox.maxLat > b.minLat &&
        c.bbox.minLng < b.maxLng &&
        c.bbox.maxLng > b.minLng &&
        routeSimilarity(activity.previewRoute, c.previewRoute).similar,
    );
  }, [activity?.id, activity?.bbox]);

  const close = () => {
    if (fresh || !router.canGoBack()) resetTo(router, '/(tabs)');
    else router.back();
  };

  if (activity === undefined) return <Screen />;
  if (!activity) {
    return (
      <Screen style={{ justifyContent: 'center', padding: space.xl, gap: space.lg }}>
        <T center muted>
          This activity isn't available.
        </T>
        <Button title="Close" kind="glass" onPress={close} />
      </Screen>
    );
  }

  const pace = averagePace(activity.activeMs, activity.distanceM);
  const fastest = splits.length ? Math.min(...splits.map((s) => s.durationMs)) : 0;
  const avgSplit = splits.length ? splits.reduce((n, s) => n + s.durationMs, 0) / splits.length : 0;
  const avgSpeed = activity.activeMs > 0 ? activity.distanceM / (activity.activeMs / 1000) : null;
  const cadence = activity.steps && activity.activeMs > 60_000 ? activity.steps / (activity.activeMs / 60_000) : null;

  const extra: [string, string][] = [];
  if (activity.elapsedMs - activity.activeMs > 5000) extra.push(['Elapsed time', formatDuration(activity.elapsedMs)]);
  if (avgSpeed != null && activity.distanceM >= 100) extra.push(['Average speed', `${formatSpeed(avgSpeed, units)} ${speedUnit(units)}`]);
  if (stats?.maxSpeedMps != null) extra.push(['Max speed', `${formatSpeed(stats.maxSpeedMps, units)} ${speedUnit(units)}`]);
  if (stats?.bestKmMs != null) extra.push(['Best pace (fastest km)', `${formatPace(stats.bestKmMs / 1000, 'km')} /km`]);
  if (cadence != null) extra.push(['Cadence', `${Math.round(cadence)} steps/min`]);
  if (stats?.elevationGainM != null) extra.push(['Elevation gain', `${Math.round(stats.elevationGainM)} m`]);

  const remove = () => {
    Alert.alert(fresh ? 'Discard this activity?' : 'Delete this activity?', 'You can undo this right after.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: fresh ? 'Discard' : 'Delete',
        style: 'destructive',
        onPress: () => setDeleted(id, true).then(() => setUndo(true)),
      },
    ]);
  };

  const exportGpx = async () => {
    try {
      if (!points?.length) {
        Alert.alert('No route to export', 'This activity has no recorded GPS points.');
        return;
      }
      const file = new File(Paths.cache, `cardigo-${activity.localDate}-${id.slice(-6)}.gpx`);
      if (file.exists) file.delete();
      file.create();
      await file.write(toGpx([{ name: activity.title || `${TYPE_LABEL[activity.type]} ${activity.localDate}`, points }]));
      await Sharing.shareAsync(file.uri, { mimeType: 'application/gpx+xml' });
    } catch (e) {
      Alert.alert('Could not export', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space.xl }}>
        <View style={{ paddingTop: insets.top + space.md, paddingHorizontal: space.lg, paddingBottom: space.md }}>
          <AppBar />
        </View>
        <View>
          <Animated.View entering={FadeIn.duration(400)}>
            <RouteMap lines={lines} style={styles.map} />
          </Animated.View>
          <RoundButton label="Close" onPress={close} style={[styles.close, { top: space.md }]}>
            <Ionicons name={fresh ? 'close' : 'chevron-back'} size={22} color={colors.ink} />
          </RoundButton>
        </View>

        <View style={styles.body}>
          <Enter>
            <Card style={styles.heading}>
              <ActivityBadge type={activity.type} size={48} inverted />
              <View style={{ flex: 1 }}>
                <T v="heading" numberOfLines={2} style={{ fontSize: 20 }}>
                  {activity.title || TYPE_LABEL[activity.type]}
                </T>
                <T v="small" muted>
                  {TYPE_LABEL[activity.type]} · {formatDay(activity.localDate, true)} ·{' '}
                  {formatStartTime(activity.startedAt, activity.tzOffsetMin)}
                </T>
              </View>
              <Tap accessibilityRole="button" accessibilityLabel="Edit" hitSlop={10} scaleTo={0.88} onPress={() => setEditing(true)} style={styles.edit}>
                <Ionicons name="create-outline" size={20} color={colors.ink} />
              </Tap>
            </Card>
          </Enter>

          <Enter i={1} style={styles.grid}>
            <MetricCard icon="navigate-outline" label="Distance" value={formatDistance(activity.distanceM, units)} unit={units} />
            <MetricCard icon="time-outline" label="Moving time" value={formatDuration(activity.activeMs)} />
          </Enter>
          <Enter i={2} style={styles.grid}>
            <MetricCard icon="speedometer-outline" label="Average pace" value={formatPace(pace, units)} unit={`/${units}`} />
            <MetricCard icon="footsteps-outline" label="Steps" value={formatSteps(activity.steps)} />
          </Enter>

          {extra.length ? (
            <Enter i={3}>
              <Card style={{ gap: space.sm }}>
                {extra.map(([label, value], i) => (
                  <View key={label}>
                    {i > 0 ? <Divider style={{ marginBottom: space.sm }} /> : null}
                    <View style={styles.kv}>
                      <T v="small" muted style={{ flex: 1 }}>
                        {label}
                      </T>
                      <T v="small" style={{ fontWeight: '600' }}>
                        {value}
                      </T>
                    </View>
                  </View>
                ))}
              </Card>
            </Enter>
          ) : null}

          {activity.note ? (
            <Enter i={3}>
              <Card style={{ gap: 4 }}>
                <T v="label" muted>
                  Notes
                </T>
                <T>{activity.note}</T>
              </Card>
            </Enter>
          ) : null}

          <Enter i={4}>
            <Button
              title="Share activity"
              onPress={() => router.push({ pathname: '/share/[id]', params: { id } })}
              icon={<Ionicons name="share-social-outline" size={18} color={colors.paper} />}
            />
          </Enter>

          {sameRoute && sameRoute.length > 0 ? (
            <Enter i={5}>
              <RouteComparison current={activity} previous={sameRoute[0]} count={sameRoute.length} units={units} />
            </Enter>
          ) : null}

          {splits.length > 0 ? (
            <Enter i={6}>
              <SectionHeader title="Splits per km" />
              <Card style={{ gap: space.sm, marginTop: space.sm }}>
                <View style={styles.splitHead}>
                  <T v="label" muted style={{ width: 28 }}>
                    Km
                  </T>
                  <T v="label" muted style={{ flex: 1 }}>
                    Pace
                  </T>
                  <T v="label" muted style={{ width: 56, textAlign: 'right' }}>
                    Time
                  </T>
                </View>
                {splits.map((s) => {
                  const faster = s.durationMs <= avgSplit;
                  return (
                    <View key={s.km} style={styles.split}>
                      <T v="small" style={{ width: 28, fontWeight: '600' }}>
                        {s.km}
                      </T>
                      <View style={{ flex: 1, gap: 3 }}>
                        <T v="small">{formatPace(s.durationMs / 1000, 'km')} /km</T>
                        <View style={styles.splitTrack}>
                          <Animated.View
                            entering={FadeInLeft.delay(200 + s.km * 40).duration(450)}
                            style={[
                              styles.splitBar,
                              {
                                width: `${(fastest / s.durationMs) * 100}%`,
                                backgroundColor: faster ? colors.ink : '#A8A8A8',
                              },
                            ]}
                          />
                        </View>
                      </View>
                      <T v="small" muted style={{ width: 56, textAlign: 'right' }}>
                        {formatDuration(s.durationMs)}
                      </T>
                    </View>
                  );
                })}
                <T v="small" muted>
                  Longer bars are faster. Black splits beat your average for this activity.
                </T>
              </Card>
            </Enter>
          ) : null}

          <Enter i={7}>
            <Card style={{ padding: space.sm }}>
              <ActionRow
                icon={saved ? 'bookmark' : 'bookmark-outline'}
                label={saved ? `Saved route: ${saved.name}` : 'Save this route'}
                onPress={() => (saved ? router.push('/routes') : setNaming(true))}
                disabled={!activity.bbox}
              />
              <ActionRow icon="create-outline" label="Edit name, type and notes" onPress={() => setEditing(true)} />
              <ActionRow icon="download-outline" label="Export GPX" onPress={exportGpx} />
              <ActionRow icon="trash-outline" label={fresh ? 'Discard activity' : 'Delete activity'} onPress={remove} />
            </Card>
          </Enter>

          {fresh ? <Button title="Done" kind="glass" onPress={close} /> : null}
        </View>
      </ScrollView>

      {editing ? <EditSheet activity={activity} onClose={() => setEditing(false)} /> : null}
      <NameRouteSheet
        visible={naming}
        initial={activity.title || `${TYPE_LABEL[activity.type]} route`}
        onClose={() => setNaming(false)}
        onSave={(name) => {
          setNaming(false);
          saveRoute(id, name);
        }}
      />

      <Modal transparent visible={undo} animationType="fade">
        <View style={styles.scrim}>
          <Animated.View entering={ZoomIn.springify().damping(18)}>
            <Card style={styles.dialog}>
              <T v="heading">Activity deleted</T>
              <T v="small" muted>
                It's removed from your history and statistics.
              </T>
              <Button
                title="Undo"
                onPress={() => {
                  setUndo(false);
                  setDeleted(id, false).then(requestSync);
                }}
              />
              <Button
                title="OK"
                kind="glass"
                onPress={() => {
                  setUndo(false);
                  requestSync();
                  resetTo(router, '/(tabs)');
                }}
              />
            </Card>
          </Animated.View>
        </View>
      </Modal>
    </Screen>
  );
}

function ActionRow({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Tap accessibilityRole="button" disabled={disabled} onPress={onPress} scaleTo={0.98} style={[styles.action, disabled && { opacity: 0.4 }]}>
      <Ionicons name={icon} size={19} color={colors.ink} />
      <T style={{ flex: 1 }} numberOfLines={1}>
        {label}
      </T>
      <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
    </Tap>
  );
}

function RouteComparison({
  current,
  previous,
  count,
  units,
}: {
  current: Activity;
  previous: Activity;
  count: number;
  units: Units;
}) {
  const curPace = averagePace(current.activeMs, current.distanceM);
  const prevPace = averagePace(previous.activeMs, previous.distanceM);
  const timeDiff = current.activeMs - previous.activeMs;
  const paceDiff = curPace != null && prevPace != null ? curPace - prevPace : null;
  const rows: [string, string, string][] = [
    ['Distance', `${formatDistance(previous.distanceM, units)} ${units}`, `${formatDistance(current.distanceM, units)} ${units}`],
    ['Duration', formatDuration(previous.activeMs), formatDuration(current.activeMs)],
    ['Avg pace', `${formatPace(prevPace, units)}`, `${formatPace(curPace, units)}`],
  ];
  return (
    <Card style={{ gap: space.sm }}>
      <T v="heading">Same route as before</T>
      <T v="small" muted>
        You've done this route {count} {count === 1 ? 'time' : 'times'} before. Compared with {formatDay(previous.localDate, true)}:
      </T>
      <View style={styles.compareHead}>
        <View style={{ flex: 1 }} />
        <T v="label" muted style={styles.compareCol}>
          Before
        </T>
        <T v="label" muted style={styles.compareCol}>
          Now
        </T>
      </View>
      {rows.map(([label, before, now]) => (
        <View key={label} style={styles.compareRow}>
          <T v="small" muted style={{ flex: 1 }}>
            {label}
          </T>
          <T v="small" style={styles.compareCol}>
            {before}
          </T>
          <T v="small" style={[styles.compareCol, { fontWeight: '600' }]}>
            {now}
          </T>
        </View>
      ))}
      <View style={styles.verdict}>
        <Ionicons name={paceDiff != null && paceDiff < 0 ? 'trending-up' : 'swap-vertical'} size={16} color={colors.ink} />
        <T v="small" style={{ flex: 1 }}>
          {paceDiff == null
            ? `${timeDiff <= 0 ? 'Faster' : 'Slower'} by ${formatDuration(Math.abs(timeDiff))} overall.`
            : Math.abs(paceDiff) < 2
              ? 'About the same pace as last time.'
              : `${paceDiff < 0 ? 'Faster' : 'Slower'} by ${Math.round(Math.abs(paceDiff))} s per km than last time.`}
        </T>
      </View>
    </Card>
  );
}

function NameRouteSheet({
  visible,
  initial,
  onClose,
  onSave,
}: {
  visible: boolean;
  initial: string;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  useEffect(() => setName(initial), [initial, visible]);
  return (
    <Sheet visible={visible} onClose={onClose} title="Save route">
      <Field label="Route name" value={name} onChangeText={setName} maxLength={60} autoFocus />
      <Button title="Save route" onPress={() => onSave(name)} disabled={!name.trim()} />
    </Sheet>
  );
}

function EditSheet({ activity, onClose }: { activity: Activity; onClose: () => void }) {
  const [title, setTitle] = useState(activity.title ?? '');
  const [note, setNote] = useState(activity.note ?? '');
  const [type, setType] = useState(activity.type);
  return (
    <Sheet visible onClose={onClose} title="Edit activity">
      <Field label="Name" value={title} onChangeText={setTitle} maxLength={80} placeholder={TYPE_LABEL[activity.type]} />
      <Field label="Notes" value={note} onChangeText={setNote} maxLength={500} multiline style={{ minHeight: 88, textAlignVertical: 'top', paddingTop: space.md }} />
      <Segmented options={TYPES} value={type} onChange={setType} />
      <Button
        title="Save"
        onPress={() => {
          updateActivity(activity.id, { title: title.trim() || null, note: note.trim() || null, type }).then(requestSync);
          onClose();
        }}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  map: { height: 340 },
  close: { position: 'absolute', left: space.lg },
  body: { padding: space.lg, marginTop: -space.xl, gap: space.md },
  heading: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  edit: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.inactive,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: { flexDirection: 'row', gap: space.md },
  kv: { flexDirection: 'row', alignItems: 'center' },
  splitHead: { flexDirection: 'row', gap: space.sm },
  split: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 40 },
  splitTrack: { height: 6, borderRadius: radius.pill, backgroundColor: colors.inactive, overflow: 'hidden' },
  splitBar: { height: '100%', borderRadius: radius.pill },
  action: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingHorizontal: space.sm },
  compareHead: { flexDirection: 'row', marginTop: space.xs },
  compareRow: { flexDirection: 'row', alignItems: 'center', minHeight: 26 },
  compareCol: { width: 84, textAlign: 'right' },
  verdict: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    marginTop: space.xs,
  },
  scrim: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'center', padding: space.lg },
  dialog: { gap: space.md, borderRadius: radius.xl },
});
