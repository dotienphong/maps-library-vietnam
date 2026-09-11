import { describe, expect, it } from 'vitest';
import {
  angleDiffDeg,
  bearingDeg,
  cumulativeDistances,
  haversineM,
  projectOnSegment,
} from './geometry';

// 1° trên kinh tuyến với R = 6 371 008,8 m là 111 195,08 m.
const ONE_DEG_M = 111_195.08;

describe('geometry', () => {
  it('haversine: 1° vĩ độ ≈ 111 195 m, cùng điểm = 0, đối xứng', () => {
    expect(haversineM([0, 0], [0, 1])).toBeCloseTo(ONE_DEG_M, 0);
    expect(haversineM([106.7, 10.77], [106.7, 10.77])).toBe(0);
    expect(haversineM([106.699, 10.7798], [106.698, 10.7725])).toBeCloseTo(
      haversineM([106.698, 10.7725], [106.699, 10.7798]),
      6,
    );
    // Nhà thờ Đức Bà → Chợ Bến Thành đường chim bay ~0,82 km
    expect(haversineM([106.699, 10.7798], [106.698, 10.7725])).toBeGreaterThan(800);
    expect(haversineM([106.699, 10.7798], [106.698, 10.7725])).toBeLessThan(840);
  });

  it('bearing bốn hướng chính, kết quả trong [0, 360)', () => {
    expect(bearingDeg([0, 0], [0, 1])).toBeCloseTo(0, 5);
    expect(bearingDeg([0, 0], [1, 0])).toBeCloseTo(90, 5);
    expect(bearingDeg([0, 0], [0, -1])).toBeCloseTo(180, 5);
    expect(bearingDeg([0, 0], [-1, 0])).toBeCloseTo(270, 5);
  });

  it('angleDiffDeg: chênh góc nhỏ nhất, xử lý vòng 360', () => {
    expect(angleDiffDeg(10, 350)).toBe(20);
    expect(angleDiffDeg(90, 270)).toBe(180);
    expect(angleDiffDeg(45, 45)).toBe(0);
  });

  it('projectOnSegment: điểm giữa đoạn → t≈0,5, khoảng cách vuông góc ≈ 11 m; ngoài đầu mút thì kẹp', () => {
    const a: [number, number] = [106.7, 10.77];
    const b: [number, number] = [106.701, 10.77]; // ~109 m về đông
    const mid = projectOnSegment([106.7005, 10.7701], a, b);
    expect(mid.t).toBeCloseTo(0.5, 2);
    expect(mid.distance_m).toBeCloseTo(11.12, 0);
    expect(mid.point[0]).toBeCloseTo(106.7005, 6);
    expect(mid.point[1]).toBeCloseTo(10.77, 6);

    const beyond = projectOnSegment([106.702, 10.77], a, b);
    expect(beyond.t).toBe(1);
    expect(beyond.point).toEqual(b);
    expect(beyond.distance_m).toBeCloseTo(haversineM([106.702, 10.77], b), 0);

    const degenerate = projectOnSegment([106.7, 10.7701], a, a);
    expect(degenerate.t).toBe(0);
    expect(degenerate.distance_m).toBeCloseTo(11.12, 0);
  });

  it('cumulativeDistances: bắt đầu 0, tăng đơn điệu, cộng dồn haversine', () => {
    const cum = cumulativeDistances([
      [0, 0],
      [0, 1],
      [1, 1],
    ]);
    expect(cum[0]).toBe(0);
    expect(cum[1]).toBeCloseTo(ONE_DEG_M, 0);
    expect(cum[2]).toBeCloseTo(ONE_DEG_M + haversineM([0, 1], [1, 1]), 3);
    expect(cumulativeDistances([])).toEqual([]);
    expect(cumulativeDistances([[1, 1]])).toEqual([0]);
  });
});
