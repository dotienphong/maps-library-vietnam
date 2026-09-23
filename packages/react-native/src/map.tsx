import {
  Camera,
  type CameraRef,
  type LngLatBounds,
  type MapRef,
  Map as NativeMap,
  OfflineManager,
  type PressEvent,
  type StyleSpecification,
  type ViewStateChangeEvent,
} from '@maplibre/maplibre-react-native';
import {
  createClient,
  FIRST_SYMBOL_LAYER_ID,
  type Lang,
  POI_LAYER_ID,
  type PoiFeature,
  type PoiSource,
  type QuotaReceiptStore,
  type Theme,
} from '@mapslibvn/core';
import { type ReactNode, useContext, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  AppState,
  type NativeSyntheticEvent,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { Attribution } from './attribution';
import { MapContext, type MapHandle } from './context';
import { createMapBinding, type FollowOptions } from './navigation/map-binding';
import { RouteLayers, type RouteStyle } from './navigation/route-layers';
import { createRoutesStore } from './navigation/routes-store';
import {
  createNavigationSession,
  type NavigationSession,
  type NavigationSessionOptions,
} from './navigation/session';
import { useFlushReceiptsOnBackground } from './receipt-flush';
import { toPoiFeature } from './to-poi-feature';
import { isTheme, styleUrlFor, useResolvedStyle } from './use-style';
import { createUserLocationBinding, type UserLocationOptions } from './user-location/binding';
import { UserLocationLayers } from './user-location/layers';
import { createUserLocationStore } from './user-location/store';

export const DEFAULT_CENTER: [number, number] = [106.7, 10.776];
export const DEFAULT_ZOOM = 12;

/**
 * Nửa cạnh ô vuông (px) quanh điểm chạm khi tìm POI. `queryRenderedFeatures` tại ĐÚNG một điểm thì
 * lệch ~10 px là trượt — ngón tay thật không bấm chính xác tới từng pixel (DEVLOG mục 11).
 */
export const POI_TOUCH_RADIUS_PX = 12;

/** Tuỳ chọn tải trước tile quanh vị trí khởi tạo (A4). Mặc định TẮT — có tải là có tốn dữ liệu. */
export interface PrefetchOptions {
  /** Bán kính quanh `center`, km — mặc định 2. */
  radiusKm?: number;
  /** Zoom thấp nhất tải trước — mặc định 12. */
  minZoom?: number;
  /** Zoom cao nhất tải trước — mặc định 15. Cao hơn là số tile tăng theo cấp số nhân. */
  maxZoom?: number;
}

const PREFETCH_DEFAULTS = { radiusKm: 2, minZoom: 12, maxZoom: 15 } as const;
/** Khoá metadata đánh dấu pack do SDK tạo, để không tạo trùng mỗi lần mount. */
const PREFETCH_TAG_KEY = 'mapslibvnPrefetch';
const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LNG_AT_EQUATOR = 111.32;

/** Hộp bao quanh `center` bán kính `radiusKm`, theo thứ tự [tây, nam, đông, bắc] của MLRN. */
export function prefetchBounds(center: readonly [number, number], radiusKm: number): LngLatBounds {
  const [lng, lat] = center;
  const dLat = radiusKm / KM_PER_DEG_LAT;
  // Kẹp cos để không chia cho ~0 ở vĩ độ cực; Việt Nam không chạm tới nhưng prop này ai cũng dùng được.
  const cos = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
  const dLng = radiusKm / (KM_PER_DEG_LNG_AT_EQUATOR * cos);
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
}

export interface MapsLibVNMapProps {
  apiKey: string;
  /** Gốc API MapsLibVN, ví dụ https://api.ai-solutions.io.vn */
  apiBase: string;
  /** Theme 'light' | 'dark' hoặc URL style tuỳ biến — giống @mapslibvn/react. */
  style?: Theme | string;
  /**
   * Style JSON app tự đóng gói sẵn: bản đồ vẽ được ngay khi mở, không chờ một vòng HTTP lấy style.
   * Vẫn áp `lang`/`poiLayer` như style tải từ server. `style` khi đó chỉ còn dùng để chọn lớp chèn
   * tuyến mặc định và (nếu bật `prefetch`) để biết URL style cần tải tile.
   */
  styleJson?: StyleSpecification;
  /**
   * Tải trước tile quanh `center` để lần mở đầu không phải chờ kéo tile. `true` = mặc định
   * (bán kính 2 km, zoom 12–15). TẮT mặc định: tải trước là tốn dữ liệu và dung lượng máy người
   * dùng, phải do app chủ động chọn. Dùng offline pack của MapLibre; gọi lại nhiều lần không tạo
   * trùng pack.
   */
  prefetch?: PrefetchOptions | boolean;
  /** Giá trị KHỞI TẠO camera; đổi sau khi mount không tạo lại map — dùng useMap().flyTo. */
  center?: [number, number];
  zoom?: number;
  lang?: Lang;
  /** Hiển thị lớp POI — mặc định true */
  poiLayer?: boolean;
  /** Tập nguồn POI cho bản đồ và Places API — mặc định cả hai (`osm` + `fsq`); đổi sau khi mount
   * tạo lại map. */
  poiSources?: readonly PoiSource[];
  /** Attribution gọn (không có tuỳ chọn tắt) */
  compactAttribution?: boolean;
  /** Kho lưu receipt quota bền vững. React Native không có `localStorage` nên mặc định chỉ giữ
   * trong RAM và mất khi app khởi động lại — mỗi receipt mất là một lần thiếu ACK. Nên truyền:
   * `receiptStore={createReceiptStore(AsyncStorage)}` (`createReceiptStore` xuất từ gói này). */
  receiptStore?: QuotaReceiptStore;
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
  styleJson,
  prefetch,
  center = DEFAULT_CENTER,
  zoom = DEFAULT_ZOOM,
  lang = 'vi',
  poiLayer = true,
  poiSources,
  compactAttribution = false,
  receiptStore,
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
        ...(receiptStore ? { receiptStore } : {}),
      }),
    [apiKey, apiBase, bundleId, poiSourcesKey, receiptStore],
  );
  // Receipt cuối cùng của mỗi phiên thường chưa kịp ACK thì người dùng đã thoát app; ba lần như
  // vậy trong 24 giờ là máy chủ khoá tenant bằng `ack_required`.
  useFlushReceiptsOnBackground(places);

  const native = useRef<MapRef | null>(null);
  const camera = useRef<CameraRef | null>(null);
  // Bearing camera cho nón hướng native (puck.tsx): nuôi từ onRegionIsChanging mỗi khung hình khi camera
  // xoay, setValue đi thẳng vào native driver — không re-render.
  const mapBearing = useRef(new Animated.Value(0)).current;
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
        showFleet: (plan, opts) => store.showFleet(plan, opts ?? {}),
        setActive: (index) => store.setActive(index),
        clear: () => store.clear(),
      },
      navigation: binding.api,
      userLocation: userBinding.api,
    }),
    [places, store, binding, userBinding],
  );

  const resolved = useResolvedStyle(places, {
    style,
    lang,
    poiLayer,
    ...(styleJson ? { styleJson } : {}),
  });
  useEffect(() => {
    if (resolved.status === 'error') handlers.current.onError?.(resolved.error);
  }, [resolved]);

  // Tải trước tile quanh vị trí khởi tạo (A4). Chỉ chạy khi app bật `prefetch`; lấy URL style vì
  // offline pack cần URL, kể cả khi app dùng `styleJson`. Lỗi báo qua onError, không ném ra ngoài:
  // tải trước hỏng thì bản đồ vẫn phải chạy bình thường.
  // `prefetch`/`center` là object/mảng inline phía app → đổi tham chiếu mỗi render. Đọc lại từ chuỗi
  // ngay trong effect (cùng lối với `followKey` ở trên) để deps chỉ còn giá trị nguyên thuỷ.
  const prefetchKey = JSON.stringify(prefetch ?? null);
  const centerKey = JSON.stringify(center);
  useEffect(() => {
    const want = JSON.parse(prefetchKey) as PrefetchOptions | boolean | null;
    if (!want) return;
    const o = want === true ? PREFETCH_DEFAULTS : { ...PREFETCH_DEFAULTS, ...want };
    const mapStyle = styleUrlFor(places, style);
    const bounds = prefetchBounds(JSON.parse(centerKey) as [number, number], o.radiusKm);
    const tag = `${mapStyle}|${bounds.join(',')}|${o.minZoom}-${o.maxZoom}`;
    let cancelled = false;
    (async () => {
      try {
        const packs = await OfflineManager.getPacks();
        if (cancelled) return;
        if (packs.some((p) => p.metadata[PREFETCH_TAG_KEY] === tag)) return;
        await OfflineManager.createPack(
          {
            mapStyle,
            bounds,
            minZoom: o.minZoom,
            maxZoom: o.maxZoom,
            metadata: { [PREFETCH_TAG_KEY]: tag },
          },
          () => undefined,
          (_pack, error) => handlers.current.onError?.(new Error(error.message)),
        );
      } catch (cause) {
        if (!cancelled) {
          handlers.current.onError?.(
            cause instanceof Error ? cause : new Error('Không tải trước được tile'),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [prefetchKey, centerKey, places, style]);

  // Đổi `apiKey`/`apiBase`/`poiSources` → tạo lại map (client đổi theo). `style`/`lang`/`poiLayer`
  // KHÔNG nằm ở đây (A3): đổi sáng↔tối chỉ cần đẩy `mapStyle` mới, dựng lại cả map native là màn
  // hình trắng rồi tải lại style + tile từ đầu. Đánh đổi: `onLoad` chỉ gọi một lần cho mỗi map,
  // không gọi lại sau khi đổi theme — đúng ngữ nghĩa "map đã sẵn sàng".
  const mapKey = `${apiKey}|${apiBase}|${poiSourcesKey}`;
  const loadedFor = useRef<string | null>(null);

  const onPress = async (e: NativeSyntheticEvent<PressEvent>) => {
    if (!poiLayer || !handlers.current.onPoiClick) return;
    // Ô vuông quanh điểm chạm thay vì đúng một điểm (B2) — chạm lệch vài pixel vẫn trúng POI.
    const [x, y] = e.nativeEvent.point;
    const r = POI_TOUCH_RADIUS_PX;
    const features = await native.current?.queryRenderedFeatures(
      [
        [x - r, y - r],
        [x + r, y + r],
      ],
      { layers: [POI_LAYER_ID] },
    );
    const poi = toPoiFeature(features?.[0]);
    if (poi) handlers.current.onPoiClick?.(poi);
  };
  const onRegionWillChange = (e: NativeSyntheticEvent<ViewStateChangeEvent>): void => {
    if (!e.nativeEvent.userInteraction) return;
    binding.userGesture();
    userBinding.userGesture();
  };
  const onRegionChanging = (e: NativeSyntheticEvent<ViewStateChangeEvent>): void => {
    const b = e.nativeEvent.bearing;
    if (Number.isFinite(b)) mapBearing.setValue(b);
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
          // Tắt nút "i" native: hộp thoại của nó đọc metadata PMTiles nên thiếu © MapsLibVN và
          // Foursquare. Ghi nguồn đủ bốn nguồn do <Attribution> bên dưới vẽ và mở danh sách.
          attribution={false}
          logo={false}
          onPress={onPress}
          onRegionWillChange={onRegionWillChange}
          onRegionIsChanging={onRegionChanging}
          onRegionDidChange={onRegionChanging}
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
              mapBearing={mapBearing}
            />
            {children}
          </MapContext.Provider>
        </NativeMap>
      ) : null}
      <Attribution compact={compactAttribution} />
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
