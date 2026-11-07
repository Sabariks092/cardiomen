import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { db } from '@/db';
import { HttpError, tooMany } from '@/http';
import type { OtpPurpose } from '@/generated/prisma/client';
import { sendOtpEmail } from './email';
import { hitRateLimit } from './rateLimit';

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_RESEND_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const SENDS_PER_EMAIL_PER_HOUR = 5;
const HOUR = 3_600_000;

function hashCode(email: string, purpose: OtpPurpose, code: string) {
  const pepper = process.env.OTP_PEPPER;
  if (!pepper || pepper.length < 32) throw new Error('OTP_PEPPER must be at least 32 characters');
  return createHmac('sha256', pepper).update(`${email}|${purpose}|${code}`).digest('hex');
}

export function generateCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Per-IP limit for public routes that take an email. It's checked before anything else and
 * doesn't depend on the email, so a 429 here can't reveal whether an account exists.
 */
export async function limitEmailRouteByIp(ip: string) {
  if (await hitRateLimit(`otp:ip:${ip}`, 20, HOUR)) throw tooMany();
}

/**
 * Whether another email may go to this address right now. Resend timing is checked first, so
 * impatient taps don't use up the hourly budget. Refusals are silent: answering differently here
 * would reveal which emails have accounts.
 */
export async function reserveOtpSend(email: string, purpose: OtpPurpose): Promise<boolean> {
  const latest = await db().emailOtp.findFirst({
    where: { email, purpose },
    orderBy: { createdAt: 'desc' },
  });
  if (latest && !latest.consumedAt && Date.now() - latest.createdAt.getTime() < OTP_RESEND_MS) return false;
  return !(await hitRateLimit(`otp:email:${email}`, SENDS_PER_EMAIL_PER_HOUR, HOUR));
}

/** Creates a code and emails it. A new code invalidates older ones. Call reserveOtpSend first. */
export async function deliverOtp(email: string, purpose: OtpPurpose) {
  const prisma = db();
  const code = generateCode();
  await prisma.emailOtp.updateMany({
    where: { email, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  const row = await prisma.emailOtp.create({
    data: { email, purpose, codeHash: hashCode(email, purpose, code), expiresAt: new Date(Date.now() + OTP_TTL_MS) },
  });

  try {
    // Awaited on purpose: a serverless function may freeze as soon as it responds.
    await sendOtpEmail(email, code, purpose);
  } catch (e) {
    await prisma.emailOtp.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
    console.error('OTP email failed', e instanceof Error ? e.message : e);
    throw new HttpError(503, 'EMAIL_FAILED', "We couldn't send the code. Please try again in a moment.");
  }
}

const INVALID = () => new HttpError(400, 'INVALID_CODE', 'That code is wrong or has expired.');

/**
 * Valid once only. An attempt is claimed atomically before the code is compared, so guesses sent
 * in parallel can't get past the limit, and two simultaneous correct requests can't both succeed.
 */
export async function consumeOtp(email: string, purpose: OtpPurpose, code: string, ip: string) {
  if (await hitRateLimit(`otp:verify:${ip}`, 30, 900_000)) throw tooMany();

  const prisma = db();
  const row = await prisma.emailOtp.findFirst({
    where: { email, purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!row || row.expiresAt < new Date()) throw INVALID();

  const claimed = await prisma.emailOtp.updateMany({
    where: { id: row.id, consumedAt: null, attempts: { lt: MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (claimed.count !== 1) throw INVALID();

  const expected = Buffer.from(row.codeHash, 'hex');
  const actual = Buffer.from(hashCode(email, purpose, code), 'hex');
  if (!timingSafeEqual(expected, actual)) throw INVALID();

  const consumed = await prisma.emailOtp.updateMany({
    where: { id: row.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (consumed.count !== 1) throw INVALID();
}
