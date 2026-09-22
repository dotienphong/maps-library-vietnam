import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors';
import {
  OPTIMIZED_MAX_STOPS,
  optimizedBody,
  optimizedCacheUrl,
  parseOptimizedParams,
  translateOptimized,
} from '../src/routing/optimized';
import type { ValhallaRouteResponse } from '../src/routing/valhalla';
import fixture from './fixtures/valhalla/optimized-two-stops.json';

const NTDB = '10.7798,106.6990';
const BT = '10.7725,106.6980';
const NHTP = '10.7769,106.7032';
const BX = '10.7716,106.7043';
const HN = '21.0285,105.8542';
const base = { from: NTDB, stops: `${BX};${NHTP}`, to: BT };

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

describe('parseOptimizedParams', () => {
  it('trần 10 điểm dừng', () => {
    expect(OPTIMIZED_MAX_STOPS).toBe(10);
  });

  it('from, stops theo thứ tự gửi, to; mặc định motorbike/vi', () => {
    expect(parseOptimizedParams(base)).toEqual({
      from: { lat: 10.7798, lng: 106.699 },
      stops: [
        { lat: 10.7716, lng: 106.7043 },
        { lat: 10.7769, lng: 106.7032 },
      ],
      to: { lat: 10.7725, lng: 106.698 },
      roundTrip: false,
      mode: 'motorbike',
      lang: 'vi',
    });
  });

  it('bỏ to (hoặc to rỗng) → to = from, roundTrip true', () => {
    const p = parseOptimizedParams({ from: NTDB, stops: BX });
    expect(p.to).toEqual(p.from);
    expect(p.roundTrip).toBe(true);
    expect(parseOptimizedParams({ from: NTDB, stops: BX, to: '  ' }).roundTrip).toBe(true);
  });

  it('một stop vẫn hợp lệ; thiếu from/stops, mode/lang lạ → 400', () => {
    expect(parseOptimizedParams({ from: NTDB, stops: BX }).stops).toHaveLength(1);
    expectInvalidRequest(() => parseOptimizedParams({ stops: BX }), /from bắt buộc/);
    expectInvalidRequest(() => parseOptimizedParams({ from: NTDB }), /stops bắt buộc/);
    expectInvalidRequest(() => parseOptimizedParams({ ...base, mode: 'bike' }), /mode chỉ nhận/);
    expectInvalidRequest(() => parseOptimizedParams({ ...base, lang: 'fr' }), /lang chỉ nhận/);
  });

  it('đếm stops trước parse: 11 phần tử hỏng → "stops tối đa 10 điểm"', () => {
    const many = Array.from({ length: 11 }, () => 'x').join(';');
    expectInvalidRequest(
      () => parseOptimizedParams({ from: NTDB, stops: many }),
      /stops tối đa 10 điểm/,
    );
  });

  it('ngoài hộp VN → 400 "Việt Nam"; chim bay tính từ from tới từng stop và tới to', () => {
    expectInvalidRequest(
      () => parseOptimizedParams({ from: NTDB, stops: '13.75,100.50' }),
      /Việt Nam/,
    );
    expectInvalidRequest(
      () => parseOptimizedParams({ from: NTDB, stops: `${BX};${HN}` }),
      /stops\[1\] cách from 11\d\d km, tối ưu thứ tự motorbike tối đa 200 km/,
    );
    expectInvalidRequest(
      () => parseOptimizedParams({ from: NTDB, stops: BX, to: HN, mode: 'car' }),
      /to cách from .* tối đa 400 km/,
    );
    expectInvalidRequest(
      () => parseOptimizedParams({ from: NTDB, stops: '10.3460,107.0843', mode: 'walk' }),
      /tối đa 50 km/,
    );
  });
});

describe('optimizedBody', () => {
  it('locations = from, stops theo thứ tự gửi, to; type break; costing và locale theo mode/lang', () => {
    expect(
      optimizedBody(parseOptimizedParams({ ...base, mode: 'car', lang: 'en' }), 'req-1'),
    ).toEqual({
      locations: [
        { lat: 10.7798, lon: 106.699, type: 'break' },
        { lat: 10.7716, lon: 106.7043, type: 'break' },
        { lat: 10.7769, lon: 106.7032, type: 'break' },
        { lat: 10.7725, lon: 106.698, type: 'break' },
      ],
      costing: 'auto',
      directions_options: { language: 'en-US', units: 'kilometers' },
      id: 'req-1',
    });
  });

  it('round trip: điểm cuối là from lần nữa', () => {
    const body = optimizedBody(parseOptimizedParams({ from: NTDB, stops: BX }), 'r');
    expect(body.locations).toHaveLength(3);
    expect(body.locations[2]).toEqual({ lat: 10.7798, lon: 106.699, type: 'break' });
    expect(body.costing).toBe('motor_scooter');
    expect(body.directions_options.language).toBe('vi-VN');
  });
});

describe('optimizedCacheUrl', () => {
  it('làm tròn 4 chữ số; round trip và to=from cho CÙNG khoá; lang/mode đổi → khác khoá', () => {
    const p = parseOptimizedParams({ from: '10.77981,106.69904', stops: BX });
    expect(optimizedCacheUrl(p)).toBe(
      'https://cache.mapslibvn/optimized-route?v=1&f=10.7798%2C106.6990&s=10.7716%2C106.7043&t=10.7798%2C106.6990&m=motorbike&l=vi',
    );
    const explicit = parseOptimizedParams({
      from: '10.77981,106.69904',
      stops: BX,
      to: '10.77981,106.69904',
    });
    expect(optimizedCacheUrl(explicit)).toBe(optimizedCacheUrl(p));
    expect(optimizedCacheUrl({ ...p, lang: 'en' })).not.toBe(optimizedCacheUrl(p));
  });
});

describe('translateOptimized', () => {
  const p = parseOptimizedParams(base); // stops gửi: [BX, NHTP]; Valhalla đi NHTP trước → order [1, 0]
  const json = fixture as unknown as ValhallaRouteResponse;

  it('order từ original_index − 1; legs = stops + 1; waypoints theo thứ tự đi; phần tuyến giống translateDirections', () => {
    const out = translateOptimized(json, p, '2026-09-15');
    expect(out.order).toEqual([1, 0]);
    expect(out.routes).toHaveLength(1);
    expect(out.routes[0]?.legs).toHaveLength(3);
    expect(out.routes[0]?.mode).toBe('motorbike');
    expect(out.waypoints.map((w) => w.location)).toEqual([
      [106.699, 10.7798],
      [106.7032, 10.7769],
      [106.7043, 10.7716],
      [106.698, 10.7725],
    ]);
    expect(out.engine).toEqual({ name: 'valhalla', graph: '2026-09-15' });
    // Câu tiếng Việt đã qua bảng cụm từ như directions (fixture two-legs có "Đi về hướng nam…").
    expect(out.routes[0]?.legs[0]?.steps[0]?.instruction).toMatch(/^Đi về hướng/);
  });

  it('một stop, round trip: order [0], 2 leg', () => {
    const single = parseOptimizedParams({ from: NTDB, stops: BX });
    const two = {
      ...json,
      trip: {
        ...json.trip,
        locations: [
          { lat: 10.7798, lon: 106.699, original_index: 0 },
          { lat: 10.7716, lon: 106.7043, original_index: 1 },
          { lat: 10.7798, lon: 106.699, original_index: 2 },
        ],
        legs: [json.trip.legs[0], json.trip.legs[1]],
      },
    } as unknown as ValhallaRouteResponse;
    const out = translateOptimized(two, single, null);
    expect(out.order).toEqual([0]);
    expect(out.routes[0]?.legs).toHaveLength(2);
  });

  it('thiếu original_index, đầu/cuối đổi chỗ, không phải hoán vị, số leg lệch → 503', () => {
    const withLocations = (locations: unknown[], legs = json.trip.legs) =>
      ({ ...json, trip: { ...json.trip, locations, legs } }) as unknown as ValhallaRouteResponse;
    const L = (original_index: number | undefined) => ({ lat: 10.77, lon: 106.7, original_index });
    const cases = [
      withLocations([L(0), L(undefined), L(1), L(3)]),
      withLocations([L(1), L(2), L(0), L(3)]),
      withLocations([L(0), L(1), L(1), L(3)]),
      withLocations([L(0), L(2), L(1), L(3)], [json.trip.legs[0]] as typeof json.trip.legs),
      withLocations([L(0), L(1), L(3)]),
    ];
    for (const bad of cases) {
      try {
        translateOptimized(bad, p, null);
        throw new Error('phải ném');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(503);
        expect((error as ApiError).code).toBe('upstream_unavailable');
      }
    }
  });
});
