import { describe, expect, it } from 'vitest';
import {
  type CompassSample,
  MOVING_SPEED_MPS,
  createHeadingFilter,
  signedDiffDeg,
  wrapDeg,
  yawRateDps,
} from './heading';

const T0 = 1_700_000_000_000;
const compass = (
  heading: number,
  timestamp: number,
  over: Partial<CompassSample> = {},
): CompassSample => ({ heading, accuracy: 'high', timestamp, ...over });

describe('wrapDeg / signedDiffDeg', () => {
  it('chuẩn hoá [0, 360) và chênh có dấu (−180, 180]', () => {
    expect(wrapDeg(360)).toBe(0);
    expect(wrapDeg(-90)).toBe(270);
    expect(wrapDeg(725)).toBe(5);
    expect(wrapDeg(-360)).toBe(0);
    expect(signedDiffDeg(1, 359)).toBe(2);
    expect(signedDiffDeg(359, 1)).toBe(-2);
    expect(signedDiffDeg(180, 0)).toBe(180);
    expect(MOVING_SPEED_MPS).toBe(1);
  });
});

describe('createHeadingFilter', () => {
  it('mẫu la bàn đầu phát ngay, giữ accuracy, suy magnetic', () => {
    const f = createHeadingFilter();
    const fix = f.compass(compass(10, T0, { magnetic: 12, accuracy: 'medium' }));
    expect(fix).toEqual({
      heading: 10,
      magnetic: 12,
      accuracy: 'medium',
      timestamp: T0,
      source: 'compass',
    });
    expect(f.current()).toBe(fix);
  });

  it('không gyro: làm mượt theo smoothing_s và đi qua 0 khi vòng 359 → 1', () => {
    const f = createHeadingFilter({ smoothing_s: 0.2 });
    f.compass(compass(0, T0));
    const a = f.compass(compass(10, T0 + 200)); // alpha = 1 − e^-1 ≈ 0,632
    expect(a?.heading).toBeCloseTo(6.32, 1);
    const g = createHeadingFilter({ smoothing_s: 0.2 });
    g.compass(compass(359, T0));
    const b = g.compass(compass(1, T0 + 200)); // chênh +2° → 359 + 1,26 → 0,26, không quay 358°
    expect(b?.heading).toBeCloseTo(0.26, 1);
  });

  it('gyro: null trước la bàn và ở mẫu đầu; tích phân đúng dấu; bỏ khoảng quá lớn; gyroSign đảo', () => {
    // tau vô cực → không kéo về la bàn, chỉ còn phép tích phân để pin dấu và dt
    const f = createHeadingFilter({
      minInterval_ms: 0,
      minDelta_deg: 0,
      tau_s: Number.POSITIVE_INFINITY,
    });
    expect(f.gyro({ z_dps: 90, timestamp: 0 }, T0)).toBeNull(); // chưa có la bàn
    f.reset();
    f.compass(compass(180, T0));
    expect(f.gyro({ z_dps: 90, timestamp: 1000 }, T0 + 1000)).toBeNull(); // mẫu gyro đầu: chưa có dt
    const a = f.gyro({ z_dps: 90, timestamp: 2000 }, T0 + 2000); // 1 s × 90°/s ngược chiều kim đồng hồ
    expect(a?.heading).toBeCloseTo(90, 6);
    expect(a?.source).toBe('fused');
    expect(a?.timestamp).toBe(T0 + 2000);
    expect(f.gyro({ z_dps: 90, timestamp: 5500 }, T0 + 5500)).toBeNull(); // cách 3,5 s > maxGyroGap
    expect(f.current()?.heading).toBeCloseTo(90, 6);
    const b = f.gyro({ z_dps: -20, timestamp: 6000 }, T0 + 6000); // 0,5 s × −20°/s → +10°
    expect(b?.heading).toBeCloseTo(100, 6);

    const r = createHeadingFilter({
      gyroSign: -1,
      minInterval_ms: 0,
      minDelta_deg: 0,
      tau_s: Number.POSITIVE_INFINITY,
    });
    r.compass(compass(180, T0));
    r.gyro({ z_dps: 90, timestamp: 1000 }, T0 + 1000);
    expect(r.gyro({ z_dps: 90, timestamp: 2000 }, T0 + 2000)?.heading).toBeCloseTo(270, 6);
  });

  it('gyro sống: kéo về la bàn ở TỪNG BƯỚC GYRO theo dt của bước, không nhảy khi la bàn im lâu', () => {
    // Thực địa iPhone 13/09: iOS chỉ phát la bàn khi đổi ≥ 1° → đứng yên vài giây là la bàn im.
    // Bản cũ kéo lúc mẫu la bàn đến với dt = thời gian từ mẫu la bàn trước → alpha ≈ 1 → nhảy.
    const f = createHeadingFilter({ tau_s: 0.7, minInterval_ms: 0, minDelta_deg: 0 });
    f.compass(compass(0, T0));
    for (let t = 0; t <= 3000; t += 50) f.gyro({ z_dps: 0, timestamp: t }, T0 + t);
    expect(f.current()?.heading).toBe(0);
    // la bàn im 3 s rồi báo 4° (la bàn trễ hơn gyro) → mẫu la bàn KHÔNG đổi góc
    expect(f.compass(compass(4, T0 + 3000))?.heading).toBe(0);
    // bước gyro 50 ms kế tiếp chỉ kéo 1 − e^(−0,05/0,7) ≈ 6,9 % của 4°
    const a = f.gyro({ z_dps: 0, timestamp: 3050 }, T0 + 3050);
    expect(a?.heading).toBeCloseTo(0.276, 2);
    // thêm 3τ bước gyro → còn dưới 5 % chênh
    let b = a;
    for (let t = 3100; t <= 3050 + 2100; t += 50)
      b = f.gyro({ z_dps: 0, timestamp: t }, T0 + t) ?? b;
    expect(Math.abs(4 - (b?.heading ?? 0))).toBeLessThan(0.2);
  });

  it('gyro có bias 1°/s, la bàn im 10 s: góc không trôi quá bias·τ (bản cũ trôi tự do 10°)', () => {
    const f = createHeadingFilter({ tau_s: 0.7, minInterval_ms: 0, minDelta_deg: 0 });
    f.compass(compass(0, T0));
    let last = null as ReturnType<typeof f.gyro>;
    for (let t = 0; t <= 10_000; t += 50) last = f.gyro({ z_dps: 1, timestamp: t }, T0 + t) ?? last;
    expect(Math.abs(signedDiffDeg(last?.heading ?? 0, 0))).toBeLessThan(1);
  });

  it('gyro chết (mẫu cuối cách quá maxGyroGap_s): la bàn tự làm mượt theo smoothing_s như khi không có gyro', () => {
    const f = createHeadingFilter({
      smoothing_s: 0.2,
      tau_s: 0.7,
      minInterval_ms: 0,
      minDelta_deg: 0,
    });
    f.compass(compass(0, T0));
    f.gyro({ z_dps: 0, timestamp: 0 }, T0);
    f.gyro({ z_dps: 0, timestamp: 100 }, T0 + 100);
    // 1,9 s không có gyro → coi như chết → alpha = 1 − e^(−2/0,2) ≈ 1
    expect(f.compass(compass(90, T0 + 2000))?.heading).toBeCloseTo(90, 1);
  });

  it('phát thưa: cách ≥ minInterval_ms và đổi ≥ minDelta_deg (chỉ định rõ, không phụ thuộc mặc định)', () => {
    const f = createHeadingFilter({ smoothing_s: 0, minInterval_ms: 100, minDelta_deg: 1 });
    expect(f.compass(compass(10, T0))).not.toBeNull();
    expect(f.compass(compass(50, T0 + 50))).toBeNull(); // quá sớm
    expect(f.compass(compass(10.5, T0 + 100))).toBeNull(); // đổi 0,5° so với lần phát (10)
    expect(f.compass(compass(12, T0 + 150))?.heading).toBe(12);
  });

  it('mặc định minInterval_ms là 50 ms (20 Hz, khớp nhịp gyro) — không bỏ phí mẫu gyro như trần cũ 100 ms', () => {
    const f = createHeadingFilter({ smoothing_s: 0 }); // alpha = 1 → est = target; minDelta_deg mặc định 1°
    expect(f.compass(compass(10, T0))).not.toBeNull();
    expect(f.compass(compass(30, T0 + 40))).toBeNull(); // 40 ms < 50 ms → vẫn quá sớm
    expect(f.compass(compass(30, T0 + 50))?.heading).toBe(30); // đúng 50 ms, đổi 20° → phát
  });

  it('magnetic suy từ độ lệch của mẫu la bàn cuối, kể cả sau khi gyro xoay', () => {
    const f = createHeadingFilter({
      minInterval_ms: 0,
      minDelta_deg: 0,
      tau_s: Number.POSITIVE_INFINITY,
    });
    f.compass(compass(10, T0, { magnetic: 12 }));
    f.gyro({ z_dps: 0, timestamp: 0 }, T0);
    const a = f.gyro({ z_dps: 20, timestamp: 1000 }, T0 + 1000); // 10 − 20 → 350
    expect(a?.heading).toBeCloseTo(350, 6);
    expect(a?.magnetic).toBeCloseTo(352, 6);
  });

  it('reset về trạng thái đầu', () => {
    const f = createHeadingFilter();
    f.compass(compass(10, T0));
    f.reset();
    expect(f.current()).toBeNull();
    expect(f.compass(compass(20, T0 + 10))?.heading).toBe(20); // phát ngay như mẫu đầu
  });
});

describe('yawRateDps', () => {
  const R = { x_dps: 10, y_dps: 20, z_dps: 30 };
  it('máy nằm ngang (lên = +z) → đúng z; không có vector lên → cũng z (hành vi cũ)', () => {
    expect(yawRateDps(R, { x: 0, y: 0, z: 1 })).toBeCloseTo(30, 9);
    expect(yawRateDps(R, null)).toBe(30);
    expect(yawRateDps(R, { x: 0, y: 0, z: 0 })).toBe(30);
  });
  it('máy dựng đứng (lên = +y) → đúng y; nghiêng 45° → y·sin + z·cos; chuẩn hoá vector lên', () => {
    expect(yawRateDps(R, { x: 0, y: 1, z: 0 })).toBeCloseTo(20, 9);
    const s = Math.SQRT1_2;
    expect(yawRateDps(R, { x: 0, y: s, z: s })).toBeCloseTo(20 * s + 30 * s, 9);
    expect(yawRateDps(R, { x: 0, y: 2 * s, z: 2 * s })).toBeCloseTo(20 * s + 30 * s, 9); // |up| = 2
  });
  it('úp màn hình (lên = −z) → đảo dấu z: xoay CCW nhìn từ trên vẫn dương', () => {
    expect(yawRateDps(R, { x: 0, y: 0, z: -1 })).toBeCloseTo(-30, 9);
  });
});
