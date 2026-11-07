import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { friendlyError, publicPost } from '@/auth/api';
import { Button, Field, Screen, space, T } from '@/ui';

const RESEND_SECONDS = 60;

export default function Forgot() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const id = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space.xl, paddingTop: insets.top + space.xxl, gap: space.lg }}
      >
        <T v="title">Reset password</T>
        {step === 'email' ? (
          <>
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            {error ? <T v="small">{error}</T> : null}
            <Button
              title="Send code"
              loading={busy}
              disabled={!email}
              onPress={() =>
                run(async () => {
                  await publicPost('/auth/forgot-password', { email });
                  setStep('code');
                  setWait(RESEND_SECONDS);
                })
              }
            />
          </>
        ) : (
          <>
            <T muted>If that email has an account, a code is on its way.</T>
            <Field
              label="Code"
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
            />
            <Field
              label="New password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="new-password"
            />
            {error ? <T v="small">{error}</T> : null}
            <Button
              title="Set new password"
              loading={busy}
              disabled={code.length !== 6 || password.length < 8}
              onPress={() =>
                run(async () => {
                  await publicPost('/auth/reset-password', { email, code, password });
                  Alert.alert('Password changed', 'Sign in with your new password.');
                  router.back();
                })
              }
            />
            <Button
              title={wait > 0 ? `Resend in ${wait}s` : 'Resend code'}
              kind="ghost"
              disabled={wait > 0}
              onPress={() =>
                run(async () => {
                  await publicPost('/auth/resend-otp', { email, purpose: 'RESET_PASSWORD' });
                  setWait(RESEND_SECONDS);
                })
              }
            />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
