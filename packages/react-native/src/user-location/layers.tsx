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

/**
 * Bước làm tròn khi dựng bán kính vòng sai số (B3). Không có chúng thì mỗi định vị (1 Hz) sinh một
 * object `paint` mới, MLRN đẩy qua cầu và MapLibre đặt lại thuộc tính vẽ của layer mỗi giây — trong
 * khi bán kính thật gần như không đổi: GPS thường giữ nguyên mức sai số hàng chục giây, còn `lat`
 * chỉ vào công thức qua `cos(lat)`, dịch 0,1° làm bán kính lệch dưới 0,2 %.
 */
const ACCURACY_STEP_M = 1;
const LAT_STEP_DEG = 0.1;

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
  // Làm tròn TRƯỚC khi vào deps: `fix` là object mới mỗi giây, nhưng hai số này đứng yên rất lâu nên
  // `paint` giữ nguyên tham chiếu. Hook phải nằm trên lệnh return sớm bên dưới để thứ tự hook ổn định.
  const accuracyM =
    Math.round((fix?.accuracy_m ?? DEFAULT_USER_ACCURACY_M) / ACCURACY_STEP_M) * ACCURACY_STEP_M;
  const latStep = Math.round((fix?.lat ?? 0) / LAT_STEP_DEG) * LAT_STEP_DEG;
  const accuracyPaint = useMemo(
    () => ({
      'circle-radius': accuracyRadiusExpression(accuracyM, latStep),
      'circle-color': ROUTE_COLOR,
      'circle-opacity': 0.12,
      'circle-stroke-width': 0,
    }),
    [accuracyM, latStep],
  );
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
            paint={accuracyPaint}
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
