import { ActivityChange, ChangesResponse, PresetBody, PresetChange, PutActivityBody } from '@cardiomen/contracts';
import { createHash } from 'node:crypto';
import { db } from '@/db';
import { Activity, ActivityType, Prisma, SharePreset } from '@/generated/prisma/client';
import { badRequest, HttpError, notFound } from '@/http';

const toDbType = (t: 'walk' | 'jog' | 'run'): ActivityType => t.toUpperCase() as ActivityType;
const fromDbType = (t: ActivityType) => t.toLowerCase() as 'walk' | 'jog' | 'run';

/** Incrementing inside the transaction serializes a user's writes, so cursors can't skip a row. */
async function nextVersion(tx: Prisma.TransactionClient, userId: string): Promise<bigint> {
  const user = await tx.user.update({
    where: { id: userId },
    data: { syncSeq: { increment: 1 } },
    select: { syncSeq: true },
  });
  return user.syncSeq;
}

/** Taken first, so checking and then writing can never interleave with another request. */
async function lockUser(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw`SELECT 1 FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
}

function conflict(): HttpError {
  return new HttpError(409, 'CONFLICT', 'This ID cannot be used.');
}

/** Idempotent: repeating the same request after a lost response changes nothing and adds nothing. */
export async function putActivity(userId: string, id: string, body: PutActivityBody) {
  let trackData: { format: number; blob: Buffer; sha256: string } | null = null;
  if (body.track) {
    const blob = Buffer.from(body.track.base64, 'base64');
    if (createHash('sha256').update(blob).digest('hex') !== body.track.sha256) {
      throw badRequest('Route data failed its integrity check.', 'BAD_CHECKSUM');
    }
    trackData = { format: body.track.format, blob, sha256: body.track.sha256 };
  }

  return db().$transaction(async (tx) => {
    await lockUser(tx, userId);
    const existing = await tx.activity.findUnique({
      where: { id },
      select: { userId: true, clientUpdatedAt: true, version: true, deletedAt: true },
    });
    if (existing && existing.userId !== userId) throw conflict();

    const clientUpdatedAt = new Date(body.clientUpdatedAt);
    let version = existing?.version ?? 0n;

    if (!existing || clientUpdatedAt > existing.clientUpdatedAt) {
      version = await nextVersion(tx, userId);
      const mutable = {
        type: toDbType(body.type),
        title: body.title,
        note: body.note,
        clientUpdatedAt,
        version,
        // Newest action wins, which is what lets Undo work. The date is the server clock, so a
        // phone with a wrong clock can not get a deletion marker purged early.
        deletedAt: body.deleted ? (existing?.deletedAt ?? new Date()) : null,
      };
      await tx.activity.upsert({
        where: { id },
        update: mutable,
        create: {
          ...mutable,
          id,
          userId,
          startedAt: new Date(body.startedAt),
          endedAt: new Date(body.endedAt),
          tzOffsetMin: body.tzOffsetMin,
          localDate: body.localDate,
          activeMs: BigInt(body.activeMs),
          elapsedMs: BigInt(body.elapsedMs),
          distanceM: body.distanceM,
          steps: body.steps,
          previewRoute: body.previewRoute,
          bbox: body.bbox ?? Prisma.JsonNull,
          engineVersion: body.engineVersion,
        },
      });
    } else if (clientUpdatedAt < existing.clientUpdatedAt) {
      // This change lost, but the device that made it thinks it is saved. A new version sends the
      // winning state back to it on its next pull. An older delete still deletes: the user wanted
      // this gone, and an edit made elsewhere should not silently bring it back.
      version = await nextVersion(tx, userId);
      const lateDelete = body.deleted && !existing.deletedAt;
      await tx.activity.update({ where: { id }, data: { version, ...(lateDelete ? { deletedAt: new Date() } : null) } });
    }
    // Same timestamp means a retry after a lost response: nothing to do.

    if (trackData) {
      // A recorded route never changes, so a repeat upload is a harmless no-op.
      await tx.activityTrack.upsert({
        where: { activityId: id },
        create: { activityId: id, ...trackData, blob: new Uint8Array(trackData.blob) },
        update: {},
      });
    }

    const hasTrack = trackData != null || (await tx.activityTrack.count({ where: { activityId: id } })) > 0;
    return { version: Number(version), hasTrack };
  });
}

export async function getTrack(userId: string, id: string) {
  const row = await db().activityTrack.findFirst({
    where: { activityId: id, activity: { userId } },
  });
  if (!row) throw notFound();
  return { format: row.format, base64: Buffer.from(row.blob).toString('base64'), sha256: row.sha256 };
}

export async function putPreset(userId: string, id: string, body: PresetBody) {
  return db().$transaction(async (tx) => {
    await lockUser(tx, userId);
    const existing = await tx.sharePreset.findUnique({
      where: { id },
      select: { userId: true, clientUpdatedAt: true, version: true, deletedAt: true },
    });
    if (existing && existing.userId !== userId) throw conflict();
    const clientUpdatedAt = new Date(body.clientUpdatedAt);

    if (!existing || clientUpdatedAt > existing.clientUpdatedAt) {
      const version = await nextVersion(tx, userId);
      const data = {
        name: body.name,
        doc: body.doc as Prisma.InputJsonValue,
        clientUpdatedAt,
        version,
        deletedAt: body.deleted ? (existing?.deletedAt ?? new Date()) : null,
      };
      await tx.sharePreset.upsert({ where: { id }, update: data, create: { ...data, id, userId } });
      return { version: Number(version) };
    }
    if (clientUpdatedAt < existing.clientUpdatedAt) {
      const version = await nextVersion(tx, userId);
      const lateDelete = body.deleted && !existing.deletedAt;
      await tx.sharePreset.update({ where: { id }, data: { version, ...(lateDelete ? { deletedAt: new Date() } : null) } });
      return { version: Number(version) };
    }
    return { version: Number(existing.version) };
  });
}

function toActivityChange(a: Activity): ActivityChange {
  return {
    id: a.id,
    version: Number(a.version),
    type: fromDbType(a.type),
    title: a.title,
    note: a.note,
    startedAt: a.startedAt.getTime(),
    endedAt: a.endedAt.getTime(),
    tzOffsetMin: a.tzOffsetMin,
    localDate: a.localDate,
    activeMs: Number(a.activeMs),
    elapsedMs: Number(a.elapsedMs),
    distanceM: a.distanceM,
    steps: a.steps,
    previewRoute: a.previewRoute as ActivityChange['previewRoute'],
    bbox: a.bbox as ActivityChange['bbox'],
    engineVersion: a.engineVersion,
    clientUpdatedAt: a.clientUpdatedAt.getTime(),
    deleted: a.deletedAt != null,
  };
}

function toPresetChange(p: SharePreset): PresetChange {
  return {
    id: p.id,
    version: Number(p.version),
    name: p.name,
    doc: p.doc as PresetChange['doc'],
    clientUpdatedAt: p.clientUpdatedAt.getTime(),
    deleted: p.deletedAt != null,
  };
}

export async function getChanges(userId: string, cursor: number, limit: number): Promise<ChangesResponse> {
  const prisma = db();
  const after = BigInt(cursor);
  // Read first. Every version up to this number is committed, so the cursor can never move past a
  // change that was still in progress and would otherwise be skipped forever.
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { syncSeq: true } });
  const upTo = user?.syncSeq ?? 0n;
  const range = { gt: after, lte: upTo };
  const [activities, presets] = await Promise.all([
    prisma.activity.findMany({ where: { userId, version: range }, orderBy: { version: 'asc' }, take: limit + 1 }),
    prisma.sharePreset.findMany({ where: { userId, version: range }, orderBy: { version: 'asc' }, take: limit + 1 }),
  ]);

  // Merge by version and cut at the limit, so the returned cursor never skips an unsent row.
  const merged = [
    ...activities.map((a) => ({ version: a.version, a })),
    ...presets.map((p) => ({ version: p.version, p })),
  ].sort((x, y) => (x.version < y.version ? -1 : 1));
  const page = merged.slice(0, limit);
  const hasMore = merged.length > limit;
  const nextCursor = page.length ? Number(page[page.length - 1].version) : cursor;

  return {
    cursor: nextCursor,
    hasMore,
    activities: page.flatMap((e) => ('a' in e && e.a ? [toActivityChange(e.a)] : [])),
    presets: page.flatMap((e) => ('p' in e && e.p ? [toPresetChange(e.p)] : [])),
  };
}
