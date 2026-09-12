import { decodePolyline6 } from '../polyline';
import type { DirectionsResponse } from '../types';

/** Vai của từng feature trong source tuyến — web và RN cùng lọc theo `properties.kind`. */
export type RouteFeatureKind = 'alt' | 'active' | 'traveled' | 'puck';

export interface RouteLineFeature {
  type: 'Feature';
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  properties: { kind: 'alt' | 'active' | 'traveled'; index: number };
}

export interface RoutePuckFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: { kind: 'puck'; bearing: number };
}

export type RouteFeature = RouteLineFeature | RoutePuckFeature;

export interface RouteFeatureCollection {
  type: 'FeatureCollection';
  features: RouteFeature[];
}

/** Điểm cắt tuyến chính: trước là đã đi, sau là còn lại. */
export interface RouteProgressCut {
  shapeIndex: number;
  snapped: [number, number];
  /** Hướng đi (độ) cho puck; thiếu → 0. */
  bearing?: number;
}

export interface RouteFeaturesOptions {
  active: number;
  progress?: RouteProgressCut | null;
  /** Thêm feature Point `puck` tại `snapped` khi có `progress`. Mặc định false. */
  puck?: boolean;
}

export const EMPTY_ROUTE_FEATURES: RouteFeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

/** Giải mã polyline6 của mọi tuyến trong response — làm một lần rồi cache ở lớp dán. */
export function decodeRoutes(response: DirectionsResponse): [number, number][][] {
  return response.routes.map((route) => decodePolyline6(route.geometry));
}

const line = (
  kind: RouteLineFeature['properties']['kind'],
  index: number,
  coordinates: [number, number][],
): RouteLineFeature => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates },
  properties: { kind, index },
});

/**
 * Dựng FeatureCollection cho source tuyến: tuyến khác `active` là `alt`; tuyến `active` bị cắt tại
 * `progress` thành `traveled` + `active` (cả hai đi qua điểm bám); không có `progress` thì nguyên
 * tuyến là `active`. `puck` thêm một Point tại điểm bám mang `bearing`. Không đột biến `coords`.
 */
export function routeFeatures(
  coords: readonly (readonly [number, number][])[],
  opts: RouteFeaturesOptions,
): RouteFeatureCollection {
  const progress = opts.progress ?? null;
  const features: RouteFeature[] = [];
  for (const [i, c] of coords.entries()) {
    if (i !== opts.active) {
      features.push(line('alt', i, [...c]));
      continue;
    }
    if (progress && progress.shapeIndex < c.length - 1) {
      features.push(
        line('traveled', i, [...c.slice(0, progress.shapeIndex + 1), progress.snapped]),
        line('active', i, [progress.snapped, ...c.slice(progress.shapeIndex + 1)]),
      );
    } else {
      features.push(line('active', i, [...c]));
    }
  }
  if (opts.puck && progress) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: progress.snapped },
      properties: { kind: 'puck', bearing: progress.bearing ?? 0 },
    });
  }
  return { type: 'FeatureCollection', features };
}
