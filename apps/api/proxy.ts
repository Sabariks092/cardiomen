import { NextRequest, NextResponse } from 'next/server';

/** The Cardigo web app's origin, plus the local Expo web preview in development. */
const WEB_ORIGINS = new Set([
  'https://cardigo-web.vercel.app',
  ...(process.env.NODE_ENV === 'development' ? ['http://localhost:8081'] : []),
]);

/** Lets the Cardigo web app call the API. The native app doesn't need CORS, so other origins get none. */
export function proxy(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (!origin || !WEB_ORIGINS.has(origin)) return NextResponse.next();
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  };
  if (request.method === 'OPTIONS') return new NextResponse(null, { status: 204, headers });
  return NextResponse.next({ headers });
}

export const config = { matcher: '/api/:path*' };
