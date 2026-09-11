import { type LngLat, angleDiffDeg, bearingDeg, projectOnSegment } from './geometry';
import type { RouteIndex } from './progress';

export interface SnapResult {
  /** Đỉnh đầu của đoạn được chọn. */
  shapeIndex: number;
  t: number;
  point: [number, number];
  /** Khoảng cách vuông góc fix → tuyến (m). */
  distance_m: number;
  /** Mét từ đầu tuyến tới điểm chiếu. */
  along_m: number;
}

export interface SnapOptions {
  /** null → tìm trên toàn tuyến (fix đầu sau start/setRoute). */
  fromShapeIndex: number | null;
  /** Đoạn có mốc đầu ≤ cum[from] + window_m mới được xét. */
  window_m: number;
  heading?: number | null | undefined;
}

/** Hai ứng viên KHÔNG kề nhau chênh dưới ngần này coi là hoà → tie-break theo heading rồi chiều đi. */
const TIE_M = 10;
/** Lùi tối đa bấy nhiêu đoạn so với đoạn hiện tại (nhiễu GPS lùi nhẹ). */
const LOOKBACK_SEGMENTS = 2;

export function snapToRoute(index: RouteIndex, p: LngLat, opts: SnapOptions): SnapResult | null {
  const { coords, cum } = index;
  const segments = coords.length - 1;
  if (segments < 1) return null;

  let lo = 0;
  let hi = segments - 1;
  if (opts.fromShapeIndex !== null) {
    const from = Math.max(0, Math.min(opts.fromShapeIndex, segments - 1));
    lo = Math.max(0, from - LOOKBACK_SEGMENTS);
    const limit = (cum[from] ?? 0) + opts.window_m;
    hi = from;
    for (let i = from + 1; i < segments; i++) {
      if ((cum[i] ?? 0) <= limit) hi = i;
      else break;
    }
  }

  const heading =
    typeof opts.heading === 'number' && Number.isFinite(opts.heading) ? opts.heading : null;
  let best: SnapResult | null = null;
  for (let i = lo; i <= hi; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    if (!a || !b) continue;
    const proj = projectOnSegment(p, a, b);
    const segStart = cum[i] ?? 0;
    const segEnd = cum[i + 1] ?? segStart;
    const candidate: SnapResult = {
      shapeIndex: i,
      t: proj.t,
      point: proj.point,
      distance_m: proj.distance_m,
      along_m: segStart + proj.t * (segEnd - segStart),
    };
    if (!best) {
      best = candidate;
      continue;
    }
    const diff = candidate.distance_m - best.distance_m;
    const adjacent = candidate.shapeIndex - best.shapeIndex <= 1;
    if (!adjacent && Math.abs(diff) <= TIE_M) {
      best = preferByHeadingOrFurther(coords, best, candidate, heading);
    } else if (diff < 0) {
      best = candidate;
    }
  }
  return best;
}

function segmentBearing(coords: readonly [number, number][], shapeIndex: number): number {
  const a = coords[shapeIndex];
  const b = coords[shapeIndex + 1];
  return a && b ? bearingDeg(a, b) : 0;
}

/** Có heading → đoạn cùng hướng hơn; hoà (hoặc không heading) → đoạn xa hơn theo chiều đi. */
function preferByHeadingOrFurther(
  coords: readonly [number, number][],
  current: SnapResult,
  candidate: SnapResult,
  heading: number | null,
): SnapResult {
  if (heading === null) return candidate;
  const dCurrent = angleDiffDeg(segmentBearing(coords, current.shapeIndex), heading);
  const dCandidate = angleDiffDeg(segmentBearing(coords, candidate.shapeIndex), heading);
  return dCandidate <= dCurrent ? candidate : current;
}
