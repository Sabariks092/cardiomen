import type { AuthResponse } from '@cardiomen/contracts';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { friendlyError, publicPost } from '@/auth/api';
import { startSession } from '@/auth/session';
import { requestSync } from '@/sync/worker';
import { importFinished } from '@/tracking/importer';
import { resetTo } from '@/ui/nav';
import { Button, Field, Screen, space, T } from '@/ui';

export default function SignIn() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const auth = await publicPost<AuthResponse>('/auth/login', { email, password });
      await startSession(auth);
      importFinished().then(requestSync).catch((e) => console.warn(e));
      resetTo(router, '/(tabs)');
    } catch (e) {
      setError(friendlyError(e));
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
          <T v="title">Sign in</T>
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
          />
          {error ? <T v="small">{error}</T> : null}
          <Button title="Sign in" loading={busy} disabled={!email || !password} onPress={submit} />
          <Button title="Forgot password?" kind="ghost" onPress={() => router.push('/forgot')} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
