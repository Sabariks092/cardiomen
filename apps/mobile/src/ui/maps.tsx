import { Camera, CameraRef, GeoJSONSource, Layer, Map, MapProps } from '@maplibre/maplibre-react-native';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import { buildMapStyle, project } from '@/lib/mapStyle';
import { bboxOf, LngLat, routeGeoJSON } from '@/lib/track';
import { colors } from './theme';

const DARK_STYLE = buildMapStyle() as unknown as MapProps['mapStyle'];

const ROUTE_LINE = {
  'line-color': colors.white,
  'line-width': 4,
  'line-cap': 'round',
  'line-join': 'round',
} as const;

/** Full map that follows the position while recording. It's decoration: tracking never needs it. */
export function LiveMap({
  lines,
  position,
  follow,
  onUserGesture,
}: {
  lines: LngLat[][];
  position: LngLat | null;
  follow: boolean;
  onUserGesture?: () => void;
}) {
  const camera = useRef<CameraRef>(null);
  const initial = useRef(position);
  // A camera move made before the map has loaded is lost, so the first jump waits for it.
  const [mapReady, setMapReady] = useState(false);
  const [placed, setPlaced] = useState(false);
  const route = useMemo(() => routeGeoJSON(lines), [lines]);
  const dot = useMemo<GeoJSON.Feature<GeoJSON.Point> | null>(
    () =>
      position
        ? { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: position } }
        : null,
    [position],
  );

  useEffect(() => {
    if (!position || !follow || !mapReady) return;
    if (!placed) {
      camera.current?.jumpTo({ center: position, zoom: 16 });
      setPlaced(true);
    } else {
      camera.current?.easeTo({ center: position, duration: 700 });
    }
  }, [position, follow, placed, mapReady]);

  return (
    <Map
      style={{ flex: 1, backgroundColor: colors.bg }}
      mapStyle={DARK_STYLE}
      logo={false}
      attribution
      attributionPosition={{ top: 56, right: 8 }}
      compass={false}
      touchRotate={false}
      touchPitch={false}
      onDidFinishLoadingMap={() => setMapReady(true)}
      onRegionWillChange={(e) => {
        if (e.nativeEvent.userInteraction) onUserGesture?.();
      }}
    >
      <Camera
        ref={camera}
        initialViewState={
          initial.current ? { center: initial.current, zoom: 16 } : { center: [77.59, 12.97], zoom: 3 }
        }
      />
      <GeoJSONSource id="route" data={route}>
        <Layer id="route-line" type="line" paint={{ 'line-color': ROUTE_LINE['line-color'], 'line-width': ROUTE_LINE['line-width'] }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} />
      </GeoJSONSource>
      {dot ? (
        <GeoJSONSource id="position" data={dot}>
          <Layer
            id="position-halo"
            type="circle"
            paint={{ 'circle-radius': 16, 'circle-color': colors.white, 'circle-opacity': 0.18 }}
          />
          <Layer
            id="position-dot"
            type="circle"
            paint={{
              'circle-radius': 6,
              'circle-color': colors.white,
              'circle-stroke-color': colors.black,
              'circle-stroke-width': 2,
            }}
          />
        </GeoJSONSource>
      ) : null}
    </Map>
  );
}

/** A finished route, framed to fit. */
export function RouteMap({ lines, style }: { lines: LngLat[][]; style?: StyleProp<ViewStyle> }) {
  const box = useMemo(() => bboxOf(lines), [lines]);
  const route = useMemo(() => routeGeoJSON(lines), [lines]);
  if (!box) return <View style={[{ backgroundColor: colors.fieldBg }, style]} />;
  return (
    <View style={[{ overflow: 'hidden' }, style]}>
      <Map
        style={{ flex: 1 }}
        mapStyle={DARK_STYLE}
        logo={false}
        attribution
        attributionPosition={{ bottom: 6, right: 6 }}
        compass={false}
        touchRotate={false}
        touchPitch={false}
      >
        <Camera
          initialViewState={{
            bounds: [box.minLng, box.minLat, box.maxLng, box.maxLat],
            padding: { top: 48, bottom: 48, left: 48, right: 48 },
            ...(box.minLat === box.maxLat && box.minLng === box.maxLng ? { zoom: 15 } : null),
          }}
        />
        <GeoJSONSource id="route" data={route}>
          <Layer id="route-line" type="line" paint={{ 'line-color': colors.white, 'line-width': 3.5 }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} />
        </GeoJSONSource>
      </Map>
    </View>
  );
}

/** Small route drawing for lists. No tiles, so it always works and scrolls smoothly. */
export const RouteThumb = memo(function RouteThumb({ lines, size = 56 }: { lines: LngLat[][]; size?: number }) {
  const path = useMemo(() => {
    const box = bboxOf(lines);
    if (!box) return null;
    const [x0, y0] = project(box.minLng, box.maxLat, 0);
    const [x1, y1] = project(box.maxLng, box.minLat, 0);
    const span = Math.max(x1 - x0, y1 - y0, 1e-9);
    const inner = size - 12;
    const scale = inner / span;
    const ox = (size - (x1 - x0) * scale) / 2;
    const oy = (size - (y1 - y0) * scale) / 2;
    const p = Skia.PathBuilder.Make();
    for (const line of lines) {
      line.forEach(([lng, lat], i) => {
        const [x, y] = project(lng, lat, 0);
        const px = ox + (x - x0) * scale;
        const py = oy + (y - y0) * scale;
        if (i === 0) p.moveTo(px, py);
        else p.lineTo(px, py);
      });
    }
    return p.build();
  }, [lines, size]);

  return (
    <Canvas style={{ width: size, height: size }}>
      {path ? (
        <Path path={path} style="stroke" strokeWidth={1.6} strokeCap="round" strokeJoin="round" color={colors.white} />
      ) : null}
    </Canvas>
  );
});
