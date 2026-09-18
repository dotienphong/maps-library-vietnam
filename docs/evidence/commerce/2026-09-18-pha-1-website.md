# Chứng cứ pha 1 — website `apps/site`

Plan: `docs/superpowers/plans/2026-09-18-thuong-mai-pha-1-website.md`
Spec: `docs/superpowers/specs/2026-09-18-thuong-mai-tu-phuc-vu-design.md` mục 11 và 19.
Ngày chạy: 18/09/2026. 14 task, 14 commit.

## 1. Cổng ở máy — số thật

| Lệnh | Kết quả |
|---|---|
| `pnpm lint` | 713 file, sạch |
| `npx turbo run typecheck --force` | **17/17 task, 0 cached**, 17,6 s |
| `npx vitest run apps/site/src` | 5 file / **35 test** xanh |
| `pnpm test` (gốc, nay gồm cả build site) | 193 file / **1.857 test** xanh, 5 skip |
| `pnpm --filter @mapslibvn/api test` | 62 file / **480 test** xanh |
| `pnpm test:site-e2e` | **20/20** xanh, 7,4 s |
| `pnpm test:admin-e2e` | **17/17** xanh, 1,1 phút |

## 2. Hiệu năng đo trên bản build

| Hạng mục | Số đo | Ngân sách plan |
|---|---|---|
| JavaScript trang chủ | **598 byte gzip**, 3 khối nhúng, **0 tệp `.js` ngoài** | 15.000 byte |
| HTML trang chủ (nén) | 7.524 byte | — |
| Ảnh hero, bản AVIF nhỏ nhất | 35 KB | — |
| Ảnh OG | 22–42 KB mỗi tấm | 200 KB |
| Ảnh hero gốc trong repo | 559 KB JPEG | — |

Astro nhúng thẳng ba khối script nhỏ vào HTML nên trang chủ **không tải thêm một tệp JavaScript
nào**. Một island React sẽ là khoảng 45 KB gzip; bài e2e "ngân sách JavaScript trang chủ" khoá
lại điều này.

## 3. SEO — bảy trang, đã kiểm bằng e2e trên bản build

- [x] Mỗi trang đúng **một** `<h1>`, `<html lang="vi">`.
- [x] `title` ≤ 60 ký tự, `description` 120–160 ký tự — ép ở cả `trang.test.ts` lẫn e2e.
- [x] `canonical` tuyệt đối, luôn có dấu gạch cuối, khớp `SITE_URL`.
- [x] `og:image` có mặt và **ảnh trỏ tới thật sự tồn tại** (bài e2e riêng).
- [x] Mọi khối JSON-LD parse được, có `@context` và `@type`: Organization ở mọi trang, cộng
      SoftwareApplication, FAQPage, BreadcrumbList, Article tuỳ trang.
- [x] `robots.txt` trỏ sitemap tuyệt đối; sitemap có đúng **7 trang**, không có `/404`, không có
      bài viết chưa duyệt.
- [x] Ảnh AVIF + WebP ba cỡ qua `<Picture>`, `fetchpriority="high"` cho ảnh hero.

## 4. Những lời hứa có bài test khoá lại

- [x] **Giá vẫn đúng khi tắt JavaScript** — bốn kỳ render sẵn vào `data-*` lúc build.
- [x] **Công tắc kỳ đổi giá** bằng chuột và bằng bàn phím (mũi tên).
- [x] **Hero không nạp iframe trước khi bấm** — trước khi bấm có 0 iframe.
- [x] **Ghi nguồn ODbL và Apache-2.0 có ở mọi trang** — đây là nghĩa vụ giấy phép, không phải
      trang trí.
- [x] Mọi link nội bộ trên bảy trang trả 200; `/khong-co-that/` trả 404 và trang 404 dùng được.
- [x] Điều hướng bấm được ở khung 390 px; ba tab mã nhúng đổi được bằng bàn phím.
- [x] Công tắc sáng tối nhớ lựa chọn qua lần tải lại.

## 5. Việc tay của PHONG, theo thứ tự

1. **Tạo project Cloudflare Pages tên `mapslibvn-site`.** Chưa có thì workflow `Deploy Site` đỏ
   với "project not found"; tạo xong chạy lại workflow là được.
2. **Đọc và duyệt ba bài viết** trong `apps/site/src/content/bai-viet/`. Duyệt bài nào thì đổi
   `daDuyet: false` thành `true` trong frontmatter bài đó; chưa duyệt thì bài không lên web và
   không vào sitemap.
3. **Xác thực Google Search Console và Bing Webmaster** cho `mapslibvn-site.pages.dev`, gửi
   `sitemap-index.xml`, rồi ghi ngày kiểm lại chỉ mục vào đây.
4. **Chạy Lighthouse mobile** trên bản deploy thật cho trang chủ và trang bảng giá, dán bốn điểm
   vào bảng dưới. Số ở máy không thay thế được số trên bản deploy.

| Trang | Performance | Accessibility | Best practices | SEO | LCP |
|---|---|---|---|---|---|
| `/` | | | | | |
| `/bang-gia/` | | | | | |

Ngưỡng spec: Performance ≥ 90, SEO 100, Accessibility ≥ 95, LCP ≤ 2,5 s, CLS ≤ 0,1, TBT ≤ 200 ms.

## 6. Còn nợ, ghi rõ chứ không lờ đi

- Trang `/bai-viet/` hiện **rỗng** trên bản deploy vì cả ba bài chờ duyệt. Đúng thiết kế, nhưng là
  một trang trống với người vào xem cho tới khi PHONG duyệt.
- Chưa đo Lighthouse trên bản deploy, nên bốn ngưỡng hiệu năng của spec **chưa được chứng minh**;
  số ở mục 2 chỉ nói về khối lượng tải, không nói về điểm số.
- Tên miền vẫn là `pages.dev`. PHONG đã biết và chấp nhận SEO tính lại khi đổi; cách đổi ghi ở
  README và trong `site.config.mjs`.
