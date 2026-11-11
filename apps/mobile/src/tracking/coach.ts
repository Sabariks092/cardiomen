import TrackingEngine from '@engine';
import { Platform } from 'react-native';
import { hasDb } from '@/db';
import { loadSettings } from '@/db/settings';

/**
 * Hands voice, vibration and auto-pause settings to the native engine. It stores them, so they
 * keep working in a recording that runs with the app closed.
 */
export async function applyCoachSettings() {
  if (Platform.OS !== 'android' || !hasDb()) return;
  const s = await loadSettings();
  const unitM = s.units === 'mi' ? 1609.344 : 1000;
  await TrackingEngine.setCoachConfig(s.voiceCoach, s.haptics, s.autoPause, s.voiceInterval * unitM, s.units);
}
