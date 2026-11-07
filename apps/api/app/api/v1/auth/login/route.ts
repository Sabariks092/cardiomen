import { LoginBody } from '@cardiomen/contracts';
import { login } from '@/auth/service';
import { clientIp, ok, readJson, route } from '@/http';

export const POST = route(async (req) => ok(await login(await readJson(req, LoginBody), clientIp(req))));
