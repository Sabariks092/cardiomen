import { AuthResponse, ErrorBody } from '@cardiomen/contracts';
import {
  API_URL,
  getAccessToken,
  getRefreshToken,
  saveRefreshToken,
  sessionGeneration,
  setAccessToken,
} from './session';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The request never reached a clear answer. Tokens and data are always left untouched. */
export class NetworkError extends Error {}

/** The user signed in or out while this was running. Its result belongs to nobody, so it's dropped. */
export class SessionChangedError extends Error {}

const TIMEOUT_MS = 15_000;

async function raw(path: string, init: RequestInit & { token?: string | null }, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { token, ...rest } = init;
    return await fetch(`${API_URL}/api/v1${path}`, {
      ...rest,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : null),
      },
    });
  } catch (e) {
    throw new NetworkError(e instanceof Error ? e.message : 'Network error');
  } finally {
    clearTimeout(timer);
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON: an edge or gateway error page. Handled below by status.
  }
  if (!res.ok) {
    const body = ErrorBody.safeParse(json);
    throw new ApiError(
      res.status,
      body.success ? body.data.error.code : 'HTTP_ERROR',
      body.success ? body.data.error.message : `Server error (${res.status})`,
    );
  }
  return json as T;
}

let refreshing: { generation: number; promise: Promise<boolean> } | null = null;

/**
 * Only one refresh at a time, shared by all requests. Only an explicit rejection returns false;
 * a network failure throws, so a bad connection can never sign anyone out.
 */
function refreshTokens(): Promise<boolean> {
  const generation = sessionGeneration();
  if (refreshing?.generation === generation) return refreshing.promise;
  const promise = (async () => {
    try {
      const refreshToken = await getRefreshToken();
      if (!refreshToken) return false;
      const res = await raw('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken }) });
      if (generation !== sessionGeneration()) throw new SessionChangedError();
      if (res.status === 401) return false;
      const auth = await parse<AuthResponse>(res);
      if (generation !== sessionGeneration()) throw new SessionChangedError();
      await saveRefreshToken(auth.refreshToken);
      setAccessToken(auth.accessToken);
      return true;
    } finally {
      if (refreshing?.generation === generation) refreshing = null;
    }
  })();
  refreshing = { generation, promise };
  return promise;
}

export type AuthState = 'ok' | 'signed-out';
let authState: AuthState = 'ok';
export const getAuthState = () => authState;

const signedOut = () => {
  authState = 'signed-out';
  return new ApiError(401, 'SIGNED_OUT', 'Sign in again to back up');
};

export async function authed<T>(path: string, init: RequestInit = {}, timeoutMs?: number): Promise<T> {
  const generation = sessionGeneration();
  if (!getAccessToken() && !(await refreshTokens())) throw signedOut();
  let res = await raw(path, { ...init, token: getAccessToken() }, timeoutMs);
  if (generation !== sessionGeneration()) throw new SessionChangedError();
  if (res.status === 401) {
    if (!(await refreshTokens())) throw signedOut();
    res = await raw(path, { ...init, token: getAccessToken() }, timeoutMs);
    if (generation !== sessionGeneration()) throw new SessionChangedError();
  }
  const body = await parse<T>(res);
  authState = 'ok';
  return body;
}

export async function publicPost<T>(path: string, body: unknown): Promise<T> {
  const parsed = await parse<T>(await raw(path, { method: 'POST', body: JSON.stringify(body) }));
  authState = 'ok';
  return parsed;
}

export function friendlyError(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof NetworkError) return 'Could not reach the server. Check your connection and try again.';
  return 'Something went wrong. Please try again.';
}
