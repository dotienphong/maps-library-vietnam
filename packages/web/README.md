# @mapslibvn/web

[![npm version](https://img.shields.io/npm/v/@mapslibvn/web.svg)](https://www.npmjs.com/package/@mapslibvn/web)
[![npm downloads](https://img.shields.io/npm/dm/@mapslibvn/web.svg)](https://www.npmjs.com/package/@mapslibvn/web)
[![minzipped size](https://img.shields.io/bundlephobia/minzip/@mapslibvn/web)](https://bundlephobia.com/package/@mapslibvn/web)
[![license](https://img.shields.io/npm/l/@mapslibvn/web.svg)](https://www.npmjs.com/package/@mapslibvn/web)

**A production-ready web map SDK for Vietnam.** `@mapslibvn/web` wraps MapLibre GL JS and PMTiles into a single `createMap()` call — vector tiles, Vietnamese/English labels, a built-in accessible search box, and turn-by-turn navigation, with attribution handled correctly out of the box.

Framework-agnostic: drop it into a plain HTML page via `<script>`, or use it as the engine under [`@mapslibvn/react`](https://www.npmjs.com/package/@mapslibvn/react).

## Why teams pick it

- 🗺️ **One call to a working map** — `createMap()` sets up the style, vector tiles (via PMTiles, no tile server to run), attribution and language in one step.
- 🔎 **Autocomplete that just works** — the `<mapslibvn-autocomplete>` Web Component ships as an accessible ARIA combobox (keyboard navigation, live region, debounced requests) that drops into any stack — vanilla JS, Vue, Svelte, plain HTML — no React required.
- 🧭 **Turn-by-turn navigation layer** — route rendering, camera follow, automatic rerouting and Vietnamese voice guidance (Web Speech API) via `map.navigation`.
- 🌐 **Bilingual labels** — switch between Vietnamese and English map labels at runtime with `applyLanguage`; sovereignty-sensitive labels always stay in Vietnamese.
- 📦 **Ship it your way** — a tree-shakeable ESM build (`dist/index.js`, ≤ 15 kB gzip) for bundlers, or a self-contained UMD bundle with MapLibre and PMTiles baked in for a plain `<script>` tag.
- ⚖️ **Attribution can't be silently dropped** — `createMap` always injects the required attribution control; there's no option to hide it, by design.

## Install

```bash
npm install @mapslibvn/web maplibre-gl@^6.4.1
```

MapLibre GL JS 6 requires a WebGL2-capable browser. Load MapLibre's CSS once at your app's entry point.

## Quick start (ESM)

```ts
import { createMap } from '@mapslibvn/web';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const map = createMap(
  {
    container: 'map',
    apiKey: 'mlv_live_…',
    apiBase: 'https://api.ai-solutions.io.vn',
    center: [106.7, 10.776],
    zoom: 13,
  },
  { maplibre: maplibregl },
);
```

The UMD build at `@mapslibvn/web/umd` bundles MapLibre and PMTiles for you. If you self-host the UMD file, place `maplibre-gl-worker.mjs` and `maplibre-gl-shared.mjs` next to `mapslibvn.umd.js`. Don't hide or disable attribution. Never ship a secret key in client-side code — Web keys must be origin-restricted.

📖 Docs: <https://mapslibvn-docs.pages.dev/ban-do-web/>

📦 Part of the MapsLibVN SDK family: [`@mapslibvn/core`](https://www.npmjs.com/package/@mapslibvn/core) · [`@mapslibvn/react`](https://www.npmjs.com/package/@mapslibvn/react) · [`@mapslibvn/react-native`](https://www.npmjs.com/package/@mapslibvn/react-native)

Source license: MIT; see `THIRD_PARTY_NOTICES.md` for dependency and data licenses.

---

## Tiếng Việt

**SDK bản đồ web sẵn sàng cho production, dành cho Việt Nam.** `@mapslibvn/web` gói MapLibre GL JS và PMTiles vào đúng một lệnh `createMap()` — vector tiles, nhãn song ngữ Việt/Anh, ô tìm kiếm dễ tiếp cận có sẵn, và dẫn đường chỉ đường, với attribution được xử lý đúng ngay từ đầu.

Không phụ thuộc framework: nhúng thẳng vào trang HTML thuần bằng `<script>`, hoặc dùng làm engine bên dưới [`@mapslibvn/react`](https://www.npmjs.com/package/@mapslibvn/react).

## Vì sao nên chọn

- 🗺️ **Một lệnh ra bản đồ chạy được ngay** — `createMap()` dựng sẵn style, vector tiles (qua PMTiles, không cần chạy tile server riêng), attribution và ngôn ngữ trong một bước.
- 🔎 **Autocomplete dùng được ngay** — web component `<mapslibvn-autocomplete>` là một combobox ARIA dễ tiếp cận (điều hướng bàn phím, vùng live, debounce request) nhúng được vào bất kỳ stack nào — vanilla JS, Vue, Svelte, HTML thuần — không cần React.
- 🧭 **Lớp dẫn đường trọn gói** — vẽ tuyến, camera bám theo, tự tính lại khi lệch tuyến và đọc thoại tiếng Việt (Web Speech API) qua `map.navigation`.
- 🌐 **Nhãn song ngữ** — đổi nhãn bản đồ giữa tiếng Việt và tiếng Anh ngay lúc chạy bằng `applyLanguage`; nhãn liên quan chủ quyền luôn giữ tiếng Việt.
- 📦 **Chọn cách đóng gói theo ý bạn** — bản ESM tree-shake được (`dist/index.js`, ≤ 15 kB gzip) cho các bundler, hoặc bản UMD tự chứa đã đóng gói sẵn MapLibre và PMTiles để dùng thẳng bằng thẻ `<script>`.
- ⚖️ **Không thể lặng lẽ tắt attribution** — `createMap` luôn tự thêm control ghi nguồn bắt buộc; không có tuỳ chọn ẩn nó, đây là chủ đích thiết kế.

## Cài đặt

```bash
npm install @mapslibvn/web maplibre-gl@^6.4.1
```

MapLibre GL JS 6 yêu cầu trình duyệt hỗ trợ WebGL2. Nạp CSS của MapLibre một lần ở điểm vào ứng dụng.

## Bắt đầu nhanh (ESM)

```ts
import { createMap } from '@mapslibvn/web';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const map = createMap(
  {
    container: 'map',
    apiKey: 'mlv_live_…',
    apiBase: 'https://api.ai-solutions.io.vn',
    center: [106.7, 10.776],
    zoom: 13,
  },
  { maplibre: maplibregl },
);
```

Bản UMD tại export `@mapslibvn/web/umd` đóng gói sẵn MapLibre và PMTiles. Khi tự phục vụ UMD, đặt `maplibre-gl-worker.mjs` và `maplibre-gl-shared.mjs` cạnh `mapslibvn.umd.js`. Không tắt hoặc che attribution. Không đưa khóa bí mật vào mã nguồn; khóa Web phải giới hạn đúng origin.

📖 Tài liệu: <https://mapslibvn-docs.pages.dev/ban-do-web/>

📦 Nằm trong họ SDK MapsLibVN: [`@mapslibvn/core`](https://www.npmjs.com/package/@mapslibvn/core) · [`@mapslibvn/react`](https://www.npmjs.com/package/@mapslibvn/react) · [`@mapslibvn/react-native`](https://www.npmjs.com/package/@mapslibvn/react-native)

Giấy phép mã nguồn: MIT; xem `THIRD_PARTY_NOTICES.md` cho giấy phép phụ thuộc và dữ liệu.
