import { describe, expect, it } from 'vitest';
import { NAVIGATION_THRESHOLDS } from './types';

describe('NAVIGATION_THRESHOLDS (spec B mục 4.3)', () => {
  it('ba phương tiện, giá trị khởi điểm đúng bảng', () => {
    expect(Object.keys(NAVIGATION_THRESHOLDS).sort()).toEqual(['car', 'motorbike', 'walk']);
    expect(NAVIGATION_THRESHOLDS.walk).toEqual({
      offRoute_m: 25,
      offRouteFixes: 3,
      offRouteSeconds: 5,
      maxAccuracy_m: 60,
      approach_m: 40,
      pre_m: 15,
      arrive_m: 15,
      rerouteCooldown_s: 15,
      rerouteMaxFailures: 3,
    });
    expect(NAVIGATION_THRESHOLDS.motorbike).toMatchObject({
      offRoute_m: 40,
      maxAccuracy_m: 100,
      approach_m: 200,
      pre_m: 50,
      arrive_m: 25,
    });
    expect(NAVIGATION_THRESHOLDS.car).toMatchObject({
      offRoute_m: 50,
      maxAccuracy_m: 100,
      approach_m: 400,
      pre_m: 80,
      arrive_m: 30,
    });
  });

  it('câu rẽ luôn đọc gần hơn câu "Trong X nữa", và bán kính đến nơi không lớn hơn câu rẽ', () => {
    for (const th of Object.values(NAVIGATION_THRESHOLDS)) {
      expect(th.pre_m).toBeLessThan(th.approach_m);
      expect(th.arrive_m).toBeLessThanOrEqual(th.pre_m + 1);
    }
  });
});
