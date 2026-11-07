/**
 * A small map style we fully control, on OpenFreeMap's free vector tiles. One function produces
 * both the black-and-white app map and any custom colors chosen in the share studio.
 */
export interface MapColors {
  land: string;
  water: string;
  road: string;
  park: string;
  building: string;
  label: string;
}

export const MONO_DARK: MapColors = {
  land: '#0B0B0B',
  water: '#1C1C1C',
  road: '#3A3A3A',
  park: '#111111',
  building: '#151515',
  label: '#8A8A8A',
};

export const MAP_THEMES: { name: string; colors: MapColors }[] = [
  { name: 'Black', colors: MONO_DARK },
  {
    name: 'White',
    colors: { land: '#F4F4F4', water: '#D8D8D8', road: '#FFFFFF', park: '#EAEAEA', building: '#E6E6E6', label: '#666666' },
  },
  {
    name: 'Night',
    colors: { land: '#0D1420', water: '#16263D', road: '#2C3E55', park: '#101C24', building: '#141D2B', label: '#7F93AB' },
  },
  {
    name: 'Forest',
    colors: { land: '#101A12', water: '#142A2C', road: '#33483A', park: '#17281A', building: '#18241A', label: '#86A08C' },
  },
  {
    name: 'Sand',
    colors: { land: '#EFE6D6', water: '#BCD4D8', road: '#FFFFFF', park: '#DDE0C2', building: '#E5DAC6', label: '#6F6450' },
  },
  {
    name: 'Blush',
    colors: { land: '#F7E3E3', water: '#C9D7EC', road: '#FFFFFF', park: '#EBDDD2', building: '#F0D8D8', label: '#7A5A5A' },
  },
];

export const MAP_ATTRIBUTION = '© OpenStreetMap · © OpenMapTiles · OpenFreeMap';

const TILEJSON = 'https://tiles.openfreemap.org/planet';
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

const roadWidth = (minor: number, major: number) => [
  'interpolate',
  ['exponential', 1.5],
  ['zoom'],
  8,
  ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], major * 0.25, minor * 0.1],
  16,
  ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], major * 3, minor * 2.2],
  20,
  ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], major * 12, minor * 9],
];

export function buildMapStyle(c: MapColors = MONO_DARK, labels = true) {
  const layers: object[] = [
    { id: 'land', type: 'background', paint: { 'background-color': c.land } },
    {
      id: 'park',
      type: 'fill',
      source: 'omt',
      'source-layer': 'park',
      paint: { 'fill-color': c.park },
    },
    {
      id: 'landcover',
      type: 'fill',
      source: 'omt',
      'source-layer': 'landcover',
      filter: ['in', ['get', 'class'], ['literal', ['wood', 'grass']]],
      paint: { 'fill-color': c.park },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'omt',
      'source-layer': 'water',
      paint: { 'fill-color': c.water },
    },
    {
      id: 'waterway',
      type: 'line',
      source: 'omt',
      'source-layer': 'waterway',
      paint: { 'line-color': c.water, 'line-width': 1.2 },
    },
    {
      id: 'building',
      type: 'fill',
      source: 'omt',
      'source-layer': 'building',
      minzoom: 14,
      paint: { 'fill-color': c.building },
    },
    {
      id: 'road',
      type: 'line',
      source: 'omt',
      'source-layer': 'transportation',
      filter: ['!=', ['get', 'class'], 'rail'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': c.road, 'line-width': roadWidth(1, 1.5) },
    },
  ];
  if (labels) {
    layers.push(
      {
        id: 'road-label',
        type: 'symbol',
        source: 'omt',
        'source-layer': 'transportation_name',
        minzoom: 14,
        layout: {
          'symbol-placement': 'line',
          'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
        },
        paint: { 'text-color': c.label, 'text-halo-color': c.land, 'text-halo-width': 1 },
      },
      {
        id: 'place-label',
        type: 'symbol',
        source: 'omt',
        'source-layer': 'place',
        layout: {
          'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
          'text-font': ['Noto Sans Regular'],
          'text-size': 12,
        },
        paint: { 'text-color': c.label, 'text-halo-color': c.land, 'text-halo-width': 1 },
      },
    );
  }
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: { omt: { type: 'vector', url: TILEJSON } },
    layers,
  };
}

/** MapLibre's Web Mercator: at zoom z the world is 512 * 2^z logical pixels wide. */
const TILE = 512;

export function project(lng: number, lat: number, zoom: number): [number, number] {
  const world = TILE * 2 ** zoom;
  const x = ((lng + 180) / 360) * world;
  const sin = Math.sin((Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * world;
  return [x, y];
}

export function unproject(x: number, y: number, zoom: number): [number, number] {
  const world = TILE * 2 ** zoom;
  const lng = (x / world) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / world))) * 180) / Math.PI;
  return [lng, lat];
}

export interface Camera {
  lng: number;
  lat: number;
  zoom: number;
}

/** The camera that fits a box into width x height, in the same logical pixels as `project`. */
export function fitCamera(
  box: { minLat: number; minLng: number; maxLat: number; maxLng: number },
  width: number,
  height: number,
  paddingFraction = 0.14,
): Camera {
  const [x0, y0] = project(box.minLng, box.maxLat, 0);
  const [x1, y1] = project(box.maxLng, box.minLat, 0);
  const spanX = Math.max(x1 - x0, 1e-9);
  const spanY = Math.max(y1 - y0, 1e-9);
  const usable = 1 - paddingFraction * 2;
  const zoom = Math.min(
    Math.log2((width * usable) / spanX),
    Math.log2((height * usable) / spanY),
    17,
  );
  const [lng, lat] = unproject((x0 + x1) / 2, (y0 + y1) / 2, 0);
  return { lng, lat, zoom: Math.max(zoom, 1) };
}

/** Where a coordinate lands inside a width x height map image for a given camera. */
export function toImagePoint(
  lng: number,
  lat: number,
  camera: Camera,
  width: number,
  height: number,
): [number, number] {
  const [cx, cy] = project(camera.lng, camera.lat, camera.zoom);
  const [x, y] = project(lng, lat, camera.zoom);
  return [x - cx + width / 2, y - cy + height / 2];
}
