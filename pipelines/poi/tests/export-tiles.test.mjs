import { describe, expect, it } from 'vitest';
import { LOW_ZOOM_GROUPS, featureLine, tippecanoeFilter } from '../src/export-tiles.mjs';

describe('featureLine', () => {
  it('thuộc tính tối thiểu id/name/cat/grp/q (bucket 0–9), toạ độ [lon, lat]', () => {
    const f = JSON.parse(
      featureLine({
        id: '01ARZ',
        name: 'Cà phê Cộng',
        cat: 'cafe',
        grp: 'food_drink',
        quality_score: 67,
        lon: 106.7,
        lat: 10.77,
      }),
    );
    expect(f).toEqual({
      type: 'Feature',
      properties: { id: '01ARZ', name: 'Cà phê Cộng', cat: 'cafe', grp: 'food_drink', q: 6 },
      geometry: { type: 'Point', coordinates: [106.7, 10.77] },
    });
    expect(
      JSON.parse(
        featureLine({
          id: 'x',
          name: 'y',
          cat: 'other',
          grp: 'other',
          quality_score: 100,
          lon: 0,
          lat: 0,
        }),
      ).properties.q,
    ).toBe(9);
    expect(
      JSON.parse(
        featureLine({
          id: 'x',
          name: 'y',
          cat: 'other',
          grp: 'other',
          quality_score: null,
          lon: 0,
          lat: 0,
        }),
      ).properties.q,
    ).toBe(0);
  });
});

describe('tippecanoeFilter (spec 5.8)', () => {
  it('z15–16 tất cả; z12–14 q ≥ 6; z10–11 chỉ 5 nhóm công cộng q ≥ 7', () => {
    const f = tippecanoeFilter().poi;
    expect(f[0]).toBe('any');
    expect(f[1]).toEqual(['>=', '$zoom', 15]);
    expect(f[2]).toEqual(['all', ['>=', '$zoom', 12], ['<=', '$zoom', 14], ['>=', 'q', 6]]);
    expect(f[3]).toEqual([
      'all',
      ['<=', '$zoom', 11],
      ['>=', 'q', 7],
      ['in', 'grp', ...LOW_ZOOM_GROUPS],
    ]);
    expect(LOW_ZOOM_GROUPS).toEqual([
      'education',
      'health',
      'transport',
      'public_admin',
      'culture_tourism',
    ]);
  });
});
