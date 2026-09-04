import { describe, expect, it } from 'vitest';
import { displayFields } from '../src/display-priority.mjs';
import { featureLine } from '../src/export-tiles.mjs';

describe('featureLine', () => {
  it('ghi q/r/d và tippecanoe.minzoom, không lộ popularity', () => {
    const row = {
      id: '01ARZ',
      name: 'Bảo tàng',
      cat: 'museum',
      grp: 'culture_tourism',
      quality_score: 87,
      popularity: 2.5,
      rank: 1,
      lon: 106.7,
      lat: 10.77,
    };
    const display = displayFields({
      id: row.id,
      rank: row.rank,
      popularity: row.popularity,
      qualityScore: row.quality_score,
    });
    const feature = JSON.parse(featureLine(row, display, 10));

    expect(feature.tippecanoe).toEqual({ minzoom: 10 });
    expect(feature.properties).toEqual({
      id: row.id,
      name: row.name,
      cat: row.cat,
      grp: row.grp,
      q: 8,
      r: 1,
      d: display.d,
    });
    expect(feature.properties.popularity).toBeUndefined();
    expect(feature.geometry).toEqual({ type: 'Point', coordinates: [106.7, 10.77] });
  });
});
