# Spec — Hoàn chỉnh website quảng bá và tài liệu `mapslibvn-docs.pages.dev`

Ngày: 04/09/2026. Người rà soát và lập kế hoạch: Claude Fable 5.1. Người thực hiện: Claude Opus 5
(subagent theo plan `docs/superpowers/plans/2026-09-04-docs-site-hoan-chinh.md`).

## 1. Mục tiêu

Website `https://mapslibvn-docs.pages.dev/` (Astro 5.18 + Starlight 0.30, `apps/docs`) phải đóng đủ
bốn vai trò cho người đến lần đầu:

1. **Quảng bá** — nói rõ MapsLibVN là gì, làm được gì, khác gì, trạng thái dự án.
2. **Hướng dẫn cài đặt** — từng cách nhúng (script tag, npm ESM, React, React Native) với hiện trạng
   trung thực (npm chưa publish — checklist B3).
3. **Hướng dẫn sử dụng + tham chiếu** — mọi tuỳ chọn SDK, mọi endpoint REST, mã lỗi, giới hạn.
4. **Hệ thống chạy thử** — playground tương tác thử được bản đồ và toàn bộ Places API bằng khoá demo
   hoặc khoá riêng; React demo chạy được trên production; hướng dẫn nhúng thử vào trang của mình.

## 2. Kết quả rà soát (04/09/2026)

Kiểm bằng `curl`, Playwright chụp màn hình production, và đọc mã nguồn `apps/docs`, `packages/*`,
`apps/api/src`.

| # | Phát hiện | Mức | Xử lý trong spec này |
|---|---|---|---|
| R1 | `/react-demo/` **hỏng trên production**: `ReactDemo.tsx` mặc định `apiBase = http://localhost:8787` khi không có `?api=` → CORS, bản đồ không tải. Trang cũng không có trong sidebar. | Lỗi | Sửa (mục 5.4) |
| R2 | Playground chỉ có bản đồ + ô autocomplete, không giải thích, không đổi theme/ngôn ngữ, không thử được search/nearby/geocode/reverse, không nhập khoá riêng, không có mã nhúng. | Thiếu | Thiết kế lại (mục 5.3) |
| R3 | **Không có trang tham chiếu REST API và SDK** — spec gốc 7.4 yêu cầu "tham chiếu API". | Thiếu | Thêm (mục 5.2) |
| R4 | `bat-dau.md` mục 2 viết `pnpm add @mapslibvn/web maplibre-gl` như đã có trên npm; thực tế 4 gói `@mapslibvn/*` chưa publish (B3). Không có trang nào nói cách **lấy khoá API**. | Sai lệch | Trang Cài đặt + Khoá API (mục 5.2) |
| R5 | Trang chủ 5 card ngắn, không có bản đồ sống, không có tổng quan tính năng, không nêu trạng thái dự án. | Thiếu | Viết lại (mục 5.1) |
| R6 | Attribution hiện **hai lần** trên playground: style nguồn `vn`/`poi` có `attribution` riêng, SDK lại thêm `customAttribution` chuỗi chuẩn. | Thẩm mỹ | **Không sửa trong đợt này** — spec gốc 7.2 quy định SDK luôn thêm chuỗi chuẩn; đổi cách hiển thị là quyết định pháp lý, ghi khuyến nghị ở mục 8 |
| R7 | Glyph `Noto Sans Regular/119808-120063.pbf` 404 (ký tự toán học U+1D400 trong tên vài POI); MapLibre tự vẽ thay. | Nhỏ | Không sửa; ghi nhận |
| R8 | Khoá `web` được **cho qua khi không có Origin** (curl) — chủ ý MVP theo comment `auth.ts`. | Ghi nhận | Không đổi; trang REST phải nói đúng hành vi này |
| R9 | `docs.spec.ts` kiểm 9 trang; cần cập nhật khi thêm trang. | Kiểm thử | Mục 6 |

Những gì **đang tốt** và giữ nguyên: cấu trúc Starlight + prebuild (`copy-sdk.mjs`, `copy-legal.mjs`),
5 trang hiện có (React Native, Độ chính xác, Đóng góp, Tự host, Giấy phép) có nội dung chuẩn xác, 2 trang
pháp lý sinh từ nguồn duy nhất, deploy tự động `deploy-docs.yml`.

## 3. Nguyên tắc nội dung

- **Chỉ viết điều có trong mã nguồn.** Mọi tuỳ chọn, tham số, giới hạn, mã lỗi phải đọc từ
  `packages/*/src` và `apps/api/src`. Không bịa số liệu (số POI, số người dùng, tốc độ) trừ khi có
  nguồn trong repo.
- **Trung thực về hiện trạng**: npm chưa publish; endpoint `api.ai-solutions.io.vn` và
  `mapslibvn-docs.pages.dev` là tạm; repo private; giai đoạn nội bộ, chưa thu phí.
- **Tiếng Việt đủ dấu**, thuật ngữ và định danh mã giữ nguyên. Giọng ngắn gọn như các trang hiện có.
- **Trung lập**: không nhắc đến ứng dụng nào khác của tác giả làm ví dụ (ghi nhớ dự án).
- Playground **không** gọi `POST /v1/edits` (tránh ghi bẩn DB production từ trang công khai).

## 4. Kiến trúc thông tin (sidebar mới)

```
Giới thiệu      Tính năng (/tinh-nang/)
Bắt đầu         Cài đặt (/cai-dat/) · Khoá API (/khoa-api/) · Bắt đầu 5 phút (/bat-dau/) · React Native (/react-native/)
Hướng dẫn       Bản đồ web (/ban-do-web/) · Tìm kiếm & autocomplete (/tim-kiem/) · React (/react/)
                · Độ chính xác geocode (/do-chinh-xac/) · Đóng góp & sửa POI (/dong-gop/) · Tự host (/tu-host/)
Tham chiếu      REST API (/api/) · SDK JavaScript (/sdk/)
Thử nghiệm      Playground (/playground.html) · React demo (/react-demo/) · Nhúng thử trang của bạn (/nhung-thu/)
Pháp lý         Giấy phép & ghi nguồn · Điều khoản tenant · Thông báo bên thứ ba
```

Trang mới: 9 (`tinh-nang`, `cai-dat`, `khoa-api`, `ban-do-web`, `tim-kiem`, `react`, `api`, `sdk`,
`nhung-thu`). Trang sửa: `index.mdx`, `bat-dau.md`, `react-demo.astro` + `ReactDemo.tsx`,
`playground.html`, `astro.config.mjs`, `e2e/*.spec.ts`.

## 5. Thiết kế từng phần

### 5.1 Trang chủ (`index.mdx`, template `splash`)

Thứ tự khối:
1. Hero: giữ tagline, 2 nút (Bắt đầu 5 phút, Mở playground).
2. **Bản đồ sống**: `<iframe src="/playground.html?embed=1" title="Bản đồ MapsLibVN" loading="lazy">`
   cao 420px, bo góc; `embed=1` ẩn bảng điều khiển của playground (mục 5.3). Dưới iframe một dòng
   "Bấm vào biểu tượng POI để xem tên · Mở playground đầy đủ →".
3. **Tính năng chính**: `CardGrid` 6 card, mỗi card link tới trang tương ứng: Bản đồ nền Việt Nam
   (light/dark, vi/en, chủ quyền) → `/ban-do-web/`; Lớp POI 164 loại/13 nhóm → `/tinh-nang/`;
   Tìm kiếm & autocomplete → `/tim-kiem/`; Geocode trung thực → `/do-chinh-xac/`; Đóng góp cộng đồng
   → `/dong-gop/`; Web + React + React Native → `/cai-dat/`.
4. **Ba cách nhúng**: `Tabs` (Script tag · npm ESM · React) mỗi tab ≤ 12 dòng mã, lấy từ trang Cài đặt.
5. **Mở và tự host**: 2 `LinkCard` (Giấy phép & ghi nguồn, Tự host).
6. **Trạng thái dự án** (`Aside type="note"`): giai đoạn nội bộ; M1–M6 đã nghiệm thu (nêu tính năng,
   không nêu mã mốc); npm chưa publish, cài từ UMD hoặc tarball; endpoint tạm; liên hệ lấy khoá →
   `/khoa-api/`.

### 5.2 Trang nội dung mới

Mỗi trang: frontmatter `title` + `description`; H2 đánh số như trang hiện có; kết bằng "Đọc thêm".

- **`/tinh-nang/`** — tổng quan: bản đồ nền (PMTiles trên R2, đọc thẳng bằng HTTP Range, 2 theme,
  nhãn vi/en, nhãn chủ quyền luôn tiếng Việt, Hoàng Sa – Trường Sa ở mọi zoom); lớp POI (164 loại,
  13 nhóm liệt kê tên nhóm; nguồn OSM + Overture + Foursquare OS gộp, mô hình một nguồn chính);
  Places API (7 endpoint đọc + 1 ghi, một bảng một dòng mỗi endpoint); geocode với `precision`/
  `confidence`; đóng góp và luật duyệt; attribution bắt buộc; SDK 4 gói; kiến trúc tóm tắt (bảng 5
  hàng lấy từ `/tu-host/` mục 1); trạng thái và giới hạn hiện tại.
- **`/cai-dat/`** — `Tabs`: Script tag (UMD từ `mapslibvn-docs.pages.dev/sdk/`, global `MapsLibVN`,
  CSS đi kèm, `<mapslibvn-autocomplete>` tự đăng ký); npm ESM (`@mapslibvn/web` + peer `maplibre-gl@^5`,
  import CSS của maplibre, truyền `{ maplibre: maplibregl }`; **Aside cảnh báo** chưa publish, nêu
  cách cài từ tarball `pnpm pack` khi có quyền repo); React (`@mapslibvn/react`, peer `react>=18`,
  `maplibre-gl`); React Native (tóm tắt 6 dòng + link `/react-native/`). Bảng yêu cầu: trình duyệt
  (spec 7.2), Node/React/RN. Mục "Kiểm tra đã cài đúng": `map.on('load')` + lỗi hay gặp
  (`origin_not_allowed`, thiếu CSS, thiếu `maplibre-gl`).
- **`/khoa-api/`** — ba loại khoá (`web`/`mobile`/`server`) và cách kiểm: `web` so `Origin`/`Referer`
  theo protocol + hostname, mọi port, wildcard `https://*.example.vn`, không có Origin thì cho qua
  (giai đoạn nội bộ); `mobile` gửi `X-Bundle-Id`; `server` là bí mật. Scope `places:read`,
  `edits:write`. Quota: plan free 20.000 lượt Places/ngày (giờ Việt Nam), 429 khi vượt; đóng góp
  20/ngày/`end_user_token`, 500/ngày/khoá. **Khoá demo** `mlv_live_demo00000000000000000000`: chỉ chạy
  trên `mapslibvn-docs.pages.dev` và `http://localhost`, `http://127.0.0.1` (mọi port) — dùng để thử
  trên máy. **Cách xin khoá**: email theo Điều khoản tenant mục 10, tiêu đề `[MapsLibVN]`, ghi
  origin(s), loại khoá, mục đích. Cách truyền khoá: header `X-Api-Key` hoặc `?key=`. Cách xử lý khi
  lộ khoá.
- **`/ban-do-web/`** — hướng dẫn `@mapslibvn/web`: bảng đầy đủ `CreateMapOptions` (mặc định thật:
  `style 'light'`, `center [106.7, 10.776]`, `zoom 12`, `lang 'vi'`, `poiLayer true`,
  `compactAttribution false`); style riêng bằng URL; `map.gl` dùng API MapLibre; marker và popup
  (`addMarker`, trả `maplibregl.Marker`, `color`); `flyTo`, `fitBounds(bbox, padding=40)`;
  sự kiện `load`, `poiClick` (`PoiFeature` 5 trường; chỉ có khi lớp POI hiển thị, nhãn POI từ zoom 13);
  `applyLanguage` đổi ngôn ngữ sau khi tạo; `remove()`; `map.places` là client core cùng khoá.
- **`/tim-kiem/`** — `<mapslibvn-autocomplete>`: thuộc tính `api-key`, `api-base`, `placeholder`,
  `near`; thuộc tính JS `.map` để lấy `near` từ tâm bản đồ; sự kiện `select` (`detail` là
  `AutocompleteItem`); ARIA combobox, điều hướng bàn phím; debounce; đọc `autocomplete-element.ts`
  để mô tả đúng. Rồi client core: `autocomplete`, `search`, `nearby`, `getPlace` với ví dụ và giải
  thích `type` (`poi`/`street`/`address`), `score`; khi nào dùng cái nào.
- **`/react/`** — `@mapslibvn/react`: `<MapsLibVNMap>` props (mọi `CreateMapOptions` trừ
  `container`, + `className`, `containerStyle`, `onPoiClick`, `onLoad`, `children`; lưu ý đổi
  `apiKey`/`apiBase`/`style`/`center`/`zoom`/`lang`/`poiLayer`/`compactAttribution` tạo lại map),
  `useMap()` (ném lỗi ngoài provider), `<Marker lng lat popupHtml? color?>`, `usePlaces(query,
  { near, limit, debounceMs=200, client })` → `{ items, loading, error }` (SWR-style, ≥ 2 ký tự, cần
  `client` khi ở ngoài `<MapsLibVNMap>`). Ví dụ trọn màn hình tìm-và-ghim rút từ `ReactDemo.tsx`;
  link `/react-demo/`.
- **`/api/`** — tham chiếu REST: gốc API, xác thực, định dạng lỗi `{ error: { code, message,
  request_id } }`, `retry-after`; bảng mã lỗi (`missing_key` 401, `invalid_key` 401, `scope` 403,
  `origin_not_allowed` 403, `invalid_request` 400, `not_found` 404, `quota_exceeded` 429,
  `upstream_unavailable` 503, `server_misconfigured` 503); cache (autocomplete 10 phút theo truy vấn
  chuẩn hoá + lưới `near`, place 1 giờ, attribution 24 giờ, styles 1 giờ). Mỗi endpoint một H3 với
  bảng tham số (kiểu, bắt buộc, mặc định, khoảng), ví dụ `curl`, ví dụ phản hồi rút gọn:
  `GET /v1/autocomplete` (q ≥ 2, near, limit 1–10 mặc định 10, types), `GET /v1/search` (cần ≥ 1
  trong q/category/near/bbox; radius 1–50 000 mặc định 5 000; limit 1–50 mặc định 20; offset 0–500;
  thứ tự sắp xếp), `GET /v1/nearby` (lat, lng bắt buộc; radius 1–5 000 mặc định 500; limit 1–100
  mặc định 20; category), `GET /v1/places/{id}` (PlaceDetails, `sources`, `attribution`, POI pending
  chỉ tenant tạo thấy), `GET /v1/geocode` (limit 1–5; link `/do-chinh-xac/`), `GET /v1/reverse`
  (bán kính đường 150 m, mốc 300 m, POI 100 m — đọc `reverse.ts`), `POST /v1/edits` (tóm tắt, link
  `/dong-gop/`), `GET /v1/attribution`, `GET /v1/styles/{light|dark}.json`, `GET /healthz`. Kiểu
  `Place`, `PlaceDetails`, `AutocompleteItem`, `GeocodeItem`, `ReverseResponse` chép từ
  `packages/core/src/types.ts`.
- **`/sdk/`** — tham chiếu 4 gói theo export thật (`packages/*/src/index.ts`): core (`createClient`
  và 10 phương thức, `MapsLibVNError` 4 trường, `attributionText/Html`, `ATTRIBUTION_LINKS`,
  `normalizeVi`, `nameCore`, `parseAddress`, `localizeStyle`, `hidePoiLayer`, các type), web
  (`createMap`, `applyLanguage`, `nameExpression`, `MapsLibVNAutocomplete`, `defineAutocomplete`,
  re-export core; UMD thêm `maplibregl`), react, react-native (tóm tắt + link). Bảng "tuỳ chọn →
  mặc định" và "sự kiện → payload".
- **`/nhung-thu/`** — thử trên trang của bạn: (1) tạo `index.html` từ mẫu, chạy
  `python3 -m http.server 5500` hoặc `npx serve`, mở `http://localhost:5500` với khoá demo (origin
  localhost được phép); (2) muốn dùng origin thật → xin khoá `web` kèm origin; (3) mẫu
  `examples/embed-web` trong repo và lệnh `pnpm example:embed` (cho người có repo); (4) checklist
  kiểm: tiles trả 206/200, attribution hiện, `poiClick` in ra console, `origin_not_allowed` nghĩa là gì;
  (5) React Native → `pnpm example:rn`, link `/react-native/`.

`bat-dau.md` rút còn "đường nhanh nhất" (script tag đầy đủ, npm ESM ngắn kèm Aside chưa publish, React
6 dòng, RN 1 đoạn) và trỏ sang Cài đặt / Khoá API / Bản đồ web cho chi tiết; bỏ bảng tuỳ chọn (đã
sang `/ban-do-web/`) nhưng giữ đoạn về endpoint tạm và `origin_not_allowed`.

### 5.3 Playground mới (`public/playground.html` + `public/playground.js` + `public/playground.css`)

Giữ là file tĩnh trong `public/` (URL `/playground.html` ổn định, không phụ thuộc build Starlight,
e2e hiện có tiếp tục chạy). JavaScript thuần (ES module), dùng UMD `/sdk/mapslibvn.umd.js`, không
framework.

**Bố cục**: bản đồ toàn màn hình; **bảng điều khiển** bên trái rộng 360px (trên màn hình ≤ 720px
thành bottom sheet có nút thu/mở), có nút thu gọn; thanh trạng thái `#status` (giữ `data-state`
`loading|loaded|error`) góc trên trái; `<mapslibvn-autocomplete id="ac">` **luôn có trong DOM** ở đầu
bảng điều khiển (e2e hiện có gõ "highlands" và chọn bằng bàn phím). Liên kết "← Tài liệu" về `/`.

**Tab trong bảng điều khiển** (`role="tablist"`, URL hash `#ban-do|#tim-kiem|#geocode|#ma-nhung`):

1. **Bản đồ** — theme (`light`/`dark`), ngôn ngữ (`vi`/`en`), bật/tắt lớp POI, attribution gọn; ô
   "Khoá API" (mặc định khoá demo) và "API base" (mặc định `resolveApiBase()`); nút "Áp dụng" tạo lại
   map bằng `MapsLibVN.createMap` với tuỳ chọn hiện tại; hiển thị tâm/zoom hiện tại; nơi hiện POI
   vừa bấm (`poiClick`: tên · loại · nhóm · id, nút "Xem chi tiết" gọi `getPlace`).
2. **Tìm kiếm** — autocomplete (component, kết quả `select` → flyTo + marker); form `search`
   (q, category, radius, dùng tâm bản đồ làm `near`); form `nearby` (tâm bản đồ, radius, category);
   kết quả dạng danh sách bấm được (flyTo + marker), kèm khối "Phản hồi JSON" thu gọn được và dòng
   "Yêu cầu" hiển thị URL đã gọi (che khoá còn `mlv_live_demo…0000`).
3. **Geocode** — ô địa chỉ + 3 chip ví dụ (lấy từ `/do-chinh-xac/`), kết quả hiện `precision` và
   `confidence` dạng badge, ghim marker; nếu `precision` không phải `rooftop` vẽ vòng tròn ước lượng
   (GeoJSON circle, bán kính 30–80 m theo hướng dẫn trang Độ chính xác) — minh hoạ đúng nguyên tắc
   "trung thực". **Reverse**: nút "Bấm lên bản đồ để tra địa chỉ" bật chế độ bấm, hiện
   `display_name`, `approx_housenumber`, `nearest_poi`.
4. **Mã nhúng** — sinh đoạn mã script-tag và npm ESM phản ánh đúng tuỳ chọn hiện tại (theme, lang,
   poiLayer, compactAttribution, center, zoom, khoá, apiBase); nút "Sao chép".

**URL**: giữ `?key=`, `?api=`, `?style=`; thêm `?lang=`, `?poi=0`, `?c=lng,lat,zoom`, `?embed=1`
(ẩn bảng điều khiển và autocomplete, chỉ còn bản đồ + status — dùng cho iframe trang chủ). Đổi tuỳ
chọn cập nhật URL bằng `history.replaceState` để chia sẻ được.

**Tách logic thuần** vào `public/playground-lib.js` (không chạm DOM): `parseState(search)`,
`toSearchParams(state)`, `buildSnippet(state, kind)`, `maskKey(key)`, `circleGeoJson(lng, lat,
radiusM)`, `radiusForPrecision(precision)`. Có test Vitest `apps/docs/scripts/playground-lib.test.mjs`
(root `vitest.config.ts` hiện exclude `apps/**` — thêm include cho `apps/docs/scripts/**/*.test.mjs`
và bỏ exclude tương ứng).

Giữ `window.__map`. Không gọi `POST /v1/edits`. Không tải thư viện ngoài.

### 5.4 React demo

`ReactDemo.tsx`: `apiBase` = `?api=` → nếu không có: hostname `localhost`/`127.0.0.1` →
`http://localhost:8787`, còn lại → `https://api.ai-solutions.io.vn` (đúng logic
`playground-config.js`; tách hàm vào `src/lib/api-base.ts` và có test hoặc dùng chung — tuỳ người
thực hiện nhưng phải có test). Thêm link "← Tài liệu" và "Xem mã nguồn" (trỏ `/react/`). Thêm vào
sidebar mục Thử nghiệm.

## 6. Kiểm thử và cổng chất lượng

- `docs.spec.ts`: thêm 9 slug mới; giữ kiểm link nội bộ; thêm kiểm `/react-demo/` có `h1`.
- `playground.spec.ts`: giữ 3 test cũ; thêm: tab chuyển được (`aria-selected`), `?embed=1` ẩn bảng
  điều khiển, `?style=dark&lang=en` phản ánh vào form, tab Mã nhúng chứa `MapsLibVN.createMap` và
  `style: 'dark'` khi chọn dark. Test cần API local (`dev:e2e`) như hiện nay.
- Vitest: `playground-lib.test.mjs`, `api-base.test.ts` (React demo).
- Cổng bắt buộc trước khi báo xong: `pnpm lint`, `pnpm typecheck`, `pnpm --filter @mapslibvn/docs
  build`, `pnpm --filter @mapslibvn/docs e2e` (nếu DB local không chạy được cho playground spec thì
  ghi rõ test nào bỏ qua), vitest root.
- Kiểm trực quan cuối: chụp màn hình preview (trang chủ, playground 4 tab, React demo, 2 trang tham
  chiếu) ở 1280×800 và 390×844 bằng Playwright, Fable duyệt.

## 7. Ngoài phạm vi

- Publish npm (chờ B3), tên miền riêng (B6), đổi hành vi API, sửa SDK, thay đổi style tiles.
- Tiếng Anh cho docs (có thể là mốc sau).

## 8. Khuyến nghị để chủ dự án quyết định (không thực hiện)

1. **Attribution trùng** (R6): style do Worker phục vụ đã có `attribution` ở nguồn `vn` ("© OpenStreetMap
   contributors · © OpenMapTiles") và `poi` ("Places: …"); SDK thêm `customAttribution` chuỗi chuẩn nên
   MapLibre hiện cả hai. `maplibre-gl` 5 không nhận `transformStyle` trong `MapOptions`, nên cách
   sạch nhất là: khi `style` là theme của MapsLibVN thì `customAttribution` chỉ còn "© MapsLibVN"
   (nguồn đã mang phần còn lại), khi `style` là URL riêng mới dùng chuỗi chuẩn đầy đủ. Cần sửa spec
   gốc 7.2 và `packages/web/src/map.test.ts`. Quyết định thuộc chủ dự án vì liên quan nghĩa vụ ghi nguồn.
2. **Khoá `web` không có Origin được cho qua** (R8): hợp lý ở MVP; khi mở cho developer ngoài nên cân
   nhắc bắt buộc Origin cho `kind='web'` hoặc dựa hoàn toàn vào quota.
