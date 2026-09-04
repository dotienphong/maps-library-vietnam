# Plan — Hoàn chỉnh website docs `mapslibvn-docs.pages.dev`

Spec: `docs/superpowers/specs/2026-09-04-docs-site-hoan-chinh-design.md` (đọc trước). Lập kế hoạch:
Claude Fable 5.1 (04/09/2026). Thực hiện: Claude Opus 5, mỗi task một subagent; Task 1–4 chạy song
song (file rời nhau), Task 5 chạy sau khi 1–4 xong, Task 6 là cổng cuối.

## Quy ước chung cho mọi task

- Làm việc tại `/Users/dtphong/Desktop/software_business/mapsLibVN`, nhánh `main`, **không commit,
  không push** (Fable duyệt rồi chủ dự án quyết định).
- Trước khi viết một câu về hành vi, mở file nguồn tương ứng và đối chiếu: `packages/core/src/{client,
  types,errors,attribution}.ts`, `packages/web/src/{map,autocomplete-element,language,umd}.ts`,
  `packages/react/src/*.tsx|ts`, `apps/api/src/{auth,quota,errors,params,index}.ts`,
  `apps/api/src/routes/*.ts`, `db/seed/tenant_internal.sql`, `db/seed/category.json`.
- Tiếng Việt đủ dấu; định danh mã giữ nguyên; frontmatter `title` + `description`; H2 đánh số
  "## 1. …" như các trang hiện có; câu ngắn.
- Không nêu số liệu không có trong repo. Không nhắc ứng dụng khác của tác giả. Endpoint
  `https://api.ai-solutions.io.vn` và `https://mapslibvn-docs.pages.dev` luôn kèm ghi chú "tạm thời".
- Khoá ví dụ trong mã: `mlv_live_…`. Khoá demo chỉ nêu ở `/khoa-api/`, `/nhung-thu/` và playground.
- Starlight 0.30.6 — dùng được `Tabs`/`TabItem`, `Card`/`CardGrid`, `LinkCard`, `Aside`, `Steps`,
  `Code` từ `@astrojs/starlight/components` (file phải là `.mdx` khi dùng component).
- Kết mỗi task: `pnpm lint` và `pnpm --filter @mapslibvn/docs build` phải xanh (Task 5 mới thêm slug
  vào sidebar, nên Task 1–4 **không sửa** `astro.config.mjs`; trang mới vẫn build được dù chưa có
  trong sidebar). Báo cáo: file đã tạo/sửa, lệnh đã chạy và kết quả, điều gì chưa chắc.

## Bảng sự thật (Fable đã đối chiếu 04/09/2026 — vẫn phải mở file khi viết chi tiết)

**REST** (`apps/api/src`): xác thực `X-Api-Key` hoặc `?key=`; khoá `web` so `Origin`/`Referer` theo
protocol + hostname mọi port, wildcard `*.`, không có Origin → cho qua; `mobile` log `X-Bundle-Id`;
scope mặc định `places:read`, `POST /v1/edits` cần `edits:write`. Lỗi: 401 `missing_key`/`invalid_key`,
403 `scope`/`origin_not_allowed`, 400 `invalid_request`, 404 `not_found`, 429 `quota_exceeded`
(`retry-after: 3600`), 503 `upstream_unavailable`/`server_misconfigured` (`retry-after: 30`); body
`{ error: { code, message, request_id } }`. Quota plan free 20.000 Places/ngày giờ VN, chặn ở 2×
(đếm xấp xỉ), tenant internal không đếm. Endpoint: `/v1/autocomplete` (q ≥ 2, `near` "lat,lng",
`limit` 1–10 mặc định 10, `types` poi,street,address; cache 10 phút, stale 1 giờ), `/v1/search`
(≥ 1 trong q/category/near/bbox; `radius` 1–50000 mặc định 5000; `limit` 1–50 mặc định 20;
`offset` 0–500; `bbox` "minLng,minLat,maxLng,maxLat"; trả `{items,total}`), `/v1/nearby` (lat, lng;
`radius` 1–5000 mặc định 500; `limit` 1–100 mặc định 20; `category`), `/v1/places/{id}` (active |
closed; pending chỉ tenant tạo; cache 1 giờ), `/v1/geocode` (`limit` 1–5), `/v1/reverse` (đường
150 m, mốc số nhà 300 m, POI 100 m), `POST /v1/edits`, `/v1/attribution` (cache 24 giờ, không cần
khoá), `/v1/styles/{light|dark}.json` (cache 1 giờ, route không kiểm khoá nhưng SDK vẫn gắn `?key=`),
`/healthz`. Category: 164 mã trong 13 nhóm `food_drink, shopping, services, health, education, finance,
lodging, entertainment_sport, culture_tourism, transport, public_admin, religion_community, other`.

**SDK**: `createClient({apiKey, baseUrl, fetch?, headers?})` → `baseUrl, attribution(), styleUrl(theme),
autocomplete(q,{near,limit,types}), search(q,{category,near,radius,bbox,limit,offset}),
nearby({lat,lng,radius,category,limit}), getPlace(id), geocode(q,{near,limit}), reverse(lat,lng),
suggestEdit(edit)`; `MapsLibVNError { status, code, message, requestId }`. `createMap(opts, deps?)`:
`container, apiKey, apiBase, style='light'|'dark'|URL (mặc định 'light'), center=[106.7,10.776],
zoom=12, lang='vi'|'en', poiLayer=true, compactAttribution=false`; trả `gl, places, addMarker({lng,lat,
popupHtml?,color?}), fitBounds(bbox, padding=40), flyTo(center, zoom?), on/off('load'|'poiClick'),
remove()`; `PoiFeature {id,name,category,group,lngLat}`. ESM cần `maplibre-gl@^5` peer và
`createMap(opts, { maplibre: maplibregl })` (hoặc `globalThis.maplibregl`); UMD `dist/mapslibvn.umd.js`
+ `mapslibvn.css` đóng gói maplibre + pmtiles, global `MapsLibVN` (`createMap`, `maplibregl`,
`createClient`, `MapsLibVNError`, `attributionHtml/Text`, `applyLanguage`, `nameExpression`,
`MapsLibVNAutocomplete`, `defineAutocomplete`) và tự `defineAutocomplete()`. Web component
`<mapslibvn-autocomplete api-key api-base placeholder near>`, thuộc tính JS `.map`, sự kiện `select`
(`detail: AutocompleteItem`). React: `<MapsLibVNMap>` (props = CreateMapOptions trừ container +
`className, containerStyle, onPoiClick, onLoad, children`), `useMap()`, `<Marker lng lat popupHtml?
color?>`, `usePlaces(query, {near, limit, debounceMs=200, client})`. Gói npm **chưa publish** (B3).
Khoá demo `mlv_live_demo00000000000000000000` origin cho phép: `http://localhost`, `http://127.0.0.1`,
`https://mapslibvn-docs.pages.dev`, `https://*.mapslibvn-docs.pages.dev` (mọi port). Liên hệ xin khoá:
Điều khoản tenant mục 10 (`docs/legal/dieu-khoan-tenant.md`).

---

## Task 1 — Trang Cài đặt, Khoá API, Nhúng thử; rút gọn Bắt đầu 5 phút

Files: tạo `apps/docs/src/content/docs/cai-dat.mdx`, `khoa-api.md`, `nhung-thu.md`; sửa `bat-dau.md`.
Nội dung theo spec 5.2 (mục `/cai-dat/`, `/khoa-api/`, `/nhung-thu/`) và đoạn cuối 5.2 cho
`bat-dau.md`. Đọc thêm `examples/embed-web/README.md`, `examples/embed-rn/README.md`,
`apps/docs/src/content/docs/react-native.md`, `docs/legal/dieu-khoan-tenant.md` mục 10,
`docs/legal/checklist-phap-ly.md` hàng B3 (để nói đúng lý do chưa publish: đang rà soát nhãn hiệu).

- [x] 1.1 `cai-dat.mdx` với `Tabs` 4 tab; `Aside type="caution"` trong tab npm và React về việc chưa
  publish; bảng yêu cầu; mục "Kiểm tra đã cài đúng".
- [x] 1.2 `khoa-api.md` đủ 7 phần theo spec.
- [x] 1.3 `nhung-thu.md` với mẫu `index.html` hoàn chỉnh (chép cấu trúc từ `examples/embed-web/index.html`
  nhưng dùng khoá demo + `?key=` override), lệnh chạy server tĩnh, checklist kiểm.
- [x] 1.4 Rút gọn `bat-dau.md`: bỏ bảng tuỳ chọn (trỏ `/ban-do-web/`), thêm Aside npm chưa publish, giữ
  đoạn endpoint tạm và `origin_not_allowed`, thêm "Đọc thêm" trỏ 3 trang mới.
- [x] 1.5 `pnpm lint` + `pnpm --filter @mapslibvn/docs build` xanh; mở `dist/cai-dat/index.html`
  kiểm tab render.

## Task 2 — Trang Tính năng, Bản đồ web, Tìm kiếm & autocomplete, React

Files: tạo `tinh-nang.md`, `ban-do-web.md`, `tim-kiem.md`, `react.md` trong
`apps/docs/src/content/docs/`. Nội dung theo spec 5.2. Nguồn bắt buộc đọc: `packages/web/src/map.ts`,
`autocomplete-element.ts` (toàn file — mô tả đúng debounce, số ký tự tối thiểu, ARIA, phím tắt,
cách `near` được lấy), `language.ts`, `packages/react/src/*`, `packages/core/src/client.ts`,
`apps/docs/src/components/ReactDemo.tsx`, `apps/docs/src/content/docs/tu-host.md` mục 1 (bảng kiến
trúc), `db/seed/category.json` (đếm nhóm, lấy 2–3 mã ví dụ mỗi nhóm), spec gốc
`docs/superpowers/specs/2026-08-26-mapslibvn-maps-sdk-design.md` mục 4 (tiles, chủ quyền) và 7.2.

- [x] 2.1 `tinh-nang.md` — 8 mục theo spec; bảng 13 nhóm POI với 2–3 mã ví dụ thật; bảng endpoint
  một dòng mỗi cái; mục "Giới hạn hiện tại" trung thực (npm chưa publish, endpoint tạm, dữ liệu ngoài
  đô thị lớn thưa hơn — lấy từ `/do-chinh-xac/` mục 4, chưa có tiles offline).
- [x] 2.2 `ban-do-web.md` — bảng `CreateMapOptions` đầy đủ với mặc định thật; ví dụ từng khả năng.
- [x] 2.3 `tim-kiem.md` — web component + 4 phương thức client; bảng "dùng cái nào khi nào".
- [x] 2.4 `react.md` — props/hook đầy đủ; ví dụ tìm-và-ghim.
- [x] 2.5 `pnpm lint` + build docs xanh.

## Task 3 — Tham chiếu REST API và SDK JavaScript

Files: tạo `apps/docs/src/content/docs/api.md` và `sdk.md`. Nội dung theo spec 5.2 (`/api/`, `/sdk/`).
Đọc toàn bộ `apps/api/src/routes/*.ts`, `auth.ts`, `quota.ts`, `errors.ts`, `params.ts`, `index.ts`,
`apps/api/src/edits/*` (chỉ để nêu lỗi/giới hạn của `POST /v1/edits`, chi tiết đã có ở `/dong-gop/`),
`packages/core/src/*.ts` (không test), `packages/web/src/index.ts`, `umd.ts`, `packages/react/src/index.ts`,
`packages/react-native/src/index.ts`.

- [x] 3.1 `api.md` — mục 1 gốc API và xác thực; 2 lỗi và `retry-after`; 3 quota và cache; 4–14 mỗi
  endpoint một H3 với bảng tham số (tên, kiểu, bắt buộc, mặc định, khoảng), `curl` ví dụ, phản hồi rút
  gọn; 15 kiểu dữ liệu chép từ `types.ts`. Ví dụ toạ độ dùng khu trung tâm TP.HCM như trang hiện có.
- [x] 3.2 `sdk.md` — 4 gói theo export thật; bảng "tuỳ chọn → mặc định", "sự kiện → payload", "phương
  thức → endpoint". Với react-native tóm tắt và link `/react-native/`.
- [x] 3.3 `pnpm lint` + build docs xanh.

## Task 4 — Playground mới

Files: viết lại `apps/docs/public/playground.html`; tạo `public/playground.js`, `public/playground.css`,
`public/playground-lib.js`; tạo `apps/docs/scripts/playground-lib.test.mjs`; sửa root
`vitest.config.ts` (include `apps/docs/scripts/**/*.test.mjs`, bỏ `apps/**` khỏi exclude hoặc thu hẹp
exclude thành `apps/**/node_modules/**`, `apps/**/dist/**`, `apps/**/e2e/**`); giữ nguyên
`public/playground-config.js`. Thiết kế theo spec 5.3 — đọc kỹ toàn mục.

Ràng buộc kỹ thuật:
- Chỉ dùng `/sdk/mapslibvn.umd.js` + `/sdk/mapslibvn.css` (đã có sau `prebuild`), không CDN ngoài.
- `#status` giữ `data-state` `loading|loaded|error`; `<mapslibvn-autocomplete id="ac">` luôn trong DOM
  (trừ `?embed=1`), `window.__map` giữ. Test cũ `e2e/playground.spec.ts` phải vẫn đúng.
- Khoá hiển thị trong dòng "Yêu cầu" phải che bằng `maskKey` (giữ 13 ký tự đầu + 4 cuối).
- Không gọi `POST /v1/edits`. Không tải gì ngoài origin docs + API + tiles.
- Vòng tròn ước lượng: `radiusForPrecision`: `rooftop` → 0 (không vẽ), `alley` → 40, `interpolated`
  → 80, `street`/`ward`/`province` → không vẽ vòng, chỉ `fitBounds` nếu có `bbox` hoặc flyTo zoom 15/13/10.
- Bố cục và màu: nền bảng `#fff`, chữ `#172033`, nhấn `#2458a6` (khớp `ReactDemo`/autocomplete);
  `prefers-color-scheme: dark` tối thiểu đổi nền bảng và chữ. Font `system-ui`.
- Khả năng tiếp cận: tab có `role=tab`/`aria-selected`/`aria-controls`, nút có nhãn, kết quả là
  `<button>` trong `<ul>`, `#status` có `aria-live="polite"`.

- [x] 4.1 Viết `playground-lib.js` (6 hàm thuần theo spec, JSDoc kiểu) và test Vitest trước (TDD):
  parse/serialize state (mặc định: style light, lang vi, poi 1, compact 0, center 106.700,10.776,
  zoom 14, key demo, api theo `resolveApiBase` — hàm nhận `apiBase` từ ngoài), `buildSnippet`
  (`'script'` và `'esm'`, chỉ in tuỳ chọn khác mặc định của SDK ngoài `container/apiKey/apiBase/center/zoom`),
  `maskKey`, `circleGeoJson` (64 đỉnh), `radiusForPrecision`.
- [x] 4.2 `playground.html` + `playground.css`: khung, 4 tab, bottom sheet ≤ 720px, `embed=1`.
- [x] 4.3 `playground.js`: tạo map từ state; "Áp dụng" tạo lại map (gọi `map.remove()` trước, gắn lại
  `ac.map`); cập nhật URL; tab Tìm kiếm (autocomplete select, search, nearby); tab Geocode (geocode +
  vòng tròn; reverse bằng bấm bản đồ, tắt chế độ sau khi có kết quả hoặc Esc); tab Mã nhúng + sao chép
  (`navigator.clipboard`, fallback chọn text); xử lý lỗi `MapsLibVNError` hiện `code` + `message` +
  `request_id`; `poiClick` hiện thông tin + "Xem chi tiết" (`places.getPlace`).
- [x] 4.4 Mở rộng `e2e/playground.spec.ts` theo spec mục 6 (4 test mới). Chạy `pnpm --filter
  @mapslibvn/docs e2e`; nếu API local không lên được vì thiếu DB dev thì ghi rõ, nhưng tối thiểu
  chạy được test không cần dữ liệu (tab, embed, form phản ánh URL) bằng cách kiểm tra phần tử khi
  `#status` còn `loading` cũng được — thiết kế test để không phụ thuộc dữ liệu khi có thể.
- [x] 4.5 `pnpm lint`, `pnpm exec vitest run apps/docs/scripts` (từ gốc), build docs xanh; chụp
  `playground.html` 1280×800 và 390×844 bằng Playwright vào scratchpad, tự xem lại bố cục.

## Task 5 — Trang chủ, sidebar, React demo, e2e docs (chạy sau Task 1–4)

Files: `apps/docs/astro.config.mjs`, `src/content/docs/index.mdx`, `src/components/ReactDemo.tsx`,
`src/pages/react-demo.astro`, tạo `src/lib/api-base.ts` + `src/lib/api-base.test.ts` (Vitest — thêm
include `apps/docs/src/**/*.test.ts` nếu Task 4 chưa mở; Vitest root dùng jsdom? kiểm
`vitest.config.ts`; hàm thuần nên `environment` node đủ), `e2e/docs.spec.ts`.

- [x] 5.1 Sidebar theo spec mục 4 (6 nhóm, đúng thứ tự). Kiểm mọi slug tồn tại.
- [x] 5.2 `index.mdx` theo spec 5.1 (iframe `?embed=1`, 6 card, `Tabs` 3 cách nhúng, 2 `LinkCard`,
  `Aside` trạng thái). CSS cho iframe viết inline trong `<style>` của MDX (Starlight cho phép) hoặc
  `customCss` — chọn cách đơn giản nhất build được.
- [x] 5.3 `api-base.ts`: `resolveApiBase(search, hostname)` cùng logic `public/playground-config.js`
  + test 3 ca; `ReactDemo.tsx` dùng nó; `react-demo.astro` thêm header link "← Tài liệu" và
  "Hướng dẫn React" (`/react/`). Kiểm: `pnpm preview` rồi mở `/react-demo/` với hostname
  `localhost` vẫn trỏ local (đúng như cũ); đọc `dist/_astro/ReactDemo*.js` thấy chuỗi
  `api.ai-solutions.io.vn`.
- [x] 5.4 `docs.spec.ts`: PAGES thêm `/tinh-nang/, /cai-dat/, /khoa-api/, /ban-do-web/, /tim-kiem/,
  /react/, /api/, /sdk/, /nhung-thu/, /react-demo/`. Chạy `pnpm --filter @mapslibvn/docs e2e
  e2e/docs.spec.ts`.
- [x] 5.5 `pnpm lint`, `pnpm typecheck`, build docs xanh; số trang build = 20 (11 cũ + 9 mới).

## Task 6 — Cổng cuối (Fable)

- [x] 6.1 `pnpm lint`, `pnpm typecheck`, `pnpm exec vitest run` (root), `pnpm --filter @mapslibvn/docs
  build`, `pnpm --filter @mapslibvn/docs e2e` — ghi kết quả thật.
- [x] 6.2 Chụp màn hình preview: `/`, `/playground.html` 4 tab, `/react-demo/`, `/api/`, `/cai-dat/`
  ở 1280×800 và 390×844; duyệt bố cục, sửa lỗi nhìn thấy.
- [x] 6.3 Đối chiếu ngẫu nhiên 10 khẳng định trong trang mới với mã nguồn.
- [x] 6.4 Cập nhật `docs/DEVLOG.md` mục 1–2 (một đoạn), tick plan này. Báo cáo chủ dự án; commit/push
  do chủ dự án quyết định.
