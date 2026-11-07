import type { ActivityType } from '@engine';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { currentSession } from '@/auth/session';
import { useLocalQuery } from '@/db';
import { Activity, listActivities } from '@/db/activities';
import { useSettings } from '@/db/settings';
import { formatActivityDate, formatDistance, formatDuration, TYPE_LABEL } from '@/lib/format';
import { colors, Glass, Screen, Segmented, space, T } from '@/ui';
import { RouteThumb } from '@/ui/maps';

const TYPES = [
  { value: 'all', label: 'All' },
  { value: 'walk', label: 'Walk' },
  { value: 'jog', label: 'Jog' },
  { value: 'run', label: 'Run' },
] as const;

function Row({ item }: { item: Activity }) {
  const router = useRouter();
  const { units } = useSettings();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/activity/[id]', params: { id: item.id } })}
    >
      <Glass style={styles.row}>
        <RouteThumb lines={item.previewRoute} />
        <View style={{ flex: 1, gap: 2 }}>
          <T v="heading" numberOfLines={1}>
            {item.title || TYPE_LABEL[item.type]}
          </T>
          <T v="small" muted numberOfLines={1}>
            {formatActivityDate(item.startedAt, item.tzOffsetMin)}
          </T>
          <T v="small" numberOfLines={1}>
            {formatDistance(item.distanceM, units)} {units} · {formatDuration(item.activeMs)}
          </T>
        </View>
        {item.pendingSync && !currentSession()?.local ? (
          <Ionicons
            accessibilityLabel="Not backed up yet"
            name="cloud-upload-outline"
            size={16}
            color={colors.textFaint}
          />
        ) : null}
      </Glass>
    </Pressable>
  );
}

export default function Activities() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { date } = useLocalSearchParams<{ date?: string }>();
  const [type, setType] = useState<ActivityType | 'all'>('all');
  const { data } = useLocalQuery(() => listActivities(type, date), [type, date]);

  return (
    <Screen>
      <FlatList
        data={data ?? []}
        keyExtractor={(a) => a.id}
        renderItem={({ item }) => <Row item={item} />}
        contentContainerStyle={{
          paddingTop: insets.top + space.lg,
          paddingHorizontal: space.lg,
          paddingBottom: insets.bottom + 110,
          gap: space.md,
        }}
        ListHeaderComponent={
          <View style={{ gap: space.md }}>
            <T v="title">Activities</T>
            {date ? (
              <Pressable accessibilityRole="button" onPress={() => router.setParams({ date: '' })}>
                <T v="small" muted>
                  Showing {date} · tap to show all
                </T>
              </Pressable>
            ) : null}
            <Segmented options={TYPES} value={type} onChange={setType} />
          </View>
        }
        ListEmptyComponent={
          data ? (
            <T muted center style={{ marginTop: space.xxl }}>
              {type !== 'all' || date
                ? 'Nothing matches this filter.'
                : 'No activities yet. Press + on Home to record your first one.'}
            </T>
          ) : undefined
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
});
