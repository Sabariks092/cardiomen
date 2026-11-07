import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalQuery } from '@/db';
import { getActivity, getTrackBlob, setDeleted, updateActivity } from '@/db/activities';
import { useSettings } from '@/db/settings';
import { averagePace, formatActivityDate, formatDistance, formatDuration, formatPace, formatSteps, TYPE_LABEL } from '@/lib/format';
import { decodeTrack, RawPoint, splitsOf, toSegments } from '@/lib/track';
import { downloadTrackIfMissing, requestSync } from '@/sync/worker';
import { Button, colors, Field, Glass, radius, Screen, Segmented, space, Stat, T } from '@/ui';
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
  const [points, setPoints] = useState<RawPoint[] | null>(null);
  const [editing, setEditing] = useState(false);
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

  const remove = () => {
    if (fresh) {
      Alert.alert('Discard this activity?', 'You can still restore it for a few seconds.', [
        { text: 'Keep', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => setDeleted(id, true).then(() => setUndo(true)) },
      ]);
      return;
    }
    Alert.alert('Delete this activity?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => setDeleted(id, true).then(() => setUndo(true)) },
    ]);
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space.xl }}>
        <RouteMap lines={lines} style={styles.map} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={close}
          style={[styles.close, { top: insets.top + space.sm }]}
        >
          <Ionicons name={fresh ? 'close' : 'chevron-back'} size={22} color={colors.white} />
        </Pressable>

        <View style={styles.body}>
          <View style={styles.titleRow}>
            <View style={{ flex: 1 }}>
              <T v="title" numberOfLines={2}>
                {activity.title || TYPE_LABEL[activity.type]}
              </T>
              <T v="small" muted>
                {formatActivityDate(activity.startedAt, activity.tzOffsetMin)}
              </T>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Edit" hitSlop={10} onPress={() => setEditing(true)}>
              <Ionicons name="create-outline" size={22} color={colors.white} />
            </Pressable>
          </View>

          <Glass style={{ gap: space.lg }}>
            <View style={styles.statRow}>
              <Stat large label={units} value={formatDistance(activity.distanceM, units)} />
              <Stat large label="Duration" value={formatDuration(activity.activeMs)} />
            </View>
            <View style={styles.statRow}>
              <Stat label={`Avg pace /${units}`} value={formatPace(pace, units)} />
              <Stat label="Steps" value={formatSteps(activity.steps)} />
            </View>
            {activity.elapsedMs - activity.activeMs > 5000 ? (
              <T v="small" faint>
                Elapsed time including pauses: {formatDuration(activity.elapsedMs)}
              </T>
            ) : null}
          </Glass>

          <Button
            title="Share"
            onPress={() => router.push({ pathname: '/share/[id]', params: { id } })}
            icon={<Ionicons name="share-outline" size={18} color={colors.black} />}
          />

          {splits.length > 0 ? (
            <Glass style={{ gap: space.sm }}>
              <T v="label" muted>
                Splits per km
              </T>
              {splits.map((s) => (
                <View key={s.km} style={styles.split}>
                  <T v="small" style={{ width: 28 }}>
                    {s.km}
                  </T>
                  <View style={styles.splitTrack}>
                    <View style={[styles.splitBar, { width: `${(fastest / s.durationMs) * 100}%` }]} />
                  </View>
                  <T v="small" style={{ width: 52, textAlign: 'right' }}>
                    {formatDuration(s.durationMs)}
                  </T>
                </View>
              ))}
            </Glass>
          ) : null}

          {fresh ? <Button title="Done" kind="glass" onPress={close} /> : null}
          <Pressable accessibilityRole="button" onPress={remove} style={styles.delete}>
            <T v="small" muted>
              {fresh ? 'Discard' : 'Delete activity'}
            </T>
          </Pressable>
        </View>
      </ScrollView>

      {editing ? <EditModal activity={activity} onClose={() => setEditing(false)} /> : null}

      <Modal transparent visible={undo} animationType="fade">
        <View style={styles.scrim}>
          <Glass style={{ gap: space.md, backgroundColor: '#161616' }}>
            <T v="heading">Activity deleted</T>
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
          </Glass>
        </View>
      </Modal>
    </Screen>
  );
}

function EditModal({
  activity,
  onClose,
}: {
  activity: NonNullable<Awaited<ReturnType<typeof getActivity>>>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(activity.title ?? '');
  const [note, setNote] = useState(activity.note ?? '');
  const [type, setType] = useState(activity.type);
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <Glass style={{ gap: space.md, backgroundColor: '#161616' }}>
          <T v="heading">Edit activity</T>
          <Field label="Title" value={title} onChangeText={setTitle} maxLength={80} />
          <Field label="Note" value={note} onChangeText={setNote} maxLength={500} multiline />
          <Segmented options={TYPES} value={type} onChange={setType} />
          <Button
            title="Save"
            onPress={() => {
              updateActivity(activity.id, { title: title.trim() || null, note: note.trim() || null, type }).then(
                requestSync,
              );
              onClose();
            }}
          />
          <Button title="Cancel" kind="ghost" onPress={onClose} />
        </Glass>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  map: { height: 340, backgroundColor: colors.bg },
  close: {
    position: 'absolute',
    left: space.lg,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.glassOverMap,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { padding: space.lg, gap: space.md },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, marginBottom: space.xs },
  statRow: { flexDirection: 'row', gap: space.md },
  split: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 22 },
  splitTrack: { flex: 1, height: 6, borderRadius: radius.pill, backgroundColor: colors.fieldBg, overflow: 'hidden' },
  splitBar: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.white },
  delete: { alignItems: 'center', minHeight: 44, justifyContent: 'center' },
  scrim: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'center', padding: space.lg },
});
