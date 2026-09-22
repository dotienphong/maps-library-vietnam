import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors';
import {
  MATRIX_MAX_PAIRS,
  MATRIX_MAX_SOURCES,
  MATRIX_MAX_TARGETS,
  matrixBody,
  matrixCacheUrl,
  parseMatrixParams,
  translateMatrix,
} from '../src/routing/matrix';
import type { ValhallaMatrixResponse } from '../src/routing/valhalla';
import fixture from './fixtures/valhalla/matrix-2x2.json';
import real from './fixtures/valhalla/q1-matrix.json';

const NTDB = '10.7798,106.6990';
const BT = '10.7725,106.6980';
const NHTP = '10.7769,106.7032';
const BX = '10.7716,106.7043';
const HN = '21.0285,105.8542';
const base = { sources: `${NTDB};${BT}`, targets: `${NHTP};${BX}` };
const points = (n: number, lat = 10.77) =>
  Array.from({ length: n }, (_, i) => `${lat},${(106.6 + i / 1000).toFixed(3)}`).join(';');

function expectInvalidRequest(action: () => unknown, message?: RegExp): void {
  try {
    action();
    throw new Error('phải ném');
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).code).toBe('invalid_request');
    if (message) expect((error as ApiError).message).toMatch(message);
  }
}

describe('parseMatrixParams', () => {
  it('trần: 25 sources, 25 targets, 100 cặp', () => {
    expect([MATRIX_MAX_SOURCES, MATRIX_MAX_TARGETS, MATRIX_MAX_PAIRS]).toEqual([25, 25, 100]);
  });

  it('mặc định motorbike; giữ thứ tự điểm', () => {
    expect(parseMatrixParams(base)).toEqual({
      sources: [
        { lat: 10.7798, lng: 106.699 },
        { lat: 10.7725, lng: 106.698 },
      ],
      targets: [
        { lat: 10.7769, lng: 106.7032 },
        { lat: 10.7716, lng: 106.7043 },
      ],
      mode: 'motorbike',
    });
    expect(parseMatrixParams({ ...base, mode: 'car' }).mode).toBe('car');
  });

  it('thiếu sources/targets → 400 bắt buộc; mode lạ → 400', () => {
    expectInvalidRequest(() => parseMatrixParams({ targets: NHTP }), /sources bắt buộc/);
    expectInvalidRequest(() => parseMatrixParams({ sources: NTDB }), /targets bắt buộc/);
    expectInvalidRequest(() => parseMatrixParams({ ...base, mode: 'bike' }), /mode chỉ nhận/);
  });

  it('đếm trước parse: 26 phần tử hỏng → "tối đa 25 điểm"', () => {
    const many = Array.from({ length: 26 }, () => 'x').join(';');
    expectInvalidRequest(
      () => parseMatrixParams({ sources: many, targets: NHTP }),
      /sources tối đa 25 điểm/,
    );
    expectInvalidRequest(
      () => parseMatrixParams({ sources: NTDB, targets: many }),
      /targets tối đa 25 điểm/,
    );
  });

  it('25 × 25 hợp lệ từng bên nhưng 625 cặp → 400 nêu phép nhân; 25 × 4 = 100 qua', () => {
    expectInvalidRequest(
      () => parseMatrixParams({ sources: points(25), targets: points(25, 10.78) }),
      /tối đa 100 cặp .*25 × 25 = 625/,
    );
    const ok = parseMatrixParams({ sources: points(25), targets: points(4, 10.78) });
    expect(ok.sources).toHaveLength(25);
    expect(ok.targets).toHaveLength(4);
  });

  it('điểm ngoài hộp Việt Nam → 400 "Việt Nam"', () => {
    expectInvalidRequest(
      () => parseMatrixParams({ sources: NTDB, targets: '13.75,100.50' }),
      /Việt Nam/,
    );
  });

  it('chim bay: HCM → HN vượt 200 km xe máy, nêu đúng cặp; ô tô 400 km cũng vượt; đi bộ 50 km', () => {
    expectInvalidRequest(
      () => parseMatrixParams({ sources: `${NTDB};${BT}`, targets: `${NHTP};${HN}` }),
      /sources\[0\] → targets\[1\] cách 11\d\d km, ma trận motorbike tối đa 200 km/,
    );
    expectInvalidRequest(
      () => parseMatrixParams({ sources: NTDB, targets: HN, mode: 'car' }),
      /tối đa 400 km/,
    );
    // Vũng Tàu cách HCM ~95 km: xe máy qua, đi bộ không.
    expect(() => parseMatrixParams({ sources: NTDB, targets: '10.3460,107.0843' })).not.toThrow();
    expectInvalidRequest(
      () => parseMatrixParams({ sources: NTDB, targets: '10.3460,107.0843', mode: 'walk' }),
      /tối đa 50 km/,
    );
  });
});

describe('matrixBody', () => {
  it('sources/targets dạng lat/lon, costing theo mode, units kilometers, id; KHÔNG có directions_options', () => {
    const body = matrixBody(parseMatrixParams({ ...base, mode: 'car' }), 'req-1');
    expect(body).toEqual({
      sources: [
        { lat: 10.7798, lon: 106.699 },
        { lat: 10.7725, lon: 106.698 },
      ],
      targets: [
        { lat: 10.7769, lon: 106.7032 },
        { lat: 10.7716, lon: 106.7043 },
      ],
      costing: 'auto',
      units: 'kilometers',
      id: 'req-1',
    });
    expect(matrixBody(parseMatrixParams(base), 'r').costing).toBe('motor_scooter');
    expect(matrixBody(parseMatrixParams({ ...base, mode: 'walk' }), 'r').costing).toBe(
      'pedestrian',
    );
  });
});

describe('matrixCacheUrl', () => {
  it('làm tròn 4 chữ số, giữ thứ tự, có mode; khác mode → khác khoá', () => {
    const p = parseMatrixParams({ sources: '10.77981,106.69904', targets: '10.77251,106.69799' });
    expect(matrixCacheUrl(p)).toBe(
      'https://cache.mapslibvn/matrix?v=1&s=10.7798%2C106.6990&t=10.7725%2C106.6980&m=motorbike',
    );
    expect(matrixCacheUrl({ ...p, mode: 'car' })).not.toBe(matrixCacheUrl(p));
    // 11 m lệch cùng ô → cùng khoá (bài học cache directions 20/09/2026).
    const near = parseMatrixParams({
      sources: '10.77984,106.69901',
      targets: '10.77249,106.69802',
    });
    expect(matrixCacheUrl(near)).toBe(matrixCacheUrl(p));
  });
});

describe('translateMatrix', () => {
  const p = parseMatrixParams(base);
  const json = fixture as unknown as ValhallaMatrixResponse;

  it('đặt ô theo from_index/to_index (hàng 2 fixture bị đảo), giây làm tròn, km → m, null cả hai bảng', () => {
    const out = translateMatrix(json, p, '2026-09-15');
    expect(out).toEqual({
      mode: 'motorbike',
      sources: [
        [106.699, 10.7798],
        [106.698, 10.7725],
      ],
      targets: [
        [106.7032, 10.7769],
        [106.7043, 10.7716],
      ],
      durations_s: [
        [167, 255],
        [292, null],
      ],
      distances_m: [
        [878, 1351],
        [1504, null],
      ],
      attribution: '© OpenStreetMap contributors',
      engine: { name: 'valhalla', graph: '2026-09-15' },
    });
  });

  it('time âm hoặc không phải số → null; graph null giữ nguyên', () => {
    const odd = {
      ...json,
      sources_to_targets: [
        [
          { from_index: 0, to_index: 0, time: -1, distance: 0.5 },
          { from_index: 0, to_index: 1, time: 'x', distance: 1 },
        ],
        [
          { from_index: 1, to_index: 0, time: 10, distance: 0.1 },
          { from_index: 1, to_index: 1, time: 11, distance: 0.2 },
        ],
      ],
    } as unknown as ValhallaMatrixResponse;
    const out = translateMatrix(odd, p, null);
    expect(out.durations_s).toEqual([
      [null, null],
      [10, 11],
    ]);
    expect(out.engine).toEqual({ name: 'valhalla', graph: null });
  });

  it('thiếu ô, ô trùng, chỉ số ngoài bảng, không phải mảng → 503 upstream_unavailable', () => {
    const cases: unknown[] = [
      { ...json, sources_to_targets: [json.sources_to_targets[0]] },
      { ...json, sources_to_targets: [json.sources_to_targets[0], json.sources_to_targets[0]] },
      {
        ...json,
        sources_to_targets: [
          json.sources_to_targets[0],
          [
            { from_index: 1, to_index: 2, time: 1, distance: 1 },
            { from_index: 1, to_index: 0, time: 1, distance: 1 },
          ],
        ],
      },
      { ...json, sources_to_targets: 'nope' },
      {},
    ];
    for (const bad of cases) {
      try {
        translateMatrix(bad as ValhallaMatrixResponse, p, null);
        throw new Error('phải ném');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(503);
        expect((error as ApiError).code).toBe('upstream_unavailable');
      }
    }
  });
});

describe('fixture thật Quận 1 (q1-matrix.json, capture 22/09/2026)', () => {
  it('2×2 số dương, đối xứng gần: chiều đi và về cùng cặp lệch dưới 2 lần', () => {
    const out = translateMatrix(
      real as unknown as ValhallaMatrixResponse,
      parseMatrixParams(base),
      null,
    );
    for (const row of out.durations_s) for (const s of row) expect(s).toBeGreaterThan(0);
    const a = out.distances_m[0]?.[1] ?? 0;
    const b = out.distances_m[1]?.[0] ?? 0;
    expect(Math.max(a, b) / Math.min(a, b)).toBeLessThan(2);
  });
});
