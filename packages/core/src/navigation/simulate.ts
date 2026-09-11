import { decodePolyline6 } from '../polyline';
import type { Route, TravelMode } from '../types';
import { bearingDeg, cumulativeDistances } from './geometry';
import type { GeoFix } from './types';

export interface SimulateOptions {
  /** Mặc định theo mode: walk 1.4, motorbike 8, car 12. */
  speed_mps?: number;
  /** Mặc định 1. */
  interval_s?: number;
  /** Mặc định 8. */
  accuracy_m?: number;
  /** Nhiễu vị trí đều trong hình tròn bán kính này; mặc định 0. */
  jitter_m?: number;
  /** Mặc định 1. */
  seed?: number;
  /** Mặc định 1_700_000_000_000. */
  start_ms?: number;
}

export const SIMULATE_DEFAULT_SPEED_MPS: Readonly<Record<TravelMode, number>> = {
  walk: 1.4,
  motorbike: 8,
  car: 12,
};

const M_PER_DEG_LAT = (Math.PI / 180) * 6_371_008.8;

/** PRNG xác định (mulberry32) để test và demo lặp lại được. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Đi dọc polyline với vận tốc hằng; heading = hướng đoạn; thuần và xác định. */
export function simulateFixes(route: Route, opts: SimulateOptions = {}): GeoFix[] {
  const coords = decodePolyline6(route.geometry);
  const cum = cumulativeDistances(coords);
  const total = cum[cum.length - 1] ?? 0;
  const speed = opts.speed_mps ?? SIMULATE_DEFAULT_SPEED_MPS[route.mode];
  const interval = opts.interval_s ?? 1;
  const accuracy = opts.accuracy_m ?? 8;
  const jitter = opts.jitter_m ?? 0;
  const start = opts.start_ms ?? 1_700_000_000_000;
  const rand = mulberry32(opts.seed ?? 1);
  const stepM = speed * interval;
  if (coords.length === 0 || stepM <= 0) return [];

  const fixes: GeoFix[] = [];
  let segment = 0;
  const distances: number[] = [];
  for (let d = 0; d < total; d += stepM) distances.push(d);
  distances.push(total);

  distances.forEach((d, k) => {
    while (segment < coords.length - 2 && (cum[segment + 1] ?? 0) < d) segment += 1;
    const a = coords[segment];
    const b = coords[segment + 1] ?? a;
    if (!a || !b) return;
    const segStart = cum[segment] ?? 0;
    const segLen = (cum[segment + 1] ?? segStart) - segStart;
    const t = segLen > 0 ? Math.min(1, (d - segStart) / segLen) : 0;
    let lng = a[0] + (b[0] - a[0]) * t;
    let lat = a[1] + (b[1] - a[1]) * t;
    if (jitter > 0) {
      const angle = rand() * 2 * Math.PI;
      const radius = jitter * Math.sqrt(rand());
      lat += (radius * Math.cos(angle)) / M_PER_DEG_LAT;
      lng += (radius * Math.sin(angle)) / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
    }
    fixes.push({
      lng,
      lat,
      accuracy_m: accuracy,
      heading: bearingDeg(a, b),
      speed_mps: speed,
      timestamp: start + k * interval * 1000,
    });
  });
  return fixes;
}
