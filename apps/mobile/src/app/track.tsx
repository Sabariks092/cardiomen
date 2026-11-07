import TrackingEngine, { ActivityType, PauseReason } from '@engine';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, AppState, BackHandler, Easing, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { currentSession } from '@/auth/session';
import { hasDb } from '@/db';
import { loadSettings, saveSetting, useSettings } from '@/db/settings';
import { formatDistance, formatDuration, formatPace, formatSteps, TYPE_LABEL } from '@/lib/format';
import { LngLat, toSegments } from '@/lib/track';
import { requestSync } from '@/sync/worker';
import { importFinished } from '@/tracking/importer';
import { requestTrackingPermissions, useActiveMs, useEngineSnapshot, useLiveTrack } from '@/tracking/useEngine';
import { Button, colors, Glass, radius, space, Stat, T } from '@/ui';
import { LiveMap } from '@/ui/maps';
import { resetTo } from '@/ui/nav';

const PAUSE_MESSAGE: Record<PauseReason, string> = {
  user: 'Paused',
  device_shutdown: 'Paused because your phone switched off',
  process_killed: 'Paused because the system stopped the app',
  app_updated: 'Paused because the app was updated',
  permission_revoked: 'Paused because location permission was removed',
  unknown: 'Paused by an interruption',
};

// The newest screen owns the armed session, even if an older one is still animating away.
let armGeneration = 0;

const GPS_LABEL = { off: 'GPS off', searching: 'Acquiring GPS', weak: 'Weak GPS', good: 'GPS ready' } as const;

export default function TrackScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { type } = useLocalSearchParams<{ type?: ActivityType }>();
  const { units } = useSettings();
  const { snapshot, receivedAt } = useEngineSnapshot();
  const [countdown, setCountdown] = useState<number | null>(null);
  const [follow, setFollow] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [armAttempt, setArmAttempt] = useState(0);
  const stateRef = useRef(snapshot?.state);
  stateRef.current = snapshot?.state;

  const activeMs = useActiveMs(snapshot, receivedAt);
  const points = useLiveTrack(snapshot?.state === 'ACTIVE' || snapshot?.state === 'PAUSED' ? snapshot.sessionId : null);
  const lines = useMemo(() => toSegments(points), [points]);
  const position: LngLat | null =
    snapshot?.lng != null && snapshot?.lat != null ? [snapshot.lng, snapshot.lat] : null;

  const state = snapshot?.state;
  const recording = state === 'ACTIVE' || state === 'PAUSED';

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
      if (!perms.location) {
        setProblem('Location permission is needed to track your route.');
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

  // Back leaves the screen while recording continues; only the Stop button can end it.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      leave();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const leave = () => {
    if (router.canGoBack()) router.back();
    else resetTo(router, hasDb() ? '/(tabs)' : '/welcome');
  };

  useEffect(() => {
    if (countdown === null) return undefined;
    if (countdown === 0) {
      setCountdown(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      TrackingEngine.begin().catch((e) => setProblem(String(e?.message ?? e)));
      return undefined;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    const id = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(id);
  }, [countdown]);

  const finish = async () => {
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

  const discard = () => {
    Alert.alert('Discard this activity?', 'The recording will be permanently deleted.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: async () => {
          await TrackingEngine.discard();
          resetTo(router, hasDb() ? '/(tabs)' : '/welcome');
        },
      },
    ]);
  };

  const title = snapshot?.type ? TYPE_LABEL[snapshot.type] : type ? TYPE_LABEL[type] : 'Activity';

  return (
    <View style={styles.root}>
      <LiveMap lines={lines} position={position} follow={follow} onUserGesture={() => setFollow(false)} />

      <View style={[styles.topBar, { top: insets.top + space.sm }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={leave} style={styles.roundButton}>
          <Ionicons name="chevron-back" size={22} color={colors.white} />
        </Pressable>
        <Glass overMap style={styles.gpsPill}>
          <View style={[styles.gpsDot, snapshot?.gps !== 'good' && { opacity: 0.35 }]} />
          <T v="small">
            {title} · {snapshot ? GPS_LABEL[snapshot.gps] : '…'}
          </T>
        </Glass>
        {!follow ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Center on my position"
            onPress={() => setFollow(true)}
            style={styles.roundButton}
          >
            <Ionicons name="locate" size={20} color={colors.white} />
          </Pressable>
        ) : (
          <View style={{ width: 44 }} />
        )}
      </View>

      <View style={[styles.panelWrap, { paddingBottom: insets.bottom + space.lg, gap: space.md }]}>
        {problem ? (
          // Shown above the controls, never instead of them: Resume and Stop must always be reachable.
          <Glass overMap style={{ gap: space.md }}>
            <T>{problem}</T>
            <Button title="Open settings" kind="glass" onPress={() => TrackingEngine.openAppSettings()} />
          </Glass>
        ) : null}
        {recording ? (
          <Glass overMap style={{ gap: space.lg }}>
            {state === 'PAUSED' ? (
              <T v="small" muted center>
                {snapshot?.pauseReason ? PAUSE_MESSAGE[snapshot.pauseReason] : 'Paused'}
              </T>
            ) : null}
            <T v="hero" center>
              {formatDuration(activeMs)}
            </T>
            <View style={styles.stats}>
              <Stat label={units} value={formatDistance(snapshot?.distanceM ?? 0, units)} />
              <Stat label="Steps" value={formatSteps(snapshot?.steps)} />
              <Stat label={`Pace /${units}`} value={formatPace(snapshot?.currentPaceSecPerKm, units)} />
            </View>
            {state === 'ACTIVE' ? (
              <Button
                title="Pause"
                onPress={() => TrackingEngine.pause()}
                icon={<Ionicons name="pause" size={18} color={colors.black} />}
              />
            ) : (
              <View style={{ gap: space.sm }}>
                <Button
                  title="Resume"
                  onPress={() => {
                    setProblem(null);
                    TrackingEngine.resume().catch((e) => setProblem(`Could not resume. ${e?.message ?? e}`));
                  }}
                  icon={<Ionicons name="play" size={18} color={colors.black} />}
                />
                <HoldToStop onComplete={finish} disabled={busy} />
                <Pressable accessibilityRole="button" onPress={discard} style={styles.discard}>
                  <T v="small" muted>
                    Discard
                  </T>
                </Pressable>
              </View>
            )}
            {state === 'ACTIVE' ? <HoldToStop onComplete={finish} disabled={busy} /> : null}
          </Glass>
        ) : (
          <View style={{ gap: space.md, alignItems: 'center' }}>
            {snapshot?.health.lowStorage ? (
              <T v="small" center>
                Your phone is low on storage. Free up some space before a long activity.
              </T>
            ) : null}
            {snapshot && !snapshot.health.ignoringBatteryOptimizations ? (
              <Pressable
                accessibilityRole="button"
                style={{ alignSelf: 'stretch' }}
                onPress={() => TrackingEngine.requestIgnoreBatteryOptimizations()}
              >
                <Glass overMap style={styles.batteryHint}>
                  <Ionicons name="battery-charging-outline" size={18} color={colors.white} />
                  <T v="small" style={{ flex: 1 }}>
                    Allow unrestricted battery so the phone can't stop your recording.
                  </T>
                </Glass>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Start"
              disabled={(state !== 'ARMED' && !type) || countdown !== null}
              onPress={async () => {
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
              style={[styles.start, !snapshot && { opacity: 0.5 }]}
            >
              <T v="heading" style={styles.startText}>
                START
              </T>
            </Pressable>
          </View>
        )}
      </View>

      {countdown !== null && countdown > 0 ? (
        <Pressable
          accessibilityLabel="Cancel countdown"
          style={styles.countdown}
          onPress={() => setCountdown(null)}
        >
          <T style={styles.countdownText}>{countdown}</T>
          <T v="small" muted>
            Tap to cancel
          </T>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Stop needs a 1.5 second hold, so a pocket tap can never end an activity. */
function HoldToStop({ onComplete, disabled }: { onComplete: () => void; disabled?: boolean }) {
  const progress = useRef(new Animated.Value(0)).current;
  const [width, setWidth] = useState(0);

  const begin = () => {
    Animated.timing(progress, {
      toValue: 1,
      duration: 1500,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
        onComplete();
        progress.setValue(0);
      }
    });
  };
  const cancel = () => {
    progress.stopAnimation();
    Animated.timing(progress, { toValue: 0, duration: 150, useNativeDriver: false }).start();
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Hold to stop"
      disabled={disabled}
      onPressIn={begin}
      onPressOut={cancel}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={styles.hold}
    >
      <Animated.View
        style={[
          styles.holdFill,
          { width: progress.interpolate({ inputRange: [0, 1], outputRange: [0, width] }) },
        ]}
      />
      <Ionicons name="stop" size={16} color={colors.white} />
      <T style={{ fontWeight: '600' }}>Hold to stop</T>
    </Pressable>
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
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.glassOverMap,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gpsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
  },
  gpsDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.white },
  panelWrap: { position: 'absolute', left: space.md, right: space.md, bottom: 0 },
  stats: { flexDirection: 'row', gap: space.sm },
  discard: { alignItems: 'center', minHeight: 40, justifyContent: 'center' },
  start: {
    width: 116,
    height: 116,
    borderRadius: 58,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 10,
  },
  startText: { color: colors.black, fontWeight: '700', letterSpacing: 2 },
  batteryHint: { flexDirection: 'row', gap: space.md, alignItems: 'center', padding: space.md, alignSelf: 'stretch' },
  countdown: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.86)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
  },
  countdownText: { color: colors.white, fontSize: 150, fontWeight: '100', lineHeight: 170 },
  hold: {
    minHeight: 52,
    borderRadius: radius.pill,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: colors.fieldBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  holdFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.35)' },
});
