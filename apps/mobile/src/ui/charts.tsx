import { Canvas, Circle, Path, Skia } from '@shopify/react-native-skia';
import { ReactNode, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { colors, radius, space, T } from './index';

const BAR_MOVE = LinearTransition.springify().damping(16);

export interface ChartDatum {
  key: string;
  label: string;
  value: number;
}

/** Monochrome bars. Tap a bar to read its value. */
export function BarChart({
  data,
  format,
  height = 130,
}: {
  data: ChartDatum[];
  format: (v: number) => string;
  height?: number;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const max = Math.max(0, ...data.map((d) => d.value));
  const shown = data.find((d) => d.key === picked);
  return (
    <View style={{ gap: space.sm }}>
      <View style={[styles.bars, { height }]}>
        {data.map((d) => {
          const on = picked === d.key;
          return (
            <Pressable
              key={d.key}
              accessibilityRole="button"
              accessibilityLabel={`${d.label || d.key}: ${format(d.value)}`}
              onPress={() => setPicked(on ? null : d.key)}
              style={styles.column}
            >
              <View style={styles.track}>
                <Animated.View
                  layout={BAR_MOVE}
                  style={[
                    styles.bar,
                    {
                      height: max > 0 ? `${Math.max((d.value / max) * 100, d.value > 0 ? 3 : 0)}%` : 0,
                      backgroundColor: !picked || on ? colors.ink : '#BDBDBD',
                    },
                  ]}
                />
              </View>
              <T v="small" muted numberOfLines={1} style={{ fontSize: 9 }}>
                {d.label || ' '}
              </T>
            </Pressable>
          );
        })}
      </View>
      <T v="small" muted>
        {shown ? `${shown.key}: ${format(shown.value)}` : `Peak ${format(max)}. Tap a bar for its value.`}
      </T>
    </View>
  );
}

/**
 * A line through the values that exist. Gaps (null) are skipped, never drawn as zero.
 * `lowerIsBetter` flips the axis, so for pace an improvement still goes up.
 */
export function LineChart({
  values,
  labels,
  format,
  lowerIsBetter,
  height = 120,
}: {
  values: (number | null)[];
  labels: string[];
  format: (v: number) => string;
  lowerIsBetter?: boolean;
  height?: number;
}) {
  const [width, setWidth] = useState(0);
  const present = values.filter((v): v is number => v != null);
  const min = Math.min(...present);
  const max = Math.max(...present);
  const pad = 10;
  const pts = useMemo(() => {
    if (!width || present.length === 0) return [];
    const span = max - min || 1;
    const step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
    return values.map((v, i) => {
      if (v == null) return null;
      const t = (v - min) / span;
      const y = lowerIsBetter ? pad + t * (height - pad * 2) : height - pad - t * (height - pad * 2);
      return { x: pad + i * step, y: present.length === 1 ? height / 2 : y };
    });
  }, [width, values, min, max, height, lowerIsBetter, present.length]);
  const path = useMemo(() => {
    const p = Skia.PathBuilder.Make();
    let started = false;
    for (const pt of pts) {
      if (!pt) continue;
      if (!started) {
        p.moveTo(pt.x, pt.y);
        started = true;
      } else p.lineTo(pt.x, pt.y);
    }
    return p.build();
  }, [pts]);

  if (present.length === 0) {
    return (
      <View style={[styles.empty, { height }]}>
        <T v="small" muted center>
          Not enough distance yet for a pace trend. Activities of 1 km or more count.
        </T>
      </View>
    );
  }
  const first = labels[0];
  const last = labels[labels.length - 1];
  return (
    <View style={{ gap: space.xs }}>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height }}>
        {width > 0 ? (
          <Canvas style={{ width, height }}>
            <Path path={path} style="stroke" strokeWidth={2.5} strokeJoin="round" strokeCap="round" color={colors.ink} />
            {pts.map((pt, i) => (pt ? <Circle key={i} cx={pt.x} cy={pt.y} r={3.5} color={colors.ink} /> : null))}
          </Canvas>
        ) : null}
      </View>
      <View style={styles.axis}>
        <T v="small" muted style={{ fontSize: 9 }}>
          {first}
        </T>
        <T v="small" muted style={{ fontSize: 9 }}>
          {last}
        </T>
      </View>
      <T v="small" muted>
        {lowerIsBetter ? 'Best' : 'High'} {format(lowerIsBetter ? min : max)} · {lowerIsBetter ? 'slowest' : 'low'}{' '}
        {format(lowerIsBetter ? max : min)}
      </T>
    </View>
  );
}

const SHADES = [colors.ink, '#7A7A7A', '#C9C9C9'];

/** One bar split into shares, with a legend. */
export function ShareBar({ parts }: { parts: { label: string; value: number; detail: string; icon?: ReactNode }[] }) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  return (
    <View style={{ gap: space.md }}>
      <View style={styles.shareTrack}>
        {total > 0
          ? parts.map((p, i) =>
              p.value > 0 ? (
                <Animated.View key={p.label} layout={BAR_MOVE} style={{ flex: p.value, backgroundColor: SHADES[i % SHADES.length] }} />
              ) : null,
            )
          : null}
      </View>
      {parts.map((p, i) => (
        <View key={p.label} style={styles.legendRow}>
          <View style={[styles.swatch, { backgroundColor: SHADES[i % SHADES.length] }]} />
          {p.icon}
          <T v="small" style={{ flex: 1 }}>
            {p.label}
          </T>
          <T v="small" muted>
            {p.detail}
          </T>
          <T v="small" style={{ width: 44, textAlign: 'right', fontWeight: '600' }}>
            {total > 0 ? `${Math.round((p.value / total) * 100)}%` : '0%'}
          </T>
        </View>
      ))}
    </View>
  );
}

/** Active days in each week as a column of seven dots. */
export function ConsistencyGrid({ weeks }: { weeks: { from: string; activeDays: number }[] }) {
  return (
    <View style={styles.grid}>
      {weeks.map((w) => (
        <View key={w.from} style={styles.gridCol} accessibilityLabel={`Week of ${w.from}: ${w.activeDays} active days`}>
          {Array.from({ length: 7 }, (_, d) => (
            <View key={d} style={[styles.dot, 6 - d < w.activeDays && styles.dotOn]} />
          ))}
          <T v="small" muted style={{ fontSize: 9 }}>
            {w.activeDays}
          </T>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bars: { flexDirection: 'row', gap: 3 },
  column: { flex: 1, alignItems: 'center', gap: 4 },
  track: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 5 },
  empty: { alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.bg, padding: space.md },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
  shareTrack: { flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', backgroundColor: colors.inactive },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  grid: { flexDirection: 'row', justifyContent: 'space-between' },
  gridCol: { alignItems: 'center', gap: 3 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.inactive },
  dotOn: { backgroundColor: colors.ink },
});
