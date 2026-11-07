import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { hasDb } from '@/db';
import { requestSync, startSyncTriggers } from '@/sync/worker';
import { importFinished } from '@/tracking/importer';
import { colors } from '@/ui';

export default function RootLayout() {
  useEffect(() => {
    const stopSync = startSyncTriggers();
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active' && hasDb()) {
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
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
            animation: 'fade',
          }}
        />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
