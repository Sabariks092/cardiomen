import type { UserDto } from '@cardiomen/contracts';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { authed, friendlyError } from '@/auth/api';
import { currentSession, updateStoredUser } from '@/auth/session';
import { useLocalQuery } from '@/db';
import { allActivitiesLite } from '@/db/activities';
import { bestKilometre } from '@/db/cardigo';
import { saveSetting, useSettings } from '@/db/settings';
import { personalRecords, summarize } from '@/lib/analytics';
import { distanceValue, formatDay, formatDuration, formatPace, formatSteps } from '@/lib/format';
import { importPhoto } from '@/share/assets';
import {
  Avatar,
  Button,
  Card,
  colors,
  Divider,
  Enter,
  Field,
  MetricCard,
  RoundButton,
  Screen,
  SectionHeader,
  Sheet,
  space,
  T,
  Tap,
} from '@/ui';
import { AppBar } from '@/ui/appbar';

export default function Profile() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const settings = useSettings();
  const session = currentSession();
  const { data: list } = useLocalQuery(allActivitiesLite, []);
  const { data: bestKm } = useLocalQuery(bestKilometre, []);
  const [editing, setEditing] = useState(false);

  const account = session && !session.local ? session.user : null;
  const name = settings.profileName || account?.name || 'Your profile';
  const units = settings.units;

  const s = useMemo(() => summarize(list ?? []), [list]);
  const records = useMemo(() => personalRecords(list ?? [], bestKm ?? null), [list, bestKm]);
  const first = list && list.length ? list[list.length - 1] : null;

  const pickPhoto = async () => {
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.9 });
      if (picked.canceled) return;
      const a = picked.assets[0];
      // Copied into the app and re-encoded, which also strips the photo's location data.
      const uri = await importPhoto(a.uri, a.width, a.height);
      await saveSetting('avatarUri', uri);
    } catch (e) {
      Alert.alert('Could not set photo', e instanceof Error ? e.message : String(e));
    }
  };

  const dist = (m: number) => `${distanceValue(m, units).toFixed(2)} ${units}`;
  const recordRows: [string, string, string | undefined][] = [
    ['Longest distance', records.longestDistance ? dist(records.longestDistance.distanceM) : '—', records.longestDistance?.id],
    ['Longest duration', records.longestDuration ? formatDuration(records.longestDuration.activeMs) : '—', records.longestDuration?.id],
    ['Fastest pace (1 km or more)', records.fastestPace ? `${formatPace(records.fastestPace.pace, units)} /${units}` : '—', records.fastestPace?.activity.id],
    ['Fastest kilometre', records.bestKm ? formatDuration(records.bestKm.ms) : '—', records.bestKm?.activityId],
    ['Most steps', records.mostSteps ? formatSteps(records.mostSteps.steps) : '—', records.mostSteps?.id],
  ];

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + space.md, paddingHorizontal: space.lg, paddingBottom: insets.bottom + space.xl, gap: space.md }}>
        <AppBar />
        <Enter style={styles.header}>
          <RoundButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}>
            <Ionicons name="chevron-back" size={20} color={colors.ink} />
          </RoundButton>
          <T v="title" style={{ flex: 1 }}>
            Profile
          </T>
          <RoundButton label="Edit profile" onPress={() => setEditing(true)}>
            <Ionicons name="create-outline" size={19} color={colors.ink} />
          </RoundButton>
        </Enter>

        <Enter i={1}>
          <Card style={styles.identity}>
            <Tap accessibilityRole="button" accessibilityLabel="Change profile picture" onPress={pickPhoto} scaleTo={0.94}>
              <Avatar name={name} uri={settings.avatarUri} size={88} />
              <View style={styles.camera}>
                <Ionicons name="camera" size={14} color={colors.paper} />
              </View>
            </Tap>
            <T v="heading" style={{ fontSize: 20 }}>
              {name}
            </T>
            {account?.email ? (
              <T v="small" muted>
                {account.email}
              </T>
            ) : (
              <T v="small" muted>
                Stored on this phone
              </T>
            )}
            <T v="small" muted>
              {first ? `Tracking since ${formatDay(first.localDate, true)}` : 'No activities yet'}
            </T>
          </Card>
        </Enter>

        <Enter i={2} style={styles.grid}>
          <MetricCard icon="navigate-outline" label="Total distance" value={distanceValue(s.distanceM, units).toFixed(1)} unit={units} />
          <MetricCard icon="repeat-outline" label="Activities" value={String(s.sessions)} />
        </Enter>
        <Enter i={3} style={styles.grid}>
          <MetricCard icon="calendar-outline" label="Active days" value={String(s.activeDays)} />
          <MetricCard icon="trophy-outline" label="Longest activity" value={distanceValue(s.longestM, units).toFixed(2)} unit={units} />
        </Enter>

        <Enter i={4}>
          <SectionHeader title="Personal records" />
        </Enter>
        <Enter i={5}>
          <Card style={{ gap: space.sm }}>
            {recordRows.map(([label, value, id], i) => (
              <View key={label}>
                {i > 0 ? <Divider style={{ marginBottom: space.sm }} /> : null}
                <Tap
                  accessibilityRole="button"
                  disabled={!id}
                  onPress={() => id && router.push({ pathname: '/activity/[id]', params: { id } })}
                  style={styles.record}
                >
                  <T v="small" muted style={{ flex: 1 }}>
                    {label}
                  </T>
                  <T v="small" style={{ fontWeight: '600' }}>
                    {value}
                  </T>
                  {id ? <Ionicons name="chevron-forward" size={14} color={colors.textFaint} /> : null}
                </Tap>
              </View>
            ))}
          </Card>
        </Enter>
      </ScrollView>

      <EditProfileSheet
        visible={editing}
        initialName={settings.profileName || account?.name || ''}
        account={account}
        hasPhoto={!!settings.avatarUri}
        onPickPhoto={pickPhoto}
        onClose={() => setEditing(false)}
      />
    </Screen>
  );
}

function EditProfileSheet({
  visible,
  initialName,
  account,
  hasPhoto,
  onPickPhoto,
  onClose,
}: {
  visible: boolean;
  initialName: string;
  account: UserDto | null;
  hasPhoto: boolean;
  onPickPhoto: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (visible) {
      setName(initialName);
      setError(null);
    }
  }, [visible, initialName]);

  const save = async () => {
    const trimmed = name.trim();
    setBusy(true);
    setError(null);
    try {
      // With an account, the name is saved to it, so it follows you to other phones.
      if (account && trimmed) {
        const res = await authed<{ user: UserDto }>('/me', { method: 'PATCH', body: JSON.stringify({ name: trimmed }) });
        await updateStoredUser(res.user);
      }
      await saveSetting('profileName', trimmed || null);
      onClose();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Edit profile">
      <Field label="Name" value={name} onChangeText={setName} maxLength={80} placeholder="Your name" />
      {error ? <T v="small">{error}</T> : null}
      <Button title="Save" loading={busy} onPress={save} />
      <Button title={hasPhoto ? 'Change photo' : 'Add a photo'} kind="glass" onPress={onPickPhoto} />
      {hasPhoto ? <Button title="Remove photo" kind="ghost" onPress={() => saveSetting('avatarUri', null)} /> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  identity: { alignItems: 'center', gap: 4, paddingVertical: space.xl },
  camera: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.ink,
    borderWidth: 2,
    borderColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: { flexDirection: 'row', gap: space.md },
  record: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 30 },
});
