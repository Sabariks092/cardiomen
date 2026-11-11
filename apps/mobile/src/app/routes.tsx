import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalQuery } from '@/db';
import { Activity, recentActivities } from '@/db/activities';
import { listSavedRoutes, removeRoute, renameRoute, SavedRoute } from '@/db/cardigo';
import { useSettings } from '@/db/settings';
import { formatDay, formatDistance, formatDuration, TYPE_LABEL, Units } from '@/lib/format';
import {
  ActivityBadge,
  Button,
  Card,
  colors,
  EmptyState,
  Enter,
  Field,
  RoundButton,
  Screen,
  SectionHeader,
  Sheet,
  space,
  T,
  Tap,
} from '@/ui';
import { AppBar } from '@/ui/appbar';
import { ActivityCard, useStartActivity } from '@/ui/activity';
import { RouteThumb } from '@/ui/maps';
import { getActivity } from '@/db/activities';

export default function Routes() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { units } = useSettings();
  const start = useStartActivity();
  const { data: saved } = useLocalQuery(async () => {
    const routes = await listSavedRoutes();
    const withActivity = await Promise.all(routes.map(async (r) => ({ route: r, activity: await getActivity(r.activityId) })));
    return withActivity.filter((x): x is { route: SavedRoute; activity: Activity } => !!x.activity);
  }, []);
  const { data: history } = useLocalQuery(
    () => recentActivities(30).then((l) => l.filter((a) => a.previewRoute.some((line) => line.length > 1))),
    [],
  );
  const [renaming, setRenaming] = useState<SavedRoute | null>(null);

  const actions = (r: SavedRoute, a: Activity) =>
    Alert.alert(r.name, undefined, [
      { text: `Repeat as a ${TYPE_LABEL[a.type].toLowerCase()}`, onPress: () => start(a.type, a.id) },
      { text: 'View details', onPress: () => router.push({ pathname: '/activity/[id]', params: { id: a.id } }) },
      { text: 'Rename', onPress: () => setRenaming(r) },
      {
        text: 'Remove from saved',
        style: 'destructive',
        onPress: () => removeRoute(r.id),
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
            Routes
          </T>
        </Enter>

        <Enter i={1}>
          <SectionHeader title="Saved routes" />
        </Enter>
        {saved && saved.length === 0 ? (
          <Card>
            <EmptyState
              icon="bookmark-outline"
              title="No saved routes"
              body="Open an activity and choose Save this route. You can then repeat it with the route shown on the map, and compare your times."
            />
          </Card>
        ) : (
          (saved ?? []).map(({ route, activity }, i) => (
            <Enter key={route.id} i={2 + i}>
              <SavedRouteCard route={route} activity={activity} units={units} onPress={() => actions(route, activity)} onRepeat={() => start(activity.type, activity.id)} />
            </Enter>
          ))
        )}

        <Enter i={4}>
          <SectionHeader title="Route history" />
        </Enter>
        {history && history.length === 0 ? (
          <T v="small" muted>
            Activities with a GPS route will appear here.
          </T>
        ) : (
          (history ?? []).map((a, i) => (
            <Enter key={a.id} i={5 + i}>
              <ActivityCard activity={a} units={units} onPress={() => router.push({ pathname: '/activity/[id]', params: { id: a.id } })} />
            </Enter>
          ))
        )}
      </ScrollView>

      <RenameSheet
        route={renaming}
        onClose={() => setRenaming(null)}
        onSave={(name) => {
          if (renaming) renameRoute(renaming.id, name);
          setRenaming(null);
        }}
      />
    </Screen>
  );
}

function SavedRouteCard({
  route,
  activity: a,
  units,
  onPress,
  onRepeat,
}: {
  route: SavedRoute;
  activity: Activity;
  units: Units;
  onPress: () => void;
  onRepeat: () => void;
}) {
  return (
    <Tap accessibilityRole="button" onPress={onPress}>
      <Card style={{ gap: space.md }}>
        <View style={styles.row}>
          <View style={styles.thumb}>
            <RouteThumb lines={a.previewRoute} size={70} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <T v="heading" numberOfLines={1}>
              {route.name}
            </T>
            <View style={styles.row}>
              <ActivityBadge type={a.type} size={20} />
              <T v="small" muted>
                {TYPE_LABEL[a.type]} · {formatDay(a.localDate, true)}
              </T>
            </View>
            <T v="small">
              {formatDistance(a.distanceM, units)} {units} · {formatDuration(a.activeMs)}
            </T>
          </View>
        </View>
        <Button
          title="Repeat this route"
          kind="glass"
          onPress={onRepeat}
          style={{ minHeight: 44 }}
          icon={<Ionicons name="repeat" size={16} color={colors.ink} />}
        />
      </Card>
    </Tap>
  );
}

function RenameSheet({ route, onClose, onSave }: { route: SavedRoute | null; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState('');
  useEffect(() => setName(route?.name ?? ''), [route]);
  const valid = useMemo(() => name.trim().length > 0, [name]);
  return (
    <Sheet visible={!!route} onClose={onClose} title="Rename route">
      <Field label="Route name" value={name} onChangeText={setName} maxLength={60} autoFocus />
      <Button title="Save" disabled={!valid} onPress={() => onSave(name)} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  thumb: {
    width: 76,
    height: 76,
    borderRadius: 20,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.xs,
  },
});
