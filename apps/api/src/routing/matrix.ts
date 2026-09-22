import type { MatrixResponse, TravelMode } from '@mapslibvn/core';
import { ApiError } from '../errors';
import type { LatLng } from '../params';
import {
  assertInVietnam,
  cacheKeyPoints,
  haversineM,
  MATRIX_MAX_CROW_DISTANCE_M,
  oneOf,
  parseLatLngList,
  TRAVEL_MODES,
} from './params';
import { ROUTING_ATTRIBUTION } from './translate';
import { VALHALLA_COSTING, type ValhallaMatrixResponse } from './valhalla';

/**
 * Trần cỡ (spec 22/09/2026 mục 4.6, hạ từ 100 → 50 cặp sau phép đo cùng ngày). Máy chủ là **2 nhân,
 * 3,7 GB RAM** và Valhalla chạy **1 luồng**: với 100 cặp, năm request song song đẩy p95 của
 * `/v1/directions` lên 2,7–5,3 s cho mọi khách khác. Trần cặp giới hạn MỘT request; nhịp tổng do
 * `MATRIX_RATE_LIMITER` (6/phút/khoá) giữ — cần cả hai. Đổi số ở đây phải đổi cả docs và site.
 */
export const MATRIX_MAX_SOURCES = 25;
export const MATRIX_MAX_TARGETS = 25;
export const MATRIX_MAX_PAIRS = 50;

export interface MatrixParams {
  sources: LatLng[];
  targets: LatLng[];
  mode: TravelMode;
}

/** Cặp source–target xa nhất phải dưới trần theo mode; nêu đúng cặp vi phạm để người gọi sửa. */
function assertMatrixCrowDistance(
  sources: readonly LatLng[],
  targets: readonly LatLng[],
  mode: TravelMode,
): void {
  const limit = MATRIX_MAX_CROW_DISTANCE_M[mode];
  for (const [i, source] of sources.entries()) {
    for (const [j, target] of targets.entries()) {
      const d = haversineM(source, target);
      if (d > limit) {
        throw new ApiError(
          400,
          'invalid_request',
          `sources[${i}] → targets[${j}] cách ${Math.round(d / 1000)} km, ma trận ${mode} tối đa ${limit / 1000} km đường chim bay`,
        );
      }
    }
  }
}

/** Kiểm hết ở Worker trước khi gọi Valhalla: mỗi bên đếm trước parse, rồi tích cặp, hộp VN, chim bay. */
export function parseMatrixParams(q: Record<string, string | undefined>): MatrixParams {
  const sources = parseLatLngList(q.sources, 'sources', { min: 1, max: MATRIX_MAX_SOURCES });
  const targets = parseLatLngList(q.targets, 'targets', { min: 1, max: MATRIX_MAX_TARGETS });
  const pairs = sources.length * targets.length;
  if (pairs > MATRIX_MAX_PAIRS) {
    throw new ApiError(
      400,
      'invalid_request',
      `Ma trận tối đa ${MATRIX_MAX_PAIRS} cặp (đang ${sources.length} × ${targets.length} = ${pairs})`,
    );
  }
  const mode = oneOf(q.mode, TRAVEL_MODES, 'motorbike', 'mode');
  assertInVietnam([...sources, ...targets]);
  assertMatrixCrowDistance(sources, targets, mode);
  return { sources, targets, mode };
}

const toValhalla = ({ lat, lng }: LatLng) => ({ lat, lon: lng });

/** Body `POST /sources_to_targets`; không có directions_options vì ma trận không có câu chỉ dẫn. */
export function matrixBody(p: MatrixParams, requestId: string) {
  return {
    sources: p.sources.map(toValhalla),
    targets: p.targets.map(toValhalla),
    costing: VALHALLA_COSTING[p.mode],
    units: 'kilometers',
    id: requestId,
  };
}

export function matrixCacheUrl(p: MatrixParams): string {
  return `https://cache.mapslibvn/matrix?v=1&s=${encodeURIComponent(cacheKeyPoints(p.sources))}&t=${encodeURIComponent(cacheKeyPoints(p.targets))}&m=${p.mode}`;
}

const invalidUpstream = () =>
  new ApiError(503, 'upstream_unavailable', 'Dịch vụ chỉ đường trả dữ liệu không hợp lệ');

const lngLat = ({ lat, lng }: LatLng): [number, number] => [lng, lat];

/**
 * Ô đặt theo `from_index`/`to_index`, không tin thứ tự mảng. `time`/`distance` null, không phải số
 * hoặc âm đều là "không nối được" → null ở CẢ hai bảng. Thiếu ô, ô trùng hay chỉ số lệch là dữ liệu
 * hỏng → 503, không trả bảng lệch cho khách.
 */
export function translateMatrix(
  json: ValhallaMatrixResponse,
  p: MatrixParams,
  graph: string | null,
): MatrixResponse {
  const rows = p.sources.length;
  const cols = p.targets.length;
  const durations: (number | null)[][] = [];
  const distances: (number | null)[][] = [];
  const filled: boolean[][] = [];
  for (let i = 0; i < rows; i++) {
    durations.push(Array.from({ length: cols }, () => null));
    distances.push(Array.from({ length: cols }, () => null));
    filled.push(Array.from({ length: cols }, () => false));
  }
  const cells = json?.sources_to_targets;
  if (!Array.isArray(cells)) throw invalidUpstream();
  for (const row of cells) {
    if (!Array.isArray(row)) throw invalidUpstream();
    for (const cell of row) {
      const i = cell?.from_index;
      const j = cell?.to_index;
      if (!Number.isInteger(i) || !Number.isInteger(j)) throw invalidUpstream();
      const filledRow = filled[i];
      const durationRow = durations[i];
      const distanceRow = distances[i];
      if (!filledRow || !durationRow || !distanceRow || j < 0 || j >= cols) throw invalidUpstream();
      if (filledRow[j]) throw invalidUpstream();
      filledRow[j] = true;
      const time = cell.time;
      const distance = cell.distance;
      const reachable =
        typeof time === 'number' && time >= 0 && typeof distance === 'number' && distance >= 0;
      durationRow[j] = reachable ? Math.round(time) : null;
      distanceRow[j] = reachable ? Math.round(distance * 1000) : null;
    }
  }
  if (!filled.every((row) => row.every(Boolean))) throw invalidUpstream();
  return {
    mode: p.mode,
    sources: p.sources.map(lngLat),
    targets: p.targets.map(lngLat),
    durations_s: durations,
    distances_m: distances,
    attribution: ROUTING_ATTRIBUTION,
    engine: { name: 'valhalla', graph },
  };
}
