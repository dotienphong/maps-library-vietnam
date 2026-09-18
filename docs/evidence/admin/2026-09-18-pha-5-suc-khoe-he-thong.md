# Chứng cứ pha 5 — Sức khoẻ hệ thống (`/admin/health`)

Plan: `docs/superpowers/plans/2026-09-18-trang-admin-pha-5.md`

## 1. Bốn tầng xanh ở máy — 18/09/2026

| Tầng | Lệnh | Kết quả |
|---|---|---|
| Lint | `pnpm lint` | 646 file, không sửa gì |
| Typecheck | `turbo run typecheck --force` | 14/14, **0 cached** (bắt buộc `--force`: turbo phát lại kết quả cũ) |
| Unit | `pnpm test` | 1780 passed / 5 skipped, và 470 của `apps/api` |
| DB thật | `pnpm test:api-db` | 113 passed (10 file, gồm 4 bài mới) |
| E2E | `pnpm test:admin-e2e` | 17 passed |

## 2. Bốn phép đo thật làm nền cho thiết kế (18/09/2026)

1. Analytics Engine SQL API gọi được bằng token sẵn có → HTTP 200 kèm số liệu thật
   (`/v1/autocomplete` 127 lượt / p95 1182 ms trong 6 giờ). Production dùng token HẸP hơn.
2. `replaceRegexpAll` → **HTTP 422 `unknown function call`**. Không chuẩn hoá đường dẫn lúc đọc
   được, mà p95 không cộng dồn được → mẫu route phải ghi sẵn lúc ghi (`blob4`).
3. `c.req.routePath` sau `await next()` trả đúng mẫu: `/v1/places/abc-123` → `/v1/places/:id`;
   `/v1/admin/billing/<uuid>/usage` → `/v1/admin/billing/:id/usage`; không khớp route → `/v1/*`.
4. `blob4` truy vấn được trước khi từng ghi: trả chuỗi rỗng cho dữ liệu cũ, không phải lỗi.

## 3. Lệch spec có chủ ý

Spec 11.5 viết "kết quả cache trong KV 5 phút" cho cả màn. Bản làm ra chỉ cache **phần số liệu**
(Cache API, 5 phút, một ô mỗi cửa sổ); phần **trạng thái sống** (DB, một `/route` thật, manifest)
đo tươi mỗi lần mở. Lý do: máy chủ định tuyến là máy Mac ở nhà, nó ngủ là routing chết — một ảnh
chụp cũ 5 phút đúng lúc đó là câu trả lời sai. PHONG chốt 18/09/2026.

## 4. Secret trên production — **việc của PHONG, máy không làm được**

- [ ] Dashboard Cloudflare → Manage Account → API Tokens → Create Custom Token
- [ ] Permissions: **Account · Analytics · Read** (không thêm quyền nào khác), Account Resources:
      đúng tài khoản MapsLibVN
- [ ] `cd apps/api && npx wrangler secret put CF_ANALYTICS_TOKEN --env production`
- [ ] `npx wrangler secret list --env production` thấy `CF_ANALYTICS_TOKEN`

Cố ý KHÔNG dùng lại `CLOUDFLARE_API_TOKEN` của máy dev dù nó cũng đọc được Analytics: token đó
deploy được Worker và đọc được R2 — nhét vào Worker là biến một lỗ hổng trong Worker thành quyền
điều khiển cả tài khoản.

## 5. Deploy

Pha này **không có migration** (máy chủ giữ `0019`), nên không cần cổng `check:migration`.

- [ ] `pnpm deploy:api`
- version:
- mốc trong `wrangler deployments list --env production`:

## 6. Nghiệm thu thật trên điện thoại

- [ ] `/admin/health` mở được, ba thẻ trạng thái hiện đủ
- [ ] Bảng theo endpoint có số; p95 và tỉ lệ 5xx/429 hợp lý
- [ ] Bấm 1 giờ / 24 giờ / 7 ngày đổi được số
- [ ] Dòng "Số liệu tính đến HH:MM" đúng giờ VN
- [ ] Bảng theo tenant hiện **tên** `Phong_Admin` chứ không phải uuid (nhãn lấy từ DB)
- [ ] **Phép thử máy chủ ngủ:** tắt Docker định tuyến (hoặc để máy Mac ngủ) → thẻ Định tuyến
      chuyển "Hỏng" kèm lý do, hai thẻ còn lại vẫn bình thường

Lưu ý khi kiểm: Access chặn ở BIÊN nên gọi trần `/v1/admin/health` bằng curl luôn ra 302 — mã HTTP
**không** phân biệt được route đã deploy với route không tồn tại. Muốn biết bản nào đang chạy thì
đọc `wrangler deployments list --env production`.

## 7. Một khoảng trống đã biết, không vá trong pha này

Tiêu chí nghiệm thu số 10 của spec nói "mỗi route mới có ít nhất một bài kiểm chạy bằng role `api`
thật". Hạ tầng `pnpm test:api-db` hiện nối Postgres bằng role **chủ sở hữu**
(`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_DB` lấy thẳng từ `.env`), không phải role `api` —
điều này đúng với mọi itest sẵn có chứ không riêng pha 5. Ranh giới quyền của `api` đang được canh
ở `PERMISSIONS_SQL` (`scripts/lib/db-permissions.mjs`); dòng mà pha 5 dựa vào là
`GRANT SELECT ON tenant, api_key TO api`. Bài itest của pha 5 cố ý KHÔNG khẳng định `db.user`, vì
làm thế là đặt cho nó một cái tên nói dối về thứ nó chứng minh.
