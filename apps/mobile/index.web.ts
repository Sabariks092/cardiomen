import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';
import { loadSession } from '@/auth/session';
import { openUserDb } from '@/db';
import '@/web/alert';

async function start() {
  // Skia reads CanvasKit as soon as it is imported, so it must finish loading before the app does.
  await LoadSkiaWeb({ locateFile: (file) => `/${file}` });
  // Refreshing the browser can land on any screen, so the database can't wait for the start screen to open it.
  const session = await loadSession();
  if (session) await openUserDb(session.user.id);
}

start()
  .catch((e) => console.warn('Web startup failed', e))
  .then(() => require('expo-router/entry'));
