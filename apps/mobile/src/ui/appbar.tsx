import Ionicons from '@expo/vector-icons/Ionicons';
import { usePathname, useRouter } from 'expo-router';
import { Image, StyleSheet, View } from 'react-native';
import { currentSession } from '@/auth/session';
import { useLocalQuery } from '@/db';
import { unreadCount } from '@/db/cardigo';
import { useSettings } from '@/db/settings';
import { Avatar, colors, Enter, RoundButton, space, Tap } from './index';

const LOGO = require('../../assets/brand/logo-horizontal.png');

/** The top row on every main screen: logo (back to Home), notifications and profile. */
export function AppBar() {
  const router = useRouter();
  const pathname = usePathname();
  const settings = useSettings();
  const { data: unread } = useLocalQuery(unreadCount, []);
  const session = currentSession();
  const name = settings.profileName || (session && !session.local ? session.user.name : '') || '';

  // Tapping the screen you're already on does nothing, so the stack never fills with copies.
  const go = (path: '/' | '/notifications' | '/profile') => {
    if (pathname === path) return;
    if (path === '/') router.navigate('/(tabs)');
    else router.push(path);
  };

  return (
    <Enter style={styles.bar}>
      <Tap accessibilityRole="button" accessibilityLabel="Cardigo, go to Home" scaleTo={0.95} onPress={() => go('/')}>
        <Image source={LOGO} accessibilityIgnoresInvertColors resizeMode="contain" style={styles.logo} />
      </Tap>
      <View style={{ flex: 1 }} />
      <RoundButton label="Notifications" onPress={() => go('/notifications')}>
        <Ionicons name="notifications-outline" size={20} color={colors.ink} />
        {unread ? <View style={styles.unreadDot} /> : null}
      </RoundButton>
      <Tap accessibilityRole="button" accessibilityLabel="Profile" scaleTo={0.9} onPress={() => go('/profile')}>
        <Avatar name={name || 'You'} uri={settings.avatarUri} size={44} />
      </Tap>
    </Enter>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  logo: { height: 40, width: Math.round((40 * 842) / 300) },
  unreadDot: {
    position: 'absolute',
    top: 10,
    right: 11,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.ink,
    borderWidth: 1.5,
    borderColor: colors.card,
  },
});
