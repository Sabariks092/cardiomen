import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as forgot } from '../app/api/v1/auth/forgot-password/route';
import { POST as googleRoute } from '../app/api/v1/auth/google/route';
import { POST as login } from '../app/api/v1/auth/login/route';
import { POST as logout } from '../app/api/v1/auth/logout/route';
import { POST as refresh } from '../app/api/v1/auth/refresh/route';
import { POST as registerRoute } from '../app/api/v1/auth/register/route';
import { POST as reset } from '../app/api/v1/auth/reset-password/route';
import { POST as verify } from '../app/api/v1/auth/verify-otp/route';
import { GET as me } from '../app/api/v1/me/route';
import { setMailerForTests } from '@/auth/email';
import { setGoogleVerifierForTests } from '@/auth/service';
import { get, Harness, post, startHarness } from './harness';

let h: Harness;
const PASSWORD = 'correct horse battery';

beforeAll(async () => {
  h = await startHarness(54331);
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

const noCtx = undefined as never;

async function registerAndVerify(email = 'a@example.com') {
  await registerRoute(post('/register', { name: 'A', email, password: PASSWORD }), noCtx);
  const res = await verify(post('/verify', { email, code: h.lastCode(), password: PASSWORD }), noCtx);
  expect(res.status).toBe(200);
  return res.json();
}

describe('registration', () => {
  it('creates no user until the code is verified', async () => {
    const res = await registerRoute(post('/register', { name: 'A', email: 'A@Example.com', password: PASSWORD }), noCtx);
    expect(res.status).toBe(202);
    expect(await h.prisma.user.count()).toBe(0);
    expect(h.sent[0].to).toBe('a@example.com');

    const verified = await verify(post('/verify', { email: 'a@example.com', code: h.lastCode(), password: PASSWORD }), noCtx);
    expect(verified.status).toBe(200);
    const body = await verified.json();
    expect(body.user.email).toBe('a@example.com');
    expect(body.accessToken).toBeTruthy();
    expect(await h.prisma.pendingRegistration.count()).toBe(0);
  });

  it('never stores the code in plain text', async () => {
    await registerRoute(post('/register', { name: 'A', email: 'a@example.com', password: PASSWORD }), noCtx);
    const row = await h.prisma.emailOtp.findFirstOrThrow();
    expect(row.codeHash).not.toContain(h.lastCode());
  });

  it('kills a code after 5 wrong attempts, even if the 6th is right', async () => {
    await registerRoute(post('/register', { name: 'A', email: 'a@example.com', password: PASSWORD }), noCtx);
    const good = h.lastCode();
    const bad = good === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i += 1) {
      expect((await verify(post('/verify', { email: 'a@example.com', code: bad, password: PASSWORD }), noCtx)).status).toBe(400);
    }
    expect((await verify(post('/verify', { email: 'a@example.com', code: good, password: PASSWORD }), noCtx)).status).toBe(400);
  });

  it('allows a code only once', async () => {
    await registerRoute(post('/register', { name: 'A', email: 'a@example.com', password: PASSWORD }), noCtx);
    const code = h.lastCode();
    expect((await verify(post('/verify', { email: 'a@example.com', code, password: PASSWORD }), noCtx)).status).toBe(200);
    expect((await verify(post('/verify', { email: 'a@example.com', code, password: PASSWORD }), noCtx)).status).toBe(400);
  });

  it('rejects an expired code', async () => {
    await registerRoute(post('/register', { name: 'A', email: 'a@example.com', password: PASSWORD }), noCtx);
    await h.prisma.emailOtp.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await verify(post('/verify', { email: 'a@example.com', code: h.lastCode(), password: PASSWORD }), noCtx)).status).toBe(400);
  });

  it('does not reveal whether an email already has an account', async () => {
    await registerAndVerify();
    h.sent.length = 0;
    const res = await registerRoute(post('/register', { name: 'B', email: 'a@example.com', password: 'another password' }), noCtx);
    expect(res.status).toBe(202);
    expect(h.sent[0].subject).toContain('already have');
    expect(h.sent[0].text).not.toMatch(/\b\d{6}\b/);
    // The attacker's password must not take effect.
    expect((await login(post('/login', { email: 'a@example.com', password: 'another password' }), noCtx)).status).toBe(401);
  });

  it('quietly ignores a too-fast resend', async () => {
    await registerRoute(post('/register', { name: 'A', email: 'a@example.com', password: PASSWORD }), noCtx);
    const again = await registerRoute(post('/register', { name: 'A', email: 'a@example.com', password: PASSWORD }), noCtx);
    expect(again.status).toBe(202);
    expect(h.sent).toHaveLength(1);
  });

  it('reports an email failure and leaves no usable code behind', async () => {
    setMailerForTests({
      send: async () => {
        throw new Error('smtp down');
      },
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await registerRoute(post('/register', { name: 'A', email: 'a@example.com', password: PASSWORD }), noCtx);
    spy.mockRestore();
    expect(res.status).toBe(503);
    expect(await h.prisma.emailOtp.count({ where: { consumedAt: null } })).toBe(0);
    setMailerForTests({
      async send(to, subject, text) {
        h.sent.push({ to, subject, text });
      },
    });
  });

  it('validates input', async () => {
    expect((await registerRoute(post('/register', { name: '', email: 'nope', password: 'x' }), noCtx)).status).toBe(422);
  });
});

describe('login', () => {
  it('uses the same answer for a wrong password and an unknown email', async () => {
    await registerAndVerify();
    const wrong = await login(post('/login', { email: 'a@example.com', password: 'wrong password' }), noCtx);
    const unknown = await login(post('/login', { email: 'x@example.com', password: 'wrong password' }), noCtx);
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  it('signs in with the right password, and the token works', async () => {
    await registerAndVerify();
    const res = await login(post('/login', { email: 'a@example.com', password: PASSWORD }), noCtx);
    expect(res.status).toBe(200);
    const { accessToken } = await res.json();
    expect((await me(get('/me', accessToken), noCtx)).status).toBe(200);
  });

  it('rate limits repeated attempts', async () => {
    await registerAndVerify();
    let last = 0;
    for (let i = 0; i < 11; i += 1) {
      last = (await login(post('/login', { email: 'a@example.com', password: 'wrong' }), noCtx)).status;
    }
    expect(last).toBe(429);
  });

  it('rejects a bad token', async () => {
    expect((await me(get('/me', 'not-a-token'), noCtx)).status).toBe(401);
  });
});

describe('refresh tokens', () => {
  it('rotates', async () => {
    const first = await registerAndVerify();
    const res = await refresh(post('/refresh', { refreshToken: first.refreshToken }), noCtx);
    expect(res.status).toBe(200);
    const next = await res.json();
    expect(next.refreshToken).not.toBe(first.refreshToken);
    expect((await refresh(post('/refresh', { refreshToken: next.refreshToken }), noCtx)).status).toBe(200);
  });

  it('keeps you signed in if a response was lost, even hours ago', async () => {
    const first = await registerAndVerify();
    await refresh(post('/refresh', { refreshToken: first.refreshToken }), noCtx);
    await h.prisma.refreshToken.updateMany({
      where: { rotatedAt: { not: null } },
      data: { rotatedAt: new Date(Date.now() - 6 * 3_600_000) },
    });
    expect((await refresh(post('/refresh', { refreshToken: first.refreshToken }), noCtx)).status).toBe(200);
  });

  it('treats reuse after the replacement was used as theft, and ends the whole family', async () => {
    const first = await registerAndVerify();
    const next = await (await refresh(post('/refresh', { refreshToken: first.refreshToken }), noCtx)).json();
    const third = await (await refresh(post('/refresh', { refreshToken: next.refreshToken }), noCtx)).json();
    expect((await refresh(post('/refresh', { refreshToken: first.refreshToken }), noCtx)).status).toBe(401);
    expect((await refresh(post('/refresh', { refreshToken: third.refreshToken }), noCtx)).status).toBe(401);
  });

  it('stores only hashes', async () => {
    const first = await registerAndVerify();
    const row = await h.prisma.refreshToken.findFirstOrThrow();
    expect(row.tokenHash).not.toBe(first.refreshToken);
  });

  it('logout revokes', async () => {
    const first = await registerAndVerify();
    await logout(post('/logout', { refreshToken: first.refreshToken }), noCtx);
    expect((await refresh(post('/refresh', { refreshToken: first.refreshToken }), noCtx)).status).toBe(401);
  });
});

describe('forgot password', () => {
  it('resets the password and ends every session', async () => {
    const first = await registerAndVerify();
    await h.prisma.emailOtp.deleteMany();
    await forgot(post('/forgot', { email: 'a@example.com' }), noCtx);
    const res = await reset(post('/reset', { email: 'a@example.com', code: h.lastCode(), password: 'a brand new password' }), noCtx);
    expect(res.status).toBe(200);
    expect((await refresh(post('/refresh', { refreshToken: first.refreshToken }), noCtx)).status).toBe(401);
    expect((await login(post('/login', { email: 'a@example.com', password: PASSWORD }), noCtx)).status).toBe(401);
    expect((await login(post('/login', { email: 'a@example.com', password: 'a brand new password' }), noCtx)).status).toBe(200);
  });

  it('sends nothing for an unknown email, with the same response', async () => {
    const res = await forgot(post('/forgot', { email: 'nobody@example.com' }), noCtx);
    expect(res.status).toBe(202);
    expect(h.sent).toHaveLength(0);
  });
});

describe('Google sign-in', () => {
  const identity = { sub: 'g-1', email: 'g@example.com', emailVerified: true, name: 'G' };

  it('creates a user once, then finds the same user', async () => {
    setGoogleVerifierForTests(async () => identity);
    const one = await (await googleRoute(post('/google', { idToken: 't' }), noCtx)).json();
    const two = await (await googleRoute(post('/google', { idToken: 't' }), noCtx)).json();
    expect(one.user.id).toBe(two.user.id);
    expect(await h.prisma.user.count()).toBe(1);
  });

  it('links to an existing verified account with the same email', async () => {
    const existing = await registerAndVerify('g@example.com');
    setGoogleVerifierForTests(async () => identity);
    const res = await (await googleRoute(post('/google', { idToken: 't' }), noCtx)).json();
    expect(res.user.id).toBe(existing.user.id);
  });

  it('refuses an unverified Google email', async () => {
    setGoogleVerifierForTests(async () => ({ ...identity, emailVerified: false }));
    expect((await googleRoute(post('/google', { idToken: 't' }), noCtx)).status).toBe(401);
  });

  it('a pending sign-up by someone else gives them no way in', async () => {
    await registerRoute(post('/register', { name: 'Attacker', email: 'g@example.com', password: 'attacker password' }), noCtx);
    setGoogleVerifierForTests(async () => identity);
    await googleRoute(post('/google', { idToken: 't' }), noCtx);
    expect((await login(post('/login', { email: 'g@example.com', password: 'attacker password' }), noCtx)).status).toBe(401);
    expect(await h.prisma.pendingRegistration.count()).toBe(0);
  });
});
