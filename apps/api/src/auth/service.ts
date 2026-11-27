import { OAuth2Client } from 'google-auth-library';
import { db } from '@/db';
import { HttpError, tooMany, unauthorized } from '@/http';
import { assertDeliverable } from './deliverable';
import { consumeOtp, deliverOtp, limitEmailRouteByIp, OTP_TTL_MS, reserveOtpSend, tooManyCodes } from './otp';
import { hashPassword, verifyPassword } from './password';
import { hitRateLimit } from './rateLimit';
import { issueSession, revokeAllForUser } from './tokens';

const INVALID_CODE = () => new HttpError(400, 'INVALID_CODE', 'That code is wrong or has expired.');
const emailNotFound = () =>
  new HttpError(404, 'EMAIL_NOT_FOUND', 'No account uses this email. Check it for typos, or create an account.');

export async function register(input: { name: string; email: string; password: string }, ip: string) {
  // The IP limit comes first: a refused request must not change anything or cost a password hash.
  await limitEmailRouteByIp(ip);
  const prisma = db();
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new HttpError(
      409,
      'EMAIL_TAKEN',
      existing.passwordHash
        ? 'An account with this email already exists. Sign in instead.'
        : 'This email is already registered with Google. Use Continue with Google to sign in.',
    );
  }
  await assertDeliverable(input.email);

  const reserved = await reserveOtpSend(input.email, 'REGISTER');
  if (reserved === 'limit') throw tooManyCodes();
  // A code went out under a minute ago. Change nothing: otherwise a stranger could swap in their
  // own password just after the real owner signed up.
  if (reserved === 'wait') return;
  const passwordHash = await hashPassword(input.password);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS * 6);
  await prisma.pendingRegistration.upsert({
    where: { email: input.email },
    create: { email: input.email, name: input.name, passwordHash, expiresAt },
    update: { name: input.name, passwordHash, expiresAt },
  });
  await deliverOtp(input.email, 'REGISTER');
}

/**
 * The password is checked again here. Anyone can start a sign-up for any email, so without this a
 * stranger's pending password could become the account's password when the real owner enters
 * their code. Only the person who knows both the password and the emailed code gets an account.
 */
export async function verifyRegistration(
  input: { email: string; code: string; password: string; deviceName?: string },
  ip: string,
) {
  const prisma = db();
  await consumeOtp(input.email, 'REGISTER', input.code, ip);
  const pending = await prisma.pendingRegistration.findUnique({ where: { email: input.email } });
  if (!pending || pending.expiresAt < new Date()) throw INVALID_CODE();
  if (!(await verifyPassword(pending.passwordHash, input.password))) throw INVALID_CODE();

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: pending.email,
        name: pending.name,
        passwordHash: pending.passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    await tx.pendingRegistration.delete({ where: { email: pending.email } });
    return created;
  });
  return issueSession(user, input.deviceName);
}

export async function resendOtp(email: string, purpose: 'REGISTER' | 'RESET_PASSWORD', ip: string) {
  await limitEmailRouteByIp(ip);
  const prisma = db();
  const eligible =
    purpose === 'REGISTER'
      ? await prisma.pendingRegistration.findFirst({ where: { email, expiresAt: { gt: new Date() } } })
      : await prisma.user.findUnique({ where: { email } });
  if (!eligible) {
    throw purpose === 'REGISTER'
      ? new HttpError(410, 'SIGNUP_EXPIRED', 'This sign-up has expired. Please start again.')
      : emailNotFound();
  }
  const reserved = await reserveOtpSend(email, purpose);
  if (reserved === 'limit') throw tooManyCodes();
  if (reserved === 'wait') {
    throw new HttpError(429, 'RESEND_TOO_SOON', 'A code was sent less than a minute ago. Please wait before asking again.');
  }
  await deliverOtp(email, purpose);
}

export async function login(input: { email: string; password: string; deviceName?: string }, ip: string) {
  if (await hitRateLimit(`login:${input.email}:${ip}`, 10, 900_000)) throw tooMany();
  const user = await db().user.findUnique({ where: { email: input.email } });
  const valid = await verifyPassword(user?.passwordHash, input.password);
  if (!user || !valid) throw new HttpError(401, 'BAD_CREDENTIALS', 'Wrong email or password.');
  return issueSession(user, input.deviceName);
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

let verifier: (idToken: string) => Promise<GoogleIdentity> = async (idToken) => {
  const audience = process.env.GOOGLE_WEB_CLIENT_ID;
  if (!audience) throw new Error('GOOGLE_WEB_CLIENT_ID is not set');
  const client = new OAuth2Client();
  let payload;
  try {
    // Checks signature, audience, issuer and expiry.
    const ticket = await client.verifyIdToken({ idToken, audience });
    payload = ticket.getPayload();
  } catch {
    throw unauthorized('Google sign-in could not be verified.');
  }
  if (!payload?.sub || !payload.email) throw unauthorized('Google sign-in could not be verified.');
  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    emailVerified: payload.email_verified === true,
    name: payload.name,
    // Google sends a 96px thumbnail; the size suffix can ask for a sharper one.
    picture: payload.picture?.replace(/=s\d+-c$/, '=s400-c'),
  };
};

/** For tests only. */
export function setGoogleVerifierForTests(fn: typeof verifier) {
  verifier = fn;
}

export async function signInWithGoogle(input: { idToken: string; deviceName?: string }, ip: string) {
  if (await hitRateLimit(`google:${ip}`, 30, 900_000)) throw tooMany();
  const prisma = db();
  const g = await verifier(input.idToken);
  if (!g.emailVerified) throw unauthorized('Your Google email is not verified.');

  let user = await prisma.user.findUnique({ where: { googleSub: g.sub } });
  if (!user) {
    const byEmail = await prisma.user.findUnique({ where: { email: g.email } });
    if (byEmail?.googleSub) {
      // A different Google account now holds this address. Never swap the login silently.
      throw new HttpError(409, 'ACCOUNT_MISMATCH', 'This email is linked to a different Google account.');
    }
    if (byEmail) {
      user = await prisma.user.update({
        where: { id: byEmail.id },
        data: { googleSub: g.sub, avatarUrl: byEmail.avatarUrl ?? g.picture },
      });
    } else {
      user = await prisma.user.create({
        data: {
          email: g.email,
          name: g.name ?? g.email.split('@')[0],
          avatarUrl: g.picture,
          googleSub: g.sub,
          emailVerifiedAt: new Date(),
        },
      });
      await prisma.pendingRegistration.deleteMany({ where: { email: g.email } });
    }
  }
  return issueSession(user, input.deviceName);
}

export async function forgotPassword(email: string, ip: string) {
  await limitEmailRouteByIp(ip);
  const user = await db().user.findUnique({ where: { email } });
  if (!user) throw emailNotFound();
  const reserved = await reserveOtpSend(email, 'RESET_PASSWORD');
  if (reserved === 'limit') throw tooManyCodes();
  // 'wait': the code sent under a minute ago is still valid, so the person carries on with it.
  if (reserved === 'send') await deliverOtp(email, 'RESET_PASSWORD');
}

export async function resetPassword(input: { email: string; code: string; password: string }, ip: string) {
  const prisma = db();
  await consumeOtp(input.email, 'RESET_PASSWORD', input.code, ip);
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) throw INVALID_CODE();
  const passwordHash = await hashPassword(input.password);
  // Together, so a stolen session can't survive the password it was stolen with.
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
    await revokeAllForUser(user.id, tx);
  });
}
