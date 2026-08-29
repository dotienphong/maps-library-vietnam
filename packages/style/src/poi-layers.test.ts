import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { POI_GROUP_ICONS, addPoiLayers } from './poi-layers.mjs';
import { fillTemplate, transformStyle } from './transform.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const sovereignty = JSON.parse(readFileSync(resolve(here, 'sovereignty.geojson'), 'utf8'));
const sprite = JSON.parse(
  readFileSync(resolve(here, '../assets/sprites/osm-liberty.json'), 'utf8'),
);
const base = JSON.parse(readFileSync(resolve(here, 'base/osm-liberty.json'), 'utf8'));
const filled = (tpl: unknown) =>
  JSON.parse(
    fillTemplate(JSON.stringify(tpl), {
      TILES_BASE: 'https://tiles.test',
      VN_FILE: 'vn-20260826',
      POI_FILE: 'poi-20260901',
    }),
  );

describe('addPoiLayers', () => {
  const out = addPoiLayers(transformStyle(base, { theme: 'light', sovereignty }), {
    theme: 'light',
  });
  const poi = out.layers.find((l: { id: string }) => l.id === 'poi');

  it('thêm nguồn poi (template POI_FILE) và lớp symbol poi minzoom 10 trước lớp chủ quyền', () => {
    expect(out.sources.poi.url).toBe('pmtiles://{TILES_BASE}/tiles/{POI_FILE}.pmtiles');
    expect(poi).toBeDefined();
    expect(poi.type).toBe('symbol');
    expect(poi['source-layer']).toBe('poi');
    expect(poi.minzoom).toBe(10);
    expect(out.layers.at(-1).id).toBe('sovereignty-label');
    expect(out.layers.indexOf(poi)).toBe(out.layers.length - 2);
  });

  it('bỏ các lớp POI của base (source-layer poi từ openmaptiles) để không trùng icon', () => {
    expect(
      out.layers.some(
        (l: { source?: string; 'source-layer'?: string }) =>
          l.source === 'openmaptiles' && l['source-layer'] === 'poi',
      ),
    ).toBe(false);
  });

  it('icon theo 12 nhóm + other, mọi icon có trong sprite osm-liberty; nhãn dùng font Noto; sắp theo q', () => {
    expect(Object.keys(POI_GROUP_ICONS)).toHaveLength(13);
    for (const icon of Object.values(POI_GROUP_ICONS)) {
      expect(sprite[icon], `sprite thiếu ${icon}`).toBeDefined();
    }
    expect(poi.layout['text-font']).toEqual(['Noto Sans Regular']);
    expect(poi.layout['symbol-sort-key']).toEqual(['-', 9, ['get', 'q']]);
  });

  it('template điền xong hợp lệ theo style-spec', () => {
    expect(validateStyleMin(filled(out))).toEqual([]);
  });
});
