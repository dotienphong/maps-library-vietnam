import { type Anchor, Marker as NativeMarker } from '@maplibre/maplibre-react-native';
import { type ReactElement, useContext } from 'react';
import { StyleSheet, View } from 'react-native';
import { MapContext } from './context';

/** Màu ghim mặc định của MapLibre. */
export const DEFAULT_MARKER_COLOR = '#3FB1CE';

export interface MarkerProps {
  lng: number;
  lat: number;
  /** Màu ghim mặc định; bỏ qua khi có children */
  color?: string;
  /** Điểm neo — mặc định 'center' (ghim tròn) */
  anchor?: Anchor;
  onPress?: () => void;
  /** View tuỳ ý thay ghim mặc định */
  children?: ReactElement;
  testID?: string;
}

export function Marker({
  lng,
  lat,
  color = DEFAULT_MARKER_COLOR,
  anchor = 'center',
  onPress,
  children,
  testID,
}: MarkerProps) {
  // Đọc context trực tiếp (không qua useMap của map.tsx) để tránh vòng import map → route-layers → marker → map.
  if (!useContext(MapContext)) throw new Error('useMap phải được gọi bên trong <MapsLibVNMap>');
  const pin = children ?? (
    <View style={[styles.pin, { backgroundColor: color }]} testID="mapslibvn-marker-pin" />
  );
  return (
    <NativeMarker
      lngLat={[lng, lat]}
      anchor={anchor}
      {...(onPress ? { onPress: () => onPress() } : {})}
      {...(testID ? { testID } : {})}
    >
      {pin}
    </NativeMarker>
  );
}

const styles = StyleSheet.create({
  pin: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 3,
    borderColor: '#ffffff',
  },
});
