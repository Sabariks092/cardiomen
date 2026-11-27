import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';
import { ActivityGlyph } from './activityIcon';
import { Colors, fonts, inkRamp, radius, shadow, space } from './theme';

/**
 * A small copy of the Home screen drawn with the given palette, not the live one, so a palette can
 * be previewed before it's applied. Static: nothing in it responds to touch.
 */
export function HomePreview({ c }: { c: Colors }) {
  const ramp = inkRamp(c);
  const text = (size: number, family: string, color = c.text) => ({ fontSize: size, fontFamily: family, color });

  const Ink = ({ r }: { r: number }) => (
    <LinearGradient colors={[c.inkGradientTop, c.inkSoft]} style={[StyleSheet.absoluteFill, { borderRadius: r }]} />
  );

  return (
    <View
      accessible
      accessibilityLabel="Preview of the Home screen in this theme"
      style={[styles.phone, { backgroundColor: c.bg, borderColor: c.hairline }]}
    >
      {/* App bar */}
      <View style={styles.row}>
        <Text style={text(15, fonts.bold, c.ink)}>Cardigo</Text>
        <View style={{ flex: 1 }} />
        <View style={[styles.iconDot, { backgroundColor: c.card }]}>
          <Ionicons name="notifications-outline" size={12} color={c.ink} />
        </View>
        <View style={[styles.iconDot, { overflow: 'hidden' }]}>
          <Ink r={11} />
          <Text style={text(9, fonts.semibold, c.paper)}>A</Text>
        </View>
      </View>

      <View>
        <Text style={[text(7, fonts.medium, c.textMuted), { letterSpacing: 1 }]}>FRIDAY, 27 NOV</Text>
        <Text style={text(16, fonts.bold)}>Good morning</Text>
      </View>

      {/* Start card */}
      <View style={[styles.card, { backgroundColor: c.card }]}>
        <View style={styles.row}>
          {(['walk', 'jog', 'run'] as const).map((type, i) => (
            <View key={type} style={{ flex: 1, alignItems: 'center', gap: 3 }}>
              <View style={[styles.badge, { backgroundColor: i === 0 ? undefined : c.inactive, overflow: 'hidden' }]}>
                {i === 0 ? <Ink r={13} /> : null}
                <ActivityGlyph type={type} size={18} color={i === 0 ? c.paper : c.ink} />
              </View>
              <Text style={text(7, i === 0 ? fonts.semibold : fonts.regular, i === 0 ? c.text : c.textMuted)}>
                {['Walk', 'Jog', 'Run'][i]}
              </Text>
            </View>
          ))}
        </View>
        <View style={[styles.button, { overflow: 'hidden' }]}>
          <Ink r={radius.pill} />
          <Ionicons name="play" size={10} color={c.paper} />
          <Text style={text(9, fonts.semibold, c.paper)}>Start walk</Text>
        </View>
      </View>

      {/* Today */}
      <View style={styles.row}>
        {[
          ['Distance', '3.42', 'km'],
          ['Time', '41:08', ''],
        ].map(([label, value, unit]) => (
          <View key={label} style={[styles.card, styles.metric, { backgroundColor: c.card }]}>
            <Text style={[text(6, fonts.medium, c.textMuted), { letterSpacing: 0.8 }]}>{label.toUpperCase()}</Text>
            <Text style={text(14, fonts.light)}>
              {value}
              <Text style={text(7, fonts.regular, c.textMuted)}> {unit}</Text>
            </Text>
          </View>
        ))}
      </View>

      {/* Activity heatmap */}
      <View style={[styles.card, { backgroundColor: c.card, gap: 3 }]}>
        {[0, 1, 2].map((row) => (
          <View key={row} style={{ flexDirection: 'row', gap: 3 }}>
            {Array.from({ length: 12 }, (_, i) => (
              <View key={i} style={[styles.cell, { backgroundColor: ramp[(i * 7 + row * 3) % 5] }]} />
            ))}
          </View>
        ))}
      </View>

      {/* Tab bar */}
      <View style={[styles.tabs, { backgroundColor: c.card }]}>
        {(['home', 'list-outline', 'stats-chart-outline', 'settings-outline'] as const).map((icon, i) => (
          <View key={icon} style={[styles.tab, i === 0 && { overflow: 'hidden' }]}>
            {i === 0 ? <Ink r={radius.pill} /> : null}
            <Ionicons name={icon} size={11} color={i === 0 ? c.paper : c.textMuted} />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  phone: {
    width: 200,
    alignSelf: 'center',
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: space.md,
    gap: space.sm,
    boxShadow: shadow.raised,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  iconDot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: radius.md, padding: space.sm, gap: space.sm, boxShadow: shadow.card },
  badge: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  button: {
    height: 24,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  metric: { flex: 1, gap: 2 },
  cell: { flex: 1, aspectRatio: 1, borderRadius: 2 },
  tabs: { flexDirection: 'row', borderRadius: radius.pill, padding: 3, gap: 3, boxShadow: shadow.card },
  tab: { flex: 1, height: 20, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
