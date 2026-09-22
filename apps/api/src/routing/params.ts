import type { DirectionsLang, TravelMode } from '@mapslibvn/core';
import { ApiError } from '../errors';
import { type LatLng, parseLatLngPair } from '../params';

export const TRAVEL_MODES: readonly TravelMode[] = ['motorbike', 'car', 'walk'];
export const DIRECTIONS_LANGS: readonly DirectionsLang[] = ['vi', 'en'];
export const MAX_VIA = 5;
/** Tổng đường chim bay giữa các điểm liên tiếp, mét (spec A mục 5.1). */
export const MAX_CROW_DISTANCE_M: Readonly<Record<TravelMode, number>> = {
  motorbike: 500_000,
  car: 2_000_000,
  walk: 50_000,
};
/**
 * Trần đường chim bay cho ma trận và tối ưu thứ tự (spec 22/09/2026 mục 4.6): xe máy và ô tô đúng
 * bằng `max_matrix_distance` của Valhalla (motor_scooter 200 km, auto 400 km) để Worker chặn trước
 * thay vì để engine trả 400/154 cho cả request; đi bộ giữ 50 km cho khớp directions.
 */
export const MATRIX_MAX_CROW_DISTANCE_M: Readonly<Record<TravelMode, number>> = {
  motorbike: 200_000,
  car: 400_000,
  walk: 50_000,
};
/** Hộp bao Việt Nam mở rộng. */
const VN = { minLat: 8, maxLat: 24, minLng: 102, maxLng: 110 };

export interface DirectionsParams {
  /** from, …via, to */
  locations: LatLng[];
  mode: TravelMode;
  lang: DirectionsLang;
  alternatives: boolean;
}

export function haversineM(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const inVietnam = (p: LatLng) =>
  p.lat >= VN.minLat && p.lat <= VN.maxLat && p.lng >= VN.minLng && p.lng <= VN.maxLng;

/** Mọi điểm phải trong hộp Việt Nam; message dùng chung ba endpoint dẫn đường. */
export function assertInVietnam(points: readonly LatLng[]): void {
  if (!points.every(inVietnam)) {
    throw new ApiError(400, 'invalid_request', 'Chỉ hỗ trợ chỉ đường trong Việt Nam');
  }
}

export function requirePair(raw: string | undefined, name: string): LatLng {
  const pair = parseLatLngPair(raw, name);
  if (!pair) throw new ApiError(400, 'invalid_request', `${name} bắt buộc, dạng "lat,lng"`);
  return pair;
}

/**
 * Tách "lat,lng;lat,lng…" thành danh sách điểm. Đếm TRƯỚC khi parse: chuỗi hàng nghìn điểm bị từ
 * chối ở bước đếm dấu ";" mà không tốn CPU parse toạ độ (khuôn `via` của directions).
 */
export function parseLatLngList(
  raw: string | undefined,
  name: string,
  { min, max }: { min: number; max: number },
): LatLng[] {
  const trimmed = (raw ?? '').trim();
  const parts = trimmed ? trimmed.split(';') : [];
  if (parts.length < min) {
    throw new ApiError(
      400,
      'invalid_request',
      min === 1 ? `${name} bắt buộc, dạng "lat,lng;lat,lng"` : `${name} cần ít nhất ${min} điểm`,
    );
  }
  if (parts.length > max) {
    throw new ApiError(400, 'invalid_request', `${name} tối đa ${max} điểm`);
  }
  return parts.map((part, i) => requirePair(part, `${name}[${i}]`));
}

export function oneOf<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  dflt: T,
  name: string,
): T {
  const value = (raw?.trim() || dflt) as T;
  if (!allowed.includes(value)) {
    throw new ApiError(400, 'invalid_request', `${name} chỉ nhận ${allowed.join(', ')}`);
  }
  return value;
}

/**
 * Toạ độ trong KHOÁ CACHE làm tròn 4 chữ số (~11 m). Bài học đo 20/09/2026 với cache directions:
 * 5 chữ số (1,1 m) nên không bao giờ trúng; gom 11 m lệch quãng đường 0,19 %, từ 56 m mới ra tuyến
 * khác hẳn. Chỉ khoá cache làm tròn — toạ độ gửi Valhalla giữ nguyên.
 */
export function cacheKeyPoints(points: readonly LatLng[]): string {
  return points.map(({ lat, lng }) => `${lat.toFixed(4)},${lng.toFixed(4)}`).join(';');
}

/** Kiểm tra hết ở Worker trước khi gọi Valhalla — request sai không được tốn máy chủ nhà. */
export function parseDirectionsParams(q: Record<string, string | undefined>): DirectionsParams {
  const from = requirePair(q.from, 'from');
  const to = requirePair(q.to, 'to');
  const via = parseLatLngList(q.via, 'via', { min: 0, max: MAX_VIA });
  const mode = oneOf(q.mode, TRAVEL_MODES, 'motorbike', 'mode');
  const lang = oneOf(q.lang, DIRECTIONS_LANGS, 'vi', 'lang');
  const alternativesRaw = q.alternatives?.trim() || '0';
  if (alternativesRaw !== '0' && alternativesRaw !== '1') {
    throw new ApiError(400, 'invalid_request', 'alternatives chỉ nhận 0 hoặc 1');
  }

  const locations = [from, ...via, to];
  assertInVietnam(locations);
  let total = 0;
  for (let i = 1; i < locations.length; i++) {
    const prev = locations[i - 1];
    const cur = locations[i];
    if (prev && cur) total += haversineM(prev, cur);
  }
  const limit = MAX_CROW_DISTANCE_M[mode];
  if (total > limit) {
    throw new ApiError(
      400,
      'invalid_request',
      `Tuyến ${mode} tối đa ${limit / 1000} km đường chim bay (đang ${Math.round(total / 1000)} km)`,
    );
  }
  // Valhalla không tính tuyến thay thế cho tuyến nhiều điểm (spec A mục 5.2).
  return { locations, mode, lang, alternatives: alternativesRaw === '1' && via.length === 0 };
}

export function directionsCacheUrl(p: DirectionsParams): string {
  const points = p.locations.map(({ lat, lng }) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join(';');
  return `https://cache.mapslibvn/directions?v=1&p=${encodeURIComponent(points)}&m=${p.mode}&l=${p.lang}&a=${p.alternatives ? 1 : 0}`;
}
