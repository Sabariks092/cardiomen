import TrackingEngine, { EngineEvent } from '@engine';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Screen, space, T } from '@/ui';

export default function Diagnostics() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [events, setEvents] = useState<EngineEvent[]>([]);

  useEffect(() => {
    TrackingEngine.getEvents(300).then(setEvents);
  }, []);

  return (
    <Screen>
      <FlatList
        data={events}
        keyExtractor={(e, i) => `${e.sessionId}-${e.tWall}-${i}`}
        contentContainerStyle={{
          paddingTop: insets.top + space.lg,
          paddingHorizontal: space.lg,
          paddingBottom: insets.bottom + space.xl,
          gap: space.sm,
        }}
        ListHeaderComponent={
          <View style={{ gap: space.sm, marginBottom: space.md }}>
            <T v="title">Tracking diagnostics</T>
            <T muted>The engine's log, kept for 30 days. A gap means the app was interrupted.</T>
          </View>
        }
        ListEmptyComponent={<T muted>No events yet.</T>}
        renderItem={({ item }) => (
          <View>
            <T>
              {item.kind}
              {item.detail ? ` · ${item.detail}` : ''}
            </T>
            <T v="small" faint>
              {new Date(item.tWall).toLocaleString()} · {item.sessionId.slice(0, 13)}
            </T>
          </View>
        )}
        ListFooterComponent={<Button title="Back" kind="glass" onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))} style={{ marginTop: space.lg }} />}
      />
    </Screen>
  );
}
