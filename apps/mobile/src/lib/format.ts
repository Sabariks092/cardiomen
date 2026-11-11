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

/** Day before month ("Wed, 11 Nov") or month before day ("Wed, Nov 11"). Set from Settings. */
let dateOrder: 'dmy' | 'mdy' = 'dmy';

export function setDateOrder(order: 'dmy' | 'mdy') {
  dateOrder = order;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Wed, 11 Nov" from a local date like 2026-11-11, in the chosen order. */
export function formatDay(localDate: string, withYear = false): string {
  const d = new Date(`${localDate}T00:00:00Z`);
  const day = d.getUTCDate();
  const month = MONTH_SHORT[d.getUTCMonth()];
  const core = dateOrder === 'mdy' ? `${month} ${day}` : `${day} ${month}`;
  return `${WEEKDAY_SHORT[d.getUTCDay()]}, ${core}${withYear ? ` ${d.getUTCFullYear()}` : ''}`;
}

/** "7:05 AM" where the activity happened. */
export function formatStartTime(utcMs: number, tzOffsetMin: number): string {
  const d = new Date(utcMs + tzOffsetMin * 60000);
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

export function formatActivityDate(utcMs: number, tzOffsetMin: number): string {
  return `${formatDay(localDateOf(utcMs, tzOffsetMin))}, ${formatStartTime(utcMs, tzOffsetMin)}`;
}

/** km/h or mph from meters per second. */
export function formatSpeed(mps: number | null | undefined, units: Units = 'km'): string {
  if (mps == null || !Number.isFinite(mps) || mps < 0) return '--';
  return (units === 'mi' ? mps * 2.236936 : mps * 3.6).toFixed(1);
}

export function speedUnit(units: Units = 'km') {
  return units === 'mi' ? 'mph' : 'km/h';
}
