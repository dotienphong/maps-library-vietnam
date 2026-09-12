import type { CameraRef } from '@maplibre/maplibre-react-native';
import type { DirectionsResponse, HeadingFix, NavigationProgress, Route } from '@mapslibvn/core';
import type { RefObject } from 'react';
import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../core/tests/fixtures/directions-q1.json';
import { fakeSession, progressAt } from '../test/fake-session';
import { type AppStateLike, type FollowOptions, createMapBinding } from './map-binding';
import { createRoutesStore } from './routes-store';

const response = fixture as unknown as DirectionsResponse;
const route = response.routes[0] as Route;
const T0 = 1_700_000_000_000;

function setup(follow?: boolean | FollowOptions, appStateStatus: AppStateLike['currentState'] = 'active') {
  const easeTo = vi.fn();
  const camera = {
    current: { easeTo, flyTo: vi.fn(), fitBounds: vi.fn() },
  } as unknown as RefObject<CameraRef | null>;
  const store = createRoutesStore();
  const appState: AppStateLike = {
    currentState: appStateStatus,
    addEventListener: () => ({ remove: () => {} }),
  };
  const s = fakeSession({ response });
  const binding = createMapBinding({
    camera,
    store,
    appState,
    createDefaultSession: () => s.session,
  });
  if (follow !== undefined) binding.setFollow(follow);
  binding.attach(s.session);
  const puckBearing = (): number | undefined => {
    const puck = store
      .getSnapshot()
      .features.features.find((f) => f.properties.kind === 'puck');
    return puck && puck.properties.kind === 'puck' ? puck.properties.bearing : undefined;
  };
  const lastEase = () => easeTo.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;
  return { easeTo, store, s, binding, puckBearing, lastEase };
}
const at = (i: number, ts: number, speed_mps: number): NavigationProgress => ({
  ...progressAt(route, i, ts),
  fix: { lng: 106.6985, lat: 10.7791, timestamp: ts, speed_mps },
});
const slow = (i: number, ts = T0) => at(i, ts, 0);
const fast = (i: number, ts = T0) => at(i, ts, 8);
const heading = (h: number, ts = T0, accuracy: HeadingFix['accuracy'] = 'high'): HeadingFix => ({
  heading: h,
  accuracy,
  timestamp: ts,
  source: 'fused',
});

describe('createMapBinding — la bàn', () => {
  it('đứng yên: mẫu la bàn xoay puck, camera KHÔNG xoay theo mặc định', () => {
    const { s, puckBearing, easeTo, lastEase } = setup();
    s.progress(slow(5));
    expect(puckBearing()).toBe(45);
    expect(easeTo).toHaveBeenCalledTimes(1);
    expect(lastEase()?.bearing).toBe(45);
    s.heading(heading(200));
    expect(puckBearing()).toBe(200);
    expect(easeTo).toHaveBeenCalledTimes(1);
  });

  it('đang chạy (> 1 m/s): la bàn không đổi puck; unreliable bị bỏ kể cả khi đứng yên', () => {
    const a = setup();
    a.s.progress(fast(5));
    a.s.heading(heading(200));
    expect(a.puckBearing()).toBe(45);
    const b = setup();
    b.s.progress(slow(5));
    b.s.heading(heading(200, T0, 'unreliable'));
    expect(b.puckBearing()).toBe(45);
  });

  it('fix mới khi đứng yên giữ hướng la bàn còn tươi (≤ 2 s), bỏ khi cũ', () => {
    const { s, puckBearing } = setup();
    s.heading(heading(200, T0));
    s.progress(slow(6, T0 + 500));
    expect(puckBearing()).toBe(200);
    s.progress(slow(7, T0 + 3000));
    expect(puckBearing()).toBe(45);
  });

  it("bearing 'heading': camera xoay theo la bàn, throttle 250 ms / 2°, fix sau dùng la bàn tươi", () => {
    const { s, easeTo, lastEase } = setup({ bearing: 'heading' });
    s.progress(slow(5, T0));
    expect(easeTo).toHaveBeenCalledTimes(1); // chưa có la bàn → bearing tuyến
    s.heading(heading(100, T0 + 100));
    expect(easeTo).toHaveBeenCalledTimes(2);
    expect(lastEase()).toMatchObject({ bearing: 100, center: [106.6985, 10.7791], duration: 250 });
    s.heading(heading(101, T0 + 200)); // < 250 ms
    expect(easeTo).toHaveBeenCalledTimes(2);
    s.heading(heading(150, T0 + 400)); // 300 ms, 50°
    expect(easeTo).toHaveBeenCalledTimes(3);
    s.heading(heading(151, T0 + 700)); // 300 ms nhưng chỉ 1°
    expect(easeTo).toHaveBeenCalledTimes(3);
    s.progress(fast(8, T0 + 1000)); // đang chạy, la bàn tươi → camera vẫn theo la bàn 151
    expect(easeTo).toHaveBeenCalledTimes(4);
    expect(lastEase()?.bearing).toBe(151);
  });

  it('không active hoặc đã kéo tay: la bàn vẫn xoay puck nhưng không đụng camera', () => {
    const bg = setup({ bearing: 'heading' }, 'background');
    bg.s.progress(slow(5));
    bg.s.heading(heading(100, T0 + 300));
    expect(bg.puckBearing()).toBe(100);
    expect(bg.easeTo).not.toHaveBeenCalled();
    const dragged = setup({ bearing: 'heading' });
    dragged.s.progress(slow(5));
    dragged.binding.userGesture();
    dragged.s.heading(heading(100, T0 + 300));
    expect(dragged.puckBearing()).toBe(100);
    expect(dragged.easeTo).toHaveBeenCalledTimes(1);
  });

  it('gỡ phiên xoá hướng đã nhớ; headingUnavailable phát lại cho listener của binding', () => {
    const { s, binding, puckBearing } = setup();
    s.heading(heading(200, T0));
    binding.attach(null);
    binding.attach(s.session);
    s.progress(slow(5, T0 + 100));
    expect(puckBearing()).toBe(45);
    const onErr = vi.fn();
    binding.api.on('headingUnavailable', onErr);
    s.emit('headingUnavailable', { code: 'unavailable', message: 'x' });
    expect(onErr).toHaveBeenCalledTimes(1);
  });
});
