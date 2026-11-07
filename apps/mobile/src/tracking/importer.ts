import TrackingEngine, { FinishedSession, TrackPoint } from '@engine';
import { digest, CryptoDigestAlgorithm } from 'expo-crypto';
import { currentSession } from '@/auth/session';
import { getDb, hasDb, notifyChange, transaction } from '@/db';
import { localDateOf } from '@/lib/format';
import { bboxOf, encodeTrack, previewOf, toSegments } from '@/lib/track';

const PAGE = 2000;

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buffer = await digest(CryptoDigestAlgorithm.SHA256, bytes as unknown as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function readAllPoints(id: string): Promise<TrackPoint[]> {
  const all: TrackPoint[] = [];
  let after = -1;
  for (;;) {
    const page = await TrackingEngine.getTrackPoints(id, after, PAGE);
    all.push(...page);
    if (page.length < PAGE) return all;
    after = page[page.length - 1].seq;
  }
}

async function importSession(s: FinishedSession) {
  const db = getDb();
  const points = await readAllPoints(s.id);
  const lines = toSegments(points);
  const blob = encodeTrack(points);
  const sha = await sha256Hex(blob);
  const now = Date.now();

  // All-or-nothing, and INSERT OR IGNORE by ID. A crash anywhere just means this runs again safely.
  await transaction(db, async () => {
    await db.runAsync(
      `INSERT OR IGNORE INTO activities
        (id, type, startedAt, endedAt, tzOffsetMin, localDate, activeMs, elapsedMs, distanceM, steps,
         previewRoute, bbox, engineVersion, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        s.id,
        s.type,
        s.startedAt,
        s.endedAt,
        s.tzOffsetMin,
        localDateOf(s.startedAt, s.tzOffsetMin),
        Math.round(s.activeMs),
        Math.max(0, s.endedAt - s.startedAt),
        s.distanceM,
        s.steps,
        JSON.stringify(previewOf(lines)),
        JSON.stringify(bboxOf(lines)),
        s.engineVersion,
        now,
      ],
    );
    await db.runAsync(
      'INSERT OR IGNORE INTO activity_tracks (activityId, format, blob, sha256, present) VALUES (?, 1, ?, ?, 1)',
      [s.id, blob, sha],
    );
    await db.runAsync('INSERT OR IGNORE INTO outbox (entity, entityId, createdAt) VALUES (?, ?, ?)', [
      'activity',
      s.id,
      now,
    ]);
  });
  await TrackingEngine.ackImported(s.id);
}

let running: Promise<void> | null = null;

/** Moves every finished recording into the app database. Runs on stop, launch and foreground. */
export function importFinished(): Promise<void> {
  if (!hasDb()) return Promise.resolve();
  // A recording may have finished after the running pass read its list, so go round once more.
  if (running) return running.then(() => importFinished());
  running = (async () => {
    try {
      // A recording only ever goes to the account that made it, whoever is signed in now.
      const me = currentSession()?.user.id;
      const finished = (await TrackingEngine.listFinished()).filter((s) => s.ownerId === me);
      for (const s of finished) await importSession(s);
      if (finished.length > 0) notifyChange();
    } finally {
      running = null;
    }
  })();
  return running;
}
