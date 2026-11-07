import { PutActivityBody } from '@cardiomen/contracts';
import { requireUser } from '@/auth/tokens';
import { IdParam, ok, readJson, route } from '@/http';
import { putActivity } from '@/sync/service';

type Ctx = { params: Promise<{ id: string }> };

// Everything goes through this one idempotent route: create, edit, delete and restore.
export const PUT = route<Ctx>(async (req, ctx) => {
  const userId = await requireUser(req);
  const id = IdParam.parse((await ctx.params).id);
  return ok(await putActivity(userId, id, await readJson(req, PutActivityBody)));
});
