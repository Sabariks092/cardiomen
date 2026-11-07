import { useLocalQuery, getDb, notifyChange, write } from './index';
import { Units } from '@/lib/format';
import { WeekStart } from '@/lib/stats';

export interface Settings {
  units: Units;
  weekStart: WeekStart;
  keepAwake: boolean;
  /** Hide the start and end of shared routes. Null until the user has been asked. */
  shareTrim: boolean | null;
  notificationsWarned: boolean;
  permissionsAsked: boolean;
}

const DEFAULTS: Settings = { units: 'km', weekStart: 1, keepAwake: false, shareTrim: null, notificationsWarned: false, permissionsAsked: false };

export async function loadSettings(): Promise<Settings> {
  const rows = await getDb().getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings');
  const out: Record<string, unknown> = { ...DEFAULTS };
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
  return useLocalQuery(loadSettings, []).data ?? DEFAULTS;
}
