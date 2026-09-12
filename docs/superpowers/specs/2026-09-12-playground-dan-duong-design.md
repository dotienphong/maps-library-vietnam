# MapsLibVN — Thiết kế "Dẫn đường trong Playground" (bổ sung spec B, trước thực địa)

- Ngày: 2026-09-12
- Trạng thái: bản viết sau brainstorming với PHONG (6 quyết định đã duyệt cùng ngày: B/A/C/B/A/3 — xem mục 1.3); chờ PHONG review file trước khi viết plan
- Chủ dự án: PHONG
- Tài liệu do Fable 5.1 viết
- Spec liên quan: `2026-09-12-dan-duong-core-web-design.md` (spec B, Task 1–18 đã phát hành 12/09/2026, Version ID Worker `b777704b`); spec này **không sửa SDK**, chỉ thay lớp demo/thử nghiệm trong `apps/docs` để PHONG dùng khi đi thực địa (Task 19 của spec B)

## 0. Tóm tắt một đoạn

Trang demo dẫn đường riêng (`/dan-duong-demo/`, Astro + ESM) bị gỡ; thay vào đó Playground
(`/playground.html`, vanilla JS + SDK UMD) có thêm **chế độ dẫn đường** theo phong cách Google Maps:
mở playground là xin GPS và bay về vị trí người dùng; bấm "Dẫn đường" thì bảng điều khiển thu
về một nút, một **thẻ nổi bên trái** hiện lên với ô Điểm đi (mặc định "Vị trí của tôi"), ô Điểm đến
(autocomplete sẵn có: POI, đường, địa chỉ, vùng — hoặc bấm lên bản đồ / bấm POI), ba chip phương tiện;
đủ hai điểm là **tự tính tuyến**, đổi phương tiện hay đổi điểm là **tự tính lại**, có tuyến thay thế bấm
đổi. "Bắt đầu" (GPS thật, đọc giọng) hoặc "Giả lập" chuyển sang **dẫn đường toàn cảnh**: banner rẽ lớn
ở trên, thanh ETA ở dưới, bản đồ trọn màn hình. Mọi việc nằm trong `apps/docs/public/` (module mới
`playground-nav.js` + CSS, hàm thuần trong `playground-lib.js` có unit test), dùng lại autocomplete, đồng
bộ URL, tab Mã nhúng và E2E của playground; `?fixture=1` giữ để E2E không cần Valhalla.

## 1. Mục tiêu, phạm vi, người dùng

### 1.1 Mục tiêu

1. PHONG (và khách xem docs) thử được trọn luồng **vị trí của tôi → tìm tên đường/địa điểm → tuyến →
   dẫn đường** ở một chỗ duy nhất, không đọc code, trên cả máy tính lẫn điện thoại.
2. Đổi **ô tô / xe máy / đi bộ** là tuyến tự tính lại, thấy ngay khác biệt (quãng đường, phút, đường đi).
3. Giao diện đủ "quen mắt Google Maps" để đánh giá cảm nhận dẫn đường lúc đi thực địa, thay vì bảng form
   kỹ thuật như demo hiện tại.

### 1.2 Ngoài phạm vi (ghi nhận, không làm lần này)

- Điểm dừng `via` trong UI (API đã hỗ trợ; UI sắp thứ tự/xoá phức tạp).
- Bottom sheet kéo tay; lưu lịch sử tìm kiếm; giờ đến mong muốn; chia sẻ tuyến ngoài URL.
- Bất kỳ thay đổi nào trong `packages/*` hay `apps/api`. Nếu lúc làm phát hiện SDK thiếu gì, ghi thành
  việc riêng.

### 1.3 Quyết định đã duyệt trong brainstorming

| # | Câu hỏi | Chọn |
|---|---|---|
| 1 | Dẫn đường sống ở đâu | **B** — chế độ toàn màn hình trong playground (không tab riêng, không trang riêng) |
| 2 | Vị trí hiện tại | **A** — xin GPS ngay khi mở playground; từ chối thì giữ tâm Quận 1, không báo ồn; vẫn có nút "◎ Vị trí của tôi" |
| 3 | Chọn điểm | **C** — ô tìm + bấm bản đồ + bấm POI; **điểm đi cũng đổi được** |
| 4 | Tuyến thay thế / via | **B** — `alternatives=true`, tuyến phụ vẽ mờ, bấm đổi; không via |
| 5 | Bố cục | **A** — thẻ nổi trái khi lập kế hoạch; banner trên + thanh dưới, bản đồ trọn màn hình khi đang đi |
| 6 | Cách làm | **3** — module riêng `playground-nav.js`, playground hiện có giữ nguyên; hàm thuần vào `playground-lib.js` |

## 2. Tiền đề đã xác minh (12/09/2026)

- `<mapslibvn-autocomplete>` cấu hình qua thuộc tính `api-key`, `api-base`, `near`, `sources`,
  `placeholder`; phát sự kiện `select` với `detail: AutocompleteItem` (`type: 'poi'|'street'|'address'|'area'`,
  `area` có `bbox`). Dùng hai instance trong một trang được (custom element).
- Bản UMD `MapsLibVN` đã xuất `createMap`, `playbackSource`, `simulateFixes`, `formatDistanceShort`,
  `ROUTE_LAYER_IDS`; `map.routes` (`show/setActive/setProgress/clear`), `map.navigation`
  (`start/stop/recenter/reroute/state/status/following/on/off`), sự kiện `routeClick` của map (Task 13–14).
- Playground: `public/playground.html` + `playground.js` (682 dòng, vanilla, JSDoc, `checkJs` qua
  `tsconfig.scripts.json`), `playground-lib.js` (hàm thuần + `playground-lib.test.mjs` chạy Node),
  `playground-config.js` (`resolveApiBase`), `playground.css`; 4 tab, ô autocomplete chung `#ac`, state ↔ URL
  qua `parseState/toSearchParams/syncUrl`, tạo lại map khi đổi style/nguồn POI; E2E `e2e/playground.spec.ts`
  (11 ca) chạy với API local `dev:e2e` (không có Valhalla).
- `public/fixtures/directions-q1.json` được `scripts/copy-sdk.mjs` chép lúc prebuild (Task 3); demo cũ
  dùng `?fixture=1` để E2E không cần Valhalla — giữ nguyên cơ chế này.
- Geolocation cần HTTPS hoặc localhost (production docs là HTTPS; E2E là localhost). Chrome/Safari cho
  phép gọi `watchPosition/getCurrentPosition` ngay lúc tải trang (hộp thoại quyền hiện bình thường).

## 3. Luồng người dùng

1. **Mở playground.** Gọi `navigator.geolocation.getCurrentPosition` ngay khi map `load`. Có vị trí: `flyTo`
   zoom 16, cắm **chấm GPS** (marker tròn xanh có viền trắng, khác mũi tên puck của SDK). Từ chối / lỗi /
   không có API: giữ tâm mặc định (Quận 1), ghi một dòng vào `#status`, không hộp thoại. Nút tròn
   **"◎ Vị trí của tôi"** luôn ở góc phải dưới bản đồ: bấm thì xin lại quyền nếu chưa có và `flyTo` về chỗ mình.
2. **Vào chế độ dẫn đường.** Trên thanh tab có nút "Dẫn đường" (không có panel riêng — bấm là vào chế độ).
   Bảng điều khiển (bên trái) thu về nút **"⋯ Công cụ"** ở góc phải trên; **thẻ nổi bên trái** hiện ra: ô **Điểm đi**
   (điền sẵn "Vị trí của tôi" nếu có GPS, gõ để đổi), ô **Điểm đến**, nút **⇅** đổi chiều, ba chip
   **🏍 Xe máy / 🚗 Ô tô / 🚶 Đi bộ** (mặc định xe máy), nút **✕** thoát chế độ. Hai ô là
   `<mapslibvn-autocomplete>` với `near` = tâm bản đồ hiện tại.
3. **Chọn điểm bằng bản đồ.** Khi đang ở chế độ này, bấm lên bản đồ → popup nhỏ tại điểm bấm với hai nút
   "Đi từ đây" · "Đến đây" (kèm toạ độ rút gọn); bấm biểu tượng POI → cùng popup kèm tên POI. Điền ô nào thì
   marker ô đó cắm xuống (xanh = đi, đỏ = đến) và ô hiện nhãn (tên POI/đường, hoặc "10.7798, 106.6990").
4. **Tự tính tuyến** ngay khi đủ hai điểm; tính lại khi đổi phương tiện, đổi một điểm, hoặc đổi chiều.
   Gọi `map.places.directions({ from, to, mode, lang, alternatives: true })` (đổi `[lng,lat]` → `[lat,lng]`).
   Trong lúc chờ: danh sách tuyến và chip mờ (`aria-busy`), ô nhập không khoá. Kết quả: `map.routes.show`
   (tuyến chính đậm, tuyến phụ mờ, marker đích của SDK **tắt** vì đã có marker đỏ riêng), `fitBounds` bbox
   tuyến chính với padding 60 (trái chừa chỗ thẻ). Dưới chip: **danh sách tuyến** "1,1 km · 4 phút · qua
   Nguyễn Du" — bấm dòng hoặc bấm tuyến mờ (`routeClick`) để đổi tuyến chính (`routes.setActive`).
   "Chi tiết bước" mở/đóng danh sách bước (icon theo `ManeuverKind` như demo cũ + câu + khoảng cách).
5. **Bắt đầu.** Nút chính **"▶ Bắt đầu"** → `map.navigation.start({ response, routeIndex, provider })` (GPS
   thật, giọng bật). Nút phụ **"Giả lập"** → cùng lệnh với `source: playbackSource(simulateFixes(route,
   { jitter_m: 4, seed: 7 }), { rate })` và `voice: false`; `rate` mặc định 20, đọc từ URL `?rate=`.
   Thẻ trái ẩn; hiện **banner rẽ** trên cùng (icon + khoảng cách cỡ lớn + câu của `nextStep ?? step`; nền
   xanh, chuyển **cam** khi `off_route`/`rerouting`, **đỏ** khi mất GPS) và **thanh dưới** (phút · km còn
   lại · giờ đến dự kiến · nút **Dừng**). Dưới banner có dòng **phụ đề** hiện câu vừa `announce` trong 4 s
   (kể cả khi giọng đang bật, để đối chiếu khi thực địa). Kéo bản đồ → SDK tắt bám (`followChange false`)
   → hiện nút "Về vị trí" trên thanh dưới; bấm gọi `recenter()`.
6. **Đến nơi / Dừng.** `arrive` → banner đổi "Đã đến nơi" 3 s rồi trở về thẻ lập kế hoạch, tuyến và marker
   vẫn trên bản đồ, nút Bắt đầu/Giả lập bật lại. "Dừng" → `navigation.stop()` rồi cùng trạng thái.
   "✕" → `stop()` + `routes.clear()` + xoá marker đi/đến (giữ chấm GPS) + bảng điều khiển mở lại + bỏ
   `tab/tmode/from/to` khỏi URL.

## 4. Thành phần và file (tất cả trong `apps/docs`)

| File | Trách nhiệm |
|---|---|
| `public/playground-nav.js` (mới, ESM, JSDoc, `checkJs`) | `initNavigation({ map, ml, els, initial: { from, to, tmode }, lang, rate, fixture, onChange })` → `{ enter(), exit(), get active, setPoint(kind, point), onMapClick(lngLat), onPoiClick(poi), setMyLocation(lngLat \| null) }`. Sở hữu toàn bộ DOM của thẻ trái / banner / thanh dưới / popup chọn điểm, hai marker đi/đến, gọi `map.places.directions` (hoặc provider fixture), `map.routes.*`, `map.navigation.*`, nghe `progress/announce/status/offRoute/reroute/rerouteFailed/arrive/positionError/followChange/voiceUnavailable`. Chỉ nhận giá trị khởi tạo một lần; **không** đọc/ghi URL hay `state` playground; mọi thay đổi (điểm, phương tiện) báo ra qua `onChange({ from?, to?, tmode? })`. |
| `public/playground-nav.css` (mới) | Kiểu thẻ trái (rộng 360 px, tối đa 46 % màn hình), banner, thanh dưới, chip, popup, hai fab; `@media (max-width: 720px)`: thẻ trái thành thẻ trên (ô đi/đến) + thẻ dưới (chip, tuyến, nút), banner/thanh dưới toàn bề rộng. Tách khỏi `playground.css`. |
| `public/playground-lib.js` (mở rộng) | Hàm thuần: `pointFromAutocomplete(item)`, `pointFromPoi(poi)`, `pointFromLngLat(lngLat)` → `{ lng, lat, label }` (`area` lấy tâm `bbox`); `directionsRequest({ from, to, mode, lang })`; `routeSummary(route)` → `{ distanceText, minutes, via }` với `via` = tên đường của bước có `distance_m` lớn nhất (không có → `null`); `etaLabel(remaining_s, remaining_m, now)` → "4 phút · 950 m · 10:42"; `navSnippet(state)` → mã 3 bước cho tab Mã nhúng; `parseState/toSearchParams` thêm `tab` (`'dan-duong'`), `tmode`, `from`, `to` (`lat,lng[,nhãn]`, nhãn `encodeURIComponent`). |
| `public/playground.html` | Nút tab "Dẫn đường"; markup ẩn sẵn (`hidden`) cho `#nav-card`, `#nav-banner`, `#nav-bar`, `#nav-popup`, fab `#locate` (◎) và `#tools` (⋯); `<link>` CSS mới; script tag giữ nguyên. |
| `public/playground.js` | (a) Geolocation lúc `load` + chấm GPS + fab ◎ — thuộc bản đồ chung; (b) khởi tạo nav module một lần cho mỗi lần `buildMap` (tạo lại map khi đổi style → `exit()` trước, `enter()` lại với cùng điểm sau); (c) khi `nav.active`: thu bảng phải, chuyển `click`/`poiClick` sang nav, tab Mã nhúng dùng `navSnippet`; (d) đọc `tab=dan-duong` lúc tải để vào thẳng chế độ. |
| `public/fixtures/directions-q1.json` | Có sẵn. Với `?fixture=1`, provider trả fixture cho **mọi** phương tiện/điểm (vẫn là một lần gọi, đếm được trong E2E). |
| Xoá | `src/pages/dan-duong-demo.astro`, `src/lib/dan-duong-demo.ts`, `e2e/dan-duong-demo.spec.ts`. |

Ranh giới: `playground-nav.js` không biết tab/URL của playground; `playground.js` không biết DOM dẫn đường;
hàm thuần đều ở `playground-lib.js` và có test Node.

## 5. Trạng thái, URL, trường hợp biên

- **URL** (khớp `syncUrl`): `tab=dan-duong` vào thẳng chế độ; `tmode=motorbike|car|walk` (mặc định
  `motorbike`, không ghi khi mặc định); `from`/`to` = `lat,lng[,nhãn]`; `from` trống = "Vị trí của tôi".
  Có `to` và (`from` hoặc GPS) → tự tính lúc tải. Không đưa tuyến đang chọn hay trạng thái đang đi lên URL.
  `rate` và `fixture` giữ như demo cũ (chỉ dùng cho giả lập/E2E).
- **Tính tuyến**: mỗi yêu cầu tăng `requestId`; kết quả về với id cũ bị bỏ. "Vị trí của tôi" mà chưa có
  GPS → thẻ hiện "Đang chờ vị trí…" + nút "Chọn điểm đi khác".
- **Lỗi**: 429 → "Quá giới hạn 20 lượt/phút của khoá demo — chờ một chút hoặc dán khoá riêng ở ⋯ Công cụ";
  503/timeout → "Máy chủ chỉ đường đang bận, thử lại"; không có tuyến → "Chưa có đường cho đoạn này";
  hiện trong thẻ, không popup. Khi đang đi: `rerouteFailed` → banner cam "Không tính lại được (n/3)";
  `positionError` `denied` → `stop()`, banner đỏ "Mất quyền vị trí"; `voiceUnavailable` → dòng mờ "Máy
  không có giọng tiếng Việt, xem phụ đề".
- **Marker**: điểm đi khác "Vị trí của tôi" → marker xanh cắm chỗ đó, chấm GPS vẫn giữ. ⇅ hoán vị ô, marker,
  URL. Marker đích của `routes.show` tắt (`markers: false`).
- **Đang đi**: thẻ trái ẩn nên không đổi điểm/phương tiện được; `reroute` cập nhật danh sách tuyến/bước
  (chỉ còn một tuyến). Camera, puck, wake lock, giọng nói: SDK lo.
- **⋯ Công cụ**: mở bảng điều khiển để đổi style/lang/nguồn POI/dán khoá như hiện nay; đổi style tạo lại map →
  `exit()` trước, `enter()` lại với cùng `from/to/tmode` sau khi map mới `load`.

## 6. Kiểm thử

- **Unit Node** (`public/playground-lib.test.mjs`): `pointFrom*` (4 loại item, `area` lấy tâm bbox, POI,
  lngLat); `directionsRequest` (đảo toạ độ, `alternatives: true`, `lang`); `routeSummary` (km một chữ số
  lẻ dùng dấu phẩy, phút làm tròn, `via` là tên bước dài nhất, không tên → `null`); `etaLabel`;
  `navSnippet`; vòng tròn `parseState ↔ toSearchParams` với `tab/tmode/from/to`, nhãn có dấu và dấu phẩy.
- **E2E `playground.spec.ts`** (thay `dan-duong-demo.spec.ts`), chạy với `?fixture=1&api=…`:
  1. Bấm "Dẫn đường" → bảng phải thu, thẻ trái hiện, hai ô autocomplete, chip Xe máy `aria-pressed`.
  2. Mở với `from`/`to` trong URL → tuyến vẽ (`hasRouteLayer` qua `globalThis.__mapslibvnPlayground`),
     ≥ 1 dòng tuyến, "Chi tiết bước" → 6 bước.
  3. Đổi chip Ô tô → thêm một request directions (đếm bằng `page.route`), URL có `tmode=car`.
  4. "Giả lập" → `#nav-banner[data-status]` đi `navigating → arrived` trong 30 s; phụ đề từng chứa
     "Trong " và câu cuối "Điểm đến ở bên trái."; thanh dưới có "phút"; sau khi đến thẻ trái hiện lại,
     tuyến vẫn trên bản đồ.
  5. "✕" → tuyến mất, bảng phải mở, URL không còn `tab=dan-duong`.
  6. Geolocation: `context.grantPermissions(['geolocation'])` + `setGeolocation` tại Nhà thờ Đức Bà → chấm
     GPS hiện, ô Điểm đi = "Vị trí của tôi"; ca đối chứng không cấp quyền → không lỗi, tâm Quận 1.
- **`docs.spec.ts`**: bỏ `/dan-duong-demo/`.
- **Thủ công trước thực địa** (ghi evidence): production, GPS thật, gõ tên đường, đổi ba phương tiện, bấm
  tuyến phụ, Giả lập, rồi Bắt đầu thật vài chục mét.

## 7. Docs và phát hành

- `/dan-duong/`: mục 4 và mọi link `/dan-duong-demo/` → `/playground.html?tab=dan-duong`; thêm ở mục 1
  câu "Muốn thử ngay không cần code: Playground → Dẫn đường". Sidebar "Thử nghiệm" bỏ mục "Demo dẫn
  đường". `sdk.md`, `react.md`, `api.md` không đổi.
- Phát hành: cổng local (lint, typecheck, test, docs build + e2e) → `wrangler pages deploy` docs (Worker
  không đổi) → thử tay mục 6 → evidence `docs/evidence/navigation/<ngày>-playground-dan-duong.md`.
  Đây là điều kiện trước Task 19 (thực địa) của spec B.

## 8. Rủi ro

- Hộp thoại quyền GPS ngay lúc tải có thể bị người xem docs từ chối một lần và trình duyệt nhớ → nút ◎ cho
  phép xin lại; trên iOS phải mở Cài đặt. Ghi rõ trong dòng trạng thái.
- Khoá demo bị giới hạn 20 lượt/phút cho directions; tự tính lại mỗi lần đổi chip có thể chạm trần khi bấm
  nhanh → thông điệp 429 rõ ràng, và không tính lại khi request giống hệt request trước.
- E2E playground đã có 3 ca đỏ chập chờn do Postgres nghẽn khi chạy song song (không liên quan) — chạy
  `--workers=2` như Task 18 và ghi nhận trong evidence.
