import type { Feature } from 'geojson';
import { describe, expect, it } from 'vitest';
import { toPoiFeature } from './to-poi-feature';

const point: Feature = {
  type: 'Feature',
  properties: { id: 'p1', name: 'Cafe Cây Bồ Đề', cat: 'cafe', grp: 'food_drink' },
  geometry: { type: 'Point', coordinates: [106.6631, 10.7652] },
};

describe('toPoiFeature', () => {
  it('ánh xạ id/name/cat/grp và toạ độ giống SDK web', () => {
    expect(toPoiFeature(point)).toEqual({
      id: 'p1',
      name: 'Cafe Cây Bồ Đề',
      category: 'cafe',
      group: 'food_drink',
      lngLat: [106.6631, 10.7652],
    });
  });

  it('thiếu properties → chuỗi rỗng, lấy feature.id làm id', () => {
    const f: Feature = { ...point, id: 42, properties: null };
    expect(toPoiFeature(f)).toEqual({
      id: '42',
      name: '',
      category: '',
      group: '',
      lngLat: [106.6631, 10.7652],
    });
  });

  it('không phải Point hoặc undefined → null', () => {
    const line: Feature = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
    };
    expect(toPoiFeature(line)).toBeNull();
    expect(toPoiFeature(undefined)).toBeNull();
  });
});
