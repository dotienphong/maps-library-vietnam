import { describe, expect, it } from 'vitest';
import fixture from '../../tests/fixtures/directions-q1.json';
import { syntheticTwoLegRoute } from '../../tests/helpers/synthetic-route';
import type { DirectionsResponse, Route } from '../types';
import { buildRouteIndex, progressAt, stepAt } from './progress';

const q1 = (fixture as unknown as DirectionsResponse).routes[0] as Route;

describe('buildRouteIndex', () => {
  it('fixture Quận 1: 6 step phẳng, mốc mét tăng, tổng ≈ distance_m của tuyến (±5 %)', () => {
    const index = buildRouteIndex(q1);
    expect(index.steps).toHaveLength(6);
    expect(index.steps.map((s) => s.step.kind)).toEqual([
      'depart',
      'turn_right',
      'turn_left',
      'turn_right',
      'turn_left',
      'arrive',
    ]);
    expect(index.steps[0]?.begin_m).toBe(0);
    for (let i = 1; i < index.steps.length; i++) {
      expect(index.steps[i]?.begin_m ?? 0).toBeGreaterThanOrEqual(index.steps[i - 1]?.begin_m ?? 0);
      expect(index.steps[i - 1]?.end_m).toBe(index.steps[i]?.begin_m);
    }
    expect(index.steps.at(-1)?.end_m).toBe(index.total_m);
    expect(Math.abs(index.total_m - q1.distance_m) / q1.distance_m).toBeLessThan(0.05);
    expect(index.legBegin_m).toEqual([0]);
  });

  it('tuyến hai leg: legBegin_m có hai mốc, step arrive-via dài 0 nằm giữa', () => {
    const route = syntheticTwoLegRoute().routes[0] as Route;
    const index = buildRouteIndex(route);
    expect(index.steps).toHaveLength(6);
    expect(index.legBegin_m[0]).toBe(0);
    expect(index.legBegin_m[1]).toBeCloseTo(222.39, 0);
    const via = index.steps[2];
    expect(via?.step.kind).toBe('arrive');
    expect(via?.begin_m).toBe(via?.end_m);
    expect(index.steps[3]?.legIndex).toBe(1);
  });
});

describe('stepAt / progressAt', () => {
  const route = syntheticTwoLegRoute().routes[0] as Route;
  const index = buildRouteIndex(route);

  it('along 0 → step 0; qua via → step depart của leg 1 (bỏ step dài 0); hết tuyến → step cuối', () => {
    expect(stepAt(index, 0)).toBe(0);
    expect(stepAt(index, 150)).toBe(1);
    expect(stepAt(index, index.legBegin_m[1] ?? 0)).toBe(3);
    expect(stepAt(index, (index.legBegin_m[1] ?? 0) + 1)).toBe(3);
    expect(stepAt(index, index.total_m)).toBe(5);
    expect(stepAt(index, index.total_m + 50)).toBe(5);
  });

  it('progressAt: khoảng cách tới step kế, còn lại, ETA giảm đơn điệu', () => {
    const start = progressAt(index, 0);
    expect(start.stepIndex).toBe(0);
    expect(start.legIndex).toBe(0);
    expect(start.distanceToStep_m).toBeCloseTo(111.2, 0);
    expect(start.remaining_m).toBeCloseTo(index.total_m, 6);
    expect(start.remaining_s).toBe(320);

    let previous = start.remaining_s;
    for (let along = 20; along <= index.total_m; along += 20) {
      const p = progressAt(index, along);
      expect(p.remaining_s).toBeLessThanOrEqual(previous);
      previous = p.remaining_s;
    }
    const end = progressAt(index, index.total_m);
    expect(end.stepIndex).toBe(5);
    expect(end.distanceToStep_m).toBe(0);
    expect(end.remaining_m).toBe(0);
    expect(end.remaining_s).toBe(0);
  });

  it('progressAt giữa step 1: ETA = phần còn lại step 1 theo tỉ lệ + các step sau', () => {
    const begin1 = index.steps[1]?.begin_m ?? 0;
    const end1 = index.steps[1]?.end_m ?? 0;
    const p = progressAt(index, (begin1 + end1) / 2);
    // 0,5 × 80 + 0 + 80 + 80 + 0 = 200
    expect(p.remaining_s).toBe(200);
    expect(p.legIndex).toBe(0);
  });
});
