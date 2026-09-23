import { decodePolyline6 } from '../polyline';
import type { DirectionsResponse, FleetPlanResponse } from '../types';

/** Vai của từng feature trong source tuyến — web và RN cùng lọc theo `properties.kind`. */
export type RouteFeatureKind = 'alt' | 'active' | 'traveled' | 'puck' | 'fleet';

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

/** Tuyến một xe trong kế hoạch đội xe: màu và độ mờ nằm trong properties để layer vẽ data-driven. */
export interface FleetLineFeature {
  type: 'Feature';
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  properties: { kind: 'fleet'; index: number; color: string; opacity: number };
}

export type RouteFeature = RouteLineFeature | RoutePuckFeature | FleetLineFeature;

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

/** Bảng Okabe–Ito: 5 màu phân biệt được với người mù màu, đúng trần 5 xe. Xe thứ 6+ xoay vòng. */
export const FLEET_COLORS: readonly string[] = [
  '#0072b2',
  '#d55e00',
  '#009e73',
  '#cc79a7',
  '#e69f00',
];
/** Độ mờ của xe không được chọn khi `active` là một chỉ số. */
export const FLEET_DIM_OPACITY = 0.35;

/** Giải mã tuyến từng xe, giữ đúng chỉ số: xe rỗi (không `routes`) → mảng rỗng. */
export function decodeFleet(plan: FleetPlanResponse): [number, number][][] {
  return plan.vehicles.map((v) => {
    const geometry = v.routes[0]?.geometry;
    return geometry ? decodePolyline6(geometry) : [];
  });
}

export interface FleetFeaturesOptions {
  colors?: readonly string[];
  /** Chỉ số xe được chọn: xe khác mờ đi. null/bỏ = mọi xe rõ. */
  active?: number | null;
}

/**
 * Mỗi xe một LineString `kind: 'fleet'` với `index`, `color`, `opacity`. Toạ độ DÙNG CHUNG mảng với
 * `coords` (không sao chép) — cùng nguyên tắc với routeFeatures. Xe rỗi bị bỏ nhưng `index` của các
 * xe còn lại giữ nguyên để bấm tuyến vẫn trả đúng chỉ số xe.
 */
export function fleetRouteFeatures(
  coords: readonly (readonly [number, number][])[],
  opts: FleetFeaturesOptions = {},
): RouteFeatureCollection {
  const colors = opts.colors && opts.colors.length > 0 ? opts.colors : FLEET_COLORS;
  const active = opts.active ?? null;
  const features: RouteFeature[] = [];
  for (const [index, c] of coords.entries()) {
    if (c.length < 2) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: c as [number, number][] },
      properties: {
        kind: 'fleet',
        index,
        color: colors[index % colors.length] ?? '#0072b2',
        opacity: active === null || active === index ? 1 : FLEET_DIM_OPACITY,
      },
    });
  }
  return { type: 'FeatureCollection', features };
}
