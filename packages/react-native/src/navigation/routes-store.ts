import {
  type DirectionsResponse,
  EMPTY_ROUTE_FEATURES,
  type RouteFeatureCollection,
  type RouteProgressCut,
  decodeRoutes,
  routeFeatures,
} from '@mapslibvn/core';

export interface RoutesSnapshot {
  response: DirectionsResponse | null;
  active: number;
  progress: RouteProgressCut | null;
  puck: boolean;
  features: RouteFeatureCollection;
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
    features: EMPTY_ROUTE_FEATURES,
  };
  const listeners = new Set<() => void>();

  const set = (patch: Partial<Omit<RoutesSnapshot, 'features'>>): void => {
    const next: RoutesSnapshot = { ...snapshot, ...patch };
    next.features = next.response
      ? routeFeatures(coords, { active: next.active, progress: next.progress, puck: next.puck })
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
      set({ response, active: opts.active ?? 0, progress: null });
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
