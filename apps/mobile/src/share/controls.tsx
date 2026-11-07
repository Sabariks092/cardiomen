import { ReactNode, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { colors, radius, space, T } from '@/ui';

/** The studio is the one place with color: you choose it for your image. */
export const SWATCHES = [
  '#FFFFFF', '#D4D4D4', '#8A8A8A', '#3A3A3A', '#000000',
  '#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#00C7BE',
  '#32ADE6', '#007AFF', '#5856D6', '#AF52DE', '#FF2D55',
  '#F4E8D0', '#0D1420', '#101A12',
];

const HEX = /^#([0-9a-fA-F]{6})$/;

export function ColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (color: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.row}>
        <T v="small" muted style={{ flex: 1 }}>
          {label}
        </T>
        <TextInput
          accessibilityLabel={`${label} hex color`}
          value={draft ?? (value.startsWith('#') ? value : '')}
          placeholder="#FFFFFF"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="characters"
          maxLength={7}
          onChangeText={(t) => {
            setDraft(t);
            if (HEX.test(t)) onChange(t);
          }}
          onBlur={() => setDraft(null)}
          style={styles.hex}
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }} keyboardShouldPersistTaps="handled">
        {SWATCHES.map((c) => (
          <Pressable
            key={c}
            accessibilityRole="button"
            accessibilityLabel={`${label} ${c}`}
            accessibilityState={{ selected: value === c }}
            onPress={() => {
              setDraft(null);
              onChange(c);
            }}
            style={[styles.swatch, { backgroundColor: c }, value === c && styles.swatchOn]}
          />
        ))}
      </ScrollView>
    </View>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const width = useRef(1);
  const update = (x: number) => {
    const fraction = Math.max(0, Math.min(1, x / width.current));
    onChange(min + fraction * (max - min));
  };
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .activeOffsetX([-3, 3])
    .failOffsetY([-14, 14])
    .onBegin((e) => update(e.x))
    .onUpdate((e) => update(e.x));
  const fraction = (value - min) / (max - min);
  return (
    <View style={{ gap: 2 }}>
      <View style={styles.row}>
        <T v="small" muted style={{ flex: 1 }}>
          {label}
        </T>
        <T v="small" faint>
          {format ? format(value) : value.toFixed(0)}
        </T>
      </View>
      <GestureDetector gesture={pan}>
        <View
          accessibilityRole="adjustable"
          accessibilityLabel={label}
          style={styles.sliderHit}
          onLayout={(e) => {
            width.current = Math.max(1, e.nativeEvent.layout.width);
          }}
        >
          <View style={styles.sliderTrack}>
            <View style={[styles.sliderFill, { width: `${fraction * 100}%` }]} />
          </View>
          <View style={[styles.thumb, { left: `${fraction * 100}%` }]} />
        </View>
      </GestureDetector>
    </View>
  );
}

export function Chips<V extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: V; label: string }[];
  value: V | null;
  onChange: (v: V) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }} keyboardShouldPersistTaps="handled">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[styles.chip, on && styles.chipOn]}
          >
            <T v="small" style={on ? { color: colors.black, fontWeight: '600' } : undefined}>
              {o.label}
            </T>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={styles.toggleRow}
    >
      <T v="small" muted style={{ flex: 1 }}>
        {label}
      </T>
      <View style={[styles.toggle, value && styles.toggleOn]}>
        <View style={[styles.knob, value && styles.knobOn]} />
      </View>
    </Pressable>
  );
}

export function Panel({ children }: { children: ReactNode }) {
  return <View style={{ gap: space.md }}>{children}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  hex: {
    minWidth: 96,
    height: 34,
    paddingVertical: 0,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.fieldBg,
    color: colors.text,
    fontSize: 13,
  },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  swatchOn: { borderWidth: 3, borderColor: colors.white },
  sliderHit: { height: 32, justifyContent: 'center' },
  sliderTrack: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)', overflow: 'hidden' },
  sliderFill: { height: 3, backgroundColor: colors.white },
  thumb: {
    position: 'absolute',
    width: 16,
    height: 16,
    marginLeft: -8,
    top: 8,
    borderRadius: 8,
    backgroundColor: colors.white,
  },
  chip: {
    minHeight: 34,
    paddingHorizontal: space.md,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.fieldBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  chipOn: { backgroundColor: colors.white },
  toggleRow: { flexDirection: 'row', alignItems: 'center', minHeight: 36 },
  toggle: {
    width: 40,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.fieldBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    padding: 2,
  },
  toggleOn: { backgroundColor: colors.white },
  knob: { width: 16, height: 16, borderRadius: 8, backgroundColor: colors.textMuted },
  knobOn: { backgroundColor: colors.black, alignSelf: 'flex-end' },
});
