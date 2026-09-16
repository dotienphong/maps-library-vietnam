# Admin Page

Trang quản trị MapsLibVN. SPA tĩnh, build ra `dist/admin`, do Worker API phục vụ tại `/admin/`
và bảo vệ bằng Cloudflare Access.

## Chạy ở máy để test

**Không dùng `wrangler dev` trần**: máy dev không có Cloudflare Access nên `ACCESS_TEAM_DOMAIN`
trống, mọi route `/v1/admin/*` trả 401 và trang trắng trơn. Luôn chạy qua harness có Access giả.

### Cách 1 — xem đúng như production (một cửa sổ terminal)

```bash
pnpm db:up                                  # Postgres trong Docker
pnpm --filter @mapslibvn/admin build        # Worker phục vụ dist/, nên phải build trước
node scripts/api-db-test.mjs --serve        # DB test riêng + seed + wrangler dev :8799 + Access giả
```

Mở **http://127.0.0.1:8799/admin/**

Đây là bản giống production nhất: cùng Worker, cùng cách phục vụ file tĩnh. Đổi mã giao diện thì
phải `build` lại rồi tải lại trang.

### Cách 2 — sửa giao diện có nạp nóng (hai cửa sổ terminal)

```bash
# Cửa sổ 1 — API
pnpm db:up
node scripts/api-db-test.mjs --serve

# Cửa sổ 2 — giao diện
pnpm --filter @mapslibvn/admin dev
```

Mở **http://localhost:5173/admin/**

Vite proxy mọi lời gọi `/v1/*` sang harness ở cổng 8799 và **tự chèn JWT Access giả**, nên không
phải đăng nhập gì. Sửa file là trang tự cập nhật.

`node scripts/api-db-test.mjs --serve` **drop rồi tạo lại một database test riêng**, không đụng
database dev thường ngày của bạn. Nó cũng nạp fixture tiles Quận 1 vào R2 local và trỏ
`TILES_BASE` về chính nó, nên **bản đồ trong màn chi tiết đóng góp hiển thị được ngay ở máy**,
không cần mạng và không phụ thuộc dữ liệu production. Dừng bằng `Ctrl+C`.

Fixture chỉ phủ Quận 1, TP.HCM — đóng góp ở nơi khác vẫn dựng bản đồ nhưng nền sẽ trống.

## Địa chỉ

| Môi trường | Địa chỉ |
| --- | --- |
| Production | https://api.ai-solutions.io.vn/admin/ |
| Harness (giống production) | http://127.0.0.1:8799/admin/ |
| Vite dev (nạp nóng) | http://localhost:5173/admin/ |

## Kiểm thử

```bash
pnpm exec vitest run apps/admin/src   # component, chạy từ gốc repo
pnpm test:admin-e2e                   # Playwright, tự dựng harness
```

Mỗi file test giao diện phải mở đầu bằng `// @vitest-environment jsdom` — bộ test gốc chạy chung
với `scripts/**/*.test.mjs` trên Node nên không đặt jsdom toàn cục.

## Vài quyết định đáng nhớ

- **Hoãn gửi 5 giây thay cho hoàn tác.** Duyệt một đóng góp gọi `apply_poi_edit`, ghi thẳng vào
  bảng POI và xoá cache — đảo ngược sạch sẽ là không làm được. Nên khi bấm Duyệt, giao diện cập
  nhật ngay nhưng **chưa gửi gì**; bấm Huỷ trong 5 giây là thôi hẳn.
- **Bản đồ chỉ xuất hiện khi trả lời được câu hỏi của người duyệt** (`mapPlan` trong
  `features/edits/edit-map.tsx`). `update` không đụng toạ độ thì không vẽ gì và không tải
  `maplibre-gl` về.
- **Worker tự phục vụ `index.html` cho `/admin/*`** thay vì bật chế độ SPA của Cloudflare Assets:
  chế độ đó trả `index.html` cho mọi path không khớp asset, biến một `/v1/*` gõ sai thành trang
  HTML thay vì lỗi JSON.
- **Bản đồ dựng qua `@mapslibvn/web`, không tự gọi maplibre** (`map-runtime.ts`). SDK lo giao
  thức `pmtiles://`, hợp đồng style và attribution bắt buộc — trang admin không có lý do làm lại.
  Kèm lợi ích: trang quản trị dùng đúng thứ khách hàng dùng, nên lỗi SDK lộ ra ở đây trước.
  Vì vậy `pnpm --filter @mapslibvn/web build` phải chạy **trước** khi build admin; hai workflow
  `apitest.yml` và `deploy-api.yml` đã có bước đó.
- **Bản build phải xuất kèm Web Worker của maplibre** (`vite.config.ts`, plugin
  `xuatWorkerMaplibre`). maplibre giải mã ô trong worker và dựng URL worker cạnh chunk của chính
  nó; Vite không tự xuất tệp đó. Thiếu nó thì nền bản đồ trắng, chốt vị trí vẫn hiện và **không có
  lỗi nào** — sự cố 16/09/2026. Worker còn import `maplibre-gl-shared.mjs` nên phải chép cả hai.
- **Bản đồ hỏng thì nói ra.** `EditMap` hiện "Không tải được bản đồ" kèm lý do, vì một khung trống
  câm lặng trông y hệt một tính năng chưa làm.
- **Ngăn kéo tự đóng khi đường dẫn đổi**, không gắn `onClick` vào từng liên kết: `SidebarNav` còn
  dùng cho sidebar cố định ở màn hình rộng, nơi không có ngăn kéo nào để đóng.
