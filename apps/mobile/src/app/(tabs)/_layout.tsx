import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { Tabs, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSettings } from '@/db/settings';
import { useRecordingState } from '@/tracking/useEngine';
import { ActivityPicker, PickerContext, useStartActivity } from '@/ui/activity';
import { colors, InkGloss, Pulse, radius, shadow, space, T, Tap } from '@/ui';

const TABS = {
  index: ['home', 'Home'],
  activities: ['list', 'Activities'],
  progress: ['stats-chart', 'Progress'],
  settings: ['settings', 'Settings'],
} as const;

const MOVE = LinearTransition.springify().damping(18).stiffness(220);

function TabBar({
  state,
  navigateToTab,
  onStart,
  recording,
}: {
  state: { index: number; routes: { key: string; name: keyof typeof TABS }[] };
  navigateToTab: (key: string) => void;
  onStart: () => void;
  recording: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const showLabel = width >= 400;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: Math.max(insets.bottom, space.md) }]}>
      <View style={styles.bar}>
        {state.routes.map((route, i) => {
          const focused = state.index === i;
          const [icon, label] = TABS[route.name];
          return (
            <Animated.View key={route.key} layout={MOVE}>
              <Tap
                accessibilityRole="tab"
                accessibilityLabel={label}
                accessibilityState={{ selected: focused }}
                scaleTo={0.92}
                onPress={() => {
                  if (focused) return;
                  Haptics.selectionAsync().catch(() => undefined);
                  navigateToTab(route.key);
                }}
                style={[styles.tab, focused && styles.tabOn, focused && showLabel && { paddingHorizontal: space.lg }]}
              >
                {focused ? (
                  <Animated.View entering={FadeIn.duration(200)} style={StyleSheet.absoluteFill}>
                    <InkGloss r={radius.pill} />
                  </Animated.View>
                ) : null}
                <Ionicons
                  name={focused ? icon : (`${icon}-outline` as const)}
                  size={20}
                  color={focused ? colors.paper : colors.textMuted}
                />
                {focused && showLabel ? (
                  <Animated.View entering={FadeIn.delay(60).duration(180)}>
                    <T v="small" style={{ color: colors.paper, fontWeight: '600' }}>
                      {label}
                    </T>
                  </Animated.View>
                ) : null}
              </Tap>
            </Animated.View>
          );
        })}
      </View>
      <Tap
        accessibilityRole="button"
        accessibilityLabel={recording ? 'Open the activity in progress' : 'Start an activity'}
        haptic
        scaleTo={0.9}
        onPress={onStart}
        style={styles.fab}
      >
        <InkGloss r={29} />
        {recording ? <Pulse size={14} color={colors.paper} /> : <Ionicons name="add" size={30} color={colors.paper} />}
      </Tap>
    </View>
  );
}

export default function TabsLayout() {
  const router = useRouter();
  const settings = useSettings();
  const start = useStartActivity();
  const { snapshot } = useRecordingState();
  const [picker, setPicker] = useState(false);
  const recording = snapshot?.state === 'ACTIVE' || snapshot?.state === 'PAUSED';

  // An activity in progress always comes first: the button goes back to it.
  const openPicker = () => (recording ? router.push('/track') : setPicker(true));

  return (
    <PickerContext.Provider value={openPicker}>
      <Tabs
        tabBar={(props) => (
          <TabBar
            state={props.state as never}
            navigateToTab={props.navigateToTab}
            onStart={openPicker}
            recording={recording}
          />
        )}
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: colors.bg },
          animation: 'shift',
        }}
      >
        <Tabs.Screen name="index" />
        <Tabs.Screen name="activities" />
        <Tabs.Screen name="progress" />
        <Tabs.Screen name="settings" />
      </Tabs>
      <ActivityPicker
        visible={picker}
        selected={settings.lastActivity ?? settings.defaultActivity}
        onClose={() => setPicker(false)}
        onPick={(t) => {
          setPicker(false);
          start(t);
        }}
      />
    </PickerContext.Provider>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
  },
  bar: {
    flexDirection: 'row',
    gap: 2,
    padding: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    boxShadow: shadow.raised,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 48,
    minWidth: 52,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
  },
  tabOn: { boxShadow: shadow.button },
  fab: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: shadow.button,
  },
});
