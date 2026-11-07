import { VerifyOtpBody } from '@cardiomen/contracts';
import { verifyRegistration } from '@/auth/service';
import { clientIp, ok, readJson, route } from '@/http';

export const POST = route(async (req) =>
  ok(await verifyRegistration(await readJson(req, VerifyOtpBody), clientIp(req))),
);
