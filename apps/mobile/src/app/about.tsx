import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LOCAL_ONLY } from '@/auth/session';
import { Card, colors, Enter, RoundButton, Screen, space, T } from '@/ui';
import { AppBar } from '@/ui/appbar';

type Section = 'about' | 'privacy' | 'terms';

/**
 * What the app actually does with data, in plain words. It describes the code as it is; the formal
 * privacy policy and terms are documents the publisher supplies.
 */
const PRIVACY: [string, string][] = [
  ['Location', 'Used only while you record an activity, to draw your route and measure distance. Cardigo does not track you in the background when you are not recording.'],
  ['Where your data lives', LOCAL_ONLY
    ? 'This build keeps everything on this phone. Nothing is uploaded.'
    : 'Activities are stored on this phone first, and backed up to your Cardigo account when you are signed in and online.'],
  ['Photos', 'Photos you add to a share image are copied into the app and re-encoded, which removes their location data.'],
  ['Shared images', 'You can hide the first and last 200 m of a route in shared images, so they do not reveal where you start.'],
  ['Steps', 'Counted by the phone’s step sensor during a recording, if you allow physical activity access.'],
  ['Deleting', 'Deleting your account removes your activities from the server and this phone.'],
];

export default function About() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { section = 'about' } = useLocalSearchParams<{ section?: Section }>();
  const version = Constants.expoConfig?.version ?? '—';
  const title = section === 'privacy' ? 'Privacy' : section === 'terms' ? 'Terms and conditions' : 'About Cardigo';

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + space.md, paddingHorizontal: space.lg, paddingBottom: insets.bottom + space.xl, gap: space.md }}>
        <AppBar />
        <Enter style={styles.header}>
          <RoundButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/settings'))}>
            <Ionicons name="chevron-back" size={20} color={colors.ink} />
          </RoundButton>
          <T v="title" style={{ flex: 1 }} numberOfLines={1}>
            {title}
          </T>
        </Enter>

        {section === 'about' ? (
          <Enter i={1}>
            <Card style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.xl }}>
              <Image
                source={require('../../assets/brand/logo.png')}
                accessibilityLabel="Cardigo"
                resizeMode="contain"
                style={{ width: 140, height: 140 }}
              />
              <T v="label" muted>
                Your cardio. Your progress.
              </T>
              <T v="small" muted center style={{ marginTop: space.sm }}>
                Walk, jog and run tracking. Track, analyse, improve. Nothing else.
              </T>
              <T v="small" faint>
                Version {version}
              </T>
            </Card>
          </Enter>
        ) : null}

        {section === 'privacy' ? (
          <>
            {PRIVACY.map(([head, body], i) => (
              <Enter key={head} i={i + 1}>
                <Card style={{ gap: 4 }}>
                  <T v="heading">{head}</T>
                  <T v="small" muted>
                    {body}
                  </T>
                </Card>
              </Enter>
            ))}
            <Notice text="This is a summary of how the app works. The full privacy policy is provided by the app's publisher." />
          </>
        ) : null}

        {section === 'terms' ? (
          <Notice text="The terms and conditions for Cardigo are provided by the app's publisher and are not yet included in this build." />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <View style={styles.notice}>
      <Ionicons name="information-circle-outline" size={18} color={colors.textMuted} />
      <T v="small" muted style={{ flex: 1 }}>
        {text}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  notice: { flexDirection: 'row', gap: space.sm, padding: space.md },
});
