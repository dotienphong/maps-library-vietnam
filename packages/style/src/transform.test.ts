import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { attributionHtml } from '@mapslibvn/core';
import { describe, expect, it } from 'vitest';
import { ALLOWED_FONTS, fillTemplate, mapFont, transformStyle } from './transform.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const sovereignty = JSON.parse(readFileSync(resolve(here, 'sovereignty.geojson'), 'utf8'));

const tinyBase = {
  version: 8,
  name: 'Tiny',
  sources: {
    openmaptiles: { type: 'vector', url: 'https://example.com/tiles.json' },
    relief: { type: 'raster', tiles: ['https://example.com/{z}/{x}/{y}.png'] },
  },
  glyphs: 'https://example.com/{fontstack}/{range}.pbf',
  sprite: 'https://example.com/sprite',
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#fff' } },
    { id: 'relief', type: 'raster', source: 'relief' },
    {
      id: 'place_city',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      layout: {
        'text-field': '{name:latin} {name:nonlatin}',
        'text-font': ['Roboto Medium'],
        'text-size': 12,
      },
    },
    {
      id: 'housenumber',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'housenumber',
      layout: {
        'text-field': '{housenumber}',
        'text-font': ['Roboto Condensed Italic'],
      },
    },
  ],
};

const filled = (template: unknown) =>
  JSON.parse(
    fillTemplate(JSON.stringify(template), {
      TILES_BASE: 'https://tiles.test',
      VN_FILE: 'vn-20260826',
    }),
  );

describe('mapFont', () => {
  it('ánh xạ mọi font về 3 stack Noto Sans', () => {
    expect(mapFont('Roboto Medium')).toBe('Noto Sans Bold');
    expect(mapFont('Metropolis Semi Bold')).toBe('Noto Sans Bold');
    expect(mapFont('Roboto Condensed Italic')).toBe('Noto Sans Italic');
    expect(mapFont('Roboto Regular')).toBe('Noto Sans Regular');
  });
});

describe('transformStyle (tiny base)', () => {
  const out = transformStyle(tinyBase, {
    theme: 'light',
    sovereignty,
    attribution: attributionHtml(),
  });

  it('chỉ còn nguồn openmaptiles (pmtiles template) và sovereignty', () => {
    expect(Object.keys(out.sources).sort()).toEqual(['openmaptiles', 'sovereignty']);
    expect(out.sources.openmaptiles.url).toBe('pmtiles://{TILES_BASE}/tiles/{VN_FILE}.pmtiles');
    expect(out.glyphs).toBe('{TILES_BASE}/assets/fonts/{fontstack}/{range}.pbf');
    expect(out.sprite).toBe('{TILES_BASE}/assets/sprites/osm-liberty');
  });

  it('nguồn openmaptiles mang trọn chuỗi ghi nguồn của core', () => {
    // Style là endpoint công khai: ai nạp thẳng vào maplibre thuần vẫn phải thấy đủ ghi nguồn.
    // Phải trùng KHÍT chuỗi SDK dùng thì MapLibre mới gộp làm một (spec 7.2).
    expect(out.sources.openmaptiles.attribution).toBe(attributionHtml());
  });

  it('bỏ layer raster; nhãn tên dùng coalesce name:vi; housenumber giữ nguyên', () => {
    const ids = out.layers.map((layer: { id: string }) => layer.id);
    expect(ids).not.toContain('relief');
    const city = out.layers.find((layer: { id: string }) => layer.id === 'place_city');
    expect(city.layout['text-field']).toEqual(['coalesce', ['get', 'name:vi'], ['get', 'name']]);
    const houseNumber = out.layers.find((layer: { id: string }) => layer.id === 'housenumber');
    expect(houseNumber.layout['text-field']).toBe('{housenumber}');
  });

  it('mọi text-font thuộc ALLOWED_FONTS', () => {
    for (const layer of out.layers) {
      const fonts = layer.layout?.['text-font'];
      if (fonts) for (const name of fonts) expect(ALLOWED_FONTS).toContain(name);
    }
  });

  it('có lớp chủ quyền minzoom 4, sort-key 0, cho phép overlap, đứng cuối', () => {
    const sovereignLayer = out.layers.at(-1);
    expect(sovereignLayer.id).toBe('sovereignty-label');
    expect(sovereignLayer.minzoom).toBe(4);
    expect(sovereignLayer.layout['symbol-sort-key']).toBe(0);
    expect(sovereignLayer.layout['text-allow-overlap']).toBe(true);
    expect(out.sources.sovereignty.data.features).toHaveLength(2);
  });

  it('template điền xong là style hợp lệ theo maplibre-gl-style-spec', () => {
    expect(validateStyleMin(filled(out))).toEqual([]);
  });
});

describe('transformStyle (base thật đã vendor)', () => {
  for (const [file, theme] of [
    ['base/osm-liberty.json', 'light'],
    ['base/dark-matter.json', 'dark'],
  ] as const) {
    it(`${file} → template hợp lệ, nhãn tiếng Việt, font Noto`, () => {
      const base = JSON.parse(readFileSync(resolve(here, file), 'utf8'));
      const out = transformStyle(base, { theme, sovereignty, attribution: attributionHtml() });
      expect(validateStyleMin(filled(out))).toEqual([]);
      for (const layer of out.layers) {
        if (layer.type !== 'symbol' || layer.source !== 'openmaptiles' || !layer.layout) continue;
        const textField = layer.layout['text-field'];
        if (textField && JSON.stringify(textField).includes('name')) {
          expect(textField).toEqual(['coalesce', ['get', 'name:vi'], ['get', 'name']]);
        }
        for (const name of layer.layout['text-font'] ?? []) {
          expect(ALLOWED_FONTS).toContain(name);
        }
      }
      expect(out.layers.at(-1).id).toBe('sovereignty-label');
    });
  }
});
