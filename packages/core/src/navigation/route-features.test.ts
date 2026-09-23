import { describe, expect, it } from 'vitest';
import fixture from '../../tests/fixtures/directions-q1.json';
import fleetFixture from '../../tests/fixtures/fleet-plan-q1.json';
import { decodePolyline6 } from '../polyline';
import type { DirectionsResponse, FleetPlanResponse } from '../types';
import {
  altRouteFeatures,
  decodeFleet,
  decodeRoutes,
  EMPTY_ROUTE_FEATURES,
  FLEET_COLORS,
  FLEET_DIM_OPACITY,
  fleetRouteFeatures,
  liveRouteFeatures,
  type RouteFeature,
  routeFeatures,
} from './route-features';

const response = fixture as unknown as DirectionsResponse;
const coords = decodeRoutes(response);
const first = coords[0] ?? [];
const two = [first, first];

const kinds = (features: readonly RouteFeature[]) => features.map((f) => f.properties.kind);
const lineCoords = (f: RouteFeature | undefined): [number, number][] => {
  if (f?.geometry.type !== 'LineString') throw new Error('không phải LineString');
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

describe('altRouteFeatures / liveRouteFeatures', () => {
  it('tách đúng hai phần và ghép lại bằng routeFeatures', () => {
    const opts = { active: 1, progress: { shapeIndex: 5, snapped: [0, 0] as [number, number] } };
    expect(kinds(altRouteFeatures(two, 1).features)).toEqual(['alt']);
    expect(kinds(liveRouteFeatures(two, opts).features)).toEqual(['traveled', 'active']);
    expect(routeFeatures(two, opts)).toEqual({
      type: 'FeatureCollection',
      features: [...altRouteFeatures(two, 1).features, ...liveRouteFeatures(two, opts).features],
    });
  });

  it('altRouteFeatures không phụ thuộc progress: cùng (coords, active) cho kết quả bằng nhau', () => {
    expect(altRouteFeatures(two, 1)).toEqual(altRouteFeatures(two, 1));
    expect(kinds(altRouteFeatures(two, 0).features)).toEqual(['alt']);
    expect(altRouteFeatures(coords, 0).features).toEqual([]);
  });

  it('không sao chép toạ độ khi không phải cắt tuyến', () => {
    // Mấu chốt của B1: tuyến dài hàng nghìn đỉnh không bị nhân bản mỗi lần định vị.
    expect(lineCoords(altRouteFeatures(two, 1).features[0])).toBe(two[0]);
    expect(lineCoords(liveRouteFeatures(coords, { active: 0 }).features[0])).toBe(coords[0]);
  });

  it('active nằm ngoài danh sách tuyến → không có feature sống', () => {
    expect(liveRouteFeatures(coords, { active: 9 }).features).toEqual([]);
  });
});

const plan = fleetFixture as unknown as FleetPlanResponse;

describe('decodeFleet', () => {
  it('một mảng toạ độ mỗi xe theo đúng chỉ số; xe rỗi → mảng rỗng, không lệch chỉ số', () => {
    const fleetCoords = decodeFleet(plan);
    expect(fleetCoords).toHaveLength(plan.vehicles.length);
    for (const c of fleetCoords) expect(c.length).toBeGreaterThan(2);
    const xe0 = plan.vehicles[0];
    const xe1 = plan.vehicles[1];
    if (!xe0 || !xe1) throw new Error('fixture thiếu xe');
    const coRoi: FleetPlanResponse = {
      ...plan,
      vehicles: [xe0, { ...xe1, jobs: [], routes: [], waypoints: [] }],
    };
    const c2 = decodeFleet(coRoi);
    expect(c2).toHaveLength(2);
    expect(c2[1]).toEqual([]);
  });
});

describe('fleetRouteFeatures', () => {
  const fleetCoords = decodeFleet(plan);

  it('mỗi xe một LineString kind fleet, màu theo bảng, opacity 1 khi không chọn xe nào', () => {
    const fc = fleetRouteFeatures(fleetCoords, {});
    expect(fc.features).toHaveLength(fleetCoords.length);
    for (const [i, f] of fc.features.entries()) {
      expect(f.properties).toEqual({ kind: 'fleet', index: i, color: FLEET_COLORS[i], opacity: 1 });
      expect(lineCoords(f)).toBe(fleetCoords[i]); // dùng chung mảng, không sao chép
    }
  });

  it('active = 0 → xe khác mờ; bảng màu tuỳ chọn xoay vòng; xe rỗi bị bỏ nhưng chỉ số giữ nguyên', () => {
    const fc = fleetRouteFeatures(fleetCoords, { active: 0, colors: ['#111111'] });
    expect(fc.features[0]?.properties).toMatchObject({ opacity: 1, color: '#111111' });
    expect(fc.features[1]?.properties).toMatchObject({
      opacity: FLEET_DIM_OPACITY,
      color: '#111111',
    });
    const thua = fleetRouteFeatures([[], fleetCoords[0] ?? []], {});
    expect(thua.features).toHaveLength(1);
    expect(thua.features[0]?.properties).toMatchObject({ index: 1, color: FLEET_COLORS[1] });
  });

  it('bảng màu mặc định 5 màu (= trần 5 xe), phân biệt được với người mù màu (Okabe–Ito)', () => {
    expect(FLEET_COLORS).toEqual(['#0072b2', '#d55e00', '#009e73', '#cc79a7', '#e69f00']);
  });
});
