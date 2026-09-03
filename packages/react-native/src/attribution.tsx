import { attributionText } from '@mapslibvn/core';
import { Pressable, StyleSheet, Text } from 'react-native';

/** Dòng gọn khi `compactAttribution`; bấm vào mở hộp thoại native với đủ nguồn. */
export const COMPACT_ATTRIBUTION = '© MapsLibVN · © OpenStreetMap contributors';

export interface AttributionProps {
  compact: boolean;
  /** Mở hộp thoại attribution native (`MapRef.showAttribution`). */
  onPress: () => void;
}

/** Ghi nguồn bắt buộc (spec 12.3) — không có tuỳ chọn tắt. */
export function Attribution({ compact, onPress }: AttributionProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel="Ghi nguồn bản đồ"
      style={styles.box}
      testID="mapslibvn-attribution"
    >
      <Text style={styles.text} numberOfLines={compact ? 1 : 2}>
        {compact ? COMPACT_ATTRIBUTION : attributionText()}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    maxWidth: '72%',
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  text: { fontSize: 10, color: '#333333' },
});
