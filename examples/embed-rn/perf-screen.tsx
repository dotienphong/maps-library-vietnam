import {
  createClient,
  createNavigationSession,
  type DirectionsResponse,
  type MapHandle,
  MapsLibVNMap,
  type NavigationSession,
  playbackSource,
  simulateFixes,
} from '@mapslibvn/react-native';
import { Profiler, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

const API_KEY = process.env.EXPO_PUBLIC_MAPSLIBVN_KEY ?? '';
const API_BASE = process.env.EXPO_PUBLIC_MAPSLIBVN_API ?? 'https://api.ai-solutions.io.vn';

/** Tiền tố để scripts/perf-rn.mjs lọc ra khỏi logcat. Đổi ở đây thì đổi cả PERF_PREFIX bên script. */
const PREFIX = 'MLVPERF ';

/** Hai điểm cố định ở Quận 1 — `client.directions` nhận [lat, lng], không phải [lng, lat]. */
const FROM: [number, number] = [10.7798, 106.699];
const TO: [number, number] = [10.7725, 106.6981];

/** Chờ bấy nhiêu mili giây sau khi map sẵn sàng rồi mới vào pha dẫn đường — xem chú thích ở pha 2. */
const NAV_DELAY_MS = 8000;

const client = createClient({ apiKey: API_KEY, baseUrl: API_BASE });

/** In một dòng JSON để script parse lại. */
function emit(payload: Record<string, unknown>): void {
  console.log(PREFIX + JSON.stringify(payload));
}

/**
 * Màn hình đo hai pha:
 * 1. dựng map, đo mốc tới khi style tải xong;
 * 2. chạy một phiên dẫn đường giả lập và đếm số commit React của cây map trên mỗi fix GPS.
 * Không có nút bấm — kịch bản cử chỉ do adb bắn vào từ ngoài.
 */
export function PerfScreen() {
  // Mốc gốc: thời điểm mount, lấy một lần và không đổi giữa các lần render.
  const mountedAt = useRef(Date.now()).current;
  const commits = useRef(0);
  // Số commit ngay trước khi vào pha 2, để tách commit lúc dựng map ra khỏi commit lúc dẫn đường.
  const commitsAtNavStart = useRef<number | null>(null);
  const fixes = useRef(0);
  const [session, setSession] = useState<NavigationSession | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let started: NavigationSession | null = null;
    // Trì hoãn pha 2: scripts/perf-rn.mjs mở rồi tắt app mười lượt để lấy p50/p95 thời gian mở
    // màn hình, mỗi lượt ngắn hơn NAV_DELAY_MS nên không lượt nào chạy nhầm vào pha dẫn đường.
    // Lượt cuối script để app sống, bắn cử chỉ đo frame giật, rồi mới tới lượt pha 2 chạy.
    const timer = setTimeout(() => {
      void run();
    }, NAV_DELAY_MS);

    async function run() {
      if (cancelled) return;
      try {
        const response: DirectionsResponse = await client.directions({
          from: FROM,
          to: TO,
          mode: 'motorbike',
        });
        const route = response.routes[0];
        if (!route || cancelled) return;
        const s = createNavigationSession({
          provider: client,
          // rate 4: chạy nhanh gấp bốn để một lượt đo không mất vài phút.
          source: playbackSource(simulateFixes(route, { jitter_m: 4 }), { rate: 4 }),
        });
        started = s;
        s.on('progress', () => {
          fixes.current += 1;
        });
        // Nghe 'end' thay vì 'arrive': session phát 'end' cả khi tới nơi (reason: 'arrived') lẫn khi
        // bị dừng sớm (reason: 'stopped'), còn 'arrive' chỉ phát khi tới nơi — nghe 'end' bắt được
        // cả hai mà không cần đăng ký 2 listener kèm guard chống phát trùng.
        s.on('end', (e) => {
          emit({
            kind: 'nav_done',
            reason: e.reason,
            fixes: fixes.current,
            commits: commits.current - (commitsAtNavStart.current ?? 0),
            // Profiler.onRender CHỈ chạy khi __DEV__ — chuỗi "onRender" không tồn tại trong
            // ReactFabric-prod.js (bundle Release dùng bản này), chỉ có ở -dev/-profiling. Task 5
            // phải coi commits vô nghĩa (trả null, không phải 0) khi profiler === false.
            profiler: __DEV__,
          });
        });
        commitsAtNavStart.current = commits.current;
        emit({ kind: 'nav_start' });
        setSession(s);
        await s.start({ response, routeIndex: 0, lang: 'vi' });
      } catch (e) {
        emit({ kind: 'error', message: e instanceof Error ? e.message : 'không rõ' });
      }
    }

    return () => {
      cancelled = true;
      clearTimeout(timer);
      void started?.stop();
    };
  }, [ready]);

  return (
    <View style={styles.container}>
      <Profiler
        id="map"
        onRender={(_id, phase, actualDuration) => {
          commits.current += 1;
          emit({ kind: 'commit', n: commits.current, phase, ms: Math.round(actualDuration) });
        }}
      >
        <MapsLibVNMap
          apiKey={API_KEY}
          apiBase={API_BASE}
          center={[106.699, 10.7798]}
          zoom={14}
          {...(session ? { navigation: session } : {})}
          onLoad={(_map: MapHandle) => {
            setReady(true);
            emit({ kind: 'map_ready', ms: Date.now() - mountedAt });
          }}
          onError={(e: Error) => emit({ kind: 'error', message: e.message })}
          testID="perf-map"
        />
      </Profiler>
      <Text style={styles.badge}>{ready ? 'ĐO: map sẵn sàng' : 'ĐO: đang tải'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  badge: {
    position: 'absolute',
    top: 48,
    left: 12,
    backgroundColor: '#000000aa',
    color: '#fff',
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 12,
  },
});
