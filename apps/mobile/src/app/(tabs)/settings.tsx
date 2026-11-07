import TrackingEngine, { EngineSnapshot } from '@engine';
import Ionicons from '@expo/vector-icons/Ionicons';
import { File, Paths } from 'expo-file-system';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { Alert, AppState, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { authed, friendlyError, getAuthState, publicPost } from '@/auth/api';
import { currentSession, endSession, getRefreshToken } from '@/auth/session';
import { deleteUserDb, useLocalQuery } from '@/db';
import { getTrackBlob, listActivities } from '@/db/activities';
import { saveSetting, useSettings } from '@/db/settings';
import { TYPE_LABEL } from '@/lib/format';
import { decodeTrack, toGpx } from '@/lib/track';
import { backupStatus, downloadTrackIfMissing, requestSync, restoreAllTracks, retryBlocked } from '@/sync/worker';
import { colors, Glass, Screen, Segmented, space, T } from '@/ui';
import { resetTo } from '@/ui/nav';

function Row({
  icon,
  title,
  detail,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  detail?: string;
  onPress?: () => void;
}) {
  return (
    <Pressable accessibilityRole={onPress ? 'button' : 'text'} disabled={!onPress} onPress={onPress} style={styles.row}>
      <Ionicons name={icon} size={20} color={colors.white} />
      <View style={{ flex: 1 }}>
        <T>{title}</T>
        {detail ? (
          <T v="small" muted>
            {detail}
          </T>
        ) : null}
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={16} color={colors.textFaint} /> : null}
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <T v="label" muted style={{ marginLeft: space.xs }}>
        {title}
      </T>
      <Glass style={{ padding: space.sm }}>{children}</Glass>
    </View>
  );
}

export default function Settings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const settings = useSettings();
  const session = currentSession();
  const { data: backup } = useLocalQuery(backupStatus, []);
  const [engine, setEngine] = useState<EngineSnapshot | null>(null);

  useFocusEffect(
    useCallback(() => {
      TrackingEngine.getSnapshot().then(setEngine);
    }, []),
  );

  // The battery screen is another app, so returning from it doesn't count as a focus change.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') TrackingEngine.getSnapshot().then(setEngine);
    });
    return () => sub.remove();
  }, []);

  const exportGpx = async () => {
    const activities = await listActivities('all');
    try {
      const file = new File(Paths.cache, `cardiomen-export-${Date.now()}.gpx`);
      const tracks = [];
      for (const a of activities) {
        const blob = (await getTrackBlob(a.id)) ?? (await downloadTrackIfMissing(a.id));
        if (!blob) continue;
        tracks.push({ name: `${a.title || TYPE_LABEL[a.type]} ${a.localDate}`, points: decodeTrack(blob) });
      }
      if (tracks.length === 0) {
        Alert.alert('Nothing to export yet');
        return;
      }
      const skipped = activities.length - tracks.length;
      if (skipped > 0) {
        Alert.alert('Some routes are missing', `${skipped} couldn't be downloaded and aren't in this file. Check your connection and try again.`);
      }
      file.create();
      await file.write(toGpx(tracks));
      await Sharing.shareAsync(file.uri, { mimeType: 'application/gpx+xml' });
    } catch (e) {
      Alert.alert('Could not export', e instanceof Error ? e.message : String(e));
    }
  };

  const signOut = () => {
    const pending = (backup?.pending ?? 0) + (backup?.blocked.length ?? 0);
    if (engine?.state === 'ACTIVE' || engine?.state === 'PAUSED') {
      Alert.alert('Finish your activity first', 'You have an activity in progress.');
      return;
    }
    Alert.alert(
      'Sign out?',
      pending > 0
        ? `${pending} item(s) aren't backed up yet. They stay on this phone and upload when you sign in again.`
        : undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: async () => {
            const refreshToken = await getRefreshToken();
            if (refreshToken) {
              // Not through authed(): that could refresh and store a new token just as we sign out.
              publicPost('/auth/logout', { refreshToken }).catch(() => undefined);
            }
            await endSession();
            resetTo(router, '/welcome');
          },
        },
      ],
    );
  };

  const deleteAccount = () => {
    if (engine?.state === 'ACTIVE' || engine?.state === 'PAUSED') {
      Alert.alert('Finish your activity first', 'You have an activity in progress.');
      return;
    }
    Alert.alert('Delete your account?', 'All activities are permanently removed from the server and this phone. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await authed('/me', { method: 'DELETE' });
            await deleteUserDb();
            await endSession();
            resetTo(router, '/welcome');
          } catch (e) {
            Alert.alert('Could not delete account', friendlyError(e));
          }
        },
      },
    ]);
  };

  const local = !session || session.local;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + space.lg,
          paddingHorizontal: space.lg,
          paddingBottom: insets.bottom + 110,
          gap: space.lg,
        }}
      >
        <T v="title">Settings</T>

        <Section title="Units and calendar">
          <View style={{ gap: space.sm, padding: space.xs }}>
            <Segmented
              options={[
                { value: 'km', label: 'Kilometers' },
                { value: 'mi', label: 'Miles' },
              ]}
              value={settings.units}
              onChange={(v) => saveSetting('units', v)}
            />
            <Segmented
              options={[
                { value: '1', label: 'Monday first' },
                { value: '0', label: 'Sunday first' },
              ]}
              value={String(settings.weekStart) as '0' | '1'}
              onChange={(v) => saveSetting('weekStart', Number(v) as 0 | 1)}
            />
          </View>
        </Section>

        <Section title="Reliable tracking">
          <Row
            icon="battery-charging-outline"
            title="Battery"
            detail={
              engine?.health.ignoringBatteryOptimizations
                ? 'Unrestricted. The phone should not stop tracking.'
                : 'Restricted. Tap to allow unrestricted use.'
            }
            onPress={() =>
              TrackingEngine.requestIgnoreBatteryOptimizations().then(() =>
                TrackingEngine.getSnapshot().then(setEngine),
              )
            }
          />
          <Row
            icon="pulse-outline"
            title="Tracking diagnostics"
            detail="Every pause, gap and recovery"
            onPress={() => router.push('/diagnostics')}
          />
          <Row
            icon="key-outline"
            title="App permissions"
            onPress={() => TrackingEngine.openAppSettings()}
          />
        </Section>

        <Section title="Your data">
          {local ? (
            <Row
              icon="cloud-offline-outline"
              title="Stored on this device"
              detail="Cloud backup turns on when the backend is connected"
            />
          ) : getAuthState() === 'signed-out' ? (
            <Row
              icon="log-in-outline"
              title="Sign in to back up"
              detail="Your activities are safe on this phone. They upload after you sign in."
              onPress={() => router.push('/welcome')}
            />
          ) : (
            <Row
              icon="cloud-outline"
              title={
                !backup
                  ? 'Checking backup…'
                  : backup.blocked.length
                    ? 'Some items could not back up'
                    : backup.pending
                      ? `${backup.pending} waiting to back up`
                      : 'Everything backed up'
              }
              detail={
                backup?.blocked.length
                  ? `${backup.blocked.length} couldn't upload: ${backup.blocked[0].error}. Tap to retry.`
                  : 'Tap to sync now'
              }
              onPress={() => (backup?.blocked.length ? retryBlocked() : requestSync(true))}
            />
          )}
          {!local ? (
            <Row
              icon="cloud-download-outline"
              title="Restore all routes"
              detail="Download every route to this phone"
              onPress={async () => {
                const { restored, failed } = await restoreAllTracks();
                Alert.alert(
                  failed > 0 ? 'Some routes could not download' : 'Routes restored',
                  failed > 0
                    ? `${restored} restored, ${failed} failed. Check your connection and try again.`
                    : restored > 0
                      ? `${restored} restored.`
                      : 'Every route is already on this phone.',
                );
              }}
            />
          ) : null}
          <Row icon="download-outline" title="Export all as GPX" onPress={exportGpx} />
        </Section>

        {!local ? (
          <Section title={session?.user.email ?? 'Account'}>
            <Row icon="log-out-outline" title="Sign out" onPress={signOut} />
            <Row icon="trash-outline" title="Delete account" onPress={deleteAccount} />
          </Section>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 54, padding: space.sm },
});
