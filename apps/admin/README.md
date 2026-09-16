# Admin Page

Trang quản trị MapsLibVN. SPA tĩnh, build ra `dist/admin`, do Worker API phục vụ tại `/admin/`
và bảo vệ bằng Cloudflare Access.

## Chạy tại máy

**Không dùng `wrangler dev` trần**: máy dev không có Cloudflare Access nên `ACCESS_TEAM_DOMAIN`
trống, mọi route `/v1/admin/*` trả 401 và trang trắng trơn. Dùng harness có JWKS giả:

```bash
pnpm db:up
node scripts/api-db-test.mjs --serve   # DB cô lập + seed + wrangler dev :8799 + Access giả
```

Rồi mở http://127.0.0.1:8799/admin/

Muốn sửa giao diện có nạp nóng thì chạy thêm `pnpm --filter @mapslibvn/admin dev` ở cửa sổ khác,
nhưng các lời gọi API vẫn phải trỏ về cổng 8799.

## Địa chỉ

| Môi trường | Địa chỉ |
| --- | --- |
| Production | https://api.ai-solutions.io.vn/admin/ |
| Harness | http://127.0.0.1:8799/admin/ |

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
