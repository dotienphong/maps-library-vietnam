import type { CameraRef, ViewPadding } from '@maplibre/maplibre-react-native';
import {
  angleDiffDeg,
  type HeadingFix,
  MOVING_SPEED_MPS,
  type NavigationProgress,
  type NavigationStatus,
  type TravelMode,
} from '@mapslibvn/core';
import type { RefObject } from 'react';
import type { RoutesStore } from './routes-store';
import type { NavigationSession, NavigationSessionStartOptions, SessionEvents } from './session';

export interface FollowOptions {
  /** Mặc định theo phương tiện: walk 17, motorbike 16,5, car 15,5. */
  zoom?: number;
  /** Mặc định 45. */
  pitch?: number;
  padding?: ViewPadding;
  /**
   * 'route' (mặc định): camera theo hướng đi/tuyến. 'heading': theo la bàn của phiên (spec la bàn
   * 5.4) — hợp đi bộ; đi xe dễ chóng mặt.
   */
  bearing?: 'route' | 'heading';
}

export const FOLLOW_ZOOM: Readonly<Record<TravelMode, number>> = {
  walk: 17,
  motorbike: 16.5,
  car: 15.5,
};
export const FOLLOW_PITCH = 45;
/** Hướng la bàn cách fix GPS quá ngần này thì không dùng cho puck/camera. */
export const HEADING_FRESH_MS = 2000;
/** Camera theo la bàn cập nhật thưa hơn puck: cách ≥ 250 ms và đổi ≥ 2°. */
export const CAMERA_BEARING_MIN_MS = 250;
export const CAMERA_BEARING_MIN_DEG = 2;

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
  /**
   * Rộng hơn `AppStateStatus` vì react-native 0.87 khai `AppState.currentState` là
   * `string | null | undefined` — chưa có giá trị khi app vừa khởi động. Giá trị có nghĩa vẫn là
   * `AppStateStatus`, và mọi chỗ đọc đều chỉ so với `'active'`, nên kiểu rộng không đổi logic.
   */
  currentState: string | null | undefined;
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
  'heading',
  'headingUnavailable',
] as const;

type Listener = (e: never) => void;

interface FollowState {
  zoom?: number;
  pitch: number;
  padding?: ViewPadding;
  bearing: 'route' | 'heading';
}

export function createMapBinding(deps: MapBindingDeps): MapBinding {
  const listeners = new Map<string, Set<Listener>>();
  const emit = <K extends keyof BindingEvents>(event: K, e: BindingEvents[K]): void => {
    for (const fn of listeners.get(event) ?? []) (fn as (e: BindingEvents[K]) => void)(e);
  };

  let explicit: NavigationSession | null = null;
  let fallback: NavigationSession | null = null;
  let attached: NavigationSession | null = null;
  let detachFns: (() => void)[] = [];
  let follow: FollowState | null = { pitch: FOLLOW_PITCH, bearing: 'route' };
  let following = true;
  let lastFixTs: number | null = null;
  let lastHeading: HeadingFix | null = null;
  let lastCameraBearing: { value: number; at: number } | null = null;

  const stationary = (p: NavigationProgress): boolean => (p.fix.speed_mps ?? 0) <= MOVING_SPEED_MPS;
  /** Hướng la bàn dùng được tại thời điểm `at`: không unreliable và còn tươi. */
  const usableHeading = (at: number): HeadingFix | null =>
    lastHeading &&
    lastHeading.accuracy !== 'unreliable' &&
    Math.abs(at - lastHeading.timestamp) <= HEADING_FRESH_MS
      ? lastHeading
      : null;
  const cameraZoom = (p: NavigationProgress, f: FollowState): number =>
    f.zoom ?? FOLLOW_ZOOM[p.route.mode];

  const camera = (p: NavigationProgress, bearing: number): void => {
    if (!follow || !following || deps.appState.currentState !== 'active') return;
    const dt = lastFixTs === null ? 500 : p.fix.timestamp - lastFixTs;
    lastFixTs = p.fix.timestamp;
    // 'linear': easeTo nối tiếp mỗi fix/mỗi mẫu la bàn — 'ease' (EaseInEaseOut) mặc định của MLRN làm
    // mỗi đoạn tăng–giảm tốc, camera giật nhịp khi bám liên tục (thực địa iPhone 13/09/2026).
    deps.camera.current?.easeTo({
      center: p.snapped,
      bearing,
      zoom: cameraZoom(p, follow),
      pitch: follow.pitch,
      duration: Math.max(0, Math.min(1000, dt)),
      easing: 'linear',
      ...(follow.padding ? { padding: follow.padding } : {}),
    });
  };
  /** Mỗi fix GPS: puck theo la bàn nếu đứng yên và la bàn tươi; camera theo tuyến trừ khi app chọn 'heading'. */
  const paint = (p: NavigationProgress): void => {
    const h = usableHeading(p.fix.timestamp);
    deps.store.setProgress({
      shapeIndex: p.shapeIndex,
      snapped: p.snapped,
      bearing: h && stationary(p) ? h.heading : p.bearing,
    });
    camera(p, h && follow?.bearing === 'heading' ? h.heading : p.bearing);
  };
  /** Mỗi mẫu la bàn: đứng yên → puck xoay ngay; follow.bearing 'heading' → camera xoay (thưa). */
  const onHeading = (h: HeadingFix): void => {
    lastHeading = h;
    const p = attached?.state;
    if (!p || h.accuracy === 'unreliable') return;
    if (stationary(p)) {
      deps.store.setProgress({ shapeIndex: p.shapeIndex, snapped: p.snapped, bearing: h.heading });
    }
    if (follow?.bearing !== 'heading' || !following) return;
    if (deps.appState.currentState !== 'active') return;
    const prev = lastCameraBearing;
    if (
      prev &&
      (h.timestamp - prev.at < CAMERA_BEARING_MIN_MS ||
        angleDiffDeg(h.heading, prev.value) < CAMERA_BEARING_MIN_DEG)
    ) {
      return;
    }
    lastCameraBearing = { value: h.heading, at: h.timestamp };
    deps.camera.current?.easeTo({
      center: p.snapped,
      bearing: h.heading,
      zoom: cameraZoom(p, follow),
      pitch: follow.pitch,
      duration: CAMERA_BEARING_MIN_MS,
      easing: 'linear',
      ...(follow.padding ? { padding: follow.padding } : {}),
    });
  };

  const detach = (): void => {
    for (const fn of detachFns) fn();
    detachFns = [];
    attached = null;
    lastFixTs = null;
    lastHeading = null;
    lastCameraBearing = null;
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
    // Một handler mỗi sự kiện: vẽ (route/progress/heading) rồi phát lại cho listener của binding.
    for (const name of SESSION_EVENTS) {
      on(name, (e) => {
        if (name === 'progress') paint(e as NavigationProgress);
        else if (name === 'route') {
          const r = e as SessionEvents['route'];
          deps.store.show(r.response, { active: r.routeIndex });
        } else if (name === 'heading') onHeading(e as HeadingFix);
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
    if (p) camera(p, p.bearing);
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
      if (p) camera(p, p.bearing);
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
        bearing: o.bearing ?? 'route',
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
      // Binding SỞ HỮU phiên mặc định nó tự tạo, nên phải dừng nó: `detach()` chỉ gỡ listener, còn
      // định vị nền, giọng đọc, chống khoá màn hình và vòng âm thanh im lặng nằm trong phiên. Bỏ
      // bước này thì chúng chạy tiếp sau khi map unmount (hoặc khi `places` đổi làm binding được
      // tạo lại) mà app chủ không còn tay cầm nào để dừng. Phiên `explicit` do app chủ truyền vào
      // thì app chủ sở hữu — tuyệt đối không dừng hộ.
      const owned = fallback;
      fallback = null;
      // `stop()` là async; rejection không bắt sẽ thành red-box trong app chủ lúc unmount.
      void owned?.stop().catch(() => {});
    },
  };
}
