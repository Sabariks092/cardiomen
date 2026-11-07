import { timingSafeEqual } from 'node:crypto';
import { db } from '@/db';
import { ok, route, unauthorized } from '@/http';

const TOMBSTONE_MS = 90 * 24 * 60 * 60 * 1000;

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('authorization');
  if (!secret || !given) return false;
  const a = Buffer.from(`Bearer ${secret}`);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Called daily by Vercel Cron.
export const GET = route(async (req) => {
  if (!authorized(req)) throw unauthorized();
  const prisma = db();
  const now = new Date();
  const tombstoneCutoff = new Date(now.getTime() - TOMBSTONE_MS);
  await prisma.emailOtp.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.pendingRegistration.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.rateLimit.deleteMany({ where: { resetAt: { lt: now } } });
  await prisma.activity.deleteMany({ where: { deletedAt: { lt: tombstoneCutoff } } });
  await prisma.sharePreset.deleteMany({ where: { deletedAt: { lt: tombstoneCutoff } } });
  return ok();
});
