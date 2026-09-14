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
 * Các feature `alt` — chỉ phụ thuộc `coords` và `active`, KHÔNG phụ thuộc `progress`. Tách riêng để
 * lớp dán giữ nguyên tham chiếu qua mỗi lần định vị (B1): tuyến thay thế có thể dài hàng nghìn đỉnh,
 * dựng lại rồi đẩy qua cầu native mỗi giây là việc thừa hoàn toàn.
 */
export function altRouteFeatures(
  coords: readonly (readonly [number, number][])[],
  active: number,
): RouteFeatureCollection {
  const features: RouteFeature[] = [];
  for (const [i, c] of coords.entries()) {
    if (i !== active) features.push(line('alt', i, c as [number, number][]));
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Phần đổi theo từng lần định vị: tuyến `active` (bị `progress` cắt thành `traveled` + `active`, cả
 * hai đi qua điểm bám) và Point `puck` tại điểm bám. Không có `progress` thì nguyên tuyến là `active`.
 */
export function liveRouteFeatures(
  coords: readonly (readonly [number, number][])[],
  opts: RouteFeaturesOptions,
): RouteFeatureCollection {
  const progress = opts.progress ?? null;
  const features: RouteFeature[] = [];
  const c = coords[opts.active];
  if (c) {
    if (progress && progress.shapeIndex < c.length - 1) {
      features.push(
        line('traveled', opts.active, [...c.slice(0, progress.shapeIndex + 1), progress.snapped]),
        line('active', opts.active, [progress.snapped, ...c.slice(progress.shapeIndex + 1)]),
      );
    } else {
      features.push(line('active', opts.active, c as [number, number][]));
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

/**
 * Toàn bộ feature của source tuyến: `alt` trước, rồi phần sống (`traveled`/`active`/`puck`). Thứ tự
 * giữa các `kind` không ảnh hưởng cách vẽ — mỗi `kind` là một layer riêng, thứ tự vẽ do layer quyết.
 *
 * Toạ độ của feature `alt` và của `active` khi không bị cắt DÙNG CHUNG mảng với `coords` (không sao
 * chép): người gọi không được đột biến toạ độ trả về. Đây là nguồn cơ bản nhất của việc tiết kiệm —
 * sao chép hàng nghìn cặp số mỗi giây chỉ để đọc là lãng phí.
 */
export function routeFeatures(
  coords: readonly (readonly [number, number][])[],
  opts: RouteFeaturesOptions,
): RouteFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      ...altRouteFeatures(coords, opts.active).features,
      ...liveRouteFeatures(coords, opts).features,
    ],
  };
}
