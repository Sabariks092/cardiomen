import { requireUser } from '@/auth/tokens';
import { badRequest, ok, route } from '@/http';
import { getChanges } from '@/sync/service';

export const GET = route(async (req) => {
  const userId = await requireUser(req);
  const params = new URL(req.url).searchParams;
  const cursor = Number(params.get('cursor') ?? '0');
  const limit = Math.min(Number(params.get('limit') ?? '100'), 200);
  if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isSafeInteger(limit) || limit < 1) {
    throw badRequest('Bad cursor or limit.');
  }
  return ok(await getChanges(userId, cursor, limit));
});
