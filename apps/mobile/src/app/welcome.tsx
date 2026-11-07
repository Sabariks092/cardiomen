import Ionicons from '@expo/vector-icons/Ionicons';
import { GoogleSignin, isErrorWithCode, statusCodes } from '@react-native-google-signin/google-signin';
import type { AuthResponse } from '@cardiomen/contracts';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { friendlyError, publicPost } from '@/auth/api';
import { LOCAL_ONLY, startLocalSession, startSession } from '@/auth/session';
import { requestSync } from '@/sync/worker';
import { importFinished } from '@/tracking/importer';
import { resetTo } from '@/ui/nav';
import { Button, Screen, space, T } from '@/ui';

const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

export default function Welcome() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enterApp = () => {
    importFinished().then(requestSync).catch((e) => console.warn(e));
    resetTo(router, '/(tabs)');
  };

  const google = async () => {
    setBusy(true);
    setError(null);
    try {
      GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
      await GoogleSignin.hasPlayServices();
      const result = await GoogleSignin.signIn();
      if (result.type !== 'success' || !result.data.idToken) return;
      const auth = await publicPost<AuthResponse>('/auth/google', { idToken: result.data.idToken });
      await startSession(auth);
      enterApp();
    } catch (e) {
      if (isErrorWithCode(e) && e.code === statusCodes.SIGN_IN_CANCELLED) return;
      setError(isErrorWithCode(e) ? `Google sign-in failed (${e.code})` : friendlyError(e));
    } finally {
      setBusy(false);
    }
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
        <T v="hero" style={{ fontSize: 44 }}>
          Cardiomen
        </T>
        <T muted>Walk. Jog. Run. Nothing else.</T>
      </View>

      <View style={{ gap: space.md }}>
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
            <Button
              title="Continue with Google"
              loading={busy}
              onPress={google}
              icon={<Ionicons name="logo-google" size={17} color="#000" />}
            />
            <Button title="Sign in with email" kind="glass" onPress={() => router.push('/sign-in')} />
            <Button title="Create an account" kind="ghost" onPress={() => router.push('/register')} />
          </>
        )}
      </View>
    </Screen>
  );
}
