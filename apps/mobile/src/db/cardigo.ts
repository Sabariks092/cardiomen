/**
 * Goals, saved routes, notifications and the per-activity stats cache. All of it lives on this
 * phone only (see migration 3); activities themselves still sync as before.
 */
import TrackingEngine from '@engine';
import { randomUUID } from 'expo-crypto';
import { Goal, GoalKind, Kind, trackStats } from '@/lib/analytics';
import { decodeTrack } from '@/lib/track';
import { getActivity, getTrackBlob } from './activities';
import { getDb, notifyChange, write } from './index';

// ---------- Goals ----------

interface GoalRow {
  id: string;
  kind: GoalKind;
  target: number;
  activityType: Kind | null;
  paused: number;
  createdAt: number;
  achievedPeriod: string | null;
}

export async function listGoals(): Promise<Goal[]> {
  const rows = await getDb().getAllAsync<GoalRow>(
    'SELECT * FROM goals WHERE deletedAt IS NULL ORDER BY paused, createdAt DESC',
  );
  return rows.map((r) => ({ ...r, paused: r.paused === 1 }));
}

export async function saveGoal(g: { id?: string; kind: GoalKind; target: number; activityType: Kind | null }) {
  if (g.id) {
    await write('UPDATE goals SET kind = ?, target = ?, activityType = ?, achievedPeriod = NULL WHERE id = ?', [
      g.kind,
      g.target,
      g.activityType,
      g.id,
    ]);
  } else {
    await write('INSERT INTO goals (id, kind, target, activityType, createdAt) VALUES (?, ?, ?, ?, ?)', [
      randomUUID(),
      g.kind,
      g.target,
      g.activityType,
      Date.now(),
    ]);
  }
  notifyChange();
}

export async function setGoalPaused(id: string, paused: boolean) {
  await write('UPDATE goals SET paused = ? WHERE id = ?', [paused ? 1 : 0, id]);
  notifyChange();
}

export async function deleteGoal(id: string) {
  await write('UPDATE goals SET deletedAt = ? WHERE id = ?', [Date.now(), id]);
  notifyChange();
}

export async function markGoalAchieved(id: string, periodKey: string) {
  await write('UPDATE goals SET achievedPeriod = ? WHERE id = ?', [periodKey, id]);
}

// ---------- Saved routes ----------

export interface SavedRoute {
  id: string;
  name: string;
  activityId: string;
  createdAt: number;
}

export async function listSavedRoutes(): Promise<SavedRoute[]> {
  return getDb().getAllAsync<SavedRoute>(
    `SELECT r.id, r.name, r.activityId, r.createdAt FROM saved_routes r
     JOIN activities a ON a.id = r.activityId AND a.deletedAt IS NULL
     WHERE r.deletedAt IS NULL ORDER BY r.createdAt DESC`,
  );
}

export async function savedRouteFor(activityId: string): Promise<SavedRoute | null> {
  return getDb().getFirstAsync<SavedRoute>(
    'SELECT id, name, activityId, createdAt FROM saved_routes WHERE activityId = ? AND deletedAt IS NULL',
    [activityId],
  );
}

export async function saveRoute(activityId: string, name: string) {
  await write('INSERT INTO saved_routes (id, name, activityId, createdAt) VALUES (?, ?, ?, ?)', [
    randomUUID(),
    name.trim() || 'My route',
    activityId,
    Date.now(),
  ]);
  notifyChange();
}

export async function renameRoute(id: string, name: string) {
  await write('UPDATE saved_routes SET name = ? WHERE id = ?', [name.trim() || 'My route', id]);
  notifyChange();
}

export async function removeRoute(id: string) {
  await write('UPDATE saved_routes SET deletedAt = ? WHERE id = ?', [Date.now(), id]);
  notifyChange();
}

// ---------- Notifications ----------

export interface AppNotification {
  id: string;
  kind: 'goal' | 'record' | 'milestone' | 'weekly';
  title: string;
  body: string;
  activityId: string | null;
  createdAt: number;
  readAt: number | null;
}

export async function listNotifications(): Promise<AppNotification[]> {
  return getDb().getAllAsync<AppNotification>('SELECT * FROM notifications ORDER BY createdAt DESC LIMIT 200');
}

export async function unreadCount(): Promise<number> {
  const row = await getDb().getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE readAt IS NULL');
  return row?.n ?? 0;
}

/**
 * Adds a notification once per dedupe key, so re-checking never repeats it. Returns true when new.
 * `push` also shows it in the system tray.
 */
export async function addNotification(
  n: Omit<AppNotification, 'id' | 'createdAt' | 'readAt'> & { dedupeKey: string },
  push: boolean,
): Promise<boolean> {
  const result = await write(
    `INSERT OR IGNORE INTO notifications (id, kind, dedupeKey, title, body, activityId, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), n.kind, n.dedupeKey, n.title, n.body, n.activityId, Date.now()],
  );
  const added = result.changes > 0;
  if (added && push) {
    TrackingEngine.notify(hash(n.dedupeKey), n.title, n.body).catch(() => undefined);
  }
  return added;
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export async function markAllRead() {
  await write('UPDATE notifications SET readAt = ? WHERE readAt IS NULL', [Date.now()]);
  notifyChange();
}

export async function markRead(id: string) {
  await write('UPDATE notifications SET readAt = COALESCE(readAt, ?) WHERE id = ?', [Date.now(), id]);
  notifyChange();
}

export async function clearNotifications() {
  await write('DELETE FROM notifications');
  notifyChange();
}

// ---------- Per-activity stats (cache) ----------

export interface ActivityStatsRow {
  activityId: string;
  bestKmMs: number | null;
  maxSpeedMps: number | null;
  elevationGainM: number | null;
}

export async function getActivityStats(activityId: string): Promise<ActivityStatsRow | null> {
  const cached = await getDb().getFirstAsync<ActivityStatsRow>(
    'SELECT activityId, bestKmMs, maxSpeedMps, elevationGainM FROM activity_stats WHERE activityId = ?',
    [activityId],
  );
  if (cached) return cached;
  return computeActivityStats(activityId);
}

/** Reads the stored track and caches what it says. Null when the track isn't on this phone. */
export async function computeActivityStats(activityId: string): Promise<ActivityStatsRow | null> {
  const blob = await getTrackBlob(activityId);
  if (!blob) return null;
  const s = trackStats(decodeTrack(blob));
  const row = { activityId, bestKmMs: s.bestKmMs, maxSpeedMps: s.maxSpeedMps, elevationGainM: s.elevationGainM };
  await write(
    `INSERT INTO activity_stats (activityId, bestKmMs, maxSpeedMps, elevationGainM, computedAt)
     VALUES (?, ?, ?, ?, ?) ON CONFLICT (activityId) DO UPDATE SET
       bestKmMs = excluded.bestKmMs, maxSpeedMps = excluded.maxSpeedMps,
       elevationGainM = excluded.elevationGainM, computedAt = excluded.computedAt`,
    [activityId, row.bestKmMs, row.maxSpeedMps, row.elevationGainM, Date.now()],
  );
  return row;
}

/** Fills the cache for activities of 1 km or more that don't have stats yet. A few at a time. */
export async function backfillActivityStats(limit = 20): Promise<number> {
  const rows = await getDb().getAllAsync<{ id: string }>(
    `SELECT a.id FROM activities a
     JOIN activity_tracks t ON t.activityId = a.id AND t.present = 1
     LEFT JOIN activity_stats s ON s.activityId = a.id
     WHERE a.deletedAt IS NULL AND a.distanceM >= 1000 AND s.activityId IS NULL
     ORDER BY a.startedAt DESC LIMIT ?`,
    [limit],
  );
  for (const r of rows) await computeActivityStats(r.id);
  if (rows.length) notifyChange();
  return rows.length;
}

/** The fastest kilometre across all activities, from the cache. */
export async function bestKilometre(): Promise<{ activityId: string; ms: number } | null> {
  const row = await getDb().getFirstAsync<{ activityId: string; ms: number }>(
    `SELECT s.activityId, s.bestKmMs AS ms FROM activity_stats s
     JOIN activities a ON a.id = s.activityId AND a.deletedAt IS NULL
     WHERE s.bestKmMs IS NOT NULL ORDER BY s.bestKmMs LIMIT 1`,
  );
  return row ?? null;
}

export { getActivity };
