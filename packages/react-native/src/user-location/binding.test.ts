import type { CameraRef } from '@maplibre/maplibre-react-native';
import type {
  DirectionsResponse,
  GeoFix,
  HeadingFix,
  HeadingSource,
  PositionSource,
} from '@mapslibvn/core';
import type { RefObject } from 'react';
import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../core/tests/fixtures/directions-q1.json';
import type { AppStateLike, AppStateStatus } from '../navigation/map-binding';
import { createRoutesStore } from '../navigation/routes-store';
import { USER_FOLLOW_ZOOM, type UserLocationOptions, createUserLocationBinding } from './binding';
import { createUserLocationStore } from './store';

const response = fixture as unknown as DirectionsResponse;
const T0 = 1_700_000_000_000;
const fixAt = (ts: number, lng = 106.7): GeoFix => ({ lng, lat: 10.78, accuracy_m: 12, timestamp: ts });
const headingAt = (h: number, ts: number, accuracy: HeadingFix['accuracy'] = 'high'): HeadingFix => ({
  heading: h,
  accuracy,
  timestamp: ts,
  source: 'fused',
});

function fakeSources() {
  let onFix: ((f: GeoFix) => void) | null = null;
  let onHeading: ((h: HeadingFix) => void) | null = null;
  const offFix = vi.fn();
  const offHeading = vi.fn();
  const source: PositionSource = {
    subscribe: vi.fn((cb: (f: GeoFix) => void) => {
      onFix = cb;
      return offFix;
    }),
  };
  const heading: HeadingSource = {
    subscribe: vi.fn((cb: (h: HeadingFix) => void) => {
      onHeading = cb;
      return offHeading;
    }),
  };
  return {
    source,
    heading,
    offFix,
    offHeading,
    pushFix: (f: GeoFix) => onFix?.(f),
    pushHeading: (h: HeadingFix) => onHeading?.(h),
  };
}

function setup(opts: Omit<UserLocationOptions, 'source' | 'heading'> & { withHeading?: boolean } = {}) {
  const easeTo = vi.fn();
  const camera = { current: { easeTo } } as unknown as RefObject<CameraRef | null>;
  const store = createUserLocationStore();
  const routesStore = createRoutesStore();
  const appListeners = new Set<(s: AppStateStatus) => void>();
  const appState: AppStateLike & { set(s: AppStateStatus): void } = {
    currentState: 'active',
    addEventListener: (_t, cb) => {
      appListeners.add(cb);
      return { remove: () => appListeners.delete(cb) };
    },
    set(s) {
      appState.currentState = s;
      for (const fn of appListeners) fn(s);
    },
  };
  const src = fakeSources();
  const binding = createUserLocationBinding({ camera, store, routesStore, appState });
  const { withHeading, ...rest } = opts;
  const options: UserLocationOptions = {
    source: src.source,
    ...(withHeading ? { heading: src.heading } : {}),
    ...rest,
  };
  binding.setOptions(options);
  const lastEase = () => easeTo.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;
  return { easeTo, lastEase, store, routesStore, appState, src, binding, options };
}

describe('createUserLocationBinding', () => {
  it("đăng ký cả hai nguồn; follow 'none' không đụng camera; api đọc fix/heading; following false", () => {
    const { src, store, binding, easeTo } = setup({ withHeading: true });
    expect(src.source.subscribe).toHaveBeenCalledTimes(1);
    expect(src.heading.subscribe).toHaveBeenCalledTimes(1);
    src.pushFix(fixAt(T0));
    src.pushHeading(headingAt(90, T0));
    expect(store.getSnapshot().features.features[0]?.properties).toMatchObject({
      hasHeading: true,
      bearing: 90,
    });
    expect(binding.api.fix?.timestamp).toBe(T0);
    expect(binding.api.heading?.heading).toBe(90);
    expect(binding.api.following).toBe(false);
    expect(easeTo).not.toHaveBeenCalled();
  });

  it("follow 'center': ease mỗi fix (zoom 16, không bearing); kéo tay tắt; recenter bật lại và ease ngay", () => {
    const { src, binding, easeTo, lastEase } = setup({ follow: 'center' });
    const changes: boolean[] = [];
    binding.api.on('followChange', (f) => changes.push(f));
    expect(binding.api.following).toBe(true);
    src.pushFix(fixAt(T0));
    expect(easeTo).toHaveBeenCalledTimes(1);
    expect(lastEase()).toEqual({ center: [106.7, 10.78], zoom: USER_FOLLOW_ZOOM, duration: 500 });
    binding.userGesture();
    expect(binding.api.following).toBe(false);
    src.pushFix(fixAt(T0 + 1000, 106.71));
    expect(easeTo).toHaveBeenCalledTimes(1);
    binding.api.recenter();
    expect(binding.api.following).toBe(true);
    expect(easeTo).toHaveBeenCalledTimes(2);
    expect(lastEase()?.center).toEqual([106.71, 10.78]);
    expect(changes).toEqual([false, true]);
  });

  it("follow 'heading': bearing theo la bàn, throttle 250 ms / 2°, unreliable không xoay", () => {
    const { src, easeTo, lastEase } = setup({ follow: 'heading', withHeading: true, zoom: 17 });
    src.pushFix(fixAt(T0));
    expect(lastEase()).toEqual({ center: [106.7, 10.78], zoom: 17, duration: 500 });
    src.pushHeading(headingAt(100, T0 + 100));
    expect(easeTo).toHaveBeenCalledTimes(2);
    expect(lastEase()).toEqual({ center: [106.7, 10.78], zoom: 17, bearing: 100, duration: 250 });
    src.pushHeading(headingAt(101, T0 + 200)); // quá sớm
    src.pushHeading(headingAt(150, T0 + 400)); // 300 ms, 50°
    src.pushHeading(headingAt(151, T0 + 700)); // chỉ 1°
    expect(easeTo).toHaveBeenCalledTimes(3);
    src.pushHeading(headingAt(30, T0 + 1000, 'unreliable'));
    expect(easeTo).toHaveBeenCalledTimes(3);
    // La bàn cuối không đáng tin → fix mới KHÔNG ép bearing; easeTo không có bearing nên camera giữ
    // hướng hiện tại (không quay về bắc). dt = 1500 → clamp 1000.
    src.pushFix(fixAt(T0 + 1500));
    expect(easeTo).toHaveBeenCalledTimes(4);
    expect(lastEase()).toEqual({ center: [106.7, 10.78], zoom: 17, duration: 1000 });
  });

  it('dẫn đường có tiến độ → ẩn: huỷ hai nguồn, xoá store, api null; hết tiến độ → đăng ký lại', () => {
    const { src, store, routesStore, binding } = setup({ withHeading: true });
    src.pushFix(fixAt(T0));
    routesStore.show(response);
    expect(src.offFix).not.toHaveBeenCalled(); // chỉ có tuyến, chưa có tiến độ → vẫn hiện
    routesStore.setProgress({ shapeIndex: 3, snapped: [106.69, 10.77], bearing: 10 });
    expect(src.offFix).toHaveBeenCalledTimes(1);
    expect(src.offHeading).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().fix).toBeNull();
    expect(binding.api.fix).toBeNull();
    routesStore.clear();
    expect(src.source.subscribe).toHaveBeenCalledTimes(2);
    expect(src.heading.subscribe).toHaveBeenCalledTimes(2);
  });

  it('setOptions cùng tham chiếu không đăng ký lại; đổi heading đăng ký lại; null huỷ hết; dispose', () => {
    const { src, binding, options, routesStore } = setup();
    binding.setOptions({ ...options, follow: 'center' });
    expect(src.source.subscribe).toHaveBeenCalledTimes(1);
    binding.setOptions({ ...options, heading: src.heading });
    expect(src.offFix).toHaveBeenCalledTimes(1);
    expect(src.source.subscribe).toHaveBeenCalledTimes(2);
    expect(src.heading.subscribe).toHaveBeenCalledTimes(1);
    binding.setOptions(null);
    expect(src.offFix).toHaveBeenCalledTimes(2);
    expect(src.offHeading).toHaveBeenCalledTimes(1);
    binding.setOptions(options);
    binding.dispose();
    expect(src.offFix).toHaveBeenCalledTimes(3);
    routesStore.show(response); // sau dispose không còn nghe routesStore → không ném
  });

  it('app không active: fix không ease; active lại → ease về fix cuối', () => {
    const { src, appState, easeTo } = setup({ follow: 'center' });
    appState.set('background');
    src.pushFix(fixAt(T0));
    expect(easeTo).not.toHaveBeenCalled();
    appState.set('active');
    expect(easeTo).toHaveBeenCalledTimes(1);
  });
});
