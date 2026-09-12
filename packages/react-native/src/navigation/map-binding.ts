import type { CameraRef, ViewPadding } from '@maplibre/maplibre-react-native';
import type { NavigationProgress, NavigationStatus, TravelMode } from '@mapslibvn/core';
import type { RefObject } from 'react';
import type { RoutesStore } from './routes-store';
import type { NavigationSession, NavigationSessionStartOptions, SessionEvents } from './session';

export interface FollowOptions {
  /** Mặc định theo phương tiện: walk 17, motorbike 16,5, car 15,5. */
  zoom?: number;
  /** Mặc định 45. */
  pitch?: number;
  padding?: ViewPadding;
}

export const FOLLOW_ZOOM: Readonly<Record<TravelMode, number>> = {
  walk: 17,
  motorbike: 16.5,
  car: 15.5,
};
export const FOLLOW_PITCH = 45;

export interface BindingEvents extends SessionEvents {
  followChange: boolean;
}

/** Thứ lộ ra qua `useMap().navigation` — uỷ quyền sang phiên, thêm bám camera của map này. */
export interface MapNavigationBinding {
  /** Phiên qua prop `navigation`, không thì phiên mặc định của map (tạo lười). */
  readonly session: NavigationSession;
  readonly following: boolean;
  recenter(): void;
  start(opts: NavigationSessionStartOptions): Promise<void>;
  stop(): Promise<void>;
  reroute(): Promise<void>;
  readonly state: NavigationProgress | null;
  readonly status: NavigationStatus;
  on<K extends keyof BindingEvents>(event: K, handler: (e: BindingEvents[K]) => void): void;
  off<K extends keyof BindingEvents>(event: K, handler: (e: BindingEvents[K]) => void): void;
}

export type AppStateStatus = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';
/** Phần của `AppState` (react-native) mà binding cần; tiêm được cho test. */
export interface AppStateLike {
  currentState: AppStateStatus;
  addEventListener(type: 'change', cb: (s: AppStateStatus) => void): { remove(): void };
}

export interface MapBindingDeps {
  camera: RefObject<CameraRef | null>;
  store: RoutesStore;
  appState: AppStateLike;
  /** Tạo phiên mặc định khi app dùng `useMap().navigation` mà không truyền prop `navigation`. */
  createDefaultSession: () => NavigationSession;
}

/** Nội bộ cho map.tsx; `api` là `MapNavigationBinding`. */
export interface MapBinding {
  readonly api: MapNavigationBinding;
  /** `null` = gỡ phiên đang gắn và xoá tuyến; phiên mặc định sẽ gắn lại lười khi `api` được dùng. */
  attach(session: NavigationSession | null): void;
  setFollow(follow: boolean | FollowOptions): void;
  /** Người dùng kéo/xoay bản đồ → tắt bám. */
  userGesture(): void;
  dispose(): void;
}

const SESSION_EVENTS = [
  'status',
  'progress',
  'step',
  'waypoint',
  'offRoute',
  'reroute',
  'rerouteFailed',
  'announce',
  'arrive',
  'route',
  'positionError',
  'voiceUnavailable',
  'backgroundUnavailable',
  'end',
] as const;

type Listener = (e: never) => void;

export function createMapBinding(deps: MapBindingDeps): MapBinding {
  const listeners = new Map<string, Set<Listener>>();
  const emit = <K extends keyof BindingEvents>(event: K, e: BindingEvents[K]): void => {
    for (const fn of listeners.get(event) ?? []) (fn as (e: BindingEvents[K]) => void)(e);
  };

  let explicit: NavigationSession | null = null;
  let fallback: NavigationSession | null = null;
  let attached: NavigationSession | null = null;
  let detachFns: (() => void)[] = [];
  let follow: { zoom?: number; pitch: number; padding?: ViewPadding } | null = {
    pitch: FOLLOW_PITCH,
  };
  let following = true;
  let lastFixTs: number | null = null;

  const camera = (p: NavigationProgress): void => {
    if (!follow || !following || deps.appState.currentState !== 'active') return;
    const dt = lastFixTs === null ? 500 : p.fix.timestamp - lastFixTs;
    lastFixTs = p.fix.timestamp;
    deps.camera.current?.easeTo({
      center: p.snapped,
      bearing: p.bearing,
      zoom: follow.zoom ?? FOLLOW_ZOOM[p.route.mode],
      pitch: follow.pitch,
      duration: Math.max(0, Math.min(1000, dt)),
      ...(follow.padding ? { padding: follow.padding } : {}),
    });
  };
  const paint = (p: NavigationProgress): void => {
    deps.store.setProgress({ shapeIndex: p.shapeIndex, snapped: p.snapped, bearing: p.bearing });
    camera(p);
  };

  const detach = (): void => {
    for (const fn of detachFns) fn();
    detachFns = [];
    attached = null;
    lastFixTs = null;
    deps.store.clear();
  };

  const attachTo = (session: NavigationSession): void => {
    if (attached === session) return;
    detach();
    attached = session;
    const on = <K extends keyof SessionEvents>(k: K, fn: (e: SessionEvents[K]) => void): void => {
      session.on(k, fn);
      detachFns.push(() => session.off(k, fn));
    };
    // Một handler mỗi sự kiện: vẽ (route/progress) rồi phát lại cho listener của binding.
    for (const name of SESSION_EVENTS) {
      on(name, (e) => {
        if (name === 'progress') paint(e as NavigationProgress);
        else if (name === 'route') {
          const r = e as SessionEvents['route'];
          deps.store.show(r.response, { active: r.routeIndex });
        }
        emit(name, e as BindingEvents[typeof name]);
      });
    }
    if (session.response) deps.store.show(session.response, { active: session.routeIndex });
    const p = session.state;
    if (p) paint(p);
  };

  /** Phiên đang dùng để đọc trạng thái — không tạo phiên mặc định. */
  const current = (): NavigationSession | null => explicit ?? fallback;
  /** Phiên để ra lệnh — tạo và gắn phiên mặc định nếu chưa có. */
  const resolve = (): NavigationSession => {
    if (explicit) return explicit;
    if (!fallback) fallback = deps.createDefaultSession();
    if (attached !== fallback) attachTo(fallback);
    return fallback;
  };

  const appSub = deps.appState.addEventListener('change', (s) => {
    if (s !== 'active') return;
    const p = attached?.state;
    if (p) camera(p);
  });

  const api: MapNavigationBinding = {
    get session() {
      return resolve();
    },
    get following() {
      return following;
    },
    recenter() {
      if (!follow) return;
      following = true;
      emit('followChange', true);
      const p = attached?.state;
      if (p) camera(p);
    },
    start: (o) => resolve().start(o),
    stop: () => current()?.stop() ?? Promise.resolve(),
    reroute: () =>
      current()?.reroute() ?? Promise.reject(new Error('Phiên dẫn đường chưa start()')),
    get state() {
      return current()?.state ?? null;
    },
    get status() {
      return current()?.status ?? 'idle';
    },
    on(event, handler) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(handler as Listener);
    },
    off(event, handler) {
      listeners.get(event)?.delete(handler as Listener);
    },
  };

  return {
    api,
    attach(session) {
      explicit = session;
      if (session) attachTo(session);
      else detach();
    },
    setFollow(opt) {
      if (opt === false) {
        follow = null;
        following = false;
        return;
      }
      const o = typeof opt === 'object' ? opt : {};
      follow = {
        pitch: o.pitch ?? FOLLOW_PITCH,
        ...(o.zoom !== undefined ? { zoom: o.zoom } : {}),
        ...(o.padding ? { padding: o.padding } : {}),
      };
      following = true;
    },
    userGesture() {
      if (!following) return;
      following = false;
      emit('followChange', false);
    },
    dispose() {
      detach();
      appSub.remove();
      listeners.clear();
    },
  };
}
