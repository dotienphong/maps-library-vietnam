import { GeoJSONSource, Layer, Marker } from '@maplibre/maplibre-react-native';
import { useMemo, useSyncExternalStore } from 'react';
import type { Animated } from 'react-native';
import { ROUTE_COLOR } from '../navigation/route-layers';
import type { RoutesStore } from '../navigation/routes-store';
import { DEFAULT_USER_ACCURACY_M, accuracyRadiusExpression, userLocationFeature } from './feature';
import { UserLocationPuck } from './puck';
import type { UserLocationStore } from './store';

export const USER_LOCATION_SOURCE_ID = 'mapslibvn-user-location';
/**
 * Chỉ còn vòng sai số là layer MapLibre; chấm + nón là view native trong `<Marker>` (xoay bằng
 * `Animated`, xem `puck.tsx`) nên không có id layer.
 */
export const USER_LOCATION_LAYER_IDS = {
  accuracy: 'mapslibvn-user-accuracy',
} as const;

interface UserLocationLayersProps {
  store: UserLocationStore;
  /** Có tiến độ dẫn đường → không vẽ (puck dẫn đường thay thế). */
  routesStore: RoutesStore;
  accuracyCircle: boolean;
  /** Chèn vòng sai số trước lớp này; null = trên cùng. */
  beforeId: string | null;
  /** Bearing camera hiện hành, map.tsx nuôi từ `onRegionIsChanging` — nón native xoay `heading − bearing`. */
  mapBearing: Animated.Value;
}

/**
 * Chấm xanh + nón hướng + vòng sai số (spec la bàn mục 7, đổi cách vẽ ở 10b). Render bên trong <Map>.
 * Component chỉ re-render theo fix (1 Hz) và tiến độ dẫn đường — KHÔNG theo hướng: hướng đi thẳng vào
 * `Animated` trong puck, source GeoJSON không đổi mỗi mẫu la bàn.
 */
export function UserLocationLayers({
  store,
  routesStore,
  accuracyCircle,
  beforeId,
  mapBearing,
}: UserLocationLayersProps) {
  const fix = useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().fix,
    () => store.getSnapshot().fix,
  );
  const routes = useSyncExternalStore(
    routesStore.subscribe,
    routesStore.getSnapshot,
    routesStore.getSnapshot,
  );
  const features = useMemo(() => (fix ? userLocationFeature(fix, null) : null), [fix]);
  if (!fix || !features || routes.progress !== null) return null;
  const before = beforeId ? { beforeId } : {};
  return (
    <>
      {accuracyCircle ? (
        <GeoJSONSource id={USER_LOCATION_SOURCE_ID} data={features as GeoJSON.FeatureCollection}>
          <Layer
            type="circle"
            id={USER_LOCATION_LAYER_IDS.accuracy}
            source={USER_LOCATION_SOURCE_ID}
            paint={{
              'circle-radius': accuracyRadiusExpression(
                fix.accuracy_m ?? DEFAULT_USER_ACCURACY_M,
                fix.lat,
              ),
              'circle-color': ROUTE_COLOR,
              'circle-opacity': 0.12,
              'circle-stroke-width': 0,
            }}
            {...before}
          />
        </GeoJSONSource>
      ) : null}
      <Marker lngLat={[fix.lng, fix.lat]} anchor="center">
        <UserLocationPuck store={store} mapBearing={mapBearing} />
      </Marker>
    </>
  );
}
