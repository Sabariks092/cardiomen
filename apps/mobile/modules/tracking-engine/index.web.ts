import { NativeModule, registerWebModule } from 'expo';
import type { EngineEvent, EngineSnapshot, Events, FinishedSession, TrackPoint } from './index';

export type * from './index';

const IDLE: EngineSnapshot = {
  sessionId: null,
  type: null,
  state: 'IDLE',
  pauseReason: null,
  activeMs: 0,
  startedAt: null,
  lastWallMs: null,
  distanceM: 0,
  steps: null,
  currentPaceSecPerKm: null,
  gps: 'off',
  lat: null,
  lng: null,
  accuracyM: null,
  health: {
    locationPermission: false,
    gpsEnabled: false,
    ignoringBatteryOptimizations: true,
    lowStorage: false,
  },
};

/** Recording needs the native service, so on web the engine stays idle and has nothing to import. */
class TrackingEngineWeb extends NativeModule<Events> {
  async getSnapshot(): Promise<EngineSnapshot> {
    return IDLE;
  }
  async arm(): Promise<string> {
    throw new Error('Recording is only available in the mobile app.');
  }
  async cancelArm() {}
  async begin() {}
  async pause() {}
  async resume() {}
  async stop() {}
  async discard() {}
  async getTrackPoints(): Promise<TrackPoint[]> {
    return [];
  }
  async listFinished(): Promise<FinishedSession[]> {
    return [];
  }
  async ackImported() {}
  async getEvents(): Promise<EngineEvent[]> {
    return [];
  }
  async requestIgnoreBatteryOptimizations() {}
  async openAppSettings() {}
}

export default registerWebModule(TrackingEngineWeb, 'TrackingEngine');
