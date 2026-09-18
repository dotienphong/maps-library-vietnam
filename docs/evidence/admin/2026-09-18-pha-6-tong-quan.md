# Chứng cứ pha 6 — Tổng quan (`/admin`)

Plan: `docs/superpowers/plans/2026-09-18-trang-admin-pha-6.md`

## 1. Bốn tầng xanh ở máy — 18/09/2026

| Tầng | Lệnh | Kết quả |
|---|---|---|
| Lint | `pnpm lint` | 656 file, không sửa gì |
| Typecheck | `turbo run typecheck --force` | 14/14, **0 cached** |
| Unit | `pnpm test` | 1787 passed / 5 skipped, và 475 của `apps/api` |
| DB thật | `pnpm test:api-db` | 116 passed (11 file, gồm 3 bài mới của `quota-summary`) |
| E2E | `pnpm test:admin-e2e` | 17 passed |

## 2. Lệch spec có chủ ý

Spec 11.1 viết ô thứ hai là "tenant sắp vượt hạn mức". Bản làm ra lấy **số lượt 429 trong 24 giờ**
làm số chính và **phần trăm hạn mức cao nhất** làm dòng phụ — PHONG chốt 18/09/2026. 429 là thứ
thật sự xảy ra với người dùng cuối, và nó dùng lại đúng ô cache 5 phút mà màn Sức khoẻ đã tạo nên
không tốn thêm truy vấn Analytics nào.

## 3. Điều dễ hỏng nhất, và cách đã chặn

`readUsage()` của Durable Object **TẠO sổ quota** cho tenant chưa có. Một trang đích mở mỗi lần vào
mà đi đường đó sẽ lặng lẽ đẻ ra sổ cho mọi tenant legacy. `GET /v1/admin/quota-summary` rẽ nhánh
theo `tenant.quota_mode`: chỉ `commercial` mới chạm DO, `legacy` chỉ đọc bộ đếm KV. Có itest canh
việc này (`apps/api/test-db/admin-quota-summary.itest.mjs`).

## 4. Một bẫy đã trả giá khi viết test

`'/v1/admin/metrics'.includes('/v1/admin/me')` là **TRUE** — "metrics" bắt đầu bằng "me". Mock
`fetch` so khớp bằng `includes` trả hồ sơ người dùng cho lời gọi số liệu, `tenants` thành
`undefined`, và trang nổ ở một chỗ hoàn toàn khác (`tenants.reduce of undefined`) với DOM rỗng
sạch. Bẫy này nằm sẵn trong `routes.test.tsx` từ trước và chỉ trở thành bẫy sống khi `/admin` bắt
đầu gọi `/v1/admin/metrics`. Cả hai mock nay so khớp theo `pathname`.

## 5. Deploy

Không có migration; máy chủ giữ `0019`.

- **Version ID: `8df0400d-225c-477f-8903-98253caf77ee`**, deploy từ commit `291c785`
- `/healthz/db` ngay sau deploy: `ok:true`, role `api`, migration `0019_admin_audit_detail_object.sql`
- `/admin/` trả 302 về Access — đúng, Access chặn ở biên

## 6. Nghiệm thu bằng mắt

- [ ] `/admin` hiện Tổng quan, KHÔNG còn giống `/admin/edits`
- [ ] Bốn ô có số; bấm từng ô sang đúng mảng
- [ ] Ô "Lượt bị chặn vì hạn mức" khớp cột 429 của màn Sức khoẻ (cùng nguồn, cùng ô cache)
- [ ] Năm việc gần nhất khớp năm dòng đầu của `/admin/audit`
- [ ] Tắt định tuyến → ô Định tuyến chuyển "Hỏng" ngay trên trang đích

## 7. Sổ quota KHÔNG bị tạo thêm

- [ ] Mở trang đích nhiều lần rồi kiểm: tenant `legacy` vẫn không có sổ Durable Object. Kiểm bằng
      `pnpm audit:quota`, hoặc gọi `/v1/admin/billing/<tenant legacy>/usage` và thấy sổ rỗng đúng
      như trước (route đó mới là chỗ được phép tạo sổ).
