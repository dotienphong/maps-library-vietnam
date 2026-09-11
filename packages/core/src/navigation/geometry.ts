/** Hình học cầu và chiếu điểm cho dẫn đường (spec B 4.1). Toạ độ luôn `[lng, lat]`. */
export type LngLat = readonly [number, number];

const EARTH_RADIUS_M = 6_371_008.8;
const M_PER_DEG_LAT = (Math.PI / 180) * EARTH_RADIUS_M;
const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

export function haversineM(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Hướng từ a tới b, độ [0, 360) thuận chiều kim đồng hồ từ bắc. */
export function bearingDeg(a: LngLat, b: LngLat): number {
  const phi1 = toRad(a[1]);
  const phi2 = toRad(b[1]);
  const dLambda = toRad(b[0] - a[0]);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Chênh góc nhỏ nhất giữa hai hướng, [0, 180]. */
export function angleDiffDeg(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

export interface Projection {
  /** Vị trí trên đoạn, 0 = a, 1 = b (đã kẹp). */
  t: number;
  point: [number, number];
  /** Khoảng cách từ p tới điểm chiếu (m). */
  distance_m: number;
}

/**
 * Chiếu p lên đoạn ab trong mặt phẳng cục bộ quanh a (equirectangular, đủ chính xác cho đoạn dưới
 * vài km). Đoạn suy biến (a = b) → t = 0.
 */
export function projectOnSegment(p: LngLat, a: LngLat, b: LngLat): Projection {
  const mPerDegLng = M_PER_DEG_LAT * Math.cos(toRad(a[1]));
  const bx = (b[0] - a[0]) * mPerDegLng;
  const by = (b[1] - a[1]) * M_PER_DEG_LAT;
  const px = (p[0] - a[0]) * mPerDegLng;
  const py = (p[1] - a[1]) * M_PER_DEG_LAT;
  const len2 = bx * bx + by * by;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  const qx = bx * t;
  const qy = by * t;
  const point: [number, number] =
    t === 1 ? [b[0], b[1]] : [a[0] + qx / mPerDegLng, a[1] + qy / M_PER_DEG_LAT];
  return { t, point, distance_m: Math.hypot(px - qx, py - qy) };
}

/** Khoảng cách cộng dồn (m) tại từng đỉnh; `cum[0] = 0`; mảng rỗng → rỗng. */
export function cumulativeDistances(coords: readonly LngLat[]): number[] {
  const cum: number[] = [];
  let total = 0;
  for (let i = 0; i < coords.length; i++) {
    const prev = coords[i - 1];
    const cur = coords[i];
    if (i > 0 && prev && cur) total += haversineM(prev, cur);
    cum.push(total);
  }
  return cum;
}
