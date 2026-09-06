import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors';
import { clampInt, parseBbox, parseLatLngPair, parseTypes } from '../src/params';

describe('params', () => {
  it('parseLatLngPair: "10.77,106.70" → {lat,lng}; undefined → null', () => {
    expect(parseLatLngPair('10.77,106.70', 'near')).toEqual({ lat: 10.77, lng: 106.7 });
    expect(parseLatLngPair(undefined, 'near')).toBeNull();
  });

  it('parseLatLngPair: sai định dạng hoặc ngoài biên → ApiError 400', () => {
    for (const bad of ['xx', '10.77', '91,106', '10,181', '10.77;106.70']) {
      expect(() => parseLatLngPair(bad, 'near')).toThrowError(ApiError);
    }
  });

  it('clampInt: mặc định, chặn trên, 400 khi không phải số', () => {
    expect(clampInt(undefined, 1, 10, 7, 'limit')).toBe(7);
    expect(clampInt('99', 1, 10, 7, 'limit')).toBe(10);
    expect(clampInt('3', 1, 10, 7, 'limit')).toBe(3);
    expect(() => clampInt('abc', 1, 10, 7, 'limit')).toThrowError(ApiError);
  });

  it('parseTypes: mặc định có area, nhận area và lọc giá trị lạ → 400', () => {
    expect([...parseTypes(undefined)].sort()).toEqual(['address', 'area', 'poi', 'street']);
    expect([...parseTypes('area')]).toEqual(['area']);
    expect([...parseTypes('poi,street')].sort()).toEqual(['poi', 'street']);
    expect(() => parseTypes('poi,banana')).toThrowError(ApiError);
  });

  it('parseBbox: nhận bbox hợp lệ, từ chối biên/toạ độ/thứ tự sai', () => {
    expect(parseBbox('106.6,10.7,106.8,10.9')).toEqual([106.6, 10.7, 106.8, 10.9]);
    for (const bad of ['106,10,105,11', '106,11,107,10', '181,10,182,11', '106,-91,107,10']) {
      expect(() => parseBbox(bad)).toThrowError(ApiError);
    }
  });
});
