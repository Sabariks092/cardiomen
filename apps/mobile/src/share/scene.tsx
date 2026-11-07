import {
  Circle,
  ColorMatrix,
  FontWeight,
  Group,
  Image,
  LinearGradient,
  matchFont,
  Path,
  RadialGradient,
  Rect,
  rect,
  RoundedRect,
  Skia,
  SkFont,
  SkImage,
  BlurMask,
  Text,
  vec,
} from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { Fragment, ReactElement } from 'react';
import { Activity } from '@/db/activities';
import { averagePace, formatActivityDate, formatDistance, formatDuration, formatPace, formatSteps, TYPE_LABEL, Units } from '@/lib/format';
import { Camera, fitCamera, project, toImagePoint, unproject } from '@/lib/mapStyle';
import { bboxOf, LngLat } from '@/lib/track';
import {
  Align,
  canvasHeight,
  CANVAS_W,
  CollageLayer,
  colorMatrix,
  FontKey,
  Frame,
  layoutById,
  MapLayer,
  METRIC_LABEL,
  MetricKey,
  MetricsLayer,
  RouteLayer,
  ShareDoc,
  TextLayer,
} from './doc';

/** Logical map pixels for a full-width layer. Fixed, so the route lines up at every output size. */
export const MAP_BASE_W = 540;

const FONT_STYLE: Record<FontKey, { fontFamily: string; fontWeight?: FontWeight }> = {
  sans: { fontFamily: 'sans-serif' },
  light: { fontFamily: 'sans-serif-light' },
  bold: { fontFamily: 'sans-serif', fontWeight: FontWeight.Bold },
  condensed: { fontFamily: 'sans-serif-condensed' },
  serif: { fontFamily: 'serif' },
  mono: { fontFamily: 'monospace' },
};

function font(key: FontKey, size: number): SkFont {
  return matchFont({ ...FONT_STYLE[key], fontSize: size });
}

function textWidth(f: SkFont, s: string) {
  return f.measureText(s).width;
}

export interface ShareAssets {
  mapImages: Record<string, SkImage | null>;
  photos: Record<string, SkImage | null>;
}

export interface ShareData {
  activity: Activity;
  lines: LngLat[][]; // Already trimmed for privacy, if asked.
  units: Units;
}

function px(frame: Frame, doc: ShareDoc) {
  const h = canvasHeight(doc);
  return { x: frame.x * CANVAS_W, y: frame.y * h, w: frame.w * CANVAS_W, h: frame.h * h };
}

export function mapLogicalSize(frame: Frame, doc: ShareDoc) {
  const box = px(frame, doc);
  const k = MAP_BASE_W / CANVAS_W;
  return { w: Math.max(1, Math.round(box.w * k)), h: Math.max(1, Math.round(box.h * k)) };
}

export function mapCamera(layer: MapLayer, lines: LngLat[][], doc: ShareDoc): Camera | null {
  const box = bboxOf(lines);
  if (!box) return null;
  const size = mapLogicalSize(layer.frame, doc);
  const base = fitCamera(box, size.w, size.h);
  // Pan is stored in logical pixels at the fitted zoom.
  const [cx, cy] = project(base.lng, base.lat, base.zoom);
  const [lng, lat] = unproject(cx + layer.panX, cy + layer.panY, base.zoom);
  return { lng, lat, zoom: base.zoom + layer.zoomDelta };
}

function routePath(lines: LngLat[][], project: (lng: number, lat: number) => [number, number]) {
  const path = Skia.PathBuilder.Make();
  for (const line of lines) {
    line.forEach(([lng, lat], i) => {
      const [x, y] = project(lng, lat);
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    });
  }
  return path.build();
}

function RouteStroke({
  layer,
  lines,
  project,
  box,
}: {
  layer: RouteLayer;
  lines: LngLat[][];
  project: (lng: number, lat: number) => [number, number];
  box: { x: number; y: number; w: number; h: number };
}) {
  const path = routePath(lines, project);
  const first = lines[0]?.[0];
  const lastLine = lines[lines.length - 1];
  const last = lastLine?.[lastLine.length - 1];
  const paintChild = layer.color2 ? (
    <LinearGradient
      start={vec(box.x, box.y)}
      end={vec(box.x + box.w, box.y + box.h)}
      colors={[layer.color, layer.color2]}
    />
  ) : null;
  return (
    <Group opacity={layer.opacity}>
      {layer.halo ? (
        <Path
          path={path}
          style="stroke"
          strokeWidth={layer.width + 8}
          strokeCap="round"
          strokeJoin="round"
          color="rgba(0,0,0,0.4)"
        />
      ) : null}
      {layer.glow > 0 ? (
        <Path
          path={path}
          style="stroke"
          strokeWidth={layer.width * 1.8}
          strokeCap="round"
          strokeJoin="round"
          color={layer.color}
          opacity={0.7}
        >
          <BlurMask blur={layer.glow} style="normal" />
        </Path>
      ) : null}
      <Path path={path} style="stroke" strokeWidth={layer.width} strokeCap="round" strokeJoin="round" color={layer.color}>
        {paintChild}
      </Path>
      {layer.markers && first && last ? (
        <>
          <Circle cx={project(first[0], first[1])[0]} cy={project(first[0], first[1])[1]} r={layer.width * 1.2} color={layer.color} />
          <Circle cx={project(last[0], last[1])[0]} cy={project(last[0], last[1])[1]} r={layer.width * 1.2} color={layer.color2 ?? layer.color} />
          <Circle cx={project(last[0], last[1])[0]} cy={project(last[0], last[1])[1]} r={layer.width * 0.5} color="#000000" />
        </>
      ) : null}
    </Group>
  );
}

function mapProjector(camera: Camera, layer: MapLayer, doc: ShareDoc) {
  const box = px(layer.frame, doc);
  const size = mapLogicalSize(layer.frame, doc);
  const sx = box.w / size.w;
  const sy = box.h / size.h;
  return (lng: number, lat: number): [number, number] => {
    const [x, y] = toImagePoint(lng, lat, camera, size.w, size.h);
    return [box.x + x * sx, box.y + y * sy];
  };
}

function frameProjector(lines: LngLat[][], layer: RouteLayer, doc: ShareDoc) {
  const box = px(layer.frame, doc);
  const bbox = bboxOf(lines);
  if (!bbox) return null;
  const camera = fitCamera(bbox, box.w, box.h, 0.04);
  return (lng: number, lat: number): [number, number] => {
    const [x, y] = toImagePoint(lng, lat, camera, box.w, box.h);
    return [box.x + x, box.y + y];
  };
}

function MapPart({ layer, doc, assets }: { layer: MapLayer; doc: ShareDoc; assets: ShareAssets }) {
  const box = px(layer.frame, doc);
  const image = assets.mapImages[layer.id];
  const clip = Skia.RRectXY(rect(box.x, box.y, box.w, box.h), layer.cornerRadius, layer.cornerRadius);
  return (
    <Group clip={clip}>
      <Group opacity={layer.opacity}>
        {image ? (
          <Image image={image} x={box.x} y={box.y} width={box.w} height={box.h} fit="fill" />
        ) : (
          <Rect x={box.x} y={box.y} width={box.w} height={box.h} color={layer.colors.land} />
        )}
      </Group>
    </Group>
  );
}

function CollagePart({ layer, doc, assets }: { layer: CollageLayer; doc: ShareDoc; assets: ShareAssets }) {
  const box = px(layer.frame, doc);
  const layout = layoutById(layer.layoutId, layer.cells.length);
  return (
    <Group opacity={layer.opacity}>
      {layout.rects.map(([rx, ry, rw, rh], i) => {
        const cell = layer.cells[i];
        if (!cell) return null;
        // A gap only makes sense between photos. On its own, a photo fills the frame edge to edge.
        const gap = layout.rects.length > 1 ? layer.gap : 0;
        const g = gap / 2;
        const x = box.x + rx * box.w + g;
        const y = box.y + ry * box.h + g;
        const w = rw * box.w - gap;
        const h = rh * box.h - gap;
        const image = assets.photos[cell.uri];
        const clip = Skia.RRectXY(rect(x, y, w, h), layer.cornerRadius, layer.cornerRadius);
        if (!image) {
          return <RoundedRect key={i} x={x} y={y} width={w} height={h} r={layer.cornerRadius} color="#1A1A1A" />;
        }
        const base = Math.max(w / image.width(), h / image.height()) * cell.scale;
        const dw = image.width() * base;
        const dh = image.height() * base;
        const dx = x + (w - dw) / 2 + cell.offsetX * w;
        const dy = y + (h - dh) / 2 + cell.offsetY * h;
        const r = Math.hypot(w, h) * 0.65;
        return (
          <Group key={i} clip={clip}>
            <Image image={image} x={dx} y={dy} width={dw} height={dh} fit="fill">
              <ColorMatrix matrix={colorMatrix(cell.filter)} />
            </Image>
            {cell.filter.vignette > 0 ? (
              <Rect x={x} y={y} width={w} height={h}>
                <RadialGradient
                  c={vec(x + w / 2, y + h / 2)}
                  r={r}
                  colors={['rgba(0,0,0,0)', `rgba(0,0,0,${cell.filter.vignette * 0.85})`]}
                  positions={[0.45, 1]}
                />
              </Rect>
            ) : null}
          </Group>
        );
      })}
    </Group>
  );
}

function metricValue(key: MetricKey, data: ShareData): { value: string; unit?: string } {
  const a = data.activity;
  switch (key) {
    case 'distance':
      return { value: formatDistance(a.distanceM, data.units), unit: data.units };
    case 'duration':
      return { value: formatDuration(a.activeMs) };
    case 'pace':
      return { value: formatPace(averagePace(a.activeMs, a.distanceM), data.units), unit: `/${data.units}` };
    case 'steps':
      return { value: formatSteps(a.steps) };
    case 'date':
      return { value: formatActivityDate(a.startedAt, a.tzOffsetMin) };
    case 'type':
      return { value: TYPE_LABEL[a.type] };
    case 'title':
      return { value: a.title || TYPE_LABEL[a.type] };
  }
}

function alignX(align: Align, x: number, w: number, tw: number) {
  if (align === 'center') return x + (w - tw) / 2;
  if (align === 'end') return x + w - tw;
  return x;
}

function MetricsPart({ layer, doc, data }: { layer: MetricsLayer; doc: ShareDoc; data: ShareData }) {
  const box = px(layer.frame, doc);
  const items = layer.items.filter((i) => i.enabled);
  if (items.length === 0) return null;

  const cols = layer.layout === 'row' ? items.length : layer.layout === 'column' ? 1 : Math.min(2, items.length);
  const rows = Math.ceil(items.length / cols);
  const cellW = box.w / cols;
  const cellH = box.h / rows;
  const valueFont = font(layer.font, layer.size);
  const unitFont = font(layer.font, layer.size * 0.42);
  const labelFont = font('sans', Math.max(layer.size * 0.3, 16));

  const shadeTop = Math.max(0, box.y - 160);
  return (
    <Group opacity={layer.opacity}>
      {layer.shade ? (
        <Rect x={0} y={shadeTop} width={CANVAS_W} height={canvasHeight(doc) - shadeTop}>
          <LinearGradient
            start={vec(0, shadeTop)}
            end={vec(0, canvasHeight(doc))}
            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.72)']}
          />
        </Rect>
      ) : null}
      {items.map((item, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = box.x + col * cellW;
        // Rows never overlap, however large the text is compared with the layer's box.
        const rowPitch = Math.max(cellH, layer.size * (layer.showLabels ? 1.8 : 1.25));
        const baseline = box.y + row * rowPitch + layer.size;
        const { value, unit } = metricValue(item.key, data);
        const unitText = unit ? ` ${unit}` : '';
        const valueW = textWidth(valueFont, value);
        const unitW = unit ? textWidth(unitFont, unitText) : 0;
        const startX = alignX(layer.align, x, cellW - 12, valueW + unitW);
        const label = METRIC_LABEL[item.key].toUpperCase();
        const labelX = alignX(layer.align, x, cellW - 12, textWidth(labelFont, label));
        return (
          <Fragment key={item.key}>
            <Text x={startX} y={baseline} text={value} font={valueFont} color={item.color ?? layer.color} />
            {unit ? (
              <Text x={startX + valueW} y={baseline} text={unitText} font={unitFont} color={item.color ?? layer.color} />
            ) : null}
            {layer.showLabels ? (
              <Text x={labelX} y={baseline + layer.size * 0.55} text={label} font={labelFont} color={layer.labelColor} />
            ) : null}
          </Fragment>
        );
      })}
    </Group>
  );
}

function TextPart({ layer, doc }: { layer: TextLayer; doc: ShareDoc }) {
  const box = px(layer.frame, doc);
  const f = font(layer.font, layer.size);
  const lines = layer.text.split('\n');
  return (
    <Group opacity={layer.opacity}>
      {lines.map((line, i) => (
        <Text
          key={i}
          x={alignX(layer.align, box.x, box.w, textWidth(f, line))}
          y={box.y + layer.size * (i + 1) * 1.15}
          text={line}
          font={f}
          color={layer.color}
        />
      ))}
    </Group>
  );
}

function BackgroundPart({ doc }: { doc: ShareDoc }) {
  const h = canvasHeight(doc);
  const bg = doc.background;
  if (bg.kind === 'transparent') return null;
  if (bg.kind === 'solid') return <Rect x={0} y={0} width={CANVAS_W} height={h} color={bg.color} />;
  const rad = (bg.angle * Math.PI) / 180;
  const cx = CANVAS_W / 2;
  const cy = h / 2;
  const reach = Math.hypot(CANVAS_W, h) / 2;
  return (
    <Rect x={0} y={0} width={CANVAS_W} height={h}>
      <LinearGradient
        start={vec(cx - Math.cos(rad) * reach, cy - Math.sin(rad) * reach)}
        end={vec(cx + Math.cos(rad) * reach, cy + Math.sin(rad) * reach)}
        colors={[bg.from, bg.to]}
      />
    </Rect>
  );
}

/** The whole image, in canvas units. Preview and export draw this same tree at different scales. */
export function ShareScene({
  doc,
  assets,
  data,
  scale,
}: {
  doc: ShareDoc;
  assets: ShareAssets;
  data: ShareData;
  scale: number;
}): ReactElement {
  const visibleMap = doc.layers.find((l): l is MapLayer => l.kind === 'map' && l.visible);
  return (
    <Group transform={[{ scale }]}>
      <BackgroundPart doc={doc} />
      {doc.layers.map((layer) => {
        if (!layer.visible) return null;
        switch (layer.kind) {
          case 'map':
            return <MapPart key={layer.id} layer={layer} doc={doc} assets={assets} />;
          case 'route': {
            // With a visible map, the route follows it, so it stays exactly on the roads. Its place
            // in the layer order is still its own, so photos can go between the map and the route.
            if (visibleMap) {
              const camera = mapCamera(visibleMap, data.lines, doc);
              if (!camera) return null;
              const box = px(visibleMap.frame, doc);
              const clip = Skia.RRectXY(rect(box.x, box.y, box.w, box.h), visibleMap.cornerRadius, visibleMap.cornerRadius);
              return (
                <Group key={layer.id} clip={clip}>
                  <RouteStroke layer={layer} lines={data.lines} project={mapProjector(camera, visibleMap, doc)} box={box} />
                </Group>
              );
            }
            const project = frameProjector(data.lines, layer, doc);
            return project ? (
              <RouteStroke key={layer.id} layer={layer} lines={data.lines} project={project} box={px(layer.frame, doc)} />
            ) : null;
          }
          case 'metrics':
            return <MetricsPart key={layer.id} layer={layer} doc={doc} data={data} />;
          case 'collage':
            return <CollagePart key={layer.id} layer={layer} doc={doc} assets={assets} />;
          case 'text':
            return <TextPart key={layer.id} layer={layer} doc={doc} />;
        }
      })}
    </Group>
  );
}

export function SelectionOutline({ frame, doc, scale }: { frame: Frame; doc: ShareDoc; scale: number }) {
  const box = useMemo(() => px(frame, doc), [frame, doc]);
  return (
    <Group transform={[{ scale }]}>
      <Rect
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        style="stroke"
        strokeWidth={2 / scale}
        color="rgba(255,255,255,0.9)"
      />
    </Group>
  );
}
