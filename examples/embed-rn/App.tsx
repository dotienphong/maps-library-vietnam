import {
  type AutocompleteItem,
  type DirectionsResponse,
  type Lang,
  type MapHandle,
  type MapsLibVNClient,
  MapsLibVNMap,
  Marker,
  type NavigationSession,
  type Theme,
  type TravelMode,
  createClient,
  createNavigationSession,
  playbackSource,
  simulateFixes,
  usePlaces,
} from '@mapslibvn/react-native';
import {
  expoAudioSession,
  expoHeadingSource,
  expoKeepAwake,
  expoLocationSource,
  expoNavigation,
  expoSpeech,
} from '@mapslibvn/react-native/expo';
import * as Application from 'expo-application';
import * as Location from 'expo-location';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Keyboard,
  LogBox,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MODES, NavigationPanel } from './navigation-ui';

const API_KEY = process.env.EXPO_PUBLIC_MAPSLIBVN_KEY ?? '';
const API_BASE = process.env.EXPO_PUBLIC_MAPSLIBVN_API ?? 'https://api.ai-solutions.io.vn';
const BUNDLE_ID = Application.applicationId ?? undefined;

// Cảnh báo của MapLibre Native về vài đoạn line trong tile (dữ liệu, không phải code app).
LogBox.ignoreLogs(['Invalid geometry in line layer']);

// Client và phiên GPS thật sống ở cấp module: đổi màn hình, popup đè lên bản đồ không dừng dẫn đường.
const client: MapsLibVNClient = createClient({
  apiKey: API_KEY,
  baseUrl: API_BASE,
  ...(BUNDLE_ID ? { headers: { 'X-Bundle-Id': BUNDLE_ID } } : {}),
});
const realSession = createNavigationSession({
  provider: client,
  ...expoNavigation({ notification: { title: 'MapsLibVN Demo đang dẫn đường' } }),
});
// Nguồn hướng và vị trí tiền cảnh cho chấm xanh — cấp module để tham chiếu ổn định (SDK chỉ đăng ký
// lại nguồn khi tham chiếu đổi). realSession đã kèm heading qua expoNavigation() mặc định.
const headingSource = expoHeadingSource();
const foregroundSource = expoLocationSource({ background: false });

type Point = { name: string; lng: number; lat: number };

/** Quận 1 — dùng khi simulator/emulator không có GPS hoặc trả vị trí ngoài Việt Nam. */
const FALLBACK_ORIGIN: [number, number] = [106.699, 10.7798];
const inVietnam = ([lng, lat]: [number, number]) => lng > 102 && lng < 110 && lat > 8 && lat < 24;

/** Ô tìm kiếm + gợi ý — nằm ngoài <MapsLibVNMap> nên truyền client tường minh. */
function Search({ near, onPick }: { near: [number, number]; onPick: (p: Point) => void }) {
  const [q, setQ] = useState('');
  const { items, loading } = usePlaces(q, { near, limit: 6, client });
  return (
    <View style={styles.search}>
      <TextInput
        style={styles.input}
        placeholder="Điểm đến: tên đường, địa điểm…"
        value={q}
        onChangeText={setQ}
        autoCorrect={false}
        testID="search-input"
      />
      {q.trim().length >= 2 && (
        <FlatList
          style={styles.list}
          keyboardShouldPersistTaps="handled"
          data={items}
          keyExtractor={(it: AutocompleteItem, i) => it.id ?? `${it.type}-${i}`}
          ListEmptyComponent={
            <Text style={styles.hint}>{loading ? 'Đang tìm…' : 'Không có gợi ý'}</Text>
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => {
                setQ('');
                Keyboard.dismiss();
                onPick({ name: item.name, lng: item.lng, lat: item.lat });
              }}
            >
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.secondary}>{item.secondary}</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

export default function App() {
  const [theme, setTheme] = useState<Theme>('light');
  const [lang, setLang] = useState<Lang>('vi');
  const [map, setMap] = useState<MapHandle | null>(null);
  const [origin, setOrigin] = useState<[number, number] | null>(null); // [lng, lat]
  const [dest, setDest] = useState<Point | null>(null);
  const [mode, setMode] = useState<TravelMode>('motorbike');
  const [response, setResponse] = useState<DirectionsResponse | null>(null);
  const [active, setActive] = useState(0);
  const [session, setSession] = useState<NavigationSession>(realSession);
  const [navigating, setNavigating] = useState<false | 'real' | 'sim'>(false);
  const [compass, setCompass] = useState(false); // bản đồ xoay theo hướng nhìn
  const [userFollowing, setUserFollowing] = useState(false);

  // Theo dõi bám chấm xanh để hiện nút "Về tôi" khi người dùng đã kéo bản đồ. `compass` không đọc
  // trong thân hàm nhưng vẫn cần trong deps: đổi follow mode khiến binding tự đặt lại wantFollow=true
  // mà không phát followChange (xem createUserLocationBinding.setOptions) — phải re-run để đồng bộ.
  // biome-ignore lint/correctness/useExhaustiveDependencies: xem chú thích trên
  useEffect(() => {
    if (!map) return;
    const onChange = (f: boolean) => setUserFollowing(f);
    map.userLocation.on('followChange', onChange);
    setUserFollowing(map.userLocation.following);
    return () => map.userLocation.off('followChange', onChange);
  }, [map, compass]);

  // Vị trí hiện tại lúc mở app → bay tới; xin quyền một lần ở đây, SDK dùng lại khi start().
  // Lấy vị trí đã biết trước (trả ngay), rồi mới xin vị trí mới — getCurrentPositionAsync có thể
  // chờ lâu trên emulator hoặc trong nhà.
  useEffect(() => {
    const use = (lng: number, lat: number) =>
      setOrigin(inVietnam([lng, lat]) ? [lng, lat] : FALLBACK_ORIGIN);
    // Simulator/emulator không có GPS: sau 8 giây chưa có fix thì dùng Quận 1 để vẫn thử được.
    const timer = setTimeout(() => setOrigin((o) => o ?? FALLBACK_ORIGIN), 8000);
    (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return;
      const last = await Location.getLastKnownPositionAsync().catch(() => null);
      if (last) use(last.coords.longitude, last.coords.latitude);
      const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      use(p.coords.longitude, p.coords.latitude);
    })().catch(() => {});
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (map && origin) map.flyTo(origin, 15);
  }, [map, origin]);

  // Đủ hai điểm → tự tính tuyến; đổi phương tiện hay điểm đến → tính lại.
  useEffect(() => {
    if (!origin || !dest || navigating) return;
    let cancelled = false;
    client
      .directions({
        from: [origin[1], origin[0]],
        to: [dest.lat, dest.lng],
        mode,
        alternatives: true,
      })
      .then((r) => {
        if (cancelled) return;
        setResponse(r);
        setActive(0);
        map?.routes.show(r, { active: 0 });
        const bbox = r.routes[0]?.bbox;
        if (bbox) map?.fitBounds(bbox, 60);
      })
      .catch((e: unknown) =>
        Alert.alert('Không tính được tuyến', e instanceof Error ? e.message : ''),
      );
    return () => {
      cancelled = true;
    };
  }, [origin, dest, mode, map, navigating]);

  const start = useCallback(
    async (kind: 'real' | 'sim') => {
      if (!response) return;
      const route = response.routes[active];
      if (!route) return;
      const s =
        kind === 'real'
          ? realSession
          : createNavigationSession({
              provider: client,
              source: playbackSource(simulateFixes(route, { jitter_m: 4 }), { rate: 4 }),
              speech: expoSpeech(),
              keepAwake: expoKeepAwake(),
              // Giả lập vẫn cần audio: thiếu bước kích hoạt AVAudioSession + giữ phiên là lý do
              // giọng đọc im lặng hoàn toàn khi khoá màn hình (phát hiện thực địa 12/09/2026).
              audio: expoAudioSession(),
            });
      if (s !== session) await session.stop();
      setSession(s);
      setNavigating(kind);
      await s.start({ response, routeIndex: active, lang });
    },
    [response, active, session, lang],
  );
  const stop = useCallback(async () => {
    await session.stop();
    setNavigating(false);
  }, [session]);

  if (!API_KEY) {
    return (
      <View style={styles.center}>
        <Text>Thiếu EXPO_PUBLIC_MAPSLIBVN_KEY — chạy `pnpm example:rn` từ gốc repo.</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="auto" />
      <MapsLibVNMap
        apiKey={API_KEY}
        apiBase={API_BASE}
        style={theme}
        lang={lang}
        {...(BUNDLE_ID ? { bundleId: BUNDLE_ID } : {})}
        // Một dòng "© MapsLibVN · © OpenStreetMap contributors"; bấm vào (hoặc nút "i") mở đủ nguồn.
        compactAttribution
        navigation={session}
        userLocation={{
          source: foregroundSource,
          heading: headingSource,
          follow: compass ? 'heading' : 'center',
        }}
        follow={compass ? { bearing: 'heading' } : true}
        onLoad={setMap}
        onRouteClick={(i) => {
          setActive(i);
          map?.routes.setActive(i);
        }}
        onPoiClick={(poi) => setDest({ name: poi.name, lng: poi.lngLat[0], lat: poi.lngLat[1] })}
        onError={(e) => Alert.alert('Lỗi bản đồ', e.message)}
        testID="map"
      >
        {dest && !response && <Marker lng={dest.lng} lat={dest.lat} color="#e53935" />}
      </MapsLibVNMap>

      {!navigating && (
        <>
          <Search near={origin ? [origin[1], origin[0]] : [10.776, 106.7]} onPick={setDest} />
          {dest && (
            <View style={styles.card}>
              <Text style={styles.name} numberOfLines={1}>
                → {dest.name}
              </Text>
              <View style={styles.chips}>
                {MODES.map((m) => (
                  <Pressable
                    key={m.mode}
                    style={[styles.chip, mode === m.mode && styles.chipOn]}
                    onPress={() => setMode(m.mode)}
                  >
                    <Text style={mode === m.mode ? styles.chipTextOn : styles.chipText}>
                      {m.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {response ? (
                <>
                  <Text style={styles.secondary}>
                    {response.routes
                      .map(
                        (r, i) =>
                          `${i === active ? '● ' : '○ '}${Math.round(r.duration_s / 60)} phút · ${(r.distance_m / 1000).toFixed(1)} km`,
                      )
                      .join('   ')}
                  </Text>
                  <View style={styles.chips}>
                    <Pressable
                      style={[styles.btn, styles.primary]}
                      onPress={() => void start('real')}
                    >
                      <Text style={[styles.btnText, { color: '#fff' }]}>Bắt đầu</Text>
                    </Pressable>
                    <Pressable style={styles.btn} onPress={() => void start('sim')}>
                      <Text style={styles.btnText}>Giả lập</Text>
                    </Pressable>
                    <Pressable
                      style={styles.btn}
                      onPress={() => {
                        setDest(null);
                        setResponse(null);
                        map?.routes.clear();
                      }}
                    >
                      <Text style={styles.btnText}>Xoá</Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <Text style={styles.hint}>{origin ? 'Đang tính tuyến…' : 'Chờ vị trí GPS…'}</Text>
              )}
            </View>
          )}
          <View style={styles.toolbar}>
            <Pressable
              style={styles.btn}
              onPress={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            >
              <Text style={styles.btnText}>{theme === 'light' ? 'Tối' : 'Sáng'}</Text>
            </Pressable>
            <Pressable style={styles.btn} onPress={() => setLang(lang === 'vi' ? 'en' : 'vi')}>
              <Text style={styles.btnText}>{lang === 'vi' ? 'EN' : 'VI'}</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, compass && styles.primary]}
              onPress={() => setCompass((c) => !c)}
              accessibilityLabel="La bàn"
            >
              <Text style={[styles.btnText, compass && { color: '#fff' }]}>La bàn</Text>
            </Pressable>
            {!userFollowing && (
              <Pressable style={styles.btn} onPress={() => map?.userLocation.recenter()}>
                <Text style={styles.btnText}>Về tôi</Text>
              </Pressable>
            )}
          </View>
        </>
      )}

      {navigating && (
        <NavigationPanel session={session} kind={navigating} map={map} onStop={() => void stop()} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  search: { position: 'absolute', top: 56, left: 12, right: 12 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  list: { backgroundColor: '#fff', borderRadius: 8, marginTop: 6, maxHeight: 280 },
  row: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderColor: '#eee' },
  name: { fontSize: 15, fontWeight: '600' },
  secondary: { fontSize: 12, color: '#666' },
  hint: { padding: 12, color: '#666' },
  card: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 32,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    gap: 8,
    elevation: 3,
  },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#eef2f8' },
  chipOn: { backgroundColor: '#2458a6' },
  chipText: { fontWeight: '600', color: '#1b3a6b' },
  chipTextOn: { fontWeight: '600', color: '#fff' },
  toolbar: { position: 'absolute', right: 12, top: 120, gap: 8 },
  btn: { backgroundColor: '#eef2f8', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  primary: { backgroundColor: '#2458a6' },
  btnText: { fontWeight: '600' },
});
