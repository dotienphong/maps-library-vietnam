import {
  Camera,
  type CameraRef,
  type MapRef,
  Map as NativeMap,
  type PressEvent,
} from '@maplibre/maplibre-react-native';
import {
  type Lang,
  POI_LAYER_ID,
  type PoiFeature,
  type Theme,
  createClient,
} from '@mapslibvn/core';
import { type ReactNode, useContext, useEffect, useMemo, useRef } from 'react';
import {
  type NativeSyntheticEvent,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { Attribution } from './attribution';
import { MapContext, type MapHandle } from './context';
import { toPoiFeature } from './to-poi-feature';
import { useResolvedStyle } from './use-style';

export const DEFAULT_CENTER: [number, number] = [106.7, 10.776];
export const DEFAULT_ZOOM = 12;

export interface MapsLibVNMapProps {
  apiKey: string;
  /** Gốc API MapsLibVN, ví dụ https://api.ai-solutions.io.vn */
  apiBase: string;
  /** Theme 'light' | 'dark' hoặc URL style tuỳ biến — giống @mapslibvn/react. */
  style?: Theme | string;
  /** Giá trị KHỞI TẠO camera; đổi sau khi mount không tạo lại map — dùng useMap().flyTo. */
  center?: [number, number];
  zoom?: number;
  lang?: Lang;
  /** Hiển thị lớp POI — mặc định true */
  poiLayer?: boolean;
  /** Attribution gọn (không có tuỳ chọn tắt) */
  compactAttribution?: boolean;
  /** Bundle id / application id của app → header X-Bundle-Id cho khoá mobile */
  bundleId?: string;
  /** Style của khung View bọc ngoài */
  containerStyle?: StyleProp<ViewStyle>;
  onLoad?: (map: MapHandle) => void;
  onPoiClick?: (poi: PoiFeature) => void;
  onError?: (error: Error) => void;
  testID?: string;
  children?: ReactNode;
}

export function MapsLibVNMap({
  apiKey,
  apiBase,
  style = 'light',
  center = DEFAULT_CENTER,
  zoom = DEFAULT_ZOOM,
  lang = 'vi',
  poiLayer = true,
  compactAttribution = false,
  bundleId,
  containerStyle,
  onLoad,
  onPoiClick,
  onError,
  testID,
  children,
}: MapsLibVNMapProps) {
  const places = useMemo(
    () =>
      createClient({
        apiKey,
        baseUrl: apiBase,
        ...(bundleId ? { headers: { 'X-Bundle-Id': bundleId } } : {}),
      }),
    [apiKey, apiBase, bundleId],
  );
  const native = useRef<MapRef | null>(null);
  const camera = useRef<CameraRef | null>(null);
  const handlers = useRef({ onLoad, onPoiClick, onError });
  handlers.current = { onLoad, onPoiClick, onError };

  const handle = useMemo<MapHandle>(
    () => ({
      native,
      camera,
      places,
      flyTo(c, z) {
        camera.current?.flyTo(z === undefined ? { center: c } : { center: c, zoom: z });
      },
      fitBounds(bbox, padding = 40) {
        camera.current?.fitBounds(bbox, {
          padding: { top: padding, right: padding, bottom: padding, left: padding },
        });
      },
      async getBounds() {
        const b = await native.current?.getBounds();
        if (!b) throw new Error('Bản đồ chưa sẵn sàng');
        return b;
      },
    }),
    [places],
  );

  const resolved = useResolvedStyle(places, { style, lang, poiLayer });
  useEffect(() => {
    if (resolved.status === 'error') handlers.current.onError?.(resolved.error);
  }, [resolved]);

  // Đổi một trong các giá trị này → tạo lại map (như @mapslibvn/react); onLoad gọi lại một lần.
  const mapKey = `${apiKey}|${apiBase}|${style}|${lang}|${poiLayer}`;
  const loadedFor = useRef<string | null>(null);

  const onPress = async (e: NativeSyntheticEvent<PressEvent>) => {
    if (!poiLayer || !handlers.current.onPoiClick) return;
    const features = await native.current?.queryRenderedFeatures(e.nativeEvent.point, {
      layers: [POI_LAYER_ID],
    });
    const poi = toPoiFeature(features?.[0]);
    if (poi) handlers.current.onPoiClick?.(poi);
  };

  return (
    <View style={[styles.container, containerStyle]} {...(testID ? { testID } : {})}>
      {resolved.status === 'ready' ? (
        <NativeMap
          key={mapKey}
          ref={native}
          style={styles.map}
          mapStyle={resolved.mapStyle}
          attribution
          attributionPosition={{ bottom: 8, right: 8 }}
          logo={false}
          onPress={onPress}
          onDidFinishLoadingStyle={() => {
            if (loadedFor.current === mapKey) return;
            loadedFor.current = mapKey;
            handlers.current.onLoad?.(handle);
          }}
          onDidFailLoadingMap={() => handlers.current.onError?.(new Error('Không tải được bản đồ'))}
        >
          <Camera ref={camera} initialViewState={{ center, zoom }} />
          <MapContext.Provider value={handle}>{children}</MapContext.Provider>
        </NativeMap>
      ) : null}
      <Attribution
        compact={compactAttribution}
        onPress={() => {
          void native.current?.showAttribution();
        }}
      />
    </View>
  );
}

/** Map hiện hành — chỉ dùng bên trong <MapsLibVNMap>. */
export function useMap(): MapHandle {
  const map = useContext(MapContext);
  if (!map) throw new Error('useMap phải được gọi bên trong <MapsLibVNMap>');
  return map;
}

const styles = StyleSheet.create({
  container: { flex: 1, position: 'relative' },
  map: { flex: 1 },
});
