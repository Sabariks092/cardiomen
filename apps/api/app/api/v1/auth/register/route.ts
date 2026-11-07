import { RegisterBody } from '@cardiomen/contracts';
import { register } from '@/auth/service';
import { clientIp, ok, readJson, route } from '@/http';

export const POST = route(async (req) => {
  await register(await readJson(req, RegisterBody), clientIp(req));
  return ok({ ok: true }, 202);
});
