import { describe, expect, it } from 'vitest';
import { encodePolyline6 } from '../polyline';
import type { Route } from '../types';
import { buildRouteIndex } from './progress';
import { snapToRoute } from './snap';

/** Đi đông 328 m trên AB, xuống nam 13 m, quay về tây trên CD song song — hai đoạn cách nhau 13 m. */
const OVERLAP: [number, number][] = [
  [106.7, 10.77],
  [106.703, 10.77],
  [106.703, 10.76988],
  [106.7, 10.76988],
];
const routeOf = (coords: [number, number][]): Route => ({
  mode: 'motorbike',
  distance_m: 0,
  duration_s: 0,
  bbox: [0, 0, 0, 0],
  geometry: encodePolyline6(coords),
  legs: [],
  flags: { toll: false, highway: false, ferry: false },
});
const index = buildRouteIndex(routeOf(OVERLAP));
// Điểm giữa AB và CD, cách mỗi đoạn ~6,7 m
const between: [number, number] = [106.7005, 10.76994];

describe('snapToRoute', () => {
  it('fix đầu (không cửa sổ), không heading: hoà → chọn đoạn xa hơn theo chiều đi', () => {
    const s = snapToRoute(index, between, { fromShapeIndex: null, window_m: 300 });
    expect(s?.shapeIndex).toBe(2);
    expect(s?.distance_m).toBeCloseTo(6.67, 0);
  });

  it('có heading đông (90°) → chọn AB dù hoà khoảng cách', () => {
    const s = snapToRoute(index, between, { fromShapeIndex: null, window_m: 300, heading: 90 });
    expect(s?.shapeIndex).toBe(0);
  });

  it('cửa sổ 300 m từ đoạn 0 chỉ chứa AB → không nhảy sang CD dù CD gần bằng', () => {
    const s = snapToRoute(index, between, { fromShapeIndex: 0, window_m: 300 });
    expect(s?.shapeIndex).toBe(0);
    expect(s?.along_m).toBeCloseTo(54.6, 0);
  });

  it('cửa sổ 400 m từ đoạn 0 chứa cả CD → hoà, chọn xa hơn', () => {
    const s = snapToRoute(index, between, { fromShapeIndex: 0, window_m: 400 });
    expect(s?.shapeIndex).toBe(2);
  });

  it('đoạn kề nhau không dùng luật hoà: điểm sát đỉnh chung chọn đoạn thật gần hơn', () => {
    // Điểm ngay trước B, lệch 3 m về bắc: AB gần hơn BC vài mét, không được nhảy lên BC.
    const nearB: [number, number] = [106.70295, 10.77003];
    const s = snapToRoute(index, nearB, { fromShapeIndex: 0, window_m: 400 });
    expect(s?.shapeIndex).toBe(0);
    expect(s?.t).toBeGreaterThan(0.9);
  });

  it('cửa sổ luôn bao gồm đoạn hiện tại và lùi 2 đoạn', () => {
    const s = snapToRoute(index, [106.7029, 10.76985], { fromShapeIndex: 2, window_m: 10 });
    expect(s?.shapeIndex).toBe(2);
    const back = snapToRoute(index, [106.7015, 10.77004], { fromShapeIndex: 2, window_m: 10 });
    expect(back?.shapeIndex).toBe(0);
  });

  it('tuyến dưới 2 điểm → null', () => {
    expect(snapToRoute(buildRouteIndex(routeOf([[106.7, 10.77]])), between, { fromShapeIndex: null, window_m: 100 })).toBeNull();
  });
});
