import { decodePolyline6 } from '../polyline';
import type { Route, RouteStep } from '../types';
import { cumulativeDistances } from './geometry';

export interface FlatStep {
  step: RouteStep;
  legIndex: number;
  indexInLeg: number;
  /** Mét từ đầu tuyến tới điểm rẽ của step (đầu step). */
  begin_m: number;
  /** = begin_m của step kế, hoặc tổng chiều dài với step cuối. */
  end_m: number;
}

export interface RouteIndex {
  coords: [number, number][];
  /** cum[i] = mét từ đầu tuyến tới đỉnh i. */
  cum: number[];
  total_m: number;
  /** Step phẳng qua mọi leg, theo thứ tự đi. */
  steps: FlatStep[];
  /** Mét tại điểm đầu từng leg (`shape_offset`). */
  legBegin_m: number[];
}

export function buildRouteIndex(route: Route): RouteIndex {
  const coords = decodePolyline6(route.geometry);
  const cum = cumulativeDistances(coords);
  const total_m = cum[cum.length - 1] ?? 0;
  const at = (vertex: number): number => cum[Math.min(Math.max(vertex, 0), cum.length - 1)] ?? 0;

  const steps: FlatStep[] = [];
  route.legs.forEach((leg, legIndex) => {
    leg.steps.forEach((step, indexInLeg) => {
      const begin_m = at(step.shape_begin);
      steps.push({ step, legIndex, indexInLeg, begin_m, end_m: begin_m });
    });
  });
  for (let i = 0; i < steps.length; i++) {
    const current = steps[i];
    if (current) current.end_m = steps[i + 1]?.begin_m ?? total_m;
  }
  return { coords, cum, total_m, steps, legBegin_m: route.legs.map((leg) => at(leg.shape_offset)) };
}

/**
 * Step đang ở tại along_m: step có begin_m ≤ along < end_m. Step dài 0 (arrive tại via) không bao
 * giờ là "đang ở" trừ step cuối cùng khi along ≥ total.
 */
export function stepAt(index: RouteIndex, along_m: number): number {
  const { steps, total_m } = index;
  if (steps.length === 0) return 0;
  if (along_m >= total_m) return steps.length - 1;
  let found = 0;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (!s) continue;
    if (s.begin_m > along_m) break;
    if (along_m < s.end_m) {
      found = i;
      break;
    }
    found = i;
  }
  return found;
}

export interface ProgressAt {
  stepIndex: number;
  legIndex: number;
  distanceToStep_m: number;
  remaining_m: number;
  remaining_s: number;
}

export function progressAt(index: RouteIndex, along_m: number): ProgressAt {
  const clamped = Math.max(0, Math.min(along_m, index.total_m));
  const stepIndex = stepAt(index, clamped);
  const current = index.steps[stepIndex];
  const next = index.steps[stepIndex + 1];
  let remaining_s = 0;
  if (current) {
    const length = current.end_m - current.begin_m;
    const fraction = length > 0 ? Math.max(0, Math.min(1, (current.end_m - clamped) / length)) : 0;
    remaining_s += fraction * current.step.duration_s;
  }
  for (let i = stepIndex + 1; i < index.steps.length; i++) {
    remaining_s += index.steps[i]?.step.duration_s ?? 0;
  }
  return {
    stepIndex,
    legIndex: current?.legIndex ?? 0,
    distanceToStep_m: next ? Math.max(0, next.begin_m - clamped) : 0,
    remaining_m: Math.max(0, index.total_m - clamped),
    remaining_s: Math.round(remaining_s),
  };
}
