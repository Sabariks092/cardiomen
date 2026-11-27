import { GoogleSignin, isErrorWithCode, statusCodes } from '@react-native-google-signin/google-signin';
import type { AuthResponse } from '@cardiomen/contracts';
import { publicPost } from '@/auth/api';
import { startSession } from '@/auth/session';
import { loadSettings, saveSetting } from '@/db/settings';

/** The person closed Google's account chooser. Not an error worth showing. */
export class GoogleCancelled extends Error {}

/** Problems on Google's side, before our server is involved. */
export class GoogleError extends Error {}

const MESSAGES: Record<string, string> = {
  [statusCodes.PLAY_SERVICES_NOT_AVAILABLE]: 'Google Play services are missing or out of date on this device.',
  [statusCodes.IN_PROGRESS]: 'Google sign-in is already open.',
};

/**
 * Signs in with Google and starts the session. Throws GoogleCancelled if the chooser was closed,
 * GoogleError for Google-side problems, and ApiError/NetworkError when our server says no.
 */
export async function signInWithGoogle(): Promise<void> {
  let idToken: string;
  try {
    GoogleSignin.configure({ webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID });
    await GoogleSignin.hasPlayServices();
    // Google remembers the last account and would sign straight back into it. Forgetting it here
    // means the account chooser opens every time, so people can switch accounts.
    if (GoogleSignin.hasPreviousSignIn()) await GoogleSignin.signOut().catch(() => undefined);
    const result = await GoogleSignin.signIn();
    if (result.type !== 'success') throw new GoogleCancelled();
    if (!result.data.idToken) throw new GoogleError('Google did not return a sign-in token. Please try again.');
    idToken = result.data.idToken;
  } catch (e) {
    if (e instanceof GoogleCancelled || e instanceof GoogleError) throw e;
    if (isErrorWithCode(e)) {
      if (e.code === statusCodes.SIGN_IN_CANCELLED) throw new GoogleCancelled();
      throw new GoogleError(MESSAGES[e.code] ?? `Google sign-in failed (${e.code}). Please try again.`);
    }
    throw e;
  }

  const auth = await publicPost<AuthResponse>('/auth/google', { idToken });
  await startSession(auth);
  await applyGooglePhotoOnce(auth.user.avatarUrl);
}

/**
 * The Google profile picture becomes the profile photo the first time this account signs in with
 * Google on this phone. Only once, so a photo the person removed or replaced stays that way.
 */
async function applyGooglePhotoOnce(avatarUrl: string | null) {
  try {
    const settings = await loadSettings();
    if (settings.googlePhotoApplied) return;
    if (avatarUrl && !settings.avatarUri) await saveSetting('avatarUri', avatarUrl);
    await saveSetting('googlePhotoApplied', true);
  } catch (e) {
    console.warn('Could not apply the Google photo', e);
  }
}

/** Signs Google out too, so the next Google sign-in asks which account to use. */
export async function forgetGoogleAccount() {
  try {
    if (GoogleSignin.hasPreviousSignIn()) await GoogleSignin.signOut();
  } catch {
    // Web builds, or Google already signed out.
  }
}
