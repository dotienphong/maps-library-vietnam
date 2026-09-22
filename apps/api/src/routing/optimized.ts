import type { DirectionsLang, OptimizedRouteResponse, TravelMode } from '@mapslibvn/core';
import { ApiError } from '../errors';
import type { LatLng } from '../params';
import {
  assertInVietnam,
  cacheKeyPoints,
  DIRECTIONS_LANGS,
  haversineM,
  MATRIX_MAX_CROW_DISTANCE_M,
  oneOf,
  parseLatLngList,
  requirePair,
  TRAVEL_MODES,
} from './params';
import { translateDirections } from './translate';
import { VALHALLA_COSTING, VALHALLA_LANGUAGE, type ValhallaRouteResponse } from './valhalla';

/**
 * 8 điểm dừng = 10 điểm kể cả from/to, dưới `max_locations = 20` của costing auto (spec 22/09/2026
 * mục 4.6; hạ từ 10 → 8 sau phép đo cùng ngày trên máy chủ 2 nhân / Valhalla 1 luồng). Một request =
 * MỘT lượt nhóm `directions`, nhịp tổng do `MATRIX_RATE_LIMITER` giữ. Đổi số phải đổi docs và site.
 */
export const OPTIMIZED_MAX_STOPS = 8;

export interface OptimizedParams {
  from: LatLng;
  /** Theo thứ tự người gọi gửi; thứ tự đi nằm ở `order` của response. */
  stops: LatLng[];
  /** Bằng `from` khi người gọi bỏ `to` (round trip). */
  to: LatLng;
  roundTrip: boolean;
  mode: TravelMode;
  lang: DirectionsLang;
}

/** Bán kính chim bay từ `from` tới từng điểm — thứ tự đi chưa biết nên không cộng dồn được như directions. */
function assertOptimizedCrowDistance(p: Omit<OptimizedParams, 'roundTrip'>): void {
  const limit = MATRIX_MAX_CROW_DISTANCE_M[p.mode];
  const check = (name: string, point: LatLng) => {
    const d = haversineM(p.from, point);
    if (d > limit) {
      throw new ApiError(
        400,
        'invalid_request',
        `${name} cách from ${Math.round(d / 1000)} km, tối ưu thứ tự ${p.mode} tối đa ${limit / 1000} km đường chim bay`,
      );
    }
  };
  for (const [i, stop] of p.stops.entries()) check(`stops[${i}]`, stop);
  check('to', p.to);
}

/** Kiểm hết ở Worker: đếm stops trước parse, from/to, mode/lang, hộp VN, bán kính chim bay. */
export function parseOptimizedParams(q: Record<string, string | undefined>): OptimizedParams {
  const stops = parseLatLngList(q.stops, 'stops', { min: 1, max: OPTIMIZED_MAX_STOPS });
  const from = requirePair(q.from, 'from');
  const roundTrip = !q.to?.trim();
  const to = roundTrip ? from : requirePair(q.to, 'to');
  const mode = oneOf(q.mode, TRAVEL_MODES, 'motorbike', 'mode');
  const lang = oneOf(q.lang, DIRECTIONS_LANGS, 'vi', 'lang');
  assertInVietnam([from, ...stops, to]);
  assertOptimizedCrowDistance({ from, stops, to, mode, lang });
  return { from, stops, to, roundTrip, mode, lang };
}

/** Body `POST /optimized_route`: from, stops theo thứ tự gửi, to — `stops[i]` có original_index i + 1. */
export function optimizedBody(p: OptimizedParams, requestId: string) {
  return {
    locations: [p.from, ...p.stops, p.to].map(({ lat, lng }) => ({ lat, lon: lng, type: 'break' })),
    costing: VALHALLA_COSTING[p.mode],
    directions_options: { language: VALHALLA_LANGUAGE[p.lang], units: 'kilometers' },
    id: requestId,
  };
}

export function optimizedCacheUrl(p: OptimizedParams): string {
  const f = encodeURIComponent(cacheKeyPoints([p.from]));
  const s = encodeURIComponent(cacheKeyPoints(p.stops));
  const t = encodeURIComponent(cacheKeyPoints([p.to]));
  return `https://cache.mapslibvn/optimized-route?v=1&f=${f}&s=${s}&t=${t}&m=${p.mode}&l=${p.lang}`;
}

const invalidUpstream = () =>
  new ApiError(503, 'upstream_unavailable', 'Dịch vụ chỉ đường trả dữ liệu không hợp lệ');

/**
 * `order[k]` = original_index của điểm thứ k trên đường đi, trừ 1 (vì locations gửi là
 * [from, ...stops, to]). Không đoán khi dữ liệu lệch: đầu/cuối phải giữ chỗ, order phải là hoán vị
 * đủ của stops, số leg = số điểm − 1; sai → 503. Phần tuyến giao nguyên cho translateDirections.
 */
export function translateOptimized(
  json: ValhallaRouteResponse,
  p: OptimizedParams,
  graph: string | null,
): OptimizedRouteResponse {
  const n = p.stops.length + 2;
  const locations = json?.trip?.locations;
  if (!Array.isArray(locations) || locations.length !== n) throw invalidUpstream();
  const indexes = locations.map((location) => location.original_index);
  if (indexes[0] !== 0 || indexes[n - 1] !== n - 1) throw invalidUpstream();
  const order: number[] = [];
  for (const index of indexes.slice(1, -1)) {
    if (typeof index !== 'number' || !Number.isInteger(index)) throw invalidUpstream();
    order.push(index - 1);
  }
  const unique = new Set(order);
  if (
    unique.size !== p.stops.length ||
    order.some((k) => k < 0 || k >= p.stops.length) ||
    !Array.isArray(json.trip.legs) ||
    json.trip.legs.length !== n - 1
  ) {
    throw invalidUpstream();
  }
  const base = translateDirections(json, p.mode, graph, p.lang);
  return { ...base, order };
}
