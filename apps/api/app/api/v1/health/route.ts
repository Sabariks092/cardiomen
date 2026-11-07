import { db } from '@/db';
import { ok, route } from '@/http';

export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  await db().$queryRaw`SELECT 1`;
  return ok({ status: 'ok' });
});
