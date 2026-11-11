import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalQuery } from '@/db';
import { allActivitiesLite } from '@/db/activities';
import { bestKilometre, deleteGoal, listGoals, saveGoal, setGoalPaused } from '@/db/cardigo';
import { useSettings } from '@/db/settings';
import { achievements, Goal, GOAL_KINDS, GoalKind, goalProgress, goalTitle, Kind } from '@/lib/analytics';
import { distanceValue } from '@/lib/format';
import { todayLocal } from '@/lib/stats';
import { evaluateProgress } from '@/progress/evaluate';
import {
  Button,
  Card,
  colors,
  EmptyState,
  Enter,
  Field,
  InkGloss,
  Pills,
  radius,
  RoundButton,
  Screen,
  SectionHeader,
  Sheet,
  space,
  T,
  Tap,
} from '@/ui';
import { AppBar } from '@/ui/appbar';

const TYPE_OPTIONS = [
  { value: 'any', label: 'Any activity' },
  { value: 'walk', label: 'Walk' },
  { value: 'jog', label: 'Jog' },
  { value: 'run', label: 'Run' },
] as const;

export default function Goals() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const settings = useSettings();
  const { data: goals } = useLocalQuery(listGoals, []);
  const { data: list } = useLocalQuery(allActivitiesLite, []);
  const { data: bestKm } = useLocalQuery(bestKilometre, []);
  const [editing, setEditing] = useState<Goal | 'new' | null>(null);
  const today = todayLocal();

  const badges = useMemo(
    () => achievements(list ?? [], settings.weekStart, settings.units, bestKm ?? null),
    [list, settings.weekStart, settings.units, bestKm],
  );
  const earned = badges.filter((b) => b.achieved).length;

  const fmt = (g: Goal, v: number) =>
    GOAL_KINDS.find((k) => k.value === g.kind)?.distance
      ? `${distanceValue(v, settings.units).toFixed(1)} ${settings.units}`
      : String(Math.round(v));

  const onLong = (g: Goal) =>
    Alert.alert(goalTitle(g, settings.units), undefined, [
      { text: 'Edit', onPress: () => setEditing(g) },
      { text: g.paused ? 'Resume goal' : 'Pause goal', onPress: () => setGoalPaused(g.id, !g.paused) },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          Alert.alert('Delete this goal?', undefined, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => deleteGoal(g.id) },
          ]),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + space.md, paddingHorizontal: space.lg, paddingBottom: insets.bottom + space.xl, gap: space.md }}
      >
        <AppBar />
        <Enter style={styles.header}>
          <RoundButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/progress'))}>
            <Ionicons name="chevron-back" size={20} color={colors.ink} />
          </RoundButton>
          <T v="title" style={{ flex: 1 }}>
            Goals
          </T>
          <RoundButton label="New goal" onPress={() => setEditing('new')}>
            <Ionicons name="add" size={22} color={colors.ink} />
          </RoundButton>
        </Enter>

        {goals && goals.length === 0 ? (
          <Card>
            <EmptyState
              icon="flag-outline"
              title="Set your first goal"
              body="Weekly distance, active days, a first 5 km run: pick something and Cardigo tracks it for you."
              action="Create a goal"
              onAction={() => setEditing('new')}
            />
          </Card>
        ) : (
          (goals ?? []).map((g, i) => {
            const p = goalProgress(g, list ?? [], today, settings.weekStart);
            return (
              <Enter key={g.id} i={i}>
                <Tap accessibilityRole="button" onPress={() => onLong(g)} onLongPress={() => onLong(g)}>
                  <Card style={[{ gap: space.sm }, g.paused && { opacity: 0.55 }]}>
                    <View style={styles.goalTop}>
                      <T v="heading" style={{ flex: 1 }}>
                        {goalTitle(g, settings.units)}
                      </T>
                      {p.done ? (
                        <View style={styles.doneBadge}>
                          <InkGloss r={radius.pill} />
                          <Ionicons name="checkmark" size={14} color={colors.paper} />
                          <T v="label" style={{ color: colors.paper }}>
                            Done
                          </T>
                        </View>
                      ) : g.paused ? (
                        <T v="label" muted>
                          Paused
                        </T>
                      ) : null}
                    </View>
                    <View style={styles.track}>
                      <Animated.View layout={LinearTransition.springify()} style={[styles.fill, { width: `${p.fraction * 100}%` }]} />
                    </View>
                    <View style={styles.goalTop}>
                      <T v="small" muted style={{ flex: 1 }}>
                        {fmt(g, p.current)} of {fmt(g, p.target)}
                      </T>
                      <T v="small" style={{ fontWeight: '600' }}>
                        {Math.round(p.fraction * 100)}%
                      </T>
                    </View>
                  </Card>
                </Tap>
              </Enter>
            );
          })
        )}

        <Enter i={4}>
          <SectionHeader title={`Achievements · ${earned} of ${badges.length}`} />
        </Enter>
        <View style={styles.badges}>
          {badges.map((b, i) => (
            <Enter key={b.id} i={5 + i} style={styles.badgeCell}>
              <Card style={[styles.badge, !b.achieved && { opacity: 0.7 }]}>
                <View style={[styles.medal, b.achieved ? null : styles.medalOff]}>
                  {b.achieved ? <InkGloss r={24} /> : null}
                  <Ionicons
                    name={b.achieved ? 'trophy' : 'trophy-outline'}
                    size={22}
                    color={b.achieved ? colors.paper : colors.textMuted}
                  />
                </View>
                <T v="small" center style={{ fontWeight: '600' }} numberOfLines={2}>
                  {b.title}
                </T>
                <T v="small" muted center numberOfLines={2} style={{ fontSize: 11 }}>
                  {b.detail}
                </T>
                {!b.achieved && b.progress > 0 ? (
                  <View style={[styles.track, { height: 4, alignSelf: 'stretch' }]}>
                    <View style={[styles.fill, { width: `${b.progress * 100}%` }]} />
                  </View>
                ) : null}
              </Card>
            </Enter>
          ))}
        </View>
      </ScrollView>

      <GoalSheet
        goal={editing === 'new' ? null : editing}
        visible={editing !== null}
        units={settings.units}
        onClose={() => setEditing(null)}
        onSave={async (g) => {
          setEditing(null);
          await saveGoal(g);
          evaluateProgress().catch(() => undefined);
        }}
      />
    </Screen>
  );
}

function GoalSheet({
  goal,
  visible,
  units,
  onClose,
  onSave,
}: {
  goal: Goal | null;
  visible: boolean;
  units: 'km' | 'mi';
  onClose: () => void;
  onSave: (g: { id?: string; kind: GoalKind; target: number; activityType: Kind | null }) => void;
}) {
  const unitM = units === 'mi' ? 1609.344 : 1000;
  const [kind, setKind] = useState<GoalKind>('distance_week');
  const [type, setType] = useState<Kind | 'any'>('any');
  const [target, setTarget] = useState('');

  useEffect(() => {
    if (!visible) return;
    setKind(goal?.kind ?? 'distance_week');
    setType(goal?.activityType ?? 'any');
    const isDistance = GOAL_KINDS.find((k) => k.value === (goal?.kind ?? 'distance_week'))?.distance;
    setTarget(goal ? String(isDistance ? +(goal.target / unitM).toFixed(2) : goal.target) : '');
  }, [visible, goal, unitM]);

  const isDistance = GOAL_KINDS.find((k) => k.value === kind)!.distance;
  const n = Number(target.replace(',', '.'));
  const maxCount = kind === 'active_days_week' ? 7 : 200;
  const valid = n > 0 && (isDistance ? n <= 10000 : Number.isInteger(n) && n <= maxCount);

  return (
    <Sheet visible={visible} onClose={onClose} title={goal ? 'Edit goal' : 'New goal'}>
      <T v="label" muted>
        Goal
      </T>
      <Pills options={GOAL_KINDS.map((k) => ({ value: k.value, label: k.label }))} value={kind} onChange={setKind} />
      {kind !== 'active_days_week' ? (
        <>
          <T v="label" muted style={{ marginTop: space.xs }}>
            Counts
          </T>
          <Pills options={TYPE_OPTIONS} value={type} onChange={setType} />
        </>
      ) : null}
      <Field
        label={isDistance ? `Target (${units})` : kind === 'active_days_week' ? 'Days per week (1 to 7)' : 'Number of activities'}
        value={target}
        onChangeText={setTarget}
        keyboardType="decimal-pad"
        placeholder={isDistance ? '20' : '5'}
      />
      <Button
        title={goal ? 'Save goal' : 'Create goal'}
        disabled={!valid}
        onPress={() =>
          onSave({
            id: goal?.id,
            kind,
            target: isDistance ? n * unitM : Math.round(n),
            activityType: kind === 'active_days_week' || type === 'any' ? null : type,
          })
        }
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  goalTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  doneBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.inactive, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4, backgroundColor: colors.ink },
  badges: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -space.xs },
  badgeCell: { width: '50%', padding: space.xs },
  badge: { alignItems: 'center', gap: 6, padding: space.md, minHeight: 150 },
  medal: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  medalOff: { backgroundColor: colors.inactive },
});
