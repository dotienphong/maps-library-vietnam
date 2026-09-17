import {
  type DirectionsResponse,
  decodeRoutes,
  EMPTY_ROUTE_FEATURES,
  type RouteProgressCut,
  routeFeatures,
} from '@mapslibvn/core';
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
type GeoJsonData = Parameters<maplibregl.GeoJSONSource['setData']>[0];

export function createRoutesLayer(
  gl: maplibregl.Map,
  ml: { Marker: typeof maplibregl.Marker },
  onRouteClick: (index: number) => void,
): RoutesLayer {
  let response: DirectionsResponse | null = null;
  let coords: [number, number][][] = [];
  let active = 0;
  let showMarkers = true;
  let progress: RouteProgressCut | null = null;
  let markers: maplibregl.Marker[] = [];
  let clickBound = false;
  let daCanhBao = false;

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
    gl.addSource(ROUTE_SOURCE_ID, { type: 'geojson', data: EMPTY_ROUTE_FEATURES as GeoJsonData });
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
    daCanhBao = false;
    if (!clickBound) {
      clickBound = true;
      gl.on('click', ROUTE_LAYER_IDS.alt, (e) => {
        const index = e.features?.[0]?.properties?.index;
        if (typeof index === 'number') onRouteClick(index);
      });
    }
  };

  const setData = (): void => {
    const source = gl.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!source) {
      // `source?.setData(...)` im lặng chính là lý do lỗi "lúc vẽ lúc không" sống sót lâu: có
      // tuyến để vẽ, không có chỗ vẽ, và mỗi lần định vị trôi qua không để lại dấu vết nào.
      // Cảnh báo đúng MỘT lần — `progress` chạy 1 Hz, log mỗi lần thì console thành vô dụng.
      if (response && !daCanhBao) {
        daCanhBao = true;
        console.warn(
          '[mapslibvn] có tuyến nhưng chưa có source trên bản đồ — tuyến sẽ không hiện. Style đã load xong chưa?',
        );
      }
      return;
    }
    const data = response ? routeFeatures(coords, { active, progress }) : EMPTY_ROUTE_FEATURES;
    source.setData(data as GeoJsonData);
  };

  const apply = (): void => {
    if (!response) return;
    // KHÔNG hỏi `gl.isStyleLoaded()`. `Style.loaded()` của maplibre (6.9.1) còn đòi mọi tile và ảnh
    // tải xong, trong khi `addSource` chỉ đòi style đã phân giải (`_checkLoaded` chỉ xem `_loaded`).
    // Hỏi nhầm câu thì bấm dẫn đường đúng lúc bản đồ đang kéo/phóng sẽ rơi vào nhánh chờ
    // `style.load` — sự kiện đã bắn từ lâu và KHÔNG bao giờ bắn lại — nên tuyến không bao giờ hiện,
    // còn mỗi lần định vị sau đó im lặng trôi qua vì `setData()` dùng `source?.`. Sự cố 17/09/2026.
    //
    // Cứ thử thật. Style chưa phân giải xong thì maplibre ném đúng một lỗi nhận ra được, và lúc đó
    // `style.load` CHẮC CHẮN còn bắn — handler bên dưới sẽ dựng lại.
    try {
      ensureLayers();
    } catch (error) {
      if (!(error instanceof Error) || !/not done loading/i.test(error.message)) throw error;
      return;
    }
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
      coords = decodeRoutes(next);
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
      // Không đi qua `setData()`: `clear()` lúc chưa từng vẽ là chuyện bình thường, không phải
      // chuyện đáng cảnh báo.
      const source = gl.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      source?.setData(EMPTY_ROUTE_FEATURES as GeoJsonData);
    },
  };
}
