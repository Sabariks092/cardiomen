import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, friendlyError, publicPost } from '@/auth/api';
import { emailProblem, normalizeEmail } from '@/auth/emailCheck';
import { EmailField, GoogleButton, OrDivider } from '@/auth/parts';
import { rememberSignupPassword } from '@/auth/pendingSignup';
import { Button, Field, Screen, space, T } from '@/ui';

export default function Register() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The email already has an account, so offer to sign in with it instead. */
  const [taken, setTaken] = useState(false);

  const submit = async () => {
    const problem = emailProblem(email);
    const weak = password.length < 8 ? 'Use at least 8 characters for your password.' : null;
    setEmailError(problem);
    setPasswordError(weak);
    setError(null);
    setTaken(false);
    if (problem || weak) return;

    setBusy(true);
    try {
      const address = normalizeEmail(email);
      await publicPost('/auth/register', { name, email: address, password });
      rememberSignupPassword(password);
      router.push({ pathname: '/verify', params: { email: address } });
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'EMAIL_TAKEN' || e.code === 'EMAIL_UNDELIVERABLE')) {
        // Shown under the email field, where the problem is.
        setEmailError(e.message);
        setTaken(e.code === 'EMAIL_TAKEN');
      } else {
        setError(friendlyError(e));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: space.xl, paddingTop: insets.top + space.xxl, gap: space.lg }}
        >
          <T v="title">Create account</T>
          <GoogleButton kind="glass" onError={setError} />
          <OrDivider />
          <Field label="Name" value={name} onChangeText={setName} autoComplete="name" maxLength={80} />
          <EmailField
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              setEmailError(null);
              setTaken(false);
            }}
            error={emailError}
          />
          {taken ? (
            <Button title="Sign in instead" kind="glass" onPress={() => router.replace('/sign-in')} />
          ) : null}
          <Field
            label="Password"
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              setPasswordError(null);
            }}
            error={passwordError}
            secureTextEntry
            autoComplete="new-password"
            maxLength={128}
          />
          {error ? <T v="small">{error}</T> : null}
          <Button title="Send code" loading={busy} disabled={!name.trim() || !email || !password} onPress={submit} />
          <Button title="Already have an account? Sign in" kind="ghost" onPress={() => router.replace('/sign-in')} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
