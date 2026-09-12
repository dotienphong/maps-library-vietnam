---
title: Dẫn đường trên React Native
description: Phiên dẫn đường độc lập với màn hình bản đồ, định vị cả khi khoá máy, giọng Việt bằng TTS native — @mapslibvn/react-native 0.5.
---

Trang này dành cho `@mapslibvn/react-native` (0.5 trở lên). Logic dẫn đường giống hệt web (cùng
máy trạng thái trong `@mapslibvn/core`, xem [Dẫn đường](/dan-duong/)); khác ở hai điểm: **phiên dẫn
đường sống ngoài cây React** (popup đè lên bản đồ hay unmount bản đồ không dừng dẫn đường) và **định
vị tiếp tục khi khoá máy hoặc chuyển app**.

## 1. Yêu cầu và cài đặt

Ngoài yêu cầu của [React Native](/react-native/) mục 1, dẫn đường cần sáu module Expo (app bare chạy
`npx install-expo-modules@latest` trước):

```bash
npx expo install expo-location expo-task-manager expo-speech expo-audio expo-keep-awake expo-sensors
```

Bản đồ và tìm kiếm **không** cần các module này; chỉ khi bạn import
`@mapslibvn/react-native/expo` Metro mới resolve chúng.

`expo-sensors` chỉ phục vụ con quay hồi chuyển cho la bàn (mục 10) nhưng là bắt buộc khi import entry
`/expo`: thiếu nó Metro báo `Unable to resolve module expo-sensors`.

## 2. Cấu hình `app.json` và `index.ts`

```json
"android": {
  "permissions": ["RECEIVE_BOOT_COMPLETED"]
},
"plugins": [
  "@maplibre/maplibre-react-native",
  ["expo-location", {
    "isIosBackgroundLocationEnabled": true,
    "isAndroidForegroundServiceEnabled": true,
    "locationWhenInUsePermission": "Ứng dụng dùng vị trí của bạn để dẫn đường."
  }],
  "expo-audio",
  ["expo-sensors", { "motionPermission": "Ứng dụng dùng cảm biến chuyển động để hiện hướng." }]
]
```

Plugin thêm `UIBackgroundModes: location` + `audio` (iOS) và quyền `FOREGROUND_SERVICE_LOCATION`
(Android). **Không** bật `isAndroidBackgroundLocationEnabled`: SDK không xin quyền "Luôn luôn", vì cả
hai hệ đều cho tiếp tục định vị khi phiên khởi động lúc app đang mở. Plugin `expo-sensors` thêm
`NSMotionUsageDescription` (iOS); con quay hồi chuyển không hỏi quyền lúc chạy trên cả hai hệ.

**`android.permissions: ["RECEIVE_BOOT_COMPLETED"]` là bắt buộc, không phải tuỳ chọn.**
`expo-task-manager` lên lịch job định vị nền bằng `JobScheduler` với `setPersisted(true)` — không
có cách nào tắt qua cấu hình — và Android **crash ngay** (`IllegalArgumentException: requested job
be persisted without holding RECEIVE_BOOT_COMPLETED permission`) ngay lần đầu có vị trí mới trong
lúc nền, nếu thiếu quyền này. Không plugin Expo nào tự thêm giúp (xác nhận đọc mã nguồn
`expo-task-manager` 57.0.15 và `expo-location` 57.0.15 — quyền này nằm ngoài danh sách cả hai
plugin quản lý), phải tự khai trong `app.json` như trên. Thiếu quyền này Android còn khoá hẳn việc
mở lại app một lúc ("crashed too many times") sau vài lần crash liên tiếp — nếu gặp, gỡ app
(`adb uninstall`) rồi cài lại sau khi thêm quyền.

Đổi plugin hoặc quyền xong chạy `npx expo prebuild --clean` rồi build lại.

```ts
// index.ts — PHẢI ở phạm vi toàn cục, trước registerRootComponent (yêu cầu của expo-task-manager)
import { defineNavigationTask } from '@mapslibvn/react-native/expo';
import { registerRootComponent } from 'expo';
import App from './App';

defineNavigationTask();
registerRootComponent(App);
```

## 3. Ba bước

```tsx
import { MapsLibVNMap, createClient, createNavigationSession } from '@mapslibvn/react-native';
import { expoNavigation } from '@mapslibvn/react-native/expo';

// Tạo ở cấp module: phiên sống qua đổi màn hình, popup, unmount bản đồ.
const client = createClient({ apiKey: 'mlv_live_…', baseUrl: 'https://api.ai-solutions.io.vn' });
const session = createNavigationSession({ provider: client, ...expoNavigation() });

// 1. Tính tuyến (tham số [lat, lng]; response dùng [lng, lat])
const response = await client.directions({ from: [10.7798, 106.699], to: [10.7725, 106.698], mode: 'motorbike' });

// 2. Dẫn đường — gọi khi người dùng bấm nút, lúc app đang mở (Android không cho khởi động
//    foreground service từ nền). Hộp thoại quyền vị trí hiện ở đây nếu chưa cấp.
await session.start({ response });

// 3. Gắn bản đồ vào phiên để vẽ tuyến, puck, camera bám. Gỡ prop hoặc unmount → phiên vẫn chạy.
<MapsLibVNMap apiKey="…" apiBase="…" navigation={session} />
```

`session.stop()` dừng GPS, giọng, giữ màn hình sáng; tuyến còn trên bản đồ tới khi
`useMap().routes.clear()`. Đến nơi thì phiên tự nhả GPS và phát `end { reason: 'arrived' }`.

App nhỏ không muốn tự cầm phiên: bỏ prop `navigation`, truyền `sessionOptions={expoNavigation()}` và
gọi `useMap().navigation.start({ response })` — API giống `map.navigation` của web.

## 4. Vẽ UI từ sự kiện

SDK không có banner sẵn. Hook `useNavigation(session)` dùng được **ở bất kỳ đâu**, không cần nằm
trong `<MapsLibVNMap>`:

```tsx
import { formatDistanceShort, useNavigation } from '@mapslibvn/react-native';

function Banner() {
  const { status, progress, following, stop } = useNavigation(session);
  if (status === 'idle' || !progress) return null;
  const next = progress.nextStep ?? progress.step;
  return (
    <View>
      <Text>{status === 'arrived' ? 'Đã đến nơi' : next.instruction}</Text>
      <Text>{formatDistanceShort(progress.distanceToStep_m)} · còn {Math.round(progress.remaining_s / 60)} phút</Text>
      <Button title="Dừng" onPress={() => void stop()} />
    </View>
  );
}
```

Sự kiện trên phiên: mọi sự kiện core (`progress`, `step`, `announce`, `offRoute`, `reroute`,
`arrive`…) cộng `route` (tuyến đổi), `positionError`, `voiceUnavailable`, `backgroundUnavailable`,
`end`. Trên map: `useMap().navigation.on('followChange', …)` và `recenter()` để bật lại bám camera
sau khi người dùng kéo bản đồ.

Tuỳ biến bản đồ: `follow={{ zoom: 17, pitch: 60 }}` hoặc `follow={false}`; `puck={false}` để tự vẽ
từ `progress.snapped`; `routeStyle={{ color: '#0a7', altColor: '#999' }}`; `onRouteClick` để đổi
tuyến thay thế (`useMap().routes.setActive(i)` rồi `session.start({ response, routeIndex: i })`).

## 5. Nền và quyền — điều gì xảy ra

| Tình huống | SDK làm gì |
|---|---|
| App cấu hình đủ (mục 2) | `startLocationUpdatesAsync` + task: GPS và câu đọc tiếp tục khi khoá máy. iOS hiện chỉ báo vị trí nền màu xanh; Android hiện thông báo "Đang dẫn đường" (đổi chữ bằng `expoNavigation({ notification: { title, body } })`) |
| Thiếu `defineNavigationTask()` | rơi về tiền cảnh, phát `backgroundUnavailable { reason: 'task_not_defined' }` |
| Thiếu plugin / `UIBackgroundModes` | rơi về tiền cảnh, `reason: 'not_configured'` |
| Người dùng từ chối vị trí | `positionError { code: 'denied' }`; phiên vẫn `navigating` chờ, không có fix |
| App bị giết rồi iOS đánh thức lại | task tự dừng vì không còn phiên nào nghe |

Một thiết bị chỉ có một task nền: phiên thứ hai bật nền khi phiên đầu còn chạy sẽ dùng chung task —
hãy `stop()` phiên cũ trước.

## 6. Giọng đọc và âm thanh

`expoSpeech()` đọc bằng giọng hệ thống (`vi-VN`; iOS có sẵn, Android tuỳ gói TTS đã cài — thiếu
thì `voiceUnavailable`). `expoAudioSession()` bật phát khi máy im lặng và khi nền, làm nhỏ nhạc đang
phát (`duckOthers`). App có cấu hình âm thanh riêng: bỏ `audio` khỏi phiên. Tắt giọng cho một lượt:
`start({ response, voice: false })`; đổi tốc độ: `voice: { rate: 1.1 }`.

## 7. Tự cắm nguồn vị trí riêng

App đã có luồng GPS (báo vị trí tài xế về máy chủ) hoặc app khách muốn hiện tiến độ tài xế từ feed
máy chủ: đừng chạy hai luồng GPS — bơm fix của bạn vào phiên.

```ts
import type { GeoFix, PositionSource } from '@mapslibvn/react-native';

const fromMyFeed: PositionSource = {
  subscribe(onFix, onError) {
    const off = myFeed.on('position', (p) =>
      onFix({ lng: p.lng, lat: p.lat, accuracy_m: p.acc, heading: p.heading ?? null, speed_mps: p.speed ?? null, timestamp: p.ts }),
    );
    myFeed.on('error', (e) => onError?.({ code: 'unavailable', message: String(e) }));
    return off;
  },
};
const session = createNavigationSession({ provider: client, source: fromMyFeed, speech: expoSpeech() });
```

`timestamp` là nguồn thời gian duy nhất của máy trạng thái — phải tăng dần. Không cần Expo location
cho đường này; muốn không đọc gì thì bỏ `speech`.

## 8. Thử không cần ra đường

```ts
import { createNavigationSession, playbackSource, simulateFixes } from '@mapslibvn/react-native';
import { expoSpeech } from '@mapslibvn/react-native/expo';

const sim = createNavigationSession({
  provider: client,
  source: playbackSource(simulateFixes(response.routes[0], { jitter_m: 4 }), { rate: 4 }),
  speech: expoSpeech(),
});
await sim.start({ response });
```

App thử `examples/embed-rn` trong repo có nút "Giả lập" làm đúng việc này và hiện số fix, sai số,
số lần tính lại để ghi evidence.

## 9. Khác với web

| Web | React Native |
|---|---|
| `map.navigation.start()` đồng bộ | `session.start()` trả Promise (chờ quyền, đăng ký task) |
| Phiên gắn với map | Phiên độc lập, `navigation={session}`; một phiên gắn nhiều map |
| `follow` là tuỳ chọn của `start()` | `follow` là prop của map — mỗi map tự quyết |
| Wake Lock, không có nền | Keep-awake khi app mở; **có nền** qua expo-location + task |
| `speechSynthesis` | expo-speech; iOS cần expo-audio để phát khi khoá máy |

## 10. La bàn và con quay hồi chuyển

`expoNavigation()` đã kèm nguồn hướng `expoHeadingSource()`: la bàn từ `expo-location`
(`watchHeadingAsync`, bắc thật, mức tin cậy 0–3 của hệ) trộn với con quay hồi chuyển từ `expo-sensors`
qua bộ lọc bù trong core (gyro phản ứng ngay khi xoay máy, la bàn kéo về để không trôi). iOS đã trộn
sẵn ở CoreLocation; gyro chủ yếu làm mượt Android.

Trong dẫn đường, SDK dùng hướng như sau:

| Tình huống | Puck | Camera |
|---|---|---|
| Đang chạy (`speed_mps` > 1) | theo GPS như cũ | theo hướng đi |
| Đứng yên / dưới 1 m/s (đèn đỏ, chờ khách) | **xoay theo điện thoại** | không đổi |
| `follow={{ bearing: 'heading' }}` | như trên | **xoay theo la bàn** (thưa: ≥ 250 ms, ≥ 2°) — hợp đi bộ, đi xe dễ chóng mặt |
| Hướng `unreliable` (từ kế nhiễu, chưa hiệu chuẩn) | về hướng tuyến | không xoay theo la bàn |

Đọc hướng ở bất kỳ đâu:

```tsx
import { useHeading } from '@mapslibvn/react-native';

const fix = useHeading(session);          // trong lúc dẫn đường: { heading, magnetic?, accuracy, timestamp, source }
const fix2 = useHeading(headingSource);   // ngoài dẫn đường: hook tự đăng ký theo vòng đời component
```

Sự kiện trên phiên: `heading` (mỗi mẫu đã lọc), `headingUnavailable` (từ chối quyền vị trí, máy không
có la bàn — một lần mỗi `start`). `accuracy` là `unreliable | low | medium | high`; `source` là `compass`
hay `fused` (đã có gyro góp vào).

Tắt: `expoNavigation({ heading: false })`. Chỉnh bộ lọc: `expoNavigation({ heading: { tau_s: 1, gyro: false } })`.
Nguồn hướng riêng (feed máy chủ, SDK cảm biến khác) ≤ 15 dòng:

```ts
import type { HeadingSource } from '@mapslibvn/react-native';

const fromMyFeed: HeadingSource = {
  subscribe(onHeading, onError) {
    const off = myFeed.on('heading', (h) =>
      onHeading({ heading: h.deg, accuracy: 'medium', timestamp: Date.now(), source: 'compass' }),
    );
    myFeed.on('error', (e) => onError?.({ code: 'unavailable', message: String(e) }));
    return off;
  },
};
const session = createNavigationSession({ provider: client, ...expoNavigation({ heading: false }), heading: fromMyFeed });
```

Chấm xanh có nón hướng **ngoài** dẫn đường: prop `userLocation` — xem [React Native](/react-native/) mục 6.

## 11. Giới hạn hiện tại

- Nội dung thông báo foreground service Android cố định từ lúc `start()` (không đổi theo câu rẽ).
- Chưa có config plugin riêng của MapsLibVN — cấu hình theo mục 2.
- Chưa ETA theo giao thông, làn đường, map-matching máy chủ, tiles offline (giống web).
- Gói chưa publish npm — cài từ tarball như [React Native](/react-native/) mục 7.
- La bàn tham chiếu cạnh trên máy ở tư thế **dọc**; app xoay ngang chưa được bù.
- Simulator iOS không có la bàn (`headingUnavailable`); Android emulator chỉ có cảm biến ảo.
- Android cần hiệu chuẩn la bàn lần đầu (xoay máy hình số 8) — trước đó `accuracy` là `low`/`unreliable`.
- Giá đỡ điện thoại có nam châm trên xe máy làm từ kế nhiễu → `unreliable`, SDK tự về hướng tuyến.

Đọc thêm: [Dẫn đường (web)](/dan-duong/), [React Native](/react-native/), [REST API — directions](/api/#get-v1directions).
