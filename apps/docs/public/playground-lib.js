/**
 * Logic thuần của playground — không chạm DOM, không gọi mạng, để test được bằng Vitest.
 * Test: `apps/docs/scripts/playground-lib.test.mjs`.
 */

/** Khoá demo công khai, chỉ chạy trên origin docs và localhost. */
export const DEFAULT_KEY = 'mlv_live_demo00000000000000000000';

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

/**
 * @typedef {Object} PlaygroundState
 * @property {string} key Khoá API đang dùng.
 * @property {string} api Gốc API đang dùng.
 * @property {string} style `light` hoặc `dark`.
 * @property {string} lang `vi` hoặc `en`.
 * @property {boolean} poi Bật lớp POI.
 * @property {'all' | 'osm'} sources Profile nguồn POI.
 * @property {boolean} compact Attribution gọn.
 * @property {[number, number]} center Tâm bản đồ `[lng, lat]`.
 * @property {number} zoom Mức zoom.
 * @property {boolean} embed Chế độ nhúng iframe (ẩn bảng điều khiển).
 */

/**
 * Rút gọn số cho URL và mã nhúng: bỏ số 0 vô nghĩa ở cuối.
 * @param {number} value
 * @returns {number}
 */
const round6 = (value) => Number(value.toFixed(6));

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
    sources: params.get('sources') === 'osm' ? 'osm' : 'all',
    compact: params.get('compact') === '1',
    center,
    zoom,
    embed: params.get('embed') === '1',
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
  if (state.sources === 'osm') params.set('sources', 'osm');
  if (state.compact) params.set('compact', '1');
  const movedCenter =
    round6(state.center[0]) !== DEFAULT_CENTER[0] || round6(state.center[1]) !== DEFAULT_CENTER[1];
  if (movedCenter || round6(state.zoom) !== DEFAULT_ZOOM) {
    params.set('c', `${round6(state.center[0])},${round6(state.center[1])},${round6(state.zoom)}`);
  }
  if (state.embed) params.set('embed', '1');
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
  if (state.sources === 'osm') lines.push("poiSources: ['osm'],");
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
      "import maplibregl from 'maplibre-gl';",
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
