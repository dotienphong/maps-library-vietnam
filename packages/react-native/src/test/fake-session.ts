import type { DirectionsResponse, NavigationProgress, Route, RouteStep } from '@mapslibvn/core';
import { vi } from 'vitest';
import type { NavigationSession } from '../navigation/session';

/** Phiên giả điều khiển được từ test: phát sự kiện, đổi state/response. */
export function fakeSession(
  init: { response?: DirectionsResponse; routeIndex?: number; state?: NavigationProgress } = {},
) {
  const handlers: Record<string, ((e: unknown) => void)[]> = {};
  let response: DirectionsResponse | null = init.response ?? null;
  let routeIndex = init.routeIndex ?? 0;
  let state: NavigationProgress | null = init.state ?? null;
  const session = {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    reroute: vi.fn(async () => {}),
    setRoute: vi.fn(),
    on: vi.fn((ev: string, fn: (e: unknown) => void) => {
      handlers[ev] ??= [];
      handlers[ev].push(fn);
    }),
    off: vi.fn((ev: string, fn: (e: unknown) => void) => {
      handlers[ev] = (handlers[ev] ?? []).filter((h) => h !== fn);
    }),
    get status() {
      return state?.status ?? 'idle';
    },
    get state() {
      return state;
    },
    get response() {
      return response;
    },
    get routeIndex() {
      return routeIndex;
    },
  } as unknown as NavigationSession;
  const emit = (ev: string, e: unknown) => {
    for (const fn of handlers[ev] ?? []) fn(e);
  };
  return {
    session,
    emit,
    progress(p: NavigationProgress) {
      state = p;
      emit('progress', p);
    },
    route(r: DirectionsResponse, i = 0) {
      response = r;
      routeIndex = i;
      emit('route', { response: r, routeIndex: i });
    },
    status(s: NavigationProgress['status']) {
      emit('status', { status: s, previous: 'idle' });
    },
    handlerCount: (ev: string) => (handlers[ev] ?? []).length,
  };
}

/** Một NavigationProgress hợp lệ tại `shapeIndex` trên tuyến fixture. */
export function progressAt(
  route: Route,
  shapeIndex: number,
  timestamp = 1_700_000_000_000,
): NavigationProgress {
  const step = route.legs[0]?.steps[0] as RouteStep;
  return {
    status: 'navigating',
    route,
    routeIndex: 0,
    legIndex: 0,
    stepIndex: 0,
    step,
    nextStep: route.legs[0]?.steps[1] ?? null,
    snapped: [106.6985, 10.7791],
    bearing: 45,
    shapeIndex,
    traveled_m: 100,
    remaining_m: 900,
    remaining_s: 120,
    distanceToStep_m: 50,
    offRoute_m: 2,
    fix: { lng: 106.6985, lat: 10.7791, timestamp },
  };
}
