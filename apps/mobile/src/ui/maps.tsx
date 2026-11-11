import Ionicons from '@expo/vector-icons/Ionicons';
import { Camera, CameraRef, GeoJSONSource, Layer, Map, MapProps, MapRef } from '@maplibre/maplibre-react-native';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { buildMapStyle, MONO_LIGHT, project } from '@/lib/mapStyle';
import { bboxOf, LngLat, routeGeoJSON } from '@/lib/track';
import { colors, fonts, shadow } from './theme';

const APP_STYLE = buildMapStyle(MONO_LIGHT) as unknown as MapProps['mapStyle'];

const ROUTE_LINE = {
  'line-color': colors.ink,
  'line-width': 4,
  'line-cap': 'round',
  'line-join': 'round',
} as const;

/** Full map that follows the position while recording. It's decoration: tracking never needs it. */
export function LiveMap({
  lines,
  position,
  follow,
  guide,
  onUserGesture,
}: {
  lines: LngLat[][];
  position: LngLat | null;
  follow: boolean;
  /** A route to follow, drawn faintly under this one. */
  guide?: LngLat[][] | null;
  onUserGesture?: () => void;
}) {
  const guideShape = useMemo(() => (guide?.length ? routeGeoJSON(guide) : null), [guide]);
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
      mapStyle={APP_STYLE}
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
      {guideShape ? (
        <GeoJSONSource id="guide" data={guideShape}>
          <Layer
            id="guide-line"
            type="line"
            paint={{ 'line-color': '#9A9A9A', 'line-width': 7, 'line-opacity': 0.55 }}
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          />
        </GeoJSONSource>
      ) : null}
      <GeoJSONSource id="route" data={route}>
        <Layer id="route-line" type="line" paint={{ 'line-color': ROUTE_LINE['line-color'], 'line-width': ROUTE_LINE['line-width'] }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} />
      </GeoJSONSource>
      {dot ? (
        <GeoJSONSource id="position" data={dot}>
          <Layer
            id="position-halo"
            type="circle"
            paint={{ 'circle-radius': 16, 'circle-color': colors.ink, 'circle-opacity': 0.14 }}
          />
          <Layer
            id="position-dot"
            type="circle"
            paint={{
              'circle-radius': 6,
              'circle-color': colors.ink,
              'circle-stroke-color': colors.paper,
              'circle-stroke-width': 2,
            }}
          />
        </GeoJSONSource>
      ) : null}
    </Map>
  );
}

/** A finished route, framed to fit, with start and end markers and zoom buttons. */
export function RouteMap({ lines, style }: { lines: LngLat[][]; style?: StyleProp<ViewStyle> }) {
  const box = useMemo(() => bboxOf(lines), [lines]);
  const route = useMemo(() => routeGeoJSON(lines), [lines]);
  const ends = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point> | null>(() => {
    const drawn = lines.filter((l) => l.length > 0);
    if (!drawn.length) return null;
    const first = drawn[0][0];
    const lastLine = drawn[drawn.length - 1];
    const last = lastLine[lastLine.length - 1];
    return {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { kind: 'start' }, geometry: { type: 'Point', coordinates: first } },
        { type: 'Feature', properties: { kind: 'end' }, geometry: { type: 'Point', coordinates: last } },
      ],
    };
  }, [lines]);
  const map = useRef<MapRef>(null);
  const camera = useRef<CameraRef>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');

  // No fake route: without recorded positions, say so.
  if (!box) {
    return (
      <View style={[styles.empty, style]}>
        <Ionicons name="map-outline" size={26} color={colors.textMuted} />
        <Text style={styles.emptyText}>No GPS route was recorded for this activity</Text>
      </View>
    );
  }

  const zoomBy = async (delta: number) => {
    const z = await map.current?.getZoom();
    if (z != null) camera.current?.zoomTo(z + delta, { duration: 250 });
  };

  return (
    <View style={[{ overflow: 'hidden', backgroundColor: colors.bgSoft }, style]}>
      <Map
        ref={map}
        style={{ flex: 1 }}
        mapStyle={APP_STYLE}
        logo={false}
        attribution
        attributionPosition={{ bottom: 6, left: 6 }}
        compass={false}
        touchRotate={false}
        touchPitch={false}
        onDidFinishLoadingMap={() => setStatus('ready')}
        onDidFailLoadingMap={() => setStatus('failed')}
      >
        <Camera
          ref={camera}
          initialViewState={{
            bounds: [box.minLng, box.minLat, box.maxLng, box.maxLat],
            padding: { top: 64, bottom: 64, left: 48, right: 48 },
            ...(box.minLat === box.maxLat && box.minLng === box.maxLng ? { zoom: 15 } : null),
          }}
        />
        <GeoJSONSource id="route" data={route}>
          <Layer id="route-line" type="line" paint={{ 'line-color': colors.ink, 'line-width': 4 }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} />
        </GeoJSONSource>
        {ends ? (
          <GeoJSONSource id="ends" data={ends}>
            <Layer
              id="ends-dot"
              type="circle"
              paint={{
                'circle-radius': 7,
                'circle-color': ['match', ['get', 'kind'], 'start', colors.paper, colors.ink],
                'circle-stroke-color': ['match', ['get', 'kind'], 'start', colors.ink, colors.paper],
                'circle-stroke-width': 3,
              }}
            />
          </GeoJSONSource>
        ) : null}
      </Map>
      {status !== 'ready' ? (
        <View pointerEvents="none" style={styles.overlay}>
          {status === 'loading' ? (
            <ActivityIndicator color={colors.ink} />
          ) : (
            <Text style={styles.emptyText}>Map couldn't load. The route is still saved.</Text>
          )}
        </View>
      ) : null}
      <View style={styles.zoom}>
        <Pressable accessibilityRole="button" accessibilityLabel="Zoom in" onPress={() => zoomBy(1)} style={styles.zoomButton}>
          <Ionicons name="add" size={20} color={colors.ink} />
        </Pressable>
        <View style={styles.zoomDivider} />
        <Pressable accessibilityRole="button" accessibilityLabel="Zoom out" onPress={() => zoomBy(-1)} style={styles.zoomButton}>
          <Ionicons name="remove" size={20} color={colors.ink} />
        </Pressable>
      </View>
      <View pointerEvents="none" style={styles.legend}>
        <View style={[styles.legendDot, { backgroundColor: colors.paper, borderColor: colors.ink }]} />
        <Text style={styles.legendText}>Start</Text>
        <View style={[styles.legendDot, { backgroundColor: colors.ink, borderColor: colors.paper }]} />
        <Text style={styles.legendText}>Finish</Text>
      </View>
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
        <Path path={path} style="stroke" strokeWidth={1.6} strokeCap="round" strokeJoin="round" color={colors.ink} />
      ) : null}
    </Canvas>
  );
});

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.bgSoft, padding: 24 },
  emptyText: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13, textAlign: 'center' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(238,238,238,0.85)' },
  zoom: {
    position: 'absolute',
    right: 12,
    bottom: 40,
    borderRadius: 14,
    backgroundColor: colors.card,
    boxShadow: shadow.card,
  },
  zoomButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  zoomDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.divider },
  legend: {
    position: 'absolute',
    left: 12,
    bottom: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  legendDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  legendText: { fontFamily: fonts.medium, fontSize: 11, color: colors.text, marginRight: 4 },
});
