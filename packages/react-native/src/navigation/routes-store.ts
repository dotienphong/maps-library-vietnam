import {
  altRouteFeatures,
  type DirectionsResponse,
  decodeFleet,
  decodeRoutes,
  EMPTY_ROUTE_FEATURES,
  FLEET_COLORS,
  type FleetPlanResponse,
  fleetRouteFeatures,
  liveRouteFeatures,
  type RouteFeatureCollection,
  type RouteProgressCut,
} from '@mapslibvn/core';

/** Kế hoạch đội xe đang vẽ (spec 2026-09-23 mục 6.3). */
export interface FleetSnapshot {
  plan: FleetPlanResponse;
  /** Xe được chọn (xe khác mờ); null = mọi xe rõ. */
  active: number | null;
  colors: readonly string[];
  /** Vẽ marker màu xe tại từng đơn (mặc định true). */
  markers: boolean;
}

export interface RoutesSnapshot {
  response: DirectionsResponse | null;
  active: number;
  progress: RouteProgressCut | null;
  puck: boolean;
  /**
   * Tuyến thay thế. Tham chiếu CHỈ đổi khi tập tuyến hoặc tuyến đang chọn đổi — mỗi lần định vị
   * không đụng tới, nên source của chúng không phải đẩy lại qua cầu native (B1).
   */
  altFeatures: RouteFeatureCollection;
  /** Tuyến đang đi (đã cắt theo tiến độ) và puck — phần duy nhất đổi theo từng lần định vị. */
  liveFeatures: RouteFeatureCollection;
  /** Kế hoạch đội xe; loại trừ với `response`. */
  fleet: FleetSnapshot | null;
  /** Feature `fleet` — chỉ dựng lại khi showFleet/setActive, định vị không đụng tới (B1). */
  fleetFeatures: RouteFeatureCollection;
}

/** Nguồn sự thật cho lớp vẽ tuyến; `useSyncExternalStore` đọc `getSnapshot` (object mới mỗi lần đổi). */
export interface RoutesStore {
  getSnapshot(): RoutesSnapshot;
  subscribe(onChange: () => void): () => void;
  show(response: DirectionsResponse, opts?: { active?: number }): void;
  showFleet(
    plan: FleetPlanResponse,
    opts?: { active?: number | null; colors?: readonly string[]; markers?: boolean },
  ): void;
  setActive(index: number): void;
  setProgress(cut: RouteProgressCut | null): void;
  setPuck(on: boolean): void;
  clear(): void;
}

export function createRoutesStore(): RoutesStore {
  let coords: [number, number][][] = [];
  let fleetCoords: [number, number][][] = [];
  let snapshot: RoutesSnapshot = {
    response: null,
    active: 0,
    progress: null,
    puck: true,
    altFeatures: EMPTY_ROUTE_FEATURES,
    liveFeatures: EMPTY_ROUTE_FEATURES,
    fleet: null,
    fleetFeatures: EMPTY_ROUTE_FEATURES,
  };
  const listeners = new Set<() => void>();

  /**
   * `rebuildAlt` chỉ bật khi tập toạ độ đổi (`show`); đổi `active` cũng phải dựng lại vì tuyến vừa
   * rời khỏi vai trò active nay là alt. Mọi đường khác — nhất là `setProgress` chạy 1 Hz — dùng lại
   * nguyên tham chiếu cũ.
   */
  const set = (
    patch: Partial<Omit<RoutesSnapshot, 'altFeatures' | 'liveFeatures' | 'fleetFeatures'>>,
    rebuildAlt = false,
    rebuildFleet = false,
  ): void => {
    const next = { ...snapshot, ...patch } as RoutesSnapshot;
    next.altFeatures = !next.response
      ? EMPTY_ROUTE_FEATURES
      : rebuildAlt || next.active !== snapshot.active || !snapshot.response
        ? altRouteFeatures(coords, next.active)
        : snapshot.altFeatures;
    next.liveFeatures = next.response
      ? liveRouteFeatures(coords, { active: next.active, progress: next.progress, puck: next.puck })
      : EMPTY_ROUTE_FEATURES;
    next.fleetFeatures = !next.fleet
      ? EMPTY_ROUTE_FEATURES
      : rebuildFleet
        ? fleetRouteFeatures(fleetCoords, { colors: next.fleet.colors, active: next.fleet.active })
        : snapshot.fleetFeatures;
    snapshot = next;
    for (const fn of listeners) fn();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(onChange) {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    show(response, opts = {}) {
      coords = decodeRoutes(response);
      fleetCoords = [];
      set({ response, active: opts.active ?? 0, progress: null, fleet: null }, true);
    },
    showFleet(plan, opts = {}) {
      coords = [];
      fleetCoords = decodeFleet(plan);
      set(
        {
          response: null,
          progress: null,
          fleet: {
            plan,
            active: opts.active ?? null,
            colors: opts.colors && opts.colors.length > 0 ? opts.colors : FLEET_COLORS,
            markers: opts.markers ?? true,
          },
        },
        false,
        true,
      );
    },
    setActive(index) {
      if (snapshot.fleet) {
        set({ fleet: { ...snapshot.fleet, active: index } }, false, true);
        return;
      }
      set({ active: index, progress: null });
    },
    setProgress(cut) {
      // Tiến độ dẫn đường chỉ có nghĩa với một tuyến; ở chế độ đội xe thì bỏ qua.
      if (snapshot.fleet) return;
      set({ progress: cut });
    },
    setPuck(on) {
      if (on !== snapshot.puck) set({ puck: on });
    },
    clear() {
      coords = [];
      fleetCoords = [];
      set({ response: null, progress: null, fleet: null });
    },
  };
}
