import type { AuthResponse, UserDto } from '@cardiomen/contracts';
import * as SecureStore from 'expo-secure-store';
import { closeUserDb, openUserDb } from '@/db';

// User and token live in one value, so a crash can never pair one account's user with another's token.
const KEY_SESSION = 'auth.session';

export const API_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') ?? '';

/**
 * Until a backend URL is configured, the app runs fully on this device. It uses a fixed local
 * profile and never tries to sync.
 */
export const LOCAL_ONLY = API_URL === '';

const LOCAL_USER: UserDto = {
  id: '00000000-0000-7000-8000-000000000000',
  email: '',
  name: 'Local profile',
  avatarUrl: null,
  hasPassword: false,
};

export interface Session {
  user: UserDto;
  local: boolean;
}

interface Stored {
  user: UserDto;
  refreshToken: string | null;
}

let session: Session | null = null;
let accessToken: string | null = null;
let generation = 0;

/** Changes on every sign-in and sign-out, so work begun for one account can tell it's out of date. */
export function sessionGeneration() {
  return generation;
}

export function currentSession() {
  return session;
}

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token: string | null) {
  accessToken = token;
}

async function readStored(): Promise<Stored | null> {
  const raw = await SecureStore.getItemAsync(KEY_SESSION);
  return raw ? (JSON.parse(raw) as Stored) : null;
}

export async function getRefreshToken() {
  return (await readStored())?.refreshToken ?? null;
}

/** The new token is stored before the old one is forgotten, so a crash here can't sign you out. */
export async function saveRefreshToken(token: string) {
  const stored = await readStored();
  if (!stored) return;
  await SecureStore.setItemAsync(KEY_SESSION, JSON.stringify({ ...stored, refreshToken: token }));
}

export async function loadSession(): Promise<Session | null> {
  if (session) return session;
  const stored = await readStored();
  if (!stored) return null;
  // The profile must match this build's mode. A local profile can't sync, and an account can't
  // work without a server, so a mismatch goes back to the welcome screen.
  const isLocal = stored.user.id === LOCAL_USER.id;
  if (isLocal !== LOCAL_ONLY || (!isLocal && !stored.refreshToken)) return null;
  session = { user: stored.user, local: isLocal };
  return session;
}

export async function startLocalSession(): Promise<Session> {
  await SecureStore.setItemAsync(KEY_SESSION, JSON.stringify({ user: LOCAL_USER, refreshToken: null }));
  generation += 1;
  session = { user: LOCAL_USER, local: true };
  await openUserDb(LOCAL_USER.id);
  return session;
}

export async function startSession(auth: AuthResponse): Promise<Session> {
  await SecureStore.setItemAsync(KEY_SESSION, JSON.stringify({ user: auth.user, refreshToken: auth.refreshToken }));
  generation += 1;
  accessToken = auth.accessToken;
  session = { user: auth.user, local: false };
  await openUserDb(auth.user.id);
  return session;
}

export async function endSession() {
  await SecureStore.deleteItemAsync(KEY_SESSION);
  generation += 1;
  accessToken = null;
  session = null;
  closeUserDb();
}
