import 'maplibre-gl/dist/maplibre-gl.css';
import * as maplibregl from 'maplibre-gl';
import { defineAutocomplete } from './autocomplete-element';
import { type CreateMapOptions, createMap as createMapWithDeps } from './map';

/**
 * Trỏ worker của MapLibre về đúng cạnh file UMD này.
 *
 * MapLibre 6 suy URL worker từ `import.meta.url`. UMD là script cổ điển nên không có
 * `import.meta`, và kết quả phụ thuộc hoàn toàn vào bundler: rollup (vite 6) thay bằng shim
 * `document.currentScript`, còn rolldown (vite 8) thay bằng `{}` — mất shim thì MapLibre rơi về
 * chuỗi rỗng, worker không tải được và bản đồ kẹt ở trạng thái `loading` (đo 16/09/2026: e2e docs
 * rớt từ 44 pass xuống 2 pass). Đặt tường minh ở đây để bản UMD độc lập với bundler.
 *
 * `document.currentScript` chỉ đúng trong lượt chạy đồng bộ đầu tiên của script, nên phải đọc
 * ngay ở tầng module. Vẫn chỉ đặt khi chưa có ai đặt, và người dùng ghi đè được bằng
 * `maplibregl.setWorkerUrl(...)` sau khi nạp — cách tự host mà tài liệu đang hướng dẫn.
 */
function bundledWorkerUrl(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const script = document.currentScript;
  const self =
    (script instanceof HTMLScriptElement && script.src) ||
    (document.baseURI ? new URL('mapslibvn.umd.js', document.baseURI).href : '');
  return self ? new URL('maplibre-gl-worker.mjs', self).href : undefined;
}

const workerUrl = bundledWorkerUrl();
if (workerUrl && !maplibregl.getWorkerUrl()) maplibregl.setWorkerUrl(workerUrl);

defineAutocomplete();

export { defineAutocomplete, MapsLibVNAutocomplete } from './autocomplete-element';
export type {
  Announcement,
  AttributionResponse,
  ClientOptions,
  DirectionsLang,
  DirectionsOptions,
  DirectionsResponse,
  GeoFix,
  GeolocationSourceOptions,
  Lang,
  ManeuverKind,
  MapsLibVNClient,
  NavigationController,
  NavigationEvents,
  NavigationProgress,
  NavigationStartOptions,
  NavigationStatus,
  NavigationThresholds,
  Navigator,
  PoiSource,
  PositionError,
  PositionSource,
  Route,
  RouteLeg,
  RouteProvider,
  RouteStep,
  RoutesLayer,
  Speech,
  SpeechOptions,
  Theme,
  TravelMode,
  WebNavigationEvents,
} from './index';
// Liệt kê tường minh (không dùng export * để tránh trùng tên createMap)
export {
  applyLanguage,
  attributionHtml,
  attributionText,
  createClient,
  createNavigator,
  createSpeech,
  FOLLOW_ZOOM,
  formatDistance,
  formatDistanceShort,
  geolocationSource,
  MapsLibVNError,
  NAVIGATION_THRESHOLDS,
  nameExpression,
  playbackSource,
  ROUTE_LAYER_IDS,
  ROUTE_SOURCE_ID,
  simulateFixes,
  toGeoFix,
} from './index';
export type { CreateMapOptions, MapEvents, MapsLibVNMap, MarkerOptions, PoiFeature } from './map';

/** Bản UMD: maplibre đã đóng gói sẵn, không cần truyền deps. */
export function createMap(opts: CreateMapOptions) {
  return createMapWithDeps(opts, { maplibre: maplibregl });
}
export { maplibregl };
