import type { CameraRef } from '@maplibre/maplibre-react-native';
import {
  type GeoFix,
  type HeadingFix,
  type HeadingSource,
  type PositionSource,
  angleDiffDeg,
} from '@mapslibvn/core';
import type { RefObject } from 'react';
import type { AppStateLike } from '../navigation/map-binding';
import type { RoutesStore } from '../navigation/routes-store';
import type { UserLocationStore } from './store';

export interface UserLocationOptions {
  /** Vị trí tiền cảnh — thường `expoLocationSource({ background: false })`. Giữ tham chiếu ổn định. */
  source: PositionSource;
  /** Có → nón hướng; với follow 'heading' camera xoay theo. Giữ tham chiếu ổn định. */
  heading?: HeadingSource;
  /** Mặc định 'none'. 'center' bám tâm; 'heading' bám tâm và xoay theo la bàn. */
  follow?: 'none' | 'center' | 'heading';
  /** Zoom khi bám — mặc định 16. */
  zoom?: number;
  /** Vòng sai số — mặc định true (đọc ở lớp vẽ, không phải ở binding). */
  accuracyCircle?: boolean;
}

/** Thứ lộ ra qua `useMap().userLocation`. */
export interface UserLocationHandle {
  /** true khi có prop, follow ≠ 'none' và người dùng chưa kéo bản đồ. */
  readonly following: boolean;
  /** Fix/hướng SDK đang vẽ; null khi không bật hoặc đang ẩn vì dẫn đường. */
  readonly fix: GeoFix | null;
  readonly heading: HeadingFix | null;
  /** Bật lại bám và ease ngay tới fix cuối; no-op khi follow 'none'. */
  recenter(): void;
  on(event: 'followChange', handler: (following: boolean) => void): void;
  off(event: 'followChange', handler: (following: boolean) => void): void;
}

export interface UserLocationBindingDeps {
  camera: RefObject<CameraRef | null>;
  store: UserLocationStore;
  /** Có tiến độ dẫn đường → chấm xanh ẩn và ngừng nghe nguồn (spec la bàn 5.5). */
  routesStore: RoutesStore;
  appState: AppStateLike;
}

export interface UserLocationBinding {
  readonly api: UserLocationHandle;
  /** null = gỡ. Cùng tham chiếu source/heading → không đăng ký lại. */
  setOptions(opts: UserLocationOptions | null): void;
  userGesture(): void;
  dispose(): void;
}

export const USER_FOLLOW_ZOOM = 16;
const CAMERA_BEARING_MIN_MS = 250;
const CAMERA_BEARING_MIN_DEG = 2;

export function createUserLocationBinding(deps: UserLocationBindingDeps): UserLocationBinding {
  const listeners = new Set<(following: boolean) => void>();
  let options: UserLocationOptions | null = null;
  let wantFollow = true;
  let offFix: (() => void) | null = null;
  let offHeading: (() => void) | null = null;
  let subscribedTo: { source: PositionSource; heading: HeadingSource | undefined } | null = null;
  let lastFixTs: number | null = null;
  let lastCameraBearing: { value: number; at: number } | null = null;

  const followMode = (): 'none' | 'center' | 'heading' => options?.follow ?? 'none';
  const isFollowing = (): boolean => options !== null && followMode() !== 'none' && wantFollow;
  const visible = (): boolean => options !== null && deps.routesStore.getSnapshot().progress === null;
  const emitFollow = (f: boolean): void => {
    for (const fn of listeners) fn(f);
  };
  const reliableHeading = (): HeadingFix | null => {
    const h = deps.store.getSnapshot().heading;
    return h && h.accuracy !== 'unreliable' ? h : null;
  };

  const ease = (center: [number, number], bearing: number | null, duration: number): void => {
    if (!options || !isFollowing() || deps.appState.currentState !== 'active') return;
    deps.camera.current?.easeTo({
      center,
      zoom: options.zoom ?? USER_FOLLOW_ZOOM,
      ...(bearing !== null ? { bearing } : {}),
      duration,
    });
  };
  const onFix = (fix: GeoFix): void => {
    deps.store.setFix(fix);
    const dt = lastFixTs === null ? 500 : fix.timestamp - lastFixTs;
    lastFixTs = fix.timestamp;
    const h = followMode() === 'heading' ? reliableHeading() : null;
    ease([fix.lng, fix.lat], h ? h.heading : null, Math.max(0, Math.min(1000, dt)));
  };
  const onHeading = (h: HeadingFix): void => {
    deps.store.setHeading(h);
    if (followMode() !== 'heading' || h.accuracy === 'unreliable') return;
    const fix = deps.store.getSnapshot().fix;
    if (!fix) return;
    const prev = lastCameraBearing;
    if (
      prev &&
      (h.timestamp - prev.at < CAMERA_BEARING_MIN_MS ||
        angleDiffDeg(h.heading, prev.value) < CAMERA_BEARING_MIN_DEG)
    ) {
      return;
    }
    lastCameraBearing = { value: h.heading, at: h.timestamp };
    ease([fix.lng, fix.lat], h.heading, CAMERA_BEARING_MIN_MS);
  };

  const unsubscribeAll = (): void => {
    offFix?.();
    offFix = null;
    offHeading?.();
    offHeading = null;
    subscribedTo = null;
    lastFixTs = null;
    lastCameraBearing = null;
  };
  /** Đăng ký đúng khi visible; huỷ khi ẩn (dẫn đường có tiến độ) hoặc gỡ options. */
  const sync = (): void => {
    if (!options || !visible()) {
      if (subscribedTo) {
        unsubscribeAll();
        deps.store.clear();
      }
      return;
    }
    const { source, heading } = options;
    if (subscribedTo && subscribedTo.source === source && subscribedTo.heading === heading) return;
    unsubscribeAll();
    deps.store.clear();
    subscribedTo = { source, heading };
    offFix = source.subscribe(onFix);
    offHeading = heading ? heading.subscribe(onHeading) : null;
  };

  const offRoutes = deps.routesStore.subscribe(sync);
  const appSub = deps.appState.addEventListener('change', (s) => {
    if (s !== 'active') return;
    const fix = deps.store.getSnapshot().fix;
    if (!fix) return;
    const h = followMode() === 'heading' ? reliableHeading() : null;
    ease([fix.lng, fix.lat], h ? h.heading : null, 300);
  });

  const api: UserLocationHandle = {
    get following() {
      return isFollowing();
    },
    get fix() {
      return visible() ? deps.store.getSnapshot().fix : null;
    },
    get heading() {
      return visible() ? deps.store.getSnapshot().heading : null;
    },
    recenter() {
      if (!options || followMode() === 'none') return;
      wantFollow = true;
      emitFollow(true);
      const fix = deps.store.getSnapshot().fix;
      if (!fix) return;
      const h = followMode() === 'heading' ? reliableHeading() : null;
      ease([fix.lng, fix.lat], h ? h.heading : null, 300);
    },
    on(_event, handler) {
      listeners.add(handler);
    },
    off(_event, handler) {
      listeners.delete(handler);
    },
  };

  return {
    api,
    setOptions(next) {
      options = next;
      if (next && (next.follow ?? 'none') !== 'none') wantFollow = true;
      sync();
    },
    userGesture() {
      if (!isFollowing()) return;
      wantFollow = false;
      emitFollow(false);
    },
    dispose() {
      unsubscribeAll();
      offRoutes();
      appSub.remove();
      listeners.clear();
      options = null;
    },
  };
}
