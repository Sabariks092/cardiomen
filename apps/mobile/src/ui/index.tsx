import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { ReactNode, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  PressableProps,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  interpolate,
  SlideInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActivityGlyph } from './activityIcon';
import { colors, fontFor, fonts, radius, shadow, space, spring, type } from './theme';

export { colors, fontFor, fonts, radius, shadow, space, spring, type } from './theme';

export type IconName = keyof typeof Ionicons.glyphMap;

export function Screen({ children, style }: { children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

/** Black-to-dark-grey fill for primary buttons, the selected tab and anything else that is ink. */
export function InkGloss({ r }: { r: number }) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: r, overflow: 'hidden' }]}>
      <LinearGradient colors={[colors.inkGradientTop, colors.inkSoft]} style={StyleSheet.absoluteFill} />
      <LinearGradient
        colors={['rgba(255,255,255,0.16)', 'rgba(255,255,255,0)']}
        end={{ x: 0, y: 0.55 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

/** A white card with a soft shadow. `overMap` makes it a touch translucent for map overlays. */
export function Card({
  children,
  style,
  overMap,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  overMap?: boolean;
}) {
  return <View style={[styles.card, overMap && styles.cardOverMap, style]}>{children}</View>;
}

/** Older name for Card, kept so existing screens keep working. */
export const Glass = Card;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** A pressable that sinks a little under the finger and springs back. */
export function Tap({
  children,
  style,
  scaleTo = 0.97,
  haptic,
  onPressIn,
  onPressOut,
  onPress,
  ...props
}: Omit<PressableProps, 'style'> & {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
  haptic?: boolean;
}) {
  const pressed = useSharedValue(0);
  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(pressed.value, [0, 1], [1, scaleTo]) }],
    opacity: interpolate(pressed.value, [0, 1], [1, 0.9]),
  }));
  return (
    <AnimatedPressable
      {...props}
      onPressIn={(e) => {
        pressed.value = withSpring(1, spring);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        pressed.value = withSpring(0, spring);
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (haptic) Haptics.selectionAsync().catch(() => undefined);
        onPress?.(e);
      }}
      style={[style, animated]}
    >
      {children}
    </AnimatedPressable>
  );
}

/** Rises and fades in once, when it first appears. `i` staggers items in a list or a screen. */
export function Enter({ i = 0, children, style }: { i?: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <Animated.View entering={FadeInDown.delay(Math.min(i, 8) * 50).duration(380)} style={style}>
      {children}
    </Animated.View>
  );
}

/** A dot that breathes, only for something live (a recording in progress). */
export function Pulse({ size = 9, color = colors.ink }: { size?: number; color?: string }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(withSequence(withTiming(1, { duration: 900 }), withTiming(0, { duration: 900 })), -1);
  }, [t]);
  const ring = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 1], [0.35, 0]),
    transform: [{ scale: interpolate(t.value, [0, 1], [1, 2.6]) }],
  }));
  return (
    <View style={{ width: size, height: size }}>
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: size / 2, backgroundColor: color }, ring]} />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  );
}

/** Round white button for an icon: headers, map overlays. */
export function RoundButton({
  children,
  onPress,
  label,
  style,
  disabled,
}: {
  children: ReactNode;
  onPress: () => void;
  label: string;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
}) {
  return (
    <Tap
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      scaleTo={0.9}
      hitSlop={6}
      style={[styles.round, disabled && { opacity: 0.4 }, style]}
    >
      {children}
    </Tap>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  size = 20,
  style,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <RoundButton label={label} onPress={onPress} style={style}>
      <Ionicons name={icon} size={size} color={colors.ink} />
    </RoundButton>
  );
}

type TextVariant = keyof typeof type;

/**
 * All text. Android can't fake weights for a custom font, so a `fontWeight` in the style is turned
 * into the matching Poppins file.
 */
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
  const flat = StyleSheet.flatten(style) ?? {};
  const { fontWeight, ...rest } = flat;
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        { color: faint ? colors.textFaint : muted ? colors.textMuted : colors.text },
        type[v] as TextStyle,
        center && { textAlign: 'center' },
        rest,
        fontWeight ? { fontFamily: fontFor(fontWeight) } : null,
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
    <Tap
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!inactive }}
      disabled={inactive}
      haptic
      onPress={onPress}
      style={[
        styles.button,
        primary && styles.buttonPrimary,
        kind === 'glass' && styles.buttonSecondary,
        inactive && { opacity: 0.45 },
        style,
      ]}
    >
      {primary ? <InkGloss r={radius.pill} /> : null}
      {loading ? (
        <ActivityIndicator color={primary ? colors.paper : colors.ink} />
      ) : (
        <>
          {icon}
          <Text style={[styles.buttonText, { color: primary ? colors.paper : colors.ink }]}>{title}</Text>
        </>
      )}
    </Tap>
  );
}

/** A labelled text input. Password fields get an eye button that shows or hides what was typed. */
export function Field({
  label,
  error,
  secureTextEntry,
  ...props
}: TextInputProps & { label: string; error?: string | null }) {
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  return (
    <View style={{ gap: space.xs }}>
      <T v="label" muted>
        {label}
      </T>
      <View>
        <TextInput
          placeholderTextColor={colors.textFaint}
          selectionColor={colors.ink}
          cursorColor={colors.ink}
          accessibilityLabel={label}
          {...props}
          secureTextEntry={secureTextEntry && !revealed}
          onFocus={(e) => {
            setFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            props.onBlur?.(e);
          }}
          style={[styles.field, focused && styles.fieldFocused, secureTextEntry && styles.fieldWithEye, props.style]}
        />
        {secureTextEntry ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            hitSlop={8}
            onPress={() => setRevealed((r) => !r)}
            style={styles.eye}
          >
            <Ionicons name={revealed ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {error ? <T v="small">{error}</T> : null}
    </View>
  );
}

/** A pill control whose black selection slides between options. */
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
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const segW = width > 0 ? (width - 8) / options.length : 0;
  const x = useSharedValue(0);
  useEffect(() => {
    x.value = withSpring(index * segW, spring);
  }, [index, segW, x]);
  const indicator = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View style={[styles.segmented, style]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {segW > 0 ? (
        <Animated.View pointerEvents="none" style={[styles.segmentIndicator, { width: segW }, indicator]}>
          <InkGloss r={radius.pill} />
        </Animated.View>
      ) : null}
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => {
              if (!selected) Haptics.selectionAsync().catch(() => undefined);
              onChange(o.value);
            }}
            style={styles.segment}
          >
            <Text numberOfLines={1} style={[styles.segmentText, selected && { color: colors.paper }]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Small horizontally scrolling filter pills. */
export function Pills<V extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: V; label: string }[];
  value: V | null;
  onChange: (value: V) => void;
}) {
  return (
    <View style={styles.pills}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Tap
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            scaleTo={0.94}
            onPress={() => {
              if (!on) Haptics.selectionAsync().catch(() => undefined);
              onChange(o.value);
            }}
            style={[styles.pill, on && styles.pillOn]}
          >
            {on ? <InkGloss r={radius.pill} /> : null}
            <T v="small" style={{ color: on ? colors.paper : colors.text, fontWeight: '500' }}>
              {o.label}
            </T>
          </Tap>
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
      <T v={large ? 'metric' : 'stat'} numberOfLines={1} style={{ fontWeight: '300' }}>
        {value}
        {unit ? <T v="small" muted>{` ${unit}`}</T> : null}
      </T>
      <T v="label" muted>
        {label}
      </T>
    </View>
  );
}

/** One number in a white tile: an icon, the value and what it is. */
export function MetricCard({
  icon,
  label,
  value,
  unit,
  style,
}: {
  icon?: IconName;
  label: string;
  value: string;
  unit?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Card style={[styles.metricCard, style]}>
      {icon ? (
        <View style={styles.metricIcon}>
          <Ionicons name={icon} size={16} color={colors.ink} />
        </View>
      ) : null}
      <T v="stat" numberOfLines={1} style={{ fontWeight: '300' }}>
        {value}
        {unit ? <T v="small" muted>{` ${unit}`}</T> : null}
      </T>
      <T v="small" muted numberOfLines={1}>
        {label}
      </T>
    </Card>
  );
}

export function SectionHeader({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.sectionHeader}>
      <T v="heading" style={{ flex: 1 }}>
        {title}
      </T>
      {action && onAction ? (
        <Tap accessibilityRole="button" hitSlop={10} onPress={onAction}>
          <T v="small" style={{ fontWeight: '600' }}>
            {action}
          </T>
        </Tap>
      ) : null}
    </View>
  );
}

/** A card holding a chart, with a title and an optional right-hand control. */
export function ChartCard({
  title,
  subtitle,
  right,
  children,
  style,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Card style={[{ gap: space.md }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <T v="heading">{title}</T>
          {subtitle ? (
            <T v="small" muted>
              {subtitle}
            </T>
          ) : null}
        </View>
        {right}
      </View>
      {children}
    </Card>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

export function EmptyState({
  icon = 'footsteps-outline',
  title,
  body,
  action,
  onAction,
}: {
  icon?: IconName;
  title: string;
  body?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <Animated.View entering={FadeIn.duration(300)} style={styles.state}>
      <View style={styles.stateIcon}>
        <Ionicons name={icon} size={26} color={colors.ink} />
      </View>
      <T v="heading" center>
        {title}
      </T>
      {body ? (
        <T v="small" muted center style={{ maxWidth: 280 }}>
          {body}
        </T>
      ) : null}
      {action && onAction ? <Button title={action} onPress={onAction} style={{ marginTop: space.sm, minHeight: 44 }} /> : null}
    </Animated.View>
  );
}

export function LoadingState({ label }: { label?: string }) {
  return (
    <View style={styles.state}>
      <ActivityIndicator color={colors.ink} />
      {label ? (
        <T v="small" muted>
          {label}
        </T>
      ) : null}
    </View>
  );
}

export function ErrorState({ title, body, onRetry }: { title: string; body?: string; onRetry?: () => void }) {
  return (
    <EmptyState
      icon="alert-circle-outline"
      title={title}
      body={body}
      action={onRetry ? 'Try again' : undefined}
      onAction={onRetry}
    />
  );
}

/** A bottom sheet over a dimmed screen. Closes on the scrim, the handle or Android back. */
export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.sheetScrim}>
        <Pressable accessibilityLabel="Close" style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View
          entering={SlideInDown.springify().damping(20)}
          style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}
        >
          <View style={styles.grabber} />
          {title ? (
            <T v="heading" style={{ paddingHorizontal: space.xs, marginBottom: space.xs }}>
              {title}
            </T>
          ) : null}
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

/** The activity's figure in a round badge. Inverted (black) marks the selected or primary one. */
export function ActivityBadge({
  type,
  size = 40,
  inverted,
}: {
  type: 'walk' | 'jog' | 'run';
  size?: number;
  inverted?: boolean;
}) {
  return (
    <View
      style={[
        styles.badge,
        { width: size, height: size, borderRadius: size / 2 },
        inverted ? { boxShadow: shadow.button } : { backgroundColor: colors.inactive },
      ]}
    >
      {inverted ? <InkGloss r={size / 2} /> : null}
      <ActivityGlyph type={type} size={size * 0.68} color={inverted ? colors.paper : colors.ink} />
    </View>
  );
}

export function Avatar({ name, uri, size = 40 }: { name: string; uri?: string | null; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      {uri ? (
        <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} resizeMode="cover" />
      ) : (
        <>
          <InkGloss r={size / 2} />
          <Text style={{ color: colors.paper, fontFamily: fonts.semibold, fontSize: size * 0.36 }}>{initials || '·'}</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  card: {
    borderRadius: radius.lg,
    padding: space.lg,
    backgroundColor: colors.card,
    boxShadow: shadow.card,
  },
  cardOverMap: { backgroundColor: colors.glassOverMap, boxShadow: shadow.raised },
  round: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: shadow.card,
  },
  button: {
    minHeight: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: space.xl,
  },
  buttonPrimary: { backgroundColor: colors.inkSoft, boxShadow: shadow.button },
  buttonSecondary: { backgroundColor: colors.card, boxShadow: shadow.card },
  buttonText: { fontSize: 14, fontFamily: fonts.semibold, letterSpacing: -0.1 },
  field: {
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.fieldBg,
    borderWidth: 1,
    borderColor: 'transparent',
    color: colors.text,
    paddingHorizontal: space.lg,
    fontSize: 15,
    fontFamily: fonts.regular,
  },
  fieldFocused: { borderColor: colors.ink, backgroundColor: colors.card },
  fieldWithEye: { paddingRight: 52 },
  eye: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 52, alignItems: 'center', justifyContent: 'center' },
  segmented: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    boxShadow: shadow.card,
  },
  segmentIndicator: {
    position: 'absolute',
    left: 4,
    top: 4,
    bottom: 4,
    borderRadius: radius.pill,
    boxShadow: '0px 4px 10px rgba(0,0,0,0.18)',
  },
  segment: {
    flex: 1,
    minHeight: 36,
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentText: { color: colors.textMuted, fontSize: 12, fontFamily: fonts.medium },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  pill: {
    minHeight: 34,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    justifyContent: 'center',
    backgroundColor: colors.card,
    boxShadow: shadow.card,
  },
  pillOn: { boxShadow: shadow.button },
  metricCard: { flex: 1, gap: 2, padding: space.md },
  metricIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.inactive,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginTop: space.sm },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.divider },
  state: { alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingVertical: space.xxl, paddingHorizontal: space.lg },
  stateIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: shadow.card,
    marginBottom: space.xs,
  },
  sheetScrim: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: space.lg,
    gap: space.sm,
    boxShadow: '0px -10px 40px rgba(0,0,0,0.12)',
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#D6D6D6',
    marginBottom: space.sm,
  },
  badge: { alignItems: 'center', justifyContent: 'center' },
  avatar: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.inactive, overflow: 'hidden' },
});
