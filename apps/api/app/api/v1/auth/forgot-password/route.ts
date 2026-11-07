import { ForgotPasswordBody } from '@cardiomen/contracts';
import { forgotPassword } from '@/auth/service';
import { clientIp, ok, readJson, route } from '@/http';

export const POST = route(async (req) => {
  const { email } = await readJson(req, ForgotPasswordBody);
  await forgotPassword(email, clientIp(req));
  return ok({ ok: true }, 202);
});
