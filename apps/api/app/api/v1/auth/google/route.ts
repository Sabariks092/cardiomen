import { GoogleBody } from '@cardiomen/contracts';
import { signInWithGoogle } from '@/auth/service';
import { clientIp, ok, readJson, route } from '@/http';

export const POST = route(async (req) => ok(await signInWithGoogle(await readJson(req, GoogleBody), clientIp(req))));
