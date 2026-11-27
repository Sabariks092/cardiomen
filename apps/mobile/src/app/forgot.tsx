import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, friendlyError, publicPost } from '@/auth/api';
import { emailProblem, normalizeEmail } from '@/auth/emailCheck';
import { EmailField } from '@/auth/parts';
import { Button, Field, Screen, space, T } from '@/ui';

const RESEND_SECONDS = 60;

export default function Forgot() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'code'>('email');
  // Arrives with the email filled in: from Settings (the account's email) or from the sign-in
  // screen (whatever was typed there).
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  /** No account uses the email, so offer to create one. */
  const [unknown, setUnknown] = useState(false);
  const [wait, setWait] = useState(0);

  const sendCode = async () => {
    const problem = emailProblem(email);
    setEmailError(problem);
    setUnknown(false);
    setError(null);
    if (problem) return;
    setBusy(true);
    try {
      const address = normalizeEmail(email);
      await publicPost('/auth/forgot-password', { email: address });
      setEmail(address);
      setStep('code');
      setWait(RESEND_SECONDS);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'EMAIL_NOT_FOUND') {
        setEmailError(e.message);
        setUnknown(true);
      } else {
        setError(friendlyError(e));
      }
    } finally {
      setBusy(false);
    }
  };

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
            <T muted>We'll email you a code to set a new password.</T>
            <EmailField
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                setEmailError(null);
                setUnknown(false);
              }}
              error={emailError}
            />
            {unknown ? (
              <Button title="Create an account" kind="glass" onPress={() => router.replace('/register')} />
            ) : null}
            {error ? <T v="small">{error}</T> : null}
            <Button title="Send code" loading={busy} disabled={!email} onPress={sendCode} />
          </>
        ) : (
          <>
            <T muted>We sent a 6-digit code to {email}. It expires in 10 minutes.</T>
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
            <Button
              title="Use a different email"
              kind="ghost"
              onPress={() => {
                setStep('email');
                setCode('');
                setError(null);
              }}
            />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
