# Chứng cứ pha 4 — Nhật ký kiểm toán (`/admin/audit`)

**Trạng thái: ĐÓNG. PHONG nghiệm thu pass ngày 18/09/2026.**

## 1. Mã và deploy

- Commit `0a9f78c` — "feat(admin): Nhật ký kiểm toán (pha 4) + trang 404 tử tế cho đường dẫn chưa có".
- Deploy production 17/09/2026, version `f2ee0724`.
- Còn sống trong các bản deploy sau (kiểm 18/09/2026: bản đang chạy là `630c766b`,
  `wrangler deployments list --env production`).
- Không có migration: máy chủ giữ nguyên `0019`. Phần GHI nhật ký đã chạy từ pha 0, nên bảng
  `admin_audit` đã có sẵn lịch sử mọi việc làm qua trang Admin kể từ 16/09/2026.

## 2. Phạm vi đã làm

Màn `/admin/audit` theo spec 16/09 mục 11.6: dòng thời gian từ `admin_audit`, lọc theo người thực
hiện / loại việc / khoảng ngày, phân trang con trỏ. Chỉ phần ĐỌC.

Kèm theo trong cùng đợt: trang 404 tiếng Việt đặt trong AppShell (trước đó `/admin/health` và
`/admin/audit` rơi vào trang lỗi mặc định tiếng Anh của react-router, đã chạy như vậy trên
production), và bộ test định tuyến đầu tiên của trang Admin.

## 3. Nghiệm thu

- Bốn tầng xanh ở máy tại thời điểm commit: `pnpm lint`, `pnpm typecheck`, `pnpm test`,
  `pnpm test:api-db` (gồm `apps/api/test-db/admin-audit.itest.mjs` chạy bằng role `api` thật).
- Nghiệm thu bằng mắt trên điện thoại thật: **PHONG xác nhận pass 18/09/2026.**

## 4. Hai quyết định đáng nhớ

- **Con trỏ phân trang đi theo `id` (bigserial), không theo `created_at`.** Vừa đơn điệu theo thời
  gian, vừa tránh bẫy bind timestamp qua Hyperdrive rụng micro giây.
- **`id` giữ dạng CHUỖI suốt từ SQL ra tới khoá dòng React.** Qua `Number` thì 9007199254740993
  thành …992 và hai dòng khác nhau trùng khoá, một dòng biến mất khỏi màn hình.
- `<input type="date">` quy đổi theo giờ MÁY chứ không phải UTC; `to` lùi sang nửa đêm hôm sau vì
  đầu này không tính vào. Ở UTC+7, làm sai chỗ này thì mọi việc từ 00:00 tới 07:00 rơi sang ngày
  hôm trước và người trực không thấy việc mình vừa làm sáng nay.
