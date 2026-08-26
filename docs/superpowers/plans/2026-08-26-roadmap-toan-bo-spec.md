# MapsLibVN — Roadmap thực thi toàn bộ spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đưa spec `docs/superpowers/specs/2026-08-26-mapslibvn-maps-sdk-design.md` (bản 2) thành phần mềm chạy được qua 5 mốc M1→M5, mỗi mốc có plan cấp bước riêng, với quy trình ghi chép để bất kỳ lúc nào quay lại đều biết bắt đầu từ đâu.

**Architecture:** Kiến trúc A "tĩnh tối đa": tiles/POI là PMTiles có phiên bản trên R2 đọc thẳng từ client; Worker Hono chỉ phục vụ style (alias phiên bản) và Places API; Postgres/PostGIS chạy Docker trên máy nội bộ 24/7 nối qua Cloudflare Tunnel → Access → Hyperdrive; pipeline dữ liệu chạy trong một image Docker chung bằng lệnh `pnpm data:update`.

**Tech Stack:** TypeScript 5 / Node 22 / pnpm 9 / Turborepo / Biome / Vitest / Playwright; maplibre-gl 5 + pmtiles; Hono 4 + Wrangler 4 (Workers, KV, R2, Hyperdrive); Planetiler, tippecanoe, pyosmium, DuckDB 1.5 trong Docker; Postgres 16 + PostGIS 3.4; Astro Starlight.

---

## 0. Quy tắc bất biến cho mọi mốc

### 0.1 GitHub — chỉ account cá nhân `dotienphong`

- Remote duy nhất: `git@github.com-dotienphong:dotienphong/maps-library-vietnam.git` (SSH alias trong `~/.ssh/config`, key `id_ed25519_dotienphong`).
- Commit author: `dotienphong1993 <dotienphong1993@gmail.com>` (đã set local trong repo).
- **CẤM TUYỆT ĐỐI** dùng GitHub/account của bark cho dự án này: không `gh` mặc định (đang đăng nhập account công ty qua `GITHUB_TOKEN`), không host `github.com` trơn, không email `@bark.com`. Hook `.githooks/pre-push` (M1a Task 2) từ chối push nếu vi phạm; `pnpm setup` kiểm tra lại mỗi lần dựng môi trường.
- Nếu cần gọi API GitHub (xem Actions), chỉ dùng PAT cá nhân: `GH_TOKEN="$(cat ~/.config/gh-dotienphong.token)" gh …`.

### 0.2 Ghi chép để "quay lại biết bắt đầu từ đâu" — DEVLOG

File `docs/DEVLOG.md` (tạo ở M1a Task 2) có 4 mục cố định:

1. **Trạng thái hiện tại** — mốc/plan/task đang làm, commit cuối, môi trường nào đã dựng (máy dev, máy chủ, Cloudflare).
2. **Bước kế tiếp** — đúng một dòng chỉ vào plan + task + step tiếp theo.
3. **Quyết định phát sinh** — mọi thay đổi so với spec/plan khi code (kèm lý do, ngày, commit). Spec/plan **không sửa ngầm**: sửa file spec/plan rồi ghi một dòng vào đây.
4. **Nhật ký** — mỗi task xong một dòng: `YYYY-MM-DD · M1a T3 · <việc> · <commit>`.

Quy tắc: **bước cuối của mọi task** là (a) tick checkbox trong plan, (b) cập nhật mục 1–2 (và 3 nếu có thay đổi), (c) commit cùng code. Khi quay lại sau bất kỳ khoảng nghỉ nào: đọc `docs/DEVLOG.md` → "Bước kế tiếp" → mở plan tương ứng → tìm checkbox chưa tick đầu tiên.

### 0.3 Cách làm

- TDD: test thất bại → mã tối thiểu → test xanh → commit. Commit nhỏ, thông điệp Conventional Commits, tiếng Việt cho phần mô tả.
- Không thêm tính năng ngoài spec (YAGNI). Muốn thêm → ghi "Quyết định phát sinh" và hỏi PHONG nếu đổi phạm vi.
- Mọi lệnh trong plan chạy từ gốc repo, trên macOS/Linux/WSL; script trong `package.json` là Node thuần, không bash.
- Mỗi mốc kết thúc bằng checklist nghiệm thu chạy thật (không tự khai "xong").

### 0.4 Thứ tự plan

| # | Plan | Mốc | Trạng thái |
|---|---|---|---|
| 1 | `2026-08-26-m1a-nen-tang-moi-truong.md` | M1a — monorepo, DEVLOG, hook GitHub, dev compose + migration, `pnpm setup`, image Docker, devcontainer, CI | Đã viết, sẵn sàng thực thi |
| 2 | `2026-08-26-m1b-tiles-style-web-sdk.md` | M1b — `@mapslibvn/core` (attribution + client khung), `@mapslibvn/style` (template light/dark, chủ quyền), pipeline tiles (download/patch/build/fixture/QA/upload/manifest), `data:update --tiles`, `data:rollback` | Đã viết, sẵn sàng thực thi |
| 2b | `2026-08-26-m1c-worker-web-sdk-docs.md` | M1c — Worker `apps/api` (styles từ manifest, attribution, tiles fallback, `/r2` dev), `@mapslibvn/web` + UMD, docs Starlight + playground + E2E, workflows deploy/data-update, nghiệm thu M1 | Đã viết, sẵn sàng thực thi |
| 3 | `YYYY-MM-DD-m2-kho-poi-may-chu.md` | M2 — máy chủ nội bộ, migration kho POI, chuẩn hoá VI, parser địa chỉ, ingest 3 nguồn, gộp, anchors, poi.pmtiles, `data:update` đầy đủ | Viết cấp bước khi bắt đầu M2 (mục 3) |
| 4 | `YYYY-MM-DD-m3-places-api.md` | M3 — auth/quota, Hyperdrive, 7 endpoint đọc, geocode ladder, core client đầy đủ, web component, React | Viết khi bắt đầu M3 (mục 4) |
| 5 | `YYYY-MM-DD-m4-dong-gop.md` | M4 — `POST /v1/edits`, auto-approve, áp dụng edit, `apps/admin` | Viết khi bắt đầu M4 (mục 5) |
| 6 | `YYYY-MM-DD-m5-phat-hanh-noi-bo.md` | M5 — docs, notices, điều khoản, key app kết bạn, báo cáo tuần, `export:odbl` | Viết khi bắt đầu M5 (mục 6) |

Lý do M2–M5 viết cấp bước sau: chúng phụ thuộc kết quả M1 (Planetiler `--bounds` có cho lớp thế giới đẹp không; `admin_level` thực tế trong OSM VN; phiên bản tool pin được; máy chủ nội bộ đã có). Mục 3–6 dưới đây đã khoá **task, file, giao diện, test, nghiệm thu** của từng mốc — plan cấp bước chỉ triển khai chi tiết, không thay đổi phạm vi.

### 0.5 Việc tay của PHONG theo dòng thời gian

| Khi nào | Việc | Chặn task nào |
|---|---|---|
| Trước M1a Task 3 | Tạo repo GitHub **private** `MapsLibVN` dưới account `dotienphong` (web UI, không README) | M1a T3 push |
| Trước M1b Task 6 | Trên Cloudflare (zone hiện có): tạo R2 bucket `mapslibvn-tiles`, bật custom domain `tiles.<domain>`, tạo R2 API token (S3), KV namespace `META`; điền vào `.env` và `apps/api/wrangler.toml` | M1b T6 upload, T7 deploy |
| Trước M1b Task 9 | `wrangler login` bằng account Cloudflare của PHONG; tạo Pages project `mapslibvn-docs` | M1b T9 |
| Trước M2 Task 1 | Chuẩn bị máy nội bộ 24/7 (≥ 8 GB RAM, SSD ≥ 50 GB, Docker) | M2 T1 |
| Trong M2 Task 1 | Theo `infra/server/README.md`: tạo Tunnel, Access application + service token, Hyperdrive config | M2 T1 |
| Trước M5 | Hỏi luật sư (Điều 51, ODbL, nhãn hiệu) | M5 T3 checklist |
| Khi có máy Windows | Chạy `pnpm setup` trên Windows và ghi kết quả vào DEVLOG | Nghiệm thu M1 mục "Windows" |

---

## 1. M1a — Nền tảng & môi trường

Plan cấp bước: `docs/superpowers/plans/2026-08-26-m1a-nen-tang-moi-truong.md`.

| Task | Kết quả | Nghiệm thu |
|---|---|---|
| 1 Khung monorepo | pnpm workspace, Turborepo, Biome, tsconfig, Vitest, `.gitattributes` LF, `.editorconfig`, `.nvmrc`, README | `pnpm install && pnpm lint && pnpm typecheck && pnpm test` xanh |
| 2 DEVLOG + hook GitHub | `docs/DEVLOG.md`, `.githooks/pre-push`, `scripts/lib/git-identity.mjs` + test | Hook từ chối remote sai/email bark; DEVLOG có 4 mục |
| 3 Remote GitHub | `origin` = alias cá nhân, push `main` | `git ls-remote origin` chạy qua `github.com-dotienphong` |
| 4 Dev DB + migration | `infra/dev/compose.yml` (Postgres 16 + PostGIS), `.env.example`, `db/migrations/0001_extensions.sql`, `scripts/db-migrate.mjs` | `pnpm db:migrate` tạo extension; chạy lại không làm gì |
| 5 `pnpm setup` | `scripts/setup.mjs`: kiểm tra Docker/Node, tạo `.env`, compose up, chờ DB, migrate, kiểm tra git identity, in hướng dẫn | Máy sạch → chạy được `pnpm dev` ≤ 15 phút |
| 6 Image Docker pipeline | `pipelines/Dockerfile` (Java 21, Planetiler, tippecanoe, osmium-tool, pyosmium, DuckDB CLI, rclone, Node 22), `pnpm image:build`, `pnpm image:smoke` | Smoke in ra phiên bản 6 công cụ trên arm64 và amd64 |
| 7 Dev Container | `.devcontainer/devcontainer.json` + compose | "Reopen in Container" chạy được `pnpm test` |
| 8 CI | `.github/workflows/ci.yml`: lint, typecheck, test, build image (push GHCR) | Run đầu tiên xanh trên GitHub |
| 9 Nghiệm thu M1a | DEVLOG cập nhật; thử `pnpm setup` từ clone sạch | Ghi thời gian thực vào DEVLOG |

## 2. M1b + M1c — Tiles, style, Worker, Web SDK, docs

Plan cấp bước: Task 1–6 trong `docs/superpowers/plans/2026-08-26-m1b-tiles-style-web-sdk.md`; Task 7–11 dưới đây tương ứng Task 1–5 trong `docs/superpowers/plans/2026-08-26-m1c-worker-web-sdk-docs.md`.

| Task | Kết quả | Nghiệm thu |
|---|---|---|
| 1 `@mapslibvn/core` | attribution, `createClient` khung (fetch, lỗi chuẩn, `attribution()`, `styleUrl()`), types | Unit test xanh, ≤ 8 kB gzip |
| 2 `@mapslibvn/style` | vendor OSM Liberty + Dark Matter (pin commit), `sovereignty.geojson`, script transform → `mapslibvn-light.json`/`-dark.json` template, assets fonts/sprites | Test: validate style, mọi `text-field` dùng `coalesce name:vi`, 2 nhãn chủ quyền minzoom 4, chỉ 3 font stack Noto |
| 3 Pipeline: download + patch | `pipelines/tiles/src/download.mjs`, `patch_sovereignty.py` (pyosmium) + pytest | Test PBF tổng hợp: trong bbox đổi `name`, ngoài bbox giữ nguyên |
| 4 Pipeline: build + fixture | `build.mjs` (Planetiler, flags spec 4.2), `make-fixture.mjs` → `fixtures/q1.pmtiles` (Quận 1) | Fixture ≤ 15 MB, mở được bằng `pmtiles show` |
| 5 Pipeline: QA | `qa.ts`: giải mã tiles, luật cấm CJK/Paracel…, kiểm đảo có tên VI, kiểm style | Unit test luật; chạy trên fixture (bỏ kiểm đảo) xanh |
| 6 Upload + manifest + `data:update --tiles` | `upload.mjs` (rclone → R2, smoke 20 tile), `manifest.mjs` (KV `release:current`), `scripts/data-update.mjs` (dò Geofabrik, state R2, quyết định, chạy) | Lần chạy thật trên Mac: `vn-YYYYMMDD.pmtiles` lên R2, manifest cập nhật |
| 7 Worker `apps/api` | Hono: `/healthz`, `/v1/attribution`, `/v1/styles/:theme.json` (template từ KV), `/v1/tiles/:set/:z/:x/:y.pbf` + `/v1/tiles/:set.json` fallback (R2Source), vitest-pool-workers | Test xanh; deploy `workers.dev` trả style có URL tiles thật |
| 8 `@mapslibvn/web` | `createMap` (pmtiles protocol, style URL, attribution ép bật, marker/fitBounds/flyTo, `poiClick`, `places`), build ESM + UMD (bundle maplibre+pmtiles) | Unit test với maplibre mock; UMD ≤ 350 kB gzip; wrapper ≤ 15 kB |
| 9 Docs + playground + E2E | Astro Starlight, trang "Bắt đầu 5 phút", `playground.html` dùng UMD, Playwright (wrangler dev + fixture local) | E2E: map load, tiles 200/204, attribution hiện |
| 10 Deploy workflows | `deploy-api.yml`, `deploy-docs.yml`, `data-update.yml` (dispatch + cron, dùng image GHCR) | Deploy xanh; `gh workflow run data-update --dry-run` báo đúng |
| 11 Nghiệm thu M1 | Checklist spec 13/M1; DEVLOG | Bản đồ VN tiếng Việt trên playground thật, QA chủ quyền xanh, `<script>` nhúng trang trắng |

## 3. M2 — Kho POI + máy chủ nội bộ (plan cấp bước viết khi bắt đầu)

**Mục tiêu:** máy nội bộ chạy Postgres nhận kết nối qua Tunnel; `data:update` đầy đủ; ≥ 1,5 triệu `poi` active; lớp POI trên bản đồ.

| Task | Files | Giao diện / kết quả | Test | Nghiệm thu |
|---|---|---|---|---|
| 1 Máy chủ nội bộ | `infra/server/compose.yml`, `infra/server/README.md`, `scripts/server-setup.mjs`, `infra/server/postgres/{postgresql.conf,init-roles.sql}` | services `postgres` (TLS, roles `api` read + `poi_edit` insert, `pipeline` write), `cloudflared`, `backup` (pg_dump zstd → R2 `backups/`), `pipeline` (cron `data:update`); `pnpm server:setup`, `pnpm server:update` | unit: sinh cert/mật khẩu, render `.env`; tay: `psql "sslmode=require"` qua `cloudflared access tcp` | Worker `wrangler dev --remote` truy vấn `SELECT 1` qua Hyperdrive |
| 2 Migration kho POI | `db/migrations/0002_sources.sql`, `0003_core.sql`, `0004_geocode.sql`, `0005_tenant.sql` | bảng đúng spec 5.2 + index GIST/GIN; `schema_migrations` | integration: migrate lên/xuống trên dev DB; `\d` khớp spec | `pnpm db:migrate` xanh trên dev và máy chủ |
| 3 Chuẩn hoá VI | `packages/core/src/normalize.ts`, `abbrev.json`, `brand_alias.json`, `tests/normalize.test.ts`, `tests/fixtures/normalize.csv` | `normalizeVi(s): string`, `nameCore(s): string`, `expandAbbrev`, `applyBrandAlias` | ≥ 200 cặp fixture | 100% fixture xanh |
| 4 Parser địa chỉ | `packages/core/src/address.ts`, `tests/address.test.ts`, `tests/fixtures/addresses.jsonl`, `pipelines/poi/scripts/sample-addresses.mjs` | `parseAddress(s): ParsedAddress` (kiểu spec 5.7) | ≥ 300 địa chỉ thật (lấy mẫu Overture qua DuckDB, ẩn danh) | ≥ 95% fixture khớp kỳ vọng |
| 5 Ingest 3 nguồn | `pipelines/poi/src/ingest/{osm,overture,fsq}.mjs`, `pipelines/poi/src/duck.mjs` | DuckDB (`@duckdb/node-api`): OSM qua `ST_ReadOSM(pbf)` lọc tag → parquet; Overture/FSQ đọc S3 theo bbox VN → parquet; `ATTACH postgres` nạp `src_*` | integration trên fixture parquet Quận 1 (~20 MB trong repo) | Đếm dòng `src_*` khớp fixture ±0 |
| 6 Taxonomy | `db/seed/category.json`, `db/seed/category_map_{osm,overture,fsq}.csv`, `pipelines/poi/src/taxonomy.mjs` | 12 nhóm, ~150 lá; `mapCategory(source, value): code` | unit: mọi giá trị phổ biến top-200 mỗi nguồn có ánh xạ | tỉ lệ `other` < 10% trên fixture |
| 7 Gộp | `pipelines/poi/src/conflate.mjs`, `pipelines/poi/src/score.mjs`, `tests/conflate.test.ts` | thuật toán spec 5.4 (ứng viên bằng DuckDB `ST_DWithin`, ghép tham lam trong TS), `quality_score`, `popularity`, ID ULID ổn định | fixture khó: Cộng/Cong Caphe gộp; hai quán cùng chuỗi 60 m không gộp; chạy lại giữ ID | báo cáo gộp: số cụm, tỉ lệ đa nguồn |
| 8 Anchors/street/alley/admin | `pipelines/poi/src/geocode/{anchors,streets,alleys,admin}.mjs`, `db/seed/admin_alias_2025.csv` | bảng `address_anchor`, `street`, `alley`, `admin_area`, `admin_alias`; xác nhận `admin_level` thực tế và ghi README | unit: parent street cho "Hẻm 112 Nguyễn Lâm"; entrance | mốc số nhà Nguyễn Lâm ≥ 15 dòng |
| 9 POI tiles + style | `pipelines/poi/src/export-tiles.mjs` (tippecanoe, luật mật độ 5.8), `packages/style/src/poi-layers.mjs`, Worker template `{POI_FILE}` | `poi-YYYYMMDD.pmtiles` ≤ 300 MB; layer `poi` với icon theo `grp` | test style: layer `poi` tồn tại, minzoom đúng | bấm POI trên playground thấy tên/loại |
| 10 `data:update` đầy đủ | `scripts/data-update.mjs` (thêm dò Overture/FSQ, nhánh `--poi`, sanity ≤ 10% giảm), `scripts/db-restore.mjs` | chạy trọn trên máy chủ; `pnpm db:restore --latest` | unit: `decideWork` với 3 nguồn | lần chạy thật: ≥ 1,5 triệu `poi` active; manifest có `poi` |

## 4. M3 — Places API (plan cấp bước viết khi bắt đầu)

| Task | Files | Giao diện / kết quả | Test | Nghiệm thu |
|---|---|---|---|---|
| 1 Auth | `apps/api/src/auth.ts`, `db/seed/tenant_internal.sql` | middleware `X-Api-Key`/`key` → tenant (KV cache 5 phút), kiểm `Origin` theo `allowed_origins`, scopes; lỗi 401/403 chuẩn | unit + workers test | key internal qua, key sai 401 |
| 2 DB client | `apps/api/src/db.ts`, `wrangler.toml` (Hyperdrive binding `DB`) | `postgres` (porsager) qua Hyperdrive; local dev bằng `WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_DB` | workers test với Postgres docker | `SELECT 1` qua Worker local và remote |
| 3 Autocomplete | `apps/api/src/routes/autocomplete.ts`, `apps/api/src/ranking.ts`, `apps/api/src/cache.ts` | SQL trigram + `unaccent` trên `poi`, `street`, `address_anchor`; công thức 6.2; cache 10 phút theo `(q_norm, h3res6, types)` | unit ranking; fixture **"Trường Tiểu học Hoàng Diệu"** | p95 < 300 ms từ VN |
| 4 Search/nearby/details | `routes/search.ts`, `routes/nearby.ts`, `routes/places.ts` | tham số/kết quả spec 6.1; `Place` type trong core | workers test với fixture DB | đúng shape JSON |
| 5 Geocode/reverse | `apps/api/src/geocode.ts`, `routes/geocode.ts`, `routes/reverse.ts` | thang 5 mức spec 6.3; `reverse` "≈ 86–90" | fixture **"88/9 Nguyễn Lâm"** → `interpolated`, ≤ 60 m | 2 fixture bắt buộc xanh |
| 6 Core + UI | `packages/core/src/client.ts` (đầy đủ), `packages/web/src/autocomplete-element.ts`, `packages/react/*` | `createClient` 8 phương thức; `<mapslibvn-autocomplete>`; `<MapsLibVNMap>`, `useMap`, `usePlaces` | unit + Playwright gõ "highlands" ≤ 1 s | React demo trong docs |
| 7 Quota + đo lường | `apps/api/src/quota.ts` (cờ `QUOTA_ENABLED`), `apps/api/src/analytics.ts` | KV đếm ngày, 429 ở 2×; Analytics Engine `(tenant,key,endpoint,status,ms)` | workers test bật cờ | tenant `free` thử nghiệm bị 429 đúng |

## 5. M4 — Đóng góp (plan cấp bước viết khi bắt đầu)

| Task | Files | Giao diện / kết quả | Test | Nghiệm thu |
|---|---|---|---|---|
| 1 `POST /v1/edits` | `routes/edits.ts`, `apps/api/src/edits/{validate,rules}.ts` | body spec 6.1; giới hạn 20/ngày/end-user, 500/ngày/key; luật auto-approve 6.5 | unit luật; workers test | sửa giờ mở cửa → `auto_approved` |
| 2 Áp dụng edit | `db/migrations/0006_apply_edit.sql` (hàm SQL `apply_poi_edit(id)`), `apps/api/src/edits/apply.ts` | cập nhật `poi`, `locked_fields`, tạo `address_anchor` khi có số nhà | integration | thấy ngay qua `/v1/places/{id}` |
| 3 `apps/admin` | `apps/admin/*` (Next.js static), `routes/admin/*.ts` (xác thực JWT Cloudflare Access) | danh sách pending, duyệt/từ chối, ghi `reviewer` | Playwright với Access giả lập | POI mới → pending → duyệt → có ở build kế |
| 4 Pipeline tôn trọng edit | `pipelines/poi/src/conflate.mjs` (nhánh `locked_fields`, `created_by='user'`) | không ghi đè trường khoá, không xoá POI người dùng | unit | chạy `data:update` sau duyệt, edit còn nguyên |
| 5 Core + docs | `packages/core/src/client.ts` (`suggestEdit`), docs trang "Đóng góp" | | unit | |

## 6. M5 — Phát hành nội bộ (plan cấp bước viết khi bắt đầu)

| Task | Files | Kết quả | Nghiệm thu |
|---|---|---|---|
| 1 Tài liệu | `apps/docs/src/content/docs/{bat-dau,tu-host,giay-phep,do-chinh-xac,dong-gop}.md`, `THIRD_PARTY_NOTICES.md`, `docs/legal/dieu-khoan-tenant.md` | đủ 5 trang + notices đóng gói trong SDK | docs deploy, link kiểm tra không vỡ |
| 2 Key + báo cáo | `db/seed/tenant_ketban.sql`, `scripts/weekly-report.mjs` (Analytics Engine SQL API → email qua Cloudflare Email Routing), `scripts/export-odbl.mjs` | key cho app kết bạn; báo cáo tuần; xuất bảng ODbL | báo cáo tuần đầu nhận được |
| 3 Nghiệm thu & pháp lý | `docs/DEVLOG.md` mục "Việc tay còn lại", checklist spec 13/M5 | app kết bạn nhúng bằng key riêng | checklist ký bởi PHONG |

Sau M5: brainstorming + spec riêng cho `@mapslibvn/react-native`.

---

## 7. Định nghĩa "toàn bộ spec đã xong"

- [ ] M1a, M1b nghiệm thu (bản đồ câm, môi trường một lệnh trên macOS và Windows).
- [ ] M2 nghiệm thu (máy chủ nội bộ, ≥ 1,5 triệu POI, `data:update` trọn vòng, `db:restore`).
- [ ] M3 nghiệm thu (2 fixture bắt buộc, p95 < 300 ms).
- [ ] M4 nghiệm thu (đóng góp end-to-end).
- [ ] M5 nghiệm thu (app kết bạn nhúng, docs, báo cáo tuần, việc tay pháp lý ghi rõ).
- [ ] `docs/DEVLOG.md` mục "Trạng thái hiện tại" ghi "Spec bản 2 hoàn tất; bước kế tiếp: spec React Native".
