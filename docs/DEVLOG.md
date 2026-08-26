# DEVLOG — MapsLibVN

Đọc file này trước khi làm bất cứ việc gì. Cập nhật ở bước cuối của MỌI task (cùng
commit với code).

## 1. Trạng thái hiện tại

- Mốc: M1a — Nền tảng & môi trường
- Plan: `docs/superpowers/plans/2026-08-26-m1a-nen-tang-moi-truong.md`
- Task đang làm: Task 3 (remote GitHub cá nhân + push đầu tiên)
- Commit cuối: Task 2 (commit hiện tại)
- Môi trường đã dựng: máy dev macOS (chưa có Postgres dev, chưa có image, chưa có
  remote GitHub)

## 2. Bước kế tiếp

M1a Task 3 — thêm remote GitHub
`git@github.com-dotienphong:dotienphong/MapsLibVN.git` và push `main` (tạo repo
private trước nếu chưa có).

## 3. Quyết định phát sinh

| Ngày | Quyết định | Lý do | Commit |
|---|---|---|---|
| 2026-08-26 | Lint/format dùng Biome thay ESLint+Prettier | Một công cụ, nhanh, không cấu hình rườm rà | `9cff9a8` |
| 2026-08-26 | Typecheck gốc kiểm thêm `vitest.config.ts` | TypeScript 5.9 trả TS18003 khi `scripts/` chưa tồn tại | `9cff9a8` |
| 2026-08-26 | Spec bản 2 đã được PHONG review | Trạng thái thiết kế đã được chủ dự án xác nhận | (Task 2) |

## 4. Nhật ký

- 2026-08-26 · M1a T1 · khung monorepo · `9cff9a8`
- 2026-08-26 · M1a T2 · DEVLOG + hook pre-push khoá account cá nhân · (commit hiện tại)
