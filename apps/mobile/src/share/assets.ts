import { StaticMapImageManager } from '@maplibre/maplibre-react-native';
import { Skia, SkImage, useFonts } from '@shopify/react-native-skia';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildMapStyle } from '@/lib/mapStyle';
import { LngLat } from '@/lib/track';
import { MapLayer, ShareDoc } from './doc';
import { BUNDLED_FONTS, mapCamera, mapLogicalSize } from './scene';

/** Fonts for share images. Shipped with the app, because phones differ in which fonts they have. */
export function useShareFonts() {
  return useFonts({
    [BUNDLED_FONTS.sans]: [
      require('../../assets/fonts/Poppins-Light.ttf'),
      require('../../assets/fonts/Poppins-Regular.ttf'),
      require('../../assets/fonts/Poppins-SemiBold.ttf'),
      require('../../assets/fonts/Poppins-Bold.ttf'),
    ],
    [BUNDLED_FONTS.mono]: [require('../../assets/fonts/jetbrains_mono_regular.ttf')],
  });
}

async function loadImage(uri: string): Promise<SkImage | null> {
  const data = await Skia.Data.fromURI(uri);
  return Skia.Image.MakeImageFromEncoded(data);
}

const MAX_PHOTO_SIDE = 2048;

/**
 * Copies a chosen photo into app storage, downscaled and re-encoded. This keeps drafts working if
 * the original moves, limits memory, and strips EXIF data such as the photo's GPS location.
 */
export async function importPhoto(uri: string, width: number, height: number): Promise<string> {
  const dir = new Directory(Paths.document, 'share-photos');
  if (!dir.exists) dir.create({ intermediates: true });

  const context = ImageManipulator.manipulate(uri);
  const long = Math.max(width, height);
  if (long > MAX_PHOTO_SIDE) {
    context.resize(width >= height ? { width: MAX_PHOTO_SIDE } : { height: MAX_PHOTO_SIDE });
  }
  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
  const target = new File(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
  await new File(result.uri).copy(target);
  return target.uri;
}

/** Static map image for a layer. Zoom +1 at double size shows the exact same view, only sharper. */
export async function renderMapImage(
  layer: MapLayer,
  lines: LngLat[][],
  doc: ShareDoc,
  sharpness: 1 | 2 = 1,
): Promise<SkImage | null> {
  const camera = mapCamera(layer, lines, doc);
  if (!camera) return null;
  const size = mapLogicalSize(layer.frame, doc);
  const uri = await StaticMapImageManager.createImage({
    mapStyle: buildMapStyle(layer.colors, layer.labels),
    center: [camera.lng, camera.lat],
    zoom: camera.zoom + (sharpness === 2 ? 1 : 0),
    width: size.w * sharpness,
    height: size.h * sharpness,
    output: 'file',
    logo: false,
  });
  return loadImage(uri);
}

function mapKey(layer: MapLayer, doc: ShareDoc, lines: LngLat[][]) {
  const camera = mapCamera(layer, lines, doc);
  const size = mapLogicalSize(layer.frame, doc);
  return JSON.stringify([layer.colors, layer.labels, camera, size]);
}

/** Keeps a Skia image per map layer up to date, waiting for a color drag to settle first. */
export function useMapImages(doc: ShareDoc, lines: LngLat[][]) {
  const [images, setImages] = useState<Record<string, SkImage | null>>({});
  const [failed, setFailed] = useState(false);
  // Starts true, so Share can't run before the first map image exists.
  const [loading, setLoading] = useState(true);
  const cache = useRef(new Map<string, SkImage>());

  const wanted = useMemo(
    () =>
      doc.layers
        .filter((l): l is MapLayer => l.kind === 'map' && l.visible)
        .map((layer) => ({ layer, key: mapKey(layer, doc, lines) })),
    [doc, lines],
  );
  const wantedKey = wanted.map((w) => `${w.layer.id}:${w.key}`).join('|');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      let anyFailed = false;
      for (const { layer, key } of wanted) {
        let image = cache.current.get(key) ?? null;
        if (!image) {
          try {
            image = await renderMapImage(layer, lines, doc);
            if (image) cache.current.set(key, image);
          } catch (e) {
            console.warn('Map image failed', e);
            anyFailed = true;
          }
        }
        if (cancelled) return;
        // Always replaced, even with nothing. Keeping an old image could show a location the
        // privacy trim just removed.
        setImages((prev) => ({ ...prev, [layer.id]: image }));
      }
      if (cancelled) return;
      setFailed(anyFailed);
      setLoading(false);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // wantedKey captures every input that changes the image.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedKey]);

  return { images, failed, loading };
}

export function usePhotoImages(doc: ShareDoc) {
  const [photos, setPhotos] = useState<Record<string, SkImage | null>>({});
  const uris = useMemo(() => {
    const all = new Set<string>();
    doc.layers.forEach((l) => {
      if (l.kind === 'collage') l.cells.forEach((c) => all.add(c.uri));
    });
    return [...all];
  }, [doc.layers]);
  const key = uris.join('|');

  useEffect(() => {
    uris.forEach((uri) => {
      if (photos[uri]) return;
      loadImage(uri)
        .then((image) => setPhotos((prev) => ({ ...prev, [uri]: image })))
        .catch((e) => {
          console.warn("Could not load photo", e);
          setPhotos((prev) => ({ ...prev, [uri]: null }));
        });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return photos;
}
