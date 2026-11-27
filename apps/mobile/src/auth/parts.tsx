import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { friendlyError } from '@/auth/api';
import { emailSuggestion } from '@/auth/emailCheck';
import { GoogleCancelled, GoogleError, signInWithGoogle } from '@/auth/google';
import { requestSync } from '@/sync/worker';
import { importFinished } from '@/tracking/importer';
import { resetTo } from '@/ui/nav';
import { Button, colors, Field, space, T, Tap } from '@/ui';

/** An email input that offers a fix for common domain typos (gmial.com → gmail.com). */
export function EmailField({
  value,
  onChangeText,
  error,
}: {
  value: string;
  onChangeText: (v: string) => void;
  error?: string | null;
}) {
  const suggestion = emailSuggestion(value);
  return (
    <View style={{ gap: space.xs }}>
      <Field
        label="Email"
        value={value}
        onChangeText={onChangeText}
        error={error}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      {suggestion ? (
        <Tap accessibilityRole="button" onPress={() => onChangeText(suggestion)}>
          <T v="small" muted>
            Did you mean <T v="small" style={{ fontWeight: '600', textDecorationLine: 'underline' }}>{suggestion}</T>?
          </T>
        </Tap>
      ) : null}
    </View>
  );
}

/**
 * "Continue with Google". Works for new and existing accounts alike, so the same button sits on
 * the welcome, sign-in and create-account screens.
 */
export function GoogleButton({ onError, kind = 'primary' }: { onError: (message: string | null) => void; kind?: 'primary' | 'glass' }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const press = async () => {
    setBusy(true);
    onError(null);
    try {
      await signInWithGoogle();
      importFinished().then(requestSync).catch((e) => console.warn(e));
      resetTo(router, '/(tabs)');
    } catch (e) {
      if (e instanceof GoogleCancelled) return;
      onError(e instanceof GoogleError ? e.message : friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      title="Continue with Google"
      kind={kind}
      loading={busy}
      onPress={press}
      icon={<Ionicons name="logo-google" size={17} color={kind === 'primary' ? colors.paper : colors.ink} />}
    />
  );
}

/** A thin rule with "or" in the middle, between Google and the email form. */
export function OrDivider() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.divider }} />
      <T v="small" muted>
        or
      </T>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.divider }} />
    </View>
  );
}
