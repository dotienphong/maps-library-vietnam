import 'maplibre-gl/dist/maplibre-gl.css';
import * as maplibregl from 'maplibre-gl';
import { defineAutocomplete } from './autocomplete-element';
import { type CreateMapOptions, createMap as createMapWithDeps } from './map';

defineAutocomplete();

// Liệt kê tường minh (không dùng export * để tránh trùng tên createMap)
export {
  applyLanguage,
  nameExpression,
  attributionHtml,
  attributionText,
  createClient,
  MapsLibVNError,
} from './index';
export { MapsLibVNAutocomplete, defineAutocomplete } from './autocomplete-element';
export type { CreateMapOptions, MapEvents, MapsLibVNMap, MarkerOptions, PoiFeature } from './map';

/** Bản UMD: maplibre đã đóng gói sẵn, không cần truyền deps. */
export function createMap(opts: CreateMapOptions) {
  return createMapWithDeps(opts, { maplibre: maplibregl });
}
export { maplibregl };
