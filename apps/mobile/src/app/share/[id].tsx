import TrackingEngine from '@engine';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Canvas, drawAsImage, Group, ImageFormat, Rect, SkImage } from '@shopify/react-native-skia';
import { randomUUID } from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalQuery, getDb, notifyChange, transaction, write } from '@/db';
import { enqueueOutbox, getActivity, getTrackBlob } from '@/db/activities';
import { loadSettings, saveSetting, useSettings } from '@/db/settings';
import { MAP_THEMES, MapColors } from '@/lib/mapStyle';
import { decodeTrack, LngLat, previewOf, toSegments, trimEnds } from '@/lib/track';
import { importPhoto, renderMapImage, useMapImages, usePhotoImages, useShareFonts } from '@/share/assets';
import { Chips, ColorPicker, Panel, Slider, Toggle } from '@/share/controls';
import {
  applyStyle,
  Background,
  canvasHeight,
  currentStyle,
  SHARE_STYLES,
  ShareStyle,
  CANVAS_W,
  clampFrame,
  CollageLayer,
  defaultCollageLayer,
  defaultDoc,
  defaultMapLayer,
  defaultMetricsLayer,
  defaultRouteLayer,
  defaultTextLayer,
  exportFormat,
  FILTER_PRESETS,
  FONT_LABEL,
  FontKey,
  hitTest,
  Layer,
  layoutById,
  layoutsFor,
  MapLayer,
  MAX_PHOTOS,
  METRIC_LABEL,
  MetricKey,
  MetricsLayer,
  PhotoFilter,
  RATIOS,
  RouteLayer,
  ShareDoc,
  TextLayer,
  toPreset,
} from '@/share/doc';
import { createHistory, History, push, redo, undo } from '@/share/history';
import { SelectionOutline, ShareData, ShareScene } from '@/share/scene';
import { requestSync } from '@/sync/worker';
import { Button, colors, Field, InkGloss, radius, Screen, shadow, space, T, Tap } from '@/ui';

type Tab = 'style' | 'format' | 'layers' | 'background' | 'map' | 'route' | 'metrics' | 'photos' | 'text' | 'presets';

const TABS: { id: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'style', label: 'Style', icon: 'sparkles-outline' },
  { id: 'format', label: 'Format', icon: 'crop-outline' },
  { id: 'layers', label: 'Layers', icon: 'layers-outline' },
  { id: 'background', label: 'Background', icon: 'color-fill-outline' },
  { id: 'map', label: 'Map', icon: 'map-outline' },
  { id: 'route', label: 'Route', icon: 'analytics-outline' },
  { id: 'metrics', label: 'Metrics', icon: 'speedometer-outline' },
  { id: 'photos', label: 'Photos', icon: 'images-outline' },
  { id: 'text', label: 'Text', icon: 'text-outline' },
  { id: 'presets', label: 'Presets', icon: 'bookmark-outline' },
];

const LAYER_NAME: Record<Layer['kind'], string> = {
  map: 'Map',
  route: 'Route',
  metrics: 'Metrics',
  collage: 'Photos',
  text: 'Text',
};

const FONTS = (Object.keys(FONT_LABEL) as FontKey[]).map((value) => ({ value, label: FONT_LABEL[value] }));
const ALIGN = [
  { value: 'start', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'end', label: 'Right' },
] as const;

export default function ShareStudio() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { units } = useSettings();
  const { data: activity } = useLocalQuery(() => getActivity(id), [id]);

  const [history, setHistory] = useState<History<ShareDoc> | null>(null);
  const [fullLines, setFullLines] = useState<LngLat[][]>([]);
  const [tab, setTab] = useState<Tab>('style');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState(0);
  const [moveContent, setMoveContent] = useState(false);
  const [metricTarget, setMetricTarget] = useState<MetricKey | 'all'>('all');
  const [busy, setBusy] = useState<'share' | 'save' | null>(null);
  const [customW, setCustomW] = useState('');
  const [customH, setCustomH] = useState('');

  const doc = history?.present ?? null;

  // ---------- Load the draft and route ----------
  useEffect(() => {
    (async () => {
      const row = await getDb().getFirstAsync<{ doc: string }>('SELECT doc FROM share_drafts WHERE activityId = ?', [id]);
      if (row) {
        setHistory(createHistory(JSON.parse(row.doc) as ShareDoc));
      } else {
        const { shareTrim } = await loadSettings();
        setHistory(createHistory({ ...defaultDoc(), trimEndsM: shareTrim ? TRIM_M : 0 }));
        if (shareTrim === null) {
          // Asked once, before anything can be shared. The answer becomes the default, and the
          // Format tab can still change it for any one image.
          Alert.alert(
            'Hide where you start and finish?',
            'Routes often begin at home. Cardigo can leave the first and last 200 m out of shared images.',
            [
              { text: 'Show full route', onPress: () => saveSetting('shareTrim', false) },
              {
                text: 'Hide them',
                onPress: () => {
                  saveSetting('shareTrim', true);
                  setHistory((h) => (h ? createHistory({ ...h.present, trimEndsM: TRIM_M }) : h));
                },
              },
            ],
            { cancelable: false },
          );
        }
      }
      const blob = await getTrackBlob(id);
      if (blob) setFullLines(previewOf(toSegments(decodeTrack(blob)), 1500));
    })().catch((e) => {
      console.warn(e);
      setHistory(createHistory(defaultDoc()));
    });
  }, [id]);

  const lines = useMemo(() => {
    const base = fullLines.length ? fullLines : (activity?.previewRoute ?? []);
    return doc ? trimEnds(base, doc.trimEndsM) : base;
  }, [fullLines, activity?.previewRoute, doc?.trimEndsM]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveDraft = useCallback(
    (d: ShareDoc) => {
      write(
        `INSERT INTO share_drafts (activityId, doc, updatedAt) VALUES (?, ?, ?)
           ON CONFLICT (activityId) DO UPDATE SET doc = excluded.doc, updatedAt = excluded.updatedAt`,
        [id, JSON.stringify(d), Date.now()],
      ).catch((e) => console.warn('Draft save failed', e));
    },
    [id],
  );

  // Save after every change, so a crash or a phone call never loses a design.
  useEffect(() => {
    if (!doc) return undefined;
    const timer = setTimeout(() => {
      saveDraft(doc);
    }, 400);
    return () => clearTimeout(timer);
  }, [doc, saveDraft]);

  const leave = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/activity/[id]', params: { id } }));

  // Closing right after an edit must not lose it to the save delay above.
  const closeStudio = () => {
    if (doc) saveDraft(doc);
    leave();
  };

  // ---------- Editing helpers ----------
  const change = useCallback((mutate: (d: ShareDoc) => ShareDoc, key: string | null = null) => {
    setHistory((h) => (h ? push(h, mutate(h.present), key, Date.now()) : h));
  }, []);

  const patchLayer = useCallback(
    <L extends Layer>(layerId: string, patch: Partial<L>, key: string | null = null) => {
      change(
        (d) => ({
          ...d,
          layers: d.layers.map((l) => (l.id === layerId ? ({ ...l, ...patch } as Layer) : l)),
        }),
        key ? `${layerId}:${key}` : null,
      );
    },
    [change],
  );

  // The selected layer if it's this kind, otherwise the first one, so duplicates stay editable.
  const firstOf = <K extends Layer['kind']>(kind: K) => {
    const isKind = (l: Layer | null | undefined): l is Extract<Layer, { kind: K }> => l?.kind === kind;
    const current = doc?.layers.find((l) => l.id === selectedId);
    return isKind(current) ? current : doc?.layers.find(isKind);
  };

  const addLayer = (layer: Layer) => {
    change((d) => ({ ...d, layers: [...d.layers, layer] }));
    setSelectedId(layer.id);
  };

  // ---------- Assets ----------
  const { images: mapImages, failed: mapFailed, loading: mapLoading } = useMapImages(
    doc ?? defaultDocStable,
    lines,
  );
  const photos = usePhotoImages(doc ?? defaultDocStable);
  const fonts = useShareFonts();
  const assets = useMemo(() => ({ mapImages, photos, fonts }), [mapImages, photos, fonts]);

  // ---------- Canvas gestures ----------
  const previewMaxH = screenH * 0.46;
  const maxW = screenW - space.lg * 2;
  const canvasH = doc ? canvasHeight(doc) : CANVAS_W;
  const previewScale = Math.min(maxW / CANVAS_W, previewMaxH / canvasH);
  const previewW = CANVAS_W * previewScale;
  const previewH = canvasH * previewScale;

  const selected = doc?.layers.find((l) => l.id === selectedId) ?? null;
  const dragStart = useRef<{
    frame: Layer['frame'];
    panX: number;
    panY: number;
    offsetX: number;
    offsetY: number;
    scale: number;
    zoomDelta: number;
  } | null>(null);

  const startDrag = () => {
    if (!selected) return;
    const cell = selected.kind === 'collage' ? selected.cells[selectedCell] : undefined;
    dragStart.current = {
      frame: selected.frame,
      panX: selected.kind === 'map' ? selected.panX : 0,
      panY: selected.kind === 'map' ? selected.panY : 0,
      offsetX: cell?.offsetX ?? 0,
      offsetY: cell?.offsetY ?? 0,
      scale: cell?.scale ?? 1,
      zoomDelta: selected.kind === 'map' ? selected.zoomDelta : 0,
    };
  };

  const onPan = (dx: number, dy: number) => {
    const s = dragStart.current;
    if (!s || !selected) return;
    if (moveContent && selected.kind === 'map') {
      const k = 540 / CANVAS_W / previewScale / 2 ** selected.zoomDelta;
      patchLayer<MapLayer>(selected.id, { panX: s.panX - dx * k, panY: s.panY - dy * k }, 'drag');
      return;
    }
    if (moveContent && selected.kind === 'collage') {
      const layout = layoutById(selected.layoutId, selected.cells.length);
      const r = layout.rects[selectedCell];
      if (!r) return;
      const cells = selected.cells.map((c, i) =>
        i === selectedCell
          ? {
              ...c,
              offsetX: s.offsetX + dx / (previewW * selected.frame.w * r[2]),
              offsetY: s.offsetY + dy / (previewH * selected.frame.h * r[3]),
            }
          : c,
      );
      patchLayer<CollageLayer>(selected.id, { cells }, 'drag');
      return;
    }
    if (selected.locked) return;
    patchLayer(
      selected.id,
      { frame: clampFrame({ ...s.frame, x: s.frame.x + dx / previewW, y: s.frame.y + dy / previewH }) },
      'drag',
    );
  };

  const onPinch = (factor: number) => {
    const s = dragStart.current;
    if (!s || !selected) return;
    if (moveContent && selected.kind === 'map') {
      patchLayer<MapLayer>(selected.id, { zoomDelta: s.zoomDelta + Math.log2(factor) }, 'drag');
      return;
    }
    if (moveContent && selected.kind === 'collage') {
      const cells = selected.cells.map((c, i) =>
        i === selectedCell ? { ...c, scale: Math.max(1, Math.min(5, s.scale * factor)) } : c,
      );
      patchLayer<CollageLayer>(selected.id, { cells }, 'drag');
      return;
    }
    if (selected.locked) return;
    const w = s.frame.w * factor;
    const h = s.frame.h * factor;
    patchLayer(
      selected.id,
      {
        frame: clampFrame({
          x: s.frame.x - (w - s.frame.w) / 2,
          y: s.frame.y - (h - s.frame.h) / 2,
          w,
          h,
        }),
      },
      'drag',
    );
  };

  const onTap = (x: number, y: number) => {
    if (!doc) return;
    const fx = x / previewW;
    const fy = y / previewH;
    // A route on a map moves with the map, so it isn't something to pick up and drag.
    const hasMap = doc.layers.some((l) => l.kind === 'map' && l.visible);
    const hit = hitTest(doc.layers.filter((l) => !(hasMap && l.kind === 'route')), fx, fy);
    setSelectedId(hit?.id ?? null);
    if (hit?.kind === 'collage') {
      const layout = layoutById(hit.layoutId, hit.cells.length);
      const lx = (fx - hit.frame.x) / hit.frame.w;
      const ly = (fy - hit.frame.y) / hit.frame.h;
      const cell = layout.rects.findIndex(([rx, ry, rw, rh]) => lx >= rx && lx <= rx + rw && ly >= ry && ly <= ry + rh);
      if (cell >= 0) setSelectedCell(cell);
    }
  };

  const gesture = Gesture.Simultaneous(
    Gesture.Tap().runOnJS(true).onEnd((e) => onTap(e.x, e.y)),
    Gesture.Race(
      Gesture.Simultaneous(
        Gesture.Pan()
          .runOnJS(true)
          .minDistance(4)
          .onBegin(startDrag)
          .onUpdate((e) => onPan(e.translationX, e.translationY)),
        Gesture.Pinch()
          .runOnJS(true)
          .onBegin(startDrag)
          .onUpdate((e) => onPinch(e.scale)),
      ),
    ),
  );

  // ---------- Export ----------
  const render = async (): Promise<{ file: File } | null> => {
    if (!doc || !activity) return null;
    const scale = doc.exportWidth / CANVAS_W;
    const sharp = doc.exportWidth === 2160 ? 2 : 1;
    const exportMaps: Record<string, SkImage | null> = { ...mapImages };
    for (const layer of doc.layers) {
      if (layer.kind === 'map' && layer.visible && sharp === 2) {
        try {
          exportMaps[layer.id] = await renderMapImage(layer, lines, doc, 2);
        } catch {
          // Fall back to the preview-sharpness map rather than failing the export.
        }
      }
    }
    const data: ShareData = { activity, lines, units };
    const element = (w: number, s: number) => {
      void w;
      return <ShareScene doc={doc} assets={{ mapImages: exportMaps, photos, fonts }} data={data} scale={s} />;
    };

    let width = doc.exportWidth as number;
    let image: SkImage | null = null;
    try {
      image = await drawAsImage(element(width, scale), { width, height: Math.round(canvasH * scale) });
    } catch (e) {
      console.warn('High-size export failed', e);
    }
    if (!image && width > CANVAS_W) {
      // Out of memory on a big canvas: retry at standard size and say so.
      width = CANVAS_W;
      image = await drawAsImage(element(width, 1), { width, height: canvasH });
      Alert.alert('Saved at standard size', "This phone couldn't make the large size with these photos.");
    }
    if (!image) throw new Error('Could not draw the image');

    const format = exportFormat(doc);
    const bytes = image.encodeToBytes(format === 'png' ? ImageFormat.PNG : ImageFormat.JPEG, 95);
    const file = new File(Paths.cache, `cardiomen-${id.slice(-8)}-${Date.now()}.${format === 'png' ? 'png' : 'jpg'}`);
    file.create();
    await file.write(bytes);
    return { file };
  };

  const doShare = async () => {
    setBusy('share');
    try {
      const result = await render();
      if (result) {
        await Sharing.shareAsync(result.file.uri, {
          mimeType: doc && exportFormat(doc) === 'png' ? 'image/png' : 'image/jpeg',
        });
      }
    } catch (e) {
      Alert.alert('Could not share', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const doSave = async () => {
    setBusy('save');
    try {
      const { status } = await requestPermissionsAsync(true, ['photo']);
      if (status !== 'granted') {
        Alert.alert('Gallery permission needed', 'Allow access so the image can be saved.');
        return;
      }
      const result = await render();
      if (result) {
        await Asset.create(result.file.uri);
        Alert.alert('Saved to gallery');
      }
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  // ---------- Photos ----------
  const collage = firstOf('collage');

  /** Adds photos to the collage. The first photo also switches the design to photo + route. */
  const addPhotoUris = useCallback(
    (uris: string[], style: ShareStyle = 'photo-route') => {
      change((d) => {
        const existing = d.layers.find((l): l is CollageLayer => l.kind === 'collage');
        if (!existing) return applyStyle(d, style, uris);
        const cells = [...existing.cells, ...defaultCollageLayer(uris).cells].slice(0, MAX_PHOTOS);
        const updated = {
          ...d,
          layers: d.layers.map((l) =>
            l.id === existing.id
              ? { ...existing, cells, visible: true, layoutId: layoutById(existing.layoutId, cells.length).id }
              : l,
          ),
        };
        return existing.visible ? updated : applyStyle(updated, style);
      });
      setSelectedCell(0);
    },
    [change],
  );

  const pickPhotos = async (source: 'device' | 'camera', style?: ShareStyle) => {
    const existing = collage?.cells.length ?? 0;
    const remaining = MAX_PHOTOS - existing;
    if (remaining <= 0) {
      Alert.alert(`Up to ${MAX_PHOTOS} photos`, 'Remove one to add another.');
      return;
    }
    try {
      let picked: ImagePicker.ImagePickerResult;
      if (source === 'camera') {
        const { granted } = await ImagePicker.requestCameraPermissionsAsync();
        if (!granted) {
          Alert.alert('Camera permission needed', 'Allow the camera in app settings to take a photo.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open settings', onPress: () => TrackingEngine.openAppSettings() },
          ]);
          return;
        }
        picked = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 });
      } else {
        picked = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsMultipleSelection: true,
          selectionLimit: remaining,
          quality: 1,
        });
      }
      if (picked.canceled) return;
      const uris = await Promise.all(picked.assets.map((a) => importPhoto(a.uri, a.width, a.height)));
      addPhotoUris(uris, style);
    } catch (e) {
      Alert.alert('Could not add photo', e instanceof Error ? e.message : String(e));
    }
  };

  const chooseStyle = (style: ShareStyle) => {
    const needsPhoto = SHARE_STYLES.find((s) => s.value === style)?.needsPhoto;
    if (needsPhoto && !collage) {
      Alert.alert('Add a photo', 'This style uses your photo as the background.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Take a photo', onPress: () => pickPhotos('camera', style) },
        { text: 'From device', onPress: () => pickPhotos('device', style) },
      ]);
      return;
    }
    change((d) => applyStyle(d, style));
  };

  // On a low-memory phone, Android can close the app while the camera is open. The photo is still
  // waiting for us when it reopens here.
  const recoveredCamera = useRef(false);
  useEffect(() => {
    if (!history || recoveredCamera.current) return;
    recoveredCamera.current = true;
    ImagePicker.getPendingResultAsync()
      .then(async (pending) => {
        const result = Array.isArray(pending) ? pending[0] : pending;
        if (!result || !('assets' in result) || result.canceled || !result.assets) return;
        const uris = await Promise.all(result.assets.map((a: ImagePicker.ImagePickerAsset) => importPhoto(a.uri, a.width, a.height)));
        addPhotoUris(uris);
      })
      .catch((e) => console.warn('Could not recover camera photo', e));
  }, [history, addPhotoUris]);

  const updateFilter = (patch: Partial<PhotoFilter>, key: string | null) => {
    if (!collage) return;
    const cells = collage.cells.map((c, i) => (i === selectedCell ? { ...c, filter: { ...c.filter, ...patch } } : c));
    patchLayer<CollageLayer>(collage.id, { cells }, key);
  };

  const removeCell = () => {
    if (!collage) return;
    const cells = collage.cells.filter((_, i) => i !== selectedCell);
    if (cells.length === 0) {
      change((d) => ({ ...d, layers: d.layers.filter((l) => l.id !== collage.id) }));
    } else {
      patchLayer<CollageLayer>(collage.id, { cells, layoutId: layoutById(collage.layoutId, cells.length).id });
    }
    setSelectedCell(0);
  };

  // ---------- Presets ----------
  const { data: presets } = useLocalQuery(
    () =>
      getDb().getAllAsync<{ id: string; name: string; doc: string }>(
        'SELECT id, name, doc FROM share_presets WHERE deletedAt IS NULL ORDER BY updatedAt DESC',
      ),
    [],
  );
  const [presetName, setPresetName] = useState('');

  const savePreset = async () => {
    if (!doc || !presetName.trim()) return;
    const presetId = randomUUID();
    const db = getDb();
    await transaction(db, async () => {
      await db.runAsync('INSERT INTO share_presets (id, name, doc, updatedAt) VALUES (?, ?, ?, ?)', [
        presetId,
        presetName.trim(),
        JSON.stringify(toPreset(doc)),
        Date.now(),
      ]);
      await enqueueOutbox('preset', presetId);
    });
    setPresetName('');
    notifyChange();
    requestSync();
  };

  const applyPreset = (json: string) => {
    const preset = JSON.parse(json) as ShareDoc;
    change((d) => {
      // A preset carries the design. This activity's own photos stay.
      const own = d.layers.filter((l) => l.kind === 'collage');
      const firstAbove = preset.layers.findIndex((l) => l.kind !== 'map');
      const at = firstAbove < 0 ? preset.layers.length : firstAbove;
      return { ...preset, layers: [...preset.layers.slice(0, at), ...own, ...preset.layers.slice(at)] };
    });
  };

  const deletePreset = async (presetId: string) => {
    const db = getDb();
    await transaction(db, async () => {
      await db.runAsync('UPDATE share_presets SET deletedAt = ?, updatedAt = ? WHERE id = ?', [
        Date.now(),
        Date.now(),
        presetId,
      ]);
      await enqueueOutbox('preset', presetId);
    });
    notifyChange();
    requestSync();
  };

  if (activity === null) {
    return (
      <Screen style={{ justifyContent: 'center', padding: space.xl, gap: space.lg }}>
        <T center muted>
          This activity isn't available.
        </T>
        <Button title="Close" kind="glass" onPress={() => router.replace('/(tabs)')} />
      </Screen>
    );
  }
  if (!doc || !history || !activity) return <Screen />;

  const data: ShareData = { activity, lines, units };
  const map = firstOf('map');
  const route = firstOf('route');
  const metrics = firstOf('metrics');
  const textLayers = doc.layers.filter((l): l is TextLayer => l.kind === 'text');
  const selectedText = selected?.kind === 'text' ? selected : textLayers[textLayers.length - 1];
  const cell = collage?.cells[selectedCell];
  const contentMovable = selected?.kind === 'map' || selected?.kind === 'collage';
  const ratioLabel = RATIOS.find((r) => r.w === doc.ratio.w && r.h === doc.ratio.h)?.label ?? null;

  const setBackground = (bg: Background, key: string | null = null) => change((d) => ({ ...d, background: bg }), key);

  return (
    <Screen>
      <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
        <Tap accessibilityRole="button" accessibilityLabel="Close" scaleTo={0.85} hitSlop={8} onPress={closeStudio} style={styles.icon}>
          <Ionicons name="close" size={22} color={colors.ink} />
        </Tap>
        <Tap
          accessibilityRole="button"
          accessibilityLabel="Undo"
          scaleTo={0.85}
          disabled={history.past.length === 0}
          onPress={() => setHistory(undo(history))}
          style={styles.icon}
        >
          <Ionicons name="arrow-undo-outline" size={20} color={history.past.length ? colors.ink : colors.textFaint} />
        </Tap>
        <Tap
          accessibilityRole="button"
          accessibilityLabel="Redo"
          scaleTo={0.85}
          disabled={history.future.length === 0}
          onPress={() => setHistory(redo(history))}
          style={styles.icon}
        >
          <Ionicons name="arrow-redo-outline" size={20} color={history.future.length ? colors.ink : colors.textFaint} />
        </Tap>
        <View style={{ flex: 1 }} />
        <Button title="Save" kind="glass" loading={busy === 'save'} disabled={!!busy || mapLoading} onPress={doSave} style={styles.action} />
        <Button title="Share" loading={busy === 'share'} disabled={!!busy || mapLoading} onPress={doShare} style={styles.action} />
      </View>

      <View style={[styles.previewArea, { height: previewMaxH }]}>
        <GestureDetector gesture={gesture}>
          <View style={[styles.preview, { width: previewW, height: previewH }]} collapsable={false}>
            <Canvas style={{ width: previewW, height: previewH }}>
              {doc.background.kind === 'transparent' ? <Checker w={previewW} h={previewH} /> : null}
              <ShareScene doc={doc} assets={assets} data={data} scale={previewScale} />
              {selected ? <SelectionOutline frame={selected.frame} doc={doc} scale={previewScale} /> : null}
            </Canvas>
          </View>
        </GestureDetector>
      </View>

      <View style={styles.hintRow}>
        <T v="small" faint numberOfLines={1} style={{ flex: 1 }}>
          {mapFailed
            ? "Map couldn't load. You can export without it or try again."
            : mapLoading
              ? 'Updating map…'
              : selected
                ? `${LAYER_NAME[selected.kind]} selected${selected.locked && !moveContent ? ' (locked)' : ''}`
                : 'Tap the image to select a layer'}
        </T>
        {contentMovable ? (
          <Pressable accessibilityRole="switch" accessibilityState={{ checked: moveContent }} onPress={() => setMoveContent(!moveContent)}>
            <T v="small" style={{ fontWeight: '600' }}>
              {moveContent ? 'Moving inside' : 'Moving layer'}
            </T>
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabs}
        contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.xs }}
      >
        {TABS.map((t) => {
          const on = t.id === tab;
          return (
            <Tap
              key={t.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              scaleTo={0.92}
              haptic={!on}
              onPress={() => setTab(t.id)}
              style={[styles.tab, on && styles.tabOn]}
            >
              {on ? <InkGloss r={radius.pill} /> : null}
              <Ionicons name={t.icon} size={16} color={on ? colors.paper : colors.textMuted} />
              <T v="small" style={on ? { color: colors.paper, fontWeight: '600' } : { color: colors.textMuted }}>
                {t.label}
              </T>
            </Tap>
          );
        })}
      </ScrollView>

      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xl }}
      >
        {tab === 'style' ? (
          <Panel>
            <Button
              title="Upload from device"
              onPress={() => pickPhotos('device')}
              icon={<Ionicons name="images-outline" size={18} color={colors.paper} />}
            />
            <Button
              title="Take a photo"
              kind="glass"
              onPress={() => pickPhotos('camera')}
              icon={<Ionicons name="camera-outline" size={18} color={colors.ink} />}
            />
            <T v="small" muted>
              Your photo becomes the background, with your route outline and metrics on top. Tap and drag the
              route or the numbers to move them, and pinch to resize.
            </T>
            <Chips
              options={SHARE_STYLES.map((s) => ({ value: s.value, label: s.label }))}
              value={currentStyle(doc)}
              onChange={chooseStyle}
            />
            {collage && collage.cells.length > 1 ? (
              <Chips
                options={layoutsFor(collage.cells.length).map((l, i) => ({ value: l.id, label: `Collage ${i + 1}` }))}
                value={layoutById(collage.layoutId, collage.cells.length).id}
                onChange={(layoutId) => patchLayer<CollageLayer>(collage.id, { layoutId })}
              />
            ) : null}
          </Panel>
        ) : null}

        {tab === 'format' ? (
          <Panel>
            <Chips
              options={RATIOS.map((r) => ({ value: r.label, label: r.label }))}
              value={ratioLabel}
              onChange={(label) => {
                const r = RATIOS.find((x) => x.label === label)!;
                change((d) => ({ ...d, ratio: { w: r.w, h: r.h } }));
              }}
            />
            <View style={styles.customRatio}>
              <TextInput
                accessibilityLabel="Custom ratio width"
                style={styles.ratioInput}
                keyboardType="number-pad"
                placeholder="W"
                placeholderTextColor={colors.textFaint}
                value={customW}
                onChangeText={setCustomW}
              />
              <T muted>:</T>
              <TextInput
                accessibilityLabel="Custom ratio height"
                style={styles.ratioInput}
                keyboardType="number-pad"
                placeholder="H"
                placeholderTextColor={colors.textFaint}
                value={customH}
                onChangeText={setCustomH}
              />
              <Button
                title="Use custom"
                kind="glass"
                style={{ flex: 1, minHeight: 40 }}
                disabled={!(Number(customW) > 0 && Number(customH) > 0)}
                onPress={() => {
                  const w = Number(customW);
                  const h = Number(customH);
                  if (w / h > 4 || h / w > 4) {
                    Alert.alert('Ratio too extreme', 'Keep the sides within 4 times of each other.');
                    return;
                  }
                  change((d) => ({ ...d, ratio: { w, h } }));
                }}
              />
            </View>
            <T v="small" muted>
              Output size
            </T>
            <Chips
              options={[
                { value: '1080', label: '1080 px' },
                { value: '2160', label: '2160 px' },
              ]}
              value={String(doc.exportWidth) as '1080' | '2160'}
              onChange={(v) => change((d) => ({ ...d, exportWidth: Number(v) as 1080 | 2160 }))}
            />
            <T v="small" muted>
              File type
            </T>
            <Chips
              options={[
                { value: 'png', label: 'PNG' },
                { value: 'jpeg', label: 'JPEG' },
              ]}
              value={exportFormat(doc)}
              onChange={(v) => change((d) => ({ ...d, format: v }))}
            />
            {doc.background.kind === 'transparent' ? (
              <T v="small" faint>
                Transparent backgrounds always export as PNG.
              </T>
            ) : null}
            <Toggle
              label="Hide the first and last 200 m of the route, so it doesn't show where you live"
              value={doc.trimEndsM > 0}
              onChange={(on) => change((d) => ({ ...d, trimEndsM: on ? TRIM_M : 0 }))}
            />
          </Panel>
        ) : null}

        {tab === 'layers' ? (
          <Panel>
            {[...doc.layers].reverse().map((l) => {
              const index = doc.layers.indexOf(l);
              return (
                <Pressable
                  key={l.id}
                  accessibilityRole="button"
                  onPress={() => setSelectedId(l.id)}
                  style={[styles.layerRow, l.id === selectedId && styles.layerRowOn]}
                >
                  <T style={{ flex: 1 }} numberOfLines={1}>
                    {l.kind === 'text' ? l.text.split('\n')[0] : LAYER_NAME[l.kind]}
                  </T>
                  <IconButton
                    label="Move up"
                    icon="chevron-up"
                    disabled={index === doc.layers.length - 1}
                    onPress={() =>
                      change((d) => {
                        const layers = [...d.layers];
                        [layers[index], layers[index + 1]] = [layers[index + 1], layers[index]];
                        return { ...d, layers };
                      })
                    }
                  />
                  <IconButton
                    label="Move down"
                    icon="chevron-down"
                    disabled={index === 0}
                    onPress={() =>
                      change((d) => {
                        const layers = [...d.layers];
                        [layers[index], layers[index - 1]] = [layers[index - 1], layers[index]];
                        return { ...d, layers };
                      })
                    }
                  />
                  <IconButton
                    label={l.visible ? 'Hide' : 'Show'}
                    icon={l.visible ? 'eye-outline' : 'eye-off-outline'}
                    onPress={() => patchLayer(l.id, { visible: !l.visible })}
                  />
                  <IconButton
                    label={l.locked ? 'Unlock' : 'Lock'}
                    icon={l.locked ? 'lock-closed-outline' : 'lock-open-outline'}
                    onPress={() => patchLayer(l.id, { locked: !l.locked })}
                  />
                  <IconButton
                    label="Delete"
                    icon="trash-outline"
                    onPress={() => {
                      change((d) => ({ ...d, layers: d.layers.filter((x) => x.id !== l.id) }));
                      if (selectedId === l.id) setSelectedId(null);
                    }}
                  />
                </Pressable>
              );
            })}
            <Chips
              options={[
                { value: 'map', label: '+ Map' },
                { value: 'route', label: '+ Route' },
                { value: 'metrics', label: '+ Metrics' },
                { value: 'text', label: '+ Text' },
              ]}
              value={null}
              onChange={(kind) => {
                if (kind === 'map') {
                  const layer = defaultMapLayer();
                  change((d) => ({ ...d, layers: [layer, ...d.layers] }));
                  setSelectedId(layer.id);
                } else if (kind === 'route') addLayer(defaultRouteLayer());
                else if (kind === 'metrics') addLayer(defaultMetricsLayer());
                else addLayer(defaultTextLayer());
              }}
            />
            {selected ? (
              <Slider
                label={`${LAYER_NAME[selected.kind]} opacity`}
                value={selected.opacity}
                min={0}
                max={1}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(opacity) => patchLayer(selected.id, { opacity }, 'opacity')}
              />
            ) : null}
          </Panel>
        ) : null}

        {tab === 'background' ? (
          <Panel>
            <Chips
              options={[
                { value: 'solid', label: 'Solid' },
                { value: 'gradient', label: 'Gradient' },
                { value: 'transparent', label: 'Transparent' },
              ]}
              value={doc.background.kind}
              onChange={(kind) => {
                if (kind === 'solid') setBackground({ kind, color: '#000000' });
                else if (kind === 'gradient') setBackground({ kind, from: '#000000', to: '#3A3A3A', angle: 90 });
                else setBackground({ kind });
              }}
            />
            {doc.background.kind === 'solid' ? (
              <ColorPicker
                label="Color"
                value={doc.background.color}
                onChange={(color) => setBackground({ kind: 'solid', color })}
              />
            ) : null}
            {doc.background.kind === 'gradient' ? (
              <>
                <ColorPicker
                  label="From"
                  value={doc.background.from}
                  onChange={(from) => doc.background.kind === 'gradient' && setBackground({ ...doc.background, from })}
                />
                <ColorPicker
                  label="To"
                  value={doc.background.to}
                  onChange={(to) => doc.background.kind === 'gradient' && setBackground({ ...doc.background, to })}
                />
                <Slider
                  label="Angle"
                  value={doc.background.angle}
                  min={0}
                  max={360}
                  format={(v) => `${Math.round(v)}°`}
                  onChange={(angle) =>
                    doc.background.kind === 'gradient' && setBackground({ ...doc.background, angle }, 'angle')
                  }
                />
              </>
            ) : null}
            {doc.background.kind === 'transparent' ? (
              <T v="small" muted>
                Hide the map layer to use this as a sticker over your own photo.
              </T>
            ) : null}
          </Panel>
        ) : null}

        {tab === 'map' ? (
          map ? (
            <Panel>
              <Chips
                options={MAP_THEMES.map((t) => ({ value: t.name, label: t.name }))}
                value={MAP_THEMES.find((t) => JSON.stringify(t.colors) === JSON.stringify(map.colors))?.name ?? null}
                onChange={(name) =>
                  patchLayer<MapLayer>(map.id, { colors: MAP_THEMES.find((t) => t.name === name)!.colors })
                }
              />
              <Toggle label="Show map" value={map.visible} onChange={(visible) => patchLayer(map.id, { visible })} />
              <Toggle label="Place names" value={map.labels} onChange={(labels) => patchLayer<MapLayer>(map.id, { labels })} />
              <Slider
                label="Zoom"
                value={map.zoomDelta}
                min={-2}
                max={3}
                format={(v) => (v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1))}
                onChange={(zoomDelta) => patchLayer<MapLayer>(map.id, { zoomDelta }, 'zoom')}
              />
              <Slider
                label="Corner radius"
                value={map.cornerRadius}
                min={0}
                max={120}
                onChange={(cornerRadius) => patchLayer<MapLayer>(map.id, { cornerRadius }, 'radius')}
              />
              {(
                [
                  ['land', 'Land'],
                  ['road', 'Roads'],
                  ['water', 'Water'],
                  ['park', 'Parks'],
                  ['building', 'Buildings'],
                  ['label', 'Place names'],
                ] as [keyof MapColors, string][]
              ).map(([key, label]) => (
                <ColorPicker
                  key={key}
                  label={label}
                  value={map.colors[key]}
                  onChange={(color) =>
                    patchLayer<MapLayer>(map.id, { colors: { ...map.colors, [key]: color } }, `color-${key}`)
                  }
                />
              ))}
              <T v="small" faint>
                The map's data license requires the small credit in its corner, so it can't be removed.
              </T>
            </Panel>
          ) : (
            <Button title="Add a map" kind="glass" onPress={() => change((d) => ({ ...d, layers: [defaultMapLayer(), ...d.layers] }))} />
          )
        ) : null}

        {tab === 'route' ? (
          route ? (
            <Panel>
              <Toggle label="Show route" value={route.visible} onChange={(visible) => patchLayer(route.id, { visible })} />
              <ColorPicker
                label="Color"
                value={route.color}
                onChange={(color) => patchLayer<RouteLayer>(route.id, { color }, 'color')}
              />
              <Toggle
                label="Gradient"
                value={route.color2 != null}
                onChange={(on) => patchLayer<RouteLayer>(route.id, { color2: on ? '#8A8A8A' : null })}
              />
              {route.color2 ? (
                <ColorPicker
                  label="Second color"
                  value={route.color2}
                  onChange={(color2) => patchLayer<RouteLayer>(route.id, { color2 }, 'color2')}
                />
              ) : null}
              <Slider
                label="Width"
                value={route.width}
                min={2}
                max={30}
                onChange={(width) => patchLayer<RouteLayer>(route.id, { width }, 'width')}
              />
              <Slider
                label="Glow"
                value={route.glow}
                min={0}
                max={30}
                onChange={(glow) => patchLayer<RouteLayer>(route.id, { glow }, 'glow')}
              />
              <Toggle
                label="Dark edge, for bright photos"
                value={!!route.halo}
                onChange={(halo) => patchLayer<RouteLayer>(route.id, { halo })}
              />
              <Toggle
                label="Start and end markers"
                value={route.markers}
                onChange={(markers) => patchLayer<RouteLayer>(route.id, { markers })}
              />
            </Panel>
          ) : (
            <Button title="Add the route" kind="glass" onPress={() => addLayer(defaultRouteLayer())} />
          )
        ) : null}

        {tab === 'metrics' ? (
          metrics ? (
            <Panel>
              <Toggle label="Show metrics" value={metrics.visible} onChange={(visible) => patchLayer(metrics.id, { visible })} />
              {metrics.items.map((item) => (
                <Toggle
                  key={item.key}
                  label={METRIC_LABEL[item.key]}
                  value={item.enabled}
                  onChange={(enabled) =>
                    patchLayer<MetricsLayer>(metrics.id, {
                      items: metrics.items.map((i) => (i.key === item.key ? { ...i, enabled } : i)),
                    })
                  }
                />
              ))}
              <Chips
                options={[
                  { value: 'row', label: 'Row' },
                  { value: 'column', label: 'Column' },
                  { value: 'grid', label: 'Grid' },
                ]}
                value={metrics.layout}
                onChange={(layout) => patchLayer<MetricsLayer>(metrics.id, { layout })}
              />
              <Chips options={FONTS} value={metrics.font} onChange={(font) => patchLayer<MetricsLayer>(metrics.id, { font })} />
              <Chips options={ALIGN} value={metrics.align} onChange={(align) => patchLayer<MetricsLayer>(metrics.id, { align })} />
              <Slider
                label="Size"
                value={metrics.size}
                min={24}
                max={160}
                onChange={(size) => patchLayer<MetricsLayer>(metrics.id, { size }, 'size')}
              />
              <Toggle
                label="Dark shade behind the numbers"
                value={!!metrics.shade}
                onChange={(shade) => patchLayer<MetricsLayer>(metrics.id, { shade })}
              />
              <Toggle
                label="Labels under values"
                value={metrics.showLabels}
                onChange={(showLabels) => patchLayer<MetricsLayer>(metrics.id, { showLabels })}
              />
              <Chips
                options={[
                  { value: 'all', label: 'All metrics' },
                  ...metrics.items.filter((i) => i.enabled).map((i) => ({ value: i.key, label: METRIC_LABEL[i.key] })),
                ]}
                value={metricTarget}
                onChange={(t) => setMetricTarget(t as MetricKey | 'all')}
              />
              <ColorPicker
                label={metricTarget === 'all' ? 'Metric color' : `${METRIC_LABEL[metricTarget]} color`}
                value={
                  metricTarget === 'all'
                    ? metrics.color
                    : (metrics.items.find((i) => i.key === metricTarget)?.color ?? metrics.color)
                }
                onChange={(color) =>
                  metricTarget === 'all'
                    ? patchLayer<MetricsLayer>(metrics.id, {
                        color,
                        items: metrics.items.map(({ color: _old, ...i }) => i),
                      })
                    : patchLayer<MetricsLayer>(metrics.id, {
                        items: metrics.items.map((i) => (i.key === metricTarget ? { ...i, color } : i)),
                      })
                }
              />
              <ColorPicker
                label="Label color"
                value={metrics.labelColor}
                onChange={(labelColor) => patchLayer<MetricsLayer>(metrics.id, { labelColor })}
              />
            </Panel>
          ) : (
            <Button title="Add metrics" kind="glass" onPress={() => addLayer(defaultMetricsLayer())} />
          )
        ) : null}

        {tab === 'photos' ? (
          <Panel>
            <Button
              title={collage ? `From device (${collage.cells.length}/${MAX_PHOTOS})` : 'Upload from device'}
              kind="glass"
              onPress={() => pickPhotos('device')}
              icon={<Ionicons name="images-outline" size={17} color={colors.ink} />}
            />
            <Button
              title="Take a photo"
              kind="glass"
              onPress={() => pickPhotos('camera')}
              icon={<Ionicons name="camera-outline" size={17} color={colors.ink} />}
            />
            {collage ? (
              <>
                <T v="small" muted>
                  Layout
                </T>
                <Chips
                  options={layoutsFor(collage.cells.length).map((l, i) => ({ value: l.id, label: `Style ${i + 1}` }))}
                  value={layoutById(collage.layoutId, collage.cells.length).id}
                  onChange={(layoutId) => patchLayer<CollageLayer>(collage.id, { layoutId })}
                />
                <Slider
                  label="Spacing"
                  value={collage.gap}
                  min={0}
                  max={40}
                  onChange={(gap) => patchLayer<CollageLayer>(collage.id, { gap }, 'gap')}
                />
                <Slider
                  label="Corner radius"
                  value={collage.cornerRadius}
                  min={0}
                  max={100}
                  onChange={(cornerRadius) => patchLayer<CollageLayer>(collage.id, { cornerRadius }, 'radius')}
                />
                <T v="small" muted>
                  Photo {selectedCell + 1} of {collage.cells.length}. Tap a photo in the image to pick it, and use
                  “Moving inside” to drag or pinch it within its frame.
                </T>
                {cell ? (
                  <>
                    <Chips
                      options={FILTER_PRESETS.map((f) => ({ value: f.id, label: f.label }))}
                      value={cell.filter.preset}
                      onChange={(preset) => updateFilter({ preset }, null)}
                    />
                    {(
                      [
                        ['brightness', 'Brightness', -1, 1],
                        ['contrast', 'Contrast', -1, 1],
                        ['saturation', 'Saturation', -1, 1],
                        ['warmth', 'Warmth', -1, 1],
                        ['vignette', 'Vignette', 0, 1],
                      ] as const
                    ).map(([key, label, min, max]) => (
                      <Slider
                        key={key}
                        label={label}
                        value={cell.filter[key]}
                        min={min}
                        max={max}
                        format={(v) => `${Math.round(v * 100)}`}
                        onChange={(v) => updateFilter({ [key]: v }, key)}
                      />
                    ))}
                    <Button title="Remove this photo" kind="ghost" onPress={removeCell} />
                  </>
                ) : null}
              </>
            ) : null}
          </Panel>
        ) : null}

        {tab === 'text' ? (
          <Panel>
            <Button title="Add text" kind="glass" onPress={() => addLayer(defaultTextLayer())} />
            {selectedText ? (
              <>
                <Field
                  label="Text"
                  value={selectedText.text}
                  multiline
                  maxLength={160}
                  onChangeText={(text) => patchLayer<TextLayer>(selectedText.id, { text }, 'text')}
                />
                <Chips options={FONTS} value={selectedText.font} onChange={(font) => patchLayer<TextLayer>(selectedText.id, { font })} />
                <Chips options={ALIGN} value={selectedText.align} onChange={(align) => patchLayer<TextLayer>(selectedText.id, { align })} />
                <Slider
                  label="Size"
                  value={selectedText.size}
                  min={20}
                  max={220}
                  onChange={(size) => patchLayer<TextLayer>(selectedText.id, { size }, 'size')}
                />
                <ColorPicker
                  label="Color"
                  value={selectedText.color}
                  onChange={(color) => patchLayer<TextLayer>(selectedText.id, { color }, 'color')}
                />
              </>
            ) : null}
          </Panel>
        ) : null}

        {tab === 'presets' ? (
          <Panel>
            <Field label="Save this design as" value={presetName} onChangeText={setPresetName} maxLength={80} />
            <Button title="Save preset" kind="glass" disabled={!presetName.trim()} onPress={savePreset} />
            {(presets ?? []).map((p) => (
              <View key={p.id} style={styles.layerRow}>
                <Pressable accessibilityRole="button" style={{ flex: 1 }} onPress={() => applyPreset(p.doc)}>
                  <T numberOfLines={1}>{p.name}</T>
                  <T v="small" faint>
                    Tap to apply
                  </T>
                </Pressable>
                <IconButton label="Delete preset" icon="trash-outline" onPress={() => deletePreset(p.id)} />
              </View>
            ))}
            <Button title="Reset to default design" kind="ghost" onPress={() => change(() => defaultDoc())} />
          </Panel>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const TRIM_M = 200;
const defaultDocStable = defaultDoc();

function IconButton({
  label,
  icon,
  onPress,
  disabled,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} hitSlop={4} onPress={onPress} style={styles.smallIcon}>
      <Ionicons name={icon} size={17} color={disabled ? colors.textFaint : colors.ink} />
    </Pressable>
  );
}

/** Shows which parts of a transparent image are see-through. Never exported. */
function Checker({ w, h }: { w: number; h: number }) {
  const size = 12;
  const squares = [];
  for (let y = 0; y < h; y += size) {
    for (let x = 0; x < w; x += size) {
      if ((x / size + y / size) % 2 === 0) squares.push([x, y]);
    }
  }
  return (
    <Group>
      <Rect x={0} y={0} width={w} height={h} color="#FFFFFF" />
      {squares.map(([x, y]) => (
        <Rect key={`${x}-${y}`} x={x} y={y} width={size} height={size} color="#E4E4E7" />
      ))}
    </Group>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.md, paddingBottom: space.sm },
  icon: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  smallIcon: { width: 30, height: 34, alignItems: 'center', justifyContent: 'center' },
  action: { minHeight: 40, paddingHorizontal: space.lg, marginLeft: space.xs },
  previewArea: { alignItems: 'center', justifyContent: 'center' },
  preview: { boxShadow: shadow.raised, backgroundColor: colors.bgSoft },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 34 },
  tabs: { flexGrow: 0, flexShrink: 0, height: 52 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 38,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.paper,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  tabOn: { backgroundColor: colors.ink, borderColor: colors.ink, boxShadow: shadow.button },
  customRatio: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  ratioInput: {
    width: 54,
    height: 40,
    textAlign: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.fieldBg,
    color: colors.text,
  },
  layerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: 48,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  layerRowOn: { borderColor: colors.ink, boxShadow: shadow.card },
});
