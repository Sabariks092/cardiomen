import { requireUser } from '@/auth/tokens';
import { IdParam, ok, route } from '@/http';
import { getTrack } from '@/sync/service';

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, ctx) => {
  const userId = await requireUser(req);
  return ok(await getTrack(userId, IdParam.parse((await ctx.params).id)));
});
