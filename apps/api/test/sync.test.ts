import { PutActivityBody } from '@cardiomen/contracts';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET as getTrackRoute } from '../app/api/v1/activities/[id]/track/route';
import { PUT as putRoute } from '../app/api/v1/activities/[id]/route';
import { GET as cleanup } from '../app/api/v1/internal/cleanup/route';
import { DELETE as deleteMe } from '../app/api/v1/me/route';
import { PUT as putPresetRoute } from '../app/api/v1/presets/[id]/route';
import { GET as changes } from '../app/api/v1/sync/changes/route';
import { signAccessToken } from '@/auth/tokens';
import { ctx, get, Harness, put, startHarness } from './harness';

let h: Harness;
let alice: string;
let bob: string;
let aliceId: string;

const noCtx = undefined as never;

function activity(overrides: Partial<PutActivityBody> = {}): PutActivityBody {
  const blob = Buffer.from('compressed route');
  return {
    type: 'run',
    title: null,
    note: null,
    startedAt: 1_762_500_000_000,
    endedAt: 1_762_503_600_000,
    tzOffsetMin: 330,
    localDate: '2025-11-07',
    activeMs: 3_500_000,
    elapsedMs: 3_600_000,
    distanceM: 10_000,
    steps: 11_000,
    previewRoute: [[[77.59, 12.97], [77.6, 12.98]]],
    bbox: { minLat: 12.97, minLng: 77.59, maxLat: 12.98, maxLng: 77.6 },
    engineVersion: 1,
    clientUpdatedAt: 1000,
    deleted: false,
    track: { format: 1, base64: blob.toString('base64'), sha256: createHash('sha256').update(blob).digest('hex') },
    ...overrides,
  };
}

async function user(email: string) {
  const u = await h.prisma.user.create({ data: { email, name: email, emailVerifiedAt: new Date() } });
  return { id: u.id, token: await signAccessToken(u.id) };
}

beforeAll(async () => {
  h = await startHarness(54332);
});
afterAll(async () => {
  await h.stop();
});
beforeEach(async () => {
  await h.prisma.user.deleteMany();
  const a = await user('alice@example.com');
  aliceId = a.id;
  alice = a.token;
  bob = (await user('bob@example.com')).token;
});

const pull = async (token: string, cursor = 0, limit = 100) =>
  (await changes(get(`/sync/changes?cursor=${cursor}&limit=${limit}`, token), noCtx)).json();

describe('uploading activities', () => {
  it('retrying after a lost response creates no duplicate and no new version', async () => {
    const id = randomUUID();
    const first = await putRoute(put(`/activities/${id}`, activity(), alice), ctx(id));
    const retry = await putRoute(put(`/activities/${id}`, activity(), alice), ctx(id));
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect((await retry.json()).version).toBe((await first.json()).version);
    expect(await h.prisma.activity.count()).toBe(1);
    expect(await h.prisma.activityTrack.count()).toBe(1);
  });

  it('rejects corrupted route data', async () => {
    const id = randomUUID();
    const bad = activity();
    bad.track!.sha256 = '0'.repeat(64);
    const res = await putRoute(put(`/activities/${id}`, bad, alice), ctx(id));
    expect(res.status).toBe(400);
    expect(await h.prisma.activity.count()).toBe(0);
  });

  it("another user can't overwrite or read someone's activity", async () => {
    const id = randomUUID();
    await putRoute(put(`/activities/${id}`, activity(), alice), ctx(id));
    const res = await putRoute(put(`/activities/${id}`, activity({ title: 'stolen', clientUpdatedAt: 9000 }), bob), ctx(id));
    expect(res.status).toBe(409);
    expect((await h.prisma.activity.findFirstOrThrow()).title).toBeNull();
    expect((await getTrackRoute(get(`/activities/${id}/track`, bob), ctx(id))).status).toBe(404);
    expect((await pull(bob)).activities).toHaveLength(0);
  });

  it('requires a token', async () => {
    const id = randomUUID();
    expect((await putRoute(put(`/activities/${id}`, activity(), 'nope'), ctx(id))).status).toBe(401);
  });

  it('applies the newest edit, and ignores an older one that arrives late', async () => {
    const id = randomUUID();
    await putRoute(put(`/activities/${id}`, activity({ title: 'new', clientUpdatedAt: 5000 }), alice), ctx(id));
    await putRoute(put(`/activities/${id}`, activity({ title: 'old', clientUpdatedAt: 2000 }), alice), ctx(id));
    expect((await h.prisma.activity.findFirstOrThrow()).title).toBe('new');
  });

  it('an edit never changes the recorded stats or route', async () => {
    const id = randomUUID();
    await putRoute(put(`/activities/${id}`, activity(), alice), ctx(id));
    const edit = activity({ title: 'Renamed', distanceM: 1, clientUpdatedAt: 2000 });
    delete edit.track;
    await putRoute(put(`/activities/${id}`, edit, alice), ctx(id));
    const row = await h.prisma.activity.findFirstOrThrow();
    expect(row.title).toBe('Renamed');
    expect(row.distanceM).toBe(10_000);
    expect(await h.prisma.activityTrack.count()).toBe(1);
  });

  it('returns the route byte for byte', async () => {
    const id = randomUUID();
    const body = activity();
    await putRoute(put(`/activities/${id}`, body, alice), ctx(id));
    const res = await (await getTrackRoute(get(`/activities/${id}/track`, alice), ctx(id))).json();
    expect(res.base64).toBe(body.track!.base64);
    expect(res.sha256).toBe(body.track!.sha256);
  });
});

describe('pulling changes', () => {
  it('pages through everything without skipping or repeating', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 7; i += 1) {
      const id = randomUUID();
      ids.add(id);
      await putRoute(put(`/activities/${id}`, activity(), alice), ctx(id));
    }
    const seen: string[] = [];
    let cursor = 0;
    for (;;) {
      const page = await pull(alice, cursor, 3);
      seen.push(...page.activities.map((a: { id: string }) => a.id));
      cursor = page.cursor;
      if (!page.hasMore) break;
    }
    expect(seen).toHaveLength(7);
    expect(new Set(seen)).toEqual(ids);
  });

  it('keeps activities and presets in one order across pages', async () => {
    const a1 = randomUUID();
    const p1 = randomUUID();
    const a2 = randomUUID();
    await putRoute(put(`/activities/${a1}`, activity(), alice), ctx(a1));
    await putPresetRoute(put(`/presets/${p1}`, { name: 'P', doc: { version: 1 }, clientUpdatedAt: 1, deleted: false }, alice), ctx(p1));
    await putRoute(put(`/activities/${a2}`, activity(), alice), ctx(a2));

    const one = await pull(alice, 0, 1);
    const two = await pull(alice, one.cursor, 1);
    const three = await pull(alice, two.cursor, 1);
    expect(one.activities[0].id).toBe(a1);
    expect(two.presets[0].id).toBe(p1);
    expect(three.activities[0].id).toBe(a2);
    expect(three.hasMore).toBe(false);
  });

  it('delivers a deletion, so other devices learn about it', async () => {
    const id = randomUUID();
    await putRoute(put(`/activities/${id}`, activity(), alice), ctx(id));
    const { cursor } = await pull(alice);
    const del = activity({ deleted: true, clientUpdatedAt: 3000 });
    delete del.track;
    await putRoute(put(`/activities/${id}`, del, alice), ctx(id));
    const page = await pull(alice, cursor);
    expect(page.activities[0].deleted).toBe(true);
  });

  it('rejects a bad cursor', async () => {
    expect((await changes(get('/sync/changes?cursor=abc', alice), noCtx)).status).toBe(400);
  });
});

describe('account', () => {
  it('deletion removes all of the user’s data and nobody else’s', async () => {
    const mine = randomUUID();
    const theirs = randomUUID();
    await putRoute(put(`/activities/${mine}`, activity(), alice), ctx(mine));
    await putRoute(put(`/activities/${theirs}`, activity(), bob), ctx(theirs));

    const res = await deleteMe(new Request('http://test/me', { method: 'DELETE', headers: { authorization: `Bearer ${alice}` } }), noCtx);
    expect(res.status).toBe(200);
    expect(await h.prisma.user.findUnique({ where: { id: aliceId } })).toBeNull();
    expect(await h.prisma.activity.count()).toBe(1);
    expect(await h.prisma.activityTrack.count()).toBe(1);
  });
});

describe('cleanup job', () => {
  it('needs the secret', async () => {
    expect((await cleanup(new Request('http://test/cleanup'), noCtx)).status).toBe(401);
  });

  it('removes only old deletion markers', async () => {
    const old = randomUUID();
    const recent = randomUUID();
    const live = randomUUID();
    for (const id of [old, recent, live]) await putRoute(put(`/activities/${id}`, activity(), alice), ctx(id));
    await h.prisma.activity.update({ where: { id: old }, data: { deletedAt: new Date(Date.now() - 91 * 86_400_000) } });
    await h.prisma.activity.update({ where: { id: recent }, data: { deletedAt: new Date() } });

    const res = await cleanup(
      new Request('http://test/cleanup', { headers: { authorization: 'Bearer test-cron-secret' } }),
      noCtx,
    );
    expect(res.status).toBe(200);
    const left = (await h.prisma.activity.findMany()).map((a) => a.id);
    expect(left.sort()).toEqual([recent, live].sort());
  });
});
