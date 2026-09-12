import {
  type MapHandle,
  type NavigationSession,
  type TravelMode,
  formatDistanceShort,
  useNavigation,
} from '@mapslibvn/react-native';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export const MODES: { mode: TravelMode; label: string }[] = [
  { mode: 'car', label: 'Ô tô' },
  { mode: 'motorbike', label: 'Xe máy' },
  { mode: 'walk', label: 'Đi bộ' },
];

/** Số liệu để điền evidence thực địa (spec C mục 13 tiêu chí 5). */
interface Diag {
  fixes: number;
  accuracy: number | null;
  reroutes: number;
  /** 'GPS nền' cho tới khi nguồn báo rơi về tiền cảnh; 'giả lập' với playbackSource. */
  source: string;
  voice: string;
}

export function NavigationPanel({
  session,
  kind,
  map,
  onStop,
}: {
  session: NavigationSession;
  kind: 'real' | 'sim';
  map: MapHandle | null;
  onStop: () => void;
}) {
  const { status, progress, following } = useNavigation(session);
  const [diag, setDiag] = useState<Diag>({
    fixes: 0,
    accuracy: null,
    reroutes: 0,
    source: kind === 'sim' ? 'giả lập' : 'GPS nền',
    voice: 'có',
  });

  useEffect(() => {
    const onProgress = (p: { fix: { accuracy_m?: number } }) =>
      setDiag((d) => ({ ...d, fixes: d.fixes + 1, accuracy: p.fix.accuracy_m ?? null }));
    const onReroute = () => setDiag((d) => ({ ...d, reroutes: d.reroutes + 1 }));
    const onBg = (e: { reason: string }) =>
      setDiag((d) => ({ ...d, source: `GPS tiền cảnh (${e.reason})` }));
    const onVoice = () => setDiag((d) => ({ ...d, voice: 'không có' }));
    const onRoute = () => setDiag((d) => ({ ...d, fixes: 0 }));
    session.on('progress', onProgress);
    session.on('reroute', onReroute);
    session.on('backgroundUnavailable', onBg);
    session.on('voiceUnavailable', onVoice);
    session.on('route', onRoute);
    return () => {
      session.off('progress', onProgress);
      session.off('reroute', onReroute);
      session.off('backgroundUnavailable', onBg);
      session.off('voiceUnavailable', onVoice);
      session.off('route', onRoute);
    };
  }, [session]);

  if (status === 'idle' || !progress) return null;
  const next = progress.nextStep ?? progress.step;
  const minutes = Math.max(1, Math.round(progress.remaining_s / 60));
  return (
    <>
      <View style={styles.banner}>
        <Text style={styles.instruction} numberOfLines={2}>
          {status === 'arrived' ? 'Đã đến nơi' : next.instruction}
        </Text>
        <Text style={styles.distance}>
          {status === 'off_route' || status === 'rerouting'
            ? 'Lệch tuyến, đang tính lại…'
            : formatDistanceShort(progress.distanceToStep_m)}
        </Text>
      </View>
      <View style={styles.bottom}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eta}>
            {minutes} phút · {formatDistanceShort(progress.remaining_m)} · {status}
          </Text>
          <Text style={styles.diag}>
            fix {diag.fixes} · sai số{' '}
            {diag.accuracy === null ? '—' : `${Math.round(diag.accuracy)} m`} · {diag.source} · tính
            lại {diag.reroutes} · giọng {diag.voice}
          </Text>
        </View>
        {!following && map ? (
          <Pressable style={styles.btn} onPress={() => map.navigation.recenter()}>
            <Text style={styles.btnText}>Về vị trí</Text>
          </Pressable>
        ) : null}
        <Pressable style={[styles.btn, styles.stop]} onPress={onStop}>
          <Text style={[styles.btnText, { color: '#fff' }]}>Dừng</Text>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 56,
    left: 12,
    right: 12,
    backgroundColor: '#1b3a6b',
    borderRadius: 12,
    padding: 14,
  },
  instruction: { color: '#fff', fontSize: 20, fontWeight: '700' },
  distance: { color: '#cfe0ff', fontSize: 16, marginTop: 4 },
  bottom: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    elevation: 3,
  },
  eta: { fontSize: 16, fontWeight: '600' },
  diag: { fontSize: 11, color: '#666', marginTop: 2 },
  btn: { backgroundColor: '#eef2f8', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  stop: { backgroundColor: '#d92d20' },
  btnText: { fontWeight: '600' },
});
