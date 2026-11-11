import TrackingEngine, { ActivityType, EngineSnapshot, PauseReason } from '@engine';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, BackHandler, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn, ZoomOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { currentSession } from '@/auth/session';
import { hasDb, useLocalQuery } from '@/db';
import { getActivity } from '@/db/activities';
import { loadSettings, saveSetting, useSettings } from '@/db/settings';
import { averagePace, formatDistance, formatDuration, formatPace, formatSpeed, formatSteps, speedUnit, TYPE_LABEL, Units } from '@/lib/format';
import { LngLat, toSegments } from '@/lib/track';
import { requestSync } from '@/sync/worker';
import { applyCoachSettings } from '@/tracking/coach';
import { importFinished } from '@/tracking/importer';
import { requestTrackingPermissions, useActiveMs, useEngineSnapshot, useLiveTrack } from '@/tracking/useEngine';
import { ActivityBadge, Button, Card, colors, InkGloss, Pulse, radius, RoundButton, shadow, space, T, Tap } from '@/ui';
import { LiveMap } from '@/ui/maps';
import { resetTo } from '@/ui/nav';

const PAUSE_MESSAGE: Record<PauseReason, string> = {
  user: 'Paused',
  auto: 'Auto-paused. It resumes when you move.',
  device_shutdown: 'Paused because your phone switched off',
  process_killed: 'Paused because the system stopped the app',
  app_updated: 'Paused because the app was updated',
  permission_revoked: 'Paused because location permission was removed',
  unknown: 'Paused by an interruption',
};

// The newest screen owns the armed session, even if an older one is still animating away.
let armGeneration = 0;

const GPS_LABEL = { off: 'GPS off', searching: 'Finding GPS', weak: 'Weak GPS', good: 'GPS good' } as const;

export default function TrackScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { type, guide } = useLocalSearchParams<{ type?: ActivityType; guide?: string }>();
  const settings = useSettings();
  const { units } = settings;
  const { snapshot, receivedAt } = useEngineSnapshot();
  const [countdown, setCountdown] = useState<number | null>(null);
  const [follow, setFollow] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [notificationsOk, setNotificationsOk] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [armAttempt, setArmAttempt] = useState(0);
  const stateRef = useRef(snapshot?.state);
  stateRef.current = snapshot?.state;

  const points = useLiveTrack(snapshot?.state === 'ACTIVE' || snapshot?.state === 'PAUSED' ? snapshot.sessionId : null);
  const lines = useMemo(() => toSegments(points), [points]);
  const position: LngLat | null =
    snapshot?.lng != null && snapshot?.lat != null ? [snapshot.lng, snapshot.lat] : null;
  const { data: guideActivity } = useLocalQuery(
    () => (guide && hasDb() ? getActivity(guide) : Promise.resolve(null)),
    [guide],
  );

  const state = snapshot?.state;
  const recording = state === 'ACTIVE' || state === 'PAUSED';

  const feel = (style: Haptics.ImpactFeedbackStyle) => {
    if (settings.haptics) Haptics.impactAsync(style).catch(() => undefined);
  };

  // Opening this screen warms up GPS. The service must start here, while the app is visible.
  useEffect(() => {
    let cancelled = false;
    const generation = ++armGeneration;
    (async () => {
      setProblem(null);
      const current = await TrackingEngine.getSnapshot();
      if (!type) return;
      if (current.state === 'ARMED' && current.type !== type) await TrackingEngine.cancelArm();
      else if (current.state !== 'IDLE') return;
      const perms = await requestTrackingPermissions();
      if (cancelled) return;
      setNotificationsOk(perms.notifications);
      if (!perms.location) {
        setProblem('Location permission is needed to track your route. Nothing is recorded without it.');
        return;
      }
      if (!perms.notifications && hasDb()) {
        const { notificationsWarned } = await loadSettings();
        if (!notificationsWarned) {
          saveSetting('notificationsWarned', true);
          Alert.alert(
            'Notifications are off',
            "Tracking still works, but if your phone interrupts an activity you won't get an alert. It will be paused and waiting when you open the app.",
          );
        }
      }
      try {
        await applyCoachSettings().catch(() => undefined);
        await TrackingEngine.arm(type, currentSession()?.user.id ?? '');
      } catch (e) {
        setProblem(`Could not start tracking. ${e instanceof Error ? e.message : ''}`);
      }
    })();
    return () => {
      cancelled = true;
      // Leaving before Start cancels. A real recording is never cancelled by leaving the screen.
      if (generation !== armGeneration) return;
      TrackingEngine.getSnapshot().then((s) => {
        if (s.state === 'ARMED' && generation === armGeneration) TrackingEngine.cancelArm();
      });
    };
  }, [type, armAttempt]);

  // Coming back from Settings after allowing location picks up where it left off.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        setProblem(null);
        if (stateRef.current === 'IDLE' && type) setArmAttempt((n) => n + 1);
      }
    });
    return () => sub.remove();
  }, [type]);

  // Back leaves the screen while recording continues; only Finish can end it.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      leave();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the screen on while recording, if chosen in Settings.
  useEffect(() => {
    if (!settings.keepAwake || !recording) return undefined;
    activateKeepAwakeAsync('cardigo-tracking').catch(() => undefined);
    return () => {
      deactivateKeepAwake('cardigo-tracking').catch(() => undefined);
    };
  }, [settings.keepAwake, recording]);

  const leave = () => {
    if (router.canGoBack()) router.back();
    else resetTo(router, hasDb() ? '/(tabs)' : '/welcome');
  };

  useEffect(() => {
    if (countdown === null) return undefined;
    if (countdown === 0) {
      setCountdown(null);
      if (settings.haptics) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      TrackingEngine.begin().catch((e) => setProblem(String(e?.message ?? e)));
      return undefined;
    }
    feel(Haptics.ImpactFeedbackStyle.Medium);
    const id = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  const save = async () => {
    setBusy(true);
    try {
      const id = snapshot?.sessionId;
      await TrackingEngine.stop();
      if (hasDb() && id) {
        await importFinished();
        requestSync();
        resetTo(router, { pathname: '/activity/[id]', params: { id, fresh: '1' } });
      } else {
        // Signed out: the recording is safe in the engine and imports right after sign-in.
        resetTo(router, '/welcome');
      }
    } catch (e) {
      Alert.alert('Saved, but not imported yet', 'Your activity is safe and will appear shortly.');
      resetTo(router, '/(tabs)');
      console.warn(e);
    } finally {
      setBusy(false);
    }
  };

  const finish = () => {
    const tiny = (snapshot?.distanceM ?? 0) < 50 && (snapshot?.activeMs ?? 0) < 60_000;
    Alert.alert(
      tiny ? 'Very short activity' : `Finish your ${title.toLowerCase()}?`,
      tiny
        ? 'Less than a minute and 50 m were recorded. Save it anyway?'
        : `${formatDistance(snapshot?.distanceM ?? 0, units)} ${units} in ${formatDuration(snapshot?.activeMs ?? 0)} will be saved.`,
      [
        { text: 'Keep going', style: 'cancel' },
        ...(tiny ? [{ text: 'Discard', style: 'destructive' as const, onPress: () => discard(true) }] : []),
        { text: 'Finish and save', onPress: save },
      ],
    );
  };

  const discard = (confirmed = false) => {
    const go = async () => {
      // The engine only discards a paused recording, so a running one is paused first.
      if (stateRef.current === 'ACTIVE') await TrackingEngine.pause();
      await TrackingEngine.discard();
      resetTo(router, hasDb() ? '/(tabs)' : '/welcome');
    };
    if (confirmed) {
      go();
      return;
    }
    Alert.alert('Discard this activity?', 'The recording will be permanently deleted.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: go },
    ]);
  };

  const title = snapshot?.type ? TYPE_LABEL[snapshot.type] : type ? TYPE_LABEL[type] : 'Activity';
  const gps = snapshot?.gps ?? 'searching';
  const accuracy = snapshot?.accuracyM;

  return (
    <View style={styles.root}>
      <LiveMap
        lines={lines}
        position={position}
        follow={follow}
        guide={guideActivity?.previewRoute}
        onUserGesture={() => setFollow(false)}
      />

      <View style={[styles.topBar, { top: insets.top + space.sm }]}>
        <RoundButton label="Back" onPress={leave}>
          <Ionicons name="chevron-back" size={22} color={colors.ink} />
        </RoundButton>
        <Card overMap style={styles.gpsPill}>
          {gps === 'good' ? <Pulse size={8} /> : <View style={[styles.gpsDot, { opacity: gps === 'off' ? 0.2 : 0.4 }]} />}
          <T v="small" style={{ fontWeight: '500' }}>
            {GPS_LABEL[gps]}
            {accuracy != null && gps !== 'off' ? ` · ±${Math.round(accuracy)} m` : ''}
          </T>
        </Card>
        {!follow ? (
          <RoundButton label="Center on my position" onPress={() => setFollow(true)}>
            <Ionicons name="locate" size={20} color={colors.ink} />
          </RoundButton>
        ) : (
          <View style={{ width: 44 }} />
        )}
      </View>

      <View style={[styles.panelWrap, { paddingBottom: insets.bottom + space.md }]}>
        {problem ? (
          // Shown above the controls, never instead of them: Resume and Finish must always be reachable.
          <Card overMap style={{ gap: space.md }}>
            <T>{problem}</T>
            <Button title="Open app settings" kind="glass" onPress={() => TrackingEngine.openAppSettings()} />
          </Card>
        ) : null}

        {recording && snapshot ? (
          <Animated.View entering={FadeIn.duration(300)}>
            <Card overMap style={styles.livePanel}>
              {state === 'PAUSED' ? (
                <T v="small" muted center>
                  {snapshot.pauseReason ? PAUSE_MESSAGE[snapshot.pauseReason] : 'Paused'}
                </T>
              ) : null}
              <LiveTimer snapshot={snapshot} receivedAt={receivedAt} />
              <LiveStats snapshot={snapshot} units={units} />
              {state === 'ACTIVE' ? (
                <View style={styles.controls}>
                  <ControlButton
                    icon="pause"
                    label="Pause"
                    primary
                    onPress={() => {
                      feel(Haptics.ImpactFeedbackStyle.Heavy);
                      TrackingEngine.pause();
                    }}
                  />
                  <ControlButton icon="stop" label="Finish" onPress={finish} disabled={busy} />
                </View>
              ) : (
                <View style={styles.controls}>
                  <ControlButton
                    icon="play"
                    label="Resume"
                    primary
                    onPress={() => {
                      setProblem(null);
                      feel(Haptics.ImpactFeedbackStyle.Heavy);
                      TrackingEngine.resume().catch((e) => setProblem(`Could not resume. ${e?.message ?? e}`));
                    }}
                  />
                  <ControlButton icon="stop" label="Finish" onPress={finish} disabled={busy} />
                </View>
              )}
              <Pressable accessibilityRole="button" onPress={() => discard()} style={styles.discard}>
                <T v="small" muted>
                  Discard
                </T>
              </Pressable>
            </Card>
          </Animated.View>
        ) : (
          <Prepare
            type={type ?? snapshot?.type ?? 'walk'}
            snapshot={snapshot}
            notificationsOk={notificationsOk}
            disabled={(state !== 'ARMED' && !type) || countdown !== null || !snapshot?.health.locationPermission}
            onCancel={leave}
            onStart={async () => {
              setProblem(null);
              // Getting ready times out after 15 minutes on this screen. Start simply gets ready again.
              if (state === 'IDLE') {
                try {
                  await TrackingEngine.arm(type as ActivityType, currentSession()?.user.id ?? '');
                } catch (e) {
                  setProblem(`Could not start tracking. ${e instanceof Error ? e.message : ''}`);
                  return;
                }
              }
              setCountdown(3);
            }}
          />
        )}
      </View>

      {countdown !== null && countdown > 0 ? (
        <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(250)} style={styles.countdown}>
          <Pressable accessibilityLabel="Cancel countdown" style={styles.countdownHit} onPress={() => setCountdown(null)}>
            <Animated.View key={countdown} entering={ZoomIn.springify().damping(12)} exiting={ZoomOut.duration(180)}>
              <T style={styles.countdownText}>{countdown}</T>
            </Animated.View>
            <T v="small" muted>
              Tap to cancel
            </T>
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );
}

/** The only part that updates several times a second, so nothing else re-renders with it. */
const LiveTimer = memo(function LiveTimer({
  snapshot,
  receivedAt,
}: {
  snapshot: EngineSnapshot;
  receivedAt: { current: number };
}) {
  const activeMs = useActiveMs(snapshot, receivedAt);
  return (
    <T v="hero" center style={{ fontSize: 58 }}>
      {formatDuration(activeMs)}
    </T>
  );
});

function LiveStats({ snapshot, units }: { snapshot: EngineSnapshot; units: Units }) {
  const current = snapshot.state === 'ACTIVE' ? snapshot.currentPaceSecPerKm : null;
  const avg = averagePace(snapshot.activeMs, snapshot.distanceM);
  const speed = current ? 1000 / current : null;
  const cells: [string, string][] = [
    [formatDistance(snapshot.distanceM, units), units],
    [formatPace(current, units), `Pace /${units}`],
    [formatPace(avg, units), `Avg pace /${units}`],
    [formatSpeed(speed, units), speedUnit(units)],
    [formatSteps(snapshot.steps), 'Steps'],
    [snapshot.accuracyM != null ? `±${Math.round(snapshot.accuracyM)}` : '--', 'GPS m'],
  ];
  return (
    <View style={styles.statGrid}>
      {cells.map(([value, label], i) => (
        <View key={label} style={[styles.statCell, i === 0 && styles.statCellWide]}>
          <T v={i === 0 ? 'metric' : 'stat'} numberOfLines={1} style={{ fontWeight: '300' }}>
            {value}
          </T>
          <T v="label" muted numberOfLines={1}>
            {label}
          </T>
        </View>
      ))}
    </View>
  );
}

function ControlButton({
  icon,
  label,
  onPress,
  primary,
  disabled,
}: {
  icon: 'pause' | 'play' | 'stop';
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Tap
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      scaleTo={0.94}
      onPress={onPress}
      style={[styles.control, primary ? styles.controlPrimary : styles.controlSecondary, disabled && { opacity: 0.5 }]}
    >
      {primary ? <InkGloss r={radius.pill} /> : null}
      <Ionicons name={icon} size={22} color={primary ? colors.paper : colors.ink} />
      <T v="heading" style={{ color: primary ? colors.paper : colors.ink }}>
        {label}
      </T>
    </Tap>
  );
}

/** GPS preparation: what's ready, what isn't, and Start. */
function Prepare({
  type,
  snapshot,
  notificationsOk,
  disabled,
  onStart,
  onCancel,
}: {
  type: ActivityType;
  snapshot: EngineSnapshot | null;
  notificationsOk: boolean | null;
  disabled: boolean;
  onStart: () => void;
  onCancel: () => void;
}) {
  const h = snapshot?.health;
  const gps = snapshot?.gps ?? 'searching';
  const checks: { ok: boolean | null; label: string; detail: string; fix?: () => void }[] = [
    {
      ok: h ? h.locationPermission : null,
      label: 'Location permission',
      detail: h?.locationPermission ? 'Allowed while you record' : 'Needed to measure your route',
      fix: h && !h.locationPermission ? () => TrackingEngine.openAppSettings() : undefined,
    },
    {
      ok: h ? h.gpsEnabled : null,
      label: 'Location turned on',
      detail: h?.gpsEnabled ? 'On' : 'Turn on Location in quick settings',
    },
    {
      ok: gps === 'good' ? true : gps === 'off' ? false : null,
      label: 'GPS signal',
      detail:
        gps === 'good'
          ? `Good, within ${Math.round(snapshot?.accuracyM ?? 0)} m`
          : gps === 'weak'
            ? `Weak, within ${Math.round(snapshot?.accuracyM ?? 0)} m. Open sky helps.`
            : gps === 'off'
              ? 'Off'
              : 'Searching. Stay outdoors for a moment.',
    },
    {
      ok: h ? h.ignoringBatteryOptimizations : null,
      label: 'Recording with the screen off',
      detail: h?.ignoringBatteryOptimizations
        ? 'Battery unrestricted, so the phone keeps recording'
        : 'Battery is restricted. Some phones may stop recording.',
      fix: h && !h.ignoringBatteryOptimizations ? () => TrackingEngine.requestIgnoreBatteryOptimizations() : undefined,
    },
    ...(notificationsOk === false
      ? [{ ok: false, label: 'Notifications', detail: "Off. You won't be told if an activity is interrupted." }]
      : []),
  ];
  const ready = gps === 'good';
  return (
    <Animated.View entering={FadeIn.duration(300)}>
      <Card overMap style={{ gap: space.md }}>
        <View style={styles.prepHeader}>
          <ActivityBadge type={type} size={44} inverted />
          <View style={{ flex: 1 }}>
            <T v="heading">{TYPE_LABEL[type]}</T>
            <T v="small" muted>
              {ready ? 'Ready when you are' : 'Getting ready'}
            </T>
          </View>
        </View>
        <View style={{ gap: space.sm }}>
          {checks.map((c) => (
            <Pressable
              key={c.label}
              disabled={!c.fix}
              accessibilityRole={c.fix ? 'button' : 'text'}
              onPress={c.fix}
              style={styles.check}
            >
              <View style={[styles.checkIcon, c.ok === true && styles.checkIconOk]}>
                <Ionicons
                  name={c.ok === true ? 'checkmark' : c.ok === false ? 'alert' : 'ellipsis-horizontal'}
                  size={14}
                  color={c.ok === true ? colors.paper : colors.ink}
                />
              </View>
              <View style={{ flex: 1 }}>
                <T v="small" style={{ fontWeight: '600' }}>
                  {c.label}
                </T>
                <T v="small" muted>
                  {c.detail}
                </T>
              </View>
              {c.fix ? <Ionicons name="chevron-forward" size={16} color={colors.textMuted} /> : null}
            </Pressable>
          ))}
        </View>
        <View style={styles.controls}>
          <Button title="Cancel" kind="glass" onPress={onCancel} style={{ flex: 1 }} />
          <Tap
            accessibilityRole="button"
            accessibilityLabel={ready ? 'Start' : 'Start anyway'}
            disabled={disabled}
            haptic
            scaleTo={0.95}
            onPress={onStart}
            style={[styles.start, disabled && { opacity: 0.45 }]}
          >
            <InkGloss r={radius.pill} />
            <Ionicons name="play" size={18} color={colors.paper} />
            <T v="heading" style={{ color: colors.paper }}>
              {ready ? 'Start' : 'Start anyway'}
            </T>
          </Tap>
        </View>
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  gpsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
  },
  gpsDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.ink },
  panelWrap: { position: 'absolute', left: space.md, right: space.md, bottom: 0, gap: space.md },
  livePanel: { gap: space.md, borderRadius: radius.xl },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.md },
  statCell: { width: '33.33%', alignItems: 'center', gap: 2 },
  statCellWide: { width: '100%' },
  controls: { flexDirection: 'row', gap: space.md },
  control: {
    flex: 1,
    minHeight: 60,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  controlPrimary: { boxShadow: shadow.button },
  controlSecondary: { backgroundColor: colors.card, boxShadow: shadow.card },
  discard: { alignItems: 'center', minHeight: 36, justifyContent: 'center' },
  prepHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  check: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 40 },
  checkIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.inactive,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkIconOk: { backgroundColor: colors.ink },
  start: {
    flex: 1.4,
    minHeight: 52,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    boxShadow: shadow.button,
  },
  countdown: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(244,244,244,0.96)' },
  countdownHit: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg },
  countdownText: { color: colors.ink, fontSize: 160, lineHeight: 190, fontWeight: '200', letterSpacing: -4 },
});
