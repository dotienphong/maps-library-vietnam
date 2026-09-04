import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { attributionHtml } from '@mapslibvn/core';
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
  const attribution = attributionHtml();
  const out = addPoiLayers(transformStyle(base, { theme: 'light', sovereignty, attribution }), {
    theme: 'light',
    attribution,
  });
  const poi = out.layers.find((l: { id: string }) => l.id === 'poi');
  const major = out.layers.find((l: { id: string }) => l.id === 'poi-label-major');
  const local = out.layers.find((l: { id: string }) => l.id === 'poi-label-local');
  const poiLayers = out.layers.filter((l: { source?: string }) => l.source === 'poi');

  it('thêm nguồn POI và ba lớp symbol liền nhau trước lớp chủ quyền', () => {
    expect(out.sources.poi.url).toBe('pmtiles://{TILES_BASE}/tiles/{POI_FILE}.pmtiles');
    expect(poiLayers.map((layer: { id: string }) => layer.id)).toEqual([
      'poi',
      'poi-label-major',
      'poi-label-local',
    ]);
    expect(poiLayers.every((layer: { type: string }) => layer.type === 'symbol')).toBe(true);
    expect(
      poiLayers.every((layer: { 'source-layer': string }) => layer['source-layer'] === 'poi'),
    ).toBe(true);
    expect(poi.minzoom).toBe(10);
    const sovereigntyIndex = out.layers.findIndex(
      (layer: { id: string }) => layer.id === 'sovereignty-label',
    );
    expect(out.layers.slice(sovereigntyIndex - 3, sovereigntyIndex)).toEqual(poiLayers);
  });

  it('nguồn poi mang trọn chuỗi ghi nguồn của core, trùng khít source openmaptiles', () => {
    // Ba nơi cùng một chuỗi (openmaptiles, poi, customAttribution của SDK) thì MapLibre gộp làm
    // một; lệch một ký tự là ghi nguồn hiện hai lần (spec 7.2).
    expect(out.sources.poi.attribution).toBe(attributionHtml());
    expect(out.sources.poi.attribution).toBe(out.sources.openmaptiles.attribution);
  });

  it('bỏ các lớp POI của base (source-layer poi từ openmaptiles) để không trùng icon', () => {
    expect(
      out.layers.some(
        (l: { source?: string; 'source-layer'?: string }) =>
          l.source === 'openmaptiles' && l['source-layer'] === 'poi',
      ),
    ).toBe(false);
  });

  it('icon theo 12 nhóm + other, không ghép text và ưu tiên d với fallback q', () => {
    expect(Object.keys(POI_GROUP_ICONS)).toHaveLength(13);
    for (const icon of Object.values(POI_GROUP_ICONS)) {
      expect(sprite[icon], `sprite thiếu ${icon}`).toBeDefined();
    }
    expect(poi.layout['icon-padding']).toBe(8);
    expect(poi.layout['text-field']).toBeUndefined();
    expect(poi.layout['symbol-sort-key']).toEqual([
      'coalesce',
      ['get', 'd'],
      ['-', 9, ['coalesce', ['get', 'q'], 0]],
    ]);
  });

  it('nhãn major/local phân tầng theo rank, có fallback cho tile cũ', () => {
    expect(major.minzoom).toBe(12);
    expect(major.filter).toEqual(['<=', ['coalesce', ['get', 'r'], 5], 2]);
    expect(major.layout['text-padding']).toBe(4);
    expect(major.layout['text-font']).toEqual(['Noto Sans Regular']);
    expect(local.minzoom).toBe(16);
    expect(local.filter).toEqual(['>=', ['coalesce', ['get', 'r'], 5], 3]);
    expect(local.layout['text-padding']).toBe(4);
    expect(local.layout['text-font']).toEqual(['Noto Sans Regular']);
    expect(major.layout['symbol-sort-key']).toEqual(poi.layout['symbol-sort-key']);
    expect(local.layout['symbol-sort-key']).toEqual(poi.layout['symbol-sort-key']);
  });

  it('template điền xong hợp lệ theo style-spec', () => {
    expect(validateStyleMin(filled(out))).toEqual([]);
  });
});
