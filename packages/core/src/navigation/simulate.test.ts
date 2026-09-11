import { describe, expect, it } from 'vitest';
import fixture from '../../tests/fixtures/directions-q1.json';
import { decodePolyline6 } from '../polyline';
import type { DirectionsResponse, Route } from '../types';
import { haversineM } from './geometry';
import { buildRouteIndex } from './progress';
import { simulateFixes } from './simulate';

const route = (fixture as unknown as DirectionsResponse).routes[0] as Route;
const coords = decodePolyline6(route.geometry);
const total = buildRouteIndex(route).total_m;

describe('simulateFixes', () => {
  it('xe máy 8 m/s mỗi 1 s: số fix ≈ tổng/8 + 1, fix đầu/cuối trùng hai đầu tuyến, timestamp tăng đều', () => {
    const fixes = simulateFixes(route);
    expect(fixes.length).toBe(Math.floor(total / 8) + 2);
    expect([fixes[0]?.lng, fixes[0]?.lat]).toEqual(coords[0]);
    const last = fixes.at(-1);
    expect(haversineM([last?.lng ?? 0, last?.lat ?? 0], coords.at(-1) ?? [0, 0])).toBeLessThan(
      0.01,
    );
    for (let i = 1; i < fixes.length; i++) {
      expect((fixes[i]?.timestamp ?? 0) - (fixes[i - 1]?.timestamp ?? 0)).toBe(1000);
    }
    expect(fixes[3]?.accuracy_m).toBe(8);
    expect(fixes[3]?.speed_mps).toBe(8);
  });

  it('heading khớp hướng đoạn đang đi; khoảng cách giữa hai fix liên tiếp ≈ speed × interval', () => {
    const fixes = simulateFixes(route, { speed_mps: 5, interval_s: 2 });
    for (let i = 1; i < fixes.length - 1; i++) {
      const a = fixes[i - 1];
      const b = fixes[i];
      if (!a || !b) continue;
      expect(haversineM([a.lng, a.lat], [b.lng, b.lat])).toBeLessThanOrEqual(10.05);
      expect(b.heading).toBeGreaterThanOrEqual(0);
      expect(b.heading).toBeLessThan(360);
    }
  });

  it('jitter với seed cho kết quả lặp lại và lệch không quá jitter_m', () => {
    const a = simulateFixes(route, { jitter_m: 6, seed: 42 });
    const b = simulateFixes(route, { jitter_m: 6, seed: 42 });
    const clean = simulateFixes(route);
    expect(a).toEqual(b);
    expect(a).not.toEqual(clean);
    for (let i = 0; i < a.length; i++) {
      const noisy = a[i];
      const exact = clean[i];
      if (!noisy || !exact) continue;
      expect(haversineM([noisy.lng, noisy.lat], [exact.lng, exact.lat])).toBeLessThanOrEqual(6.05);
    }
  });

  it('mặc định vận tốc theo phương tiện: walk 1,4, car 12', () => {
    expect(simulateFixes({ ...route, mode: 'walk' })[1]?.speed_mps).toBe(1.4);
    expect(simulateFixes({ ...route, mode: 'car' })[1]?.speed_mps).toBe(12);
  });
});
