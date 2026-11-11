import type { ActivityType } from '@engine';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { createContext, memo, useContext } from 'react';
import { StyleSheet, View } from 'react-native';
import { Activity } from '@/db/activities';
import { saveSetting } from '@/db/settings';
import { averagePace, formatDay, formatDistance, formatDuration, formatPace, formatStartTime, TYPE_LABEL, Units } from '@/lib/format';
import { ActivityBadge, Card, colors, radius, Sheet, space, T, Tap } from './index';
import { RouteThumb } from './maps';

export const TYPES: ActivityType[] = ['walk', 'jog', 'run'];

/** How far tab content must stay clear of the floating navigation bar. */
export const TAB_BAR_SPACE = 104;

/** Lets any tab open the activity picker (or the activity in progress), e.g. from an empty state. */
export const PickerContext = createContext<() => void>(() => undefined);
export const useOpenActivityPicker = () => useContext(PickerContext);

const START_LABEL = { walk: 'Start walking', jog: 'Start jogging', run: 'Start running' } as const;
const PICK_HINT = {
  walk: 'An easy pace, any distance',
  jog: 'A steady, relaxed run',
  run: 'Faster, with effort',
} as const;

export function startLabel(type: ActivityType) {
  return START_LABEL[type];
}

/** Remembers the choice and opens GPS preparation for it. */
export function useStartActivity() {
  const router = useRouter();
  return (type: ActivityType, guide?: string) => {
    saveSetting('lastActivity', type).catch(() => undefined);
    router.push({ pathname: '/track', params: guide ? { type, guide } : { type } });
  };
}

/** Walk, Jog or Run, in a bottom sheet. Opened by the Start button from anywhere. */
export function ActivityPicker({
  visible,
  onClose,
  onPick,
  selected,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (type: ActivityType) => void;
  selected?: ActivityType | null;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Start an activity">
      {TYPES.map((t) => (
        <Tap
          key={t}
          accessibilityRole="button"
          accessibilityLabel={START_LABEL[t]}
          haptic
          onPress={() => onPick(t)}
          style={[styles.pickRow, selected === t && styles.pickRowOn]}
        >
          <ActivityBadge type={t} size={46} inverted />
          <View style={{ flex: 1 }}>
            <T v="heading">{TYPE_LABEL[t]}</T>
            <T v="small" muted>
              {PICK_HINT[t]}
            </T>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Tap>
      ))}
    </Sheet>
  );
}

/** One activity in a list: route or icon, type, when, distance, time and pace. */
export const ActivityCard = memo(function ActivityCard({
  activity: a,
  units,
  onPress,
  onLongPress,
  tag,
}: {
  activity: Activity;
  units: Units;
  onPress: () => void;
  onLongPress?: () => void;
  tag?: string | null;
}) {
  const hasRoute = a.previewRoute.some((l) => l.length > 1);
  const pace = averagePace(a.activeMs, a.distanceM);
  return (
    <Tap accessibilityRole="button" onPress={onPress} onLongPress={onLongPress} delayLongPress={450}>
      <Card style={styles.card}>
        <View style={styles.thumb}>
          {hasRoute ? <RouteThumb lines={a.previewRoute} size={58} /> : <ActivityBadge type={a.type} size={40} />}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={styles.titleRow}>
            <T v="heading" numberOfLines={1} style={{ flexShrink: 1 }}>
              {a.title || TYPE_LABEL[a.type]}
            </T>
            {tag ? (
              <View style={styles.tag}>
                <T v="label" style={{ fontSize: 9 }}>
                  {tag}
                </T>
              </View>
            ) : null}
          </View>
          <T v="small" muted numberOfLines={1}>
            {a.title ? `${TYPE_LABEL[a.type]} · ` : ''}
            {formatDay(a.localDate)} · {formatStartTime(a.startedAt, a.tzOffsetMin)}
          </T>
          <View style={styles.numbers}>
            <T v="small" style={{ fontWeight: '600' }}>
              {formatDistance(a.distanceM, units)} {units}
            </T>
            <T v="small" muted>
              {formatDuration(a.activeMs)}
            </T>
            <T v="small" muted>
              {formatPace(pace, units)} /{units}
            </T>
          </View>
        </View>
        {a.pendingSync ? (
          <Ionicons accessibilityLabel="Not backed up yet" name="cloud-upload-outline" size={15} color={colors.textFaint} />
        ) : null}
        <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
      </Card>
    </Tap>
  );
});

const styles = StyleSheet.create({
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 72,
    paddingHorizontal: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  pickRowOn: { borderColor: colors.ink },
  card: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  tag: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill, backgroundColor: colors.inactive },
  numbers: { flexDirection: 'row', gap: space.md, marginTop: 2 },
});
