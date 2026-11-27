import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, colors, Enter, RoundButton, Screen, space, T, Tap } from '@/ui';
import { HomePreview } from '@/ui/themePreview';
import { PaletteId, PALETTES, paletteId, setPalette, themed } from '@/ui/theme';

const IDS = Object.keys(PALETTES) as PaletteId[];

export default function Theme() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const active = paletteId();
  const [picked, setPicked] = useState<PaletteId>(active);
  const preview = PALETTES[picked].colors;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + space.md,
          paddingHorizontal: space.lg,
          paddingBottom: insets.bottom + space.xl,
          gap: space.lg,
        }}
      >
        <Enter style={styles.header}>
          <RoundButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}>
            <Ionicons name="chevron-back" size={20} color={colors.ink} />
          </RoundButton>
          <T v="title" style={{ flex: 1 }}>
            Theme
          </T>
        </Enter>

        <Enter i={1}>
          <HomePreview c={preview} />
        </Enter>

        <Enter i={2} style={styles.grid}>
          {IDS.map((id) => {
            const p = PALETTES[id];
            const on = id === picked;
            return (
              <Tap
                key={id}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${p.name}${id === active ? ', current theme' : ''}`}
                scaleTo={0.95}
                onPress={() => setPicked(id)}
                style={[styles.option, on && { borderColor: colors.ink }]}
              >
                <View style={styles.swatches}>
                  {[p.colors.ink, p.colors.inkGradientTop, p.colors.bg].map((c, i) => (
                    <View key={i} style={[styles.swatch, { backgroundColor: c, marginLeft: i ? -8 : 0 }]} />
                  ))}
                </View>
                <T v="small" style={{ fontWeight: on ? '600' : '400' }}>
                  {p.name}
                </T>
                {id === active ? (
                  <T v="small" muted style={{ fontSize: 10 }}>
                    Current
                  </T>
                ) : null}
              </Tap>
            );
          })}
        </Enter>

        <Enter i={3} style={{ gap: space.sm }}>
          <Button
            title={picked === active ? 'This is your current theme' : `Use ${PALETTES[picked].name}`}
            disabled={picked === active}
            // The app redraws in the new colours and opens on Home.
            onPress={() => setPalette(picked)}
          />
          <T v="small" muted style={{ textAlign: 'center' }}>
            The theme is saved on this phone.
          </T>
        </Enter>
      </ScrollView>
    </Screen>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
    option: {
      width: '31.5%',
      alignItems: 'center',
      gap: space.xs,
      paddingVertical: space.md,
      borderRadius: 16,
      borderWidth: 2,
      borderColor: 'transparent',
      backgroundColor: colors.card,
      boxShadow: '0px 4px 12px rgba(0,0,0,0.05)',
    },
    swatches: { flexDirection: 'row' },
    swatch: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.card },
  }),
);
