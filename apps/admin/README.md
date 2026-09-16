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
database dev thường ngày của bạn. Dừng bằng `Ctrl+C`.

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
- **Ngăn kéo tự đóng khi đường dẫn đổi**, không gắn `onClick` vào từng liên kết: `SidebarNav` còn
  dùng cho sidebar cố định ở màn hình rộng, nơi không có ngăn kéo nào để đóng.
