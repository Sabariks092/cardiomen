import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, space, T } from '@/ui';

const ICONS = {
  index: ['pulse-outline', 'Home'],
  activities: ['list-outline', 'Activities'],
  settings: ['options-outline', 'Settings'],
} as const;

function GlassTabBar({ state, navigateToTab }: { state: any; navigateToTab: (key: string) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: Math.max(insets.bottom, space.md) }]}>
      <View style={styles.bar}>
        {state.routes.map((route: { key: string; name: keyof typeof ICONS }, i: number) => {
          const focused = state.index === i;
          const [icon, label] = ICONS[route.name];
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: focused }}
              onPress={() => {
                if (!focused) navigateToTab(route.key);
              }}
              style={[styles.tab, focused && styles.tabOn]}
            >
              <Ionicons name={icon} size={19} color={focused ? colors.black : colors.textMuted} />
              {focused ? (
                <T v="small" style={{ color: colors.black, fontWeight: '600' }}>
                  {label}
                </T>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <GlassTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
        animation: 'fade',
      }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="activities" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  bar: {
    flexDirection: 'row',
    gap: space.xs,
    padding: 5,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(28,28,28,0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    minWidth: 52,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
  },
  tabOn: { backgroundColor: colors.white },
});
