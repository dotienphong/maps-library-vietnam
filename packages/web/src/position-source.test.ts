// @vitest-environment jsdom
import type { GeoFix } from '@mapslibvn/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { geolocationSource, playbackSource, toGeoFix, toPositionError } from './position-source';

function fakeGeolocation() {
  let success: PositionCallback | null = null;
  let failure: PositionErrorCallback | null = null;
  const geo = {
    watchPosition: vi.fn((s: PositionCallback, f?: PositionErrorCallback | null) => {
      success = s;
      failure = f ?? null;
      return 7;
    }),
    clearWatch: vi.fn(),
    getCurrentPosition: vi.fn(),
  } as unknown as Geolocation;
  return {
    geo,
    push: (p: GeolocationPosition) => success?.(p),
    fail: (e: GeolocationPositionError) => failure?.(e),
  };
}

const position = (over: Partial<GeolocationCoordinates> = {}, timestamp = 1_700_000_000_000) =>
  ({
    coords: {
      latitude: 10.7798,
      longitude: 106.699,
      accuracy: 12,
      heading: 90,
      speed: 3.5,
      altitude: null,
      altitudeAccuracy: null,
      ...over,
    },
    timestamp,
  }) as unknown as GeolocationPosition;

describe('toGeoFix / toPositionError', () => {
  it('ánh xạ trường; heading NaN → null; speed null giữ null; timestamp không hợp lệ → Date.now()', () => {
    expect(toGeoFix(position())).toEqual({
      lng: 106.699,
      lat: 10.7798,
      accuracy_m: 12,
      heading: 90,
      speed_mps: 3.5,
      timestamp: 1_700_000_000_000,
    });
    const odd = toGeoFix(position({ heading: Number.NaN, speed: null }, Number.NaN));
    expect(odd.heading).toBeNull();
    expect(odd.speed_mps).toBeNull();
    expect(Math.abs(odd.timestamp - Date.now())).toBeLessThan(1000);
  });

  it('mã lỗi 1/2/3 → denied/unavailable/timeout', () => {
    const err = (code: number) => ({ code, message: `m${code}` }) as GeolocationPositionError;
    expect(toPositionError(err(1))).toMatchObject({ code: 'denied', message: 'm1' });
    expect(toPositionError(err(2))).toMatchObject({ code: 'unavailable' });
    expect(toPositionError(err(3))).toMatchObject({ code: 'timeout' });
  });
});

describe('geolocationSource', () => {
  it('watchPosition với tuỳ chọn mặc định, chuyển fix và lỗi, unsubscribe → clearWatch(id)', () => {
    const { geo, push, fail } = fakeGeolocation();
    const onFix = vi.fn();
    const onError = vi.fn();
    const stop = geolocationSource({ geolocation: geo }).subscribe(onFix, onError);
    expect(geo.watchPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 10_000,
    });
    push(position());
    expect(onFix).toHaveBeenCalledWith(expect.objectContaining({ lng: 106.699, lat: 10.7798 }));
    fail({ code: 1, message: 'denied' } as GeolocationPositionError);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'denied' }));
    stop();
    expect(geo.clearWatch).toHaveBeenCalledWith(7);
  });

  it('không có Geolocation → onError unavailable ngay, unsubscribe vô hại', () => {
    const onError = vi.fn();
    const stop = geolocationSource({ geolocation: undefined }).subscribe(vi.fn(), onError);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'unavailable' }));
    expect(() => stop()).not.toThrow();
  });
});

describe('playbackSource', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const fixes: GeoFix[] = [0, 1000, 3000].map((dt) => ({
    lng: 106.7,
    lat: 10.77,
    timestamp: 1_700_000_000_000 + dt,
  }));

  it('phát theo chênh timestamp chia rate; unsubscribe dừng', () => {
    const onFix = vi.fn();
    const stop = playbackSource(fixes, { rate: 2 }).subscribe(onFix);
    vi.advanceTimersByTime(0);
    expect(onFix).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(499);
    expect(onFix).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(onFix).toHaveBeenCalledTimes(2);
    stop();
    vi.advanceTimersByTime(5000);
    expect(onFix).toHaveBeenCalledTimes(2);
  });

  it('rate 0 → phát tất cả trong một tick', () => {
    const onFix = vi.fn();
    playbackSource(fixes, { rate: 0 }).subscribe(onFix);
    expect(onFix).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(onFix).toHaveBeenCalledTimes(3);
  });
});
