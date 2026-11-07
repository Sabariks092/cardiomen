import { ActivityChange, ChangesResponse, PresetChange, PutActivityBody } from '@cardiomen/contracts';
import TrackingEngine from '@engine';
import NetInfo from '@react-native-community/netinfo';
import type { SQLiteDatabase } from 'expo-sqlite';
import { ApiError, authed, getAuthState, NetworkError, SessionChangedError } from '@/auth/api';
import { currentSession, sessionGeneration } from '@/auth/session';
import { getDb, hasDb, notifyChange, transaction, write } from '@/db';
import { getActivity, getTrackBlob } from '@/db/activities';
import { sha256Hex } from '@/tracking/importer';
import { base64ToBytes, bytesToBase64 } from './base64';

interface OutboxRow {
  entity: 'activity' | 'preset';
  entityId: string;
  attempts: number;
  nextAttemptAt: number;
  generation: number;
  blockedError: string | null;
}

/** One sync pass belongs to one account and its database, whoever signs in while it runs. */
interface Run {
  db: SQLiteDatabase;
  generation: number;
}

function assertSameAccount(run: Run) {
  if (run.generation !== sessionGeneration()) throw new SessionChangedError();
}

const BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000];
const MIN_RETRY_MS = 5000;

export function backoffMs(attempts: number): number {
  const base = BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)];
  return base * (0.8 + Math.random() * 0.4);
}

export type RetryDecision = 'retry' | 'blocked' | 'stop';

/** Temporary problems retry forever. Rejected data is kept locally and reported, never dropped. */
export function classifyFailure(e: unknown): RetryDecision {
  if (e instanceof SessionChangedError) return 'stop';
  if (e instanceof NetworkError) return 'retry';
  if (e instanceof ApiError) {
    if (e.status === 401) return 'stop';
    if (e.status === 408 || e.status === 429 || e.status >= 500) return 'retry';
    return 'blocked';
  }
  return 'retry';
}

async function pushActivity(run: Run, id: string): Promise<number | null> {
  const a = await getActivity(id, run.db);
  if (!a) return null;
  const body: PutActivityBody = {
    type: a.type,
    title: a.title,
    note: a.note,
    startedAt: a.startedAt,
    endedAt: a.endedAt,
    tzOffsetMin: a.tzOffsetMin,
    localDate: a.localDate,
    activeMs: a.activeMs,
    elapsedMs: a.elapsedMs,
    distanceM: a.distanceM,
    steps: a.steps,
    previewRoute: a.previewRoute,
    bbox: a.bbox,
    engineVersion: a.engineVersion,
    clientUpdatedAt: a.updatedAt,
    deleted: a.deletedAt != null,
  };
  if (a.serverVersion == null) {
    const blob = await getTrackBlob(id, run.db);
    if (blob) {
      body.track = { format: 1, base64: bytesToBase64(blob), sha256: await sha256Hex(blob) };
    }
  }
  const res = await authed<{ version: number }>(
    `/activities/${id}`,
    { method: 'PUT', body: JSON.stringify(body) },
    60_000,
  );
  return res.version;
}

async function pushPreset(run: Run, id: string): Promise<number | null> {
  const row = await run.db.getFirstAsync<{
    name: string;
    doc: string;
    updatedAt: number;
    deletedAt: number | null;
  }>('SELECT name, doc, updatedAt, deletedAt FROM share_presets WHERE id = ?', [id]);
  if (!row) return null;
  const res = await authed<{ version: number }>(`/presets/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: row.name,
      doc: JSON.parse(row.doc),
      clientUpdatedAt: row.updatedAt,
      deleted: row.deletedAt != null,
    }),
  });
  return res.version;
}

async function pushAll(run: Run): Promise<boolean> {
  const { db } = run;
  const rows = await db.getAllAsync<OutboxRow>(
    'SELECT * FROM outbox WHERE blockedError IS NULL AND nextAttemptAt <= ? ORDER BY createdAt',
    [Date.now()],
  );
  for (const row of rows) {
    assertSameAccount(run);
    try {
      const version =
        row.entity === 'activity' ? await pushActivity(run, row.entityId) : await pushPreset(run, row.entityId);
      assertSameAccount(run);
      const table = row.entity === 'activity' ? 'activities' : 'share_presets';
      await transaction(db, async () => {
        if (version != null) await db.runAsync(`UPDATE ${table} SET serverVersion = ? WHERE id = ?`, [version, row.entityId]);
        // Only if nothing changed since we read it. An edit made during the upload stays queued.
        await db.runAsync('DELETE FROM outbox WHERE entity = ? AND entityId = ? AND generation = ?', [
          row.entity,
          row.entityId,
          row.generation,
        ]);
      });
      notifyChange();
    } catch (e) {
      const decision = classifyFailure(e);
      if (decision === 'stop') return false;
      if (decision === 'blocked') {
        await write(
          'UPDATE outbox SET blockedError = ? WHERE entity = ? AND entityId = ?',
          [e instanceof Error ? e.message : String(e), row.entity, row.entityId],
          db,
        );
      } else {
        await write(
          'UPDATE outbox SET attempts = attempts + 1, nextAttemptAt = ? WHERE entity = ? AND entityId = ?',
          [Date.now() + backoffMs(row.attempts), row.entity, row.entityId],
          db,
        );
        if (e instanceof NetworkError) return false; // Offline: no point trying the others now.
      }
    }
  }
  return true;
}

/** Runs inside the pull's transaction. */
async function applyActivity(db: SQLiteDatabase, c: ActivityChange) {
  const pending = await db.getFirstAsync("SELECT 1 FROM outbox WHERE entity = 'activity' AND entityId = ?", [c.id]);
  if (pending) return; // Our push goes first, then the next pull reconciles.
  await db.runAsync(
    `INSERT INTO activities
      (id, type, title, note, startedAt, endedAt, tzOffsetMin, localDate, activeMs, elapsedMs, distanceM,
       steps, previewRoute, bbox, engineVersion, updatedAt, serverVersion, deletedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       type = excluded.type, title = excluded.title, note = excluded.note,
       updatedAt = excluded.updatedAt, serverVersion = excluded.serverVersion, deletedAt = excluded.deletedAt`,
    [
      c.id,
      c.type,
      c.title,
      c.note,
      c.startedAt,
      c.endedAt,
      c.tzOffsetMin,
      c.localDate,
      c.activeMs,
      c.elapsedMs,
      c.distanceM,
      c.steps,
      JSON.stringify(c.previewRoute),
      JSON.stringify(c.bbox),
      c.engineVersion,
      c.clientUpdatedAt,
      c.version,
      c.deleted ? c.clientUpdatedAt : null,
    ],
  );
  await db.runAsync(
    'INSERT OR IGNORE INTO activity_tracks (activityId, format, blob, sha256, present) VALUES (?, 1, NULL, NULL, 0)',
    [c.id],
  );
}

async function applyPreset(db: SQLiteDatabase, c: PresetChange) {
  const pending = await db.getFirstAsync("SELECT 1 FROM outbox WHERE entity = 'preset' AND entityId = ?", [c.id]);
  if (pending) return;
  await db.runAsync(
    `INSERT INTO share_presets (id, name, doc, updatedAt, serverVersion, deletedAt)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET name = excluded.name, doc = excluded.doc, updatedAt = excluded.updatedAt,
       serverVersion = excluded.serverVersion, deletedAt = excluded.deletedAt`,
    [c.id, c.name, JSON.stringify(c.doc), c.clientUpdatedAt, c.version, c.deleted ? c.clientUpdatedAt : null],
  );
}

async function pullAll(run: Run) {
  const { db } = run;
  for (;;) {
    const state = await db.getFirstAsync<{ value: string }>("SELECT value FROM sync_state WHERE key = 'cursor'");
    const cursor = state?.value ?? '0';
    const res = await authed<ChangesResponse>(`/sync/changes?cursor=${cursor}&limit=100`);
    assertSameAccount(run);
    await transaction(db, async () => {
      for (const a of res.activities) await applyActivity(db, a);
      for (const p of res.presets) await applyPreset(db, p);
      await db.runAsync(
        "INSERT INTO sync_state (key, value) VALUES ('cursor', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        [String(res.cursor)],
      );
    });
    if (res.activities.length || res.presets.length) notifyChange();
    if (!res.hasMore) return;
  }
}

let running = false;
let again = false;
let waitingForRecording = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleNextRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  // Signed out or recording: retrying can't help. Sign-in and finishing an activity both sync again.
  if (!hasDb() || getAuthState() === 'signed-out' || waitingForRecording) return;
  getDb()
    .getFirstAsync<{ next: number | null }>('SELECT MIN(nextAttemptAt) AS next FROM outbox WHERE blockedError IS NULL')
    .then((row) => {
      if (row?.next == null) return;
      retryTimer = setTimeout(() => requestSync(), Math.max(row.next - Date.now(), MIN_RETRY_MS));
    })
    .catch(() => undefined);
}

/**
 * Safe to call from anywhere, any number of times. Never runs while recording. `force` skips the
 * backoff wait, for when something has clearly changed: the user asked, or the network came back.
 */
export function requestSync(force?: unknown) {
  const session = currentSession();
  if (!session || session.local || !hasDb()) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  const run: Run = { db: getDb(), generation: sessionGeneration() };
  (async () => {
    const engine = await TrackingEngine.getSnapshot();
    waitingForRecording = engine.state === 'ACTIVE';
    if (waitingForRecording) return;
    if (force === true) await write('UPDATE outbox SET nextAttemptAt = 0 WHERE blockedError IS NULL', [], run.db);
    if (await pushAll(run)) await pullAll(run);
  })()
    .catch((e) => {
      const expected =
        e instanceof NetworkError || e instanceof SessionChangedError || (e instanceof ApiError && e.status === 401);
      if (!expected) console.warn('Sync failed', e);
    })
    .finally(() => {
      running = false;
      scheduleNextRetry();
      if (again) {
        again = false;
        requestSync();
      }
    });
}

export function startSyncTriggers() {
  return NetInfo.addEventListener((state) => {
    if (state.isConnected) requestSync(true);
  });
}

/** After a reinstall, routes download only when opened or via Restore all. */
export async function downloadTrackIfMissing(id: string): Promise<Uint8Array | null> {
  const session = currentSession();
  if (!session || session.local) return null;
  const run: Run = { db: getDb(), generation: sessionGeneration() };
  try {
    const res = await authed<{ format: number; base64: string; sha256: string }>(`/activities/${id}/track`, {}, 60_000);
    assertSameAccount(run);
    const blob = base64ToBytes(res.base64);
    await write(
      'UPDATE activity_tracks SET format = ?, blob = ?, sha256 = ?, present = 1 WHERE activityId = ?',
      [res.format, blob, res.sha256, id],
      run.db,
    );
    return blob;
  } catch {
    return null;
  }
}

/** After a reinstall, brings every route back to the phone instead of waiting until each is opened. */
export async function restoreAllTracks(): Promise<{ restored: number; failed: number }> {
  const db = getDb();
  const missing = await db.getAllAsync<{ activityId: string }>(
    `SELECT t.activityId FROM activity_tracks t
     JOIN activities a ON a.id = t.activityId
     WHERE t.present = 0 AND a.deletedAt IS NULL`,
  );
  let restored = 0;
  for (const { activityId } of missing) {
    if (await downloadTrackIfMissing(activityId)) restored += 1;
  }
  return { restored, failed: missing.length - restored };
}

export interface BackupStatus {
  pending: number;
  blocked: { entityId: string; error: string }[];
}

export async function backupStatus(): Promise<BackupStatus> {
  const rows = await getDb().getAllAsync<OutboxRow>('SELECT * FROM outbox');
  return {
    pending: rows.filter((r) => !r.blockedError).length,
    blocked: rows
      .filter((r) => r.blockedError)
      .map((r) => ({ entityId: r.entityId, error: r.blockedError as string })),
  };
}

export async function retryBlocked() {
  await write('UPDATE outbox SET blockedError = NULL, attempts = 0, nextAttemptAt = 0');
  notifyChange();
  requestSync();
}
