export type Units = 'km' | 'mi';

const M_PER_MI = 1609.344;

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "1h 20m" style, for totals and chart labels. */
export function formatHours(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function distanceValue(meters: number, units: Units = 'km'): number {
  return units === 'mi' ? meters / M_PER_MI : meters / 1000;
}

export function formatDistance(meters: number, units: Units = 'km'): string {
  return distanceValue(meters, units).toFixed(2);
}

/** Seconds per km (or mile), or "--:--" when there isn't enough data to mean anything. */
export function formatPace(secPerKm: number | null | undefined, units: Units = 'km'): string {
  if (secPerKm == null || !Number.isFinite(secPerKm) || secPerKm <= 0 || secPerKm > 3600) return '--:--';
  const sec = Math.round(units === 'mi' ? secPerKm * (M_PER_MI / 1000) : secPerKm);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

export function averagePace(activeMs: number, distanceM: number): number | null {
  if (distanceM < 10 || activeMs <= 0) return null;
  return activeMs / 1000 / (distanceM / 1000);
}

export function formatSteps(steps: number | null | undefined): string {
  return steps == null ? '—' : steps.toLocaleString('en-US');
}

export const TYPE_LABEL = { walk: 'Walk', jog: 'Jog', run: 'Run' } as const;

/** The calendar date where the activity happened, regardless of the phone's zone today. */
export function localDateOf(utcMs: number, tzOffsetMin: number): string {
  return new Date(utcMs + tzOffsetMin * 60000).toISOString().slice(0, 10);
}

export function formatActivityDate(utcMs: number, tzOffsetMin: number): string {
  const d = new Date(utcMs + tzOffsetMin * 60000);
  const date = d.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const time = d.toLocaleTimeString('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' });
  return `${date}, ${time}`;
}
