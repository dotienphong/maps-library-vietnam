import {
  type FilterSpecification,
  GeoJSONSource,
  Images,
  Layer,
  type LineLayerSpecification,
  type PressEventWithFeatures,
  type SymbolLayerSpecification,
} from '@maplibre/maplibre-react-native';
import { useSyncExternalStore } from 'react';
import type { NativeSyntheticEvent } from 'react-native';
import { Marker } from '../marker';
import { PUCK_IMAGE_KEY, PUCK_PNG_DATA_URI } from './puck-image';
import type { RoutesStore } from './routes-store';

export const ROUTE_SOURCE_ID = 'mapslibvn-route';
/**
 * Source riêng cho tuyến thay thế (B1). Tách khỏi `ROUTE_SOURCE_ID` vì dữ liệu của nó chỉ đổi khi
 * đổi tập tuyến / tuyến đang chọn, còn source chính đổi mỗi lần định vị: gộp chung thì mỗi giây
 * phải đẩy cả tuyến thay thế qua cầu native rồi bắt MapLibre dựng lại tile của chúng.
 */
export const ROUTE_ALT_SOURCE_ID = 'mapslibvn-route-alt-source';
export const ROUTE_LAYER_IDS = {
  alt: 'mapslibvn-route-alt',
  casing: 'mapslibvn-route-casing',
  line: 'mapslibvn-route-line',
  traveled: 'mapslibvn-route-traveled',
  puck: 'mapslibvn-route-puck',
} as const;
export const ROUTE_COLOR = '#2458a6';
export const ALT_ROUTE_COLOR = '#9ca8ba';
export const DESTINATION_COLOR = '#d92d20';

export interface RouteStyle {
  /** Tuyến chính và phần đã đi — mặc định #2458a6. */
  color?: string;
  /** Tuyến thay thế — mặc định #9ca8ba. */
  altColor?: string;
  /** Viền tuyến chính — mặc định trắng. */
  casingColor?: string;
  /** Độ mờ phần đã đi — mặc định 0,35. */
  traveledOpacity?: number;
}

interface RouteLayersProps {
  store: RoutesStore;
  routeStyle?: RouteStyle | undefined;
  /** Chèn các layer line trước lớp này; null = trên cùng. Puck luôn trên cùng. */
  beforeId: string | null;
  onRouteClick?: ((index: number) => void) | undefined;
}

const kindIs = (kind: string): FilterSpecification => ['==', ['get', 'kind'], kind];
const ROUND: NonNullable<LineLayerSpecification['layout']> = {
  'line-join': 'round',
  'line-cap': 'round',
};
const PUCK_LAYOUT: NonNullable<SymbolLayerSpecification['layout']> = {
  'icon-image': PUCK_IMAGE_KEY,
  'icon-rotate': ['get', 'bearing'],
  'icon-rotation-alignment': 'map',
  'icon-pitch-alignment': 'map',
  'icon-allow-overlap': true,
  'icon-ignore-placement': true,
  'icon-size': 0.5,
};

/** Source + layer tuyến và puck đọc từ RoutesStore. Render bên trong <Map> và trong MapContext. */
export function RouteLayers({ store, routeStyle, beforeId, onRouteClick }: RouteLayersProps) {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  if (!snap.response) return null;
  const color = routeStyle?.color ?? ROUTE_COLOR;
  const altColor = routeStyle?.altColor ?? ALT_ROUTE_COLOR;
  const casingColor = routeStyle?.casingColor ?? '#ffffff';
  const traveledOpacity = routeStyle?.traveledOpacity ?? 0.35;
  const before = beforeId ? { beforeId } : {};
  const onPress = (e: NativeSyntheticEvent<PressEventWithFeatures>): void => {
    const alt = e.nativeEvent.features.find((f) => f.properties?.kind === 'alt');
    const index: unknown = alt?.properties?.index;
    if (typeof index === 'number') onRouteClick?.(index);
  };
  const waypoints = snap.response.waypoints;
  const last = waypoints.length - 1;
  return (
    <>
      <Images images={{ [PUCK_IMAGE_KEY]: { source: { uri: PUCK_PNG_DATA_URI } } }} />
      <GeoJSONSource
        id={ROUTE_ALT_SOURCE_ID}
        data={snap.altFeatures as GeoJSON.FeatureCollection}
        onPress={onPress}
      >
        <Layer
          type="line"
          id={ROUTE_LAYER_IDS.alt}
          source={ROUTE_ALT_SOURCE_ID}
          filter={kindIs('alt')}
          layout={ROUND}
          paint={{ 'line-color': altColor, 'line-width': 5 }}
          {...before}
        />
      </GeoJSONSource>
      <GeoJSONSource id={ROUTE_SOURCE_ID} data={snap.liveFeatures as GeoJSON.FeatureCollection}>
        <Layer
          type="line"
          id={ROUTE_LAYER_IDS.casing}
          source={ROUTE_SOURCE_ID}
          filter={kindIs('active')}
          layout={ROUND}
          paint={{ 'line-color': casingColor, 'line-width': 9 }}
          {...before}
        />
        <Layer
          type="line"
          id={ROUTE_LAYER_IDS.line}
          source={ROUTE_SOURCE_ID}
          filter={kindIs('active')}
          layout={ROUND}
          paint={{ 'line-color': color, 'line-width': 6 }}
          {...before}
        />
        <Layer
          type="line"
          id={ROUTE_LAYER_IDS.traveled}
          source={ROUTE_SOURCE_ID}
          filter={kindIs('traveled')}
          layout={ROUND}
          paint={{ 'line-color': color, 'line-width': 6, 'line-opacity': traveledOpacity }}
          {...before}
        />
        {snap.puck ? (
          <Layer
            type="symbol"
            id={ROUTE_LAYER_IDS.puck}
            source={ROUTE_SOURCE_ID}
            filter={kindIs('puck')}
            layout={PUCK_LAYOUT}
          />
        ) : null}
      </GeoJSONSource>
      {waypoints.map((w, i) =>
        i === 0 ? null : (
          <Marker
            // Waypoint định danh THEO vị trí trong tuyến nên index là phần của định danh; toạ độ đã
            // nằm trong key để phân biệt khi trùng chỉ số.
            // biome-ignore lint/suspicious/noArrayIndexKey: xem ngay trên
            key={`${i}-${w.snapped[0]}-${w.snapped[1]}`}
            lng={w.snapped[0]}
            lat={w.snapped[1]}
            color={i === last ? DESTINATION_COLOR : ALT_ROUTE_COLOR}
            testID="mapslibvn-route-marker"
          />
        ),
      )}
    </>
  );
}
