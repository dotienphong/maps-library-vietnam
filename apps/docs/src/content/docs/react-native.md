---
title: React Native
description: Nhúng bản đồ MapsLibVN vào app iOS/Android bằng @mapslibvn/react-native.
---

`@mapslibvn/react-native` bọc [`@maplibre/maplibre-react-native`](https://maplibre.org/maplibre-react-native/)
với cùng API như `@mapslibvn/react`: `<MapsLibVNMap>`, `<Marker>`, `useMap()`, `usePlaces()`.
Tiles và style dùng nguyên của web — MapLibre Native đọc `pmtiles://` trực tiếp từ CDN, không qua máy chủ.

## 1. Yêu cầu

| | Tối thiểu |
|---|---|
| React Native | 0.80, **New Architecture** bật (mặc định từ 0.76) |
| React | 19.1 |
| Expo (nếu dùng) | SDK 54; **không chạy trên Expo Go** — cần `expo run:*` hoặc EAS Build |
| Android | API 23 |
| Khoá API | kind **`mobile`** (không kiểm origin; `X-Bundle-Id` được ghi log) |

Đã chạy thật trên iOS 26.1 (iPhone 17 Pro) và Android (Pixel 7) với Expo SDK 57, React 19.2, RN 0.86.

## 2. Cài đặt

**Expo**

```bash
npx expo install @maplibre/maplibre-react-native expo-application
npm install <đường dẫn tarball @mapslibvn/react-native>   # xem mục 7
```

`app.json`: thêm `"plugins": ["@maplibre/maplibre-react-native"]`, rồi `npx expo run:ios` / `run:android`.
Với SDK 54–56 thêm cả `"newArchEnabled": true`; SDK 57 đã bỏ khoá này (New Architecture luôn bật) nên
để lại sẽ bị `expo-doctor` báo lỗi schema.

**Bare React Native**

```bash
npm install @maplibre/maplibre-react-native <tarball @mapslibvn/react-native>
cd ios && pod install
```

## 3. Dùng

```tsx
import * as Application from 'expo-application';
import { MapsLibVNMap, Marker, usePlaces } from '@mapslibvn/react-native';

export function Screen() {
  return (
    <MapsLibVNMap
      apiKey="mlv_live_…"
      apiBase="https://api.ai-solutions.io.vn"
      style="light"                 // 'light' | 'dark' | URL style riêng
      center={[106.7, 10.776]} zoom={13}
      lang="vi"                     // 'en' đổi nhãn; nhãn chủ quyền luôn tiếng Việt
      poiSources={['osm']}          // mặc định: cả ba nguồn (osm, overture, fsq)
      bundleId={Application.applicationId ?? undefined}
      onPoiClick={(poi) => console.log(poi.name, poi.category)}
      onLoad={(map) => map.flyTo([106.7, 10.776], 15)}
    >
      <Marker lng={106.7} lat={10.776} color="#e53935" />
    </MapsLibVNMap>
  );
}
```

`usePlaces(query, { near, limit })` trả `{ items, loading, error }` với debounce 200 ms — dùng trong
cây con của `<MapsLibVNMap>` (tự lấy client) hoặc truyền `client` riêng. Ô tìm kiếm đặt **cạnh** map
(không phải con của nó) nằm ngoài context: hãy giữ `MapHandle` mà `onLoad` trả về rồi truyền
`client={map?.places}`, nếu không hook im lặng trả mảng rỗng.

`poiSources` có đúng sáu profile: mặc định cả ba (`all`), `['osm']`, `['osm','fsq']`,
`['overture','fsq']`, `['overture']` và `['fsq']`. Các profile riêng:

```tsx
<MapsLibVNMap poiSources={['osm', 'fsq']} {...props} />
<MapsLibVNMap poiSources={['overture', 'fsq']} {...props} />
<MapsLibVNMap poiSources={['overture']} {...props} />
<MapsLibVNMap poiSources={['fsq']} {...props} />
```

POI người dùng luôn được giữ. Search/nearby/reverse/autocomplete dùng profile đã chọn nhưng
`getPlace(id)` không lọc; nếu archive profile hợp lệ chưa phát hành, style tạm dùng `all` với header
`x-poi-profile: all;fallback`.

## 4. Khác với web

| Web (`@mapslibvn/react`) | React Native |
|---|---|
| `map.gl` là `maplibregl.Map` | `useMap().native` là ref `Map` của wrapper; `useMap().camera` là ref `Camera` |
| Đổi `center`/`zoom` tạo lại map | `center`/`zoom` chỉ là giá trị khởi tạo; dùng `useMap().flyTo` / `fitBounds` |
| `<Marker popupHtml>` | không có HTML; truyền `children` và `onPress` |
| `map.navigation` gắn với map | `createNavigationSession()` độc lập, `navigation={session}` — xem [Dẫn đường React Native](/dan-duong-react-native/) |
| Attribution `AttributionControl` | dòng MapsLibVN chồng góc dưới trái + nút "i" native; `compactAttribution` gọn, **không tắt được** |
| không có chấm xanh/la bàn | `userLocation={{ source, heading, follow }}`, `useHeading()`, puck dẫn đường theo la bàn khi đứng yên — xem mục 6 |

Đổi `apiKey`, `apiBase`, `style`, `lang`, `poiLayer`, `poiSources` sau khi mount sẽ tạo lại map và gọi `onLoad` lần nữa.

## 5. Khoá `mobile`

Khoá `mobile` không có `allowed_origins`; app gửi `bundleId` để máy chủ ghi `X-Bundle-Id` vào log và
báo cáo (chưa chặn — xem [Điều khoản tenant](/dieu-khoan/)). Khoá vẫn phải giữ trong cấu hình build
(`EXPO_PUBLIC_*`), không hard-code vào mã nguồn công khai.

## 6. Vị trí của tôi và la bàn

Chấm xanh + nón hướng + vòng sai số kiểu app gọi xe, khi **không** dẫn đường:

```tsx
import { expoHeadingSource, expoLocationSource } from '@mapslibvn/react-native/expo';

// Cấp module hoặc useMemo: SDK chỉ đăng ký lại nguồn khi tham chiếu đổi.
const source = expoLocationSource({ background: false });
const heading = expoHeadingSource();

<MapsLibVNMap
  {...props}
  userLocation={{ source, heading, follow: 'center' }}   // follow: 'none' | 'center' | 'heading'
/>
```

| Tuỳ chọn | Ý nghĩa |
|---|---|
| `source` (bắt buộc) | vị trí tiền cảnh — `PositionSource` bất kỳ, kể cả feed của bạn |
| `heading` | có → nón hướng (mờ khi `accuracy` là `unreliable`) |
| `follow` | `'none'` (mặc định) không đụng camera; `'center'` bám tâm; `'heading'` bám tâm và xoay bản đồ theo hướng nhìn |
| `zoom` | zoom khi bám, mặc định 16 |
| `accuracyCircle` | vòng sai số theo mét thật, mặc định true |

Chấm và nón là view native đặt tại fix (MLRN `Marker`), nón xoay bằng `Animated` trên UI thread và
nội suy tuyến tính giữa hai mẫu cảm biến — quay liên tục 60 fps, không đi qua re-tile GeoJSON. Chỉ vòng
sai số là layer MapLibre (`USER_LOCATION_LAYER_IDS.accuracy`, chèn dưới nhãn cùng chỗ với tuyến).

Người dùng kéo bản đồ → tắt bám; `useMap().userLocation.recenter()` bật lại, `following` và sự kiện
`followChange` để hiện nút "Về tôi". `useMap().userLocation.fix` / `.heading` là fix và hướng SDK
đang vẽ. Khi một phiên dẫn đường gắn vào map có tiến độ, chấm xanh **tự ẩn và ngừng nghe nguồn**
(puck dẫn đường thay thế, không có hai luồng GPS); phiên dừng thì hiện lại.

Entry `/expo` cần `expo-sensors` ngoài `expo-location`: `npx expo install expo-location expo-sensors`
và plugin `expo-sensors` trong `app.json`, kèm quyền Android `HIGH_SAMPLING_RATE_SENSORS` để gyro chạy
đủ nhịp trên Android 12+ (xem [Dẫn đường React Native](/dan-duong-react-native/) mục 1–2).
Đọc hướng cho UI riêng: `useHeading(heading)`.

## 7. Giới hạn hiện tại

- Dẫn đường (định vị nền, giọng Việt) có từ 0.5: xem [Dẫn đường trên React Native](/dan-duong-react-native/).
- Chưa publish npm (đã sẵn sàng, chưa chạy publish). Cài từ tarball do `pnpm --filter @mapslibvn/react-native pack`
  sinh ra — app thử `examples/embed-rn` trong repo minh hoạ trọn quy trình bằng `pnpm example:rn`.
- Chưa có tiles offline; MapLibre Native đọc được PMTiles `file://` nên có thể thêm sau.
- `onPoiClick` truy vấn đúng một điểm chạm: lệch khỏi biểu tượng POI vài pixel là không có kết quả.
- La bàn giả định màn hình dọc; simulator không có la bàn.

Biểu tượng POI xuất hiện tăng dần từ zoom 10 theo độ quan trọng và mật độ. Nhãn địa danh lớn xuất
hiện từ zoom 12; nhãn địa điểm địa phương từ zoom 16. POI không hiện trên nền vẫn tìm được qua
Search/Nearby.

Đọc thêm: [Bắt đầu 5 phút](/bat-dau/) (web), [Giấy phép & ghi nguồn](/giay-phep/).
