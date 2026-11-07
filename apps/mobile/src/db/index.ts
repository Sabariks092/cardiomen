import { deleteDatabaseAsync, openDatabaseAsync, SQLiteBindParams, SQLiteDatabase } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';

const MIGRATIONS: string[] = [
  `CREATE TABLE activities (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT,
    note TEXT,
    startedAt INTEGER NOT NULL,
    endedAt INTEGER NOT NULL,
    tzOffsetMin INTEGER NOT NULL,
    localDate TEXT NOT NULL,
    activeMs INTEGER NOT NULL,
    elapsedMs INTEGER NOT NULL,
    distanceM REAL NOT NULL,
    steps INTEGER,
    previewRoute TEXT NOT NULL,
    bbox TEXT,
    engineVersion INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    serverVersion INTEGER,
    deletedAt INTEGER
  );
  CREATE INDEX activities_date ON activities(localDate);
  CREATE INDEX activities_list ON activities(deletedAt, startedAt DESC);
  CREATE TABLE activity_tracks (
    activityId TEXT PRIMARY KEY,
    format INTEGER NOT NULL,
    blob BLOB,
    sha256 TEXT,
    present INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE share_presets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    doc TEXT NOT NULL,
    updatedAt INTEGER NOT NULL,
    serverVersion INTEGER,
    deletedAt INTEGER
  );
  CREATE TABLE share_drafts (
    activityId TEXT PRIMARY KEY,
    doc TEXT NOT NULL,
    updatedAt INTEGER NOT NULL
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE outbox (
    entity TEXT NOT NULL,
    entityId TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    nextAttemptAt INTEGER NOT NULL DEFAULT 0,
    blockedError TEXT,
    createdAt INTEGER NOT NULL,
    PRIMARY KEY (entity, entityId)
  );
  CREATE TABLE sync_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );`,
  `ALTER TABLE outbox ADD COLUMN generation INTEGER NOT NULL DEFAULT 0;`,
];

let current: { name: string; db: SQLiteDatabase } | null = null;
const listeners = new Set<() => void>();

async function migrate(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const from = row?.user_version ?? 0;
  for (let v = from; v < MIGRATIONS.length; v += 1) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(MIGRATIONS[v]);
      await db.execAsync(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

/** Each account has its own database, so two accounts on one phone can never mix data. */
export async function openUserDb(userId: string): Promise<SQLiteDatabase> {
  const name = `app_${userId.replace(/[^a-zA-Z0-9-]/g, '')}.db`;
  if (current?.name === name) return current.db;
  const db = await openDatabaseAsync(name);
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;');
  await migrate(db);
  current = { name, db };
  notifyChange();
  return db;
}

export function closeUserDb() {
  current = null;
}

/** Removes this account's data from the phone, after the account itself has been deleted. */
export async function deleteUserDb() {
  if (!current) return;
  const { name, db } = current;
  current = null;
  await db.closeAsync();
  await deleteDatabaseAsync(name);
}

/**
 * All writes wait in one line. SQLite transactions belong to the connection, so a write or a second
 * BEGIN arriving during a transaction would join it, fail it, or be rolled back with it.
 * Inside `transaction`, use db.runAsync directly: calling `write` there would wait on itself.
 */
let queue: Promise<unknown> = Promise.resolve();

function inLine<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task, task);
  queue = result.catch(() => undefined);
  return result;
}

export function transaction(db: SQLiteDatabase, task: () => Promise<void>): Promise<void> {
  return inLine(() => db.withTransactionAsync(task));
}

export function write(sql: string, params: SQLiteBindParams = [], db: SQLiteDatabase = getDb()) {
  return inLine(() => db.runAsync(sql, params));
}

export function getDb(): SQLiteDatabase {
  if (!current) throw new Error('Database not open');
  return current.db;
}

export function hasDb() {
  return current !== null;
}

export function notifyChange() {
  listeners.forEach((l) => l());
}

export function subscribeChanges(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Runs a local query and re-runs it whenever local data changes, so screens are always current. */
export function useLocalQuery<T>(query: () => Promise<T>, deps: unknown[]): { data: T | undefined; reload: () => void } {
  const [data, setData] = useState<T | undefined>(undefined);
  const latest = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableQuery = useCallback(query, deps);

  const reload = useCallback(() => {
    const run = ++latest.current;
    stableQuery()
      .then((result) => {
        if (run === latest.current) setData(result);
      })
      .catch((e) => console.warn('Local query failed', e));
  }, [stableQuery]);

  useEffect(() => {
    reload();
    return subscribeChanges(reload);
  }, [reload]);

  return { data, reload };
}
