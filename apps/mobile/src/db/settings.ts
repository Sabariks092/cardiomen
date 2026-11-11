import type { ActivityType } from '@engine';
import { useLocalQuery, getDb, notifyChange, write } from './index';
import { Units } from '@/lib/format';
import { WeekStart } from '@/lib/stats';

export type DateFormat = 'dmy' | 'mdy';

export interface Settings {
  units: Units;
  weekStart: WeekStart;
  dateFormat: DateFormat;
  keepAwake: boolean;
  /** Hide the start and end of shared routes. Null until the user has been asked. */
  shareTrim: boolean | null;
  notificationsWarned: boolean;
  permissionsAsked: boolean;

  // Tracking
  defaultActivity: ActivityType;
  /** The last activity started, so Home offers it first. */
  lastActivity: ActivityType | null;
  autoPause: boolean;
  voiceCoach: boolean;
  /** Distance between voice and vibration milestones, in the chosen unit (1 = every km or mile). */
  voiceInterval: number;
  haptics: boolean;

  // Goals and notifications
  weeklyTargetKm: number;
  notifyGoals: boolean;
  notifyRecords: boolean;
  notifyWeekly: boolean;

  // Profile (this phone)
  profileName: string | null;
  avatarUri: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  units: 'km',
  weekStart: 1,
  dateFormat: 'dmy',
  keepAwake: false,
  shareTrim: null,
  notificationsWarned: false,
  permissionsAsked: false,
  defaultActivity: 'walk',
  lastActivity: null,
  autoPause: false,
  voiceCoach: false,
  voiceInterval: 1,
  haptics: true,
  weeklyTargetKm: 20,
  notifyGoals: true,
  notifyRecords: true,
  notifyWeekly: true,
  profileName: null,
  avatarUri: null,
};

export async function loadSettings(): Promise<Settings> {
  const rows = await getDb().getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings');
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  rows.forEach((r) => {
    out[r.key] = JSON.parse(r.value);
  });
  return out as unknown as Settings;
}

export async function saveSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  await write(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    [key, JSON.stringify(value)],
  );
  notifyChange();
}

export function useSettings(): Settings {
  return useLocalQuery(loadSettings, []).data ?? DEFAULT_SETTINGS;
}
