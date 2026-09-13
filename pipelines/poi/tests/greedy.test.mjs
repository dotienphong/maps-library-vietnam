import { describe, expect, it } from 'vitest';
import { createClusterer, pairAllowed, pairScore } from '../src/lib/greedy.mjs';

const base = {
  sa: 'osm',
  sb: 'fsq',
  sim: 0.9,
  dist_m: 20,
  ga: 'food_drink',
  gb: 'food_drink',
  pa: [],
  pb: [],
  da: [],
  db: [],
  ha: null,
  hb: null,
  sta: null,
  stb: null,
};

describe('pairAllowed (spec 5.4 bước 1–3 + luật chuỗi cửa hàng)', () => {
  it('Cộng ~ Cong Caphe: sim cao, cùng nhóm, gần → gộp', () => {
    expect(pairAllowed({ ...base, sim: 0.75 })).toBe(true);
  });
  it('ngưỡng 0,6; hoặc 0,45 khi trùng sđt/domain', () => {
    expect(pairAllowed({ ...base, sim: 0.5 })).toBe(false);
    expect(pairAllowed({ ...base, sim: 0.5, pa: ['+84909123456'], pb: ['+84909123456'] })).toBe(
      true,
    );
    expect(pairAllowed({ ...base, sim: 0.5, da: ['a.vn'], db: ['a.vn'] })).toBe(true);
  });
  it('nhóm khác → không; một bên other → được', () => {
    expect(pairAllowed({ ...base, gb: 'health' })).toBe(false);
    expect(pairAllowed({ ...base, gb: 'other' })).toBe(true);
  });
  it('bán kính 75 m; 150 m khi CẢ HAI thuộc education/health/public_admin/transport', () => {
    expect(pairAllowed({ ...base, dist_m: 90 })).toBe(false);
    expect(pairAllowed({ ...base, dist_m: 90, ga: 'education', gb: 'education' })).toBe(true);
    expect(pairAllowed({ ...base, dist_m: 90, ga: 'education', gb: 'other' })).toBe(false);
  });
  it('hai quán cùng chuỗi cách 60 m, số nhà khác nhau → KHÔNG gộp; cùng số nhà → gộp', () => {
    expect(
      pairAllowed({
        ...base,
        sim: 1,
        dist_m: 60,
        ha: '18',
        hb: '76',
        sta: 'nguyen hue',
        stb: 'nguyen hue',
      }),
    ).toBe(false);
    expect(
      pairAllowed({
        ...base,
        sim: 1,
        dist_m: 60,
        ha: '18',
        hb: '18',
        sta: 'nguyen hue',
        stb: 'nguyen hue',
      }),
    ).toBe(true);
    expect(pairAllowed({ ...base, sim: 1, dist_m: 60, ha: '18', hb: null })).toBe(true);
  });
  it('đường khác nhau (không chứa nhau) → không gộp', () => {
    expect(pairAllowed({ ...base, sta: 'nguyen hue', stb: 'le loi' })).toBe(false);
    expect(pairAllowed({ ...base, sta: 'nguyen hue', stb: 'duong nguyen hue' })).toBe(true);
  });
  it('cùng nguồn: sim ≥ 0,8 và (≤ 30 m hoặc trùng sđt/domain hoặc cùng số nhà)', () => {
    const same = { ...base, sb: 'osm' };
    expect(pairAllowed({ ...same, sim: 0.9, dist_m: 20 })).toBe(true);
    expect(pairAllowed({ ...same, sim: 0.9, dist_m: 60 })).toBe(false);
    expect(
      pairAllowed({ ...same, sim: 0.9, dist_m: 60, pa: ['+84909123456'], pb: ['+84909123456'] }),
    ).toBe(true);
    expect(pairAllowed({ ...same, sim: 0.7, dist_m: 10 })).toBe(false);
  });
  it('pairScore = 0,6·sim + 0,4·(1 − d/75), d kẹp ở 75', () => {
    expect(pairScore({ sim: 1, dist_m: 0 })).toBeCloseTo(1);
    expect(pairScore({ sim: 0.5, dist_m: 75 })).toBeCloseTo(0.3);
    expect(pairScore({ sim: 0.5, dist_m: 150 })).toBeCloseTo(0.3);
  });
});

describe('createClusterer — ghép tham lam, không bắc cầu', () => {
  const src = { 1: 'osm', 2: 'fsq', 3: 'fsq', 4: 'fsq', 5: 'osm' };
  it('mỗi bản ghi một cụm; tối đa 1 bản ghi mỗi nguồn; không gộp hai cụm đã có', () => {
    const c = createClusterer(5, { sourceOf: (r) => src[r], onePerSource: true });
    c.consider(1, 2); // osm+fsq → cụm A
    c.consider(2, 3); // A đã có FSQ → 3 bị từ chối
    c.consider(4, 5); // fsq+osm → cụm B
    c.consider(2, 4); // A và B đều đã có → không bắc cầu
    c.consider(3, 5); // B đã có FSQ → 3 vẫn lẻ
    const { clusterOf, members } = c.result();
    expect(clusterOf[1]).toBe(clusterOf[2]);
    expect(clusterOf[3]).toBe(0);
    expect(clusterOf[4]).toBe(clusterOf[5]);
    expect(clusterOf[4]).not.toBe(clusterOf[1]);
    expect(members.get(clusterOf[1])).toEqual([1, 2]);
  });
  it('lượt trùng cùng nguồn: không giới hạn nguồn nhưng giới hạn kích cỡ', () => {
    const c = createClusterer(5, { sourceOf: () => 'fsq', onePerSource: false, maxSize: 2 });
    c.consider(1, 2);
    c.consider(2, 3);
    const { clusterOf } = c.result();
    expect(clusterOf[3]).toBe(0);
  });
});

describe('thứ tự cặp tham lam', () => {
  it('điểm bằng nhau dùng a, b làm tie-break để kết quả không đổi qua lần chạy', () => {
    const pairs = [
      { a: 9, b: 10, score: 0.8 },
      { a: 1, b: 7, score: 0.8 },
      { a: 1, b: 6, score: 0.8 },
    ];
    expect(
      [...pairs]
        .sort((left, right) => right.score - left.score || left.a - right.a || left.b - right.b)
        .map(({ a, b }) => [a, b]),
    ).toEqual([
      [1, 6],
      [1, 7],
      [9, 10],
    ]);
  });
});
