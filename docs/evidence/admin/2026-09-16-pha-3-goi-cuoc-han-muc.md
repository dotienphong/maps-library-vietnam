# Nghiệm thu pha 3 — Gói cước & hạn mức

Plan: `docs/superpowers/plans/2026-09-16-trang-admin-pha-3.md`
Spec: `docs/superpowers/specs/2026-09-16-trang-admin-react-design.md` (mục 11.4)

## 1. Đã kiểm trên máy dev — 16/09/2026

| Lệnh | Kết quả |
|---|---|
| `pnpm lint` | Checked 610 files. No fixes applied. |
| `pnpm exec turbo run typecheck --force` | 14 successful, 14 total (0 cached) |
| `pnpm test` | 172 file / 1687 pass, 3 skipped · API 54 file / 404 pass |
| `pnpm test:api-db` | 8 file / **102 pass** |
| `pnpm test:api-db` (lượt 2 liên tiếp) | 8 file / **102 pass** — bộ test tự chứa sau khi harness xoá `.wrangler/state/v3/do` |
| `pnpm test:admin-e2e` | **17 pass** (14 cũ + 3 mới), 1.1 phút |

Ba bài e2e mới:

- `màn Gói cước: cấp kỳ trả phí cho một tenant rồi thấy biên lai thật`
- `huỷ trong 5 giây ở màn Gói cước: sổ quota không đổi` — sau 6 giây, `/usage` vẫn `status: none`, `revision: 0`
- `email ngoài BILLING_ADMIN_EMAILS gọi thẳng API billing → 403 billing_admin_forbidden`

## 2. Hai lỗ hổng đã vá trong đợt này

**2.1. Nhóm `/v1/admin/billing/*` không đi qua cổng chống CSRF.** Đo trước khi sửa: `POST .../commands`
kèm `Sec-Fetch-Site: cross-site` trả **401** (`missing_access_jwt`) chứ không phải 403. Nhóm này mount
ở `index.ts` trước `app.route('/', admin)`, nên middleware khai trong app `admin` không bao giờ chạy.
Đã tách `requireSameSitePost()` và gắn lại cho tiền tố billing; `apps/api/test/billing-csrf.test.ts`
khoá lại hành vi, và itest kiểm thêm rằng lệnh bị chặn **không** chạm tới sổ.

**2.2. `audit()` biến một lệnh đã thành công thành 503.** Hàm này truy cập `c.executionCtx` và ném
đồng bộ khi ngữ cảnh không có nó; lỗi bay ra khiến handler đang ở nhánh thành công rơi xuống catch.
Lộ ra ngay khi thêm audit cho `commands` (hai test cũ chuyển sang 503). Đã bọc try/catch — nhật ký là
bằng chứng, không phải điều kiện.

## 3. CHƯA làm — chờ PHONG chạy trên production

- [ ] `cd apps/api && pnpm exec wrangler deploy --env production`
- [ ] `curl -s https://api.ai-solutions.io.vn/healthz/db` → `schema_migration` vẫn **0019** (pha này không có migration)
- [ ] Mở `https://api.ai-solutions.io.vn/admin/billing` trên điện thoại, chụp màn hình:
  1. một tenant `legacy` → bảng "Hôm nay" có số thật của ít nhất một khoá;
  2. một tenant thương mại → kỳ hiện tại, hai thanh hạn mức, bảng các kỳ đã cấp;
  3. bấm một lệnh rồi Huỷ trong 5 giây → mở lại thấy bản sổ giữ nguyên;
  4. gửi thật một lệnh nhỏ → biên lai có `operationId`, bản sổ tăng đúng 1.
- [ ] Đối chiếu nhật ký:

```sql
SELECT actor, action, target, detail, created_at
FROM admin_audit WHERE action LIKE 'billing.%' ORDER BY id DESC LIMIT 10;
```

Mong đợi: mỗi lệnh đúng một dòng, `actor` là email Access của PHONG, `detail` có
`kind`/`operation_id`/`revision` và **không** chứa mã thanh toán.

## 4. Ngoài phạm vi pha 3

- Mức dùng tách **theo endpoint**: sổ quota chỉ đếm theo hai nhóm `places`/`directions`. Số theo
  endpoint là Cloudflare Analytics — pha 5.
- Bộ đếm legacy là **số xấp xỉ trong ngày**, không có lịch sử, và chỉ chạy khi `QUOTA_ENABLED=1`
  (tenant `internal` cố ý không được đếm).
- Chưa có màn đọc `entitlement_event` của sổ; tra cứu lịch sử thao tác dùng `admin_audit` ở pha 4.
