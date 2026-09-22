# Thiết kế lại giao diện website và lan token thương hiệu — 22/09/2026

Trạng thái: **PHONG đã duyệt hướng, bố cục, hệ chữ và năm trang con trong phiên brainstorm 22/09/2026**
(qua Visual Companion, mockup nằm ở `.superpowers/brainstorm/78446-1790044079/content/`, không
commit). Spec này là bản chữ đầy đủ để viết plan và để nghiệm thu; mọi con số ở đây là quyết định,
không phải gợi ý.

Kế thừa spec `2026-09-18-thuong-mai-tu-phuc-vu-design.md` mục 11 (website) và mục 12 (console).
Chỗ nào spec này nói khác thì spec này thắng; phần SEO kỹ thuật (11.3), deploy (11.5) và mọi ràng
buộc hiệu năng của mục 11 **giữ nguyên**.

## 1. Vấn đề

PHONG xem `mapslibvn-site.pages.dev` ngày 22/09 và nêu ba điểm, đo lại đều đúng:

| Điểm PHONG nêu | Đo trên bản đang chạy |
|---|---|
| Bố cục chung chung, trang nào cũng giống nhau | Cả 5 trang con đều là **một cột chữ 768 px** xếp dọc; trang chủ là hàng thẻ 3 cột đều nhau. Không trang nào có hình ngoài ảnh hero. |
| Chỉ hai màu chủ đạo, không làm nổi ý chính | Toàn site chỉ có navy `#1b3a6b` và thang xám; nút chính, link, tiêu đề, gói nổi bật đều cùng một navy nên không gì nổi hơn gì. |
| Font và cỡ chữ chưa đẹp, chưa hợp lý | h1 36 / h2 24 / lead 18 / body 16, tracking 0. Tỉ lệ h1:body chỉ **2,25×**, các cấp chữ gần nhau nên trang không có nhịp. |

## 2. Quyết định đã chốt

| # | Câu hỏi | PHONG chốt |
|---|---|---|
| 1 | Phạm vi | Thiết kế lại hẳn `apps/site`; **lan token** sang cổng khách hàng, tài liệu và Admin qua `packages/ui/src/tokens.css`, không dựng lại ba app đó. |
| 2 | Khách | Dev và người duyệt ngân sách **ngang nhau**. |
| 3 | Hướng thẩm mỹ | **C · Bento kỹ thuật**: nền tối, một màu nhấn xanh chanh, lưới bento ô lệch cỡ, chữ máy cho số liệu và mã. Tham chiếu Linear, Supabase, Resend. |
| 4 | Bố cục trang chủ | **1 · Căn giữa, bản đồ trải ngang**: hero chữ lớn giữa, ngay dưới là bản đồ sống toàn chiều rộng, rồi bento. |
| 5 | Sáng/tối | **Tối là mặc định** bất kể cài đặt máy; vẫn giữ bản sáng đầy đủ và công tắc. |
| 6 | Nạp bản đồ | **Nạp khi cuộn tới**, ảnh tĩnh làm chỗ giữ; không bấm, không nạp ngay lúc mở trang. |
| 7 | Lan token | Site và **console tối mặc định**; **Admin giữ theo cài đặt máy**, chỉ đổi màu nhấn. Tài liệu đổi màu nhấn và tối mặc định (xem 8.3). |
| 8 | Chữ | **A · Be Vietnam Pro siết chặt** + JetBrains Mono cho số liệu, mã, nhãn ASCII. Không đổi font tiếng Việt. |
| 9 | Năm trang con | Mỗi trang một dạng nội dung chủ đạo riêng (mục 6), PHONG duyệt nguyên đề xuất. |

## 3. Phạm vi

**Trong phạm vi**

- `apps/site`: viết lại toàn bộ lớp trình bày (layout, component, trang, CSS). Giữ nguyên: nội dung
  chữ đã đối chiếu 22/09, cấu trúc URL, `TRANG`/SEO meta, JSON-LD, sitemap, robots, ba bài viết,
  `@mapslibvn/catalog` làm nguồn số duy nhất.
- `packages/ui/src/tokens.css`: bộ token mới thay navy; `theme.ts` nhận mặc định theo app.
- `apps/console`: nhận token mới, tối mặc định, sửa các chỗ ghi cứng `brand-*`/`text-white`.
- `apps/admin`: nhận token mới, giữ hành vi theme, sửa các chỗ ghi cứng `brand-*`.
- `apps/docs`: màu nhấn Starlight và tối mặc định; **không** đổi bố cục.
- Tài sản: favicon, ảnh OG, ảnh chỗ giữ bản đồ tối.

**Ngoài phạm vi**

- Đổi nội dung chữ, thêm trang mới, đổi cấu trúc URL.
- Bố cục trang tài liệu, trang Admin, cổng khách hàng (chỉ đổi màu).
- Hình minh hoạ vẽ tay, ảnh chụp người, video.
- Thêm framework giao diện (React island) vào site.

## 4. Hệ thiết kế

### 4.1. Màu

Một màu nhấn duy nhất, tách làm hai token theo vai trò: `--accent` là **màu nền** (nút, chip), `--accent-text` là **màu mực** cho mọi thứ phải đọc được hoặc nhìn thấy đường nét (chữ, link, viền nhấn, nét SVG). Bản tối hai token trùng nhau; bản sáng `--accent` chỉ đạt 1,4:1 nên không bao giờ được làm nét. Quy tắc cứng: **xanh chanh chỉ dùng cho một việc trên mỗi màn hình**, là thứ
muốn khách nhìn thấy trước (nút chính, con số đắt giá, ô thắng trong bảng đối đầu, gói nổi bật). Link
trong đoạn văn dùng `--accent-text`, không dùng `--accent`.

Token mới trong `packages/ui/src/tokens.css`, thay toàn bộ `--color-brand-*`:

| Token | Tối (`.dark`) | Sáng (`:root`) | Dùng cho |
|---|---|---|---|
| `--bg` | `#0a0a0a` | `#fafafa` | nền trang |
| `--surface` | `#111113` | `#ffffff` | thẻ, header, footer |
| `--surface-2` | `#18181b` | `#f4f4f5` | ô bento, khối mã, hàng bảng xen kẽ |
| `--border` | `#27272a` | `#e4e4e7` | viền mặc định |
| `--border-strong` | `#3f3f46` | `#a1a1aa` | viền khi hover, tab đang chọn |
| `--text` | `#fafafa` | `#0a0a0a` | chữ chính |
| `--text-muted` | `#a1a1aa` | `#52525b` | chữ phụ, lead |
| `--text-faint` | `#71717a` | `#71717a` | chỉ cho chữ lớn hoặc phần trang trí (viền, dấu chấm); không dùng cho chữ < 19 px |
| `--accent` | `#a3e635` | `#a3e635` | **chỉ làm nền** (nút chính, chip), luôn đi kèm chữ `--accent-ink` |
| `--accent-ink` | `#0a0a0a` | `#0a0a0a` | chữ đặt trên `--accent` |
| `--accent-text` | `#a3e635` | `#3f6212` | link, chữ nhấn, **viền nhấn và nét vẽ** trên nền thường |
| `--accent-soft` | `rgba(163,230,53,.10)` | `rgba(163,230,53,.18)` | nền hover nút phụ, nền chip |
| `--focus` | `#a3e635` | `#3f6212` | vòng focus 2 px, offset 2 px |

Tương phản tính theo WCAG 2.1, làm tròn một chữ số (phải ≥ 4,5:1 cho chữ thường, ≥ 3:1 cho chữ ≥ 24 px và cho
thành phần giao diện):

| Cặp | Tỉ lệ |
|---|---|
| `#fafafa` trên `#0a0a0a` | 19,0:1 |
| `#a1a1aa` trên `#0a0a0a` | 7,7:1 |
| `#71717a` trên `#0a0a0a` | 4,1:1 → **chỉ** cho chữ ≥ 24 px hoặc ≥ 19 px in đậm; không dùng cho nhãn nhỏ |
| `#a3e635` trên `#0a0a0a` | 13,1:1 |
| `#0a0a0a` trên `#a3e635` | 13,1:1 |
| `#0a0a0a` trên `#fafafa` | 19,0:1 |
| `#52525b` trên `#fafafa` | 7,4:1 |
| `#3f6212` trên `#fafafa` | 6,8:1 |
| `#a3e635` trên `#fafafa` | 1,4:1 → **cấm** làm chữ, viền hay nét vẽ ở bản sáng; chỉ làm nền với chữ `--accent-ink` |
| `#a1a1aa` trên `#fafafa` | 2,5:1 (viền hover, không phải chữ) |

Bài kiểm đơn vị đọc `tokens.css`, tính tỉ lệ cho đúng các cặp trên và đỏ nếu bất kỳ cặp nào rơi dưới
ngưỡng (mục 10). Đổi màu về sau là phải qua bài kiểm này.

Tailwind: khai báo trong `@theme` thành `--color-bg`, `--color-surface`, `--color-accent`… để dùng
được `bg-accent text-accent-ink`, `border-border`, `text-muted`. **Không còn lớp `brand-*` nào** trong
bốn app; grep `brand-` trên `apps/` và `packages/ui` phải trả 0 (trừ tên tệp/tài liệu).

`<meta name="theme-color">` đổi theo theme: tối `#0a0a0a`, sáng `#fafafa` (hai thẻ với `media`).

### 4.2. Chữ

Font: **Be Vietnam Pro** 400 / 600 / 700 / **800** (thêm nét 800 từ `@fontsource/be-vietnam-pro`,
bản đủ dải như hiện nay) và **JetBrains Mono** 400 / 600 (`@fontsource/jetbrains-mono`, chỉ cần
subset `latin`). Mọi font tự host, `font-display: swap`, preload đúng hai tệp woff2 dùng trên màn
đầu (Be Vietnam Pro 800 latin + vietnamese).

Quy tắc chữ máy: JetBrains Mono **chỉ cho chuỗi ASCII**: số tiền, phần trăm, mã lệnh, đường dẫn API,
tên gói, nhãn như `SDK`, `API`, `PLACES`. Nhãn tiếng Việt có dấu (ví dụ "TÍNH NĂNG", "ĐỊA ĐIỂM")
dùng Be Vietnam Pro 600 viết hoa, tracking `.06em`. Lý do: JetBrains Mono không có đủ dải Latin
Extended Additional, dấu tổ hợp sẽ lệch hoặc rơi font.

Thang cỡ (desktop ≥ 1024 px / mobile < 640 px):

| Cấp | Cỡ | Nét | Tracking | Giãn dòng | Dùng cho |
|---|---|---|---|---|---|
| display | 52 / 36 | 800 | −0,035em | 1,02 | h1 trang chủ |
| h1 | 44 / 32 | 800 | −0,03em | 1,05 | h1 trang con, bài viết |
| h2 | 28 / 24 | 700 | −0,02em | 1,15 | tiêu đề mục |
| h3 | 20 / 18 | 700 | −0,01em | 1,25 | tiêu đề ô bento, thẻ |
| lead | 19 / 17 | 400 | 0 | 1,55 | đoạn dẫn dưới h1 |
| body | 17 / 16 | 400 | 0 | 1,7 | thân |
| small | 15 / 14 | 400 | 0 | 1,5 | ghi chú, footer |
| stat | 34 / 28 | 800 | −0,03em | 1 | con số nổi bật, màu `--accent` |
| mono-label | 12 | 600 | +0,06em | 1 | nhãn ASCII viết hoa, màu `--text-muted` (không dùng `--text-faint`, xem 4.1) |
| code | 14 / 13 | 400 | 0 | 1,6 | khối mã |

Tỉ lệ display:body = 3,1×. Cột chữ đọc dài tối đa **68 ký tự** (≈ 720 px ở 17 px).

### 4.3. Khoảng cách, bo góc, lưới

- Khung nội dung `max-width: 1200px`, gutter 24 px (16 px mobile). Khối bản đồ trang chủ là khối duy
  nhất tràn hết viewport.
- Nhịp mục: 96 px desktop / 64 px mobile giữa các section; 24 px giữa tiêu đề mục và nội dung.
- Bo góc: thẻ và ô bento 12 px, nút 8 px, chip 6 px, khối mã 10 px. Đổi `--radius-btn` 9 → 8.
- Lưới bento: 12 cột, gap 16 px; ô rộng 2 cột lưới = `span 8`, ô 1 cột = `span 4`. Dưới 768 px mọi ô
  `span 12`, riêng hai ô số liệu (37–68% và 164) đứng cạnh nhau `span 6`.
- Viền 1 px `--border` là cách tách khối chính; **không dùng bóng đổ** ở bản tối (bóng không thấy
  trên nền đen). Bản sáng cho phép bóng 0 1px 2px rgba(0,0,0,.06).

### 4.4. Chuyển động

Hover và focus 150 ms `ease-out` trên màu nền, viền, màu chữ. Không hiệu ứng theo cuộn, không
parallax, không đếm số chạy. `prefers-reduced-motion: reduce` tắt hết transition. Giữ nguyên
nguyên tắc spec cũ 11.4.

### 4.5. Sáng/tối

Cấu trúc `tokens.css` giữ như cũ: `:root` mang giá trị **sáng**, `.dark` mang giá trị tối; chỉ **mặc
định** đổi:

- **Site** (`Base.astro`, script inline trong `<head>`): thêm `.dark` **trừ khi** `localStorage`
  `mapslibvn-site-theme === 'light'`. Không còn đọc `prefers-color-scheme`. Công tắc giữ nguyên
  hành vi lưu `'dark' | 'light'`.
- **Console**: `readStoredTheme(key, macDinh)` trong `packages/ui/src/theme.ts` nhận tham số thứ hai
  `macDinh: ThemeChoice = 'system'`; console truyền `'dark'`. Người dùng vẫn chọn được sáng, hệ thống
  vẫn là một tuỳ chọn.
- **Admin**: không truyền gì, giữ `'system'`.
- **Tài liệu**: xem 8.3.

## 5. Trang chủ

Thứ tự khối, từ trên xuống. Mọi con số lấy từ `@mapslibvn/catalog` như hiện nay (`tomTatGia`,
`soSanh`, `COMPARISON`), không chép tay.

1. **Header** dính, nền `--surface`/90 + blur, viền dưới. Logo chữ "MapsLibVN" 700; 5 mục nav; công
   tắc sáng/tối; nút "Bắt đầu miễn phí" nền `--accent` chữ `--accent-ink`. Mobile giữ ngăn kéo
   `<dialog>` hiện có.
2. **Hero căn giữa**, chiều cao tự nhiên (không ép 100vh): chip mono `$ npm i @mapslibvn/web`
   (viền `--border`, chữ `--accent-text`); h1 display 2 dòng: "Bản đồ Việt Nam / cho ứng dụng của
   bạn"; lead 1 câu (giữ câu hiện có, rút còn ≤ 140 ký tự); hai nút: chính "Bắt đầu miễn phí" →
   console, phụ "Xem bảng giá"; dòng small "Bản dùng thử 2.000 lượt Places trong 30 ngày, không cần
   thẻ." LCP là chính chữ h1, không có ảnh trong hero.
3. **Bản đồ trải ngang**: khối tràn viewport, cao 520 px desktop / 360 px mobile, bo 12 px trong khung
   1200 (mobile bo 0). Trạng thái đầu: ảnh tĩnh `ban-do-hero-dark` (bản tối) hoặc `ban-do-hero`
   (bản sáng) qua `<picture>` AVIF/WebP, kèm góc trái trên một ô tìm kiếm **tĩnh** vẽ bằng HTML
   ("chợ bến th…" và ba gợi ý thật: Chợ Bến Thành · Phường Sài Gòn; Bến Thành Tower; Ga Metro Bến
   Thành) để người xem hiểu đây là bản đồ có tìm kiếm. Khi khối vào viewport (IntersectionObserver,
   `rootMargin: 200px 0px`, chỉ một lần), thay bằng `<iframe loading="lazy">` tới
   `${DOCS_URL}/playground?embed=1&style=dark` (bản sáng: `style=light`), `title="Bản đồ MapsLibVN
   tương tác"`. Không có IntersectionObserver (trình duyệt cũ) thì hiện nút "Mở bản đồ" như hiện
   nay. Dưới khối: dòng small "Bản đồ thật do MapsLibVN phục vụ · Mở trang thử đầy đủ →". Kích
   thước cố định nên CLS = 0.
4. **Bento "Có sẵn những gì"**: tiêu đề h2 + lead một câu, rồi 6 ô, nội dung là 6 tính năng hiện có:

   | Ô | Cỡ | Nội dung | Minh hoạ (HTML/SVG tĩnh, không ảnh) |
   |---|---|---|---|
   | 1 | 8 cột | Tìm kiếm hiểu tiếng Việt | Ô nhập "cho ben thanh" + 3 gợi ý, dòng thứ hai của mỗi gợi ý là đơn vị hành chính |
   | 2 | 4 cột | Rẻ hơn Google | stat `{thap}–{cao}%` tính từ `soSanh()` như Hero cũ; small "ở ba mức dùng đã đối chiếu" |
   | 3 | 4 cột | 164 loại địa điểm | stat `164`, small "13 nhóm · OpenStreetMap + Foursquare OS" |
   | 4 | 4 cột | Geocode nói thật | khối mã 3 dòng `precision: "rooftop"` / `confidence: 0.94` / `lat, lng` |
   | 5 | 8 cột | Dẫn đường | ba chip "xe máy · ô tô · đi bộ", một SVG tuyến 2 màu (nét `--accent`, nền `--border`) |
   | 6 | 4 cột | Bốn SDK, một API | bốn dòng mono `@mapslibvn/core` … `react-native` |

   Mỗi ô: nền `--surface-2`, viền `--border`, h3, một câu body, link "→" tới trang docs tương ứng
   (giữ đúng 6 URL hiện có). Hover: viền `--border-strong`.
5. **Bốn cách nhúng**: giữ `CodeTabs` (4 tab, ARIA tablist, ghi chú, link Cài đặt) nhưng khối mã
   dùng thang `code`, tab đang chọn viền dưới 2 px `--accent`. Không tô màu cú pháp (tránh JS/CSS
   thêm); chỉ tô `--accent-text` cho tên hàm `createMap` bằng `<b>`.
6. **Giá**: h2 "Giá theo lượt gọi, không theo đầu người" + 4 thẻ như hiện nay (Dùng thử 0đ/30 ngày,
   Starter, Professional nổi bật viền `--accent` + chip "Được chọn nhiều nhất", Business). Giá dùng
   thang `stat`. Dưới 4 thẻ là **một hàng 3 cột** chữ small thay cho mục "Vì sao rẻ hơn" cũ: "Dữ liệu
   mở · không phí bản quyền", "PMTiles trên CDN · không cụm máy chủ tile", "Tính theo lượt gọi ·
   không theo người dùng". Nút "Xem đủ bốn gói và bảng so sánh →".
7. **FAQ**: 6 câu hiện có, `<details>`, viền trên mỗi hàng, dấu "+" xoay 45° khi mở (CSS).
8. **CTA cuối**: h2 "Thử trong năm phút", hai nút như hiện nay.
9. **Footer**: 4 cột như hiện nay, nền `--surface`, ghi nguồn OSM/Foursquare giữ nguyên vị trí và
   nội dung (nghĩa vụ giấy phép).

Bỏ khỏi trang chủ: mục "Vì sao rẻ hơn" dạng danh sách (đã gộp vào khối giá) và câu "Có những việc
Google làm được mà MapsLibVN thì không" (chuyển thành link nhỏ "Chỗ Google hơn →" dưới ô bento 2).

## 6. Năm trang con

Nguyên tắc chung: mỗi trang mở bằng **nhãn viết hoa** (Be Vietnam Pro 600, `--accent-text`) đặt trên
h1, h1 theo thang `h1`, và có **một dạng nội dung chủ đạo riêng**. Không trang nào là một cột chữ
thuần.

### 6.1. Tính năng — hàng xen kẽ + mục lục dính

- Lưới 2 cột từ 1024 px: cột trái 220 px là **mục lục dính** (`position: sticky; top: 88px`) liệt kê
  6 mục, mục đang xem tô `--accent-text` bằng IntersectionObserver (≤ 15 dòng JS; không có JS thì
  vẫn là danh sách link neo).
- Cột phải: 6 **hàng**, mỗi hàng lưới 2 cột: chữ (h2 + 2 đoạn body + link) và **bằng chứng thật**
  đối diện; hàng chẵn đảo bên. Bằng chứng theo mục:
  - Bản đồ nền: ảnh bản đồ thật (AVIF/WebP), 2 chip "sáng / tối".
  - Địa điểm: bảng 13 nhóm hiện có, đặt trong khung cuộn cao 320 px.
  - Tìm kiếm: ô gợi ý tĩnh như bento ô 1 nhưng với truy vấn khác ("q1 ho chi minh" → "Quận 1 (cũ) →
    Phường Bến Nghé, Sài Gòn…" — lấy đúng dữ liệu thật khi làm, không bịa).
  - Geocode: khối JSON 6 dòng có `precision`, `confidence`.
  - Dẫn đường: SVG tuyến + 3 dòng hướng dẫn tiếng Việt mẫu.
  - SDK: 4 dòng mono tên gói + phiên bản đọc từ `packages/*/package.json` lúc build (không ghi cứng
    version, theo memory "không ghi version cứng trong docs").
- Mục "Những thứ chưa có" giữ nội dung, trình bày thành **4 chip gạch ngang** trên nền `--surface-2`.

### 6.2. Bảng giá — thanh ước tính + bảng đối chiếu

- Đầu trang, dưới h1: **thanh ước tính**. Một ô nhập số lượt Places mỗi tháng (kiểu `number`, bước
  1.000, mặc định 50.000) và một ô lượt tính tuyến (mặc định 5.000). Kết quả hiện ngay: gói nhỏ nhất
  có cả `places` và `directions` ≥ số nhập, giá VND tháng đó (thang `stat`, `--accent`); vượt
  Business thì hiện "Trên 400.000 lượt: liên hệ để có gói riêng". Logic là hàm thuần
  `goiPhuHop(places, directions)` trong `src/lib/gia.ts`, có test; giao diện là ≤ 30 dòng JS đọc
  `data-*` đã render sẵn cho cả 4 gói. Không có JS thì thanh ẩn (`hidden` gỡ bằng JS).
- 4 thẻ gói và công tắc kỳ 1/3/6/12 giữ nguyên hành vi.
- Dưới thẻ: **bảng đối chiếu hạn mức** 5 cột (tiêu chí + 4 gói), hàng: Places mỗi kỳ, Tuyến mỗi kỳ,
  Trần ngày, Hỗ trợ trực tuyến, Mua thêm lượt, Kỳ mua được, Giá tháng. Ô của gói nổi bật tô
  `--accent-soft`. Dữ liệu từ `bangGia()`.
- Mua thêm lượt, bảng so sánh Google/VIETMAP (`ComparisonTable`), FAQ giá, dòng điều khoản giữ
  nguyên nội dung; `ComparisonTable` nhận kiểu mới ở 6.3.

### 6.3. So sánh — bảng đối đầu hai cột

- Mỗi trang so sánh (Google, VIETMAP) có một **bảng đối đầu** là nội dung chủ đạo: cột tiêu chí,
  cột MapsLibVN, cột đối thủ. Mỗi hàng khai báo `thang: 'ta' | 'ho' | 'hoa'`; ô thắng tô chữ
  `--accent-text` và dấu ✓; ô thua chữ `--text-faint`; hoà không tô. **Chỗ đối thủ hơn vẫn tô cho đối
  thủ**, không giấu.
- Dữ liệu là module `src/lib/doi-dau.ts` xuất `DOI_DAU_GOOGLE`, `DOI_DAU_VIETMAP`; ba hàng chi phí
  đầu tiên lấy từ `COMPARISON.rows` (không chép tay). Các hàng còn lại chuyển từ nội dung `HOP_HON`,
  `GOOGLE_HON`, `KHAC_BIET` hiện có: phủ toàn cầu, Street View và ảnh vệ tinh, giao thông thời gian
  thực, chi tiết địa điểm thương mại, cam kết mức dịch vụ, tự host, thanh toán VND, hiểu cách người
  Việt gõ, geocode kèm độ chính xác; với VIETMAP thêm cách tính tiền và nguồn dữ liệu.
- Bài kiểm: mọi hàng có `thang`; không hàng nào ghi "ta thắng" ở tiêu chí nằm trong danh sách "chưa
  có" của trang Tính năng (ma trận khoảng cách, tối ưu đội xe, giao thông thời gian thực, Street View,
  ảnh vệ tinh).
- Dưới bảng: giữ "Khi nào nên chọn cái nào" (2 cột), "Chuyển sang thì mất gì", FAQ, CTA. Bỏ hai
  danh sách "Chỗ MapsLibVN hợp hơn" / "Chỗ Google hơn" vì đã vào bảng; câu mở đầu "bản so sánh do
  chính nhà cung cấp viết" giữ nguyên.

### 6.4. Bài viết — bài dẫn lớn + danh sách gọn

- Bài mới nhất là **khối dẫn** 2 cột: trái là ô màu `--surface-2` cao 240 px có nhãn tag + trích câu
  đầu của bài (không cần ảnh; frontmatter `anh` là tuỳ chọn cho sau, có thì thay ô màu); phải là
  ngày, h2, description, link.
- Các bài còn lại: **hàng một dòng** (tiêu đề + ngày mono bên phải), viền trên.
- Trang bài: cột chữ 720 px; từ 1280 px thêm **mục lục bên phải** sinh từ h2 của bài lúc build
  (`render()` trả `headings`), dính theo cuộn. Khối CTA cuối bài giữ nguyên.

### 6.5. Liên hệ — hai cột

- Trái: hai thẻ kênh. Thẻ "Gọi" viền `--accent`, số điện thoại thang `h2`, `tel:` như cũ. Thẻ
  "Thư" viền thường.
- Phải: bảng giờ hỗ trợ (2 hàng) và 3 đường tắt hiện có.
- Nội dung, số, email, giờ **không đổi**.

### 6.6. 404

Giữ nội dung; áp token và thang chữ mới; số "404" thang `display` màu `--accent`.

## 7. Thành phần dùng chung trong `apps/site`

Tách để mỗi tệp một việc (nhiều tệp `.astro` hiện đang tự vẽ lại thẻ/nút):

| Component | Việc |
|---|---|
| `Nut.astro` | nút `chinh`/`phu`/`mo`, size, `href` hoặc `button`; là nơi duy nhất viết lớp màu nút |
| `Nhan.astro` | nhãn viết hoa trên h1 và trong ô bento (`mono` hay Be Vietnam Pro tuỳ ASCII) |
| `The.astro` | thẻ/ô có viền, nền `--surface`/`--surface-2`, tuỳ chọn `noiBat` |
| `Bento.astro` + `BentoO.astro` | lưới 12 cột và ô `span` |
| `BanDoSong.astro` | khối bản đồ trải ngang: `<picture>` + IntersectionObserver + iframe |
| `ThanhUocTinh.astro` | thanh ước tính giá (6.2) |
| `BangDoiDau.astro` | bảng đối đầu (6.3) |
| `MucLucDinh.astro` | mục lục dính (6.1, 6.4) |
| `SoLieu.astro` | con số thang `stat` + nhãn |
| `Header`, `Footer`, `Faq`, `CodeTabs`, `PricingCards`, `ComparisonTable`, `Prose`, `SeoHead` | giữ, đổi lớp màu/chữ |

Component **không** được ghi mã màu; chỉ dùng token. Lint: grep `#[0-9a-f]{6}` trong
`apps/site/src` phải trả 0 ngoài `tokens.css` và SVG.

## 8. Lan token sang các app khác

### 8.1. `packages/ui`

- `tokens.css`: thay toàn bộ như 4.1; giữ `--radius-card`, đổi `--radius-btn` 8, giữ
  `--radius-sheet`.
- `button.tsx`: `primary` → `bg-accent text-accent-ink hover:brightness-95`; `secondary`/`ghost` hover
  `bg-accent-soft`; focus ring `outline-[var(--focus)]`.
- `badge.tsx`, `card.tsx`, `states.tsx`, `record-view.tsx`: đổi mọi `brand-*` sang token ngữ nghĩa
  tương ứng (xem bảng ánh xạ trong plan). Test hiện có phải xanh, thêm assert không còn `brand-`.
- `theme.ts`: `readStoredTheme(storageKey, macDinh: ThemeChoice = 'system')`.

### 8.2. `apps/console` và `apps/admin`

- Console: `lib/theme.ts` truyền `'dark'`; `index.html` hai thẻ `theme-color`; sửa 24 chỗ `brand-*`
  và 6 chỗ `bg-brand-700 … text-white` sang token. Màn Đơn hàng: mã QR luôn đặt trên ô **nền trắng**
  cố định bất kể theme (máy quét cần nền sáng).
- Admin: sửa 9 chỗ `brand-*`, 2 chỗ `text-white`; `index.html` `theme-color`; **không** đổi mặc định
  theme. Bảng, biểu đồ, trạng thái giữ như cũ.
- Cả hai: chạy e2e/itest hiện có; screenshot 2 theme × 3 màn chính vào `docs/evidence/site-redesign/`.

### 8.3. `apps/docs` (Starlight)

- `custom.css`: đặt `--sl-color-accent-low/-accent/-accent-high` theo xanh chanh cho `:root` và
  `[data-theme='light']` (Starlight có sẵn hai khối); bản sáng dùng `#3f6212` cho `--sl-color-accent`
  để chữ trên nền trắng đủ tương phản; nút chính Starlight (`.sl-link-button.primary`) chữ
  `#0a0a0a` trên `#a3e635`.
- Mặc định tối: script inline qua `head` của Starlight config: nếu `localStorage['starlight-theme']`
  trống thì đặt `document.documentElement.dataset.theme = 'dark'`. Công tắc Starlight giữ nguyên.
- Không đổi bố cục, sidebar, nội dung.

## 9. Tài sản

- **Favicon** `apps/site/public/favicon.svg`: nền tròn `#0a0a0a`, chữ M `#a3e635`. Console/admin dùng
  favicon riêng nếu có thì đổi cùng màu.
- **Ảnh OG** (`scripts/site-images.mjs`): nền `#0a0a0a`, tiêu đề `#fafafa` Be Vietnam Pro 800, gạch
  nhấn `#a3e635`; sinh lại 4 ảnh hiện có. Script hiện có đã dùng Playwright.
- **Ảnh chỗ giữ bản đồ tối** `apps/site/src/assets/ban-do-hero-dark.jpg`: chụp
  `${DOCS_URL}/playground?embed=1&style=dark` ở 1600×700 bằng Playwright, thêm lệnh `--hero` vào
  `scripts/site-images.mjs`; ảnh sáng hiện có giữ cho bản sáng. Ảnh là nguồn tĩnh, không sinh lúc
  build site.

## 10. Ràng buộc kỹ thuật giữ nguyên và kiểm thử

**Giữ nguyên từ spec 11.1/11.3:** không React, Astro tĩnh, `trailingSlash: 'always'`, sitemap, robots,
JSON-LD, mọi trang một h1, `title` ≤ 60, `description` 120–160, vùng chạm ≥ 44 px.

**Ngân sách:** không tệp JS ngoài; JS inline toàn trang chủ < 15 KB thô (bài e2e hiện có giữ nguyên
ngưỡng); iframe bản đồ không tính vào ngân sách site nhưng **không được nạp trước khi cuộn tới**.
Font tải thêm tối đa 60 KB (Be Vietnam Pro 800 hai subset + JetBrains Mono latin hai nét). LCP là
h1; CLS = 0 ở khối bản đồ và khối dẫn bài viết.

**Kiểm đơn vị (vitest, `apps/site/src/lib`):**
- `tokens.test.ts`: đọc `packages/ui/src/tokens.css`, tính tương phản các cặp ở 4.1, mọi cặp phải đạt
  ngưỡng ghi cạnh nó.
- `gia.test.ts`: thêm `goiPhuHop`: (0,0)→trial; (30.000,3.000)→starter; (30.001,0)→professional;
  (400.000,40.000)→business; (400.001,0)→null.
- `doi-dau.test.ts`: mọi hàng có `thang`; ba hàng đầu khớp `COMPARISON`; không hàng "ta" nào trùng
  danh sách "chưa có".
- `trang.test.ts`, `seo.test.ts`: giữ.

**E2E (Playwright, `apps/site/e2e`):**
- Sửa "bản đồ hero chỉ nạp iframe sau khi bấm" → "bản đồ trải ngang chỉ nạp iframe sau khi cuộn tới":
  mở trang, `iframe` count 0; cuộn khối vào viewport; count 1, `src` chứa `style=dark`.
- Mới: "mặc định tối, chọn sáng thì nhớ": lần đầu `html.dark` có; bấm công tắc; reload; không còn.
- Mới: "thanh ước tính đổi gói theo số nhập": nhập 120.000 → chữ "Business"; 20.000 → "Starter".
- Mới: "bảng đối đầu tô đúng bên thắng": hàng "Street View" có ✓ ở cột Google, không ở cột MapsLibVN.
- Mới: "trang chủ không còn lớp brand-": `document.querySelector('[class*="brand-"]')` là null.
- Giữ: link sống, 404, ngăn kéo, tab, giá khớp catalog, ngân sách JS, ghi nguồn, điện thoại, SEO.

**Nghiệm thu bằng mắt (PHONG):** screenshot 7 trang × 2 theme × 2 khổ (390, 1280) lưu
`docs/evidence/site-redesign/<ngày chạy>/`, PHONG duyệt trước khi push. Lệnh chụp thêm vào
`scripts/site-images.mjs --shots`.

## 11. Thứ tự làm

Bốn pha, mỗi pha một nhánh con và một lần PHONG xem:

| Pha | Việc | Kết quả nhìn thấy |
|---|---|---|
| 0 | Token mới + font + `theme.ts` + mặc định tối ở site; migrate `brand-*` trong `packages/ui` | Site cũ chạy trên màu mới, tối mặc định; test token xanh |
| 1 | Trang chủ: 9 khối mục 5, component mục 7, `BanDoSong`, ảnh hero tối | Trang chủ mới hoàn chỉnh, e2e xanh |
| 2 | Năm trang con + 404 theo mục 6 | Toàn site mới |
| 3 | Console, Admin, Docs theo mục 8; favicon, OG theo mục 9; screenshot nghiệm thu | Ba mặt tiền cùng thương hiệu |

Pha 3 chỉ bắt đầu sau khi PHONG duyệt pha 2 bằng mắt. Mỗi pha một commit nhóm, DEVLOG ghi ở pha
cuối cùng và mỗi khi có quyết định lệch spec.

## 12. Rủi ro và cách chặn

| Rủi ro | Chặn |
|---|---|
| Xanh chanh làm chữ ở bản sáng (1,5:1) | Token tách `--accent` / `--accent-text`; test tương phản; e2e bản sáng |
| JetBrains Mono rơi dấu tiếng Việt | Quy tắc "mono chỉ ASCII" ở 4.2; `Nhan.astro` tự chọn font theo regex `/^[\x20-\x7e]+$/` |
| Playground không nhận `style=dark` | Đã có sẵn `fromSearchParams` đọc `style` (playground-lib.js dòng 154); pha 1 chụp ảnh để xác nhận, nếu hỏng thì sửa playground trước |
| Admin vỡ màu vì token đổi | Pha 0 chạy build + e2e admin; screenshot 3 màn; mọi `brand-*` được migrate trong cùng commit với `tokens.css` |
| Người dùng cũ của site đang lưu `'dark'`/`'light'` | Giá trị lưu vẫn đúng nghĩa; chỉ mặc định đổi |
| Typecheck xanh giả do Turbo cache (memory) | Chạy `pnpm --filter … typecheck --force` ở cuối mỗi pha |
| Ảnh OG cũ còn trong cache mạng xã hội | Đổi tên tệp OG (`-v2`) để bust cache; cập nhật `TRANG.*.og` |

## 13. Tiêu chí nghiệm thu

1. Mở `mapslibvn-site.pages.dev` lần đầu trên máy đặt sáng: thấy bản tối; bật sáng, reload: giữ sáng.
2. Trang chủ có đúng 9 khối theo mục 5; bento 6 ô đúng nội dung; bản đồ trải ngang không có iframe
   trước khi cuộn, có sau khi cuộn, và nền bản đồ tối.
3. Năm trang con nhìn khác nhau ở dạng nội dung chủ đạo (mục lục dính + hàng xen kẽ / thanh ước tính +
   bảng hạn mức / bảng đối đầu / bài dẫn + hàng gọn / hai cột).
4. Không còn `brand-` trong `apps/` và `packages/ui`; test tương phản xanh; `#1b3a6b` không còn xuất
   hiện ngoài lịch sử git.
5. Toàn bộ vitest, `astro check`, biome, `astro build`, Playwright site xanh; console và admin build +
   test xanh; docs build xanh.
6. Bốn workflow deploy xanh; PHONG duyệt bộ screenshot ở `docs/evidence/site-redesign/`.
