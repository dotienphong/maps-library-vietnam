# Ghi chú các lệnh `pnpm` ở gốc repo

Tra nhanh xem từng lệnh trong `scripts` của `package.json` (gốc repo) dùng để làm gì. Chạy tất cả
từ **gốc repo**. Chi tiết cờ nằm ở comment đầu file `scripts/<tên>.mjs` tương ứng.

Ký hiệu mức độ:

- 🟢 **Local**: chỉ đụng máy dev (DB dev, container dev, file build). Chạy thoải mái.
- 🟡 **Đọc production / tốn tài nguyên thật**: gọi API hoặc DB production nhưng không ghi dữ liệu
  quan trọng (vẫn tính lượt, vẫn dùng CPU máy chủ).
- 🔴 **Ghi production**: thay đổi DB máy chủ, R2, npm, Cloudflare. Đọc kỹ trước khi chạy.

> Truyền cờ cho script: `pnpm <lệnh> -- --co giá-trị` (một số lệnh nhận thẳng không cần `--`).

---

## 1. Môi trường dev hằng ngày

| Lệnh | Mức | Dùng để làm gì |
|---|---|---|
| `pnpm setup` | 🟢 | Dựng môi trường dev một lệnh: tạo `.env`, dựng Postgres, migrate, đặt Git identity cá nhân (local trong repo). Chạy lần đầu sau khi clone. |
| `pnpm dev` | 🟢 | Chạy song song mọi app trong monorepo ở chế độ dev (turbo `dev --parallel`). `Ctrl+C` để dừng. |
| `pnpm build` | 🟢 | Build toàn bộ package/app qua turbo. |
| `pnpm db:up` | 🟢 | Bật container Postgres dev (`infra/dev/compose.yml`). |
| `pnpm db:down` | 🟢 | Tắt toàn bộ container dev. |
| `pnpm db:migrate` | 🟢 | Áp migration mới trong `db/migrations/` vào DB theo `DATABASE_URL`/`POSTGRES_*` (mặc định DB dev). `-- --down` để revert đúng MỘT migration cuối. |
| `pnpm db:seed-tenant [file.sql]` | 🟢 | Nạp seed tenant vào DB dev (mặc định tenant nội bộ; truyền file khác như `db/seed/tenant_free_test.sql`). |
| `pnpm db:fixture` | 🟢 | Nạp dữ liệu fixture Quận 1 vào Postgres dev (ingest OSM + FSQ → taxonomy → gộp → geocode → `poi-fixture.pmtiles`). Dùng để có dữ liệu thử ở máy. |
| `pnpm key:issue --tenant <uuid> ...` | 🟢/🔴 | Cấp API key cho một tenant đã seed. In key **đúng một lần** — lưu ngay. Mặc định DB dev; nếu `DATABASE_URL` trỏ production thì là cấp key thật. |

## 2. Chất lượng mã và test

| Lệnh | Mức | Dùng để làm gì |
|---|---|---|
| `pnpm lint` | 🟢 | Kiểm format + lint bằng Biome. |
| `pnpm lint:fix` | 🟢 | Như trên nhưng tự sửa. |
| `pnpm typecheck` | 🟢 | Build `core`, typecheck `scripts/*.mjs` (`tsconfig.scripts.json`, có `checkJs`), rồi typecheck mọi package. |
| `pnpm test` | 🟢 | Bộ test chính: vitest ở root + build style/web/admin/console/site + test của `apps/api`. Không cần Postgres. |
| `pnpm test:watch` | 🟢 | Vitest chế độ watch khi đang sửa code. |
| `pnpm test:db` | 🟢 | Test cần Postgres: tự chạy trong container pipeline, tạo DB test **cô lập** rồi chạy `vitest.db.config.ts`. Phải chạy đầy đủ, đừng lọc file. |
| `pnpm test:api-db` | 🟢 | Test tích hợp API thật: DB cô lập → migrate → seed → Wrangler/Hyperdrive local → integration test (kèm PayOS giả). Bắt được lỗi mà unit test không thấy (mảng SQL, JWT...). |
| `pnpm test:routing` | 🟢 | Test tích hợp chỉ đường: dựng Valhalla/VROOM trên fixture Quận 1 → `wrangler dev` → chạy `*.rtest.mjs`. Giữ container cho lần sau; `-- --down` để tắt. |
| `pnpm test:admin-e2e` | 🟢 | E2E (Playwright) của trang Admin. |
| `pnpm test:site-e2e` | 🟢 | E2E của website `apps/site` (chạy trên bản build). |
| `pnpm test:console-e2e` | 🟢 | E2E của console khách hàng. |
| `pnpm check:git` | 🟢 | Kiểm remote `origin` và email commit đúng tài khoản cá nhân `dotienphong` (chặn email công ty). Chạy trước khi push. |
| `pnpm notices:sync` | 🟢 | Chép `LICENSE` + `THIRD_PARTY_NOTICES.md` vào các gói SDK. `-- --check` chỉ kiểm (dùng ở CI). |

## 3. Chạy thử SDK / ví dụ

| Lệnh | Mức | Dùng để làm gì |
|---|---|---|
| `pnpm example:embed` | 🟡 | Mở trang nhúng thử `examples/embed-web` ở `http://localhost:5500` với khoá `KEY_EXAMPLE_EMBED` (hoặc `--key`). Gọi API thật. |
| `pnpm example:rn` | 🟡 | Build core + react-native, pack vào `examples/embed-rn`, rồi `expo run` (iOS trên macOS). Cờ: `--android`, `--device`, `--pack-only`, `--key ...` (đặt cuối). |
| `pnpm release:ios` | 🟡 | Build **Release** app RN lên iPhone thật — rút dây vẫn chạy. Hồ sơ ký Apple ID cá nhân hết hạn 7 ngày. |
| `pnpm release:android` | 🟡 | Build **Release** lên máy Android thật; tự xoá cache bundle Gradle + gỡ bản cũ để luôn là code mới nhất. |
| `pnpm perf:size` | 🟢 | In bảng kích thước (gzip) các file SDK trong `dist/`. Cần build trước. |
| `pnpm debounce:report` | 🟢 | Tổng hợp số liệu đã đo trong `docs/evidence/autocomplete-debounce` thành bảng so sánh các mức debounce (200/300/500/800 ms). |

## 4. Deploy và phát hành

| Lệnh | Mức | Dùng để làm gì |
|---|---|---|
| `pnpm check:migration` | 🟡 | Cổng chặn deploy: so migration mới nhất trong repo với `schema_migration` mà `/healthz/db` production báo. Lệch hoặc không gọi được → CHẶN. Chạy **trước** `deploy:api`. |
| `pnpm deploy:api` | 🔴 | Build rồi `wrangler deploy --env production` cho API. Migration phải lên trước (`server:migrate`), nếu không API chết. |
| `pnpm deploy:docs` | 🔴 | Build rồi đẩy `apps/docs` lên Cloudflare Pages `mapslibvn-docs`, rồi báo IndexNow những URL có chữ đổi. (CI đã tự deploy từ `main`.) |
| `pnpm deploy:site` | 🔴 | Build rồi đẩy website `apps/site` lên Cloudflare Pages `mapslibvn`, rồi báo IndexNow những URL có chữ đổi. |
| `pnpm sdk:publish` | 🔴 | Phát hành 4 gói SDK lên npm theo thứ tự core → web → react → react-native, rồi chờ đối chiếu registry. `--dry-run` để thử. Chạy `npm whoami` trước; OTP qua `NPM_CONFIG_OTP=...`. |

## 5. Dữ liệu bản đồ / POI

| Lệnh | Mức | Dùng để làm gì |
|---|---|---|
| `pnpm image:build` | 🟢 | Build Docker image pipeline (planetiler, duckdb, osmium, tippecanoe, pg_dump, rclone...). Gắn nhãn commit + trạng thái cây; `server:update`/`setup` từ chối image lệch HEAD hoặc dựng từ cây chưa commit. |
| `pnpm image:smoke` | 🟢 | Kiểm image pipeline có đủ công cụ và đúng phiên bản. |
| `pnpm data:update` | 🔴 | Pipeline **phát hành** dữ liệu: dò nguồn OSM/FSQ → so state R2 → build tiles/POI → QA → upload R2 → manifest → routing graph. Cờ: `--dry-run`, `--tiles`, `--poi`, `--force`. |
| `pnpm data:rollback` | 🔴 | Quay dữ liệu về bản trước trong `manifest.history` (graph routing trước, manifest sau). `--skip-routing` nếu cố ý bỏ qua graph. |
| `pnpm poi:profile --profile osm` | 🔴 | Publish archive POI theo profile nguồn (vd `osm`, `fsq`) từ dữ liệu đã có trong Postgres, không ingest lại. `--dry-run` để thử. |
| `pnpm export:odbl` | 🟢 | Xuất các bảng dẫn xuất OSM theo giấy phép ODbL ra `out/odbl` (CSV gzip + manifest + README). |

## 6. Máy chủ (DB production)

Các lệnh `server:*` tác động lên **máy đang gõ lệnh** — chạy trên máy chủ, từ gốc repo.

| Lệnh | Mức | Dùng để làm gì |
|---|---|---|
| `pnpm server:setup` | 🔴 | Dựng máy chủ nội bộ 24/7 một lệnh (Postgres, Valhalla, Tunnel, cron...). |
| `pnpm server:restore` | 🔴 | Dựng stack trên máy **mới**, phục hồi backup production mới nhất và nghiệm thu DB. |
| `pnpm server:update` | 🔴 | Cập nhật máy chủ: kéo mã mới, image mới, `compose up`, chạy migration; kiểm cấu hình `.env` (vd `PG_SHARED_BUFFERS`). Dừng trước khi đụng DB nếu image pipeline lệch HEAD. |
| `pnpm server:migrate` | 🔴 | CHỈ áp migration lên DB máy chủ, không đụng container đang chạy. Dùng khi migration phải đi trước deploy Worker. `-- --down` để revert một migration. |
| `pnpm server:seed-tenant <file.sql>` | 🔴 | Nạp seed tenant lên DB máy chủ. |
| `pnpm server:tenants` | 🟡 | Kiểm kê tenant/mode trên DB máy chủ (chỉ đọc). |
| `pnpm server:tenant-reset --name X` | 🔴 | Xoá **toàn bộ** tenant rồi tạo lại một tenant. Không có `--apply --confirm XOA-TOAN-BO-TENANT` thì chỉ in kiểm kê. |
| `pnpm server:tenant-xoa --name X` | 🔴 | Xoá **vĩnh viễn** một tenant. Không có `--apply --confirm XOA-MOT-TENANT` thì chỉ in kiểm kê. |
| `pnpm db:restore --latest` | 🟢/🔴 | Phục hồi DB từ backup R2 (`--latest` hoặc `--file <tên.dump.zst>`). Mặc định chỉ DB local; có `--yes` mới đụng DB thật. |

## 7. Đo đạc, smoke và vận hành production

Mọi lệnh gọi API thật đều tự **ACK receipt** — đừng thay bằng curl trần, sẽ khoá tenant 24 giờ.

| Lệnh | Mức | Dùng để làm gì |
|---|---|---|
| `pnpm smoke:rate-limit` | 🟡 | Kiểm chống burst của `/v1/autocomplete` (warm cache rồi gửi tuần tự, mong đợi 429). Production cần `--confirm-production`. |
| `pnpm smoke:directions` | 🟡 | Smoke chỉ đường production: 4 tuyến chuẩn, N lượt/tuyến, in p95. Cần `-- --confirm-production`. |
| `pnpm smoke:matrix` | 🟡 | Smoke ma trận + tối ưu thứ tự điểm dừng (bài A/B/C, `--rounds` thêm bài D tải song song). Cần `--confirm-production`. |
| `pnpm smoke:fleet` | 🟡 | Smoke chia đơn đội xe (bài E/E2, `--rounds` thêm bài F). Cần `--confirm-production` và khoá `server`. |
| `pnpm smoke:commercial --tenant <uuid>` | 🟡 | Nghiệm thu quota thương mại trên tenant thử (trừ lượt sau ACK, khoá, v.v.), in bảng pass/fail. |
| `pnpm load:api` | 🟡 | Đo tải API theo các mức người dùng đồng thời (places/directions, cold/warm) để tìm trần. Production cần `--confirm-production`. |
| `pnpm explain:autocomplete` | 🟡 | Chạy `EXPLAIN ANALYZE` từng nhánh truy vấn autocomplete trên DB máy chủ để biết chậm ở đâu. Chỉ đọc nhưng dùng CPU production. Cần `pnpm build` trước. |
| `pnpm audit:quota export\|verify\|restore` | 🔴 | Sao lưu (mã hoá lên R2), kiểm và phục hồi sổ quota thương mại của một tenant. `restore` cần `--yes`. |
| `pnpm report:weekly` | 🟡 | Báo cáo sử dụng tuần từ Analytics Engine, gửi email. `--dry-run` chỉ in, `--this-week` lấy tuần đang chạy. |
| `pnpm pay:fake-webhook --order-code ... --amount ...` | 🟢 | Ký và bắn webhook PayOS giả vào API local để thử thanh toán. Tự từ chối trỏ vào production. |

---

## Lệnh cho từng package riêng

Ngoài các lệnh trên, mỗi app/package có `scripts` riêng, chạy bằng `--filter`:

```bash
pnpm --filter @mapslibvn/site dev      # chỉ chạy website
pnpm --filter @mapslibvn/api test      # chỉ test API
pnpm --filter @mapslibvn/core build    # chỉ build core
```

Xem danh sách lệnh của một package: `cat apps/<tên>/package.json` hoặc `pnpm --filter <tên> run`.
