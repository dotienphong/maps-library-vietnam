# Pha 2 trang Admin — Tenant & khoá API: chứng cứ nghiệm thu

**Ngày:** 16/09/2026 · **Commit deploy:** `c9a7a15` · **Plan:** `docs/superpowers/plans/2026-09-16-trang-admin-pha-2.md`

## 1. Thứ tự migration → deploy (đo bằng máy)

`/healthz/db` ngay sau khi áp migration:

```json
{ "ok": true, "user": "api", "version": "PostgreSQL 16.4",
  "word_similarity_threshold": null,
  "schema_migration": "0019_admin_audit_detail_object.sql" }
```

Log bước `check:migration` của workflow **Deploy API** (run 35078237081):

```
[migration-gate] DB production đã ở 0019_admin_audit_detail_object.sql.
```

Cổng in dòng này **trước** khi `wrangler deploy` chạy, nên Worker mang mã pha 2 lên sau khi DB đã có
`0018` (GRANT INSERT trên `api_key`) và `0019` (nắn `admin_audit.detail`). Đây chính là thứ tự mà sự
cố 06–07/09/2026 đã dạy.

## 2. Cloudflare Access vẫn phủ route mới (đo bằng máy)

```
GET https://api.ai-solutions.io.vn/v1/admin/tenants  → 302 (chuyển về màn đăng nhập)
```

## 3. Bốn bước nghiệm thu chức năng — PHONG xác nhận PASS ngày 16/09/2026

| # | Việc kiểm | Kết quả |
|---|---|---|
| 1 | `GET /v1/admin/billing/<uuid không tồn tại>/usage` từ phiên đã đăng nhập | PASS — qua được `requireBillingAccess()`, tức email Access của PHONG nằm trong `BILLING_ADMIN_EMAILS`. Lớp 403 của nhóm billing không bị nới ra. |
| 2 | `/admin/tenants`: danh sách và ngăn chi tiết | PASS — phạm vi khoá hiện thành các thẻ rời, không phải chuỗi `{places:read}`; tức `normalizeTextArray` đã áp đúng cho `text[]` đọc qua Hyperdrive. |
| 3 | Cấp khoá `server` trên trang → gọi `/v1/places/<id>` bằng chính khoá đó → thu hồi trên trang → gọi lại | PASS — 200 rồi 401. Chứng minh cùng lúc: `GRANT INSERT` của `0018`, sha256 khớp giữa Worker và `scripts/lib/api-key.mjs`, ba cột mảng đi qua `textArray` không vỡ, và route thu hồi xoá cache KV nên hiệu lực tức thì. |
| 4 | `SELECT actor, action, target, detail->>'label' FROM admin_audit ORDER BY id DESC LIMIT 5` | PASS — cột `detail->>'label'` có giá trị, tức `writeAudit` nay ghi jsonb **object** và `0019` đã nắn xong các dòng double-encode từ pha 0. |

## 4. Cổng tự động

**Cục bộ (máy dev):** `pnpm lint` ✓ · `pnpm typecheck` ✓ · `pnpm test` ✓ (1.636 + 384 test) ·
`pnpm test:api-db` ✓ (85) · `pnpm test:admin-e2e` ✓ (13) · `db/schema.dbtest.mjs` ✓ (13).

**CI ở `c9a7a15`:** Deploy API ✓ · CI ✓ · API tests (Places, real DB) ✓ · Routing tests ✓ ·
DB tests ✗ — đỏ ở `pipelines/poi/tests/poi-admin.dbtest.mjs`, **không liên quan pha 2**: fixture của
file đó nằm trong ô 106–107E/10–11N trùng ranh giới thật của TP.HCM mà `geocode.dbtest` publish, và
`fillPoiAdmin` lấy vùng chứa có `id` nhỏ nhất. Tái hiện được trên máy bằng cách chạy đúng hai file đó
trên một DB sạch; đã sửa ở `840d144` bằng cách dời fixture ra ô 150–151E/60–61N.

## 5. Bốn lỗi tìm ra trong lúc làm (đều đã sửa, đều có bài kiểm khoá lại)

1. `admin_audit.detail` ghi ra jsonb *string* double-encode — lỗi có từ pha 0, làm `detail->>'x'` luôn
   rỗng. Sửa `writeAudit` dùng `sql.json()`; `0019` nắn dữ liệu cũ.
2. Con trỏ phân trang tenant mất micro giây (bind cho `::timestamptz` đi qua `Date` của JavaScript),
   làm trang sau rỗng dù còn dữ liệu. Sửa bằng `to_char` + `::text::timestamptz`.
3. Ngăn chi tiết là Radix Dialog modal nên nút "Huỷ" của toast đếm ngược không bấm được — mất cơ chế
   năm giây đổi ý. Ngăn nay tự đóng khi xếp lịch.
4. Harness itest/E2E chỉ build `apps/admin` khi `dist` chưa tồn tại, nên lượt E2E đầu chạy trên bundle
   của pha 1. Nay luôn build.
