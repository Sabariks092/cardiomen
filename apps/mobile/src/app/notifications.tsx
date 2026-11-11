import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Alert, FlatList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalQuery } from '@/db';
import { AppNotification, clearNotifications, listNotifications, markAllRead, markRead } from '@/db/cardigo';
import { Card, colors, EmptyState, Enter, IconName, RoundButton, Screen, space, T, Tap } from '@/ui';
import { AppBar } from '@/ui/appbar';

const ICON: Record<AppNotification['kind'], IconName> = {
  goal: 'flag',
  record: 'trophy',
  milestone: 'ribbon',
  weekly: 'calendar',
};

function ago(ms: number) {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'Yesterday' : `${d} days ago`;
}

export default function Notifications() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data } = useLocalQuery(listNotifications, []);
  const unread = (data ?? []).some((n) => !n.readAt);

  const open = (n: AppNotification) => {
    markRead(n.id);
    if (n.activityId) router.push({ pathname: '/activity/[id]', params: { id: n.activityId } });
    else if (n.kind === 'goal') router.push('/goals');
    else if (n.kind === 'weekly' || n.kind === 'milestone') router.push('/(tabs)/progress');
  };

  return (
    <Screen>
      <FlatList
        data={data ?? []}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ paddingTop: insets.top + space.md, paddingHorizontal: space.lg, paddingBottom: insets.bottom + space.xl, gap: space.sm }}
        ListHeaderComponent={
          <View style={{ gap: space.sm, marginBottom: space.sm }}>
            <AppBar />
            <Enter style={styles.header}>
              <RoundButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}>
                <Ionicons name="chevron-back" size={20} color={colors.ink} />
              </RoundButton>
              <T v="title" style={{ flex: 1 }}>
                Notifications
              </T>
            </Enter>
            {data && data.length > 0 ? (
              <View style={styles.actions}>
                <Tap accessibilityRole="button" disabled={!unread} onPress={markAllRead} style={!unread && { opacity: 0.4 }}>
                  <T v="small" style={{ fontWeight: '600' }}>
                    Mark all as read
                  </T>
                </Tap>
                <Tap
                  accessibilityRole="button"
                  onPress={() =>
                    Alert.alert('Clear all notifications?', 'Your goals, records and activities are not affected.', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Clear', style: 'destructive', onPress: clearNotifications },
                    ])
                  }
                >
                  <T v="small" muted>
                    Clear all
                  </T>
                </Tap>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          data ? (
            <EmptyState
              icon="notifications-outline"
              title="Nothing yet"
              body="Reached goals, new personal records, distance milestones and your weekly summary appear here."
            />
          ) : undefined
        }
        renderItem={({ item, index }) => (
          <Enter i={Math.min(index, 6)}>
            <Tap accessibilityRole="button" onPress={() => open(item)}>
              <Card style={styles.row}>
                <View style={[styles.icon, !item.readAt && styles.iconUnread]}>
                  <Ionicons name={ICON[item.kind]} size={18} color={item.readAt ? colors.ink : colors.paper} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <T v="heading" style={{ fontSize: 14 }}>
                    {item.title}
                  </T>
                  <T v="small" muted>
                    {item.body}
                  </T>
                  <T v="small" faint style={{ fontSize: 11 }}>
                    {ago(item.createdAt)}
                  </T>
                </View>
                {!item.readAt ? <View style={styles.dot} /> : null}
              </Card>
            </Tap>
          </Enter>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  actions: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space.xs },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, padding: space.md },
  icon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.inactive, alignItems: 'center', justifyContent: 'center' },
  iconUnread: { backgroundColor: colors.ink },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.ink, marginTop: 6 },
});
