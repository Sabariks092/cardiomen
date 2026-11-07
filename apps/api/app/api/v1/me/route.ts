import { MAX_SETTINGS_JSON } from '@cardiomen/contracts';
import { z } from 'zod';
import { requireUser, toUserDto } from '@/auth/tokens';
import { db } from '@/db';
import { notFound, ok, readJson, route } from '@/http';
import type { Prisma } from '@/generated/prisma/client';

const PatchMe = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  settings: z
    .record(z.string(), z.unknown())
    .refine((s) => JSON.stringify(s).length <= MAX_SETTINGS_JSON, 'Settings are too large')
    .optional(),
});

export const GET = route(async (req) => {
  const user = await db().user.findUnique({ where: { id: await requireUser(req) } });
  if (!user) throw notFound();
  return ok({ user: toUserDto(user), settings: user.settings });
});

export const PATCH = route(async (req) => {
  const id = await requireUser(req);
  const body = await readJson(req, PatchMe);
  const user = await db().$transaction(async (tx) => {
    const current = await tx.user.findUniqueOrThrow({ where: { id }, select: { settings: true } });
    // Merged, so changing one setting never wipes the others.
    const settings = body.settings
      ? ({ ...(current.settings as Prisma.JsonObject), ...body.settings } as Prisma.InputJsonValue)
      : undefined;
    return tx.user.update({ where: { id }, data: { name: body.name, settings } });
  });
  return ok({ user: toUserDto(user), settings: user.settings });
});

// Cascades to activities, routes, presets and tokens. Repeating it is harmless.
export const DELETE = route(async (req) => {
  await db().user.deleteMany({ where: { id: await requireUser(req) } });
  return ok();
});
