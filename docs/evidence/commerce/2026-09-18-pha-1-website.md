# Chứng cứ pha 1 — website `apps/site`

Plan: `docs/superpowers/plans/2026-09-18-thuong-mai-pha-1-website.md`
Spec: `docs/superpowers/specs/2026-09-18-thuong-mai-tu-phuc-vu-design.md` mục 11 và 19.
Ngày chạy: 18/09/2026. 14 task, 14 commit.

## 1. Cổng ở máy — số thật

| Lệnh | Kết quả |
|---|---|
| `pnpm lint` | 713 file, sạch |
| `pnpm typecheck` (gồm `tsc -p tsconfig.scripts.json` rồi mới tới turbo) | **17/17 task**, sạch |
| `npx vitest run apps/site/src` | 5 file / **35 test** xanh |
| `pnpm test` (gốc, nay gồm cả build site) | 193 file / **1.857 test** xanh, 5 skip |
| `pnpm --filter @mapslibvn/api test` | 62 file / **480 test** xanh |
| `pnpm test:site-e2e` | **25/25** xanh, 7,5 s |
| `pnpm test:admin-e2e` | **17/17** xanh, 1,1 phút |

## 2. Hiệu năng đo trên bản build

| Hạng mục | Số đo | Ngân sách plan |
|---|---|---|
| JavaScript trang chủ | **739 byte gzip**, 3 khối nhúng, **0 tệp `.js` ngoài** | 15.000 byte |
| HTML trang chủ (nén) | 8.118 byte | — |
| Ảnh hero, bản AVIF nhỏ nhất | 35 KB | — |
| Ảnh OG | 22–42 KB mỗi tấm | 200 KB |
| Ảnh hero gốc trong repo | 559 KB JPEG | — |

Astro nhúng thẳng ba khối script nhỏ vào HTML nên trang chủ **không tải thêm một tệp JavaScript
nào**. Một island React sẽ là khoảng 45 KB gzip; bài e2e "ngân sách JavaScript trang chủ" khoá
lại điều này. Menu hamburger cộng thêm 141 byte, vẫn xa ngưỡng.

## 3. SEO — bảy trang, đã kiểm bằng e2e trên bản build

- [x] Mỗi trang đúng **một** `<h1>`, `<html lang="vi">`.
- [x] `title` ≤ 60 ký tự, `description` 120–160 ký tự — ép ở cả `trang.test.ts` lẫn e2e.
- [x] `canonical` tuyệt đối, luôn có dấu gạch cuối, khớp `SITE_URL`.
- [x] `og:image` có mặt và **ảnh trỏ tới thật sự tồn tại** (bài e2e riêng).
- [x] Mọi khối JSON-LD parse được, có `@context` và `@type`: Organization ở mọi trang, cộng
      SoftwareApplication, FAQPage, BreadcrumbList, Article tuỳ trang.
- [x] `robots.txt` trỏ sitemap tuyệt đối; sitemap có **10 URL** (7 trang + 3 bài viết), không có `/404`.
- [x] Ảnh AVIF + WebP ba cỡ qua `<Picture>`, `fetchpriority="high"` cho ảnh hero.

## 4. Những lời hứa có bài test khoá lại

- [x] **Giá vẫn đúng khi tắt JavaScript** — bốn kỳ render sẵn vào `data-*` lúc build.
- [x] **Công tắc kỳ đổi giá** bằng chuột và bằng bàn phím (mũi tên).
- [x] **Hero không nạp iframe trước khi bấm** — trước khi bấm có 0 iframe.
- [x] **Ghi nguồn ODbL và Apache-2.0 có ở mọi trang** — đây là nghĩa vụ giấy phép, không phải
      trang trí.
- [x] **Số điện thoại +84 983 450 456 bấm gọi được** ở chân trang của mọi trang và ở khối riêng
      trên trang Liên hệ; `href` là dạng E.164 không khoảng trắng, và số cũng nằm trong
      `contactPoint.telephone` của đánh dấu Organization.
- [x] Mọi link nội bộ trên bảy trang trả 200; `/khong-co-that/` trả 404 và trang 404 dùng được.
- [x] Điều hướng bấm được ở khung 390 px; ba tab mã nhúng đổi được bằng bàn phím.
- [x] Công tắc sáng tối nhớ lựa chọn qua lần tải lại.

## 4b. Một lần CI đỏ sau khi push, đã sửa

Lần push đầu (`cd2ff8d`) làm **CI đỏ** dù mọi cổng ở máy xanh. Nguyên nhân: plan ghi chạy
`npx turbo run typecheck --force`, nhưng `pnpm typecheck` thật sự chạy **`tsc -p
tsconfig.scripts.json` TRƯỚC** turbo, và bước đó bật `checkJs` cho `scripts/**/*.mjs`. Tám tham số
trong `scripts/site-images.mjs` chưa có JSDoc nên tsc báo `TS7031`/`TS7006`.

Bài học: **chạy đúng lệnh mà CI chạy**, đừng chạy một phần của nó. Đã thêm JSDoc và đổi bảng cổng
ở mục 1 cho khớp. Năm workflow còn lại đều xanh ngay lần đầu, gồm cả `Deploy Site`.

## 4c. Bẫy thứ hai: e2e kiểm nhầm dev server

Khi PHONG mở `pnpm dev` ở cổng 4322 để xem website, bộ e2e **tái dùng đúng cổng đó** và kiểm
nhầm dev server thay vì bản build: bốn bài đỏ với thông báo khó hiểu như "locator('h1') resolved
to 5 elements" — bốn thẻ h1 thừa là của thanh công cụ dev Astro.

Đã tách cổng: e2e dựng bản build rồi phục vụ ở **4323**, `pnpm dev` giữ **4322**. Hai việc không
còn tranh nhau, và không ai phải nhớ tắt dev trước khi chạy test.

## 4d. Đổi menu điện thoại sang hamburger — PHONG yêu cầu 18/09

Bản đầu dùng thanh điều hướng cuộn ngang với lý do "chỉ có năm mục, đừng giấu Bảng giá sau một
lần bấm". Đo lại trên bản deploy thật thì lý do đó sai:

| Bề ngang | Nội dung cần | Mục bị khuất |
|---|---|---|
| 320px | 498px | So với Google, Bài viết, Liên hệ |
| 360px | 498px | Bài viết, Liên hệ |
| 390px | 498px | Bài viết, Liên hệ |
| 430px | 498px | Liên hệ |

Không có dấu hiệu nào báo là cuộn ngang được, nên với người dùng thì hai mục cuối coi như không
tồn tại — tệ hơn hamburger, vì hamburger ít nhất nói rõ còn thứ để mở.

Bản mới dùng thẻ **`<dialog>` của trình duyệt** mở bằng `showModal()`, không thêm thư viện nào:
trình duyệt lo sẵn giam tiêu điểm bàn phím, đóng bằng Esc và trả tiêu điểm về nút đã mở — đúng ba
thứ mà trang Admin phải kéo Radix Dialog vào để có. Script chỉ thêm phần khoá cuộn nền và chạm
nền tối để đóng.

Đo lại sau khi đổi: thanh trên **vừa khít ở cả 320px** (mép phải nút ☰ ở 311px), không trang nào
cuộn ngang, và JavaScript trang chủ tăng từ 598 lên **739 byte**. Bốn bài e2e mới khoá lại: cả năm
mục nhìn thấy được không cần cuộn, Esc đóng và trả tiêu điểm, nút đóng và chạm nền đều đóng được,
và ở màn hình rộng thì không có nút ☰.

## 5. Việc tay của PHONG, theo thứ tự

1. **Tạo project Cloudflare Pages tên `mapslibvn-site`.** Chưa có thì workflow `Deploy Site` đỏ
   với "project not found"; tạo xong chạy lại workflow là được.
2. **Đọc lại ba bài viết** trong `apps/site/src/content/bai-viet/`. PHONG chọn 18/09 cho đăng
   luôn cả ba rồi đọc trên web, nên `daDuyet: true` cho cả ba và sitemap có 10 URL. Sửa nội dung
   sau vẫn được; tắt một bài thì đổi `daDuyet` về `false`.
3. **Xác thực Google Search Console và Bing Webmaster** cho `mapslibvn-site.pages.dev`, gửi
   `sitemap-index.xml`, rồi ghi ngày kiểm lại chỉ mục vào đây.
4. ~~**Chạy Lighthouse mobile** trên bản deploy thật~~ — **XONG 20/09/2026: PHONG đã chạy và báo
   xanh.** Tiêu chí 2 của spec coi như đạt.

| Trang | Performance | Accessibility | Best practices | SEO | LCP |
|---|---|---|---|---|---|
| `/` | | | | | |
| `/bang-gia/` | | | | | |

Ngưỡng spec: Performance ≥ 90, SEO 100, Accessibility ≥ 95, LCP ≤ 2,5 s, CLS ≤ 0,1, TBT ≤ 200 ms.

**Bảng trên vẫn trống có chủ đích, không phải quên.** PHONG báo "chạy xanh" nhưng bốn con số và ảnh
chụp chưa được dán vào. Spec đòi ảnh chụp trong hồ sơ, nên về mặt giấy tờ đây là *lời khai đã được
chấp nhận*, không phải *số đo đã lưu*. Muốn đóng kín thì dán bốn điểm của hai trang vào bảng; nếu
sau này đổi tên miền hoặc đổi ảnh hero, không có số cũ để so thì không biết mình đã tụt hay chưa.

## 6. Còn nợ, ghi rõ chứ không lờ đi

- **Ba bài viết lên web trước khi PHONG đọc**, theo lựa chọn của PHONG ngày 18/09. Rủi ro: Google
  có thể lập chỉ mục bản chưa duyệt; sửa sau thì phải chờ lập chỉ mục lại.
- ~~Chưa đo Lighthouse trên bản deploy~~ — PHONG đã chạy và báo xanh 20/09/2026. Còn thiếu **bốn
  con số và ảnh chụp** để làm mốc so sánh cho lần sau (xem mục 5).
- Tên miền vẫn là `pages.dev`. PHONG đã biết và chấp nhận SEO tính lại khi đổi; cách đổi ghi ở
  README và trong `site.config.mjs`.
