import { ATTRIBUTION_LINKS, type AttributionLink, attributionText } from '@mapslibvn/core';
import { useState } from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

/** Dòng gọn khi `compactAttribution`; bấm vào mở danh sách đủ nguồn. */
export const COMPACT_ATTRIBUTION = '© MapsLibVN · © OpenStreetMap contributors';

export interface AttributionProps {
  compact: boolean;
}

const label = (link: AttributionLink) =>
  link.license ? `${link.text} (${link.license})` : link.text;

/**
 * Ghi nguồn bắt buộc (spec 12.3) — không có tuỳ chọn tắt. Bấm vào mở danh sách đủ bốn nguồn do
 * SDK tự dựng từ `ATTRIBUTION_LINKS`. Không dùng hộp thoại native của MapLibre: nó bỏ qua
 * `attribution` trong style mà đọc metadata của file PMTiles, nên chỉ có OpenMapTiles + OSM, thiếu
 * © MapsLibVN và Foursquare (đo trên iOS 23/09/2026).
 */
export function Attribution({ compact }: AttributionProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="link"
        accessibilityLabel="Ghi nguồn bản đồ"
        style={styles.box}
        testID="mapslibvn-attribution"
      >
        <Text style={styles.text} numberOfLines={compact ? 1 : 2}>
          {compact ? COMPACT_ATTRIBUTION : attributionText()}
        </Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.overlay}>
          <Pressable
            style={styles.backdrop}
            onPress={close}
            accessibilityLabel="Đóng ghi nguồn"
            testID="mapslibvn-attribution-backdrop"
          />
          <View style={styles.sheet} testID="mapslibvn-attribution-sheet">
            <Text style={styles.title}>Ghi nguồn bản đồ</Text>
            {ATTRIBUTION_LINKS.map((link) => (
              <Pressable
                key={link.href}
                onPress={() => {
                  // Máy không có trình duyệt thì openURL ném lỗi — không có gì để làm thêm.
                  Linking.openURL(link.href).catch(() => undefined);
                }}
                accessibilityRole="link"
                style={styles.row}
                testID="mapslibvn-attribution-link"
              >
                <Text style={styles.link}>{label(link)}</Text>
              </Pressable>
            ))}
            <Pressable
              onPress={close}
              accessibilityRole="button"
              style={styles.close}
              testID="mapslibvn-attribution-close"
            >
              <Text style={styles.closeText}>Đóng</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
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
  text: { fontSize: 9, color: '#333333' },
  overlay: { flex: 1, justifyContent: 'flex-end', padding: 16 },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: { backgroundColor: '#ffffff', borderRadius: 12, paddingVertical: 8, marginBottom: 16 },
  title: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666666',
    textAlign: 'center',
    paddingVertical: 8,
  },
  row: { paddingVertical: 12, paddingHorizontal: 16 },
  link: { fontSize: 16, color: '#1b3a6b', textAlign: 'center' },
  close: { paddingVertical: 12, marginTop: 4, borderTopWidth: 1, borderTopColor: '#e5e5e5' },
  closeText: { fontSize: 16, fontWeight: '600', color: '#333333', textAlign: 'center' },
});
