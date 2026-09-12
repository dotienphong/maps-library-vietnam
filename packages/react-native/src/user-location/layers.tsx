import {
  type CircleLayerSpecification,
  type FilterSpecification,
  GeoJSONSource,
  Images,
  Layer,
  type SymbolLayerSpecification,
} from '@maplibre/maplibre-react-native';
import { useSyncExternalStore } from 'react';
import { HEADING_CONE_IMAGE_KEY, HEADING_CONE_PNG_DATA_URI } from '../navigation/puck-image';
import { ROUTE_COLOR } from '../navigation/route-layers';
import type { RoutesStore } from '../navigation/routes-store';
import { DEFAULT_USER_ACCURACY_M, accuracyRadiusExpression } from './feature';
import type { UserLocationStore } from './store';

export const USER_LOCATION_SOURCE_ID = 'mapslibvn-user-location';
export const USER_LOCATION_LAYER_IDS = {
  accuracy: 'mapslibvn-user-accuracy',
  cone: 'mapslibvn-user-cone',
  dot: 'mapslibvn-user-dot',
} as const;

const HAS_HEADING: FilterSpecification = ['==', ['get', 'hasHeading'], true];
const CONE_LAYOUT: NonNullable<SymbolLayerSpecification['layout']> = {
  'icon-image': HEADING_CONE_IMAGE_KEY,
  'icon-rotate': ['get', 'bearing'],
  'icon-rotation-alignment': 'map',
  'icon-pitch-alignment': 'map',
  'icon-allow-overlap': true,
  'icon-ignore-placement': true,
  // 0,5 như puck (spec la bàn mục 11): nón bán kính ~15 dp quanh chấm 7 dp. Thực địa thấy nhỏ thì
  // nâng lên 0,75 và ghi vào mục lệch spec.
  'icon-size': 0.5,
};
const CONE_PAINT: NonNullable<SymbolLayerSpecification['paint']> = {
  'icon-opacity': ['case', ['get', 'hasReliableHeading'], 1, 0.45],
};
const DOT_PAINT: NonNullable<CircleLayerSpecification['paint']> = {
  'circle-radius': 7,
  'circle-color': ROUTE_COLOR,
  'circle-stroke-color': '#ffffff',
  'circle-stroke-width': 2.5,
};

interface UserLocationLayersProps {
  store: UserLocationStore;
  /** Có tiến độ dẫn đường → không vẽ (puck dẫn đường thay thế). */
  routesStore: RoutesStore;
  accuracyCircle: boolean;
  /** Chèn trước lớp này; null = trên cùng. */
  beforeId: string | null;
}

/** Chấm xanh + nón hướng + vòng sai số (spec la bàn mục 7). Render bên trong <Map>. */
export function UserLocationLayers({
  store,
  routesStore,
  accuracyCircle,
  beforeId,
}: UserLocationLayersProps) {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const routes = useSyncExternalStore(
    routesStore.subscribe,
    routesStore.getSnapshot,
    routesStore.getSnapshot,
  );
  const fix = snap.fix;
  if (!fix || routes.progress !== null) return null;
  const before = beforeId ? { beforeId } : {};
  return (
    <>
      <Images
        images={{ [HEADING_CONE_IMAGE_KEY]: { source: { uri: HEADING_CONE_PNG_DATA_URI } } }}
      />
      <GeoJSONSource id={USER_LOCATION_SOURCE_ID} data={snap.features as GeoJSON.FeatureCollection}>
        {accuracyCircle ? (
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
        ) : null}
        <Layer
          type="symbol"
          id={USER_LOCATION_LAYER_IDS.cone}
          source={USER_LOCATION_SOURCE_ID}
          filter={HAS_HEADING}
          layout={CONE_LAYOUT}
          paint={CONE_PAINT}
          {...before}
        />
        <Layer
          type="circle"
          id={USER_LOCATION_LAYER_IDS.dot}
          source={USER_LOCATION_SOURCE_ID}
          paint={DOT_PAINT}
          {...before}
        />
      </GeoJSONSource>
    </>
  );
}
