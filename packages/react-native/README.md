# @mapslibvn/react-native

[![npm version](https://img.shields.io/npm/v/@mapslibvn/react-native.svg)](https://www.npmjs.com/package/@mapslibvn/react-native)
[![npm downloads](https://img.shields.io/npm/dm/@mapslibvn/react-native.svg)](https://www.npmjs.com/package/@mapslibvn/react-native)
[![license](https://img.shields.io/npm/l/@mapslibvn/react-native.svg)](https://www.npmjs.com/package/@mapslibvn/react-native)

**Native maps and voice-guided navigation for Vietnam, built for React Native.** `@mapslibvn/react-native` wraps `@maplibre/maplibre-react-native` behind the same API shape as [`@mapslibvn/react`](https://www.npmjs.com/package/@mapslibvn/react), so a team that already ships the web SDK can bring the exact same mental model to iOS and Android.

Works with Expo (bare or managed, not Expo Go) and bare React Native apps alike. Example app: `examples/embed-rn`.

## Why teams pick it

- 📱 **Same API as the web SDK** — `<MapsLibVNMap>`, `<Marker>`, `useMap()`, `usePlaces()` — if your team already knows `@mapslibvn/react`, there's almost nothing new to learn.
- 🧭 **Turn-by-turn navigation that survives your app** — `createNavigationSession()` runs independently of any mounted map component. It keeps going across screen transitions, so you can pop up a full-screen navigation view on top of your existing app (ride-hailing style) without losing state.
- 🔊 **Voice guidance that keeps talking, even locked** — background location updates and Vietnamese TTS continue to work with the screen locked, verified on real hardware (not just a simulator).
- 🧩 **Opt-in Expo integration** — location, background task, speech, audio-session and keep-awake support ship through the `@mapslibvn/react-native/expo` entry point, as optional peer dependencies. Not using navigation? You don't install any of them. Building a bare app? Swap in your own GPS/audio source.
- 🔐 **Privacy-conscious by default** — only requests "When In Use" location permission, never "Always".
- 🧭 **Compass + gyroscope, opt-in** — the puck turns with the phone while you're stopped at a light, a blue dot with a heading cone before the ride starts, and `useHeading()` for your own UI (rotate the driver icon, send heading to your server). Ships through the same `/expo` entry.
- 🚀 **New Architecture ready** — built and tested against React Native's New Architecture and current Expo SDKs.

## Requirements

React ≥ 19.1, React Native ≥ 0.80, New Architecture, Expo ≥ 54 (does not run on Expo Go). Full guide: the "React Native" page in the docs.

## Install

```bash
npm install @mapslibvn/react-native
npx expo install @maplibre/maplibre-react-native expo-application
```

## Quick start

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

Mobile keys must be scoped to your bundle/application id. Don't hide or disable attribution.

## Turn-by-turn navigation

```tsx
// index.ts — global scope, before registerRootComponent
import { defineNavigationTask } from '@mapslibvn/react-native/expo';
defineNavigationTask();
```

```tsx
import { MapsLibVNMap, createClient, createNavigationSession, useNavigation } from '@mapslibvn/react-native';
import { expoNavigation } from '@mapslibvn/react-native/expo';

const client = createClient({ apiKey, baseUrl: apiBase });
const session = createNavigationSession({ provider: client, ...expoNavigation() }); // lives outside the React tree

const response = await client.directions({ from: [10.7798, 106.699], to: [10.7725, 106.698], mode: 'motorbike' });
await session.start({ response });               // GPS even when locked, Vietnamese voice, auto-reroute on drift

<MapsLibVNMap {...props} navigation={session} />  // mounts to draw the route, puck and follow camera; unmounting doesn't stop the session
const { status, progress } = useNavigation(session); // usable anywhere
```

You'll need `npx expo install expo-location expo-task-manager expo-speech expo-audio expo-sensors` plus the corresponding `app.json` plugin config (see docs). Have your own GPS pipeline? Pass your own `source` instead of `expoNavigation()`.

## Compass and heading

```tsx
import { useHeading } from '@mapslibvn/react-native';
import { expoHeadingSource, expoLocationSource } from '@mapslibvn/react-native/expo';

const heading = expoHeadingSource();                                     // compass + gyro, one shared native subscription
<MapsLibVNMap {...props} userLocation={{ source: expoLocationSource({ background: false }), heading, follow: 'heading' }} />
const fix = useHeading(heading);                                         // { heading, accuracy, source } anywhere in your app
```

`expoNavigation()` already includes the heading source, so the navigation puck follows the phone while stationary (≤ 1 m/s) and goes back to GPS when moving. Pass `follow={{ bearing: 'heading' }}` for a heading-up camera while walking.

📖 Docs: <https://mapslibvn-docs.pages.dev/react-native/> and <https://mapslibvn-docs.pages.dev/dan-duong-react-native/>

📦 Part of the MapsLibVN SDK family: [`@mapslibvn/core`](https://www.npmjs.com/package/@mapslibvn/core) · [`@mapslibvn/web`](https://www.npmjs.com/package/@mapslibvn/web) · [`@mapslibvn/react`](https://www.npmjs.com/package/@mapslibvn/react)

Source license: MIT; see `THIRD_PARTY_NOTICES.md` for dependency and data licenses.

---

## Tiếng Việt

**Bản đồ native và dẫn đường có giọng nói cho Việt Nam, dành cho React Native.** `@mapslibvn/react-native` bọc `@maplibre/maplibre-react-native` theo đúng hình dạng API của [`@mapslibvn/react`](https://www.npmjs.com/package/@mapslibvn/react), nên một đội đã dùng SDK web có thể mang nguyên mô hình tư duy đó sang iOS và Android.

Dùng được với cả Expo (bare hoặc managed, không chạy trên Expo Go) và app React Native bare. App thử: `examples/embed-rn`.

## Vì sao nên chọn

- 📱 **Cùng API với SDK web** — `<MapsLibVNMap>`, `<Marker>`, `useMap()`, `usePlaces()` — nếu đội đã quen `@mapslibvn/react` thì gần như không phải học gì mới.
- 🧭 **Dẫn đường sống độc lập với app** — `createNavigationSession()` chạy tách khỏi bất kỳ component bản đồ nào đang gắn. Phiên vẫn tiếp tục qua các lần chuyển màn hình, nên có thể bật một view dẫn đường toàn màn hình đè lên app hiện có (kiểu app gọi xe) mà không mất trạng thái.
- 🔊 **Giọng đọc không tắt kể cả khi khoá máy** — định vị nền và TTS tiếng Việt vẫn hoạt động khi khoá màn hình, đã xác nhận trên máy thật (không chỉ trên giả lập).
- 🧩 **Tích hợp Expo theo kiểu tuỳ chọn** — định vị, background task, giọng đọc, phiên âm thanh và giữ máy thức đi qua entry point `@mapslibvn/react-native/expo`, dưới dạng peer dependency tuỳ chọn. Không dùng dẫn đường? Không cần cài gói nào trong số đó. Làm app bare? Tự thay bằng nguồn GPS/âm thanh riêng.
- 🔐 **Tôn trọng quyền riêng tư mặc định** — chỉ xin quyền định vị "When In Use", không bao giờ xin "Always".
- 🧭 **La bàn + con quay hồi chuyển, tuỳ chọn** — puck xoay theo điện thoại khi dừng đèn đỏ, chấm xanh có nón hướng trước khi bắt đầu chuyến, `useHeading()` cho UI riêng (xoay icon tài xế, gửi hướng về máy chủ). Đi cùng entry `/expo`.
- 🚀 **Sẵn sàng cho New Architecture** — được build và kiểm thử trên New Architecture của React Native cùng các bản Expo SDK hiện hành.

## Yêu cầu

React ≥ 19.1, React Native ≥ 0.80, New Architecture, Expo ≥ 54 (không chạy trên Expo Go). Hướng dẫn đầy đủ: trang "React Native" trong docs.

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

## Dẫn đường

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

Cần `npx expo install expo-location expo-task-manager expo-speech expo-audio expo-sensors` và plugin trong `app.json` (xem docs). App có luồng GPS riêng: truyền `source` của bạn thay `expoNavigation()`.

## La bàn và hướng

```tsx
import { useHeading } from '@mapslibvn/react-native';
import { expoHeadingSource, expoLocationSource } from '@mapslibvn/react-native/expo';

const heading = expoHeadingSource();                                     // la bàn + gyro, một đăng ký native dùng chung
<MapsLibVNMap {...props} userLocation={{ source: expoLocationSource({ background: false }), heading, follow: 'heading' }} />
const fix = useHeading(heading);                                         // { heading, accuracy, source } ở bất kỳ đâu
```

`expoNavigation()` đã kèm nguồn hướng: puck dẫn đường xoay theo máy khi đứng yên (≤ 1 m/s), chạy lại theo GPS. Truyền `follow={{ bearing: 'heading' }}` để bản đồ xoay theo hướng nhìn khi đi bộ.

📖 Tài liệu: <https://mapslibvn-docs.pages.dev/react-native/> và <https://mapslibvn-docs.pages.dev/dan-duong-react-native/>

📦 Nằm trong họ SDK MapsLibVN: [`@mapslibvn/core`](https://www.npmjs.com/package/@mapslibvn/core) · [`@mapslibvn/web`](https://www.npmjs.com/package/@mapslibvn/web) · [`@mapslibvn/react`](https://www.npmjs.com/package/@mapslibvn/react)

Giấy phép mã nguồn: MIT; xem `THIRD_PARTY_NOTICES.md` cho giấy phép phụ thuộc và dữ liệu.
