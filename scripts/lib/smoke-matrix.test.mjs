import { describe, expect, it } from 'vitest';
import {
  HCM_POINTS,
  jitter,
  matrixIssues,
  matrixUrl,
  optimizedIssues,
  optimizedUrl,
  parseMatrixSmokeArgs,
  planBai,
} from './smoke-matrix.mjs';

describe('HCM_POINTS', () => {
  it('29 điểm, đều trong hộp Việt Nam, không trùng', () => {
    expect(HCM_POINTS).toHaveLength(29);
    for (const [lat, lng] of HCM_POINTS) {
      expect(lat).toBeGreaterThan(10.7);
      expect(lat).toBeLessThan(10.9);
      expect(lng).toBeGreaterThan(106.6);
      expect(lng).toBeLessThan(106.8);
    }
    expect(new Set(HCM_POINTS.map((p) => p.join(','))).size).toBe(29);
  });
});

describe('planBai', () => {
  it('mọi bài nằm trong trần 50 cặp / 10 điểm dừng: A 10×5, B 25×2, C from + 10 stops + to, D 5 ma trận 10×5', () => {
    const bai = planBai();
    expect(bai.A.sources).toHaveLength(10);
    expect(bai.A.targets).toHaveLength(5);
    expect(bai.B.sources).toHaveLength(25);
    expect(bai.B.targets).toHaveLength(2);
    expect(bai.C.stops).toHaveLength(10);
    for (const m of [bai.A, bai.B, ...bai.D]) {
      expect(m.sources.length * m.targets.length).toBeLessThanOrEqual(50);
    }
    expect(bai.D).toHaveLength(5);
    expect(bai.D[0]?.sources).not.toEqual(bai.D[1]?.sources);
    // Không có điểm nào vừa là source vừa là target trong cùng bài (ô 0 giây làm hỏng phép kiểm dương).
    for (const m of [bai.A, bai.B, ...bai.D]) {
      const s = new Set(m.sources.map((p) => p.join(',')));
      expect(m.targets.some((p) => s.has(p.join(',')))).toBe(false);
    }
  });
});

describe('cỡ bài và cỡ kiểm phải khớp nhau', () => {
  it('response đúng cỡ của từng bài thì matrixIssues/optimizedIssues không báo lỗi', () => {
    const bai = planBai();
    for (const m of [bai.A, bai.B, ...bai.D]) {
      const rows = m.sources.length;
      const cols = m.targets.length;
      const bang = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 60));
      expect(matrixIssues({ durations_s: bang, distances_m: bang }, rows, cols)).toEqual([]);
    }
    const stops = bai.C.stops.length;
    expect(
      optimizedIssues(
        {
          order: Array.from({ length: stops }, (_, i) => i),
          routes: [{ legs: Array.from({ length: stops + 1 }, () => ({})) }],
          waypoints: Array.from({ length: stops + 2 }, () => ({})),
        },
        stops,
      ),
    ).toEqual([]);
  });
});

describe('URL', () => {
  it('matrixUrl/optimizedUrl ghép lat,lng nối ";" và mode; jitter dịch vĩ độ điểm đầu 0,0001° × k', () => {
    const root = 'https://api.test';
    expect(
      matrixUrl(root, {
        sources: [[10.7798, 106.699]],
        targets: [[10.7725, 106.698]],
        mode: 'car',
      }),
    ).toBe('https://api.test/v1/matrix?sources=10.7798,106.699&targets=10.7725,106.698&mode=car');
    expect(
      optimizedUrl(root, {
        from: [10.7798, 106.699],
        stops: [[10.7716, 106.7043]],
        to: [10.7725, 106.698],
        mode: 'motorbike',
      }),
    ).toBe(
      'https://api.test/v1/optimized-route?from=10.7798,106.699&stops=10.7716,106.7043&to=10.7725,106.698&mode=motorbike',
    );
    const shifted = jitter(
      [
        [10.7798, 106.699],
        [10.7725, 106.698],
      ],
      3,
    );
    expect(shifted[0]).toEqual([10.7801, 106.699]);
    expect(shifted[1]).toEqual([10.7725, 106.698]);
  });
});

describe('matrixIssues / optimizedIssues', () => {
  const ok = { durations_s: [[10, 20]], distances_m: [[100, 200]] };
  it('bảng đúng cỡ, số nguyên dương → không lỗi; null, âm, sai cỡ → có lỗi nêu ô', () => {
    expect(matrixIssues(ok, 1, 2)).toEqual([]);
    expect(matrixIssues({ ...ok, durations_s: [[10, null]] }, 1, 2)).toEqual([
      'durations_s[0][1] = null',
    ]);
    expect(matrixIssues({ ...ok, distances_m: [[100, -1]] }, 1, 2)[0]).toMatch(
      /distances_m\[0\]\[1\]/,
    );
    expect(matrixIssues(ok, 2, 2)[0]).toMatch(/durations_s có 1 hàng, cần 2/);
    expect(matrixIssues('x', 1, 2)[0]).toMatch(/không phải object/);
  });

  it('optimized: order phải là hoán vị đủ, legs = stops + 1, waypoints = stops + 2', () => {
    const good = { order: [1, 0], routes: [{ legs: [{}, {}, {}] }], waypoints: [{}, {}, {}, {}] };
    expect(optimizedIssues(good, 2)).toEqual([]);
    expect(optimizedIssues({ ...good, order: [0, 0] }, 2)[0]).toMatch(/order/);
    expect(optimizedIssues({ ...good, routes: [{ legs: [{}] }] }, 2)[0]).toMatch(/legs/);
  });
});

describe('parseMatrixSmokeArgs', () => {
  it('mặc định: base production, 5 lượt, 10 s/lượt (nhịp 6/phút), không p95-max, 0 vòng D', () => {
    expect(parseMatrixSmokeArgs([])).toEqual({
      base: 'https://api.ai-solutions.io.vn',
      confirmProduction: false,
      requests: 5,
      intervalMs: 10000,
      p95Max: null,
      rounds: 0,
      ratioMax: 2,
      busyMax: 2000,
    });
  });
  it('đọc cờ; cờ lạ, lặp, ngoài khoảng → ném', () => {
    const args = parseMatrixSmokeArgs([
      '--confirm-production',
      '--requests=20',
      '--rounds=3',
      '--p95-max=3000',
      '--ratio-max=1.5',
      '--busy-max=1500',
      '--base=https://x.test',
    ]);
    expect(args).toMatchObject({
      confirmProduction: true,
      requests: 20,
      rounds: 3,
      p95Max: 3000,
      ratioMax: 1.5,
      busyMax: 1500,
    });
    expect(() => parseMatrixSmokeArgs(['--foo=1'])).toThrow(/Cờ không hợp lệ/);
    // `pnpm smoke:matrix -- --confirm-production` đưa cả `--` vào argv (pnpm 10).
    expect(parseMatrixSmokeArgs(['--', '--confirm-production']).confirmProduction).toBe(true);
    expect(() => parseMatrixSmokeArgs(['--requests=0'])).toThrow(/từ 1 đến 50/);
    expect(() => parseMatrixSmokeArgs(['--rounds=11'])).toThrow(/từ 0 đến 10/);
    expect(() => parseMatrixSmokeArgs(['--requests=2', '--requests=3'])).toThrow(/không được lặp/);
  });
});
