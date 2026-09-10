import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors';
import {
  MAX_CROW_DISTANCE_M,
  directionsCacheUrl,
  haversineM,
  parseDirectionsParams,
} from '../src/routing/params';

const HCM = { lat: 10.7769, lng: 106.7009 };
const HN = { lat: 21.0285, lng: 105.8542 };
const base = { from: '10.7798,106.6990', to: '10.7725,106.6980' };

describe('routing params', () => {
  it('haversine HCM→HN ≈ 1.137 km', () => {
    const d = haversineM(HCM, HN);
    expect(d).toBeGreaterThan(1_100_000);
    expect(d).toBeLessThan(1_180_000);
    expect(haversineM(HCM, HCM)).toBe(0);
  });

  it('mặc định motorbike/vi/không alternatives; from trước, to sau', () => {
    expect(parseDirectionsParams(base)).toEqual({
      locations: [
        { lat: 10.7798, lng: 106.699 },
        { lat: 10.7725, lng: 106.698 },
      ],
      mode: 'motorbike',
      lang: 'vi',
      alternatives: false,
    });
  });

  it('via xen giữa theo thứ tự; tối đa 5 điểm', () => {
    const p = parseDirectionsParams({ ...base, via: '10.776,106.698;10.775,106.699' });
    expect(p.locations.map((l) => l.lat)).toEqual([10.7798, 10.776, 10.775, 10.7725]);
    const six = Array.from({ length: 6 }, (_, i) => `10.77${i},106.69`).join(';');
    expect(() => parseDirectionsParams({ ...base, via: six })).toThrowError(ApiError);
  });

  it('thiếu from/to, mode/lang/alternatives lạ → 400 invalid_request', () => {
    const bad = [
      { to: base.to },
      { from: base.from },
      { ...base, mode: 'bike' },
      { ...base, lang: 'fr' },
      { ...base, alternatives: '2' },
      { ...base, via: '10.77' },
    ];
    for (const q of bad) {
      try {
        parseDirectionsParams(q);
        throw new Error('phải ném');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(400);
        expect((error as ApiError).code).toBe('invalid_request');
      }
    }
  });

  it('điểm ngoài hộp Việt Nam → 400 có chữ "Việt Nam"', () => {
    expect(() => parseDirectionsParams({ from: base.from, to: '13.75,100.50' })).toThrowError(
      /Việt Nam/,
    );
  });

  it('vượt giới hạn đường chim bay theo mode → 400 nêu giới hạn', () => {
    const canTho = '10.0341,105.7841';
    expect(() => parseDirectionsParams({ from: base.from, to: canTho, mode: 'walk' })).toThrowError(
      /50 km/,
    );
    expect(parseDirectionsParams({ from: base.from, to: canTho, mode: 'car' }).mode).toBe('car');
    expect(MAX_CROW_DISTANCE_M).toEqual({ motorbike: 500_000, car: 2_000_000, walk: 50_000 });
  });

  it('alternatives=1 chỉ giữ khi không có via (Valhalla không hỗ trợ multipoint)', () => {
    expect(parseDirectionsParams({ ...base, alternatives: '1' }).alternatives).toBe(true);
    expect(
      parseDirectionsParams({ ...base, alternatives: '1', via: '10.776,106.698' }).alternatives,
    ).toBe(false);
  });

  it('khoá cache làm tròn 5 chữ số và gồm mode/lang/alternatives', () => {
    const p = parseDirectionsParams({ from: '10.77981234,106.69901', to: base.to, mode: 'car' });
    expect(directionsCacheUrl(p)).toBe(
      'https://cache.mapslibvn/directions?v=1&p=10.77981%2C106.69901%3B10.77250%2C106.69800&m=car&l=vi&a=0',
    );
  });
});
