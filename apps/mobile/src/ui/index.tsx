import { Canvas, Circle, RadialGradient, vec } from '@shopify/react-native-skia';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  useWindowDimensions,
  View,
  ViewStyle,
} from 'react-native';
import { colors, radius, space, type } from './theme';

export { colors, radius, space, type } from './theme';

/** Black background with two soft white glows, so glass cards have something to sit over. */
export function Backdrop() {
  const { width, height } = useWindowDimensions();
  const r1 = width * 0.9;
  const r2 = width * 0.8;
  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Circle cx={width * 0.9} cy={height * 0.06} r={r1}>
        <RadialGradient
          c={vec(width * 0.9, height * 0.06)}
          r={r1}
          colors={['rgba(255,255,255,0.15)', 'rgba(255,255,255,0)']}
        />
      </Circle>
      <Circle cx={width * 0.05} cy={height * 0.72} r={r2}>
        <RadialGradient
          c={vec(width * 0.05, height * 0.72)}
          r={r2}
          colors={['rgba(255,255,255,0.09)', 'rgba(255,255,255,0)']}
        />
      </Circle>
    </Canvas>
  );
}

export function Screen({ children, style }: { children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.screen, style]}>
      <Backdrop />
      {children}
    </View>
  );
}

export function Glass({
  children,
  style,
  overMap,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  overMap?: boolean;
}) {
  return (
    <View style={[styles.glass, overMap && styles.glassOverMap, style]}>
      {!overMap && (
        <LinearGradient
          colors={[colors.glassTop, colors.glassBottom]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      )}
      {children}
    </View>
  );
}

type TextVariant = keyof typeof type;

export function T({
  v = 'body',
  muted,
  faint,
  center,
  style,
  children,
  numberOfLines,
}: {
  v?: TextVariant;
  muted?: boolean;
  faint?: boolean;
  center?: boolean;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  numberOfLines?: number;
}) {
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        { color: faint ? colors.textFaint : muted ? colors.textMuted : colors.text },
        type[v] as TextStyle,
        center && { textAlign: 'center' },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function Button({
  title,
  onPress,
  kind = 'primary',
  loading,
  disabled,
  style,
  icon,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'glass' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  icon?: ReactNode;
}) {
  const primary = kind === 'primary';
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!inactive }}
      disabled={inactive}
      onPress={() => {
        Haptics.selectionAsync().catch(() => undefined);
        onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        primary && styles.buttonPrimary,
        kind === 'glass' && styles.buttonGlass,
        (pressed || inactive) && { opacity: 0.6 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={primary ? colors.black : colors.white} />
      ) : (
        <>
          {icon}
          <Text style={[styles.buttonText, { color: primary ? colors.black : colors.white }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  error,
  ...props
}: TextInputProps & { label: string; error?: string | null }) {
  return (
    <View style={{ gap: space.xs }}>
      <T v="label" muted>
        {label}
      </T>
      <TextInput
        placeholderTextColor={colors.textFaint}
        selectionColor={colors.white}
        cursorColor={colors.white}
        accessibilityLabel={label}
        {...props}
        style={[styles.field, props.style]}
      />
      {error ? <T v="small">{error}</T> : null}
    </View>
  );
}

export function Segmented<V extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: readonly { value: V; label: string }[];
  value: V;
  onChange: (value: V) => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.segmented, style]}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, selected && styles.segmentOn]}
          >
            <Text numberOfLines={1} style={[styles.segmentText, selected && { color: colors.black }]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Stat({
  label,
  value,
  unit,
  large,
}: {
  label: string;
  value: string;
  unit?: string;
  large?: boolean;
}) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <T v={large ? 'title' : 'stat'} numberOfLines={1}>
        {value}
        {unit ? <T v="small" muted>{` ${unit}`}</T> : null}
      </T>
      <T v="label" faint>
        {label}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  glass: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    overflow: 'hidden',
    padding: space.lg,
  },
  glassOverMap: { backgroundColor: colors.glassOverMap },
  button: {
    minHeight: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: space.xl,
  },
  buttonPrimary: { backgroundColor: colors.white },
  buttonGlass: {
    backgroundColor: colors.fieldBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  buttonText: { fontSize: 15, fontWeight: '600' },
  field: {
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.fieldBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    color: colors.text,
    paddingHorizontal: space.lg,
    fontSize: 16,
  },
  segmented: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.fieldBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  segment: {
    flex: 1,
    minHeight: 34,
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentOn: { backgroundColor: colors.white },
  segmentText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
});
