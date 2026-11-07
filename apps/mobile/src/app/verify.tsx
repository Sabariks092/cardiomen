import type { AuthResponse } from '@cardiomen/contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { friendlyError, publicPost } from '@/auth/api';
import { forgetSignupPassword, signupPassword } from '@/auth/pendingSignup';
import { startSession } from '@/auth/session';
import { requestSync } from '@/sync/worker';
import { importFinished } from '@/tracking/importer';
import { resetTo } from '@/ui/nav';
import { Button, Field, Screen, space, T } from '@/ui';

const RESEND_SECONDS = 60;

export default function Verify() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { email } = useLocalSearchParams<{ email: string }>();
  const [code, setCode] = useState('');
  // Normally remembered from the previous screen. Asked for again if the app restarted in between.
  const [remembered] = useState(signupPassword);
  const [typedPassword, setTypedPassword] = useState('');
  const password = remembered ?? typedPassword;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const id = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const auth = await publicPost<AuthResponse>('/auth/verify-otp', { email, code, password });
      forgetSignupPassword();
      await startSession(auth);
      importFinished().then(requestSync).catch((e) => console.warn(e));
      resetTo(router, '/(tabs)');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(null);
    try {
      await publicPost('/auth/resend-otp', { email, purpose: 'REGISTER' });
      setWait(RESEND_SECONDS);
    } catch (e) {
      setError(friendlyError(e));
    }
  };

  return (
    <Screen>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space.xl, paddingTop: insets.top + space.xxl, gap: space.lg }}
      >
        <T v="title">Check your email</T>
        <T muted>We sent a 6-digit code to {email}. It's valid for 10 minutes.</T>
        <Field
          label="Code"
          value={code}
          onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          style={{ fontSize: 24, letterSpacing: 8, textAlign: 'center' }}
        />
        {remembered ? null : (
          <Field
            label="Password you chose"
            value={typedPassword}
            onChangeText={setTypedPassword}
            secureTextEntry
            autoComplete="current-password"
          />
        )}
        {error ? <T v="small">{error}</T> : null}
        <Button title="Verify" loading={busy} disabled={code.length !== 6 || password.length < 8} onPress={submit} />
        <Button
          title={wait > 0 ? `Resend in ${wait}s` : 'Resend code'}
          kind="ghost"
          disabled={wait > 0}
          onPress={resend}
        />
      </ScrollView>
    </Screen>
  );
}
