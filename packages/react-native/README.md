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

## Dẫn đường (0.5.0)

```tsx
// index.ts — phạm vi toàn cục, trước registerRootComponent
import { defineNavigationTask } from '@mapslibvn/react-native/expo';
defineNavigationTask();
```

```tsx
import { MapsLibVNMap, createClient, createNavigationSession, useNavigation } from '@mapslibvn/react-native';
import { expoNavigation } from '@mapslibvn/react-native/expo';

const client = createClient({ apiKey, baseUrl: apiBase });
const session = createNavigationSession({ provider: client, ...expoNavigation() }); // sống ngoài cây React

const response = await client.directions({ from: [10.7798, 106.699], to: [10.7725, 106.698], mode: 'motorbike' });
await session.start({ response });            // GPS cả khi khoá máy, giọng Việt, tự tính lại khi lệch

<MapsLibVNMap {...props} navigation={session} />   // gắn để vẽ tuyến, puck, camera bám; unmount không dừng phiên
const { status, progress } = useNavigation(session); // dùng ở bất kỳ đâu
```

Cần `npx expo install expo-location expo-task-manager expo-speech expo-audio` và plugin trong
`app.json` (xem docs). App có luồng GPS riêng: truyền `source` của bạn thay `expoNavigation()`.

Tài liệu: <https://mapslibvn-docs.pages.dev/react-native/> và
<https://mapslibvn-docs.pages.dev/dan-duong-react-native/>

Giấy phép mã nguồn: MIT; xem `THIRD_PARTY_NOTICES.md` cho giấy phép phụ thuộc và dữ liệu.
