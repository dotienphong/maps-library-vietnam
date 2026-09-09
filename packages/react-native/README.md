# @mapslibvn/react-native

Bọc `@maplibre/maplibre-react-native` để hiện bản đồ MapsLibVN trong app React Native (Expo hoặc bare),
API bám `@mapslibvn/react`. Yêu cầu React ≥ 19.1, React Native ≥ 0.80, New Architecture, Expo ≥ 54
(không chạy trên Expo Go). Hướng dẫn: trang "React Native" trong docs; app thử: `examples/embed-rn`.

## Cài đặt

```bash
npm install @mapslibvn/react-native
npx expo install @maplibre/maplibre-react-native expo-application
```

## Ví dụ

```tsx
import { MapsLibVNMap, Marker } from '@mapslibvn/react-native';

<MapsLibVNMap
  apiKey="mlv_live_…"
  apiBase="https://api.ai-solutions.io.vn"
  bundleId="vn.example.app"
  containerStyle={{ flex: 1 }}
>
  <Marker lng={106.6981} lat={10.7725} />
</MapsLibVNMap>;
```

Khoá mobile phải giới hạn đúng bundle/application id. Không tắt hoặc che attribution.

Tài liệu: <https://mapslibvn-docs.pages.dev/react-native/>

Giấy phép mã nguồn: MIT; xem `THIRD_PARTY_NOTICES.md` cho giấy phép phụ thuộc và dữ liệu.
