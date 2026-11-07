import { PutActivityBody } from '@cardiomen/contracts';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PUT as putRoute } from '../app/api/v1/activities/[id]/route';
import { POST as forgot } from '../app/api/v1/auth/forgot-password/route';
import { POST as googleRoute } from '../app/api/v1/auth/google/route';
import { POST as login } from '../app/api/v1/auth/login/route';
import { POST as registerRoute } from '../app/api/v1/auth/register/route';
import { POST as resend } from '../app/api/v1/auth/resend-otp/route';
import { POST as reset } from '../app/api/v1/auth/reset-password/route';
import { POST as verify } from '../app/api/v1/auth/verify-otp/route';
import { DELETE as deleteMe, PATCH as patchMe } from '../app/api/v1/me/route';
import { PUT as putPresetRoute } from '../app/api/v1/presets/[id]/route';
import { GET as changes } from '../app/api/v1/sync/changes/route';
import { setGoogleVerifierForTests } from '@/auth/service';
import { signAccessToken } from '@/auth/tokens';
import { ctx, get, Harness, post, put, startHarness } from './harness';

let h: Harness;
const noCtx = undefined as never;
const VICTIM = 'victim@example.com';
const VICTIM_PASSWORD = 'victim password 123';
const ATTACKER_PASSWORD = 'attacker password 123';

beforeAll(async () => {
  h = await startHarness(54333);
});
afterAll(async () => {
  await h.stop();
});
beforeEach(async () => {
  h.sent.length = 0;
  await h.prisma.user.deleteMany();
  await h.prisma.pendingRegistration.deleteMany();
  await h.prisma.emailOtp.deleteMany();
  await h.prisma.rateLimit.deleteMany();
});

const reg = (password: string, email = VICTIM) => registerRoute(post('/register', { name: 'N', email, password }), noCtx);

/** Moves the newest code past the resend wait, as if a minute had gone by. */
const ageCodes = () =>
  h.prisma.emailOtp.updateMany({ data: { createdAt: new Date(Date.now() - 120_000) } });

describe('account takeover through a pending sign-up', () => {
  it('a refused request changes nothing', async () => {
    await reg(VICTIM_PASSWORD);
    const before = await h.prisma.pendingRegistration.findFirstOrThrow();
    expect((await reg(ATTACKER_PASSWORD)).status).toBe(202);
    const after = await h.prisma.pendingRegistration.findFirstOrThrow();
    expect(after.passwordHash).toBe(before.passwordHash);
  });

  it('the code alone is not enough: it needs the matching password', async () => {
    await reg(VICTIM_PASSWORD);
    const code = h.lastCode();
    const res = await verify(post('/verify', { email: VICTIM, code, password: ATTACKER_PASSWORD }), noCtx);
    expect(res.status).toBe(400);
    expect(await h.prisma.user.count()).toBe(0);
  });

  it("the owner's code can't create an account with a stranger's password", async () => {
    await reg(VICTIM_PASSWORD);
    await ageCodes();
    await reg(ATTACKER_PASSWORD); // Overwrites the pending row, and mails the owner a new code.
    const code = h.lastCode();

    // The owner enters the code they received, with the password they chose.
    await verify(post('/verify', { email: VICTIM, code, password: VICTIM_PASSWORD }), noCtx);

    // Whatever happened, the attacker's password must not open anything.
    expect((await login(post('/login', { email: VICTIM, password: ATTACKER_PASSWORD }), noCtx)).status).toBe(401);
  });
});

describe('guessing codes', () => {
  it('parallel guesses cannot get past the attempt limit', async () => {
    await h.prisma.user.create({
      data: { email: VICTIM, name: 'V', emailVerifiedAt: new Date(), passwordHash: 'x' },
    });
    await forgot(post('/forgot', { email: VICTIM }), noCtx);
    const good = h.lastCode();
    const bad = good === '000000' ? '111111' : '000000';
    const body = (code: string) => post('/reset', { email: VICTIM, code, password: ATTACKER_PASSWORD });

    const responses = await Promise.all([
      ...Array.from({ length: 28 }, () => reset(body(bad), noCtx)),
      reset(body(good), noCtx),
    ]);
    expect(responses[28].status).toBe(400);
    const row = await h.prisma.emailOtp.findFirstOrThrow();
    expect(row.attempts).toBeLessThanOrEqual(5);
  });

  it('limits verify attempts per IP, across different emails', async () => {
    let last = 0;
    for (let i = 0; i < 31; i += 1) {
      last = (await verify(post('/verify', { email: `x${i}@example.com`, code: '123456', password: 'whatever1' }), noCtx)).status;
    }
    expect(last).toBe(429);
  });
});

describe('finding out who has an account', () => {
  it('forgot-password answers the same for known and unknown emails, every time', async () => {
    await h.prisma.user.create({ data: { email: VICTIM, name: 'V', emailVerifiedAt: new Date() } });
    const statuses = async (email: string) => [
      (await forgot(post('/forgot', { email }), noCtx)).status,
      (await forgot(post('/forgot', { email }), noCtx)).status,
    ];
    expect(await statuses(VICTIM)).toEqual(await statuses('nobody@example.com'));
  });

  it('resend answers the same for known and unknown emails', async () => {
    await h.prisma.user.create({ data: { email: VICTIM, name: 'V', emailVerifiedAt: new Date() } });
    const statuses = async (email: string) => [
      (await resend(post('/resend', { email, purpose: 'RESET_PASSWORD' }), noCtx)).status,
      (await resend(post('/resend', { email, purpose: 'RESET_PASSWORD' }), noCtx)).status,
    ];
    expect(await statuses(VICTIM)).toEqual(await statuses('nobody@example.com'));
  });

  it('impatient taps do not use up the hourly email budget', async () => {
    await reg(VICTIM_PASSWORD);
    for (let i = 0; i < 6; i += 1) await resend(post('/resend', { email: VICTIM, purpose: 'REGISTER' }), noCtx);
    expect(h.sent).toHaveLength(1);
    await ageCodes();
    await resend(post('/resend', { email: VICTIM, purpose: 'REGISTER' }), noCtx);
    expect(h.sent).toHaveLength(2);
  });

  it('does not email a code for an expired sign-up', async () => {
    await reg(VICTIM_PASSWORD);
    await ageCodes();
    await h.prisma.pendingRegistration.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    h.sent.length = 0;
    await resend(post('/resend', { email: VICTIM, purpose: 'REGISTER' }), noCtx);
    expect(h.sent).toHaveLength(0);
  });

  it('the IP limit also covers existing accounts', async () => {
    await h.prisma.user.create({ data: { email: VICTIM, name: 'V', emailVerifiedAt: new Date() } });
    let last = 0;
    for (let i = 0; i < 21; i += 1) last = (await reg('some password 1')).status;
    expect(last).toBe(429);
  });
});

describe('Google sign-in', () => {
  it('a different Google account never silently takes over an email', async () => {
    const identity = { email: 'g@example.com', emailVerified: true };
    setGoogleVerifierForTests(async () => ({ ...identity, sub: 'one' }));
    await googleRoute(post('/google', { idToken: 't' }), noCtx);
    setGoogleVerifierForTests(async () => ({ ...identity, sub: 'two' }));
    expect((await googleRoute(post('/google', { idToken: 't' }), noCtx)).status).toBe(409);
    expect((await h.prisma.user.findFirstOrThrow()).googleSub).toBe('one');
  });
});

describe('sync', () => {
  let token: string;
  const blob = Buffer.from('route');
  const body = (o: Partial<PutActivityBody> = {}): PutActivityBody => ({
    type: 'walk',
    title: null,
    note: null,
    startedAt: 1_762_500_000_000,
    endedAt: 1_762_503_600_000,
    tzOffsetMin: 330,
    localDate: '2025-11-07',
    activeMs: 1000,
    elapsedMs: 1000,
    distanceM: 10,
    steps: null,
    previewRoute: [],
    bbox: null,
    engineVersion: 1,
    clientUpdatedAt: 5000,
    deleted: false,
    track: { format: 1, base64: blob.toString('base64'), sha256: createHash('sha256').update(blob).digest('hex') },
    ...o,
  });
  const pull = async (cursor = 0) => (await changes(get(`/sync/changes?cursor=${cursor}`, token), noCtx)).json();
  const send = (id: string, o: Partial<PutActivityBody>) => putRoute(put(`/activities/${id}`, body(o), token), ctx(id));

  beforeEach(async () => {
    const u = await h.prisma.user.create({ data: { email: 's@example.com', name: 'S', emailVerifiedAt: new Date() } });
    token = await signAccessToken(u.id);
  });

  it('an older delete still deletes, and every device hears about it', async () => {
    const id = randomUUID();
    await send(id, {});
    const { cursor } = await pull();
    await send(id, { deleted: true, clientUpdatedAt: 1000 });
    expect((await pull(cursor)).activities[0].deleted).toBe(true);
  });

  it('Undo works: a newer not-deleted restores the activity', async () => {
    const id = randomUUID();
    await send(id, { deleted: true, clientUpdatedAt: 6000 });
    await send(id, { deleted: false, clientUpdatedAt: 7000 });
    expect((await h.prisma.activity.findFirstOrThrow()).deletedAt).toBeNull();
  });

  it('an older edit that lost is sent back, so the device that made it catches up', async () => {
    const id = randomUUID();
    await send(id, { title: 'new', clientUpdatedAt: 9000 });
    const { cursor } = await pull();
    await send(id, { title: 'old', clientUpdatedAt: 2000 });
    const page = await pull(cursor);
    expect(page.activities[0].title).toBe('new');
  });

  it('the deletion date comes from the server clock, not the phone', async () => {
    const id = randomUUID();
    await send(id, { deleted: true, clientUpdatedAt: 1000 }); // A phone with a very wrong clock.
    const row = await h.prisma.activity.findFirstOrThrow();
    expect(Date.now() - row.deletedAt!.getTime()).toBeLessThan(60_000);
  });

  it('never moves the cursor past the last committed change', async () => {
    const id = randomUUID();
    await send(id, {});
    const page = await pull();
    const user = await h.prisma.user.findFirstOrThrow({ where: { email: 's@example.com' } });
    expect(page.cursor).toBeLessThanOrEqual(Number(user.syncSeq));
  });

  it.each([
    ['steps too large', { steps: 3e9 }],
    ['engine version too large', { engineVersion: 3e9 }],
    ['timestamp too large', { startedAt: 9e15 }],
    ['NUL in title', { title: 'a\0b' }],
    ['ends before it starts', { endedAt: 1 }],
    ['a date that does not exist', { localDate: '2025-99-99' }],
    ['impossible coordinates', { previewRoute: [[[9999, 12]]] as PutActivityBody['previewRoute'] }],
    ['an empty route file', { track: { format: 1 as const, base64: '', sha256: '0'.repeat(64) } }],
    ['too many preview points', { previewRoute: [Array.from({ length: 5001 }, (): [number, number] => [77, 12])] }],
  ])('rejects %s with a clear error, not a retried 500', async (_name, overrides) => {
    const id = randomUUID();
    const res = await send(id, overrides);
    expect(res.status).toBe(422);
    expect(await h.prisma.activity.count({ where: { id } })).toBe(0);
  });

  it('rejects a bad ID as invalid, not a server error', async () => {
    expect((await putRoute(put('/activities/nope', body(), token), ctx('nope'))).status).toBe(422);
  });

  it('rejects an oversized preset', async () => {
    const id = randomUUID();
    const res = await putPresetRoute(
      put(`/presets/${id}`, { name: 'P', doc: { x: 'y'.repeat(300_000) }, clientUpdatedAt: 1, deleted: false }, token),
      ctx(id),
    );
    expect(res.status).toBe(422);
  });

  it('after account deletion: requests get 401, and deleting again is harmless', async () => {
    const del = () =>
      deleteMe(new Request('http://t/me', { method: 'DELETE', headers: { authorization: `Bearer ${token}` } }), noCtx);
    expect((await del()).status).toBe(200);
    expect((await del()).status).toBe(200);
    const id = randomUUID();
    expect((await send(id, {})).status).toBe(401);
  });

  it('changing one setting keeps the others', async () => {
    const patch = (settings: object) =>
      patchMe(
        new Request('http://t/me', {
          method: 'PATCH',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ settings }),
        }),
        noCtx,
      );
    await patch({ units: 'mi' });
    const res = await (await patch({ weekStart: 0 })).json();
    expect(res.settings).toEqual({ units: 'mi', weekStart: 0 });
  });
});
