/**
 * Logic thuần của playground — không chạm DOM, không gọi mạng, để test được bằng Vitest.
 * Test: `apps/docs/scripts/playground-lib.test.mjs`.
 */

/**
 * Khoá demo công khai, chỉ chạy trên origin docs và localhost.
 *
 * Thư mục `public/` được phục vụ NGUYÊN TRẠNG, không qua Vite, nên không đọc được
 * `import.meta.env` ở đây. Thay vào đó `scripts/inject-demo-key.mjs` thay chuỗi mốc dưới đây
 * bằng `PUBLIC_MAPSLIBVN_DEMO_KEY` ngay sau `astro build` — khoá không nằm trong git, và lần xoay
 * khoá sau chỉ cần đổi .env rồi build lại.
 */
const RAW_KEY = '__MAPSLIBVN_DEMO_KEY__';

/** Rỗng khi chưa chèn (đang chạy `astro dev`, hoặc build thiếu biến): ô Khoá API để trống. */
export const DEFAULT_KEY = RAW_KEY.startsWith('__MAPSLIBVN') ? '' : RAW_KEY;

/** Tâm mặc định của playground: khu trung tâm Thành phố Hồ Chí Minh. */
export const DEFAULT_CENTER = /** @type {[number, number]} */ ([106.7, 10.776]);

/** Zoom mặc định của playground (SDK mặc định 12, playground vào gần hơn). */
export const DEFAULT_ZOOM = 14;

/** Mặc định của `createMap` trong `packages/web/src/map.ts` — dùng để rút gọn mã nhúng. */
export const SDK_DEFAULTS = {
  style: 'light',
  lang: 'vi',
  poiLayer: true,
  compactAttribution: false,
};

/** Zoom gợi ý khi kết quả geocode chỉ tới mức đường, phường hoặc tỉnh. */
export const PRECISION_ZOOM = { street: 15, ward: 13, province: 10 };

/** Bán kính vòng tròn ước lượng theo `precision` (mét); 0 nghĩa là không vẽ. */
const PRECISION_RADIUS = { rooftop: 0, alley: 40, interpolated: 80 };

const STYLES = ['light', 'dark'];
const LANGS = ['vi', 'en'];

/** Profile Playground → danh sách nguồn SDK/API chuẩn. */
export const POI_PROFILE_SOURCES = {
  all: ['osm', 'fsq'],
  osm: ['osm'],
  fsq: ['fsq'],
};

/** Profile nguồn POI mặc định của Playground — trùng mặc định `all` (OSM + Foursquare) của SDK. */
export const DEFAULT_SOURCES = 'all';

/** @param {string} profile @returns {string[] | undefined} */
export function poiSourcesForProfile(profile) {
  const sources = POI_PROFILE_SOURCES[profile];
  return profile === 'all' || !sources ? undefined : [...sources];
}

/** @param {string | null} raw */
function profileForSources(raw) {
  if (!raw) return DEFAULT_SOURCES;
  if (raw === 'all') return 'all';
  return (
    Object.entries(POI_PROFILE_SOURCES).find(([, sources]) => sources.join(',') === raw)?.[0] ??
    DEFAULT_SOURCES
  );
}

/**
 * @typedef {Object} PlaygroundState
 * @property {string} key Khoá API đang dùng.
 * @property {string} api Gốc API đang dùng.
 * @property {string} style `light` hoặc `dark`.
 * @property {string} lang `vi` hoặc `en`.
 * @property {boolean} poi Bật lớp POI.
 * @property {'all' | 'osm' | 'fsq'} sources Profile nguồn POI.
 * @property {boolean} compact Attribution gọn.
 * @property {[number, number]} center Tâm bản đồ `[lng, lat]`.
 * @property {number} zoom Mức zoom.
 * @property {boolean} embed Chế độ nhúng iframe (ẩn bảng điều khiển).
 * @property {'dan-duong' | null} tab Đang ở chế độ dẫn đường.
 * @property {'motorbike' | 'car' | 'walk'} tmode Phương tiện dẫn đường.
 * @property {import('./playground-lib.js').NavPoint | null} from Điểm đi; null = vị trí của tôi.
 * @property {import('./playground-lib.js').NavPoint | null} to Điểm đến.
 */

/**
 * Rút gọn số cho URL và mã nhúng: bỏ số 0 vô nghĩa ở cuối.
 * @param {number} value
 * @returns {number}
 */
const round6 = (value) => Number(value.toFixed(6));

/**
 * `lat,lng[,nhãn]` → NavPoint; nhãn có thể chứa dấu phẩy nên chỉ tách hai phần đầu.
 * @param {string | null} raw
 * @returns {import('./playground-lib.js').NavPoint | null}
 */
function parsePoint(raw) {
  if (!raw) return null;
  const first = raw.indexOf(',');
  const second = first < 0 ? -1 : raw.indexOf(',', first + 1);
  const latText = first < 0 ? raw : raw.slice(0, first);
  const lngText = first < 0 ? '' : second < 0 ? raw.slice(first + 1) : raw.slice(first + 1, second);
  const lat = Number(latText);
  const lng = Number(lngText);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }
  const label = second < 0 ? '' : raw.slice(second + 1).trim();
  return {
    lng: round6(lng),
    lat: round6(lat),
    label: label || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
  };
}

/** @param {import('./playground-lib.js').NavPoint} point */
const pointParam = (point) => `${round6(point.lat)},${round6(point.lng)},${point.label}`;

/**
 * Đọc trạng thái playground từ query string.
 * @param {string | URLSearchParams} search Query string, ví dụ `location.search`.
 * @param {string} apiBase Gốc API mặc định, thường từ `resolveApiBase()`.
 * @returns {PlaygroundState}
 */
export function parseState(search, apiBase) {
  const params = new URLSearchParams(search);
  const style = params.get('style');
  const lang = params.get('lang');

  /** @type {[number, number]} */
  let center = [DEFAULT_CENTER[0], DEFAULT_CENTER[1]];
  let zoom = DEFAULT_ZOOM;
  const raw = params.get('c');
  if (raw) {
    const [lng, lat, z] = raw.split(',').map(Number);
    const ok =
      Number.isFinite(lng) &&
      Number.isFinite(lat) &&
      Number.isFinite(z) &&
      Math.abs(lng) <= 180 &&
      Math.abs(lat) <= 90 &&
      z >= 0 &&
      z <= 22;
    if (ok) {
      center = [round6(lng), round6(lat)];
      zoom = round6(z);
    }
  }

  return {
    key: params.get('key') || DEFAULT_KEY,
    api: params.get('api') || apiBase,
    style: style && STYLES.includes(style) ? style : SDK_DEFAULTS.style,
    lang: lang && LANGS.includes(lang) ? lang : SDK_DEFAULTS.lang,
    poi: params.get('poi') !== '0',
    sources: profileForSources(params.get('sources')),
    compact: params.get('compact') === '1',
    center,
    zoom,
    embed: params.get('embed') === '1',
    tab: params.get('tab') === 'dan-duong' ? 'dan-duong' : null,
    tmode: /** @type {'motorbike' | 'car' | 'walk'} */ (
      TRAVEL_MODES.includes(params.get('tmode') ?? '') ? params.get('tmode') : 'motorbike'
    ),
    from: parsePoint(params.get('from')),
    to: parsePoint(params.get('to')),
  };
}

/**
 * Sinh query string chia sẻ được — chỉ ghi những gì khác mặc định.
 * @param {PlaygroundState} state
 * @param {string} apiBase Gốc API mặc định, để bỏ `api` khi không cần.
 * @returns {URLSearchParams}
 */
export function toSearchParams(state, apiBase) {
  const params = new URLSearchParams();
  if (state.key !== DEFAULT_KEY) params.set('key', state.key);
  if (state.api !== apiBase) params.set('api', state.api);
  if (state.style !== SDK_DEFAULTS.style) params.set('style', state.style);
  if (state.lang !== SDK_DEFAULTS.lang) params.set('lang', state.lang);
  if (!state.poi) params.set('poi', '0');
  if (state.sources !== DEFAULT_SOURCES) {
    const poiSources = poiSourcesForProfile(state.sources);
    params.set('sources', poiSources ? poiSources.join(',') : 'all');
  }
  if (state.compact) params.set('compact', '1');
  const movedCenter =
    round6(state.center[0]) !== DEFAULT_CENTER[0] || round6(state.center[1]) !== DEFAULT_CENTER[1];
  if (movedCenter || round6(state.zoom) !== DEFAULT_ZOOM) {
    params.set('c', `${round6(state.center[0])},${round6(state.center[1])},${round6(state.zoom)}`);
  }
  if (state.embed) params.set('embed', '1');
  if (state.tab === 'dan-duong') params.set('tab', 'dan-duong');
  if (state.tmode !== 'motorbike') params.set('tmode', state.tmode);
  if (state.from) params.set('from', pointParam(state.from));
  if (state.to) params.set('to', pointParam(state.to));
  return params;
}

/**
 * Các dòng tuỳ chọn `createMap` cho mã nhúng.
 * @param {PlaygroundState} state
 * @param {string} indent
 * @returns {string}
 */
function optionLines(state, indent) {
  const lines = [
    "container: 'map',",
    `apiKey: '${state.key}',`,
    `apiBase: '${state.api}',`,
    `center: [${round6(state.center[0])}, ${round6(state.center[1])}],`,
    `zoom: ${round6(state.zoom)},`,
  ];
  if (state.style !== SDK_DEFAULTS.style) lines.push(`style: '${state.style}',`);
  if (state.lang !== SDK_DEFAULTS.lang) lines.push(`lang: '${state.lang}',`);
  if (state.poi !== SDK_DEFAULTS.poiLayer) lines.push(`poiLayer: ${state.poi},`);
  const poiSources = poiSourcesForProfile(state.sources);
  if (poiSources)
    lines.push(`poiSources: [${poiSources.map((source) => `'${source}'`).join(', ')}],`);
  if (state.compact !== SDK_DEFAULTS.compactAttribution) {
    lines.push(`compactAttribution: ${state.compact},`);
  }
  return lines.map((line) => indent + line).join('\n');
}

/**
 * Sinh mã nhúng phản ánh đúng tuỳ chọn hiện tại.
 * @param {PlaygroundState} state
 * @param {'script' | 'esm'} kind
 * @returns {string}
 */
export function buildSnippet(state, kind) {
  if (kind === 'script') {
    return [
      '<link rel="stylesheet" href="https://mapslibvn-docs.pages.dev/sdk/mapslibvn.css" />',
      '<div id="map" style="height: 420px"></div>',
      '<script src="https://mapslibvn-docs.pages.dev/sdk/mapslibvn.umd.js"></script>',
      '<script>',
      '  const map = MapsLibVN.createMap({',
      optionLines(state, '    '),
      '  });',
      "  map.on('load', () => console.log('bản đồ đã tải'));",
      '</script>',
    ].join('\n');
  }
  if (kind === 'esm') {
    return [
      "import { createMap } from '@mapslibvn/web';",
      "import * as maplibregl from 'maplibre-gl';",
      "import 'maplibre-gl/dist/maplibre-gl.css';",
      '',
      'const map = createMap(',
      '  {',
      optionLines(state, '    '),
      '  },',
      '  { maplibre: maplibregl },',
      ');',
      "map.on('load', () => console.log('bản đồ đã tải'));",
    ].join('\n');
  }
  throw new Error(`kind không hợp lệ: ${kind}`);
}

/**
 * Che khoá API khi hiển thị: giữ 13 ký tự đầu và 4 ký tự cuối.
 * @param {string} key
 * @returns {string}
 */
export function maskKey(key) {
  if (!key || key.length <= 17) return key;
  return `${key.slice(0, 13)}…${key.slice(-4)}`;
}

/**
 * Vòng tròn ước lượng dạng GeoJSON Feature (64 đỉnh, khép kín).
 * @param {number} lng
 * @param {number} lat
 * @param {number} radiusM Bán kính mét.
 * @returns {{ type: 'Feature', properties: Record<string, never>,
 *   geometry: { type: 'Polygon', coordinates: [number, number][][] } }}
 */
export function circleGeoJson(lng, lat, radiusM) {
  const steps = 64;
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  /** @type {[number, number][]} */
  const ring = [];
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    ring.push([lng + dLng * Math.cos(angle), lat + dLat * Math.sin(angle)]);
  }
  ring.push([ring[0][0], ring[0][1]]);
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
}

/**
 * Bán kính vòng tròn ước lượng theo `precision` của `/v1/geocode` (xem `/do-chinh-xac/` mục 3).
 * Trả 0 khi không nên vẽ vòng: `rooftop` đã chính xác, còn `street`/`ward`/`province`
 * chỉ dùng để căn khung nhìn.
 * @param {string | undefined} precision
 * @returns {number}
 */
export function radiusForPrecision(precision) {
  if (!precision) return 0;
  return PRECISION_RADIUS[/** @type {keyof typeof PRECISION_RADIUS} */ (precision)] ?? 0;
}

/* ---------- Dẫn đường ---------- */

/**
 * Một điểm đi/đến của chế độ dẫn đường.
 * @typedef {{ lng: number, lat: number, label: string }} NavPoint
 */

/** Phương tiện hợp lệ của `GET /v1/directions`. */
export const TRAVEL_MODES = ['motorbike', 'car', 'walk'];

/**
 * @param {{ name: string, lng?: number, lat?: number, bbox?: [number, number, number, number] }} item
 * @returns {NavPoint}
 */
export function pointFromAutocomplete(item) {
  if (typeof item.lng === 'number' && typeof item.lat === 'number') {
    return { lng: item.lng, lat: item.lat, label: item.name };
  }
  const [minLng, minLat, maxLng, maxLat] = item.bbox ?? [0, 0, 0, 0];
  return {
    lng: round6((minLng + maxLng) / 2),
    lat: round6((minLat + maxLat) / 2),
    label: item.name,
  };
}

/**
 * @param {{ name: string, lngLat: [number, number] }} poi
 * @returns {NavPoint}
 */
export function pointFromPoi(poi) {
  return { lng: poi.lngLat[0], lat: poi.lngLat[1], label: poi.name };
}

/**
 * @param {[number, number]} lngLat
 * @returns {NavPoint}
 */
export function pointFromLngLat([lng, lat]) {
  return { lng, lat, label: `${lat.toFixed(4)}, ${lng.toFixed(4)}` };
}

/**
 * Tham số cho `client.directions()` — API nhận `[lat, lng]`, luôn xin tuyến thay thế.
 * @param {{ from: NavPoint, to: NavPoint, mode: string, lang: string }} input
 */
export function directionsRequest({ from, to, mode, lang }) {
  return {
    from: /** @type {[number, number]} */ ([from.lat, from.lng]),
    to: /** @type {[number, number]} */ ([to.lat, to.lng]),
    mode,
    lang,
    alternatives: true,
  };
}

/**
 * "85 m", "1,1 km", "12 km" — cùng quy tắc với `formatDistanceShort` của SDK, viết lại để test thuần.
 * @param {number} m
 */
export function shortDistance(m) {
  if (m < 1000) return `${Math.max(0, Math.round(m))} m`;
  const km = m / 1000;
  return km < 10 ? `${km.toFixed(1).replace('.', ',')} km` : `${Math.round(km)} km`;
}

/**
 * Tóm tắt một tuyến cho danh sách chọn tuyến.
 * @param {{ distance_m: number, duration_s: number,
 *   legs: { steps: { distance_m: number, street_names: string[] }[] }[] }} route
 * @returns {{ distanceText: string, minutes: number, via: string | null }}
 */
export function routeSummary(route) {
  let via = null;
  let longest = -1;
  for (const leg of route.legs) {
    for (const step of leg.steps) {
      const name = step.street_names[0];
      if (name && step.distance_m > longest) {
        longest = step.distance_m;
        via = name;
      }
    }
  }
  return {
    distanceText: shortDistance(route.distance_m),
    minutes: Math.max(1, Math.round(route.duration_s / 60)),
    via,
  };
}

/**
 * "4 phút · 950 m · 10:42" cho thanh dưới khi đang dẫn đường.
 * @param {number} remaining_s
 * @param {number} remaining_m
 * @param {number} nowMs
 */
export function etaLabel(remaining_s, remaining_m, nowMs) {
  const arrive = new Date(nowMs + remaining_s * 1000);
  const hh = String(arrive.getHours()).padStart(2, '0');
  const mm = String(arrive.getMinutes()).padStart(2, '0');
  return `${Math.round(remaining_s / 60)} phút · ${shortDistance(remaining_m)} · ${hh}:${mm}`;
}

/**
 * Mã nhúng dẫn đường (ESM) theo điểm và phương tiện đang chọn — bám trang /dan-duong/ mục 1.
 * @param {PlaygroundState} state
 */
export function navSnippet(state) {
  const to = state.to ?? { lng: 106.6981, lat: 10.7725, label: 'Chợ Bến Thành' };
  const fromLine = state.from
    ? `  from: [${round6(state.from.lat)}, ${round6(state.from.lng)}], // ${state.from.label}`
    : '  from: [pos.coords.latitude, pos.coords.longitude], // vị trí của tôi';
  const body = [
    'const response = await map.places.directions({',
    fromLine,
    `  to: [${round6(to.lat)}, ${round6(to.lng)}], // ${to.label}`,
    `  mode: '${state.tmode}',`,
    '  alternatives: true,',
    '});',
    'map.routes.show(response);',
    'map.fitBounds(response.routes[0].bbox, 60);',
    'startButton.onclick = () => map.navigation.start({ response }); // trong sự kiện bấm nút',
  ];
  const wrapped = state.from
    ? body
    : [
        'navigator.geolocation.getCurrentPosition(async (pos) => {',
        ...body.map((line) => `  ${line}`),
        '});',
      ];
  return [
    "import { createMap } from '@mapslibvn/web';",
    "import * as maplibregl from 'maplibre-gl';",
    "import 'maplibre-gl/dist/maplibre-gl.css';",
    '',
    'const map = createMap(',
    '  {',
    optionLines(state, '    '),
    '  },',
    '  { maplibre: maplibregl },',
    ');',
    '',
    ...wrapped,
  ].join('\n');
}

/* ---------- Đội xe: ma trận khoảng cách + tối ưu thứ tự ---------- */

/** Trần của API (`apps/api/src/routing/matrix.ts`, `optimized.ts`) — đo production 22/09/2026. */
export const MATRIX_MAX_PAIRS = 50;
/** Mỗi bên `sources`/`targets` tối đa 25 điểm (`MATRIX_MAX_SOURCES`/`MATRIX_MAX_TARGETS`). */
export const MATRIX_MAX_SIDE = 25;
export const OPTIMIZED_MAX_STOPS = 8;

/**
 * Bộ điểm mẫu Quận 1: đều nằm trong graph Valhalla dev (Quận 1) và nối được bằng cả ba mode trên
 * production (lấy từ `scripts/lib/smoke-matrix.mjs`). Thứ tự cố ý lộn xộn để tối ưu có việc làm.
 * @type {NavPoint[]}
 */
export const FLEET_SAMPLE = [
  { lat: 10.7725, lng: 106.698, label: 'Chợ Bến Thành' },
  { lat: 10.7826, lng: 106.6958, label: 'Hồ Con Rùa' },
  { lat: 10.7686, lng: 106.7069, label: 'Bến Nhà Rồng' },
  { lat: 10.777, lng: 106.6953, label: 'Dinh Độc Lập' },
  { lat: 10.7716, lng: 106.7043, label: 'Bitexco' },
  { lat: 10.7798, lng: 106.699, label: 'Nhà thờ Đức Bà' },
];

/**
 * Chọn nguồn/đích cho ma trận. `all` = mọi cặp N×N, `depot` = từ điểm đầu tới các điểm còn lại.
 * @param {NavPoint[]} points
 * @param {'all' | 'depot'} kind
 * @returns {{ ok: true, sources: NavPoint[], targets: NavPoint[] } | { ok: false, error: string }}
 */
export function matrixPlan(points, kind) {
  if (points.length < 2) return { ok: false, error: 'Cần ít nhất 2 điểm.' };
  const sources = kind === 'depot' ? points.slice(0, 1) : points;
  const targets = kind === 'depot' ? points.slice(1) : points;
  const pairs = sources.length * targets.length;
  if (targets.length > MATRIX_MAX_SIDE) {
    return {
      ok: false,
      error: `Mỗi bên ma trận tối đa ${MATRIX_MAX_SIDE} điểm — đang ${targets.length} điểm đến. Bớt điểm hoặc chia thành nhiều lượt.`,
    };
  }
  if (pairs > MATRIX_MAX_PAIRS) {
    return {
      ok: false,
      error: `Ma trận tối đa ${MATRIX_MAX_PAIRS} cặp — đang ${sources.length} × ${targets.length} = ${pairs}. Bớt điểm hoặc chọn "Từ điểm xuất phát".`,
    };
  }
  return { ok: true, sources, targets };
}

/**
 * Tham số `client.optimizedRoute()` — điểm đầu là xuất phát; `roundTrip` bỏ `to` để API quay về
 * điểm đầu, không thì điểm cuối danh sách là điểm kết thúc cố định.
 * @param {{ points: NavPoint[], roundTrip: boolean, mode: string, lang: string }} input
 * @returns {{ ok: true, request: { from: [number, number], stops: [number, number][], to?: [number, number], mode: string, lang: string }, stops: NavPoint[] }
 *   | { ok: false, error: string }}
 */
export function optimizedPlan({ points, roundTrip, mode, lang }) {
  const min = roundTrip ? 2 : 3;
  if (points.length < min) {
    return {
      ok: false,
      error: roundTrip
        ? 'Cần điểm xuất phát và ít nhất 1 điểm dừng.'
        : 'Cần điểm xuất phát, ít nhất 1 điểm dừng và điểm kết thúc.',
    };
  }
  const [from, ...rest] = points;
  const stops = roundTrip ? rest : rest.slice(0, -1);
  const to = roundTrip ? null : rest[rest.length - 1];
  if (stops.length > OPTIMIZED_MAX_STOPS) {
    return {
      ok: false,
      error: `Tối đa ${OPTIMIZED_MAX_STOPS} điểm dừng — đang ${stops.length}. Bớt điểm trong danh sách.`,
    };
  }
  /** @param {NavPoint} p @returns {[number, number]} */
  const latLng = (p) => [p.lat, p.lng];
  return {
    ok: true,
    stops,
    request: {
      from: latLng(from),
      stops: stops.map(latLng),
      ...(to ? { to: latLng(to) } : {}),
      mode,
      lang,
    },
  };
}

/**
 * "45 giây", "12 phút", "1 giờ 5 phút".
 * @param {number} s
 */
export function shortDuration(s) {
  if (s < 60) return `${Math.max(0, Math.round(s))} giây`;
  const minutes = Math.round(s / 60);
  if (minutes < 60) return `${minutes} phút`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} giờ` : `${h} giờ ${m} phút`;
}

/**
 * Lịch trình theo thứ tự tối ưu: mỗi chặng là (điểm đến, quãng, thời gian) của leg tương ứng.
 * `order` là chỉ số vào `stops` đã gửi; leg i đi tới điểm thứ i+1 của chuyến.
 * @param {{ from: NavPoint, stops: NavPoint[], to: NavPoint | null,
 *   order: number[], legs: { distance_m: number, duration_s: number }[] }} input
 * @returns {{ label: string, stopIndex: number | null, distance_m: number, duration_s: number }[]}
 */
export function visitLegs({ from, stops, to, order, legs }) {
  const end = to ?? from;
  const seq = [
    ...order.map((i) => ({ label: stops[i]?.label ?? `Điểm ${i + 1}`, stopIndex: i })),
    { label: to ? end.label : `${end.label} (về lại)`, stopIndex: null },
  ];
  return seq.map((item, i) => ({
    ...item,
    distance_m: legs[i]?.distance_m ?? 0,
    duration_s: legs[i]?.duration_s ?? 0,
  }));
}

/**
 * Mã mẫu ESM cho hai API đội xe theo danh sách điểm đang có.
 * @param {PlaygroundState} state
 * @param {{ points: NavPoint[], roundTrip: boolean, mode: string }} fleet
 */
export function fleetSnippet(state, { points, roundTrip, mode }) {
  const pts = points.length >= 2 ? points : FLEET_SAMPLE;
  /** @param {NavPoint} p */
  const ll = (p) => `[${round6(p.lat)}, ${round6(p.lng)}]`;
  const [from, ...rest] = pts;
  const stops = roundTrip ? rest : rest.slice(0, -1);
  const to = roundTrip ? null : rest[rest.length - 1];
  return [
    "import { createClient } from '@mapslibvn/core';",
    '',
    `const client = createClient({ apiKey: '${state.key}', baseUrl: '${state.api}' });`,
    '',
    '// Tham số vào là [lat, lng]; response trả [lng, lat].',
    `const points = [${pts.map(ll).join(', ')}];`,
    `const matrix = await client.matrix({ sources: points, targets: points, mode: '${mode}' });`,
    'console.log(matrix.durations_s, matrix.distances_m); // ô null = không nối được',
    '',
    'const trip = await client.optimizedRoute({',
    `  from: ${ll(from)}, // ${from.label}`,
    `  stops: [${stops.map(ll).join(', ')}],`,
    ...(to ? [`  to: ${ll(to)}, // ${to.label}`] : ['  // bỏ `to` = quay về `from`']),
    `  mode: '${mode}',`,
    '});',
    'console.log(trip.order); // chỉ số vào `stops` theo thứ tự nên ghé',
    'map.routes.show(trip); // web: createMap(); React Native: useMap().routes.show(trip)',
  ].join('\n');
}
