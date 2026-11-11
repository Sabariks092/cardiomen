import type { ActivityType } from '@engine';
import { DayRow } from '@/lib/stats';
import { Bbox, LngLat } from '@/lib/track';
import type { SQLiteDatabase } from 'expo-sqlite';
import { getDb, notifyChange, transaction } from './index';

export interface Activity {
  id: string;
  type: ActivityType;
  title: string | null;
  note: string | null;
  startedAt: number;
  endedAt: number;
  tzOffsetMin: number;
  localDate: string;
  activeMs: number;
  elapsedMs: number;
  distanceM: number;
  steps: number | null;
  previewRoute: LngLat[][];
  bbox: Bbox | null;
  engineVersion: number;
  updatedAt: number;
  serverVersion: number | null;
  deletedAt: number | null;
  pendingSync: boolean;
}

type ActivityRow = Omit<Activity, 'previewRoute' | 'bbox' | 'pendingSync'> & {
  previewRoute: string;
  bbox: string | null;
  pending: number;
};

const SELECT = `SELECT a.*, EXISTS(SELECT 1 FROM outbox o WHERE o.entity = 'activity' AND o.entityId = a.id) AS pending
  FROM activities a`;

function toActivity(row: ActivityRow): Activity {
  const { pending, ...rest } = row;
  return {
    ...rest,
    previewRoute: JSON.parse(row.previewRoute),
    bbox: row.bbox ? JSON.parse(row.bbox) : null,
    pendingSync: pending === 1,
  };
}

export async function listActivities(type: ActivityType | 'all', localDate?: string | null): Promise<Activity[]> {
  const where = ['a.deletedAt IS NULL'];
  const params: string[] = [];
  if (type !== 'all') {
    where.push('a.type = ?');
    params.push(type);
  }
  if (localDate) {
    where.push('a.localDate = ?');
    params.push(localDate);
  }
  const rows = await getDb().getAllAsync<ActivityRow>(
    `${SELECT} WHERE ${where.join(' AND ')} ORDER BY a.startedAt DESC`,
    params,
  );
  return rows.map(toActivity);
}

export type ActivitySort = 'newest' | 'oldest' | 'longest' | 'shortest' | 'fastest';

export interface ActivityQuery {
  type: ActivityType | 'all';
  from?: string | null;
  to?: string | null;
  search?: string;
  sort?: ActivitySort;
  /** Show the recently deleted list instead, so a deletion can be undone. */
  deleted?: boolean;
}

const ORDER: Record<ActivitySort, string> = {
  newest: 'a.startedAt DESC',
  oldest: 'a.startedAt ASC',
  longest: 'a.distanceM DESC, a.startedAt DESC',
  shortest: 'a.distanceM ASC, a.startedAt DESC',
  // Activities too short for a meaningful pace go last.
  fastest: 'CASE WHEN a.distanceM >= 1000 THEN a.activeMs / a.distanceM ELSE 1e18 END ASC, a.startedAt DESC',
};

/** Search, filter and sort in SQL, so long histories stay quick. */
export async function queryActivities(q: ActivityQuery): Promise<Activity[]> {
  const where = [q.deleted ? 'a.deletedAt IS NOT NULL' : 'a.deletedAt IS NULL'];
  const params: (string | number)[] = [];
  if (q.type !== 'all') {
    where.push('a.type = ?');
    params.push(q.type);
  }
  if (q.from) {
    where.push('a.localDate >= ?');
    params.push(q.from);
  }
  if (q.to) {
    where.push('a.localDate <= ?');
    params.push(q.to);
  }
  const term = q.search?.trim().toLowerCase();
  if (term) {
    where.push("(LOWER(COALESCE(a.title, '')) LIKE ? OR LOWER(COALESCE(a.note, '')) LIKE ? OR a.type LIKE ? OR a.localDate LIKE ?)");
    const like = `%${term.replace(/[%_]/g, '')}%`;
    params.push(like, like, like, like);
  }
  const order = q.deleted ? 'a.deletedAt DESC' : ORDER[q.sort ?? 'newest'];
  const rows = await getDb().getAllAsync<ActivityRow>(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order}`, params);
  return rows.map(toActivity);
}

export async function recentActivities(limit: number): Promise<Activity[]> {
  const rows = await getDb().getAllAsync<ActivityRow>(
    `${SELECT} WHERE a.deletedAt IS NULL ORDER BY a.startedAt DESC LIMIT ?`,
    [limit],
  );
  return rows.map(toActivity);
}

export type ActivityLiteRow = Pick<
  Activity,
  'id' | 'type' | 'title' | 'note' | 'startedAt' | 'tzOffsetMin' | 'localDate' | 'activeMs' | 'elapsedMs' | 'distanceM' | 'steps'
>;

/** Every activity's numbers without the route, for analytics. */
export async function allActivitiesLite(): Promise<ActivityLiteRow[]> {
  return getDb().getAllAsync<ActivityLiteRow>(
    `SELECT id, type, title, note, startedAt, tzOffsetMin, localDate, activeMs, elapsedMs, distanceM, steps
     FROM activities WHERE deletedAt IS NULL ORDER BY startedAt DESC`,
  );
}

export async function getActivity(id: string, db: SQLiteDatabase = getDb()): Promise<Activity | null> {
  const row = await db.getFirstAsync<ActivityRow>(`${SELECT} WHERE a.id = ?`, [id]);
  return row ? toActivity(row) : null;
}

export async function dayRows(from: string, to: string, type: ActivityType | 'all'): Promise<DayRow[]> {
  const typeClause = type === 'all' ? '' : 'AND type = ?';
  const params = type === 'all' ? [from, to] : [from, to, type];
  return getDb().getAllAsync<DayRow>(
    `SELECT localDate,
            SUM(activeMs) AS activeMs,
            SUM(distanceM) AS distanceM,
            SUM(COALESCE(steps, 0)) AS steps,
            COUNT(*) AS sessions
     FROM activities
     WHERE deletedAt IS NULL AND localDate BETWEEN ? AND ? ${typeClause}
     GROUP BY localDate`,
    params,
  );
}

export async function getTrackBlob(id: string, db: SQLiteDatabase = getDb()): Promise<Uint8Array | null> {
  const row = await db.getFirstAsync<{ blob: Uint8Array | null; present: number }>(
    'SELECT blob, present FROM activity_tracks WHERE activityId = ?',
    [id],
  );
  return row && row.present === 1 ? row.blob : null;
}

/** Call inside a transaction. The generation tells an upload in flight that this row has changed. */
async function enqueue(entity: string, entityId: string) {
  await getDb().runAsync(
    `INSERT INTO outbox (entity, entityId, createdAt) VALUES (?, ?, ?)
     ON CONFLICT (entity, entityId) DO UPDATE SET
       attempts = 0, nextAttemptAt = 0, blockedError = NULL, generation = generation + 1`,
    [entity, entityId, Date.now()],
  );
}

export async function updateActivity(
  id: string,
  patch: { title?: string | null; note?: string | null; type?: ActivityType },
) {
  const db = getDb();
  await transaction(db, async () => {
    const existing = await getActivity(id, db);
    if (!existing) return;
    await db.runAsync('UPDATE activities SET title = ?, note = ?, type = ?, updatedAt = ? WHERE id = ?', [
      patch.title !== undefined ? patch.title : existing.title,
      patch.note !== undefined ? patch.note : existing.note,
      patch.type ?? existing.type,
      // Always newer than what's stored, even if this phone's clock is behind.
      Math.max(Date.now(), existing.updatedAt + 1),
      id,
    ]);
    await enqueue('activity', id);
  });
  notifyChange();
}

/** A deletion marker, not an erase, so other devices learn about it and Undo stays possible. */
export async function setDeleted(id: string, deleted: boolean) {
  const db = getDb();
  await transaction(db, async () => {
    const existing = await getActivity(id, db);
    const now = Math.max(Date.now(), (existing?.updatedAt ?? 0) + 1);
    await db.runAsync('UPDATE activities SET deletedAt = ?, updatedAt = ? WHERE id = ?', [
      deleted ? now : null,
      now,
      id,
    ]);
    await enqueue('activity', id);
  });
  notifyChange();
}

/** Marks every activity deleted, in one transaction, and queues each deletion for sync. */
export async function deleteAllActivities(): Promise<number> {
  const db = getDb();
  let count = 0;
  await transaction(db, async () => {
    const rows = await db.getAllAsync<{ id: string; updatedAt: number }>(
      'SELECT id, updatedAt FROM activities WHERE deletedAt IS NULL',
    );
    for (const r of rows) {
      const now = Math.max(Date.now(), r.updatedAt + 1);
      await db.runAsync('UPDATE activities SET deletedAt = ?, updatedAt = ? WHERE id = ?', [now, now, r.id]);
      await enqueue('activity', r.id);
    }
    count = rows.length;
  });
  notifyChange();
  return count;
}

export { enqueue as enqueueOutbox };
