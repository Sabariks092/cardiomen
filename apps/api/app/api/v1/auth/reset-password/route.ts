import { ResetPasswordBody } from '@cardiomen/contracts';
import { resetPassword } from '@/auth/service';
import { clientIp, ok, readJson, route } from '@/http';

export const POST = route(async (req) => {
  await resetPassword(await readJson(req, ResetPasswordBody), clientIp(req));
  return ok();
});
