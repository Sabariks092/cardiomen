import { PresetBody } from '@cardiomen/contracts';
import { requireUser } from '@/auth/tokens';
import { IdParam, ok, readJson, route } from '@/http';
import { putPreset } from '@/sync/service';

type Ctx = { params: Promise<{ id: string }> };

export const PUT = route<Ctx>(async (req, ctx) => {
  const userId = await requireUser(req);
  const id = IdParam.parse((await ctx.params).id);
  return ok(await putPreset(userId, id, await readJson(req, PresetBody)));
});
