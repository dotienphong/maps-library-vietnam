# MapsLibVN

Nền tảng bản đồ nhúng cho web và mobile, dựng trên MapLibre GL và dữ liệu mở
(OpenStreetMap, Overture, Foursquare OS). Việt Nam trước.

## Bắt đầu (máy mới)

Cài Docker Desktop và Node 22 (khuyên dùng `fnm`), rồi:

    corepack enable
    pnpm install
    pnpm setup      # tạo .env, dựng Postgres, chạy migration, kiểm tra git identity
    pnpm dev

## Tài liệu

- Spec: `docs/superpowers/specs/2026-08-26-mapslibvn-maps-sdk-design.md`
- Roadmap & plan: `docs/superpowers/plans/`
- Nhật ký & "đang ở đâu": `docs/DEVLOG.md` — **đọc trước khi làm bất cứ việc gì**

## Quy tắc GitHub

Chỉ dùng remote `git@github.com-dotienphong:dotienphong/MapsLibVN.git` (account cá
nhân). Hook `pre-push` sẽ chặn nếu sai.
