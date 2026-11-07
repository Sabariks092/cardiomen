import { NativeModule, requireNativeModule } from 'expo';

export type ActivityType = 'walk' | 'jog' | 'run';
export type EngineState = 'IDLE' | 'ARMED' | 'ACTIVE' | 'PAUSED';
export type PauseReason =
  | 'user'
  | 'device_shutdown'
  | 'process_killed'
  | 'app_updated'
  | 'permission_revoked'
  | 'unknown';

export interface EngineSnapshot {
  sessionId: string | null;
  type: ActivityType | null;
  state: EngineState;
  pauseReason: PauseReason | null;
  activeMs: number;
  startedAt: number | null;
  lastWallMs: number | null;
  distanceM: number;
  steps: number | null;
  currentPaceSecPerKm: number | null;
  gps: 'off' | 'searching' | 'weak' | 'good';
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  health: {
    locationPermission: boolean;
    gpsEnabled: boolean;
    ignoringBatteryOptimizations: boolean;
    lowStorage: boolean;
  };
}

export interface TrackPoint {
  seq: number;
  segment: number;
  t: number;
  lat: number;
  lng: number;
  acc: number | null;
  alt?: number | null;
  ok: boolean;
}

export interface FinishedSession {
  id: string;
  ownerId: string;
  type: ActivityType;
  startedAt: number;
  endedAt: number;
  tzOffsetMin: number;
  activeMs: number;
  distanceM: number;
  steps: number | null;
  engineVersion: number;
  pointCount: number;
}

export interface EngineEvent {
  sessionId: string;
  tWall: number;
  kind: string;
  detail: string | null;
}

export type Events = {
  onState(snapshot: EngineSnapshot): void;
  onTick(snapshot: EngineSnapshot): void;
  onPoint(point: TrackPoint): void;
};

declare class TrackingEngineModule extends NativeModule<Events> {
  getSnapshot(): Promise<EngineSnapshot>;
  arm(type: ActivityType, ownerId: string): Promise<string>;
  cancelArm(): Promise<void>;
  begin(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  discard(): Promise<void>;
  getTrackPoints(id: string, afterSeq: number, limit: number): Promise<TrackPoint[]>;
  listFinished(): Promise<FinishedSession[]>;
  ackImported(id: string): Promise<void>;
  getEvents(limit: number): Promise<EngineEvent[]>;
  requestIgnoreBatteryOptimizations(): Promise<void>;
  openAppSettings(): Promise<void>;
}

export default requireNativeModule<TrackingEngineModule>('TrackingEngine');
