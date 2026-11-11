import TrackingEngine, { ActivityType, EngineSnapshot } from '@engine';
import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { Alert, AppState, PermissionsAndroid, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { authed, friendlyError, getAuthState, publicPost } from '@/auth/api';
import { currentSession, endSession, getRefreshToken } from '@/auth/session';
import { deleteUserDb, useLocalQuery } from '@/db';
import { allActivitiesLite, deleteAllActivities, getTrackBlob, listActivities } from '@/db/activities';
import { saveSetting, Settings as AppSettings, useSettings } from '@/db/settings';
import { activitiesCsv } from '@/lib/analytics';
import { formatDay, TYPE_LABEL } from '@/lib/format';
import { todayLocal } from '@/lib/stats';
import { decodeTrack, toGpx } from '@/lib/track';
import { backupStatus, downloadTrackIfMissing, requestSync, restoreAllTracks, retryBlocked } from '@/sync/worker';
import { applyCoachSettings } from '@/tracking/coach';
import { Avatar, Card, colors, Enter, IconName, Pills, radius, Screen, Segmented, space, T, Tap } from '@/ui';
import { AppBar } from '@/ui/appbar';
import { TAB_BAR_SPACE } from '@/ui/activity';
import { resetTo } from '@/ui/nav';
import { Switch } from '@/ui/switch';

function Row({
  icon,
  title,
  detail,
  onPress,
  right,
  danger,
}: {
  icon: IconName;
  title: string;
  detail?: string;
  onPress?: () => void;
  right?: ReactNode;
  danger?: boolean;
}) {
  return (
    <Tap accessibilityRole={onPress ? 'button' : 'text'} disabled={!onPress} onPress={onPress} scaleTo={0.98} style={styles.row}>
      <View style={[styles.icon, danger && styles.iconDanger]}>
        <Ionicons name={icon} size={17} color={danger ? colors.paper : colors.ink} />
      </View>
      <View style={{ flex: 1 }}>
        <T style={danger ? { fontWeight: '600' } : undefined}>{title}</T>
        {detail ? (
          <T v="small" muted>
            {detail}
          </T>
        ) : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={16} color={colors.textFaint} /> : null)}
    </Tap>
  );
}

function Section({ title, children, i = 0 }: { title: string; children: ReactNode; i?: number }) {
  return (
    <Enter i={i} style={{ gap: space.sm }}>
      <T v="label" muted style={{ marginLeft: space.xs }}>
        {title}
      </T>
      <Card style={{ padding: space.sm }}>{children}</Card>
    </Enter>
  );
}

function Block({ children }: { children: ReactNode }) {
  return <View style={{ gap: space.sm, padding: space.sm }}>{children}</View>;
}

export default function Settings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const settings = useSettings();
  const session = currentSession();
  const { data: backup } = useLocalQuery(backupStatus, []);
  const [engine, setEngine] = useState<EngineSnapshot | null>(null);
  const [perms, setPerms] = useState<{ location: boolean; notifications: boolean; activity: boolean } | null>(null);

  const checkDevice = useCallback(() => {
    TrackingEngine.getSnapshot().then(setEngine);
    if (Platform.OS !== 'android') return;
    const P = PermissionsAndroid.PERMISSIONS;
    Promise.all([
      PermissionsAndroid.check(P.ACCESS_FINE_LOCATION),
      Number(Platform.Version) < 33 ? Promise.resolve(true) : PermissionsAndroid.check(P.POST_NOTIFICATIONS),
      PermissionsAndroid.check(P.ACTIVITY_RECOGNITION),
    ])
      .then(([location, notifications, activity]) => setPerms({ location, notifications, activity }))
      .catch(() => undefined);
  }, []);

  useFocusEffect(checkDevice);

  // Permission and battery screens are other apps, so returning from them isn't a focus change.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') checkDevice();
    });
    return () => sub.remove();
  }, [checkDevice]);

  /** Saves a tracking setting and hands it to the engine, so a recording in progress uses it too. */
  const setTracking = async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    await saveSetting(key, value);
    applyCoachSettings().catch(() => undefined);
  };

  const share = async (name: string, content: string, mimeType: string) => {
    const file = new File(Paths.cache, name);
    if (file.exists) file.delete();
    file.create();
    await file.write(content);
    await Sharing.shareAsync(file.uri, { mimeType });
  };

  const exportGpx = async () => {
    try {
      const activities = await listActivities('all');
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
      await share(`cardigo-export-${todayLocal()}.gpx`, toGpx(tracks), 'application/gpx+xml');
    } catch (e) {
      Alert.alert('Could not export', e instanceof Error ? e.message : String(e));
    }
  };

  const exportCsv = async () => {
    try {
      const activities = await allActivitiesLite();
      if (activities.length === 0) {
        Alert.alert('Nothing to export yet');
        return;
      }
      await share(`cardigo-activities-${todayLocal()}.csv`, activitiesCsv(activities, settings.units), 'text/csv');
    } catch (e) {
      Alert.alert('Could not export', e instanceof Error ? e.message : String(e));
    }
  };

  const busyTracking = () => {
    if (engine?.state === 'ACTIVE' || engine?.state === 'PAUSED') {
      Alert.alert('Finish your activity first', 'You have an activity in progress.');
      return true;
    }
    return false;
  };

  const signOut = () => {
    if (busyTracking()) return;
    const pending = (backup?.pending ?? 0) + (backup?.blocked.length ?? 0);
    Alert.alert(
      'Sign out?',
      pending > 0 ? `${pending} item(s) aren't backed up yet. They stay on this phone and upload when you sign in again.` : undefined,
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
    if (busyTracking()) return;
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

  const deleteData = () => {
    if (busyTracking()) return;
    Alert.alert(
      'Delete all activities?',
      local
        ? 'Every activity on this phone moves to Recently deleted. Export first if you want a copy.'
        : 'Every activity is deleted here and from your backup. Export first if you want a copy.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () =>
            Alert.alert('Are you sure?', 'This removes your whole history and statistics.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete everything',
                style: 'destructive',
                onPress: async () => {
                  const n = await deleteAllActivities();
                  requestSync();
                  Alert.alert(`${n} ${n === 1 ? 'activity' : 'activities'} deleted`);
                },
              },
            ]),
        },
      ],
    );
  };

  const local = !session || session.local;
  const account = session && !session.local ? session.user : null;
  const name = settings.profileName || account?.name || 'Your profile';
  const intervalUnit = settings.units === 'mi' ? 'mi' : 'km';
  const health = engine?.health;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + space.md,
          paddingHorizontal: space.lg,
          paddingBottom: insets.bottom + TAB_BAR_SPACE,
          gap: space.lg,
        }}
      >
        <AppBar />
        <Enter>
          <T v="title">Settings</T>
        </Enter>

        {/* A. Account */}
        <Section i={1} title="Account">
          <Tap accessibilityRole="button" onPress={() => router.push('/profile')} scaleTo={0.98} style={styles.profile}>
            <Avatar name={name} uri={settings.avatarUri} size={48} />
            <View style={{ flex: 1 }}>
              <T v="heading">{name}</T>
              <T v="small" muted>
                {account?.email || 'Profile, picture and records'}
              </T>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
          </Tap>
          {local ? (
            <Row icon="phone-portrait-outline" title="Stored on this device" detail="Sign-in and cloud backup turn on when the backend is connected" />
          ) : getAuthState() === 'signed-out' ? (
            <Row
              icon="log-in-outline"
              title="Sign in to back up"
              detail="Your activities are safe on this phone. They upload after you sign in."
              onPress={() => router.push('/welcome')}
            />
          ) : (
            <>
              <Row
                icon="key-outline"
                title={account?.hasPassword ? 'Change password' : 'Set a password'}
                detail="We'll email you a code to confirm"
                onPress={() => router.push({ pathname: '/forgot', params: { email: account?.email ?? '' } })}
              />
              <Row icon="log-out-outline" title="Sign out" onPress={signOut} />
              <Row icon="trash-outline" title="Delete account" onPress={deleteAccount} />
            </>
          )}
        </Section>

        {/* B. Units and calendar */}
        <Section i={2} title="Units and calendar">
          <Block>
            <Segmented
              options={[
                { value: 'km', label: 'Kilometres' },
                { value: 'mi', label: 'Miles' },
              ]}
              value={settings.units}
              onChange={(v) => setTracking('units', v)}
            />
            <Segmented
              options={[
                { value: '1', label: 'Monday first' },
                { value: '0', label: 'Sunday first' },
              ]}
              value={String(settings.weekStart) as '0' | '1'}
              onChange={(v) => saveSetting('weekStart', Number(v) as 0 | 1)}
            />
            <Segmented
              options={[
                { value: 'dmy', label: 'Day first' },
                { value: 'mdy', label: 'Month first' },
              ]}
              value={settings.dateFormat}
              onChange={(v) => saveSetting('dateFormat', v)}
            />
            <T v="small" muted style={{ paddingHorizontal: space.xs }}>
              Dates look like {formatDay(todayLocal(), true)}
            </T>
          </Block>
        </Section>

        {/* C. Tracking preferences */}
        <Section i={3} title="Tracking preferences">
          <Block>
            <T v="small" muted>
              Default activity
            </T>
            <Segmented
              options={[
                { value: 'walk', label: 'Walk' },
                { value: 'jog', label: 'Jog' },
                { value: 'run', label: 'Run' },
              ]}
              value={settings.defaultActivity}
              onChange={(v: ActivityType) => {
                saveSetting('defaultActivity', v);
                saveSetting('lastActivity', null);
              }}
            />
          </Block>
          <Row
            icon="pause-circle-outline"
            title="Auto-pause"
            detail="Pauses when you stop with a good GPS signal, and resumes when you move"
            right={<Switch label="Auto-pause" value={settings.autoPause} onChange={(v) => setTracking('autoPause', v)} />}
          />
          <Row
            icon="volume-high-outline"
            title="Voice announcements"
            detail="Distance and average pace, even with the screen locked"
            right={<Switch label="Voice announcements" value={settings.voiceCoach} onChange={(v) => setTracking('voiceCoach', v)} />}
          />
          <Block>
            <T v="small" muted>
              Announce and vibrate every
            </T>
            <Pills
              options={[
                { value: '0.5', label: `0.5 ${intervalUnit}` },
                { value: '1', label: `1 ${intervalUnit}` },
                { value: '2', label: `2 ${intervalUnit}` },
                { value: '5', label: `5 ${intervalUnit}` },
              ]}
              value={String(settings.voiceInterval) as '0.5' | '1' | '2' | '5'}
              onChange={(v) => setTracking('voiceInterval', Number(v))}
            />
          </Block>
          <Row
            icon="phone-portrait-outline"
            title="Haptic feedback"
            detail="Vibrate on start, pause, resume and each milestone"
            right={<Switch label="Haptic feedback" value={settings.haptics} onChange={(v) => setTracking('haptics', v)} />}
          />
          <Row
            icon="sunny-outline"
            title="Keep screen awake"
            detail="While the tracking screen is open. Uses more battery."
            right={<Switch label="Keep screen awake" value={settings.keepAwake} onChange={(v) => saveSetting('keepAwake', v)} />}
          />
          <Row
            icon="locate-outline"
            title="GPS accuracy"
            detail="Always the highest accuracy. Positions less precise than 25 m never count toward distance."
          />
          <Block>
            <T v="small" muted>
              Weekly distance target
            </T>
            <Pills
              options={[10, 20, 30, 50, 80].map((n) => ({ value: String(n), label: `${n} ${intervalUnit}` }))}
              value={String(settings.weeklyTargetKm)}
              onChange={(v) => saveSetting('weeklyTargetKm', Number(v))}
            />
          </Block>
        </Section>

        {/* D. Reliable tracking */}
        <Section i={4} title="Reliable tracking">
          <Row
            icon="battery-charging-outline"
            title="Battery optimization"
            detail={
              !health
                ? 'Checking…'
                : health.ignoringBatteryOptimizations
                  ? 'Unrestricted. Android reports the app is exempt.'
                  : 'Restricted. Tap to allow unrestricted use, so the phone does not stop a recording.'
            }
            onPress={health?.ignoringBatteryOptimizations ? undefined : () => TrackingEngine.requestIgnoreBatteryOptimizations().then(checkDevice)}
          />
          <Row
            icon="location-outline"
            title="Location permission"
            detail={perms == null ? 'Checking…' : perms.location ? 'Precise location allowed' : 'Not allowed. Tap to open app settings.'}
            onPress={perms && !perms.location ? () => TrackingEngine.openAppSettings() : undefined}
          />
          <Row
            icon="albums-outline"
            title="Background recording"
            detail="Recording runs as a foreground service with a notification, so 'Allow all the time' is not needed."
          />
          <Row
            icon="navigate-circle-outline"
            title="GPS availability"
            detail={!health ? 'Checking…' : health.gpsEnabled ? 'Location is turned on' : 'Location is turned off in quick settings'}
          />
          <Row
            icon="notifications-outline"
            title="Notifications"
            detail={perms == null ? 'Checking…' : perms.notifications ? 'Allowed' : 'Off. Tap to allow alerts about interrupted activities.'}
            onPress={perms && !perms.notifications ? () => TrackingEngine.openAppSettings() : undefined}
          />
          <Row
            icon="footsteps-outline"
            title="Step counting"
            detail={perms == null ? 'Checking…' : perms.activity ? 'Physical activity allowed' : 'Off. Steps are left empty.'}
            onPress={perms && !perms.activity ? () => TrackingEngine.openAppSettings() : undefined}
          />
          <Row icon="pulse-outline" title="Tracking diagnostics" detail="Every pause, gap and recovery" onPress={() => router.push('/diagnostics')} />
        </Section>

        {/* E. Data management */}
        <Section i={5} title="Data management">
          {local ? null : (
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
              detail={backup?.blocked.length ? `${backup.blocked.length} couldn't upload: ${backup.blocked[0].error}. Tap to retry.` : 'Tap to back up now'}
              onPress={() => (backup?.blocked.length ? retryBlocked() : requestSync(true))}
            />
          )}
          {!local ? (
            <Row
              icon="cloud-download-outline"
              title="Restore activities"
              detail="Download every route from your backup to this phone"
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
          <Row icon="map-outline" title="Export all as GPX" detail="Routes for other apps and maps" onPress={exportGpx} />
          <Row icon="document-text-outline" title="Export history as CSV" detail="For spreadsheets" onPress={exportCsv} />
          <Row icon="trash-outline" title="Delete activity data" detail="Remove every activity" onPress={deleteData} />
        </Section>

        {/* F. App preferences */}
        <Section i={6} title="App preferences">
          <Row
            icon="flag-outline"
            title="Goal notifications"
            right={<Switch label="Goal notifications" value={settings.notifyGoals} onChange={(v) => saveSetting('notifyGoals', v)} />}
          />
          <Row
            icon="trophy-outline"
            title="Records and milestones"
            right={<Switch label="Records and milestones" value={settings.notifyRecords} onChange={(v) => saveSetting('notifyRecords', v)} />}
          />
          <Row
            icon="calendar-outline"
            title="Weekly summary"
            right={<Switch label="Weekly summary" value={settings.notifyWeekly} onChange={(v) => saveSetting('notifyWeekly', v)} />}
          />
          <Row icon="shield-checkmark-outline" title="Privacy" onPress={() => router.push({ pathname: '/about', params: { section: 'privacy' } })} />
          <Row icon="document-outline" title="Terms and conditions" onPress={() => router.push({ pathname: '/about', params: { section: 'terms' } })} />
          <Row icon="information-circle-outline" title="About Cardigo" detail={`Version ${Constants.expoConfig?.version ?? '—'}`} onPress={() => router.push('/about')} />
        </Section>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 58, padding: space.sm },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.inactive,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconDanger: { backgroundColor: colors.ink },
  profile: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm, borderRadius: radius.md },
});
