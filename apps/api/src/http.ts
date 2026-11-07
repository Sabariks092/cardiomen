import { NextResponse } from 'next/server';
import { z, ZodError, ZodType } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code = 'BAD_REQUEST') => new HttpError(400, code, message);
export const unauthorized = (message = 'Please sign in again.') => new HttpError(401, 'UNAUTHORIZED', message);
export const notFound = () => new HttpError(404, 'NOT_FOUND', 'Not found.');
export const tooMany = () => new HttpError(429, 'RATE_LIMITED', 'Too many attempts. Please wait and try again.');

export async function readJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest('Request body must be JSON.');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new HttpError(422, 'VALIDATION', `${first?.path.join('.') || 'body'}: ${first?.message}`);
  }
  return parsed.data;
}

/** Every route goes through this. Internal errors never leak details to the client. */
export function route<Ctx = unknown>(handler: (req: Request, ctx: Ctx) => Promise<Response>) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    try {
      return await handler(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) {
        return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status });
      }
      if (e instanceof ZodError) {
        return NextResponse.json({ error: { code: 'VALIDATION', message: 'Invalid request.' } }, { status: 422 });
      }
      // The account no longer exists, e.g. a request sent just after it was deleted.
      if ((e as { code?: string }).code === 'P2025') {
        return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Please sign in again.' } }, { status: 401 });
      }
      // Two users creating the same client-generated ID at once. Retrying can't help.
      if ((e as { code?: string }).code === 'P2002') {
        return NextResponse.json({ error: { code: 'CONFLICT', message: 'This ID cannot be used.' } }, { status: 409 });
      }
      // Name and code only: database messages can contain request data such as coordinates.
      const { name, code } = e as { name?: string; code?: string };
      console.error(`${req.method} ${new URL(req.url).pathname} failed`, name, code ?? '');
      return NextResponse.json(
        { error: { code: 'INTERNAL', message: 'Something went wrong on our side.' } },
        { status: 500 },
      );
    }
  };
}

export const ok = (body: unknown = { ok: true }, status = 200) => NextResponse.json(body, { status });

export function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

export const IdParam = z.string().uuid();
