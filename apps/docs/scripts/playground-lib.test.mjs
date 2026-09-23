import { describe, expect, it } from 'vitest';
import {
  buildSnippet,
  circleGeoJson,
  DEFAULT_KEY,
  directionsRequest,
  etaLabel,
  FLEET_SAMPLE,
  fleetSnippet,
  MATRIX_MAX_PAIRS,
  maskKey,
  matrixPlan,
  navSnippet,
  OPTIMIZED_MAX_STOPS,
  optimizedPlan,
  PRECISION_ZOOM,
  parseState,
  pointFromAutocomplete,
  pointFromLngLat,
  pointFromPoi,
  radiusForPrecision,
  routeSummary,
  shortDistance,
  shortDuration,
  toSearchParams,
  visitLegs,
} from '../public/playground-lib.js';

const API = 'http://localhost:8787';
/** Khoá mẫu để kiểm ĐỊNH DẠNG chuỗi trong mã sinh ra. Khoá demo thật được chèn lúc build nên ở
 *  đây `DEFAULT_KEY` rỗng — xem describe('DEFAULT_KEY') bên dưới. */
const KHOA_MAU = 'mlv_live_demo00000000000000000000';

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
      tab: null,
      tmode: 'motorbike',
      from: null,
      to: null,
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

  it('đọc sources=osm và đưa profile lạ (ví dụ overture đã gỡ) về mặc định all', () => {
    expect(parseState('?sources=osm', API).sources).toBe('osm');
    expect(parseState('?sources=overture', API).sources).toBe('all');
    expect(parseState('?sources=osm,overture', API).sources).toBe('all');
  });

  it('đọc sources=all khi chọn rõ tất cả nguồn, kể cả dạng liệt kê osm,fsq', () => {
    expect(parseState('?sources=all', API).sources).toBe('all');
    expect(parseState('?sources=osm,fsq', API).sources).toBe('all');
  });

  it.each([
    ['?sources=osm', 'osm', 'osm', "poiSources: ['osm']"],
    ['?sources=fsq', 'fsq', 'fsq', "poiSources: ['fsq']"],
  ])('đọc, serialize và sinh snippet cho %s', (search, profile, urlSources, snippet) => {
    const state = parseState(search, API);
    expect(state.sources).toBe(profile);
    expect(toSearchParams(state, API).get('sources')).toBe(urlSources);
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

  it('in sources chỉ khi khác mặc định all', () => {
    const base = parseState('', API);
    expect(base.sources).toBe('all');
    expect(toSearchParams(base, API).has('sources')).toBe(false);
    expect(toSearchParams({ ...base, sources: 'osm' }, API).get('sources')).toBe('osm');
    expect(toSearchParams({ ...base, sources: 'fsq' }, API).get('sources')).toBe('fsq');
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
      tab: 'dan-duong',
      tmode: 'walk',
      from: { lng: 106.699, lat: 10.7798, label: 'Nhà thờ Đức Bà, Quận 1' },
      to: { lng: 106.6981, lat: 10.7725, label: 'Chợ Bến Thành' },
    };
    expect(parseState(toSearchParams(original, API).toString(), API)).toEqual(original);
  });
});

describe('state dẫn đường trên URL', () => {
  it('đọc tab, tmode, from, to; nhãn có dấu và dấu phẩy', () => {
    const s = parseState(
      'tab=dan-duong&tmode=car&from=10.7798,106.699,Nh%C3%A0%20th%E1%BB%9D%2C%20Q1&to=10.7725,106.6981',
      API,
    );
    expect(s.tab).toBe('dan-duong');
    expect(s.tmode).toBe('car');
    expect(s.from).toEqual({ lng: 106.699, lat: 10.7798, label: 'Nhà thờ, Q1' });
    expect(s.to).toEqual({ lng: 106.6981, lat: 10.7725, label: '10.7725, 106.6981' });
  });
  it('bỏ qua tmode lạ, điểm sai định dạng, tab khác', () => {
    const s = parseState('tab=xyz&tmode=plane&from=abc&to=10.7,200', API);
    expect(s.tab).toBeNull();
    expect(s.tmode).toBe('motorbike');
    expect(s.from).toBeNull();
    expect(s.to).toBeNull();
  });
  it('toSearchParams chỉ in khi khác mặc định; from trống = vị trí của tôi', () => {
    const base = parseState('', API);
    expect(toSearchParams(base, API).toString()).toBe('');
    const p = toSearchParams(
      {
        ...base,
        tab: 'dan-duong',
        tmode: 'walk',
        to: { lng: 106.6981, lat: 10.7725, label: 'Chợ Bến Thành' },
      },
      API,
    );
    expect(p.get('tab')).toBe('dan-duong');
    expect(p.get('tmode')).toBe('walk');
    expect(p.get('from')).toBeNull();
    expect(p.get('to')).toBe('10.7725,106.6981,Chợ Bến Thành');
  });
});

describe('navSnippet', () => {
  it('sinh mã 3 bước với toạ độ [lat, lng], mode và điểm đi mặc định là GPS', () => {
    const s = {
      ...parseState('', API),
      tmode: 'car',
      to: { lng: 106.6981, lat: 10.7725, label: 'Chợ Bến Thành' },
    };
    const code = navSnippet(s);
    expect(code).toContain("import { createMap } from '@mapslibvn/web';");
    expect(code).toContain('to: [10.7725, 106.6981], // Chợ Bến Thành');
    expect(code).toContain("mode: 'car',");
    expect(code).toContain('navigator.geolocation.getCurrentPosition');
    expect(code).toContain('map.routes.show(response);');
    expect(code).toContain('map.navigation.start({ response })');
  });
  it('có from thì dùng thẳng toạ độ, không xin GPS', () => {
    const s = {
      ...parseState('', API),
      from: { lng: 106.699, lat: 10.7798, label: 'Nhà thờ Đức Bà' },
      to: { lng: 106.6981, lat: 10.7725, label: 'Chợ Bến Thành' },
    };
    const code = navSnippet(s);
    expect(code).toContain('from: [10.7798, 106.699], // Nhà thờ Đức Bà');
    expect(code).not.toContain('getCurrentPosition');
  });
});

describe('buildSnippet', () => {
  const base = parseState('', API);

  it('bản script dùng global MapsLibVN và UMD của docs', () => {
    const code = buildSnippet({ ...base, key: KHOA_MAU }, 'script');
    expect(code).toContain('MapsLibVN.createMap');
    expect(code).toContain('/sdk/mapslibvn.umd.js');
    expect(code).toContain('/sdk/mapslibvn.css');
    expect(code).toContain("container: 'map'");
    expect(code).toContain(`apiKey: '${KHOA_MAU}'`);
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

  it('không in poiSources khi giữ mặc định all (trùng mặc định của SDK)', () => {
    const code = buildSnippet(base, 'script');
    expect(code).not.toContain('poiSources');
  });

  it('bản esm import @mapslibvn/web và truyền maplibre', () => {
    const code = buildSnippet(base, 'esm');
    expect(code).toContain("from '@mapslibvn/web'");
    expect(code).toContain("import * as maplibregl from 'maplibre-gl'");
    expect(code).toContain('{ maplibre: maplibregl }');
    expect(code).not.toContain('MapsLibVN.createMap');
  });

  it('ném lỗi với kind lạ', () => {
    expect(() => buildSnippet(base, 'python')).toThrow();
  });
});

describe('maskKey', () => {
  it('giữ 13 ký tự đầu và 4 ký tự cuối', () => {
    expect(maskKey(KHOA_MAU)).toBe('mlv_live_demo…0000');
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

describe('pointFrom*', () => {
  it('autocomplete: lấy lng/lat/name; area thiếu toạ độ thì lấy tâm bbox', () => {
    expect(
      pointFromAutocomplete({ type: 'street', name: 'Nguyễn Du', lng: 106.699, lat: 10.78 }),
    ).toEqual({ lng: 106.699, lat: 10.78, label: 'Nguyễn Du' });
    expect(
      pointFromAutocomplete({ type: 'area', name: 'Quận 1', bbox: [106.69, 10.77, 106.71, 10.79] }),
    ).toEqual({ lng: 106.7, lat: 10.78, label: 'Quận 1' });
  });
  it('poi: lngLat [lng, lat] và tên', () => {
    expect(
      pointFromPoi({
        id: 'p1',
        name: 'Chợ Bến Thành',
        category: 'market',
        group: 'shop',
        lngLat: [106.6981, 10.7725],
      }),
    ).toEqual({ lng: 106.6981, lat: 10.7725, label: 'Chợ Bến Thành' });
  });
  it('lngLat: nhãn "lat, lng" bốn chữ số lẻ', () => {
    expect(pointFromLngLat([106.699012, 10.779834])).toEqual({
      lng: 106.699012,
      lat: 10.779834,
      label: '10.7798, 106.6990',
    });
  });
});

describe('directionsRequest', () => {
  it('đảo [lng,lat] → [lat,lng], luôn xin tuyến thay thế, có lang', () => {
    const from = { lng: 106.699, lat: 10.7798, label: 'A' };
    const to = { lng: 106.698, lat: 10.7725, label: 'B' };
    expect(directionsRequest({ from, to, mode: 'car', lang: 'vi' })).toEqual({
      from: [10.7798, 106.699],
      to: [10.7725, 106.698],
      mode: 'car',
      lang: 'vi',
      alternatives: true,
    });
  });
});

describe('shortDistance / routeSummary / etaLabel', () => {
  it('shortDistance: mét dưới 1 km, km một chữ số lẻ dấu phẩy, nguyên từ 10 km', () => {
    expect(shortDistance(85.4)).toBe('85 m');
    expect(shortDistance(1140)).toBe('1,1 km');
    expect(shortDistance(12_400)).toBe('12 km');
  });
  it('routeSummary: quãng đường, phút làm tròn (tối thiểu 1), tên đường của bước dài nhất', () => {
    const route = {
      distance_m: 1148,
      duration_s: 250,
      legs: [
        {
          steps: [
            { distance_m: 140, street_names: ['Công trường Công xã Paris'] },
            { distance_m: 333, street_names: ['Nam Kỳ Khởi Nghĩa'] },
            { distance_m: 0, street_names: [] },
          ],
        },
      ],
    };
    expect(routeSummary(route)).toEqual({
      distanceText: '1,1 km',
      minutes: 4,
      via: 'Nam Kỳ Khởi Nghĩa',
    });
    expect(
      routeSummary({
        distance_m: 20,
        duration_s: 5,
        legs: [{ steps: [{ distance_m: 20, street_names: [] }] }],
      }),
    ).toEqual({ distanceText: '20 m', minutes: 1, via: null });
  });
  it('etaLabel: "phút · quãng · HH:MM" theo giờ máy', () => {
    const now = new Date(2026, 8, 12, 10, 38, 0).getTime();
    expect(etaLabel(250, 950, now)).toBe('4 phút · 950 m · 10:42');
    expect(etaLabel(0, 0, now)).toBe('0 phút · 0 m · 10:38');
  });
});

describe('DEFAULT_KEY', () => {
  it('rỗng khi chưa qua bước chèn khoá lúc build', () => {
    // public/ được phục vụ nguyên trạng nên không đọc được import.meta.env; khoá thật do
    // scripts/inject-demo-key.mjs thay vào dist sau `astro build`. Trong mã nguồn (và trong test)
    // nó vẫn là chuỗi mốc, và hàm phải quy nó về rỗng thay vì trả ra "__MAPSLIBVN_DEMO_KEY__"
    // rồi gửi chuỗi đó lên API như một khoá.
    expect(DEFAULT_KEY).toBe('');
  });
});

describe('đội xe', () => {
  /** @param {number} n */
  const pts = (n) =>
    Array.from({ length: n }, (_, i) => ({
      lat: Number((10.77 + i / 1000).toFixed(6)),
      lng: 106.7,
      label: `P${i}`,
    }));

  it('matrixPlan: N×N cho "all", 1×(N-1) cho "depot"', () => {
    const all = matrixPlan(pts(3), 'all');
    expect(all.ok && [all.sources.length, all.targets.length]).toEqual([3, 3]);
    const depot = matrixPlan(pts(3), 'depot');
    expect(depot.ok && depot.sources.map((p) => p.label)).toEqual(['P0']);
    expect(depot.ok && depot.targets.map((p) => p.label)).toEqual(['P1', 'P2']);
  });
  it('matrixPlan: chặn trước khi gọi API khi vượt trần cặp hoặc thiếu điểm', () => {
    expect(MATRIX_MAX_PAIRS).toBe(50);
    expect(matrixPlan(pts(7), 'all').ok).toBe(true); // 49 cặp
    const over = matrixPlan(pts(8), 'all');
    expect(over.ok).toBe(false);
    expect(!over.ok && over.error).toContain('8 × 8 = 64');
    expect(matrixPlan(pts(1), 'all').ok).toBe(false);
    // 1 × 25 được; 1 × 26 vẫn dưới 50 cặp nhưng vượt trần mỗi bên 25 điểm của API.
    expect(matrixPlan(pts(26), 'depot').ok).toBe(true);
    const side = matrixPlan(pts(27), 'depot');
    expect(!side.ok && side.error).toContain('tối đa 25 điểm');
  });
  it('optimizedPlan: vòng tròn bỏ `to`, một chiều lấy điểm cuối làm `to`; toạ độ [lat, lng]', () => {
    const round = optimizedPlan({ points: pts(3), roundTrip: true, mode: 'car', lang: 'vi' });
    expect(round.ok && round.request).toEqual({
      from: [10.77, 106.7],
      stops: [
        [10.771, 106.7],
        [10.772, 106.7],
      ],
      mode: 'car',
      lang: 'vi',
    });
    const oneWay = optimizedPlan({ points: pts(3), roundTrip: false, mode: 'walk', lang: 'en' });
    expect(oneWay.ok && oneWay.request.to).toEqual([10.772, 106.7]);
    expect(oneWay.ok && oneWay.stops.map((p) => p.label)).toEqual(['P1']);
  });
  it('optimizedPlan: thiếu điểm hoặc quá trần điểm dừng thì báo lỗi', () => {
    expect(optimizedPlan({ points: pts(1), roundTrip: true, mode: 'car', lang: 'vi' }).ok).toBe(
      false,
    );
    expect(optimizedPlan({ points: pts(2), roundTrip: false, mode: 'car', lang: 'vi' }).ok).toBe(
      false,
    );
    const n = OPTIMIZED_MAX_STOPS;
    expect(optimizedPlan({ points: pts(n + 1), roundTrip: true, mode: 'car', lang: 'vi' }).ok).toBe(
      true,
    );
    expect(optimizedPlan({ points: pts(n + 2), roundTrip: true, mode: 'car', lang: 'vi' }).ok).toBe(
      false,
    );
    expect(
      optimizedPlan({ points: pts(n + 2), roundTrip: false, mode: 'car', lang: 'vi' }).ok,
    ).toBe(true);
  });
  it('shortDuration', () => {
    expect(shortDuration(42)).toBe('42 giây');
    expect(shortDuration(720)).toBe('12 phút');
    expect(shortDuration(3600)).toBe('1 giờ');
    expect(shortDuration(3900)).toBe('1 giờ 5 phút');
  });
  it('visitLegs: xếp theo `order`, chặng cuối về lại điểm xuất phát khi không có `to`', () => {
    const [from, a, b] = pts(3);
    const legs = [
      { distance_m: 100, duration_s: 10 },
      { distance_m: 200, duration_s: 20 },
      { distance_m: 300, duration_s: 30 },
    ];
    expect(visitLegs({ from, stops: [a, b], to: null, order: [1, 0], legs })).toEqual([
      { label: 'P2', stopIndex: 1, distance_m: 100, duration_s: 10 },
      { label: 'P1', stopIndex: 0, distance_m: 200, duration_s: 20 },
      { label: 'P0 (về lại)', stopIndex: null, distance_m: 300, duration_s: 30 },
    ]);
  });
  it('fleetSnippet: dùng điểm mẫu khi danh sách chưa đủ, bỏ `to` khi vòng tròn', () => {
    const state = parseState('', API);
    const code = fleetSnippet(state, { points: [], roundTrip: true, mode: 'motorbike' });
    expect(code).toContain(`from: [${FLEET_SAMPLE[0].lat}, ${FLEET_SAMPLE[0].lng}]`);
    expect(code).toContain('bỏ `to`');
    expect(code).not.toMatch(/^ {2}to:/m);
    const oneWay = fleetSnippet(state, { points: pts(3), roundTrip: false, mode: 'car' });
    expect(oneWay).toContain('  to: [10.772, 106.7], // P2');
    expect(oneWay).toContain("mode: 'car'");
  });
});
