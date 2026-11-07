import TrackingEngine, { EngineSnapshot, TrackPoint } from '@engine';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, PermissionsAndroid, Platform } from 'react-native';

/** The live screen is only a view of the engine: it rebuilds from the snapshot at any time. */
export function useEngineSnapshot() {
  const [snapshot, setSnapshot] = useState<EngineSnapshot | null>(null);
  const receivedAt = useRef(Date.now());

  const apply = useCallback((s: EngineSnapshot) => {
    receivedAt.current = Date.now();
    setSnapshot(s);
  }, []);

  const refresh = useCallback(() => TrackingEngine.getSnapshot().then(apply), [apply]);

  useEffect(() => {
    refresh();
    const state = TrackingEngine.addListener('onState', apply);
    const tick = TrackingEngine.addListener('onTick', apply);
    const app = AppState.addEventListener('change', (next) => {
      if (next === 'active') refresh();
    });
    return () => {
      state.remove();
      tick.remove();
      app.remove();
    };
  }, [apply, refresh]);

  return { snapshot, receivedAt, refresh };
}

/** Timer value between engine ticks. Calculated from engine data, never counted here. */
export function useActiveMs(snapshot: EngineSnapshot | null, receivedAt: { current: number }) {
  const [, force] = useState(0);
  const active = snapshot?.state === 'ACTIVE';
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [active]);
  if (!snapshot) return 0;
  return active ? snapshot.activeMs + (Date.now() - receivedAt.current) : snapshot.activeMs;
}

/** Route so far, rebuilt from disk on mount and on return, then extended by live points. */
export function useLiveTrack(sessionId: string | null) {
  const [points, setPoints] = useState<TrackPoint[]>([]);
  const lastSeq = useRef(-1);

  useEffect(() => {
    setPoints([]);
    lastSeq.current = -1;
    if (!sessionId) return undefined;

    const catchUp = async () => {
      let page: TrackPoint[];
      do {
        page = await TrackingEngine.getTrackPoints(sessionId, lastSeq.current, 2000);
        if (page.length) {
          lastSeq.current = page[page.length - 1].seq;
          setPoints((prev) => [...prev, ...page]);
        }
      } while (page.length === 2000);
    };
    catchUp();

    const sub = TrackingEngine.addListener('onPoint', (p) => {
      if (p.seq <= lastSeq.current) return;
      lastSeq.current = p.seq;
      setPoints((prev) => [...prev, p]);
    });
    const app = AppState.addEventListener('change', (next) => {
      if (next === 'active') catchUp();
    });
    return () => {
      sub.remove();
      app.remove();
    };
  }, [sessionId]);

  return points;
}

/**
 * Asked as soon as the app first opens, so nothing interrupts the first walk. Android doesn't allow
 * asking during installation, so this is the earliest possible moment.
 */
export async function requestAllPermissionsOnFirstLaunch() {
  if (Platform.OS !== 'android') return;
  const perms = await requestTrackingPermissions();
  if (!perms.location) return;
  await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
  await TrackingEngine.requestIgnoreBatteryOptimizations();
}

export interface PermissionResult {
  location: boolean;
  notifications: boolean;
  activity: boolean;
}

function explainPermissions(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'Before you start',
      'Location draws your route and measures distance. It is only used while you record.\n\n' +
        'Notifications tell you if an activity gets paused, and give you lock-screen controls.\n\n' +
        'Physical activity counts your steps.\n\nThe camera lets you take a photo for your activity image.\n\nOnly location is required to track.',
      [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Continue', onPress: () => resolve(true) },
      ],
      { cancelable: false },
    );
  });
}

/** Explained first, then asked one at a time, right when first needed. Only location is required. */
export async function requestTrackingPermissions(): Promise<PermissionResult> {
  if (Platform.OS !== 'android') return { location: true, notifications: true, activity: true };

  const P = PermissionsAndroid.PERMISSIONS;
  const GRANTED = PermissionsAndroid.RESULTS.GRANTED;
  const alreadyAllowed = await PermissionsAndroid.check(P.ACCESS_FINE_LOCATION);
  if (!alreadyAllowed && !(await explainPermissions())) {
    return { location: false, notifications: false, activity: false };
  }

  // Android 12+ ignores a request for fine location unless coarse is requested with it.
  const granted = await PermissionsAndroid.requestMultiple([P.ACCESS_FINE_LOCATION, P.ACCESS_COARSE_LOCATION]);
  const location = granted[P.ACCESS_FINE_LOCATION] === GRANTED;
  if (!location) return { location: false, notifications: false, activity: false };

  const notifications =
    Number(Platform.Version) < 33 || (await PermissionsAndroid.request(P.POST_NOTIFICATIONS)) === GRANTED;
  const activity = (await PermissionsAndroid.request(P.ACTIVITY_RECOGNITION)) === GRANTED;
  return { location, notifications, activity };
}
