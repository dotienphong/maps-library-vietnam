import type { HeadingFix } from '@mapslibvn/core';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { HEADING_CONE_PNG_DATA_URI } from '../navigation/puck-image';
import { ROUTE_COLOR } from '../navigation/route-layers';
import { CONE_SIZE, DOT_RADIUS, DOT_STROKE, PUCK_SIZE, tweenDuration, unwrapTo } from './puck-math';
import type { UserLocationStore } from './store';

export const USER_LOCATION_PUCK_TEST_ID = 'mapslibvn-user-puck';
export const USER_LOCATION_CONE_TEST_ID = 'mapslibvn-user-cone';

type Reliability = 'none' | 'reliable' | 'unreliable';
const reliabilityOf = (h: HeadingFix | null): Reliability =>
  h === null ? 'none' : h.accuracy === 'unreliable' ? 'unreliable' : 'reliable';

interface UserLocationPuckProps {
  store: UserLocationStore;
  /** Bearing camera hiện hành (độ) — map.tsx cập nhật từ `onRegionIsChanging`; nón xoay `heading − bearing`. */
  mapBearing: Animated.Value;
}

/**
 * Chấm xanh + nón hướng vẽ bằng VIEW NATIVE trong `<Marker>` (spec la bàn 10b, thực địa 13/09/2026):
 * góc nón là `Animated.Value` chạy native driver, mỗi fix hướng là một tween tuyến tính dài đúng khoảng
 * cách hai lần phát → xoay liên tục 60 fps trên UI thread, không qua re-tile GeoJSON/worker MapLibre
 * (bản `icon-rotate` cũ: bước rời rạc theo nhịp cảm biến, trễ vài khung hình, giật trên Android).
 * Component không re-render theo hướng — chỉ theo mức tin cậy (mờ 0,45 khi `unreliable`).
 */
export function UserLocationPuck({ store, mapBearing }: UserLocationPuckProps) {
  const reliability = useSyncExternalStore(
    store.subscribe,
    () => reliabilityOf(store.getSnapshot().heading),
    () => reliabilityOf(store.getSnapshot().heading),
  );
  const angle = useRef(new Animated.Value(0)).current;
  const last = useRef<{ unwrapped: number; timestamp: number } | null>(null);

  useEffect(() => {
    const apply = (): void => {
      const h = store.getSnapshot().heading;
      if (!h) {
        last.current = null;
        return;
      }
      const prev = last.current;
      if (!prev) {
        angle.setValue(h.heading);
        last.current = { unwrapped: h.heading, timestamp: h.timestamp };
        return;
      }
      if (h.timestamp === prev.timestamp) return; // cùng một fix (store đổi vì lý do khác)
      const next = unwrapTo(prev.unwrapped, h.heading);
      last.current = { unwrapped: next, timestamp: h.timestamp };
      Animated.timing(angle, {
        toValue: next,
        duration: tweenDuration(h.timestamp - prev.timestamp),
        easing: Easing.linear,
        useNativeDriver: true,
      }).start();
    };
    apply();
    return store.subscribe(apply);
  }, [store, angle]);

  const rotate = useMemo(
    () =>
      Animated.subtract(angle, mapBearing).interpolate({
        inputRange: [0, 360],
        outputRange: ['0deg', '360deg'],
      }),
    [angle, mapBearing],
  );

  return (
    <View pointerEvents="none" style={styles.root} testID={USER_LOCATION_PUCK_TEST_ID}>
      {reliability !== 'none' ? (
        <Animated.Image
          source={{ uri: HEADING_CONE_PNG_DATA_URI }}
          testID={USER_LOCATION_CONE_TEST_ID}
          style={[
            styles.cone,
            { opacity: reliability === 'reliable' ? 1 : 0.45, transform: [{ rotate }] },
          ]}
        />
      ) : null}
      <View style={styles.dot} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: PUCK_SIZE,
    height: PUCK_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cone: { position: 'absolute', width: CONE_SIZE, height: CONE_SIZE },
  dot: {
    width: 2 * (DOT_RADIUS + DOT_STROKE),
    height: 2 * (DOT_RADIUS + DOT_STROKE),
    borderRadius: DOT_RADIUS + DOT_STROKE,
    backgroundColor: ROUTE_COLOR,
    borderColor: '#ffffff',
    borderWidth: DOT_STROKE,
  },
});
