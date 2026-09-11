export { createMap } from './map';
export type { CreateMapOptions, MapEvents, MapsLibVNMap, MarkerOptions, PoiFeature } from './map';
export { applyLanguage, nameExpression } from './language';
export type { Lang } from './language';
export { MapsLibVNAutocomplete, defineAutocomplete } from './autocomplete-element';
export { ROUTE_LAYER_IDS, ROUTE_SOURCE_ID } from './routes-layer';
export type { RoutesLayer } from './routes-layer';
export { FOLLOW_ZOOM } from './navigation';
export type {
  NavigationController,
  NavigationStartOptions,
  WebNavigationEvents,
} from './navigation';
export { geolocationSource, playbackSource, toGeoFix } from './position-source';
export type { GeolocationSourceOptions } from './position-source';
export { createSpeech } from './speech';
export type { Speech, SpeechOptions } from './speech';
export {
  attributionHtml,
  attributionText,
  createClient,
  createNavigator,
  formatDistance,
  formatDistanceShort,
  MapsLibVNError,
  NAVIGATION_THRESHOLDS,
  simulateFixes,
} from '@mapslibvn/core';
export type {
  Announcement,
  AttributionResponse,
  ClientOptions,
  DirectionsLang,
  DirectionsOptions,
  DirectionsResponse,
  GeoFix,
  ManeuverKind,
  MapsLibVNClient,
  NavigationEvents,
  NavigationProgress,
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
  Theme,
  TravelMode,
} from '@mapslibvn/core';
