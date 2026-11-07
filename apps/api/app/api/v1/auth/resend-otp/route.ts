import { ResendOtpBody } from '@cardiomen/contracts';
import { resendOtp } from '@/auth/service';
import { clientIp, ok, readJson, route } from '@/http';

export const POST = route(async (req) => {
  const { email, purpose } = await readJson(req, ResendOtpBody);
  await resendOtp(email, purpose, clientIp(req));
  return ok({ ok: true }, 202);
});
