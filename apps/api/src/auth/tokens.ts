import { UserDto } from '@cardiomen/contracts';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { db } from '@/db';
import { unauthorized } from '@/http';
import type { Prisma, User } from '@/generated/prisma/client';

const ACCESS_TTL = '15m';
const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function secret() {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
  return new TextEncoder().encode(value);
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function signAccessToken(userId: string) {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TTL)
    .setIssuer('cardiomen')
    .sign(secret());
}

/** Returns the verified user ID. All data access is filtered by this, never by client input. */
export async function requireUser(req: Request): Promise<string> {
  const header = req.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  try {
    const { payload } = await jwtVerify(header.slice(7), secret(), { issuer: 'cardiomen', algorithms: ['HS256'] });
    if (!payload.sub) throw unauthorized();
    return payload.sub;
  } catch {
    throw unauthorized();
  }
}

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    hasPassword: user.passwordHash != null,
  };
}

async function newRefreshToken(userId: string, familyId: string, deviceName?: string | null) {
  const token = randomBytes(32).toString('base64url');
  await db().refreshToken.create({
    data: {
      userId,
      familyId,
      deviceName,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    },
  });
  return token;
}

export async function issueSession(user: User, deviceName?: string) {
  return {
    accessToken: await signAccessToken(user.id),
    refreshToken: await newRefreshToken(user.id, randomUUID(), deviceName),
    user: toUserDto(user),
  };
}

export async function rotateRefreshToken(token: string) {
  const prisma = db();
  const tokenHash = hashToken(token);
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });
  if (!existing || existing.revokedAt || existing.expiresAt < new Date()) throw unauthorized();

  if (existing.rotatedAt) {
    // A retired token is fine if its replacement was never used: the phone lost the response, maybe
    // hours ago. If the replacement has been used, two parties hold this family: end it.
    const successorUsed = await prisma.refreshToken.count({
      where: { familyId: existing.familyId, createdAt: { gt: existing.createdAt }, rotatedAt: { not: null } },
    });
    if (successorUsed > 0) {
      await prisma.refreshToken.updateMany({
        where: { familyId: existing.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw unauthorized();
    }
  } else {
    await prisma.refreshToken.update({ where: { id: existing.id }, data: { rotatedAt: new Date() } });
  }

  const refreshToken = await newRefreshToken(existing.userId, existing.familyId, existing.deviceName);
  // A sign-out or password reset may have run during this. If so, the new token dies with the family.
  const revoked = await prisma.refreshToken.count({ where: { familyId: existing.familyId, revokedAt: { not: null } } });
  if (revoked > 0) {
    await prisma.refreshToken.updateMany({ where: { familyId: existing.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    throw unauthorized();
  }
  return {
    accessToken: await signAccessToken(existing.userId),
    refreshToken,
    user: toUserDto(existing.user),
  };
}

export async function revokeAllForUser(userId: string, client: Pick<Prisma.TransactionClient, 'refreshToken'> = db()) {
  await client.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function revokeFamilyOf(token: string) {
  const prisma = db();
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!existing) return;
  await prisma.refreshToken.updateMany({
    where: { familyId: existing.familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
