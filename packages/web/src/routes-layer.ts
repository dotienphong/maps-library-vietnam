import { type DirectionsResponse, decodePolyline6 } from '@mapslibvn/core';
import type * as maplibregl from 'maplibre-gl';

export const ROUTE_SOURCE_ID = 'mapslibvn-route';
export const ROUTE_LAYER_IDS = {
  alt: 'mapslibvn-route-alt',
  casing: 'mapslibvn-route-casing',
  line: 'mapslibvn-route-line',
  traveled: 'mapslibvn-route-traveled',
} as const;
export const ROUTE_COLOR = '#2458a6';
const ALT_COLOR = '#9ca8ba';
const DESTINATION_COLOR = '#d92d20';

export interface RoutesLayer {
  show(response: DirectionsResponse, opts?: { active?: number; markers?: boolean }): void;
  setActive(index: number): void;
  /** Chia tuyến chính tại (`shapeIndex`, `snapped`): trước là đã đi, sau là còn lại. */
  setProgress(shapeIndex: number, snapped: [number, number]): void;
  clear(): void;
}

type Kind = 'alt' | 'active' | 'traveled';
interface LineFeature {
  type: 'Feature';
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  properties: { kind: Kind; index: number };
}
interface Collection {
  type: 'FeatureCollection';
  features: LineFeature[];
}
type GeoJsonData = Parameters<maplibregl.GeoJSONSource['setData']>[0];

const EMPTY: Collection = { type: 'FeatureCollection', features: [] };
const feature = (kind: Kind, index: number, coordinates: [number, number][]): LineFeature => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates },
  properties: { kind, index },
});

export function createRoutesLayer(
  gl: maplibregl.Map,
  ml: { Marker: typeof maplibregl.Marker },
  onRouteClick: (index: number) => void,
): RoutesLayer {
  let response: DirectionsResponse | null = null;
  let coords: [number, number][][] = [];
  let active = 0;
  let showMarkers = true;
  let progress: { shapeIndex: number; snapped: [number, number] } | null = null;
  let markers: maplibregl.Marker[] = [];
  let clickBound = false;

  const firstSymbolLayerId = (): string | undefined =>
    gl.getStyle()?.layers?.find((layer) => layer.type === 'symbol')?.id;

  const addLine = (
    id: string,
    kind: Kind,
    paint: NonNullable<maplibregl.LineLayerSpecification['paint']>,
    before: string | undefined,
  ): void => {
    gl.addLayer(
      {
        id,
        type: 'line',
        source: ROUTE_SOURCE_ID,
        filter: ['==', ['get', 'kind'], kind],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint,
      },
      before,
    );
  };

  const ensureLayers = (): void => {
    if (gl.getSource(ROUTE_SOURCE_ID)) return;
    gl.addSource(ROUTE_SOURCE_ID, { type: 'geojson', data: EMPTY as GeoJsonData });
    const before = firstSymbolLayerId();
    addLine(ROUTE_LAYER_IDS.alt, 'alt', { 'line-color': ALT_COLOR, 'line-width': 5 }, before);
    addLine(ROUTE_LAYER_IDS.casing, 'active', { 'line-color': '#ffffff', 'line-width': 9 }, before);
    addLine(ROUTE_LAYER_IDS.line, 'active', { 'line-color': ROUTE_COLOR, 'line-width': 6 }, before);
    addLine(
      ROUTE_LAYER_IDS.traveled,
      'traveled',
      { 'line-color': ROUTE_COLOR, 'line-width': 6, 'line-opacity': 0.35 },
      before,
    );
    if (!clickBound) {
      clickBound = true;
      gl.on('click', ROUTE_LAYER_IDS.alt, (e) => {
        const index = e.features?.[0]?.properties?.index;
        if (typeof index === 'number') onRouteClick(index);
      });
    }
  };

  const collection = (): Collection => {
    if (!response) return EMPTY;
    const features: LineFeature[] = [];
    response.routes.forEach((_route, i) => {
      const c = coords[i];
      if (!c) return;
      if (i !== active) {
        features.push(feature('alt', i, c));
        return;
      }
      if (progress && progress.shapeIndex < c.length - 1) {
        features.push(
          feature('traveled', i, [...c.slice(0, progress.shapeIndex + 1), progress.snapped]),
          feature('active', i, [progress.snapped, ...c.slice(progress.shapeIndex + 1)]),
        );
      } else {
        features.push(feature('active', i, c));
      }
    });
    return { type: 'FeatureCollection', features };
  };

  const setData = (): void => {
    const source = gl.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    source?.setData(collection() as GeoJsonData);
  };

  const apply = (): void => {
    if (!response) return;
    if (!gl.isStyleLoaded()) {
      gl.once('style.load', apply);
      return;
    }
    ensureLayers();
    setData();
  };

  const clearMarkers = (): void => {
    for (const m of markers) m.remove();
    markers = [];
  };
  const placeMarkers = (): void => {
    clearMarkers();
    if (!response || !showMarkers) return;
    const last = response.waypoints.length - 1;
    response.waypoints.forEach((w, i) => {
      if (i === 0) return;
      markers.push(
        new ml.Marker({ color: i === last ? DESTINATION_COLOR : ALT_COLOR })
          .setLngLat(w.snapped)
          .addTo(gl),
      );
    });
  };

  // App đổi style → source/layer mất; thêm lại khi style mới load xong.
  gl.on('style.load', () => {
    if (response && !gl.getSource(ROUTE_SOURCE_ID)) {
      ensureLayers();
      setData();
    }
  });

  return {
    show(next, opts = {}) {
      response = next;
      coords = next.routes.map((r) => decodePolyline6(r.geometry));
      active = opts.active ?? 0;
      showMarkers = opts.markers ?? true;
      progress = null;
      apply();
      placeMarkers();
    },
    setActive(index) {
      active = index;
      progress = null;
      setData();
    },
    setProgress(shapeIndex, snapped) {
      progress = { shapeIndex, snapped };
      setData();
    },
    clear() {
      response = null;
      coords = [];
      progress = null;
      clearMarkers();
      const source = gl.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      source?.setData(EMPTY as GeoJsonData);
    },
  };
}
