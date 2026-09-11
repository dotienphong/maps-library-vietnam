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
  createNavigator,
  formatDistance,
  formatDistanceShort,
  MapsLibVNError,
  NAVIGATION_THRESHOLDS,
  simulateFixes,
  ROUTE_LAYER_IDS,
  ROUTE_SOURCE_ID,
  FOLLOW_ZOOM,
  geolocationSource,
  playbackSource,
  toGeoFix,
  createSpeech,
} from './index';
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
  RoutesLayer,
  RouteStep,
  Speech,
  SpeechOptions,
  Theme,
  TravelMode,
  WebNavigationEvents,
} from './index';
export { MapsLibVNAutocomplete, defineAutocomplete } from './autocomplete-element';
export type { CreateMapOptions, MapEvents, MapsLibVNMap, MarkerOptions, PoiFeature } from './map';

/** Bản UMD: maplibre đã đóng gói sẵn, không cần truyền deps. */
export function createMap(opts: CreateMapOptions) {
  return createMapWithDeps(opts, { maplibre: maplibregl });
}
export { maplibregl };
