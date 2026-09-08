import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEY,
  PRECISION_ZOOM,
  buildSnippet,
  circleGeoJson,
  maskKey,
  parseState,
  radiusForPrecision,
  toSearchParams,
} from '../public/playground-lib.js';

const API = 'http://localhost:8787';

describe('parseState', () => {
  it('trả mặc định khi không có tham số', () => {
    expect(parseState('', API)).toEqual({
      key: DEFAULT_KEY,
      api: API,
      style: 'light',
      lang: 'vi',
      poi: true,
      sources: 'all',
      compact: false,
      center: [106.7, 10.776],
      zoom: 14,
      embed: false,
    });
  });

  it('đọc key, api, style, lang', () => {
    const state = parseState('?key=mlv_live_abc&api=https://a.vn&style=dark&lang=en', API);
    expect(state.key).toBe('mlv_live_abc');
    expect(state.api).toBe('https://a.vn');
    expect(state.style).toBe('dark');
    expect(state.lang).toBe('en');
  });

  it('nhận cả URLSearchParams làm đầu vào', () => {
    const state = parseState(new URLSearchParams({ style: 'dark' }), API);
    expect(state.style).toBe('dark');
  });

  it('bỏ qua style và lang không hợp lệ', () => {
    const state = parseState('?style=neon&lang=fr', API);
    expect(state.style).toBe('light');
    expect(state.lang).toBe('vi');
  });

  it('đọc poi=0, compact=1, embed=1', () => {
    const state = parseState('?poi=0&compact=1&embed=1', API);
    expect(state.poi).toBe(false);
    expect(state.compact).toBe(true);
    expect(state.embed).toBe(true);
  });

  it('đọc sources=osm và bỏ qua profile không hợp lệ', () => {
    expect(parseState('?sources=osm', API).sources).toBe('osm');
    expect(parseState('?sources=osm,overture', API).sources).toBe('all');
  });

  it.each([
    ['?sources=overture,fsq', 'overture-fsq', "poiSources: ['overture', 'fsq']"],
    ['?sources=overture', 'overture', "poiSources: ['overture']"],
    ['?sources=fsq', 'fsq', "poiSources: ['fsq']"],
  ])('đọc, serialize và sinh snippet cho %s', (search, profile, snippet) => {
    const state = parseState(search, API);
    expect(state.sources).toBe(profile);
    expect(toSearchParams(state, API).get('sources')).toBe(
      profile === 'overture-fsq' ? 'overture,fsq' : profile,
    );
    expect(buildSnippet(state, 'script')).toContain(snippet);
  });

  it('đọc c=lng,lat,zoom', () => {
    const state = parseState('?c=105.85,21.028,11.5', API);
    expect(state.center).toEqual([105.85, 21.028]);
    expect(state.zoom).toBe(11.5);
  });

  it('bỏ qua c sai định dạng hoặc ngoài khoảng', () => {
    expect(parseState('?c=abc', API).center).toEqual([106.7, 10.776]);
    expect(parseState('?c=200,99,11', API).center).toEqual([106.7, 10.776]);
    expect(parseState('?c=105.85,21.028,99', API).zoom).toBe(14);
  });
});

describe('toSearchParams', () => {
  it('không in tuỳ chọn còn mặc định', () => {
    expect(toSearchParams(parseState('', API), API).toString()).toBe('');
  });

  it('in tuỳ chọn đã đổi', () => {
    const state = parseState('', API);
    const params = toSearchParams(
      { ...state, style: 'dark', lang: 'en', poi: false, compact: true },
      API,
    );
    expect(params.get('style')).toBe('dark');
    expect(params.get('lang')).toBe('en');
    expect(params.get('poi')).toBe('0');
    expect(params.get('compact')).toBe('1');
  });

  it('in sources chỉ khi chọn OSM', () => {
    const base = parseState('', API);
    expect(toSearchParams(base, API).has('sources')).toBe(false);
    expect(toSearchParams({ ...base, sources: 'osm' }, API).get('sources')).toBe('osm');
  });

  it('in c khi tâm hoặc zoom đổi, và giữ embed', () => {
    const state = { ...parseState('', API), center: [105.85, 21.028], zoom: 11.5, embed: true };
    const params = toSearchParams(state, API);
    expect(params.get('c')).toBe('105.85,21.028,11.5');
    expect(params.get('embed')).toBe('1');
  });

  it('in key và api chỉ khi khác mặc định', () => {
    const base = parseState('', API);
    expect(toSearchParams(base, API).has('key')).toBe(false);
    expect(toSearchParams(base, API).has('api')).toBe(false);
    const params = toSearchParams({ ...base, key: 'mlv_live_abc', api: 'https://a.vn' }, API);
    expect(params.get('key')).toBe('mlv_live_abc');
    expect(params.get('api')).toBe('https://a.vn');
  });

  it('đi vòng tròn được với parseState', () => {
    const original = {
      ...parseState('', API),
      key: 'mlv_live_abc',
      api: 'https://a.vn',
      style: 'dark',
      lang: 'en',
      poi: false,
      compact: true,
      center: [105.85, 21.028],
      zoom: 11.5,
    };
    expect(parseState(toSearchParams(original, API).toString(), API)).toEqual(original);
  });
});

describe('buildSnippet', () => {
  const base = parseState('', API);

  it('bản script dùng global MapsLibVN và UMD của docs', () => {
    const code = buildSnippet(base, 'script');
    expect(code).toContain('MapsLibVN.createMap');
    expect(code).toContain('/sdk/mapslibvn.umd.js');
    expect(code).toContain('/sdk/mapslibvn.css');
    expect(code).toContain("container: 'map'");
    expect(code).toContain(`apiKey: '${DEFAULT_KEY}'`);
    expect(code).toContain(`apiBase: '${API}'`);
    expect(code).toContain('center: [106.7, 10.776]');
    expect(code).toContain('zoom: 14');
  });

  it('chỉ in tuỳ chọn khác mặc định của SDK', () => {
    const code = buildSnippet(base, 'script');
    expect(code).not.toContain('style:');
    expect(code).not.toContain('lang:');
    expect(code).not.toContain('poiLayer:');
    expect(code).not.toContain('compactAttribution:');
  });

  it('in style, lang, poiLayer, compactAttribution khi đã đổi', () => {
    const code = buildSnippet(
      { ...base, style: 'dark', lang: 'en', poi: false, compact: true },
      'script',
    );
    expect(code).toContain("style: 'dark'");
    expect(code).toContain("lang: 'en'");
    expect(code).toContain('poiLayer: false');
    expect(code).toContain('compactAttribution: true');
  });

  it('in poiSources khi chọn profile OSM', () => {
    const code = buildSnippet({ ...base, sources: 'osm' }, 'script');
    expect(code).toContain("poiSources: ['osm']");
  });

  it('bản esm import @mapslibvn/web và truyền maplibre', () => {
    const code = buildSnippet(base, 'esm');
    expect(code).toContain("from '@mapslibvn/web'");
    expect(code).toContain("import maplibregl from 'maplibre-gl'");
    expect(code).toContain('{ maplibre: maplibregl }');
    expect(code).not.toContain('MapsLibVN.createMap');
  });

  it('ném lỗi với kind lạ', () => {
    expect(() => buildSnippet(base, 'python')).toThrow();
  });
});

describe('maskKey', () => {
  it('giữ 13 ký tự đầu và 4 ký tự cuối', () => {
    expect(maskKey(DEFAULT_KEY)).toBe('mlv_live_demo…0000');
  });

  it('giữ nguyên khoá quá ngắn', () => {
    expect(maskKey('mlv_live_abc')).toBe('mlv_live_abc');
    expect(maskKey('')).toBe('');
  });
});

describe('circleGeoJson', () => {
  it('trả Feature Polygon 64 đỉnh, khép kín', () => {
    const feature = circleGeoJson(106.7, 10.776, 40);
    expect(feature.type).toBe('Feature');
    expect(feature.geometry.type).toBe('Polygon');
    const ring = feature.geometry.coordinates[0];
    expect(ring).toHaveLength(65);
    expect(ring[64]).toEqual(ring[0]);
  });

  it('bán kính đúng xấp xỉ theo mét', () => {
    const radiusM = 80;
    const lat = 10.776;
    const ring = circleGeoJson(106.7, lat, radiusM).geometry.coordinates[0];
    for (const [lng, pointLat] of ring) {
      const dy = (pointLat - lat) * 111320;
      const dx = (lng - 106.7) * 111320 * Math.cos((lat * Math.PI) / 180);
      expect(Math.hypot(dx, dy)).toBeCloseTo(radiusM, 1);
    }
  });
});

describe('radiusForPrecision', () => {
  it('rooftop không vẽ vòng', () => {
    expect(radiusForPrecision('rooftop')).toBe(0);
  });

  it('alley 40 m, interpolated 80 m', () => {
    expect(radiusForPrecision('alley')).toBe(40);
    expect(radiusForPrecision('interpolated')).toBe(80);
  });

  it('street, ward, province không vẽ vòng mà có zoom riêng', () => {
    for (const precision of ['street', 'ward', 'province']) {
      expect(radiusForPrecision(precision)).toBe(0);
    }
    expect(PRECISION_ZOOM.street).toBe(15);
    expect(PRECISION_ZOOM.ward).toBe(13);
    expect(PRECISION_ZOOM.province).toBe(10);
  });

  it('mức lạ cũng không vẽ vòng', () => {
    expect(radiusForPrecision(undefined)).toBe(0);
  });
});
