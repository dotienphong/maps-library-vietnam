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

function requirePair(raw: string | undefined, name: string): LatLng {
  const pair = parseLatLngPair(raw, name);
  if (!pair) throw new ApiError(400, 'invalid_request', `${name} bắt buộc, dạng "lat,lng"`);
  return pair;
}

function oneOf<T extends string>(
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

/** Kiểm tra hết ở Worker trước khi gọi Valhalla — request sai không được tốn máy chủ nhà. */
export function parseDirectionsParams(q: Record<string, string | undefined>): DirectionsParams {
  const from = requirePair(q.from, 'from');
  const to = requirePair(q.to, 'to');
  const viaRaw = (q.via ?? '').trim();
  const viaParts = viaRaw ? viaRaw.split(';') : [];
  // Đếm TRƯỚC khi parse: chuỗi via hàng nghìn điểm không được tốn CPU parse rồi mới bị từ chối.
  if (viaParts.length > MAX_VIA) {
    throw new ApiError(400, 'invalid_request', `via tối đa ${MAX_VIA} điểm`);
  }
  const via = viaParts.map((part, i) => requirePair(part, `via[${i}]`));
  const mode = oneOf(q.mode, TRAVEL_MODES, 'motorbike', 'mode');
  const lang = oneOf(q.lang, DIRECTIONS_LANGS, 'vi', 'lang');
  const alternativesRaw = q.alternatives?.trim() || '0';
  if (alternativesRaw !== '0' && alternativesRaw !== '1') {
    throw new ApiError(400, 'invalid_request', 'alternatives chỉ nhận 0 hoặc 1');
  }

  const locations = [from, ...via, to];
  if (!locations.every(inVietnam)) {
    throw new ApiError(400, 'invalid_request', 'Chỉ hỗ trợ chỉ đường trong Việt Nam');
  }
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
