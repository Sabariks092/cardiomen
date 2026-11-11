import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { hasDb, subscribeChanges } from '@/db';
import { loadSettings } from '@/db/settings';
import { setDateOrder } from '@/lib/format';
import { requestSync, startSyncTriggers } from '@/sync/worker';
import { importFinished } from '@/tracking/importer';
import { applyCoachSettings } from '@/tracking/coach';
import { colors, fonts } from '@/ui';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  // Poppins is embedded in native builds; loading here also covers development builds and web.
  const [fontsLoaded, fontError] = useFonts({
    [fonts.light]: require('../../assets/fonts/Poppins-Light.ttf'),
    [fonts.regular]: require('../../assets/fonts/Poppins-Regular.ttf'),
    [fonts.medium]: require('../../assets/fonts/Poppins-Medium.ttf'),
    [fonts.semibold]: require('../../assets/fonts/Poppins-SemiBold.ttf'),
    [fonts.bold]: require('../../assets/fonts/Poppins-Bold.ttf'),
  });
  const ready = fontsLoaded || !!fontError;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  // Date order is a display preference used everywhere, so it's applied once, here.
  useEffect(() => {
    const apply = () => {
      if (hasDb()) loadSettings().then((s) => setDateOrder(s.dateFormat)).catch(() => undefined);
    };
    apply();
    return subscribeChanges(apply);
  }, []);

  useEffect(() => {
    const stopSync = startSyncTriggers();
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active' && hasDb()) {
        applyCoachSettings().catch(() => undefined);
        importFinished()
          .then(requestSync)
          .catch((e) => console.warn('Import failed', e));
      }
    });
    return () => {
      stopSync();
      app.remove();
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider style={{ backgroundColor: colors.bg }}>
        <StatusBar style="dark" />
        {ready ? (
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
            animation: 'ios_from_right',
          }}
        />
        ) : null}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
