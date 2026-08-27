import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl from 'maplibre-gl';
import { type CreateMapOptions, createMap as createMapWithDeps } from './map';

// Liệt kê tường minh (không dùng export * để tránh trùng tên createMap)
export {
  applyLanguage,
  nameExpression,
  attributionHtml,
  attributionText,
  createClient,
  MapsLibVNError,
} from './index';
export type { CreateMapOptions, MapEvents, MapsLibVNMap, MarkerOptions, PoiFeature } from './map';

/** Bản UMD: maplibre đã đóng gói sẵn, không cần truyền deps. */
export function createMap(opts: CreateMapOptions) {
  return createMapWithDeps(opts, { maplibre: maplibregl });
}
export { maplibregl };
