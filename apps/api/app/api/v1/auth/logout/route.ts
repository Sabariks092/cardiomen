import { RefreshBody } from '@cardiomen/contracts';
import { revokeFamilyOf } from '@/auth/tokens';
import { ok, readJson, route } from '@/http';

export const POST = route(async (req) => {
  const { refreshToken } = await readJson(req, RefreshBody);
  await revokeFamilyOf(refreshToken);
  return ok();
});
