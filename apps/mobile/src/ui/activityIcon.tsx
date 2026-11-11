import { Canvas, Circle, Group, Line, Path, rect, rrect, Skia, vec } from '@shopify/react-native-skia';
import { memo, useMemo } from 'react';
import { GLYPHS, GlyphType } from './activityGlyphs';

/**
 * A walk, jog or run figure in one colour. The headband and the gap around its knot are cut out
 * of the figure (not painted over it), so they show whatever is behind: works on any background.
 */
export const ActivityGlyph = memo(function ActivityGlyph({
  type,
  size,
  color,
}: {
  type: GlyphType;
  size: number;
  color: string;
}) {
  const g = GLYPHS[type];
  const paths = useMemo(
    () => ({
      limbs: g.limbs.map((d) => Skia.Path.MakeFromSVGString(d)!),
      tails: g.tails.map((d) => Skia.Path.MakeFromSVGString(d)!),
      head: rrect(rect(g.head.cx - g.head.r, g.head.cy - g.head.r, g.head.r * 2, g.head.r * 2), g.head.r, g.head.r),
    }),
    [g],
  );
  return (
    <Canvas style={{ width: size, height: size }} pointerEvents="none">
      <Group transform={[{ scale: size / 48 }]} layer>
        {paths.limbs.map((p, i) => (
          <Path key={`l${i}`} path={p} style="stroke" strokeWidth={3.4} strokeCap="round" strokeJoin="round" color={color} />
        ))}
        {paths.tails.map((p, i) => (
          <Path key={`t${i}`} path={p} style="stroke" strokeWidth={1.9} strokeCap="round" strokeJoin="round" color={color} />
        ))}
        <Circle cx={g.head.cx} cy={g.head.cy} r={g.head.r} color={color} />
        <Group clip={paths.head}>
          <Line p1={vec(g.band[0], g.band[1])} p2={vec(g.band[2], g.band[3])} strokeWidth={1.8} color="black" blendMode="clear" />
        </Group>
        <Circle cx={g.knot.cx} cy={g.knot.cy} r={g.knot.r + 0.9} color="black" blendMode="clear" />
        <Circle cx={g.knot.cx} cy={g.knot.cy} r={g.knot.r} color={color} />
      </Group>
    </Canvas>
  );
});
