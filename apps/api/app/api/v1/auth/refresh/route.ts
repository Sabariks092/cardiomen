import { RefreshBody } from '@cardiomen/contracts';
import { rotateRefreshToken } from '@/auth/tokens';
import { ok, readJson, route } from '@/http';

export const POST = route(async (req) => {
  const { refreshToken } = await readJson(req, RefreshBody);
  return ok(await rotateRefreshToken(refreshToken));
});
