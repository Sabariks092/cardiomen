import TrackingEngine from '@engine';
import { Href, Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { loadSession } from '@/auth/session';
import { openUserDb } from '@/db';
import { requestSync } from '@/sync/worker';
import { importFinished } from '@/tracking/importer';
import { colors } from '@/ui';

/**
 * An unfinished recording is checked first, before login. A recording is never hidden behind a
 * sign-in screen, and an expired login or no internet never blocks the app.
 */
export default function Gate() {
  const [target, setTarget] = useState<Href | null>(null);

  useEffect(() => {
    (async () => {
      const [snapshot, session] = await Promise.all([TrackingEngine.getSnapshot(), loadSession()]);
      if (session) {
        try {
          await openUserDb(session.user.id);
          importFinished()
            .then(requestSync)
            .catch((e) => console.warn('Import failed', e));
        } catch (e) {
          // A problem here must not take the user away from a recording in progress.
          console.warn('Could not open the database', e);
        }
      }
      if (snapshot.state === 'ACTIVE' || snapshot.state === 'PAUSED') {
        setTarget('/track');
      } else {
        setTarget(session ? '/(tabs)' : '/welcome');
      }
    })().catch((e) => {
      console.warn('Startup failed', e);
      setTarget('/welcome');
    });
  }, []);

  if (target) return <Redirect href={target} />;
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={colors.ink} />
    </View>
  );
}
