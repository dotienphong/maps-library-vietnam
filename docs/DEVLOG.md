# DEVLOG — MapsLibVN

Đọc file này trước khi làm bất cứ việc gì. Cập nhật ở bước cuối của MỌI task (cùng
commit với code).

## 1. Trạng thái hiện tại

- Mốc: M1a — Nền tảng & môi trường
- Plan: `docs/superpowers/plans/2026-08-26-m1a-nen-tang-moi-truong.md`
- Task đang làm: Task 7 (Dev Container)
- Commit cuối: `cc16199`
- Môi trường đã dựng: máy dev macOS; remote GitHub cá nhân; Postgres/PostGIS dev,
  migration `0001_extensions.sql`; `pnpm run setup` sạch đạt 6,51 giây; image
  pipeline local đã build/smoke trên arm64 và chạy được qua Compose

## 2. Bước kế tiếp

M1a Task 7 — thêm Dev Container dùng chung image pipeline.

## 3. Quyết định phát sinh

| Ngày | Quyết định | Lý do | Commit |
|---|---|---|---|
| 2026-08-26 | Lint/format dùng Biome thay ESLint+Prettier | Một công cụ, nhanh, không cấu hình rườm rà | `9cff9a8` |
| 2026-08-26 | Typecheck gốc kiểm thêm `vitest.config.ts` | TypeScript 5.9 trả TS18003 khi `scripts/` chưa tồn tại | `9cff9a8` |
| 2026-08-26 | Spec bản 2 đã được PHONG review | Trạng thái thiết kế đã được chủ dự án xác nhận | `cb98a09` |
| 2026-08-26 | Repo GitHub dùng slug `maps-library-vietnam`, tên sản phẩm vẫn là MapsLibVN | PHONG đã tạo repo và cung cấp URL chính thức | `e7f16d4` |
| 2026-08-26 | PostGIS dev chạy image `postgis/postgis:16-3.4` amd64 qua giả lập trên Mac arm64 | Tag đã chốt trong spec/plan chưa có manifest arm64; health và migration vẫn đạt | `d4186f3` |
| 2026-08-26 | Lệnh setup công khai là `pnpm run setup`, không phải `pnpm setup` | `pnpm setup` là built-in của pnpm 9.15 và không dispatch package script | `cc16199` |
| 2026-08-26 | Setup chỉ migrate khi PID 1 trong container là `postgres` và `pg_isready` đạt | PostGIS entrypoint chạy server tạm rồi restart; chỉ `pg_isready` gây ECONNRESET | `cc16199` |
| 2026-08-26 | Image pin Planetiler 0.10.2, tippecanoe 2.62.5, DuckDB 1.5.3, pyosmium 4.0.2, Node 22 và pnpm 9.15.0 | Các release/asset đã được build và smoke thật trên arm64; DuckDB 1.5.5 chưa có CLI asset | (Task 6) |
| 2026-08-26 | Planetiler tải 8 HTTP range song song, cache từng part, kiểm tra đúng 93.278.824 byte và SHA-256 | GitHub release chỉ đạt khoảng 22 KB/s/kết nối; tải một luồng mất hơn một giờ và dễ mất tiến độ | (Task 6) |

## 4. Nhật ký

- 2026-08-26 · M1a T1 · khung monorepo · `9cff9a8`
- 2026-08-26 · M1a T2 · DEVLOG + hook pre-push khoá account cá nhân · `cb98a09`
- 2026-08-26 · M1a T3 · remote GitHub cá nhân + push đầu tiên · `e7f16d4`
- 2026-08-26 · M1a T4 · Postgres/PostGIS dev + migration idempotent · `d4186f3`
- 2026-08-26 · M1a T5 · `pnpm run setup` sạch đạt 6,51 giây · `cc16199`
- 2026-08-26 · M1a T6 · image pipeline đủ 8 tool, cached rebuild 4,8 giây · (commit hiện tại)
