import { describe, expect, it } from 'vitest';
import fixture from '../../tests/fixtures/directions-q1.json';
import { decodePolyline6 } from '../polyline';
import type { DirectionsResponse } from '../types';
import {
  EMPTY_ROUTE_FEATURES,
  type RouteFeature,
  decodeRoutes,
  routeFeatures,
} from './route-features';

const response = fixture as unknown as DirectionsResponse;
const coords = decodeRoutes(response);
const first = coords[0] ?? [];
const two = [first, first];

const kinds = (features: readonly RouteFeature[]) => features.map((f) => f.properties.kind);
const lineCoords = (f: RouteFeature | undefined): [number, number][] => {
  if (!f || f.geometry.type !== 'LineString') throw new Error('không phải LineString');
  return f.geometry.coordinates;
};

describe('decodeRoutes', () => {
  it('giải mã polyline6 từng tuyến, cùng kết quả decodePolyline6', () => {
    expect(coords).toHaveLength(1);
    expect(first).toEqual(decodePolyline6(response.routes[0]?.geometry ?? ''));
    expect(first.length).toBe(42);
  });
});

describe('routeFeatures', () => {
  it('không progress: tuyến active nguyên vẹn, tuyến khác là alt kèm index', () => {
    const fc = routeFeatures(two, { active: 1 });
    expect(
      fc.features.map((f) => [
        f.properties.kind,
        'index' in f.properties ? f.properties.index : -1,
      ]),
    ).toEqual([
      ['alt', 0],
      ['active', 1],
    ]);
    expect(lineCoords(fc.features[1])).toHaveLength(42);
  });

  it('progress cắt tại shapeIndex: traveled kết thúc và active bắt đầu ở điểm bám', () => {
    const fc = routeFeatures(coords, {
      active: 0,
      progress: { shapeIndex: 5, snapped: [106.6985, 10.7791] },
    });
    expect(kinds(fc.features)).toEqual(['traveled', 'active']);
    const traveled = lineCoords(fc.features[0]);
    const active = lineCoords(fc.features[1]);
    expect(traveled).toHaveLength(7); // 6 đỉnh + điểm bám
    expect(traveled.at(-1)).toEqual([106.6985, 10.7791]);
    expect(active[0]).toEqual([106.6985, 10.7791]);
    expect(active).toHaveLength(42 - 6 + 1);
  });

  it('progress ở đoạn cuối → cả tuyến là active', () => {
    const fc = routeFeatures(coords, { active: 0, progress: { shapeIndex: 41, snapped: [0, 0] } });
    expect(kinds(fc.features)).toEqual(['active']);
  });

  it('puck: Point tại điểm bám mang bearing; không progress thì không puck', () => {
    const fc = routeFeatures(coords, {
      active: 0,
      puck: true,
      progress: { shapeIndex: 5, snapped: [106.6985, 10.7791], bearing: 123 },
    });
    const puck = fc.features.at(-1);
    expect(puck?.geometry).toEqual({ type: 'Point', coordinates: [106.6985, 10.7791] });
    expect(puck?.properties).toEqual({ kind: 'puck', bearing: 123 });
    expect(kinds(routeFeatures(coords, { active: 0, puck: true }).features)).toEqual(['active']);
  });

  it('không đột biến đầu vào; EMPTY_ROUTE_FEATURES rỗng', () => {
    const before = JSON.stringify(coords);
    routeFeatures(coords, { active: 0, progress: { shapeIndex: 3, snapped: [1, 2] } });
    expect(JSON.stringify(coords)).toBe(before);
    expect(EMPTY_ROUTE_FEATURES.features).toEqual([]);
  });
});
