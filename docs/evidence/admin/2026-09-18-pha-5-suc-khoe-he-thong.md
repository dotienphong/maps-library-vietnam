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

## 4. Secret trên production — XONG 18/09/2026

- [x] Token riêng, chỉ quyền **Account · Account Analytics · Read**, không lọc IP (Worker gọi ra
      từ mạng Cloudflare, IP không đoán trước), không TTL
- [x] `wrangler secret put CF_ANALYTICS_TOKEN --env production` — PHONG chạy
- [x] `wrangler secret list --env production` thấy `CF_ANALYTICS_TOKEN` (xác minh 18/09 19:2x)

Cố ý KHÔNG dùng lại `CLOUDFLARE_API_TOKEN` của máy dev dù nó cũng đọc được Analytics: token đó
deploy được Worker và đọc được R2 — nhét vào Worker là biến một lỗ hổng trong Worker thành quyền
điều khiển cả tài khoản.

## 5. Deploy — XONG 18/09/2026

Pha này **không có migration** (máy chủ giữ `0019`), nên không cần cổng `check:migration`.

- [x] `pnpm deploy:api` từ cây mã sạch tại commit `01476f9`
- **Version ID: `fd681b58-9cde-4f19-b863-7d83307b83d3`** (bản ngay trước đó: `cee95ba8`, sinh ra
  bởi chính lần đặt secret)
- `env.CF_ACCOUNT_ID` hiện trong bảng binding của lần deploy → biến đã tới được production

**Kiểm ngay sau deploy phần công khai gọi được** (`/healthz/db` bị refactor ở Task 6 nên phải soát):

```
{"ok":true,"user":"api","version":"PostgreSQL 16.4","word_similarity_threshold":0.6,
 "schema_migration":"0019_admin_audit_detail_object.sql"}   HTTP 200 · 0.78 s
```

Đúng như trước khi tách hàm, và xác nhận luôn production nối DB bằng role `api` thật — điều mà
tầng itest KHÔNG chứng minh được (xem mục 7).

## 6. Xác minh trên production bằng `wrangler tail` — 18/09/2026

Một lượt PHONG mở trang thật, đọc từ log production. **Không có dòng lỗi nào**, không có
`analytics sql 403` — tức token có đúng quyền `Account Analytics: Read`.

| Lượt gọi | status | wallTime | Đọc ra điều gì |
|---|---|---|---|
| `/v1/admin/health` lần 1 | 200 | 1686 ms | ba phép đo sống chạy thật |
| `/v1/admin/health` lần 2 | 200 | 604 ms | vẫn đo lại — KHÔNG cache, đúng thiết kế |
| `/v1/admin/metrics?window=24h` | 200 | 1829 ms | truy vấn Analytics Engine thật |
| `/v1/admin/metrics?window=1h` | 200 | 312 ms | mỗi cửa sổ một ô cache riêng |
| `/v1/admin/metrics?window=24h` lần 2 | 200 | **15 ms** | **trúng cache 5 phút** |

Đây là bằng chứng mạnh hơn "nhìn thấy số trên màn hình": 15 ms là không thể nếu nó đi hỏi
Analytics lại, và 604 ms là không thể nếu trạng thái sống bị cache.

## 7. Nghiệm thu bằng mắt — PHONG **PASS 18/09/2026**

- [x] `/admin/health` mở được, ba thẻ trạng thái hiện đủ
- [x] Bảng số liệu có số (xác minh cả bằng log production, mục 6)
- [x] Đổi cửa sổ 1 giờ / 24 giờ / 7 ngày chạy được
- [x] **Phép thử máy chủ ngủ: PASS.** Tắt định tuyến → thẻ Định tuyến chuyển "Hỏng" kèm lý do,
      DB và Dữ liệu vẫn bình thường. Đây là phép thử đáng giá nhất của cả pha: nó chứng minh việc
      bọc lỗi riêng từng phép đo hoạt động thật, thứ mà một ngày mọi thứ đều xanh không chứng minh
      được.

**PHA 5 ĐÓNG.**

Lưu ý khi kiểm: Access chặn ở BIÊN nên gọi trần `/v1/admin/health` bằng curl luôn ra 302 — mã HTTP
**không** phân biệt được route đã deploy với route không tồn tại. Muốn biết bản nào đang chạy thì
đọc `wrangler deployments list --env production`, hoặc `wrangler tail` như mục 6.

## 8. Một khoảng trống đã biết, không vá trong pha này

Tiêu chí nghiệm thu số 10 của spec nói "mỗi route mới có ít nhất một bài kiểm chạy bằng role `api`
thật". Hạ tầng `pnpm test:api-db` hiện nối Postgres bằng role **chủ sở hữu**
(`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_DB` lấy thẳng từ `.env`), không phải role `api` —
điều này đúng với mọi itest sẵn có chứ không riêng pha 5. (Production thì có: `/healthz/db`
sau deploy trả `user: "api"` — xem mục 5.) Ranh giới quyền của `api` đang được canh
ở `PERMISSIONS_SQL` (`scripts/lib/db-permissions.mjs`); dòng mà pha 5 dựa vào là
`GRANT SELECT ON tenant, api_key TO api`. Bài itest của pha 5 cố ý KHÔNG khẳng định `db.user`, vì
làm thế là đặt cho nó một cái tên nói dối về thứ nó chứng minh.
