import {
  type MapsLibVNClient,
  type PoiFeature,
  type Theme,
  attributionHtml,
  createClient,
  isPoiStyleLayer,
} from '@mapslibvn/core';
import type maplibregl from 'maplibre-gl';
import { type Lang, applyLanguage } from './language';
import { type ProtocolHost, ensurePmtilesProtocol } from './protocol';

export type { PoiFeature };

export interface CreateMapOptions {
  container: string | HTMLElement;
  apiKey: string;
  /** Gốc API MapsLibVN, ví dụ https://maps-api.example.com */
  apiBase: string;
  /** 'light' | 'dark' hoặc URL style tuỳ biến */
  style?: Theme | string;
  center?: [number, number];
  zoom?: number;
  lang?: Lang;
  /** Hiển thị lớp POI (khi đã phát hành) — mặc định true */
  poiLayer?: boolean;
  /** Attribution gọn (không có tuỳ chọn tắt) */
  compactAttribution?: boolean;
}

export interface MarkerOptions {
  lng: number;
  lat: number;
  popupHtml?: string;
  color?: string;
}

export interface MapEvents {
  poiClick: PoiFeature;
  load: undefined;
}

export interface Deps {
  maplibre: typeof maplibregl & ProtocolHost;
}

export interface MapsLibVNMap {
  gl: maplibregl.Map;
  places: MapsLibVNClient;
  addMarker(o: MarkerOptions): maplibregl.Marker;
  fitBounds(bbox: [number, number, number, number], padding?: number): void;
  flyTo(center: [number, number], zoom?: number): void;
  on<K extends keyof MapEvents>(event: K, handler: (e: MapEvents[K]) => void): void;
  off<K extends keyof MapEvents>(event: K, handler: (e: MapEvents[K]) => void): void;
  remove(): void;
}

const isTheme = (s: string): s is Theme => s === 'light' || s === 'dark';

export function createMap(opts: CreateMapOptions, deps?: Deps): MapsLibVNMap {
  const ml =
    deps?.maplibre ?? (globalThis as unknown as { maplibregl: Deps['maplibre'] }).maplibregl;
  if (!ml)
    throw new Error('Cần maplibre-gl: import maplibre-gl hoặc dùng bản UMD @mapslibvn/web/umd');
  ensurePmtilesProtocol(ml);

  const places = createClient({ apiKey: opts.apiKey, baseUrl: opts.apiBase });
  const styleOpt = opts.style ?? 'light';
  const style = isTheme(styleOpt) ? places.styleUrl(styleOpt) : styleOpt;

  const gl = new ml.Map({
    container: opts.container,
    style,
    center: opts.center ?? [106.7, 10.776],
    zoom: opts.zoom ?? 12,
    attributionControl: false,
  });
  gl.addControl(
    new ml.AttributionControl({
      compact: opts.compactAttribution ?? false,
      customAttribution: attributionHtml(),
    }),
  );

  const listeners: { [K in keyof MapEvents]: Set<(e: MapEvents[K]) => void> } = {
    poiClick: new Set(),
    load: new Set(),
  };
  const emit = <K extends keyof MapEvents>(k: K, e: MapEvents[K]) => {
    for (const fn of listeners[k]) fn(e);
  };

  gl.on('load', () => {
    if (opts.lang && opts.lang !== 'vi') applyLanguage(gl, opts.lang);
    if (opts.poiLayer === false) {
      for (const layer of gl.getStyle().layers ?? []) {
        if (isPoiStyleLayer(layer) && gl.getLayer(layer.id)) {
          gl.setLayoutProperty(layer.id, 'visibility', 'none');
        }
      }
    }
    emit('load', undefined);
  });

  gl.on('click', (e: maplibregl.MapMouseEvent) => {
    if (listeners.poiClick.size === 0 || !gl.getLayer('poi')) return;
    const f = gl.queryRenderedFeatures(e.point, { layers: ['poi'] })[0];
    if (!f || f.geometry.type !== 'Point') return;
    const p = f.properties as Record<string, unknown>;
    emit('poiClick', {
      id: String(p.id),
      name: String(p.name ?? ''),
      category: String(p.cat ?? ''),
      group: String(p.grp ?? ''),
      lngLat: f.geometry.coordinates as [number, number],
    });
  });

  return {
    gl,
    places,
    addMarker(o) {
      const marker = new ml.Marker(o.color ? { color: o.color } : undefined).setLngLat([
        o.lng,
        o.lat,
      ]);
      if (o.popupHtml) marker.setPopup(new ml.Popup({ offset: 24 }).setHTML(o.popupHtml));
      return marker.addTo(gl);
    },
    fitBounds(bbox, padding = 40) {
      gl.fitBounds(
        [
          [bbox[0], bbox[1]],
          [bbox[2], bbox[3]],
        ],
        { padding },
      );
    },
    flyTo(center, zoom) {
      gl.flyTo(zoom === undefined ? { center } : { center, zoom });
    },
    on(event, handler) {
      (listeners[event] as Set<unknown>).add(handler);
    },
    off(event, handler) {
      (listeners[event] as Set<unknown>).delete(handler);
    },
    remove() {
      gl.remove();
    },
  };
}
