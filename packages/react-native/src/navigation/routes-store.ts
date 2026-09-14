import {
  type DirectionsResponse,
  EMPTY_ROUTE_FEATURES,
  type RouteFeatureCollection,
  type RouteProgressCut,
  altRouteFeatures,
  decodeRoutes,
  liveRouteFeatures,
} from '@mapslibvn/core';

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
}

/** Nguồn sự thật cho lớp vẽ tuyến; `useSyncExternalStore` đọc `getSnapshot` (object mới mỗi lần đổi). */
export interface RoutesStore {
  getSnapshot(): RoutesSnapshot;
  subscribe(onChange: () => void): () => void;
  show(response: DirectionsResponse, opts?: { active?: number }): void;
  setActive(index: number): void;
  setProgress(cut: RouteProgressCut | null): void;
  setPuck(on: boolean): void;
  clear(): void;
}

export function createRoutesStore(): RoutesStore {
  let coords: [number, number][][] = [];
  let snapshot: RoutesSnapshot = {
    response: null,
    active: 0,
    progress: null,
    puck: true,
    altFeatures: EMPTY_ROUTE_FEATURES,
    liveFeatures: EMPTY_ROUTE_FEATURES,
  };
  const listeners = new Set<() => void>();

  /**
   * `rebuildAlt` chỉ bật khi tập toạ độ đổi (`show`); đổi `active` cũng phải dựng lại vì tuyến vừa
   * rời khỏi vai trò active nay là alt. Mọi đường khác — nhất là `setProgress` chạy 1 Hz — dùng lại
   * nguyên tham chiếu cũ.
   */
  const set = (
    patch: Partial<Omit<RoutesSnapshot, 'altFeatures' | 'liveFeatures'>>,
    rebuildAlt = false,
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
      set({ response, active: opts.active ?? 0, progress: null }, true);
    },
    setActive(index) {
      set({ active: index, progress: null });
    },
    setProgress(cut) {
      set({ progress: cut });
    },
    setPuck(on) {
      if (on !== snapshot.puck) set({ puck: on });
    },
    clear() {
      coords = [];
      set({ response: null, progress: null });
    },
  };
}
