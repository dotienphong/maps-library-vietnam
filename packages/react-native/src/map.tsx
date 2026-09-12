import {
  Camera,
  type CameraRef,
  type MapRef,
  Map as NativeMap,
  type PressEvent,
  type ViewStateChangeEvent,
} from '@maplibre/maplibre-react-native';
import {
  FIRST_SYMBOL_LAYER_ID,
  type Lang,
  POI_LAYER_ID,
  type PoiFeature,
  type PoiSource,
  type Theme,
  createClient,
} from '@mapslibvn/core';
import { type ReactNode, useContext, useEffect, useMemo, useRef } from 'react';
import {
  AppState,
  type NativeSyntheticEvent,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { Attribution } from './attribution';
import { MapContext, type MapHandle } from './context';
import { type FollowOptions, createMapBinding } from './navigation/map-binding';
import { RouteLayers, type RouteStyle } from './navigation/route-layers';
import { createRoutesStore } from './navigation/routes-store';
import {
  type NavigationSession,
  type NavigationSessionOptions,
  createNavigationSession,
} from './navigation/session';
import { toPoiFeature } from './to-poi-feature';
import { isTheme, useResolvedStyle } from './use-style';
import { type UserLocationOptions, createUserLocationBinding } from './user-location/binding';
import { UserLocationLayers } from './user-location/layers';
import { createUserLocationStore } from './user-location/store';

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
  /** Tập nguồn POI cho bản đồ và Places API — mặc định cả ba; đổi sau khi mount tạo lại map. */
  poiSources?: readonly PoiSource[];
  /** Attribution gọn (không có tuỳ chọn tắt) */
  compactAttribution?: boolean;
  /** Bundle id / application id của app → header X-Bundle-Id cho khoá mobile */
  bundleId?: string;
  /** Style của khung View bọc ngoài */
  containerStyle?: StyleProp<ViewStyle>;
  /** Phiên dẫn đường gắn vào map để vẽ tuyến, puck, camera bám; bỏ prop → gỡ và xoá tuyến. */
  navigation?: NavigationSession;
  /** Tuỳ chọn cho phiên mặc định (khi không truyền `navigation`); cần ít nhất `source`. */
  sessionOptions?: Omit<NavigationSessionOptions, 'provider'>;
  /** Camera bám vị trí khi dẫn đường — mặc định true (zoom theo phương tiện, pitch 45). */
  follow?: boolean | FollowOptions;
  /** Vẽ mũi tên vị trí — mặc định true; false để app tự vẽ từ `progress.snapped`. */
  puck?: boolean;
  /** Chấm xanh + nón hướng khi KHÔNG dẫn đường (spec la bàn 5.5). Giữ tham chiếu `source`/`heading` ổn định. */
  userLocation?: UserLocationOptions;
  routeStyle?: RouteStyle;
  /** Chèn tuyến dưới lớp này; mặc định lớp symbol đầu tiên của theme; null = trên cùng. */
  routeBeforeLayerId?: string | null;
  /** Bấm tuyến thay thế. */
  onRouteClick?: (index: number) => void;
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
  poiSources,
  compactAttribution = false,
  bundleId,
  containerStyle,
  navigation,
  sessionOptions,
  follow = true,
  puck = true,
  userLocation,
  routeStyle,
  routeBeforeLayerId,
  onRouteClick,
  onLoad,
  onPoiClick,
  onError,
  testID,
  children,
}: MapsLibVNMapProps) {
  // Hook chỉ đọc khoá chuỗi này, không đọc `poiSources`: `poiSources={['osm']}` inline đổi
  // reference mỗi lần render, để mảng vào deps thì client bị tạo lại liên tục.
  const poiSourcesKey = poiSources?.join(',') ?? '';
  const places = useMemo(
    () =>
      createClient({
        apiKey,
        baseUrl: apiBase,
        ...(bundleId ? { headers: { 'X-Bundle-Id': bundleId } } : {}),
        ...(poiSourcesKey ? { poiSources: poiSourcesKey.split(',') as PoiSource[] } : {}),
      }),
    [apiKey, apiBase, bundleId, poiSourcesKey],
  );
  const native = useRef<MapRef | null>(null);
  const camera = useRef<CameraRef | null>(null);
  const handlers = useRef({ onLoad, onPoiClick, onError, onRouteClick });
  handlers.current = { onLoad, onPoiClick, onError, onRouteClick };
  const sessionOptionsRef = useRef(sessionOptions);
  sessionOptionsRef.current = sessionOptions;

  const store = useMemo(() => createRoutesStore(), []);
  const binding = useMemo(
    () =>
      createMapBinding({
        camera,
        store,
        appState: AppState,
        createDefaultSession: () =>
          createNavigationSession({ provider: places, ...sessionOptionsRef.current }),
      }),
    [places, store],
  );
  useEffect(() => () => binding.dispose(), [binding]);
  useEffect(() => {
    binding.attach(navigation ?? null);
  }, [binding, navigation]);
  // `follow` là object mới mỗi render → so bằng chuỗi để không setFollow liên tục.
  const followKey = JSON.stringify(follow);
  useEffect(() => {
    binding.setFollow(JSON.parse(followKey) as boolean | FollowOptions);
  }, [binding, followKey]);
  useEffect(() => {
    store.setPuck(puck);
  }, [store, puck]);

  const userStore = useMemo(() => createUserLocationStore(), []);
  const userBinding = useMemo(
    () =>
      createUserLocationBinding({
        camera,
        store: userStore,
        routesStore: store,
        appState: AppState,
      }),
    [userStore, store],
  );
  useEffect(() => () => userBinding.dispose(), [userBinding]);
  // Chỉ theo tham chiếu source/heading và các giá trị nguyên thuỷ — object `userLocation` inline đổi
  // mỗi render, đưa cả object vào deps sẽ đăng ký lại nguồn liên tục.
  const userSource = userLocation?.source;
  const userHeading = userLocation?.heading;
  const userFollow = userLocation?.follow;
  const userZoom = userLocation?.zoom;
  useEffect(() => {
    userBinding.setOptions(
      userSource
        ? {
            source: userSource,
            ...(userHeading ? { heading: userHeading } : {}),
            ...(userFollow ? { follow: userFollow } : {}),
            ...(userZoom !== undefined ? { zoom: userZoom } : {}),
          }
        : null,
    );
  }, [userBinding, userSource, userHeading, userFollow, userZoom]);

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
      routes: {
        show: (response, opts) => store.show(response, opts ?? {}),
        setActive: (index) => store.setActive(index),
        clear: () => store.clear(),
      },
      navigation: binding.api,
      userLocation: userBinding.api,
    }),
    [places, store, binding, userBinding],
  );

  const resolved = useResolvedStyle(places, { style, lang, poiLayer });
  useEffect(() => {
    if (resolved.status === 'error') handlers.current.onError?.(resolved.error);
  }, [resolved]);

  // Đổi một trong các giá trị này → tạo lại map (như @mapslibvn/react); onLoad gọi lại một lần.
  const mapKey = `${apiKey}|${apiBase}|${style}|${lang}|${poiLayer}|${poiSourcesKey}`;
  const loadedFor = useRef<string | null>(null);

  const onPress = async (e: NativeSyntheticEvent<PressEvent>) => {
    if (!poiLayer || !handlers.current.onPoiClick) return;
    const features = await native.current?.queryRenderedFeatures(e.nativeEvent.point, {
      layers: [POI_LAYER_ID],
    });
    const poi = toPoiFeature(features?.[0]);
    if (poi) handlers.current.onPoiClick?.(poi);
  };
  const onRegionWillChange = (e: NativeSyntheticEvent<ViewStateChangeEvent>): void => {
    if (!e.nativeEvent.userInteraction) return;
    binding.userGesture();
    userBinding.userGesture();
  };
  const beforeId =
    routeBeforeLayerId === undefined
      ? isTheme(style)
        ? FIRST_SYMBOL_LAYER_ID[style]
        : null
      : routeBeforeLayerId;

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
          onRegionWillChange={onRegionWillChange}
          onDidFinishLoadingStyle={() => {
            if (loadedFor.current === mapKey) return;
            loadedFor.current = mapKey;
            handlers.current.onLoad?.(handle);
          }}
          onDidFailLoadingMap={() => handlers.current.onError?.(new Error('Không tải được bản đồ'))}
        >
          <Camera ref={camera} initialViewState={{ center, zoom }} />
          <MapContext.Provider value={handle}>
            <RouteLayers
              store={store}
              routeStyle={routeStyle}
              beforeId={beforeId}
              onRouteClick={(index) => handlers.current.onRouteClick?.(index)}
            />
            <UserLocationLayers
              store={userStore}
              routesStore={store}
              accuracyCircle={userLocation?.accuracyCircle ?? true}
              beforeId={beforeId}
            />
            {children}
          </MapContext.Provider>
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
