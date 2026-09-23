import {
  type DirectionsResponse,
  decodeFleet,
  decodeRoutes,
  EMPTY_ROUTE_FEATURES,
  FLEET_COLORS,
  type FleetPlanResponse,
  fleetRouteFeatures,
  type RouteProgressCut,
  routeFeatures,
} from '@mapslibvn/core';
import type * as maplibregl from 'maplibre-gl';

export const ROUTE_SOURCE_ID = 'mapslibvn-route';
/** Source riêng cho kế hoạch đội xe: dữ liệu chỉ đổi khi showFleet/setActive, không theo định vị. */
export const FLEET_SOURCE_ID = 'mapslibvn-fleet';
export const ROUTE_LAYER_IDS = {
  alt: 'mapslibvn-route-alt',
  casing: 'mapslibvn-route-casing',
  line: 'mapslibvn-route-line',
  traveled: 'mapslibvn-route-traveled',
  fleetCasing: 'mapslibvn-fleet-casing',
  fleetLine: 'mapslibvn-fleet-line',
} as const;
export const ROUTE_COLOR = '#2458a6';
const ALT_COLOR = '#9ca8ba';
const DESTINATION_COLOR = '#d92d20';

export interface RoutesLayer {
  show(response: DirectionsResponse, opts?: { active?: number; markers?: boolean }): void;
  /**
   * Vẽ cả đội: mỗi xe một màu (mặc định FLEET_COLORS), marker màu xe tại từng đơn. Bấm tuyến phát
   * `routeClick` với `index` = chỉ số xe; `setActive(i)` làm mờ xe khác. Loại trừ với `show()`.
   */
  showFleet(
    plan: FleetPlanResponse,
    opts?: { active?: number | null; colors?: readonly string[]; markers?: boolean },
  ): void;
  /** Tuyến thường: đổi tuyến chính. Đội xe: làm mờ mọi xe trừ xe `index`. */
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

  interface FleetState {
    plan: FleetPlanResponse;
    coords: [number, number][][];
    colors: readonly string[];
    active: number | null;
    markers: boolean;
  }
  let fleet: FleetState | null = null;
  let fleetClickBound = false;
  const ROUND: NonNullable<maplibregl.LineLayerSpecification['layout']> = {
    'line-join': 'round',
    'line-cap': 'round',
  };

  const ensureFleetLayers = (): void => {
    if (gl.getSource(FLEET_SOURCE_ID)) return;
    gl.addSource(FLEET_SOURCE_ID, { type: 'geojson', data: EMPTY_ROUTE_FEATURES as GeoJsonData });
    const before = firstSymbolLayerId();
    gl.addLayer(
      {
        id: ROUTE_LAYER_IDS.fleetCasing,
        type: 'line',
        source: FLEET_SOURCE_ID,
        layout: ROUND,
        paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': ['get', 'opacity'] },
      },
      before,
    );
    gl.addLayer(
      {
        id: ROUTE_LAYER_IDS.fleetLine,
        type: 'line',
        source: FLEET_SOURCE_ID,
        layout: ROUND,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 6,
          'line-opacity': ['get', 'opacity'],
        },
      },
      before,
    );
    if (!fleetClickBound) {
      fleetClickBound = true;
      gl.on('click', ROUTE_LAYER_IDS.fleetLine, (e) => {
        const index = e.features?.[0]?.properties?.index;
        if (typeof index === 'number') onRouteClick(index);
      });
    }
  };

  const setFleetData = (): void => {
    const source = gl.getSource(FLEET_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    const data = fleet
      ? fleetRouteFeatures(fleet.coords, { colors: fleet.colors, active: fleet.active })
      : EMPTY_ROUTE_FEATURES;
    source.setData(data as GeoJsonData);
  };

  /** Cùng cách với `apply()`: thử thật, chỉ hoãn khi maplibre nói style chưa phân giải. */
  const applyFleet = (): void => {
    if (!fleet) return;
    try {
      ensureFleetLayers();
    } catch (error) {
      if (!(error instanceof Error) || !/not done loading/i.test(error.message)) throw error;
      return;
    }
    setFleetData();
  };

  const placeFleetMarkers = (): void => {
    clearMarkers();
    if (!fleet?.markers) return;
    for (const [i, v] of fleet.plan.vehicles.entries()) {
      const color = fleet.colors[i % fleet.colors.length] ?? '#0072b2';
      // waypoints = start, các đơn theo thứ tự ghé, end (nếu có): đơn nằm ở 1…jobs.length.
      for (let j = 1; j <= v.jobs.length; j++) {
        const w = v.waypoints[j];
        if (w) markers.push(new ml.Marker({ color }).setLngLat(w.snapped).addTo(gl));
      }
    }
  };

  // App đổi style → source/layer mất; thêm lại khi style mới load xong.
  gl.on('style.load', () => {
    if (response && !gl.getSource(ROUTE_SOURCE_ID)) {
      ensureLayers();
      setData();
    }
    if (fleet && !gl.getSource(FLEET_SOURCE_ID)) {
      ensureFleetLayers();
      setFleetData();
    }
  });

  return {
    show(next, opts = {}) {
      fleet = null;
      setFleetData();
      response = next;
      coords = decodeRoutes(next);
      active = opts.active ?? 0;
      showMarkers = opts.markers ?? true;
      progress = null;
      apply();
      placeMarkers();
    },
    showFleet(plan, opts = {}) {
      response = null;
      coords = [];
      progress = null;
      setData();
      fleet = {
        plan,
        coords: decodeFleet(plan),
        colors: opts.colors && opts.colors.length > 0 ? opts.colors : FLEET_COLORS,
        active: opts.active ?? null,
        markers: opts.markers ?? true,
      };
      applyFleet();
      placeFleetMarkers();
    },
    setActive(index) {
      if (fleet) {
        fleet.active = index;
        setFleetData();
        return;
      }
      active = index;
      progress = null;
      setData();
    },
    setProgress(shapeIndex, snapped) {
      // Tiến độ dẫn đường chỉ có nghĩa với một tuyến; ở chế độ đội xe thì bỏ qua.
      if (fleet) return;
      progress = { shapeIndex, snapped };
      setData();
    },
    clear() {
      response = null;
      coords = [];
      progress = null;
      fleet = null;
      clearMarkers();
      // Không đi qua `setData()`: `clear()` lúc chưa từng vẽ là chuyện bình thường, không phải
      // chuyện đáng cảnh báo.
      const source = gl.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      source?.setData(EMPTY_ROUTE_FEATURES as GeoJsonData);
      setFleetData();
    },
  };
}
