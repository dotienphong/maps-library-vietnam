# @mapslibvn/react

[![npm version](https://img.shields.io/npm/v/@mapslibvn/react.svg)](https://www.npmjs.com/package/@mapslibvn/react)
[![npm downloads](https://img.shields.io/npm/dm/@mapslibvn/react.svg)](https://www.npmjs.com/package/@mapslibvn/react)
[![minzipped size](https://img.shields.io/bundlephobia/minzip/@mapslibvn/react)](https://bundlephobia.com/package/@mapslibvn/react)
[![license](https://img.shields.io/npm/l/@mapslibvn/react.svg)](https://www.npmjs.com/package/@mapslibvn/react)

**[Website](https://mapslibvn.pages.dev/) · [Pricing](https://mapslibvn.pages.dev/bang-gia/) · [Docs](https://mapslibvn-docs.pages.dev/react/)**

**Idiomatic React bindings for MapsLibVN.** Drop a Vietnam-ready map, search box and turn-by-turn navigation into any React app with `<MapsLibVNMap>`, `<Marker>`, `useMap()`, `usePlaces()` and `useNavigation()` — no imperative MapLibre plumbing required.

Built on top of [`@mapslibvn/web`](https://www.npmjs.com/package/@mapslibvn/web) and [`@mapslibvn/core`](https://www.npmjs.com/package/@mapslibvn/core), so every feature of the underlying engine (Vietnamese search, POI sources, navigation) is available through familiar React patterns.

## Why teams pick it

- ⚛️ **Declarative by default** — `<MapsLibVNMap>` mounts a real MapLibre map, exposes it through `useMap()`, and only renders `children` (markers, overlays) once the map is ready.
- 🧠 **Smart re-renders** — changing `apiKey`, `style`, `center` or `zoom` recreates the map; changing `onLoad`, `onPoiClick`, `className` or `children` does not, so inline handlers are safe to pass every render.
- 🔎 **`usePlaces()` autocomplete hook** — debounced, cancels stale requests, keeps previous results while loading (SWR-style), and needs only 2 characters to start searching.
- 🧭 **`useNavigation()`** — subscribe to turn-by-turn `status` and `progress` from anywhere in your component tree, backed by the same navigation engine as the web SDK.
- 🇻🇳 **All of `@mapslibvn/core`'s Vietnamese search smarts** — diacritics-insensitive matching, address parsing, and configurable POI sources (OSM / Foursquare) — available through simple props.

## Install

```bash
npm install @mapslibvn/react maplibre-gl@^6.4.1 react
```

Requires React 18+ and a WebGL2-capable browser. Load MapLibre's CSS once at your app's entry point.

## Quick start

```tsx
import { MapsLibVNMap, Marker } from '@mapslibvn/react';
import 'maplibre-gl/dist/maplibre-gl.css';

export function BanDo() {
  return (
    <MapsLibVNMap
      apiKey="mlv_live_…"
      apiBase="https://api.ai-solutions.io.vn"
      containerStyle={{ height: 400 }}
    >
      <Marker lng={106.6981} lat={10.7725} />
    </MapsLibVNMap>
  );
}
```

The parent element needs a real height. Don't hide or disable attribution; Web keys must be origin-restricted.

📖 Docs: <https://mapslibvn-docs.pages.dev/react/>

📦 Part of the MapsLibVN SDK family: [`@mapslibvn/core`](https://www.npmjs.com/package/@mapslibvn/core) · [`@mapslibvn/web`](https://www.npmjs.com/package/@mapslibvn/web) · [`@mapslibvn/react-native`](https://www.npmjs.com/package/@mapslibvn/react-native)

Source license: MIT; see `THIRD_PARTY_NOTICES.md` for dependency and data licenses.

---

## Tiếng Việt

**Binding React chuẩn phong cách cho MapsLibVN.** Đưa bản đồ, ô tìm kiếm và dẫn đường "Việt Nam trước" vào bất kỳ app React nào chỉ với `<MapsLibVNMap>`, `<Marker>`, `useMap()`, `usePlaces()` và `useNavigation()` — không cần tự tay nối dây MapLibre theo kiểu mệnh lệnh.

Xây trên nền [`@mapslibvn/web`](https://www.npmjs.com/package/@mapslibvn/web) và [`@mapslibvn/core`](https://www.npmjs.com/package/@mapslibvn/core), nên mọi tính năng của engine bên dưới (tìm kiếm tiếng Việt, chọn nguồn POI, dẫn đường) đều dùng được qua các pattern React quen thuộc.

## Vì sao nên chọn

- ⚛️ **Khai báo (declarative) theo mặc định** — `<MapsLibVNMap>` dựng một bản đồ MapLibre thật, đưa ra ngoài qua `useMap()`, và chỉ render `children` (marker, lớp phủ) sau khi bản đồ đã sẵn sàng.
- 🧠 **Re-render thông minh** — đổi `apiKey`, `style`, `center` hay `zoom` sẽ tạo lại bản đồ; đổi `onLoad`, `onPoiClick`, `className` hay `children` thì không, nên truyền handler dạng inline mỗi lần render vẫn an toàn.
- 🔎 **Hook autocomplete `usePlaces()`** — có debounce, huỷ request cũ khi có request mới, giữ kết quả cũ trong lúc tải (kiểu SWR), chỉ cần 2 ký tự là bắt đầu tìm.
- 🧭 **`useNavigation()`** — theo dõi `status` và `progress` dẫn đường từ bất kỳ đâu trong cây component, dùng chung engine dẫn đường với SDK web.
- 🇻🇳 **Trọn vẹn khả năng tìm kiếm tiếng Việt của `@mapslibvn/core`** — khớp không phân biệt dấu, phân tích địa chỉ, và chọn nguồn POI (OSM / Foursquare) — tất cả chỉ qua vài prop đơn giản.

## Cài đặt

```bash
npm install @mapslibvn/react maplibre-gl@^6.4.1 react
```

Yêu cầu React 18+ và trình duyệt hỗ trợ WebGL2. Nạp CSS của MapLibre một lần ở điểm vào ứng dụng.

## Bắt đầu nhanh

```tsx
import { MapsLibVNMap, Marker } from '@mapslibvn/react';
import 'maplibre-gl/dist/maplibre-gl.css';

export function BanDo() {
  return (
    <MapsLibVNMap
      apiKey="mlv_live_…"
      apiBase="https://api.ai-solutions.io.vn"
      containerStyle={{ height: 400 }}
    >
      <Marker lng={106.6981} lat={10.7725} />
    </MapsLibVNMap>
  );
}
```

Phần tử cha phải có chiều cao thật. Không tắt hoặc che attribution; khóa Web phải giới hạn đúng origin.

📖 Tài liệu: <https://mapslibvn-docs.pages.dev/react/>

📦 Nằm trong họ SDK MapsLibVN: [`@mapslibvn/core`](https://www.npmjs.com/package/@mapslibvn/core) · [`@mapslibvn/web`](https://www.npmjs.com/package/@mapslibvn/web) · [`@mapslibvn/react-native`](https://www.npmjs.com/package/@mapslibvn/react-native)

Giấy phép mã nguồn: MIT; xem `THIRD_PARTY_NOTICES.md` cho giấy phép phụ thuộc và dữ liệu.
