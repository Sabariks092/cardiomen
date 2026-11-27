import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GoogleButton } from '@/auth/parts';
import { LOCAL_ONLY, startLocalSession } from '@/auth/session';
import { requestSync } from '@/sync/worker';
import { importFinished } from '@/tracking/importer';
import { resetTo } from '@/ui/nav';
import { Button, Enter, Screen, space, T } from '@/ui';

export default function Welcome() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const enterApp = () => {
    importFinished().then(requestSync).catch((e) => console.warn(e));
    resetTo(router, '/(tabs)');
  };

  return (
    <Screen
      style={{
        paddingTop: insets.top + space.xxl,
        paddingBottom: insets.bottom + space.xl,
        paddingHorizontal: space.xl,
        justifyContent: 'space-between',
      }}
    >
      <View style={{ flex: 1, justifyContent: 'center', gap: space.sm }}>
        <Enter>
          <Image
            source={require('../../assets/brand/logo.png')}
            accessibilityLabel="Cardigo"
            resizeMode="contain"
            style={{ width: 180, height: 180, marginBottom: space.lg }}
          />
        </Enter>
        <Enter i={2}>
          <T v="label" muted style={{ letterSpacing: 2 }}>
            Your cardio. Your progress.
          </T>
          <T muted style={{ marginTop: space.md }}>Walk. Jog. Run. Track, analyse, improve.</T>
        </Enter>
      </View>

      <Enter i={4} style={{ gap: space.md }}>
        {error ? <T v="small" center>{error}</T> : null}
        {LOCAL_ONLY ? (
          <>
            <Button
              title="Continue on this device"
              onPress={async () => {
                await startLocalSession();
                enterApp();
              }}
            />
            <T v="small" faint center>
              Sign-in and cloud backup turn on once the backend is connected.
            </T>
          </>
        ) : (
          <>
            <GoogleButton onError={setError} />
            <Button title="Sign in with email" kind="glass" onPress={() => router.push('/sign-in')} />
            <Button title="Create an account" kind="ghost" onPress={() => router.push('/register')} />
          </>
        )}
      </Enter>
    </Screen>
  );
}
