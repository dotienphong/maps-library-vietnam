import type { CircleLayerSpecification } from '@maplibre/maplibre-react-native';
import type { GeoFix, HeadingFix } from '@mapslibvn/core';

export interface UserLocationProperties {
  kind: 'user';
  /** Độ so với bắc; 0 khi chưa có hướng. */
  bearing: number;
  hasHeading: boolean;
  /** false khi hướng là 'unreliable' → nón vẽ mờ, camera không xoay. */
  hasReliableHeading: boolean;
  accuracy_m: number;
}
export interface UserLocationFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: UserLocationProperties;
}
export interface UserLocationCollection {
  type: 'FeatureCollection';
  features: UserLocationFeature[];
}

export const EMPTY_USER_LOCATION: UserLocationCollection = { type: 'FeatureCollection', features: [] };
/** Sai số dùng khi fix không có accuracy_m — cùng giá trị mặc định của navigator core. */
export const DEFAULT_USER_ACCURACY_M = 10;

/** Feature Point cho chấm xanh (spec la bàn mục 7). Không đột biến đầu vào. */
export function userLocationFeature(fix: GeoFix, heading: HeadingFix | null): UserLocationCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [fix.lng, fix.lat] },
        properties: {
          kind: 'user',
          bearing: heading?.heading ?? 0,
          hasHeading: heading !== null,
          hasReliableHeading: heading !== null && heading.accuracy !== 'unreliable',
          accuracy_m: fix.accuracy_m ?? DEFAULT_USER_ACCURACY_M,
        },
      },
    ],
  };
}

const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
/** Mét trên một pixel ở vĩ độ `lat`, zoom `zoom` — Web Mercator với tile 512 px của MapLibre. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
}

type CircleRadius = NonNullable<CircleLayerSpecification['paint']>['circle-radius'];

/**
 * `circle-radius` (px) để vòng có bán kính `accuracy_m` thật ở mọi zoom: interpolate exponential
 * base 2 giữa zoom 0 và 24 đúng bằng cách m/px giảm nửa mỗi zoom.
 */
export function accuracyRadiusExpression(accuracy_m: number, lat: number): CircleRadius {
  return [
    'interpolate',
    ['exponential', 2],
    ['zoom'],
    0,
    accuracy_m / metersPerPixel(lat, 0),
    24,
    accuracy_m / metersPerPixel(lat, 24),
  ];
}
