import { NextRequest, NextResponse } from 'next/server';

const DEV_WEB_ORIGIN = 'http://localhost:8081';

/** Lets the local Expo web preview call the API. The native app doesn't need CORS, so production sends none. */
export function proxy(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development' || request.headers.get('origin') !== DEV_WEB_ORIGIN) {
    return NextResponse.next();
  }
  const headers = {
    'Access-Control-Allow-Origin': DEV_WEB_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  };
  if (request.method === 'OPTIONS') return new NextResponse(null, { status: 204, headers });
  return NextResponse.next({ headers });
}

export const config = { matcher: '/api/:path*' };
