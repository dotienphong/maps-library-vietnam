# M2 — Kho POI + máy chủ nội bộ: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Máy nội bộ 24/7 chạy Postgres/PostGIS nhận kết nối TLS từ Worker qua Hyperdrive → Access → Tunnel; kho POI hợp nhất từ OSM + Overture + Foursquare (≥ 1,5 triệu `poi` active) kèm kho mốc địa chỉ/đường/hẻm/hành chính; lớp POI hiển thị trên bản đồ theo zoom; `pnpm data:update` chạy trọn vòng 3 nguồn; `pnpm db:restore --latest` phục hồi trên máy dev.

**Architecture:** `infra/server/compose.yml` (postgres TLS + cloudflared + backup + pipeline-cron) dựng bằng `pnpm server:setup`. Pipeline POI chạy trong image Docker chung: DuckDB (`@duckdb/node-api`) đọc parquet Overture/FSQ thẳng từ S3 theo bbox VN và đọc GeoJSONSeq do `osmium export` sinh từ PBF **đã patch chủ quyền** → parquet trong `work/`; Node nạp vào Postgres bằng `COPY FROM STDIN` (bảng `_new` → hoán đổi trong một transaction). Chuẩn hoá tiếng Việt và parser địa chỉ nằm trong `@mapslibvn/core` (dùng chung với API ở M3). Gộp: PostGIS sinh cặp ứng viên (GIST + pg_trgm), Node ghép tham lam, ID ULID ổn định từ hash nguồn chính. `poi` xuất GeoJSONSeq → tippecanoe → `poi-YYYYMMDD.pmtiles` lên R2, manifest KV thêm khoá `poi`.

**Tech Stack:** Node 22, `@duckdb/node-api` (httpfs, spatial), `postgres` (porsager, COPY streaming), PostGIS 3.4 + pg_trgm + unaccent, osmium-tool, tippecanoe, rclone, zstd, `postgresql-client-16`, `cloudflared`, Wrangler 4 (Hyperdrive), Vitest (unit + `*.dbtest.mjs` tích hợp trên Postgres dev).

**Spec:** mục 2 (kiến trúc), 5.1–5.9 (toàn bộ P2), 6.6 (Hyperdrive), 9 (roles DB), 10 (kiểm thử), 11.1–11.2 (máy chủ, restore), 12.2 (bảng thuần OSM), 13/M2. Roadmap: `2026-08-26-roadmap-toan-bo-spec.md` mục 3.

---

## Điều kiện bắt đầu và giả định cần xác nhận ở Task 0

Plan này được viết khi **M1a đã nghiệm thu (27/08/2026), M1b/M1c chưa làm**. Review lần 2 (27/08) đã đối chiếu với mã M1a thật. Mọi giả định dưới đây phải được kiểm tra ở Task 0; sai ở đâu thì sửa plan ở đó và ghi "Quyết định phát sinh" trong DEVLOG.

**Review lần 3 (27/08, sau khi M1 nghiệm thu)** — đối chiếu toàn bộ 10 task với mã M1 thật và kiểm chứng giả định bằng lệnh thật. Kết quả đã sửa thẳng vào plan này:

1. **Foursquare OS Places không còn trên S3 công khai** (bucket `fsq-os-places-us-east-1` chỉ còn LICENSE/NOTICE; docs Foursquare: "now delivered through the Foursquare Places Portal … instead of the legacy public S3 bucket"). PHONG chọn **đọc qua Hugging Face** `hf://datasets/foursquare/fsq-os-places/…` (gated — cần `HF_TOKEN`, cùng layout `release/dt=YYYY-MM-DD/places/parquet/`). Mọi chỗ FSQ trong Task 0/5/10 đã đổi theo.
2. **G3**: PHONG chưa có máy riêng → **máy dev là máy chủ tạm** (compose `mapslibvn-server` chạy song song compose dev, `PIPELINE_IMAGE=mapslibvn/pipeline:local`). Chuyển máy sau này = `git clone` → `pnpm server:setup` → `pnpm db:restore --latest` → dán lại `TUNNEL_TOKEN`; vì thế **backup → restore phải được thử ngay ở Task 1 Step 8**, không đợi Task 10.
3. **Thứ tự thực thi**: `0 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 1 → 10`. Task 1 (máy chủ, Tunnel, Hyperdrive) làm sau khi pipeline đã chứng minh trên DB dev; commit binding Hyperdrive vào `wrangler.toml` **chỉ khi đã có ID thật** vì `deploy-api.yml` tự deploy mỗi push chạm `apps/api/**`.
4. Lỗi kỹ thuật đã sửa trong plan: `publishNew` gọi `pg_get_serial_sequence` trên bảng không có cột `id` (ném lỗi, không trả NULL — đã kiểm trên Postgres dev); `pg_hba.conf` xếp `samenet` trước `hostssl` khiến kết nối qua Tunnel không bị buộc TLS; `renderServerEnv` và `data-update.yml` thiếu `RCLONE_CONFIG_R2_NO_CHECK_BUCKET` (upload.mjs bắt buộc); `data-update.mjs` viết lại đã bỏ preflight `missingLiveEnv` và `readState` nuốt lỗi rclone; `db:restore --clean` vào DB có PostGIS (đổi sang DB mới); job `dbtest` chạy mỗi push (repo private, 2.000 phút/tháng → workflow riêng có `paths`); pin `cloudflared` cũ một năm; icon lá `rail/rail_metro/doctor/beach` không có trong sprite; token Cloudflare cho máy chủ nên tách riêng (KV + R2, không có Workers/Pages Edit).
5. Quy ước từ M1c: mã trong plan dài hơn `lineWidth: 100` của Biome — **chạy `pnpm exec biome check --write <thư mục>` trước `pnpm lint`** ở mỗi step commit.

**Task nào cần gì từ M1 (để có thể bắt đầu sớm, song song với M1b/M1c):**

| Task M2 | Cần | Ghi chú |
|---|---|---|
| 0, 1 (Step 1–9), 2 | chỉ M1a | Làm được ngay. Task 1 Step 10 (Worker `/healthz/db`) cần `apps/api` của M1c Task 1 |
| 3, 4 | M1b Task 1 (`packages/core`) | Thêm vào core đã có `attribution`/`client` |
| 5, 6, 7, 8 | M1b Task 3 (`work/vietnam-patched.osm.pbf`, `pipelines/tiles/src/lib/dates.mjs`, `.dockerignore` không loại `packages`) | Fixture Quận 1 cắt từ PBF đã patch |
| 9 | M1b Task 2 (`packages/style` + sprite), M1c Task 1 (`apps/api`), M1c Task 2–3 (web, playground) | |
| 10 | M1b Task 6 (`scripts/data-update.mjs`, `update-plan.mjs`, `upload/smoke/manifest.mjs`), M1c Task 4 (`data-update.yml`) | Viết lại `data-update.mjs`/`update-plan.mjs` của M1b |

| # | Giả định | Kiểm tra | Nếu sai |
|---|---|---|---|
| G1 | M1a–M1c đã xong: có `pipelines/tiles/*`, `packages/core`, `packages/style` (template + `fillTemplate` nhận `POI_FILE`), `apps/api` (Worker với `renderStyle`, KV `META`, R2 `TILES`), `scripts/data-update.mjs` + `scripts/lib/update-plan.mjs`, `pipelines/tiles/src/{upload,smoke,manifest,qa}.mjs`, fixture `pipelines/tiles/fixtures/q1.pmtiles` | `ls` các file; `pnpm test` xanh | Dừng, hoàn tất M1 trước |
| G2 | Image pipeline có: Node 22, DuckDB CLI 1.5.x, osmium-tool, tippecanoe, rclone, Python/pyosmium (Dockerfile hiện tại) | `pnpm image:smoke` | Sửa Dockerfile trước |
| G3 | ~~PHONG đã có máy nội bộ 24/7~~ **Đã xác nhận 27/08: chưa có máy riêng.** Máy dev (macOS) làm máy chủ tạm: tắt ngủ máy, cần ≥ 16 GB RAM vì chạy song song compose dev + compose server + DuckDB 3 GB + Java 4 GB khi `data:update` | — | Task 1 chạy trên máy dev với `PIPELINE_IMAGE=mapslibvn/pipeline:local`; chuyển máy thật sau bằng `server:setup` + `db:restore --latest` |
| G4 | **Đã kiểm 27/08 trên `2026-08-19.0`**: `id, geometry` (kiểu **`GEOMETRY('OGC:CRS84')` native của DuckDB 1.5 — KHÔNG phải WKB blob**, dùng `ST_X(geometry)` thẳng, không `ST_GeomFromWKB`), `bbox`, `names{primary, common MAP, rules}`, `categories{primary, alternate}`, `confidence`, `websites[]`, `emails[]`, `socials[]` (URL Facebook có sẵn), `phones[]`, `brand`, `addresses[{freeform,locality,postcode,region,country}]`, `sources[]{dataset,record_id,update_time,…}`, **`operating_status`** (dùng cho `closed`), `basic_category`, `taxonomy{primary,hierarchy[],alternates[]}`, `version` | đã làm | `ingest/overture.mjs` (Task 5 Step 7) đã sửa theo cột thật |
| G5 | Foursquare OS Places đọc qua **Hugging Face** `hf://datasets/foursquare/fsq-os-places/release/dt=YYYY-MM-DD/places/parquet/*.parquet` (gated, Apache-2.0) có cột `fsq_place_id, name, latitude, longitude, address, locality, region, tel, website, date_closed, fsq_category_labels[]`. **S3 công khai đã đóng (kiểm 27/08).** | **Đã kiểm 27/08 trên `dt=2026-08-11`**: đủ các cột trên; thêm `country`, `postcode`, `email`, `facebook_id`, `instagram`, `fsq_category_ids[]`, `date_refreshed`, `geom GEOMETRY`, `bbox`; **`date_closed` là VARCHAR** (COPY vào cột `date` được khi là `YYYY-MM-DD`; dùng `NULLIF(date_closed, '')`) | `ingest/fsq.mjs` đã sửa: lọc thêm `country = 'VN'` |
| G6 | OSM VN có ranh giới `admin_level=4` (34 tỉnh sau 1/7/2025) và `admin_level=8` (phường/xã); `admin_level=6` có thể còn hoặc không | Task 8 Step 6 đếm thật và ghi `pipelines/poi/README.md` | Đổi danh sách level trong `geocode/admin.mjs` |
| G7 | `@duckdb/node-api` có bản ổn định ≥ 1.4 với binary linux-x64/arm64 và hỗ trợ `INSTALL/LOAD spatial, httpfs` — **đã kiểm 27/08: dist-tag `latest` = `1.5.5-r.4`**; mọi bản của gói này đều mang hậu tố `-r.N` (quy ước phát hành của họ, không phải pre-release) → **pin `1.5.5-r.4`** ở Task 5 | đã làm | — |
| G8 | PHONG đã tạo tài khoản Hugging Face, chấp nhận điều khoản gated của `foursquare/fsq-os-places` và có token đọc (`HF_TOKEN`) | `curl -s -H "Authorization: Bearer $HF_TOKEN" https://huggingface.co/api/datasets/foursquare/fsq-os-places/tree/main/release` trả JSON danh sách `dt=…` | Chưa có token → Task 5 làm OSM + Overture trước, FSQ bổ sung khi có; ghi DEVLOG |

**Khác biệt so với roadmap mục 3 (đã cân nhắc khi viết plan, ghi DEVLOG ở Task 0):**

1. OSM POI dùng `osmium tags-filter` + `osmium export` (GeoJSONSeq, có tâm polygon cho trường/bệnh viện vẽ dạng vùng) thay cho `ST_ReadOSM` (chỉ cho node) — tránh mất POI dạng vùng.
2. Ứng viên gộp sinh bằng **PostGIS** (`ST_DWithin` trên GIST + `similarity()` pg_trgm) thay cho DuckDB — dữ liệu nguồn đã nằm trong Postgres, không phải đưa 3,5 triệu điểm qua lại.
3. Nạp Postgres bằng `COPY FROM STDIN` từ Node (định dạng text, có test hàm định dạng) thay cho `ATTACH postgres` của DuckDB — tránh phụ thuộc hành vi ghi kiểu geometry/jsonb/array của extension.
4. Test pipeline đặt tại `pipelines/poi/tests/*.test.mjs` (unit) và `*.dbtest.mjs` (cần Postgres dev) — cùng quy ước `.mjs` + JSDoc của M1b thay cho `.ts`.
5. `init-roles.sql` đổi thành `init-roles.sh` (entrypoint Postgres không đọc biến môi trường trong `.sql`); roles `api`/`pipeline` được **migration 0002** tạo dạng `NOLOGIN` để GRANT chạy được trên cả dev lẫn máy chủ; máy chủ chỉ đặt mật khẩu + LOGIN.
6. `poi` **không** hoán đổi bảng (bảng `poi_edit` tham chiếu FK) mà **gộp**: `UPDATE` POI pipeline, `INSERT` mới, xoá POI pipeline biến mất khỏi nguồn (POI có edit → `status='closed'`), không đụng `created_by='user'` — sẵn cho M4.
7. Thêm nhóm giả `other` (mã lá `other`) cho bản ghi không suy ra được nhóm; 12 nhóm thật giữ nguyên, mỗi nhóm có lá `<nhóm>_other`.

---

## Cấu trúc file tạo/sửa trong plan này

```
infra/server/{compose.yml,README.md,.env.example,.gitignore}
infra/server/postgres/{postgresql.conf,pg_hba.conf,init-roles.sh}
infra/server/backup/backup.mjs
scripts/{server-setup.mjs,server-update.mjs,cron.mjs,db-restore.mjs}
scripts/lib/{server-env.mjs,server-env.test.mjs,schedule.mjs,schedule.test.mjs,backup-plan.mjs,backup-plan.test.mjs}
scripts/lib/{migrations.mjs,migrations.test.mjs}                         (sửa: .down.sql, --down)
scripts/lib/{update-plan.mjs,update-plan.test.mjs}                       (sửa: 3 nguồn)
scripts/lib/{sources.mjs,sources.test.mjs}                               (dò phiên bản Overture/FSQ)
scripts/data-update.mjs                                                  (sửa: nhánh --poi, tunnel)
db/migrations/{0002_sources.sql,0002_sources.down.sql,0003_core.sql,0003_core.down.sql,
               0004_geocode.sql,0004_geocode.down.sql,0005_tenant.sql,0005_tenant.down.sql}
db/seed/{category.json,category_map_osm.csv,category_map_overture.csv,category_map_fsq.csv,admin_alias_2025.csv}
db/schema.dbtest.mjs
packages/core/src/{normalize.ts,abbrev.json,brand_alias.json,address.ts,provinces.json,index.ts}
packages/core/tests/{normalize.test.ts,address.test.ts}
packages/core/tests/fixtures/{normalize.csv,addresses.jsonl}
packages/core/.size-limit.json
pipelines/poi/{package.json,tsconfig.json,README.md}
pipelines/poi/src/{duck.mjs,pg.mjs,records.mjs,conflate.mjs,score.mjs,taxonomy.mjs,publish.mjs,export-tiles.mjs,report.mjs}
pipelines/poi/src/lib/{env.mjs,copy-format.mjs,stable-id.mjs,greedy.mjs,contacts.mjs,vn-bbox.mjs}
pipelines/poi/src/ingest/{osm.mjs,overture.mjs,fsq.mjs}
pipelines/poi/src/geocode/{admin.mjs,streets.mjs,alleys.mjs,anchors.mjs,alley-name.mjs}
pipelines/poi/scripts/{make-fixture.mjs,make-vn-boundary.mjs,sample-addresses.mjs,category-coverage.mjs}
pipelines/poi/data/vn-boundary.geojson                                   (commit, public domain)
pipelines/poi/fixtures/{q1.osm.pbf,overture-q1.parquet,fsq-q1.parquet}   (commit, ≤ 20 MB tổng)
pipelines/poi/tests/{copy-format,stable-id,greedy,contacts,score,taxonomy,alley-name}.test.mjs
pipelines/poi/tests/{conflate,geocode,pipeline-fixture}.dbtest.mjs
pipelines/tiles/src/smoke.mjs                                            (sửa: --set poi)
packages/style/src/{poi-layers.mjs,poi-layers.test.ts}  ·  packages/style/scripts/build.mjs (sửa)
apps/api/src/{db.ts,style.ts,env.ts,index.ts}  ·  apps/api/wrangler.toml  ·  apps/api/test/styles.test.ts (sửa)
pipelines/Dockerfile (sửa: postgresql-client-16, zstd, cloudflared, build core, cài extension DuckDB)
vitest.config.ts · vitest.db.config.ts · package.json (scripts) · .env.example · .github/workflows/ci.yml (job test:db)
```

Quy ước giữ từ M1: `scripts/lib/*` và `pipelines/*/src/lib/*` là hàm thuần có test; file cấp trên là CLI mỏng. Mọi lệnh chạy từ gốc repo. Lệnh cần công cụ geo chạy **trong image** qua `docker compose --env-file .env -f infra/dev/compose.yml --profile pipeline run --rm pipeline …` — dưới đây viết tắt là `PIPE …`. Tạo alias cho phiên làm việc:

```bash
PIPE() { docker compose --env-file .env -f infra/dev/compose.yml --profile pipeline run --rm "$@"; }
# dùng: PIPE pipeline node pipelines/poi/src/ingest/osm.mjs --fixture
```

---

### Task 0: Xác nhận điều kiện bắt đầu, khung test tích hợp DB

**Files:**
- Create: `vitest.db.config.ts`
- Modify: `vitest.config.ts`, `package.json` (scripts `test:db`), `docs/DEVLOG.md`, `docs/superpowers/plans/2026-08-26-roadmap-toan-bo-spec.md` (tên file plan M2)

- [x] **Step 1: Kiểm tra G1, G2 — xác định task M2 nào được phép bắt đầu**

Run: `pnpm test && pnpm image:smoke && ls packages/core/src pipelines/tiles/src/lib/dates.mjs packages/style/dist apps/api/src scripts/data-update.mjs 2>&1`
Expected: test xanh; smoke in 8 dòng phiên bản (Planetiler, tippecanoe, DuckDB, osmium, pyosmium, rclone, node, pnpm). Với mỗi đường dẫn "No such file", đánh dấu task M2 tương ứng (bảng "Task nào cần gì từ M1") là **chờ** — chỉ chạy các task đã đủ điều kiện; không sửa file của M1b/M1c trong plan này.

- [x] **Step 2: Kiểm tra G4, G5, G7 bằng DuckDB CLI trong image**

Run:
```bash
PIPE pipeline duckdb -c "INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2'; \
  SELECT 1;" && \
curl -s 'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/?list-type=2&prefix=release/&delimiter=/' | grep -o 'release/[0-9.-]*/' | sort | tail -3
```
Expected: `1` và 3 dòng `release/2026-MM-DD.0/` (bản mới nhất cuối). Ghi lại bản mới nhất là `<OVERTURE_VER>`.

Run:
```bash
PIPE pipeline duckdb -c "INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2'; \
  DESCRIBE SELECT * FROM read_parquet('s3://overturemaps-us-west-2/release/<OVERTURE_VER>/theme=places/type=place/*.parquet') LIMIT 0;"
```
Expected: có các cột `id, geometry, bbox, names, categories, confidence, websites, phones, addresses, sources`. Khác → ghi lại tên cột thật để dùng ở Task 5.

Run:
```bash
curl -s -H "Authorization: Bearer $HF_TOKEN" https://huggingface.co/api/datasets/foursquare/fsq-os-places/tree/main/release | grep -o 'dt=[0-9-]*' | sort | tail -1
```
Expected: `dt=2026-MM-DD` — ghi là `<FSQ_DT>` (chỉ phần ngày). 401/403 → G8 chưa đạt: đăng nhập huggingface.co, mở trang dataset, bấm chấp nhận điều khoản, tạo token Read; đặt `HF_TOKEN=` vào `.env`.

Run:
```bash
# $HF_TOKEN được compose đưa vào container qua env_file .env — để nguyên trong nháy đơn để host không expand
PIPE pipeline sh -c 'duckdb -c "INSTALL httpfs; LOAD httpfs; CREATE SECRET hf (TYPE huggingface, TOKEN '\''$HF_TOKEN'\''); \
  DESCRIBE SELECT * FROM read_parquet('\''hf://datasets/foursquare/fsq-os-places/release/dt=<FSQ_DT>/places/parquet/*.parquet'\'') LIMIT 0;"'
```
Expected: có `fsq_place_id, name, latitude, longitude, address, locality, region, tel, website, date_closed, fsq_category_labels`.

Run: `pnpm view @duckdb/node-api version`
Expected: một phiên bản (ví dụ `1.5.x`). Ghi lại để pin ở Task 5.

- [x] **Step 3: Cấu hình Vitest hai tầng (unit / dbtest)**

`vitest.config.ts` (thay toàn bộ):
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'scripts/**/*.test.mjs',
      'packages/*/src/**/*.test.{ts,mjs}',
      'packages/*/tests/**/*.test.ts',
      'pipelines/*/src/**/*.test.{ts,mjs}',
      'pipelines/*/tests/**/*.test.mjs',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', 'apps/**', '**/*.dbtest.mjs'],
  },
});
```

`vitest.db.config.ts` (test cần Postgres dev đang chạy):
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['db/**/*.dbtest.mjs', 'pipelines/*/tests/**/*.dbtest.mjs'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
```

Thêm vào `package.json` scripts:
```json
"test:db": "vitest run --config vitest.db.config.ts --passWithNoTests",
"server:setup": "node scripts/server-setup.mjs",
"server:update": "node scripts/server-update.mjs",
"db:restore": "node scripts/db-restore.mjs"
```

Run: `pnpm test`
Expected: vẫn xanh (chưa có dbtest nào).

- [x] **Step 4: Ghi DEVLOG và roadmap, commit**

(Roadmap đã cập nhật tên file plan M2 ngày 27/08 — bỏ qua bước sửa roadmap.)

Sửa `docs/DEVLOG.md`: mục 1 "Mốc: M2 — Kho POI + máy chủ nội bộ", "Plan: `docs/superpowers/plans/2026-08-27-m2-kho-poi-may-chu.md`", "Task đang làm: Task 2" (Task 1 làm sau Task 9 — xem "Thứ tự thực thi" ở đầu plan); mục 3 thêm 7 dòng khác biệt (mục "Khác biệt so với roadmap" ở trên, mỗi dòng một quyết định) và kết quả G4/G5/G7 (`<OVERTURE_VER>`, `<FSQ_DT>`, phiên bản `@duckdb/node-api`); mục 4 dòng `M2 T0`.

```bash
git add -A
git commit -m "chore(test): tách vitest unit/dbtest; ghi giả định và khác biệt plan M2"
git push
```

---

### Task 1: Máy chủ nội bộ — compose, `pnpm server:setup`, Tunnel/Access/Hyperdrive, backup, cron

**Files:**
- Create: `infra/server/compose.yml`, `infra/server/.env.example`, `infra/server/.gitignore`, `infra/server/README.md`, `infra/server/postgres/postgresql.conf`, `infra/server/postgres/pg_hba.conf`, `infra/server/postgres/init-roles.sh`, `infra/server/backup/backup.mjs`, `scripts/server-setup.mjs`, `scripts/server-update.mjs`, `scripts/cron.mjs`, `scripts/lib/server-env.mjs`, `scripts/lib/server-env.test.mjs`, `scripts/lib/schedule.mjs`, `scripts/lib/schedule.test.mjs`, `scripts/lib/backup-plan.mjs`, `scripts/lib/backup-plan.test.mjs`, `apps/api/src/db.ts`
- Modify: `pipelines/Dockerfile`, `apps/api/wrangler.toml`, `apps/api/src/env.ts`, `apps/api/src/index.ts`, `.env.example`

- [ ] **Step 1: Test hàm thuần sinh `.env` máy chủ, lịch chạy, kế hoạch giữ backup (thất bại)**

`scripts/lib/server-env.test.mjs`:
```js
import { describe, expect, it } from 'vitest';
import { generatePassword, parseEnv, renderServerEnv, sharedBuffersFor } from './server-env.mjs';

describe('generatePassword', () => {
  it('32 ký tự base62, hai lần khác nhau', () => {
    const a = generatePassword(32);
    expect(a).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(generatePassword(32)).not.toBe(a);
  });
});

describe('sharedBuffersFor', () => {
  it('25% RAM, làm tròn xuống 256MB, tối thiểu 512MB, tối đa 8GB', () => {
    expect(sharedBuffersFor(8 * 2 ** 30)).toBe('2048MB');
    expect(sharedBuffersFor(16 * 2 ** 30)).toBe('4096MB');
    expect(sharedBuffersFor(1 * 2 ** 30)).toBe('512MB');
    expect(sharedBuffersFor(64 * 2 ** 30)).toBe('8192MB');
  });
});

describe('renderServerEnv / parseEnv', () => {
  it('render đủ khoá và đọc lại được', () => {
    const text = renderServerEnv({
      superPassword: 'S', apiPassword: 'A', pipelinePassword: 'P', sharedBuffers: '2048MB',
      tunnelToken: '', pipelineImage: 'ghcr.io/dotienphong/mapslibvn-pipeline:latest',
    });
    const env = parseEnv(text);
    expect(env.POSTGRES_SUPER_PASSWORD).toBe('S');
    expect(env.API_PASSWORD).toBe('A');
    expect(env.PIPELINE_PASSWORD).toBe('P');
    expect(env.PG_SHARED_BUFFERS).toBe('2048MB');
    expect(env.TUNNEL_TOKEN).toBe('');
    expect(env.PIPELINE_IMAGE).toBe('ghcr.io/dotienphong/mapslibvn-pipeline:latest');
    expect(env.RCLONE_CONFIG_R2_NO_CHECK_BUCKET).toBe('true');
    expect(env.HF_TOKEN).toBe('');
    expect(text).toContain('# Bí mật máy chủ');
  });

  it('parseEnv bỏ comment, dòng trống, dấu nháy', () => {
    expect(parseEnv('# c\nA=1\n\nB="x y"\nC=\'z\'\n')).toEqual({ A: '1', B: 'x y', C: 'z' });
  });
});
```

`scripts/lib/schedule.test.mjs`:
```js
import { describe, expect, it } from 'vitest';
import { nextRun } from './schedule.mjs';

describe('nextRun (giờ VN, UTC+7)', () => {
  it('hằng ngày 03:00 VN: từ 26/08 01:00 VN → 26/08 03:00 VN', () => {
    const now = new Date('2026-08-25T18:00:00Z'); // 26/08 01:00 VN
    expect(nextRun(now, { hour: 3, minute: 0 }).toISOString()).toBe('2026-08-25T20:00:00.000Z');
  });
  it('hằng ngày 03:00 VN: từ 26/08 03:00:01 VN → 27/08 03:00 VN', () => {
    const now = new Date('2026-08-25T20:00:01Z');
    expect(nextRun(now, { hour: 3, minute: 0 }).toISOString()).toBe('2026-08-26T20:00:00.000Z');
  });
  it('thứ Hai 02:00 VN: từ thứ Tư 26/08/2026 → thứ Hai 31/08 02:00 VN = 30/08 19:00Z', () => {
    const now = new Date('2026-08-26T05:00:00Z');
    expect(nextRun(now, { hour: 2, minute: 0, weekday: 1 }).toISOString()).toBe('2026-08-30T19:00:00.000Z');
  });
  it('đúng thời điểm chạy → lần kế tiếp là tuần sau', () => {
    const now = new Date('2026-08-30T19:00:00Z');
    expect(nextRun(now, { hour: 2, minute: 0, weekday: 1 }).toISOString()).toBe('2026-09-06T19:00:00.000Z');
  });
});
```

`scripts/lib/backup-plan.test.mjs`:
```js
import { describe, expect, it } from 'vitest';
import { backupName, retentionPlan } from './backup-plan.mjs';

describe('backupName', () => {
  it('tên theo giờ VN', () => {
    expect(backupName(new Date('2026-08-25T20:00:00Z'))).toBe('mapslibvn-20260826-0300.dump.zst');
  });
});

describe('retentionPlan', () => {
  const daily = Array.from({ length: 10 }, (_, i) => `mapslibvn-202608${String(10 + i).padStart(2, '0')}-0300.dump.zst`);
  it('giữ 7 bản ngày mới nhất, xoá phần còn lại', () => {
    const plan = retentionPlan({ daily, weekly: [] }, { keepDaily: 7, keepWeekly: 4 });
    expect(plan.deleteDaily).toEqual(daily.slice(0, 3));
    expect(plan.deleteWeekly).toEqual([]);
  });
  it('weekly giữ 4', () => {
    const weekly = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'].map((w) => `mapslibvn-2026${w}.dump.zst`);
    const plan = retentionPlan({ daily: [], weekly }, { keepDaily: 7, keepWeekly: 4 });
    expect(plan.deleteWeekly).toEqual(weekly.slice(0, 2));
  });
  it('tên sắp theo chuỗi nên bản mới nhất ở cuối', () => {
    const plan = retentionPlan({ daily: ['b', 'a', 'c'], weekly: [] }, { keepDaily: 2, keepWeekly: 1 });
    expect(plan.deleteDaily).toEqual(['a']);
  });
});
```

Run: `pnpm test`
Expected: FAIL — không tìm thấy `./server-env.mjs`, `./schedule.mjs`, `./backup-plan.mjs`.

- [ ] **Step 2: Viết ba hàm thuần**

`scripts/lib/server-env.mjs`:
```js
import { randomInt } from 'node:crypto';

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** @param {number} length */
export function generatePassword(length) {
  let out = '';
  for (let i = 0; i < length; i++) out += BASE62[randomInt(BASE62.length)];
  return out;
}

/** 25% RAM, bội số 256MB, trong [512MB, 8192MB]. @param {number} totalMemBytes */
export function sharedBuffersFor(totalMemBytes) {
  const quarterMb = Math.floor(totalMemBytes / 4 / 2 ** 20);
  const rounded = Math.floor(quarterMb / 256) * 256;
  return `${Math.min(8192, Math.max(512, rounded))}MB`;
}

/**
 * @param {{ superPassword: string, apiPassword: string, pipelinePassword: string, sharedBuffers: string,
 *   tunnelToken: string, pipelineImage: string }} v
 */
export function renderServerEnv(v) {
  return [
    '# Bí mật máy chủ MapsLibVN — KHÔNG commit. Sinh bởi pnpm server:setup.',
    `POSTGRES_SUPER_PASSWORD=${v.superPassword}`,
    `API_PASSWORD=${v.apiPassword}`,
    `PIPELINE_PASSWORD=${v.pipelinePassword}`,
    `PG_SHARED_BUFFERS=${v.sharedBuffers}`,
    '# Token Tunnel: Cloudflare Zero Trust → Networks → Tunnels → tạo tunnel "mapslibvn-db" → copy token',
    `TUNNEL_TOKEN=${v.tunnelToken}`,
    `PIPELINE_IMAGE=${v.pipelineImage}`,
    '# Các biến Cloudflare/R2 cho backup và data:update — chép từ .env máy dev (xem .env.example gốc repo).',
    '# CLOUDFLARE_API_TOKEN ở đây dùng token RIÊNG cho pipeline (Workers KV Edit + Workers R2 Edit), không dùng token deploy.',
    'TILES_BASE=',
    'R2_BUCKET=mapslibvn-tiles',
    'KV_NAMESPACE_ID_META=',
    'CLOUDFLARE_ACCOUNT_ID=',
    'CLOUDFLARE_API_TOKEN=',
    'RCLONE_CONFIG_R2_TYPE=s3',
    'RCLONE_CONFIG_R2_PROVIDER=Cloudflare',
    'RCLONE_CONFIG_R2_ACL=private',
    'RCLONE_CONFIG_R2_ACCESS_KEY_ID=',
    'RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=',
    'RCLONE_CONFIG_R2_ENDPOINT=',
    'RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true',
    '# Token Hugging Face (Read) cho dataset gated foursquare/fsq-os-places — ingest FSQ',
    'HF_TOKEN=',
    '',
  ].join('\n');
}

/** @param {string} text @returns {Record<string, string>} */
export function parseEnv(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}
```

`scripts/lib/schedule.mjs`:
```js
const VN_OFFSET_MS = 7 * 3600 * 1000;

/**
 * Thời điểm chạy kế tiếp theo giờ Việt Nam (UTC+7, không DST).
 * @param {Date} now
 * @param {{ hour: number, minute: number, weekday?: number }} at weekday: 0=CN … 6=Thứ Bảy (theo giờ VN)
 */
export function nextRun(now, at) {
  const vn = new Date(now.getTime() + VN_OFFSET_MS);
  const candidate = new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate(), at.hour, at.minute, 0, 0));
  if (candidate.getTime() <= vn.getTime()) candidate.setUTCDate(candidate.getUTCDate() + 1);
  if (at.weekday !== undefined) {
    while (candidate.getUTCDay() !== at.weekday) candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return new Date(candidate.getTime() - VN_OFFSET_MS);
}
```

`scripts/lib/backup-plan.mjs`:
```js
/** @param {Date} d tên theo giờ VN */
export function backupName(d) {
  const vn = new Date(d.getTime() + 7 * 3600 * 1000).toISOString();
  return `mapslibvn-${vn.slice(0, 10).replace(/-/g, '')}-${vn.slice(11, 16).replace(':', '')}.dump.zst`;
}

/**
 * @param {{ daily: string[], weekly: string[] }} existing tên file trong backups/daily và backups/weekly
 * @param {{ keepDaily: number, keepWeekly: number }} keep
 */
export function retentionPlan(existing, keep) {
  const oldest = (/** @type {string[]} */ names, /** @type {number} */ n) => {
    const sorted = [...names].sort();
    return sorted.slice(0, Math.max(0, sorted.length - n));
  };
  return { deleteDaily: oldest(existing.daily, keep.keepDaily), deleteWeekly: oldest(existing.weekly, keep.keepWeekly) };
}
```

Run: `pnpm test`
Expected: xanh.

- [ ] **Step 3: File cấu hình Postgres và compose máy chủ**

`infra/server/postgres/postgresql.conf`:
```
listen_addresses = '*'
port = 5432
max_connections = 100
shared_buffers = 2GB            # ghi đè bằng -c shared_buffers=${PG_SHARED_BUFFERS} trong compose
effective_cache_size = 6GB
work_mem = 32MB
maintenance_work_mem = 512MB
wal_compression = on
checkpoint_completion_target = 0.9
random_page_cost = 1.1
ssl = on
ssl_cert_file = '/certs/server.crt'
ssl_key_file = '/certs/server.key'
ssl_min_protocol_version = 'TLSv1.2'
password_encryption = scram-sha-256
hba_file = '/etc/postgresql/pg_hba.conf'
log_min_duration_statement = 500
log_line_prefix = '%m [%p] %u@%d '
timezone = 'Asia/Ho_Chi_Minh'
```

`infra/server/postgres/pg_hba.conf`:
```
# local (trong container): psql qua socket cho healthcheck, init-roles.sh, exec tay
local     all   all         trust
# MỌI kết nối TCP (backup, pipeline, cloudflared → Tunnel → Hyperdrive) bắt buộc TLS + mật khẩu.
# Không có dòng `host … samenet`: cloudflared cũng nằm trong mạng compose, nếu cho phép samenet thì
# đường Tunnel sẽ không bị buộc TLS (lỗi phát hiện ở review lần 3).
hostssl   all   all   all   scram-sha-256
hostnossl all   all   all   reject
```

`infra/server/postgres/init-roles.sh` (chạy một lần khi volume `pgdata` trống):
```sh
#!/bin/sh
# Đặt mật khẩu + LOGIN cho hai role ứng dụng. Role được migration 0002 tạo NOLOGIN; ở đây tạo trước nếu chưa có.
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v api_pw="$API_PASSWORD" -v pipeline_pw="$PIPELINE_PASSWORD" <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api') THEN CREATE ROLE api NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pipeline') THEN CREATE ROLE pipeline NOLOGIN; END IF;
END $$;
ALTER ROLE api LOGIN PASSWORD :'api_pw' CONNECTION LIMIT 40;
ALTER ROLE pipeline LOGIN PASSWORD :'pipeline_pw';
GRANT CONNECT ON DATABASE mapslibvn TO api, pipeline;
GRANT USAGE ON SCHEMA public TO api, pipeline;
GRANT CREATE ON SCHEMA public TO pipeline;
SQL
```

`infra/server/compose.yml`:
```yaml
name: mapslibvn-server

services:
  postgres:
    image: postgis/postgis:16-3.4
    restart: unless-stopped
    shm_size: 1g
    environment:
      POSTGRES_USER: mapslibvn
      POSTGRES_PASSWORD: ${POSTGRES_SUPER_PASSWORD}
      POSTGRES_DB: mapslibvn
      API_PASSWORD: ${API_PASSWORD}
      PIPELINE_PASSWORD: ${PIPELINE_PASSWORD}
    command:
      - postgres
      - -c
      - config_file=/etc/postgresql/postgresql.conf
      - -c
      - shared_buffers=${PG_SHARED_BUFFERS:-2GB}
    volumes:
      - pgdata:/var/lib/postgresql/data
      - pgcerts:/certs:ro
      - ./postgres/postgresql.conf:/etc/postgresql/postgresql.conf:ro
      - ./postgres/pg_hba.conf:/etc/postgresql/pg_hba.conf:ro
      - ./postgres/init-roles.sh:/docker-entrypoint-initdb.d/10-roles.sh:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U mapslibvn -d mapslibvn"]
      interval: 10s
      timeout: 5s
      retries: 30
    # KHÔNG có `ports:` — DB không mở cổng ra ngoài; chỉ cloudflared/backup/pipeline trong mạng compose nối tới.

  cloudflared:
    image: cloudflare/cloudflared:2026.8.2
    restart: unless-stopped
    command: ["tunnel", "--no-autoupdate", "run", "--token", "${TUNNEL_TOKEN}"]
    depends_on:
      postgres:
        condition: service_healthy

  backup:
    image: ${PIPELINE_IMAGE:-ghcr.io/dotienphong/mapslibvn-pipeline:latest}
    restart: unless-stopped
    env_file: .env
    environment:
      MAPSLIBVN_IN_CONTAINER: "1"
      POSTGRES_HOST: postgres
      POSTGRES_USER: mapslibvn
      POSTGRES_PASSWORD: ${POSTGRES_SUPER_PASSWORD}
      POSTGRES_DB: mapslibvn
      POSTGRES_SSL: require
    command: ["node", "infra/server/backup/backup.mjs", "--daemon"]
    # backup dùng superuser để pg_dump trọn DB (kể cả poi_edit, tenant, api_key)
    volumes:
      - backup-tmp:/app/work
    depends_on:
      postgres:
        condition: service_healthy

  pipeline:
    image: ${PIPELINE_IMAGE:-ghcr.io/dotienphong/mapslibvn-pipeline:latest}
    restart: unless-stopped
    env_file: .env
    environment:
      MAPSLIBVN_IN_CONTAINER: "1"
      MAPSLIBVN_WORK: /app/work
      MAPSLIBVN_OUT: /app/out
      POSTGRES_HOST: postgres
      POSTGRES_USER: pipeline
      POSTGRES_PASSWORD: ${PIPELINE_PASSWORD}
      POSTGRES_DB: mapslibvn
      POSTGRES_SSL: require
      JAVA_OPTS: -Xmx4g
      NODE_OPTIONS: --max-old-space-size=4096
    command: ["node", "scripts/cron.mjs"]
    volumes:
      - pipeline-work:/app/work
      - pipeline-out:/app/out
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  pgdata:
  pgcerts:
  pipeline-work:
  pipeline-out:
  backup-tmp:
```

`infra/server/.gitignore`:
```
.env
```

`infra/server/.env.example`: nội dung đúng bằng output của `renderServerEnv({ superPassword: 'DOI_TOI', apiPassword: 'DOI_TOI', pipelinePassword: 'DOI_TOI', sharedBuffers: '2048MB', tunnelToken: '', pipelineImage: 'ghcr.io/dotienphong/mapslibvn-pipeline:latest' })` — tạo bằng:

Run: `node -e "import('./scripts/lib/server-env.mjs').then(m => process.stdout.write(m.renderServerEnv({superPassword:'DOI_TOI',apiPassword:'DOI_TOI',pipelinePassword:'DOI_TOI',sharedBuffers:'2048MB',tunnelToken:'',pipelineImage:'ghcr.io/dotienphong/mapslibvn-pipeline:latest'})))" > infra/server/.env.example`
Expected: file có 24 dòng, bắt đầu bằng `# Bí mật máy chủ`, có `RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true`.

- [ ] **Step 4: Bổ sung công cụ máy chủ vào image pipeline**

Sửa `pipelines/Dockerfile`, stage `tools`: thêm `postgresql-client-16 zstd` vào dòng `apt-get install` đầu tiên, và thêm khối `cloudflared` ngay sau khối DuckDB:

```dockerfile
# cloudflared (Apache-2.0) — `cloudflared access tcp` khi chạy data:update/db:restore từ máy dev qua Tunnel
ARG CLOUDFLARED_VERSION=2026.8.2
RUN ARCH="$(dpkg --print-architecture)"; \
    curl -fsSL --retry 5 --retry-all-errors -o /usr/local/bin/cloudflared \
      "https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-${ARCH}" \
    && chmod +x /usr/local/bin/cloudflared
```

Stage `app` (thay toàn bộ, gồm build `@mapslibvn/core` để pipeline POI import được):
```dockerfile
FROM tools AS app
WORKDIR /app
ENV MAPSLIBVN_IN_CONTAINER=1 MAPSLIBVN_WORK=/app/work MAPSLIBVN_OUT=/app/out
COPY . .
RUN pnpm install --frozen-lockfile --filter . --filter "./pipelines/*" --filter "@mapslibvn/style" --filter "@mapslibvn/core" \
    && pnpm --filter @mapslibvn/core build \
    && node packages/style/scripts/build.mjs
CMD ["node", "--version"]
```

`.dockerignore` phải là (stage `app` cần `packages/` và `db/`; M1b Task 3 cũng sửa file này — nội dung cuối cùng thống nhất như sau):
```
node_modules
**/node_modules
.git
.turbo
**/dist
**/.astro
work
out
.env
.wrangler
packages/style/assets/fonts
pipelines/tiles/fixtures
pipelines/poi/fixtures
```
Nếu `packages/core` hoặc `packages/style` chưa tồn tại (chưa làm M1b), tạm giữ stage `app` hiện tại và chỉ thêm khối `cloudflared` + apt; quay lại thay stage `app` khi làm Task 5.

Thêm vào `SMOKE` trong `scripts/image.mjs` ba mục: `'pg_dump --version'`, `'zstd --version'`, `'cloudflared --version'`.

Run: `pnpm image:build && pnpm image:smoke`
Expected: build dùng cache cho tippecanoe; smoke in thêm `pg_dump (PostgreSQL) 16.x`, `*** zstd command line interface …`, `cloudflared version 2026.8.2`. Nếu tag cloudflared không tồn tại: `curl -sI https://github.com/cloudflare/cloudflared/releases/latest | grep -i location` lấy tag mới nhất, sửa ARG, ghi DEVLOG.

- [ ] **Step 5: `backup.mjs` và `cron.mjs`**

`infra/server/backup/backup.mjs`:
```js
#!/usr/bin/env node
// pg_dump -Fc | zstd → R2 backups/daily (giữ 7) và backups/weekly vào Chủ nhật (giữ 4). Dùng: --once | --daemon
import 'dotenv/config';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { backupName, retentionPlan } from '../../../scripts/lib/backup-plan.mjs';
import { databaseUrlFromEnv } from '../../../scripts/lib/migrations.mjs';
import { run, sleep } from '../../../scripts/lib/run.mjs';
import { nextRun } from '../../../scripts/lib/schedule.mjs';

const bucket = process.env.R2_BUCKET ?? 'mapslibvn-tiles';
const work = process.env.MAPSLIBVN_WORK ?? resolve('work');

/** @param {string} prefix */
function listNames(prefix) {
  try {
    const json = execFileSync('rclone', ['lsjson', `r2:${bucket}/${prefix}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return /** @type {{ Name: string }[]} */ (JSON.parse(json)).map((e) => e.Name);
  } catch {
    return [];
  }
}

async function backupOnce(now = new Date()) {
  mkdirSync(work, { recursive: true });
  const name = backupName(now);
  const file = resolve(work, name);
  const dump = spawnSync('sh', ['-c', `pg_dump -Fc --no-owner --no-privileges "$DATABASE_URL" | zstd -T0 -3 -q -f -o "${file}"`], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrlFromEnv(process.env) },
  });
  if (dump.status !== 0) throw new Error(`pg_dump/zstd thoát mã ${dump.status}`);
  const mb = (statSync(file).size / 2 ** 20).toFixed(1);
  run('rclone', ['copyto', file, `r2:${bucket}/backups/daily/${name}`]);
  const vnWeekday = new Date(now.getTime() + 7 * 3600 * 1000).getUTCDay();
  if (vnWeekday === 0) run('rclone', ['copyto', file, `r2:${bucket}/backups/weekly/${name}`]);
  rmSync(file, { force: true });
  const plan = retentionPlan(
    { daily: listNames('backups/daily'), weekly: listNames('backups/weekly') },
    { keepDaily: 7, keepWeekly: 4 },
  );
  for (const n of plan.deleteDaily) run('rclone', ['deletefile', `r2:${bucket}/backups/daily/${n}`]);
  for (const n of plan.deleteWeekly) run('rclone', ['deletefile', `r2:${bucket}/backups/weekly/${n}`]);
  console.log(`✓ backup ${name} (${mb} MB) → r2:${bucket}/backups/daily — xoá ${plan.deleteDaily.length + plan.deleteWeekly.length} bản cũ`);
}

const mode = process.argv[2] ?? '--once';
if (mode === '--once') {
  await backupOnce();
} else if (mode === '--daemon') {
  for (;;) {
    const at = nextRun(new Date(), { hour: 3, minute: 0 });
    console.log(`[backup] lần kế tiếp ${at.toISOString()} (03:00 giờ VN)`);
    await sleep(at.getTime() - Date.now());
    try {
      await backupOnce();
    } catch (e) {
      console.error('[backup] LỖI', e);
    }
  }
} else {
  console.error('Dùng: node infra/server/backup/backup.mjs --once | --daemon');
  process.exit(2);
}
```

`scripts/cron.mjs`:
```js
#!/usr/bin/env node
// Lịch trong container `pipeline` trên máy chủ: thứ Hai 02:00 giờ VN chạy data:update. Khoá file tránh chạy chồng.
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { run, sleep } from './lib/run.mjs';
import { nextRun } from './lib/schedule.mjs';

const lock = resolve(process.env.MAPSLIBVN_WORK ?? 'work', 'data-update.lock');
const schedule = { hour: 2, minute: 0, weekday: 1 };
if (existsSync(lock)) {
  console.warn(`[cron] xoá khoá cũ ${lock} (container vừa khởi động lại)`);
  rmSync(lock, { force: true });
}
for (;;) {
  const at = nextRun(new Date(), schedule);
  console.log(`[cron] data:update kế tiếp ${at.toISOString()} (thứ Hai 02:00 VN)`);
  await sleep(at.getTime() - Date.now());
  writeFileSync(lock, String(process.pid));
  try {
    run(process.execPath, ['scripts/data-update.mjs']);
  } catch (e) {
    console.error('[cron] data:update LỖI', e);
  } finally {
    rmSync(lock, { force: true });
  }
}
```

Thêm vào `tsconfig.scripts.json` → `"include": ["scripts/**/*.mjs", "infra/server/backup/*.mjs", "vitest.config.ts", "vitest.db.config.ts"]`.

Run: `pnpm typecheck`
Expected: không lỗi.

- [ ] **Step 6: `server-setup.mjs` và `server-update.mjs`**

`scripts/server-setup.mjs`:
```js
#!/usr/bin/env node
// Dựng máy chủ nội bộ 24/7 bằng một lệnh (spec 11.1). Chạy trên máy chủ, từ gốc repo đã clone.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { totalmem } from 'node:os';
import { resolve } from 'node:path';
import { capture, run, sleep } from './lib/run.mjs';
import { generatePassword, parseEnv, renderServerEnv, sharedBuffersFor } from './lib/server-env.mjs';
import { checkNodeVersion, isPostgresReady, parseDockerVersion, waitPlan } from './lib/setup-checks.mjs';

const dir = resolve('infra/server');
const envPath = resolve(dir, '.env');
const compose = ['compose', '--env-file', envPath, '-f', resolve(dir, 'compose.yml')];
const CERTS_VOLUME = 'mapslibvn-server_pgcerts';
const step = (/** @type {string} */ msg) => console.log(`\n▶ ${msg}`);

step('Kiểm tra Node và Docker');
if (!checkNodeVersion(process.version).ok) {
  console.error(`Cần Node ≥ 22, đang có ${process.version}`);
  process.exit(1);
}
if (!parseDockerVersion(capture('docker', ['--version'])) || !capture('docker', ['info', '--format', '{{.ServerVersion}}'])) {
  console.error('Docker chưa cài hoặc daemon chưa chạy.');
  process.exit(1);
}

step('Tạo infra/server/.env');
if (!existsSync(envPath)) {
  writeFileSync(
    envPath,
    renderServerEnv({
      superPassword: generatePassword(32),
      apiPassword: generatePassword(32),
      pipelinePassword: generatePassword(32),
      sharedBuffers: sharedBuffersFor(totalmem()),
      tunnelToken: '',
      pipelineImage: process.env.PIPELINE_IMAGE ?? 'ghcr.io/dotienphong/mapslibvn-pipeline:latest',
    }),
  );
  console.log(`Đã sinh ${envPath} với mật khẩu ngẫu nhiên — SAO LƯU file này vào password manager.`);
} else {
  console.log('.env đã có — giữ nguyên.');
}
const env = parseEnv(readFileSync(envPath, 'utf8'));

step('Chứng chỉ TLS tự ký cho Postgres (volume pgcerts, 10 năm)');
if (!capture('docker', ['run', '--rm', '-v', `${CERTS_VOLUME}:/certs`, 'alpine:3.20', 'sh', '-c', 'ls /certs/server.key 2>/dev/null'])) {
  run('docker', [
    'run', '--rm', '-v', `${CERTS_VOLUME}:/certs`, 'alpine:3.20', 'sh', '-c',
    'apk add --no-cache openssl >/dev/null && openssl req -x509 -newkey rsa:4096 -nodes -days 3650 -subj /CN=maps-db.mapslibvn.local -keyout /certs/server.key -out /certs/server.crt && chown 999:999 /certs/server.key /certs/server.crt && chmod 600 /certs/server.key',
  ]);
  console.log('Đã sinh server.crt / server.key.');
} else {
  console.log('Chứng chỉ đã có.');
}

step(`Image ${env.PIPELINE_IMAGE}`);
// Kéo bản mới nếu registry có; image chỉ có local (mapslibvn/pipeline:local khi thử trên máy dev) thì bỏ qua pull.
const pulled = spawnSync('docker', ['pull', env.PIPELINE_IMAGE], { stdio: 'inherit' }).status === 0;
if (!pulled && !capture('docker', ['image', 'inspect', '--format', '{{.Id}}', env.PIPELINE_IMAGE])) {
  console.error(`Không kéo được và không có sẵn image ${env.PIPELINE_IMAGE}. Đăng nhập GHCR (README) hoặc đặt PIPELINE_IMAGE trong infra/server/.env.`);
  process.exit(1);
}

step('Khởi động dịch vụ');
const services = ['postgres', 'backup', 'pipeline'];
if (env.TUNNEL_TOKEN) services.push('cloudflared');
else console.warn('TUNNEL_TOKEN trống → chưa chạy cloudflared. Điền token vào infra/server/.env rồi chạy lại pnpm server:setup.');
run('docker', [...compose, 'up', '-d', ...services]);

step('Chờ Postgres sẵn sàng');
const plan = waitPlan(120_000, 3_000);
let ready = false;
for (let i = 0; i < plan.attempts && !ready; i++) {
  ready = isPostgresReady(
    capture('docker', [...compose, 'exec', '-T', 'postgres', 'cat', '/proc/1/comm']),
    capture('docker', [...compose, 'exec', '-T', 'postgres', 'pg_isready', '-U', 'mapslibvn']),
  );
  if (!ready) await sleep(plan.intervalMs);
}
if (!ready) {
  console.error('Postgres không sẵn sàng sau 120 giây. Xem: docker compose -f infra/server/compose.yml logs postgres');
  process.exit(1);
}

step('Migration (superuser, trong image pipeline)');
run('docker', [...compose, 'run', '--rm', '-e', 'POSTGRES_USER=mapslibvn', '-e', `POSTGRES_PASSWORD=${env.POSTGRES_SUPER_PASSWORD}`, 'pipeline', 'node', 'scripts/db-migrate.mjs']);

step('Đồng bộ mật khẩu role api / pipeline (idempotent)');
run('docker', [...compose, 'exec', '-T', '-e', `API_PASSWORD=${env.API_PASSWORD}`, '-e', `PIPELINE_PASSWORD=${env.PIPELINE_PASSWORD}`, 'postgres', 'sh', '/docker-entrypoint-initdb.d/10-roles.sh']);

step('Kiểm tra TLS');
console.log(capture('docker', [...compose, 'exec', '-T', 'postgres', 'psql', '-U', 'mapslibvn', '-d', 'mapslibvn', '-tAc', 'SHOW ssl']) === 'on' ? 'ssl = on' : 'CẢNH BÁO: ssl chưa bật');

console.log(`
✔ Máy chủ đã dựng (${services.join(', ')}).

Việc tay trên Cloudflare — chi tiết từng màn hình trong infra/server/README.md:
  1. Zero Trust → Networks → Tunnels → Create tunnel "mapslibvn-db" → copy token → TUNNEL_TOKEN trong infra/server/.env → chạy lại pnpm server:setup.
  2. Tunnel → Public Hostname: maps-db.<domain> → Service: tcp://postgres:5432.
  3. Zero Trust → Access → Service Auth → Service Token "hyperdrive" (lưu Client ID/Secret).
  4. Access → Applications → Self-hosted "mapslibvn-db", domain maps-db.<domain>, Policy "Service Auth" chọn token trên.
  5. Workers & Pages → Hyperdrive → Create: name mapslibvn-db, host maps-db.<domain>, port 5432, database mapslibvn,
     user api, password = API_PASSWORD, bật "Connect via Cloudflare Access" với Client ID/Secret → copy Hyperdrive ID vào apps/api/wrangler.toml.
`);
```

`scripts/server-update.mjs`:
```js
#!/usr/bin/env node
// Cập nhật máy chủ: mã mới, image mới, compose up, migration (spec 11.1 pnpm server:update)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from './lib/run.mjs';
import { parseEnv } from './lib/server-env.mjs';

const dir = resolve('infra/server');
const env = parseEnv(readFileSync(resolve(dir, '.env'), 'utf8'));
const compose = ['compose', '--env-file', resolve(dir, '.env'), '-f', resolve(dir, 'compose.yml')];

run('git', ['pull', '--ff-only']);
run('docker', [...compose, 'pull']);
run('docker', [...compose, 'up', '-d', '--remove-orphans']);
run('docker', [...compose, 'run', '--rm', '-e', 'POSTGRES_USER=mapslibvn', '-e', `POSTGRES_PASSWORD=${env.POSTGRES_SUPER_PASSWORD}`, 'pipeline', 'node', 'scripts/db-migrate.mjs']);
console.log('✔ server:update xong');
```

- [ ] **Step 7: `infra/server/README.md` — checklist việc tay và cách kiểm tra**

````markdown
# Máy chủ nội bộ MapsLibVN (spec 11.1)

Máy ≥ 8 GB RAM, SSD ≥ 50 GB, Docker (Linux ưu tiên; macOS qua Docker Desktop; Windows qua WSL2 và tắt chế độ ngủ). Không dùng laptop làm việc. Khuyến nghị UPS.

## Dựng lần đầu

```bash
git clone git@github.com-dotienphong:dotienphong/maps-library-vietnam.git && cd maps-library-vietnam
corepack enable && pnpm install
echo "<PAT ghcr read:packages>" | docker login ghcr.io -u dotienphong --password-stdin   # image GHCR là private
pnpm server:setup
```

`server:setup` sinh `infra/server/.env` (mật khẩu superuser/api/pipeline, `PG_SHARED_BUFFERS` = 25% RAM), chứng chỉ TLS tự ký trong volume `pgcerts`, kéo image, `docker compose up -d`, chạy migration, in checklist. Điền thêm vào `infra/server/.env` các biến Cloudflare/R2 (copy từ `.env` máy dev) để `backup` và `pipeline` đẩy lên R2.

## Việc tay trên Cloudflare (một lần)

1. **Tunnel**: Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared → tên `mapslibvn-db` → copy **token** → `TUNNEL_TOKEN=` trong `infra/server/.env` → `pnpm server:setup` (lần này chạy thêm `cloudflared`). Tab Public Hostname: subdomain `maps-db`, domain `<domain>`, Service type **TCP**, URL `postgres:5432`.
2. **Service token**: Zero Trust → Access → Service Auth → Create Service Token `hyperdrive` (thời hạn dài nhất) → lưu **Client ID** và **Client Secret**.
3. **Access application**: Access → Applications → Add → Self-hosted → tên `mapslibvn-db`, domain `maps-db.<domain>` → Policy: action **Service Auth**, include "Service Token" = `hyperdrive`.
4. **Hyperdrive**: Workers & Pages → Hyperdrive → Create configuration → tên `mapslibvn-db`; host `maps-db.<domain>`, port `5432`, database `mapslibvn`, user `api`, password `API_PASSWORD` (trong `infra/server/.env`); mở "Connect via Cloudflare Access" → dán Client ID/Secret; SSL mode `require`. Copy **Hyperdrive ID** → `apps/api/wrangler.toml` (`[[hyperdrive]] id` và `env.production.hyperdrive`).
5. Tuỳ chọn cảnh báo: Zero Trust → Networks → Tunnels → `mapslibvn-db` → Notifications → email khi tunnel down (spec 11.3).

## Kiểm tra

- Trạng thái: `docker compose --env-file infra/server/.env -f infra/server/compose.yml ps` — 4 dịch vụ `running`, `postgres` `healthy`.
- TLS bắt buộc từ ngoài: chạy trên **máy dev** (không cần mở cổng):
  ```bash
  PIPE pipeline sh -c 'cloudflared access tcp --hostname maps-db.<domain> --url 127.0.0.1:5433 \
     --service-token-id "$CF_ACCESS_CLIENT_ID" --service-token-secret "$CF_ACCESS_CLIENT_SECRET" & sleep 4; \
     psql "postgres://api:<API_PASSWORD>@127.0.0.1:5433/mapslibvn?sslmode=require" -c "select current_user, ssl from pg_stat_ssl where pid = pg_backend_pid()"'
  ```
  Kỳ vọng: `api | t`. Với `sslmode=disable` phải bị từ chối (`no pg_hba.conf entry … SSL off`).
- Worker: `cd apps/api && pnpm exec wrangler dev --remote` → `curl localhost:8787/healthz/db` → `{"ok":true,"user":"api",…}`.
- Backup tay: `docker compose --env-file infra/server/.env -f infra/server/compose.yml exec backup node infra/server/backup/backup.mjs --once` → `rclone ls r2:mapslibvn-tiles/backups/daily` có file.
- Cron: `docker compose … logs pipeline | tail -2` → `data:update kế tiếp <ISO> (thứ Hai 02:00 VN)`.

## Vận hành

- Cập nhật mã/image: `pnpm server:update`.
- Chuyển máy: trên máy mới `pnpm server:setup` → `PIPE pipeline node scripts/db-restore.mjs --latest` (Task 10) → dán lại `TUNNEL_TOKEN` (hoặc tạo tunnel mới rồi trỏ hostname) → xong < 1 giờ.
- Log: `docker compose … logs -f postgres|cloudflared|backup|pipeline`.
- Không bao giờ thêm `ports:` cho `postgres`. Mọi truy cập đi qua Tunnel + Access.
````

- [ ] **Step 8: Chạy `pnpm server:setup` trên máy dev (G3: máy chủ tạm) với `PIPELINE_IMAGE=mapslibvn/pipeline:local`**

Trước khi chạy: tắt chế độ ngủ của máy (macOS: System Settings → Displays → Advanced → "Prevent automatic sleeping"; hoặc `caffeinate -s` trong một terminal riêng). Compose server (`mapslibvn-server`) và compose dev (`mapslibvn-dev`) chạy song song — không xung đột cổng vì Postgres server không mở `ports:`.

Run: `pnpm server:setup`
Expected: các bước ▶ OK; `[db:migrate] Áp dụng 0001_extensions.sql` (các migration 0002–0005 xuất hiện sau Task 2 — chạy lại `server:setup` khi đó); `ssl = on`; checklist in ra.

Run: `docker compose --env-file infra/server/.env -f infra/server/compose.yml exec -T postgres psql -U mapslibvn -d mapslibvn -tAc "select rolname, rolcanlogin from pg_roles where rolname in ('api','pipeline') order by 1"`
Expected: `api|t` và `pipeline|t`.

Run: `docker compose --env-file infra/server/.env -f infra/server/compose.yml exec -T postgres sh -c 'PGPASSWORD=$API_PASSWORD psql "postgres://api@127.0.0.1:5432/mapslibvn?sslmode=require" -tAc "select ssl from pg_stat_ssl where pid = pg_backend_pid()"'`
Expected: `t`.

Run: `docker compose --env-file infra/server/.env -f infra/server/compose.yml exec -T postgres sh -c 'PGPASSWORD=$API_PASSWORD psql "postgres://api@127.0.0.1:5432/mapslibvn?sslmode=disable" -c "select 1"'`
Expected: **bị từ chối** — `FATAL: pg_hba.conf rejects connection … SSL off`. Đây là phép thử chứng minh TLS bắt buộc thật (không chỉ trên README).

Run: `docker compose --env-file infra/server/.env -f infra/server/compose.yml exec -T backup node infra/server/backup/backup.mjs --once`
Expected: `✓ backup mapslibvn-YYYYMMDD-HHMM.dump.zst (N MB) → r2:…/backups/daily` (cần biến R2 trong `infra/server/.env`; nếu chưa điền, lệnh báo lỗi rclone — điền rồi chạy lại).

**Thử phục hồi ngay (không đợi Task 10)** — chứng minh lời hứa "chuyển máy < 1 giờ" và lộ sớm lỗi PostGIS khi restore. Phục hồi vào **DB mới** trong cùng container (không `--clean` lên DB đang chạy — `spatial_ref_sys` là bảng cấu hình của extension, restore trùng khoá):
```bash
C="docker compose --env-file infra/server/.env -f infra/server/compose.yml"
F=$($C exec -T backup rclone lsf r2:mapslibvn-tiles/backups/daily | sort | tail -1)
$C exec -T postgres psql -U mapslibvn -d postgres -c "DROP DATABASE IF EXISTS restore_smoke" -c "CREATE DATABASE restore_smoke"
$C exec -T backup sh -c "rclone cat r2:mapslibvn-tiles/backups/daily/$F | zstd -dc | pg_restore --no-owner --no-privileges -d \"\$(echo \$DATABASE_URL | sed s#/mapslibvn#/restore_smoke#)\"" \
  || echo "pg_restore có cảnh báo — xem dòng lỗi; lỗi về extension postgis đã tồn tại là chấp nhận được"
$C exec -T postgres psql -U mapslibvn -d restore_smoke -tAc "select count(*) from schema_migrations"
$C exec -T postgres psql -U mapslibvn -d postgres -c "DROP DATABASE restore_smoke"
```
Expected: dòng cuối trả số migration đã áp dụng (= số file trong `db/migrations` lúc đó). Nếu pg_restore lỗi thật (không phải cảnh báo extension): sửa `backup.mjs` (ví dụ thêm `--exclude-table-data=spatial_ref_sys`) **trước khi** đi tiếp — Task 10 `db-restore.mjs` dùng đúng cách phục hồi vào DB mới này.

- [ ] **Step 9: Việc tay Cloudflare + kiểm psql qua Tunnel**

PHONG làm mục 1–4 trong README. Thêm vào `.env` máy dev (và `.env.example` với giá trị trống):
```
# ---- Máy chủ nội bộ qua Tunnel (M2) — dùng khi chạy data:update / db:restore từ máy dev ----
DB_TUNNEL_HOSTNAME=
CF_ACCESS_CLIENT_ID=
CF_ACCESS_CLIENT_SECRET=
PIPELINE_DATABASE_URL=
```
(`PIPELINE_DATABASE_URL` = `postgres://pipeline:<PIPELINE_PASSWORD>@127.0.0.1:5433/mapslibvn?sslmode=require`.)

Run lệnh "TLS bắt buộc từ ngoài" trong README.
Expected: `api | t`.

- [ ] **Step 10: Worker `/healthz/db` qua Hyperdrive**

> **Trình tự bắt buộc:** `deploy-api.yml` tự deploy production mỗi push chạm `apps/api/**`. Nếu commit `wrangler.toml` với `id = "DIEN_HYPERDRIVE_ID"` trước khi PHONG tạo Hyperdrive, **mọi lần Deploy API sẽ đỏ**. Làm Step 9 (PHONG tạo Tunnel/Access/Hyperdrive, có ID thật) xong mới sửa `wrangler.toml`, kiểm local, rồi commit một lần cùng Step 11.

`apps/api/package.json` → dependencies thêm `"postgres": "^3.4.5"`. Run: `pnpm install`.

`apps/api/src/env.ts`:
```ts
export interface Env {
  META: KVNamespace;
  TILES: R2Bucket;
  DB: Hyperdrive;
  TILES_BASE: string;
  ENVIRONMENT: string;
}
```

`apps/api/src/db.ts`:
```ts
import postgres from 'postgres';
import type { Env } from './env';

/** Client Postgres qua Hyperdrive (pool nằm phía Cloudflare). Gọi sql.end() cuối request. */
export function getSql(env: Env) {
  return postgres(env.DB.connectionString, { max: 5, fetch_types: false, prepare: false, connect_timeout: 5 });
}
```

Thêm vào `apps/api/src/index.ts` (sau route `/healthz`):
```ts
app.get('/healthz/db', async (c) => {
  const sql = getSql(c.env);
  try {
    const [row] = await sql<{ ok: number; user: string; version: string }[]>`SELECT 1 AS ok, current_user AS "user", version() AS version`;
    return c.json({ ok: row?.ok === 1, user: row?.user, version: row?.version.split(' ').slice(0, 2).join(' ') });
  } catch (err) {
    console.error('healthz/db', err);
    throw new ApiError(503, 'upstream_unavailable', 'Không nối được DB');
  } finally {
    c.executionCtx.waitUntil(sql.end({ timeout: 1 }));
  }
});
```
và `import { getSql } from './db';`.

`apps/api/wrangler.toml` — thêm:
```toml
[[hyperdrive]]
binding = "DB"
id = "DIEN_HYPERDRIVE_ID"
localConnectionString = "postgres://mapslibvn:mapslibvn@localhost:5432/mapslibvn"
```
và trong `[env.production]`: `hyperdrive = [{ binding = "DB", id = "DIEN_HYPERDRIVE_ID" }]`. Thay `DIEN_HYPERDRIVE_ID` bằng ID thật (2 chỗ).

Run: `pnpm --filter @mapslibvn/api test`
Expected: các test cũ vẫn xanh (binding Hyperdrive local trỏ Postgres dev; nếu Miniflare báo không nối được khi khởi tạo, thêm `hyperdrives: { DB: 'postgres://mapslibvn:mapslibvn@localhost:5432/mapslibvn' }` vào `miniflare` trong `apps/api/vitest.config.ts` và đảm bảo `pnpm db:up` đang chạy).

Run: `cd apps/api && pnpm exec wrangler dev --port 8787` (terminal khác: `curl -s localhost:8787/healthz/db`)
Expected: `{"ok":true,"user":"mapslibvn","version":"PostgreSQL 16.x"}` (Postgres dev qua localConnectionString).

Run: `cd apps/api && pnpm exec wrangler dev --remote --port 8787` rồi `curl -s localhost:8787/healthz/db`
Expected: `{"ok":true,"user":"api","version":"PostgreSQL 16.x"}` — **nghiệm thu Task 1** (Worker → Hyperdrive → Access → Tunnel → máy nội bộ).

Run: `cd apps/api && pnpm exec wrangler deploy --env production && curl -s https://mapslibvn-api-production.<account>.workers.dev/healthz/db`
Expected: cùng kết quả.

- [ ] **Step 11: Lint, typecheck, DEVLOG, commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: xanh.

Sửa `docs/DEVLOG.md`: mục 1 "Môi trường đã dựng: … máy chủ nội bộ (postgres TLS, cloudflared, backup, cron), Tunnel maps-db.<domain>, Hyperdrive mapslibvn-db"; "Task đang làm: Task 2"; mục 3 nếu đổi tag cloudflared/openssl; mục 4 dòng `M2 T1` kèm thời gian `server:setup`.

```bash
git add -A
git commit -m "feat(infra): máy chủ nội bộ một lệnh — postgres TLS, cloudflared, backup R2, cron; Worker /healthz/db qua Hyperdrive"
git push
```

---

### Task 2: Migration kho POI (0002–0005) + `db:migrate --down` + test lược đồ

**Files:**
- Create: `db/migrations/0002_sources.sql`, `0002_sources.down.sql`, `0003_core.sql`, `0003_core.down.sql`, `0004_geocode.sql`, `0004_geocode.down.sql`, `0005_tenant.sql`, `0005_tenant.down.sql`, `db/schema.dbtest.mjs`
- Modify: `scripts/lib/migrations.mjs`, `scripts/lib/migrations.test.mjs`, `scripts/db-migrate.mjs`
- Create: `.github/workflows/dbtest.yml`

- [ ] **Step 1: Test hàm thuần cho `.down.sql` (thất bại)**

Thêm vào `scripts/lib/migrations.test.mjs`:
```js
import { databaseUrlFromEnv, downFileFor, lastApplied, pendingMigrations } from './migrations.mjs';

describe('pendingMigrations bỏ qua file .down.sql', () => {
  it('không coi 0002_x.down.sql là migration', () => {
    expect(pendingMigrations([], ['0002_x.sql', '0002_x.down.sql'])).toEqual(['0002_x.sql']);
  });
});

describe('lastApplied / downFileFor', () => {
  it('lấy migration cuối theo tên và tên file down tương ứng', () => {
    expect(lastApplied(['0001_a.sql', '0003_c.sql', '0002_b.sql'])).toBe('0003_c.sql');
    expect(lastApplied([])).toBeNull();
    expect(downFileFor('0003_c.sql')).toBe('0003_c.down.sql');
  });
});

describe('databaseUrlFromEnv với POSTGRES_SSL', () => {
  it('POSTGRES_SSL=require → thêm ?sslmode=require; DATABASE_URL giữ nguyên', () => {
    expect(databaseUrlFromEnv({ POSTGRES_SSL: 'require' })).toBe('postgres://mapslibvn:mapslibvn@localhost:5432/mapslibvn?sslmode=require');
    expect(databaseUrlFromEnv({})).toBe('postgres://mapslibvn:mapslibvn@localhost:5432/mapslibvn');
    expect(databaseUrlFromEnv({ DATABASE_URL: 'postgres://x', POSTGRES_SSL: 'require' })).toBe('postgres://x');
  });
});
```
(Gộp import với dòng import sẵn có.)

Run: `pnpm test`
Expected: FAIL — `lastApplied is not a function` / test `.down.sql` đỏ.

- [ ] **Step 2: Sửa `migrations.mjs` và `db-migrate.mjs`**

`scripts/lib/migrations.mjs` — thay `MIGRATION_FILE` và thêm hai hàm:
```js
const MIGRATION_FILE = /^\d{4}_.+\.sql$/;
const DOWN_FILE = /\.down\.sql$/;

export function pendingMigrations(applied, files) {
  const done = new Set(applied);
  return [...files].filter((file) => MIGRATION_FILE.test(file) && !DOWN_FILE.test(file) && !done.has(file)).sort();
}

/** @param {string[]} applied @returns {string | null} */
export function lastApplied(applied) {
  return applied.length ? [...applied].sort().at(-1) ?? null : null;
}

/** @param {string} name */
export function downFileFor(name) {
  return name.replace(/\.sql$/, '.down.sql');
}
```
`databaseUrlFromEnv` thêm TLS theo biến môi trường (compose máy chủ đặt `POSTGRES_SSL=require` cho backup/pipeline vì `pg_hba` từ chối kết nối không TLS; client `postgres` mặc định **không** dùng TLS):
```js
export function databaseUrlFromEnv(env) {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const user = env.POSTGRES_USER ?? 'mapslibvn';
  const password = env.POSTGRES_PASSWORD ?? 'mapslibvn';
  const host = env.POSTGRES_HOST ?? 'localhost';
  const port = env.POSTGRES_PORT ?? '5432';
  const database = env.POSTGRES_DB ?? 'mapslibvn';
  const ssl = env.POSTGRES_SSL === 'require' ? '?sslmode=require' : '';
  return `postgres://${user}:${password}@${host}:${port}/${database}${ssl}`;
}
```

`scripts/db-migrate.mjs` — thêm nhánh `--down` (revert đúng một migration cuối) trước vòng lặp áp dụng:
```js
import { databaseUrlFromEnv, downFileFor, lastApplied, pendingMigrations } from './lib/migrations.mjs';
// … sau khi tạo bảng schema_migrations và đọc `applied`:
if (process.argv.includes('--down')) {
  const last = lastApplied(applied);
  if (!last) {
    console.log('[db:migrate] Không có migration nào để revert.');
  } else {
    const down = downFileFor(last);
    const body = readFileSync(resolve(dir, down), 'utf8'); // ném lỗi nếu thiếu file down — đúng ý: không revert mù
    console.log(`[db:migrate] Revert ${last} bằng ${down} …`);
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`DELETE FROM schema_migrations WHERE name = ${last}`;
    });
    console.log('[db:migrate] Xong — revert 1 migration.');
  }
  await sql.end();
  process.exit(0);
}
```

Run: `pnpm test`
Expected: xanh.

- [ ] **Step 3: Migration 0002 — roles + bảng nguồn**

`db/migrations/0002_sources.sql`:
```sql
-- Roles ứng dụng (spec 9): tạo NOLOGIN để GRANT chạy được ở dev; máy chủ đặt mật khẩu + LOGIN (init-roles.sh)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api') THEN CREATE ROLE api NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pipeline') THEN CREATE ROLE pipeline NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO api, pipeline;
GRANT CREATE ON SCHEMA public TO pipeline;

-- Bảng nguồn bất biến (spec 5.2): chỉ pipeline ghi; mỗi lần nạp thay toàn bộ theo release (bảng _new → hoán đổi)
CREATE TABLE IF NOT EXISTS src_osm_place (
  osm_type char(1) NOT NULL CHECK (osm_type IN ('n', 'w', 'r')),
  osm_id   bigint  NOT NULL,
  name     text,
  names    jsonb,
  tags     jsonb NOT NULL,
  geom     geometry(Point, 4326) NOT NULL,
  release  date NOT NULL,
  PRIMARY KEY (osm_type, osm_id)
);
CREATE INDEX IF NOT EXISTS src_osm_place_geom_idx ON src_osm_place USING gist (geom);

CREATE TABLE IF NOT EXISTS src_overture_place (
  id         text PRIMARY KEY,
  name       text,
  names      jsonb,
  category   text,
  categories jsonb,
  confidence real,
  addresses  jsonb,
  websites   text[],
  phones     text[],
  sources    jsonb,
  geom       geometry(Point, 4326) NOT NULL,
  release    text NOT NULL
);
CREATE INDEX IF NOT EXISTS src_overture_place_geom_idx ON src_overture_place USING gist (geom);

CREATE TABLE IF NOT EXISTS src_fsq_place (
  fsq_place_id text PRIMARY KEY,
  name         text,
  categories   jsonb,
  address      text,
  locality     text,
  region       text,
  tel          text,
  website      text,
  date_closed  date,
  geom         geometry(Point, 4326) NOT NULL,
  release      date NOT NULL
);
CREATE INDEX IF NOT EXISTS src_fsq_place_geom_idx ON src_fsq_place USING gist (geom);

ALTER TABLE src_osm_place      OWNER TO pipeline;
ALTER TABLE src_overture_place OWNER TO pipeline;
ALTER TABLE src_fsq_place      OWNER TO pipeline;
GRANT SELECT ON src_osm_place, src_overture_place, src_fsq_place TO api;
```

`db/migrations/0002_sources.down.sql`:
```sql
DROP TABLE IF EXISTS src_fsq_place;
DROP TABLE IF EXISTS src_overture_place;
DROP TABLE IF EXISTS src_osm_place;
-- Không xoá role api/pipeline (có thể còn login trên máy chủ)
```

- [ ] **Step 4: Migration 0003 — taxonomy, poi, liên kết nguồn, đóng góp**

`db/migrations/0003_core.sql`:
```sql
CREATE TABLE IF NOT EXISTS category (
  code       text PRIMARY KEY,
  group_code text NOT NULL,
  name_vi    text NOT NULL,
  name_en    text NOT NULL,
  icon       text NOT NULL,
  rank       smallint NOT NULL DEFAULT 5          -- 1 = hiện sớm nhất theo zoom
);

CREATE TABLE IF NOT EXISTS category_map (
  source       text NOT NULL CHECK (source IN ('osm', 'overture', 'fsq')),
  source_value text NOT NULL,
  code         text NOT NULL REFERENCES category (code),
  PRIMARY KEY (source, source_value)
);

CREATE TABLE IF NOT EXISTS poi (
  id                text PRIMARY KEY,                       -- ULID từ hash(primary_source, primary_source_id) (spec 5.4.8)
  name              text NOT NULL,
  name_norm         text NOT NULL,
  name_alt          text[],
  category          text REFERENCES category (code),
  geom              geometry(Point, 4326) NOT NULL,
  housenumber       text,
  street            text,
  ward              text,
  province          text,
  address_text      text,
  contact           jsonb,                                  -- {phone[], website[], facebook}
  hours             jsonb,                                  -- {osm: "Mo-Su 07:00-22:00", …}
  primary_source    text,
  primary_source_id text,
  quality_score     smallint,
  popularity        real,
  status            text NOT NULL CHECK (status IN ('active', 'closed', 'pending', 'rejected')),
  locked_fields     text[] NOT NULL DEFAULT '{}',
  created_by        text NOT NULL CHECK (created_by IN ('pipeline', 'user')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS poi_geom_idx            ON poi USING gist (geom);
CREATE INDEX IF NOT EXISTS poi_name_norm_trgm_idx  ON poi USING gin (name_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS poi_status_category_idx ON poi (status, category);
CREATE INDEX IF NOT EXISTS poi_primary_source_idx  ON poi (primary_source, primary_source_id);

CREATE TABLE IF NOT EXISTS poi_source_link (
  poi_id     text NOT NULL REFERENCES poi (id) ON DELETE CASCADE,
  source     text NOT NULL CHECK (source IN ('osm', 'overture', 'fsq')),
  source_id  text NOT NULL,
  confidence real,
  role       text NOT NULL CHECK (role IN ('primary', 'secondary')),
  PRIMARY KEY (source, source_id)
);
CREATE INDEX IF NOT EXISTS poi_source_link_poi_idx ON poi_source_link (poi_id);

CREATE TABLE IF NOT EXISTS poi_edit (
  id            bigserial PRIMARY KEY,
  poi_id        text NULL REFERENCES poi (id),
  tenant_id     uuid,
  end_user_hash text,
  kind          text NOT NULL CHECK (kind IN ('create', 'update', 'close', 'reopen', 'report')),
  changes       jsonb,
  photo_url     text,
  note          text,
  status        text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'auto_approved')),
  reviewer      text,
  reviewed_at   timestamptz,
  ip_hash       text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS poi_edit_status_idx ON poi_edit (status, created_at);
CREATE INDEX IF NOT EXISTS poi_edit_poi_idx    ON poi_edit (poi_id);

ALTER TABLE category        OWNER TO pipeline;
ALTER TABLE category_map    OWNER TO pipeline;
ALTER TABLE poi             OWNER TO pipeline;
ALTER TABLE poi_source_link OWNER TO pipeline;
GRANT SELECT ON category, category_map, poi, poi_source_link, poi_edit TO api;
GRANT INSERT ON poi_edit TO api;                               -- Worker chỉ đọc + ghi đóng góp (spec 9)
GRANT USAGE, SELECT ON SEQUENCE poi_edit_id_seq TO api;
GRANT SELECT, UPDATE ON poi_edit TO pipeline;                  -- M4: áp dụng edit đã duyệt
```

`db/migrations/0003_core.down.sql`:
```sql
DROP TABLE IF EXISTS poi_edit;
DROP TABLE IF EXISTS poi_source_link;
DROP TABLE IF EXISTS poi;
DROP TABLE IF EXISTS category_map;
DROP TABLE IF EXISTS category;
```

- [ ] **Step 5: Migration 0004 — geocoding (mốc, đường, hẻm, hành chính)**

`db/migrations/0004_geocode.sql`:
```sql
CREATE TABLE IF NOT EXISTS admin_area (
  id              bigserial PRIMARY KEY,
  level           smallint NOT NULL,                       -- 4 tỉnh/thành, 6 quận/huyện (nếu OSM còn), 8 phường/xã
  name            text NOT NULL,
  name_norm       text NOT NULL,
  parent_id       bigint REFERENCES admin_area (id),
  osm_relation_id bigint UNIQUE,
  geom            geometry(MultiPolygon, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_area_geom_idx  ON admin_area USING gist (geom);
CREATE INDEX IF NOT EXISTS admin_area_level_idx ON admin_area (level, name_norm);

CREATE TABLE IF NOT EXISTS admin_alias (
  alias_norm    text NOT NULL,
  level         smallint NOT NULL,
  admin_area_id bigint NOT NULL REFERENCES admin_area (id) ON DELETE CASCADE,
  valid_until   date,
  PRIMARY KEY (alias_norm, level)
);

CREATE TABLE IF NOT EXISTS street (
  id            bigserial PRIMARY KEY,
  osm_way_ids   bigint[] NOT NULL,
  name          text NOT NULL,
  name_norm     text NOT NULL,
  ward_norm     text[] NOT NULL DEFAULT '{}',
  province_norm text,
  geom          geometry(MultiLineString, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS street_geom_idx      ON street USING gist (geom);
CREATE INDEX IF NOT EXISTS street_name_trgm_idx ON street USING gin (name_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS street_name_prov_idx ON street (name_norm, province_norm);

CREATE TABLE IF NOT EXISTS alley (
  id               bigserial PRIMARY KEY,
  osm_way_id       bigint NOT NULL UNIQUE,
  number           text NOT NULL,                          -- "112", "88A"
  parent_street_id bigint REFERENCES street (id) ON DELETE SET NULL,
  name             text,
  geom             geometry(LineString, 4326) NOT NULL,
  entrance         geometry(Point, 4326)
);
CREATE INDEX IF NOT EXISTS alley_geom_idx   ON alley USING gist (geom);
CREATE INDEX IF NOT EXISTS alley_parent_idx ON alley (parent_street_id, number);

CREATE TABLE IF NOT EXISTS address_anchor (
  id             bigserial PRIMARY KEY,
  housenumber    text NOT NULL,                            -- "88/9", "130C"
  alley_chain    text[] NOT NULL DEFAULT '{}',
  house_in_alley text,
  street_norm    text NOT NULL,
  ward_norm      text,
  province_norm  text,
  geom           geometry(Point, 4326) NOT NULL,
  source         text NOT NULL CHECK (source IN ('osm', 'overture', 'fsq', 'user')),
  source_id      text,
  confidence     real NOT NULL,
  release        text
);
CREATE INDEX IF NOT EXISTS address_anchor_geom_idx        ON address_anchor USING gist (geom);
CREATE INDEX IF NOT EXISTS address_anchor_street_trgm_idx ON address_anchor USING gin (street_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS address_anchor_street_ward_idx ON address_anchor (street_norm, ward_norm);
CREATE INDEX IF NOT EXISTS address_anchor_street_hn_idx   ON address_anchor (street_norm, housenumber);

ALTER TABLE admin_area     OWNER TO pipeline;
ALTER TABLE admin_alias    OWNER TO pipeline;
ALTER TABLE street         OWNER TO pipeline;
ALTER TABLE alley          OWNER TO pipeline;
ALTER TABLE address_anchor OWNER TO pipeline;
GRANT SELECT ON admin_area, admin_alias, street, alley, address_anchor TO api;
```

`db/migrations/0004_geocode.down.sql`:
```sql
DROP TABLE IF EXISTS address_anchor;
DROP TABLE IF EXISTS alley;
DROP TABLE IF EXISTS street;
DROP TABLE IF EXISTS admin_alias;
DROP TABLE IF EXISTS admin_area;
```

- [ ] **Step 6: Migration 0005 — tenant, api_key**

`db/migrations/0005_tenant.sql`:
```sql
CREATE TABLE IF NOT EXISTS tenant (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  plan       text NOT NULL CHECK (plan IN ('internal', 'free', 'paid')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_key (
  key                  text PRIMARY KEY CHECK (key ~ '^mlv_live_[0-9A-Za-z]{24}$'),
  tenant_id            uuid NOT NULL REFERENCES tenant (id),
  label                text,
  kind                 text NOT NULL CHECK (kind IN ('web', 'mobile', 'server')),
  allowed_origins      text[] NOT NULL DEFAULT '{}',
  allowed_bundle_ids   text[] NOT NULL DEFAULT '{}',
  scopes               text[] NOT NULL DEFAULT '{places:read}',
  quota_tiles_per_day  int,
  quota_places_per_day int,
  quota_edits_per_day  int,
  active               boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  revoked_at           timestamptz
);
CREATE INDEX IF NOT EXISTS api_key_tenant_idx ON api_key (tenant_id);

ALTER TABLE poi_edit ADD CONSTRAINT poi_edit_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenant (id);

GRANT SELECT ON tenant, api_key TO api, pipeline;
```

`db/migrations/0005_tenant.down.sql`:
```sql
ALTER TABLE poi_edit DROP CONSTRAINT IF EXISTS poi_edit_tenant_fk;
DROP TABLE IF EXISTS api_key;
DROP TABLE IF EXISTS tenant;
```

- [ ] **Step 7: Test tích hợp lược đồ (dbtest)**

`db/schema.dbtest.mjs`:
```js
// Chạy: pnpm test:db (cần Postgres dev: pnpm db:up). Chỉ chạy trên DB local.
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseUrlFromEnv } from '../scripts/lib/migrations.mjs';

const url = databaseUrlFromEnv(process.env);
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', 'postgres'].includes(host)) throw new Error(`dbtest chỉ chạy trên DB local, không phải ${host}`);
const sql = postgres(url, { max: 1, onnotice: () => {} });
const migrate = (/** @type {string[]} */ ...args) => execFileSync(process.execPath, ['scripts/db-migrate.mjs', ...args], { encoding: 'utf8', env: process.env });

// Bỏ bảng của PostGIS (spatial_ref_sys) và bảng làm việc do pipeline tạo lúc chạy (không thuộc migration)
const tables = async () =>
  (await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      AND table_name NOT LIKE 'poi\\_work\\_%' AND table_name NOT IN ('spatial_ref_sys', 'vn_boundary', 'osm_road_raw', 'osm_admin_raw', 'address_anchor_raw') ORDER BY 1`).map((r) => r.table_name);

beforeAll(() => {
  migrate();
});
afterAll(() => sql.end());

describe('lược đồ spec 5.2', () => {
  it('đủ 16 bảng', async () => {
    expect(await tables()).toEqual(
      expect.arrayContaining([
        'address_anchor', 'admin_alias', 'admin_area', 'alley', 'api_key', 'category', 'category_map', 'poi', 'poi_edit',
        'poi_source_link', 'schema_migrations', 'src_fsq_place', 'src_osm_place', 'src_overture_place', 'street', 'tenant',
      ]),
    );
  });

  it('kiểu geometry và SRID đúng', async () => {
    const rows = await sql`SELECT f_table_name AS t, f_geometry_column AS c, type, srid FROM geometry_columns ORDER BY 1, 2`;
    const byTable = Object.fromEntries(rows.map((r) => [`${r.t}.${r.c}`, `${r.type}:${r.srid}`]));
    expect(byTable['poi.geom']).toBe('POINT:4326');
    expect(byTable['street.geom']).toBe('MULTILINESTRING:4326');
    expect(byTable['alley.geom']).toBe('LINESTRING:4326');
    expect(byTable['alley.entrance']).toBe('POINT:4326');
    expect(byTable['admin_area.geom']).toBe('MULTIPOLYGON:4326');
    expect(byTable['address_anchor.geom']).toBe('POINT:4326');
  });

  it('index GIST/GIN/B-tree theo spec (so theo định nghĩa, không theo tên — bảng có thể được pipeline dựng lại)', async () => {
    const defs = (await sql`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public'`).map((r) => String(r.indexdef));
    const has = (/** @type {RegExp} */ re) => defs.some((d) => re.test(d));
    expect(has(/ON public\.poi USING gist \(geom\)/)).toBe(true);
    expect(has(/ON public\.poi USING gin \(name_norm gin_trgm_ops\)/)).toBe(true);
    expect(has(/ON public\.street USING gin \(name_norm gin_trgm_ops\)/)).toBe(true);
    expect(has(/ON public\.address_anchor USING gin \(street_norm gin_trgm_ops\)/)).toBe(true);
    expect(has(/ON public\.address_anchor USING btree \(street_norm, ward_norm\)/)).toBe(true);
    expect(has(/ON public\.poi USING btree \(status, category\)/)).toBe(true);
    for (const t of ['src_osm_place', 'src_overture_place', 'src_fsq_place', 'admin_area', 'street', 'alley', 'address_anchor']) {
      expect(has(new RegExp(`ON public\\.${t} USING gist \\(geom\\)`))).toBe(true);
    }
  });

  it('ràng buộc: status, created_by, api_key format', async () => {
    await expect(sql`INSERT INTO poi (id, name, name_norm, geom, status, created_by) VALUES ('x', 'A', 'a', ST_SetSRID(ST_MakePoint(106.7, 10.77), 4326), 'weird', 'pipeline')`).rejects.toThrow(/poi_status_check/);
    await expect(sql`INSERT INTO tenant (name, plan) VALUES ('t', 'gold')`).rejects.toThrow(/tenant_plan_check/);
    const [t] = await sql`INSERT INTO tenant (name, plan) VALUES ('t', 'internal') RETURNING id`;
    await expect(sql`INSERT INTO api_key (key, tenant_id, kind) VALUES ('bad', ${t.id}, 'web')`).rejects.toThrow(/api_key_key_check/);
    await sql`DELETE FROM tenant WHERE id = ${t.id}`;
  });

  it('quyền: api chỉ SELECT (+ INSERT poi_edit), pipeline sở hữu bảng dữ liệu', async () => {
    const grants = await sql`SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee IN ('api', 'pipeline') AND table_schema = 'public'`;
    const api = grants.filter((g) => g.grantee === 'api');
    expect(api.some((g) => g.table_name === 'poi' && g.privilege_type === 'SELECT')).toBe(true);
    expect(api.some((g) => g.table_name === 'poi' && g.privilege_type !== 'SELECT')).toBe(false);
    expect(api.some((g) => g.table_name === 'poi_edit' && g.privilege_type === 'INSERT')).toBe(true);
    const [owner] = await sql`SELECT tableowner FROM pg_tables WHERE tablename = 'poi'`;
    expect(owner.tableowner).toBe('pipeline');
  });

  it('--down revert từng migration rồi migrate lại về đủ bảng', async () => {
    for (let i = 0; i < 4; i++) migrate('--down');
    const after = await tables();
    expect(after).toEqual(['schema_migrations']);
    expect((await sql`SELECT name FROM schema_migrations`).map((r) => r.name)).toEqual(['0001_extensions.sql']);
    migrate();
    expect((await tables()).length).toBe(16);
  });
});
```

Run: `pnpm db:up && pnpm test:db`
Expected: 6 test xanh; log có `Áp dụng 0002_sources.sql … 0005_tenant.sql`, `Revert 0005_tenant.sql …`.

Run: `pnpm db:migrate`
Expected: `Không có migration mới.`

- [ ] **Step 8: Chạy migration trên máy chủ và thêm job CI**

Run (trên máy chủ, hoặc máy dev nếu G3 chưa có): `pnpm server:update`
Expected: `Áp dụng 0002 … 0005`, `✔ server:update xong`.

Tạo workflow **riêng** `.github/workflows/dbtest.yml` — repo private chỉ có 2.000 phút Actions/tháng, dbtest tốn 10–15 phút nên chỉ chạy khi chạm mã DB/pipeline hoặc chạy tay:
```yaml
name: DB tests
on:
  push:
    branches: [main]
    paths: ['db/**', 'pipelines/poi/**', 'scripts/**', 'packages/core/**', 'vitest.db.config.ts']
  workflow_dispatch:
concurrency:
  group: dbtest-${{ github.ref }}
  cancel-in-progress: true
jobs:
  dbtest:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgis/postgis:16-3.4
        env:
          POSTGRES_USER: mapslibvn
          POSTGRES_PASSWORD: mapslibvn
          POSTGRES_DB: mapslibvn
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U mapslibvn" --health-interval 5s --health-timeout 3s --health-retries 30
    env:
      DATABASE_URL: postgres://mapslibvn:mapslibvn@localhost:5432/mapslibvn
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9.15.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @mapslibvn/core build
      - run: pnpm test:db
```

- [ ] **Step 9: Lint, DEVLOG, commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`

Sửa `docs/DEVLOG.md`: "Task đang làm: Task 3"; mục 4 dòng `M2 T2`.

```bash
git add -A
git commit -m "feat(db): migration 0002–0005 lược đồ kho POI/geocoding/tenant, db:migrate --down, dbtest lược đồ, job CI dbtest"
git push
```

---

### Task 3: Chuẩn hoá tiếng Việt trong `@mapslibvn/core` (`normalizeVi`, `nameCore`)

**Files:**
- Create: `packages/core/src/normalize.ts`, `packages/core/src/abbrev.json`, `packages/core/src/brand_alias.json`, `packages/core/tests/normalize.test.ts`, `packages/core/tests/fixtures/normalize.csv`
- Modify: `packages/core/src/index.ts`, `packages/core/tsconfig.json` (include `tests`)

- [ ] **Step 1: Fixture ≥ 200 trường hợp**

`packages/core/tests/fixtures/normalize.csv` — định dạng `input|normalizeVi|nameCore`, dòng `#` là chú thích. Test chạy mỗi dòng ở 3 biến thể (gốc, VIẾT HOA, NFD) → 85 dòng = 255 trường hợp.
```
# input|norm|core
Cà phê Cộng|ca phe cong|cong
Cong Caphe Nguyễn Lâm|cong caphe nguyen lam|cong nguyen lam
Highlands Coffee Nguyễn Huệ|highlands coffee nguyen hue|highlands nguyen hue
Highlands Nguyen Hue|highlands nguyen hue|highlands nguyen hue
The Coffee House - Lê Lợi|the coffee house le loi|the coffee house le loi
TCH Lê Lợi|tch le loi|the coffee house le loi
Phúc Long Coffee & Tea|phuc long coffee tea|phuc long
Trung Nguyên Legend Cafe|trung nguyen legend cafe|trung nguyen cafe
Starbucks Reserve Hàn Thuyên|starbucks reserve han thuyen|starbucks han thuyen
Công ty TNHH MTV Thương mại ABC|cong ty tnhh mtv thuong mai abc|thuong mai abc
Cty CP Đầu tư XYZ|cong ty co phan dau tu xyz|dau tu xyz
Cửa hàng Bách Hoá Xanh|cua hang bach hoa xanh|bach hoa xanh
BHX Phạm Văn Đồng|bhx pham van dong|bach hoa xanh pham van dong
Quán Ăn Ngon|quan an ngon|an ngon
Tiệm Bánh Như Lan|tiem banh nhu lan|banh nhu lan
Nhà hàng Ngọc Sương|nha hang ngoc suong|ngoc suong
Shop Hoa Tươi 24h|shop hoa tuoi 24h|hoa tuoi 24h
Cafe Sài Gòn Xưa|cafe sai gon xua|sai gon xua
Coffee|coffee|coffee
Cà Phê|ca phe|ca phe
Circle K Lý Tự Trọng|circle k ly tu trong|circle k ly tu trong
CircleK Bùi Viện|circlek bui vien|circle k bui vien
WinMart+ Phú Nhuận|winmart phu nhuan|winmart phu nhuan
VinMart Quận 7|vinmart quan 7|winmart quan 7
Co.opmart Cống Quỳnh|co opmart cong quynh|coopmart cong quynh
Siêu thị Co.op Mart|sieu thi co op mart|sieu thi co op mart
Vietcombank CN Sài Gòn|vietcombank cn sai gon|vietcombank cn sai gon
Ngân hàng TMCP Ngoại Thương Việt Nam|ngan hang tmcp ngoai thuong viet nam|vietcombank
Nhà thuốc Long Châu|nha thuoc long chau|long chau
FPT Long Châu 123 CMT8|fpt long chau 123 cmt8|long chau 123 cmt8
Nhà Thuốc Pharmacity|nha thuoc pharmacity|pharmacity
Thế Giới Di Động|the gioi di dong|the gioi di dong
TGDĐ Nguyễn Thị Minh Khai|tgdd nguyen thi minh khai|the gioi di dong nguyen thi minh khai
Điện Máy Xanh|dien may xanh|dien may xanh
KFC Nguyễn Trãi|kfc nguyen trai|kfc nguyen trai
Kentucky Fried Chicken|kentucky fried chicken|kfc
Phở 24|pho 24|pho 24
Pho24 Lê Thánh Tôn|pho24 le thanh ton|pho 24 le thanh ton
GS 25 Bến Thành|gs 25 ben thanh|gs25 ben thanh
Family Mart|family mart|family mart
Trường Tiểu học Hoàng Diệu|truong tieu hoc hoang dieu|truong tieu hoc hoang dieu
Trường THCS Linh Xuân|truong thcs linh xuan|truong thcs linh xuan
Bệnh viện Chợ Rẫy|benh vien cho ray|benh vien cho ray
UBND Phường Bến Nghé|ubnd phuong ben nghe|ubnd phuong ben nghe
UBND P. Bến Nghé|ubnd phuong ben nghe|ubnd phuong ben nghe
P.6, Q.10, TP.HCM|phuong 6 quan 10 thanh pho hcm|phuong 6 quan 10 thanh pho hcm
88/9 Nguyễn Lâm, P.6, Q.10|88/9 nguyen lam phuong 6 quan 10|88/9 nguyen lam phuong 6 quan 10
88 / 9 Nguyễn Lâm|88/9 nguyen lam|88/9 nguyen lam
Hẻm 112 Nguyễn Lâm|hem 112 nguyen lam|hem 112 nguyen lam
Đ. Nguyễn Lâm|duong nguyen lam|duong nguyen lam
Đường Nguyễn Lâm|duong nguyen lam|duong nguyen lam
Ng. Văn Cừ|nguyen van cu|nguyen van cu
KP 3, TT. Hóc Môn|khu pho 3 thi tran hoc mon|khu pho 3 thi tran hoc mon
KP3 Thị trấn Củ Chi|khu pho 3 thi tran cu chi|khu pho 3 thi tran cu chi
F6 Quận Gò Vấp|phuong 6 quan go vap|phuong 6 quan go vap
F. 12, Q. Tân Bình|phuong 12 quan tan binh|phuong 12 quan tan binh
Fahasa Nguyễn Huệ|fahasa nguyen hue|fahasa nguyen hue
TX. Thuận An|thi xa thuan an|thi xa thuan an
H. Củ Chi|huyen cu chi|huyen cu chi
X. Tân Thông Hội|xa tan thong hoi|xa tan thong hoi
Bà Rịa - Vũng Tàu|ba ria vung tau|ba ria vung tau
Bà Rịa-Vũng Tàu|ba ria-vung tau|ba ria-vung tau
Số 12-14 Nguyễn Huệ|so 12-14 nguyen hue|so 12-14 nguyen hue
Tiệm tạp hoá Cô Ba (cũ)|tiem tap hoa co ba cu|tap hoa co ba cu
Café Sữa Đá|cafe sua da|sua da
Starbucks Coffee|starbucks coffee|starbucks
Lotteria Nguyễn Văn Cừ|lotteria nguyen van cu|lotteria nguyen van cu
Jollibee Big C Gò Vấp|jollibee big c go vap|jollibee big c go vap
Agribank - CN Thủ Đức|agribank cn thu duc|agribank cn thu duc
Ngân hàng Agribank|ngan hang agribank|agribank
BIDV Chi nhánh Sài Gòn|bidv chi nhanh sai gon|bidv chi nhanh sai gon
Chùa Vĩnh Nghiêm|chua vinh nghiem|chua vinh nghiem
Nhà thờ Đức Bà|nha tho duc ba|nha tho duc ba
Bến xe Miền Đông|ben xe mien dong|ben xe mien dong
Sân bay Tân Sơn Nhất|san bay tan son nhat|san bay tan son nhat
Công viên 23/9|cong vien 23/9|cong vien 23/9
Chợ Bến Thành|cho ben thanh|cho ben thanh
Quán Cơm Tấm Ba Ghiền|quan com tam ba ghien|com tam ba ghien
Cty TNHH Cà Phê Trung Nguyên|cong ty tnhh ca phe trung nguyen|trung nguyen
Trung Nguyên E-Coffee|trung nguyen e-coffee|trung nguyen
THE COFFEE HOUSE|the coffee house|the coffee house
Guardian Vincom Đồng Khởi|guardian vincom dong khoi|guardian vincom dong khoi
Nhà thuốc An Khang|nha thuoc an khang|an khang
FPT Shop Cách Mạng Tháng 8|fpt shop cach mang thang 8|fpt shop cach mang thang 8
FPTShop|fptshop|fpt shop
```

- [ ] **Step 2: Test (thất bại)**

`packages/core/tests/normalize.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyBrandAlias, expandAbbrev, nameCore, normalizeVi, stripDiacritics } from '../src/normalize';

const rows = readFileSync(fileURLToPath(new URL('./fixtures/normalize.csv', import.meta.url)), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => {
    const [input, norm, core] = l.split('|') as [string, string, string];
    return { input, norm, core };
  });

describe('fixture normalize.csv', () => {
  it('có ≥ 200 trường hợp (mỗi dòng × 3 biến thể)', () => {
    expect(rows.length * 3).toBeGreaterThanOrEqual(200);
  });
  for (const r of rows) {
    const variants: [string, string][] = [['gốc', r.input], ['HOA', r.input.toUpperCase()], ['NFD', r.input.normalize('NFD')]];
    for (const [label, input] of variants) {
      it(`${label}: ${r.input}`, () => {
        expect(normalizeVi(input)).toBe(r.norm);
        expect(nameCore(input)).toBe(r.core);
      });
    }
  }
});

describe('hàm thành phần', () => {
  it('stripDiacritics giữ chữ hoa, đổi đ/Đ', () => {
    expect(stripDiacritics('Đường Điện Biên Phủ')).toBe('Duong Dien Bien Phu');
  });
  it('expandAbbrev chỉ thay token đứng riêng', () => {
    expect(expandAbbrev('tp.hcm')).toBe('thanh pho hcm');
    expect(expandAbbrev('sp.vn')).toBe('sp.vn');
    expect(expandAbbrev('kpop')).toBe('kpop');
  });
  it('applyBrandAlias chỉ thay ở đầu chuỗi', () => {
    expect(applyBrandAlias('tch nguyen hue')).toBe('the coffee house nguyen hue');
    expect(applyBrandAlias('quan tch')).toBe('quan tch');
  });
});
```

Sửa `packages/core/tsconfig.json` → `"include": ["src", "tests"]` và **bỏ** `"rootDir": "src"` (M1b đặt; `noEmit` nên không cần, và giữ sẽ báo lỗi "not under rootDir" cho `tests/`).

Run: `pnpm test`
Expected: FAIL — không tìm thấy `../src/normalize`.

- [ ] **Step 3: Bảng viết tắt và alias thương hiệu**

`packages/core/src/abbrev.json` (khoá đã bỏ dấu vì áp dụng **sau** bước bỏ dấu: `đ.` → `d.`; thứ tự trong file là thứ tự áp dụng):
```json
{
  "tp.": "thanh pho",
  "tt.": "thi tran",
  "tx.": "thi xa",
  "p.": "phuong",
  "q.": "quan",
  "h.": "huyen",
  "x.": "xa",
  "d.": "duong",
  "ng.": "nguyen",
  "kp": "khu pho",
  "cty": "cong ty",
  "cp": "co phan"
}
```

`packages/core/src/brand_alias.json` (khoá = dạng chuẩn, giá trị = các biến thể đã chuẩn hoá; mở rộng dần):
```json
{
  "highlands": ["highlands coffee", "highland coffee", "highland"],
  "cong": ["cong caphe", "cong ca phe", "cong cafe", "cong coffee"],
  "the coffee house": ["tch", "coffee house"],
  "phuc long": ["phuc long coffee tea", "phuc long tea coffee", "phuc long coffee"],
  "trung nguyen": ["trung nguyen legend", "trung nguyen e-coffee", "trung nguyen coffee"],
  "starbucks": ["starbucks coffee", "starbucks reserve"],
  "circle k": ["circlek"],
  "winmart": ["vinmart", "vinmart plus", "winmart plus"],
  "coopmart": ["co opmart", "co op mart", "coop mart", "saigon co op"],
  "bach hoa xanh": ["bhx"],
  "family mart": ["familymart"],
  "gs25": ["gs 25"],
  "pho 24": ["pho24"],
  "kfc": ["kentucky fried chicken"],
  "vietcombank": ["ngan hang vietcombank", "ngan hang tmcp ngoai thuong viet nam", "vcb"],
  "techcombank": ["ngan hang techcombank", "tcb"],
  "agribank": ["ngan hang agribank", "ngan hang nong nghiep va phat trien nong thon"],
  "bidv": ["ngan hang bidv", "ngan hang dau tu va phat trien viet nam"],
  "vietinbank": ["ngan hang vietinbank", "ngan hang cong thuong viet nam"],
  "pharmacity": ["nha thuoc pharmacity"],
  "long chau": ["nha thuoc long chau", "fpt long chau"],
  "an khang": ["nha thuoc an khang"],
  "the gioi di dong": ["tgdd"],
  "dien may xanh": ["dmx"],
  "fpt shop": ["fptshop"]
}
```

- [ ] **Step 4: `normalize.ts`**

```ts
import abbrevJson from './abbrev.json';
import brandAliasJson from './brand_alias.json';

const ABBREV: Record<string, string> = abbrevJson;
const BRAND_ALIAS: Record<string, string[]> = brandAliasJson;

/** Từ đệm bị bỏ ở đầu tên POI khi so khớp (spec 5.3 bước 5; thêm `mtv`). Không dùng cho hiển thị. */
export const NAME_FILLERS = [
  'cong ty', 'cty', 'tnhh', 'mtv', 'co phan', 'cua hang', 'quan', 'tiem', 'nha hang', 'shop', 'cafe', 'ca phe', 'coffee',
];

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const ABBREV_RULES = Object.entries(ABBREV).map(([key, value]) => {
  const after = key.endsWith('.') ? '' : '(?=[\\s\\d,.]|$)';
  return { re: new RegExp(`(^|[\\s,.(])${escapeRegExp(key)}${after}`, 'g'), replacement: `$1${value} ` };
});

const ALIAS_RULES = Object.entries(BRAND_ALIAS)
  .flatMap(([canonical, variants]) => variants.map((variant) => ({ variant, canonical })))
  .sort((a, b) => b.variant.length - a.variant.length);

/** Bỏ dấu tiếng Việt (giữ chữ hoa/thường), đ → d. */
export function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

/** Thay viết tắt (bảng abbrev.json) trên chuỗi đã lowercase + bỏ dấu; `f` trước số → `phuong`. */
export function expandAbbrev(s: string): string {
  let out = s;
  for (const { re, replacement } of ABBREV_RULES) out = out.replace(re, replacement);
  out = out.replace(/(^|\s)f\.?(?=\s*\d)/g, '$1phuong ');
  return out.replace(/ {2,}/g, ' ').trim();
}

/** Chuẩn hoá spec 5.3 bước 1–4: NFC → lowercase → bỏ dấu → viết tắt → bỏ dấu câu (giữ `/`, `-`) → gộp khoảng trắng. */
export function normalizeVi(input: string): string {
  let s = stripDiacritics(input.normalize('NFC').toLowerCase());
  s = expandAbbrev(s);
  s = s.replace(/[^a-z0-9/\-\s]/g, ' ');
  s = s.replace(/\s*\/\s*/g, '/');
  s = s.replace(/\s+-\s+/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/** Alias thương hiệu: chỉ thay khi biến thể đứng đầu chuỗi (hoặc bằng cả chuỗi). */
export function applyBrandAlias(s: string): string {
  for (const { variant, canonical } of ALIAS_RULES) {
    if (s === variant) return canonical;
    if (s.startsWith(`${variant} `)) return canonical + s.slice(variant.length);
  }
  return s;
}

/** Tên rút gọn để so khớp trigram (spec 5.3 bước 5–6). Nếu bỏ hết từ đệm mà rỗng thì giữ tên chuẩn hoá. */
export function nameCore(input: string): string {
  const norm = normalizeVi(input);
  let s = norm;
  let changed = true;
  while (changed && s) {
    changed = false;
    for (const filler of NAME_FILLERS) {
      if (s === filler) {
        s = '';
        break;
      }
      if (s.startsWith(`${filler} `)) {
        s = s.slice(filler.length + 1);
        changed = true;
      }
    }
  }
  return applyBrandAlias(s || norm);
}
```

Thêm vào `packages/core/src/index.ts`: `export * from './normalize';`

Run: `pnpm test`
Expected: 255 + 4 test normalize xanh. Dòng nào đỏ: đọc kỳ vọng trong CSV và output thật; nếu output thật hợp lý hơn (ví dụ quy tắc alias), **sửa CSV** và ghi lý do vào commit message; nếu mã sai, sửa mã. Không xoá dòng fixture.

- [ ] **Step 5: Build, typecheck, lint, DEVLOG, commit**

Run: `pnpm --filter @mapslibvn/core build && pnpm typecheck && pnpm lint`
Expected: xanh; `dist/index.js` chứa bảng abbrev/alias.

Sửa `docs/DEVLOG.md`: "Task đang làm: Task 4"; mục 3 thêm "`NAME_FILLERS` có thêm `mtv`; `abbrev.json` thêm `tx.`, `h.`, `x.`"; mục 4 dòng `M2 T3`.

```bash
git add -A
git commit -m "feat(core): normalizeVi/nameCore theo spec 5.3 — bỏ dấu, viết tắt, từ đệm, alias thương hiệu; 255 fixture"
git push
```

---

### Task 4: Parser địa chỉ tiếng Việt (`parseAddress`) + fixture ≥ 300 địa chỉ thật

**Files:**
- Create: `packages/core/src/address.ts`, `packages/core/src/provinces.json`, `packages/core/tests/address.test.ts`, `packages/core/tests/fixtures/addresses.jsonl`, `packages/core/.size-limit.json`, `pipelines/poi/scripts/sample-addresses.mjs`
- Modify: `packages/core/src/index.ts`, `packages/core/package.json`

- [ ] **Step 1: Fixture tuyển chọn (curated) — 49 dòng bắt buộc đúng 100%**

`packages/core/tests/fixtures/addresses.jsonl` — mỗi dòng `{"input", "expected", "curated": true}`; `expected` là **tập con** các trường phải khớp (trường không nêu không kiểm). Dòng lấy mẫu thật (Step 5) nối thêm phía dưới với `"curated": false`.
```jsonl
{"input":"88/9 Nguyễn Lâm, Phường 6, Quận 10, TP.HCM","expected":{"housenumber":"88/9","alleyChain":["88"],"houseInAlley":"9","street":"Nguyễn Lâm","streetNorm":"nguyen lam","ward":"6","district":"10","province":"Thành phố Hồ Chí Minh","confidence":1},"curated":true}
{"input":"88/9 Nguyễn Lâm P.6 Q.10","expected":{"housenumber":"88/9","alleyChain":["88"],"houseInAlley":"9","street":"Nguyễn Lâm","ward":"6","district":"10","confidence":0.85},"curated":true}
{"input":"Số 5 Hẻm 112 Nguyễn Lâm, P.6, Q.10, TP.HCM","expected":{"housenumber":"112/5","alleyChain":["112"],"houseInAlley":"5","alleyKeyword":"hem","street":"Nguyễn Lâm","ward":"6","district":"10","province":"Thành phố Hồ Chí Minh"},"curated":true}
{"input":"Hẻm 112 Nguyễn Lâm, Quận 10","expected":{"alleyChain":["112"],"alleyKeyword":"hem","street":"Nguyễn Lâm","district":"10","confidence":0.45},"curated":true}
{"input":"130C Lê Lợi, Bến Nghé, Quận 1, Hồ Chí Minh","expected":{"housenumber":"130C","alleyChain":[],"street":"Lê Lợi","ward":"Bến Nghé","district":"1","province":"Thành phố Hồ Chí Minh","confidence":1},"curated":true}
{"input":"12/59F Đường Phạm Văn Chiêu, P.14, Gò Vấp","expected":{"housenumber":"12/59F","alleyChain":["12"],"houseInAlley":"59F","street":"Phạm Văn Chiêu","ward":"14","district":"Gò Vấp"},"curated":true}
{"input":"Đường số 7, Phường Tân Phú, TP Thủ Đức, TPHCM","expected":{"street":"Đường số 7","streetNorm":"duong so 7","ward":"Tân Phú","district":"Thủ Đức","province":"Thành phố Hồ Chí Minh","confidence":0.75},"curated":true}
{"input":"36 Xã Đàn, Đống Đa, Hà Nội","expected":{"housenumber":"36","street":"Xã Đàn","province":"Hà Nội"},"curated":true}
{"input":"Ngõ 25 Phố Vũ Ngọc Phan, Láng Hạ, Đống Đa, Hà Nội","expected":{"alleyKeyword":"ngo","alleyChain":["25"],"street":"Vũ Ngọc Phan","province":"Hà Nội"},"curated":true}
{"input":"Số 3 Ngách 15 Ngõ 78 Đường Giải Phóng, Hà Nội","expected":{"housenumber":"78/15/3","alleyChain":["78","15"],"houseInAlley":"3","alleyKeyword":"ngach","street":"Giải Phóng","province":"Hà Nội"},"curated":true}
{"input":"Kiệt 42 Trần Cao Vân, Thanh Khê, Đà Nẵng","expected":{"alleyKeyword":"kiet","alleyChain":["42"],"street":"Trần Cao Vân","province":"Đà Nẵng"},"curated":true}
{"input":"Quốc lộ 1A, Xã Tân Thông Hội, Huyện Củ Chi, TP. Hồ Chí Minh","expected":{"street":"Quốc lộ 1A","streetNorm":"quoc lo 1a","ward":"Tân Thông Hội","district":"Củ Chi","province":"Thành phố Hồ Chí Minh"},"curated":true}
{"input":"Thị trấn Củ Chi, Huyện Củ Chi","expected":{"ward":"Củ Chi","district":"Củ Chi","confidence":0.25},"curated":true}
{"input":"Tổ 5, Khu phố 3, Thị trấn Hóc Môn, Hóc Môn, TP.HCM","expected":{"ward":"Hóc Môn","district":"Hóc Môn","province":"Thành phố Hồ Chí Minh"},"curated":true}
{"input":"Ấp 3, Xã Phước Vĩnh An, Củ Chi","expected":{"ward":"Phước Vĩnh An","district":"Củ Chi"},"curated":true}
{"input":"12 Lê Lợi, Vũng Tàu","expected":{"housenumber":"12","street":"Lê Lợi","province":"Thành phố Hồ Chí Minh"},"curated":true}
{"input":"Số 1 Đại lộ Thăng Long, Nam Từ Liêm, Hà Nội","expected":{"housenumber":"1","street":"Đại lộ Thăng Long","province":"Hà Nội"},"curated":true}
{"input":"Tp Hồ Chí Minh, Quận 1, Phường Bến Nghé, 12 Lê Lợi","expected":{"housenumber":"12","street":"Lê Lợi","ward":"Bến Nghé","district":"1","province":"Thành phố Hồ Chí Minh"},"curated":true}
{"input":"12 le loi, q.1, tp.hcm","expected":{"housenumber":"12","street":"le loi","streetNorm":"le loi","district":"1","province":"Thành phố Hồ Chí Minh"},"curated":true}
{"input":"12 LÊ LỢI, Q1, HCM","expected":{"housenumber":"12","street":"LÊ LỢI","district":"1","province":"Thành phố Hồ Chí Minh"},"curated":true}
{"input":"P6 Q10","expected":{"ward":"6","district":"10"},"curated":true}
{"input":"Phường Diên Hồng, Quận 10","expected":{"ward":"Diên Hồng","district":"10"},"curated":true}
{"input":"168 Hai Bà Trưng, Phường Đa Kao, Quận 1, Thành phố Hồ Chí Minh, Việt Nam","expected":{"housenumber":"168","street":"Hai Bà Trưng","ward":"Đa Kao","district":"1","province":"Thành phố Hồ Chí Minh"},"curated":true}
{"input":"168 Hai Bà Trưng, Đa Kao, Quận 1, TP HCM 700000","expected":{"housenumber":"168","street":"Hai Bà Trưng","ward":"Đa Kao","district":"1","province":"Thành phố Hồ Chí Minh"},"curated":true}
{"input":"Số 2 Nguyễn Bỉnh Khiêm, Bến Nghé, 1, Hồ Chí Minh","expected":{"housenumber":"2","street":"Nguyễn Bỉnh Khiêm","ward":"Bến Nghé","district":"1","province":"Thành phố Hồ Chí Minh"},"curated":true}
{"input":"Đ. Nguyễn Văn Linh, P. Tân Phong, Q. 7","expected":{"street":"Nguyễn Văn Linh","ward":"Tân Phong","district":"7"},"curated":true}
{"input":"1 Võ Văn Ngân, Linh Chiểu, Thủ Đức, Bình Dương","expected":{"housenumber":"1","street":"Võ Văn Ngân","ward":"Linh Chiểu","district":"Thủ Đức","province":"Thành phố Hồ Chí Minh"},"curated":true}
{"input":"Phường Linh Xuân, Thành phố Thủ Đức","expected":{"ward":"Linh Xuân","district":"Thủ Đức"},"curated":true}
{"input":"19 Nguyễn Hữu Thọ, Tân Hưng, Quận 7, Sài Gòn","expected":{"housenumber":"19","street":"Nguyễn Hữu Thọ","ward":"Tân Hưng","district":"7","province":"Thành phố Hồ Chí Minh"},"curated":true}
{"input":"Số 9 Tôn Thất Thuyết, Phường Dịch Vọng Hậu, Cầu Giấy, Hà Nội","expected":{"housenumber":"9","street":"Tôn Thất Thuyết","ward":"Dịch Vọng Hậu","district":"Cầu Giấy","province":"Hà Nội"},"curated":true}
{"input":"Tòa nhà Bitexco, 2 Hải Triều, Q1","expected":{"housenumber":"2","street":"Hải Triều","district":"1"},"curated":true}
{"input":"Lô A, Đường D2, Khu công nghệ cao, Phường Tăng Nhơn Phú A, Quận 9","expected":{"street":"Đường D2","ward":"Tăng Nhơn Phú A","district":"9"},"curated":true}
{"input":"Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, Tân Hưng, Quận 7","expected":{"housenumber":"23","street":"Nguyễn Hữu Thọ","ward":"Tân Hưng","district":"7"},"curated":true}
{"input":"Tầng 5, Tòa nhà ABC, 12 Lê Duẩn, Bến Nghé, Q.1","expected":{"housenumber":"12","street":"Lê Duẩn","ward":"Bến Nghé","district":"1"},"curated":true}
{"input":"Xa lộ Hà Nội, Phường Thảo Điền, TP Thủ Đức","expected":{"street":"Xa lộ Hà Nội","ward":"Thảo Điền","district":"Thủ Đức"},"curated":true}
{"input":"Khu phố 3, Phường Tân Định, Quận 1","expected":{"ward":"Tân Định","district":"1"},"curated":true}
{"input":"Thôn Đông, Xã Vân Canh, Huyện Hoài Đức, Hà Nội","expected":{"ward":"Vân Canh","district":"Hoài Đức","province":"Hà Nội"},"curated":true}
{"input":"Tỉnh Bình Định","expected":{"province":"Gia Lai","confidence":0.15},"curated":true}
{"input":"Nha Trang, Khánh Hòa","expected":{"province":"Khánh Hòa"},"curated":true}
{"input":"Số 10 ngõ 15 Tạ Quang Bửu, Hai Bà Trưng, Hà Nội","expected":{"housenumber":"15/10","alleyChain":["15"],"houseInAlley":"10","alleyKeyword":"ngo","street":"Tạ Quang Bửu","province":"Hà Nội"},"curated":true}
{"input":"123 đường 3 tháng 2, P.11, Q.10","expected":{"housenumber":"123","street":"3 tháng 2","streetNorm":"3 thang 2","ward":"11","district":"10"},"curated":true}
{"input":"Lô 12 Đường số 3, KDC Trung Sơn, Bình Hưng, Bình Chánh","expected":{"housenumber":"12","street":"Đường số 3","ward":"Bình Hưng","district":"Bình Chánh"},"curated":true}
{"input":"Số 1 Công trường Công xã Paris, Phường Bến Nghé, Quận 1, TP. Hồ Chí Minh","expected":{"housenumber":"1","street":"Công trường Công xã Paris","ward":"Bến Nghé","district":"1","province":"Thành phố Hồ Chí Minh"},"curated":true}
{"input":"01 Đinh Tiên Hoàng, Đa Kao, Q1, HCM","expected":{"housenumber":"01","street":"Đinh Tiên Hoàng","ward":"Đa Kao","district":"1","province":"Thành phố Hồ Chí Minh"},"curated":true}
{"input":"Thị xã Thuận An, Bình Dương","expected":{"district":"Thuận An","province":"Thành phố Hồ Chí Minh"},"curated":true}
{"input":"ĐƯỜNG NGUYỄN TRÃI, QUẬN 5","expected":{"street":"NGUYỄN TRÃI","streetNorm":"nguyen trai","district":"5"},"curated":true}
{"input":"Phường 6 - Quận 10 - TP.HCM","expected":{"ward":"6","district":"10","province":"Thành phố Hồ Chí Minh"},"curated":true}
{"input":"45 Trần Phú, Phường Lộc Thọ, Nha Trang","expected":{"housenumber":"45","street":"Trần Phú","ward":"Lộc Thọ","province":"Khánh Hòa"},"curated":true}
{"input":"TT. Hóc Môn, H. Hóc Môn","expected":{"ward":"Hóc Môn","district":"Hóc Môn"},"curated":true}
```

- [ ] **Step 2: Test (thất bại)**

`packages/core/tests/address.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type ParsedAddress, parseAddress } from '../src/address';

interface Line {
  input: string;
  expected: Partial<ParsedAddress>;
  curated: boolean;
}

const lines: Line[] = readFileSync(fileURLToPath(new URL('./fixtures/addresses.jsonl', import.meta.url)), 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as Line);

const subsetMatch = (actual: ParsedAddress, expected: Partial<ParsedAddress>) =>
  Object.entries(expected).every(([k, v]) => JSON.stringify((actual as Record<string, unknown>)[k]) === JSON.stringify(v));

describe('parseAddress — curated (100%)', () => {
  for (const l of lines.filter((x) => x.curated)) {
    it(l.input, () => {
      expect(parseAddress(l.input)).toMatchObject(l.expected);
    });
  }
});

describe('parseAddress — fixture thật', () => {
  it('có ≥ 300 dòng', () => {
    expect(lines.length).toBeGreaterThanOrEqual(300);
  });
  it('≥ 95% dòng khớp kỳ vọng', () => {
    const ok = lines.filter((l) => subsetMatch(parseAddress(l.input), l.expected));
    const bad = lines.filter((l) => !subsetMatch(parseAddress(l.input), l.expected)).slice(0, 10).map((l) => l.input);
    console.log(`address fixture: ${ok.length}/${lines.length} khớp; ví dụ lệch: ${JSON.stringify(bad)}`);
    expect(ok.length / lines.length).toBeGreaterThanOrEqual(0.95);
  });
});

describe('parseAddress — hành vi biên', () => {
  it('chuỗi rỗng → confidence 0, alleyChain []', () => {
    expect(parseAddress('')).toEqual({ alleyChain: [], confidence: 0 });
  });
  it('không bao giờ ném lỗi với rác', () => {
    expect(() => parseAddress('!!!, ,,, 12//, P., Q.')).not.toThrow();
  });
});
```

Run: `pnpm test`
Expected: FAIL — không tìm thấy `../src/address`.

- [ ] **Step 3: `provinces.json` — 34 tỉnh/thành sau 1/7/2025, alias gồm tên cũ đã sáp nhập**

`packages/core/src/provinces.json` (khoá = tên hiển thị; giá trị = alias đã chuẩn hoá theo `normalizeVi`, tên tỉnh cũ trỏ về tỉnh mới):
```json
{
  "Hà Nội": ["ha noi", "hanoi", "hn"],
  "Huế": ["hue", "thua thien hue", "thua thien-hue"],
  "Lai Châu": ["lai chau"],
  "Điện Biên": ["dien bien"],
  "Sơn La": ["son la"],
  "Lạng Sơn": ["lang son"],
  "Quảng Ninh": ["quang ninh", "ha long"],
  "Thanh Hóa": ["thanh hoa"],
  "Nghệ An": ["nghe an", "vinh"],
  "Hà Tĩnh": ["ha tinh"],
  "Cao Bằng": ["cao bang"],
  "Tuyên Quang": ["tuyen quang", "ha giang"],
  "Lào Cai": ["lao cai", "yen bai", "sa pa", "sapa"],
  "Thái Nguyên": ["thai nguyen", "bac kan", "bac can"],
  "Phú Thọ": ["phu tho", "vinh phuc", "hoa binh", "viet tri"],
  "Bắc Ninh": ["bac ninh", "bac giang"],
  "Hưng Yên": ["hung yen", "thai binh"],
  "Hải Phòng": ["hai phong", "hai duong"],
  "Ninh Bình": ["ninh binh", "ha nam", "nam dinh"],
  "Quảng Trị": ["quang tri", "quang binh", "dong hoi"],
  "Đà Nẵng": ["da nang", "danang", "quang nam", "hoi an", "tam ky"],
  "Quảng Ngãi": ["quang ngai", "kon tum"],
  "Gia Lai": ["gia lai", "binh dinh", "quy nhon", "pleiku"],
  "Khánh Hòa": ["khanh hoa", "ninh thuan", "nha trang", "cam ranh", "phan rang"],
  "Lâm Đồng": ["lam dong", "dak nong", "dac nong", "binh thuan", "da lat", "dalat", "phan thiet"],
  "Đắk Lắk": ["dak lak", "dac lac", "daklak", "phu yen", "buon ma thuot", "tuy hoa"],
  "Thành phố Hồ Chí Minh": ["ho chi minh", "hcm", "tphcm", "sai gon", "saigon", "binh duong", "ba ria vung tau", "ba ria-vung tau", "ba ria", "vung tau", "thu dau mot", "di an"],
  "Đồng Nai": ["dong nai", "binh phuoc", "bien hoa", "dong xoai"],
  "Tây Ninh": ["tay ninh", "long an", "tan an"],
  "Cần Thơ": ["can tho", "soc trang", "hau giang", "vi thanh"],
  "Vĩnh Long": ["vinh long", "ben tre", "tra vinh"],
  "Đồng Tháp": ["dong thap", "tien giang", "my tho", "cao lanh", "sa dec"],
  "Cà Mau": ["ca mau", "bac lieu"],
  "An Giang": ["an giang", "kien giang", "rach gia", "phu quoc", "long xuyen", "chau doc"]
}
```
Nguồn: Nghị quyết 202/2025/QH15 (sắp xếp đơn vị hành chính cấp tỉnh). Alias là **tên tỉnh cũ và thành phố lớn** để địa chỉ cũ vẫn về đúng tỉnh mới; alias phường/xã cũ nằm ở `admin_alias` (Task 8), không ở đây.

- [ ] **Step 4: `address.ts`**

```ts
import { normalizeVi, stripDiacritics } from './normalize';
import provincesJson from './provinces.json';

export type AlleyKeyword = 'hem' | 'ngo' | 'ngach' | 'kiet';

/** Kết quả phân tích địa chỉ (spec 5.7). Trường vắng = không nhận diện được. */
export interface ParsedAddress {
  housenumber?: string;
  alleyChain: string[];
  houseInAlley?: string;
  alleyKeyword?: AlleyKeyword;
  street?: string;
  streetNorm?: string;
  ward?: string;
  district?: string;
  province?: string;
  confidence: number;
}

const PROVINCE_BY_ALIAS = new Map<string, string>();
for (const [name, aliases] of Object.entries(provincesJson as Record<string, string[]>)) {
  PROVINCE_BY_ALIAS.set(normalizeVi(name).replace(/^thanh pho /, ''), name);
  for (const a of aliases) PROVINCE_BY_ALIAS.set(a, name);
}

const NUM = String.raw`\d+[a-z]?(?:-\d+[a-z]?)?`;
const HN = String.raw`${NUM}(?:/${NUM})*`;
const ALLEY_KW = String.raw`(?:hem|ngo|ngach|kiet)`;
const RE_STREET = new RegExp(
  String.raw`^(?:(?:so(?:\s*nha)?|sn|lo|can|kiot)\.?\s*)?(${HN})?\s*((?:${ALLEY_KW}\s*${NUM}\s*)*)(?:(?:duong|d\.|pho)\s+(?!so\b|[a-z]{1,2}\d))?(.*)$`,
);
const RE_ALLEY_EACH = new RegExp(String.raw`(${ALLEY_KW})\s*(${NUM})`, 'g');
const RE_STREET_LIKE = new RegExp(String.raw`^(?:(?:so(?:\s*nha)?|sn|lo|can|kiot)\.?\s*)?\d|\b${ALLEY_KW}\s*\d|^(?:duong|d\.|pho)\s`);
const RE_TINH = /^(?:tinh|t\.)\s+(.+)$/;
const RE_CITY = /^(?:thanh pho(?=[\s\d])\s*|tp\.?\s*)(.+)$/;
const RE_DISTRICT = /^(?:(?:quan|huyen|thi xa)(?=[\s\d])\s*|(?:q\.|h\.|tx\.)\s*)(.+)$|^q\s*(\d.*)$/;
const RE_WARD = /^(?:(?:phuong|xa(?!\s+lo\b)|thi tran)(?=[\s\d])\s*|(?:p\.|x\.|tt\.|f\.)\s*)(.+)$|^[pf]\s*(\d.*)$/;
const RE_IGNORE =
  /^(?:to|khu pho|kp|ap|thon|xom|khom|khu vuc|kv|to dan pho|tdp|lo|toa nha|tn|chung cu|cc|block|tang|lau|can ho|kdc|khu dan cu|kdt|khu do thi|kcn|khu cong nghiep|kcx|khu che xuat|khu cong nghe cao|khu)\b/;
const RE_SPLIT = new RegExp(
  String.raw`\s(?=(?:phuong|xa(?!\s+lo\b)|thi tran|quan|huyen|thi xa|thanh pho|tinh)(?:\s|\d)|(?:p|q|f|tp|tt|tx|h|x)\.\s*\S|tp\s*\S|[pqf]\s*\d)`,
  'g',
);

/** Chuỗi khoá để so mẫu: lowercase + bỏ dấu, cùng độ dài với chuỗi NFC gốc (căn chỉ số 1–1). */
const keyOf = (s: string) => stripDiacritics(s.toLowerCase());
const cleanTail = (s: string) => s.trim().replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '');

function lookupProvince(part: string): string | undefined {
  const n = normalizeVi(part).replace(/^(?:tinh|thanh pho|tp)\s+/, '');
  return PROVINCE_BY_ALIAS.get(n);
}

/** Cắt phần "đầu đường": số nhà, chuỗi hẻm, tên đường. */
function parseStreetPart(orig: string, key: string, out: ParsedAddress): void {
  const m = RE_STREET.exec(key);
  if (!m) return;
  const [, hnRaw, alleyText = '', rest = ''] = m;
  const street = cleanTail(orig.slice(key.length - rest.length));
  if (street) {
    out.street = street;
    out.streetNorm = normalizeVi(street);
  }
  let hn: string | undefined;
  if (hnRaw) {
    // Tìm số nhà SAU tiền tố (số/sn/lô/căn/kiot) để không bắt nhầm chữ số trong tiền tố
    const prefixLen = /^(?:(?:so(?:\s*nha)?|sn|lo|can|kiot)\.?\s*)?/.exec(key)?.[0].length ?? 0;
    const at = key.indexOf(hnRaw, prefixLen);
    hn = orig.slice(at, at + hnRaw.length);
  }
  const alleys = [...alleyText.matchAll(RE_ALLEY_EACH)];
  const alleyNums = alleys.map((a) => a[2] as string).reverse(); // "Ngách 15 Ngõ 78" → ngoài trước: ["78","15"]
  const segs = hn ? hn.split('/') : [];
  const house = segs.at(-1);
  const chain = [...alleyNums, ...segs.slice(0, -1).map((s) => s.toUpperCase())];
  if (alleys.length) {
    out.alleyKeyword = alleys[0]?.[1] as AlleyKeyword;
    out.alleyChain = chain;
    if (house) {
      out.houseInAlley = house;
      out.housenumber = [...chain, house].join('/');
    }
  } else if (hn) {
    out.housenumber = hn;
    out.alleyChain = chain;
    if (chain.length) out.houseInAlley = house;
  }
}

export function parseAddress(input: string): ParsedAddress {
  const out: ParsedAddress = { alleyChain: [], confidence: 0 };
  let orig = input
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .replace(/\s+-\s+/g, ', ')
    .trim()
    .replace(/,?\s*(?:việt nam|viet nam|vietnam)\.?\s*$/i, '')
    .replace(/,?\s*\b\d{5,6}\s*$/, '')
    .trim();
  if (!orig) return out;

  let parts = orig.split(',').map(cleanTail).filter(Boolean);
  if (parts.length === 1) {
    const key = keyOf(orig);
    const cuts = [...key.matchAll(RE_SPLIT)].map((m) => m.index ?? 0);
    parts = [0, ...cuts].map((start, i, arr) => cleanTail(orig.slice(start, arr[i + 1]))).filter(Boolean);
  }

  let streetIdx = -1;
  let firstAdminIdx = Number.POSITIVE_INFINITY; // vị trí phần hành chính đầu tiên (phường/quận/tỉnh)
  const unknown: { part: string; i: number }[] = [];
  const numbers: string[] = [];
  parts.forEach((part, i) => {
    const key = keyOf(part);
    if (!key) return;
    const markAdmin = () => {
      firstAdminIdx = Math.min(firstAdminIdx, i);
    };
    if (streetIdx < 0 && RE_STREET_LIKE.test(key)) {
      parseStreetPart(part, key, out);
      streetIdx = i;
      return;
    }
    const tinh = RE_TINH.exec(key);
    if (tinh) {
      markAdmin();
      out.province = lookupProvince(tinh[1] ?? '') ?? cleanTail(part.slice(key.length - (tinh[1] ?? '').length));
      return;
    }
    const city = RE_CITY.exec(key);
    if (city) {
      markAdmin();
      const rest = city[1] ?? '';
      const prov = lookupProvince(rest);
      if (prov) out.province = prov;
      else if (!out.district) out.district = cleanTail(part.slice(key.length - rest.length));
      return;
    }
    const d = RE_DISTRICT.exec(key);
    if (d) {
      markAdmin();
      const rest = d[1] ?? d[2] ?? '';
      if (!out.district) out.district = cleanTail(part.slice(key.length - rest.length));
      return;
    }
    const w = RE_WARD.exec(key);
    if (w) {
      markAdmin();
      const rest = w[1] ?? w[2] ?? '';
      if (!out.ward) out.ward = cleanTail(part.slice(key.length - rest.length));
      return;
    }
    const prov = lookupProvince(part);
    if (prov) {
      markAdmin();
      out.province = prov;
      return;
    }
    if (RE_IGNORE.test(key)) return;
    if (/^\d+$/.test(key)) {
      numbers.push(part);
      return;
    }
    unknown.push({ part, i });
  });

  // Không có phần "đầu đường" rõ ràng: phần chưa phân loại đứng TRƯỚC mọi phần hành chính là tên đường
  // ("Quốc lộ 1A, Xã …"); đứng SAU thì là phường/quận ("Thị trấn Hóc Môn, Hóc Môn").
  if (streetIdx < 0 && unknown.length && (unknown[0]?.i ?? 0) < firstAdminIdx) {
    const first = unknown.shift() as { part: string; i: number };
    parseStreetPart(first.part, keyOf(first.part), out);
    streetIdx = first.i;
  }
  for (const u of unknown) {
    if (u.i < streetIdx) continue; // tên toà nhà/POI đứng trước phần đường → bỏ
    if (!out.ward) out.ward = u.part;
    else if (!out.district) out.district = u.part;
  }
  for (const n of numbers) {
    if (!out.ward) out.ward = n;
    else if (!out.district) out.district = n;
  }

  out.confidence =
    Math.round(
      ((out.housenumber ? 0.25 : 0) + (out.street ? 0.35 : 0) + (out.ward ? 0.15 : 0) + (out.district ? 0.1 : 0) + (out.province ? 0.15 : 0)) * 100,
    ) / 100;
  return out;
}
```

Thêm vào `packages/core/src/index.ts`: `export * from './address';`

Run: `pnpm test`
Expected: 49 test curated + 2 test biên xanh; **đỏ duy nhất**: "có ≥ 300 dòng" và có thể "≥ 95%" (cho tới Step 6). Dòng curated đỏ → sửa mã (không sửa fixture curated, trừ khi kỳ vọng sai rõ ràng — ghi commit message).

- [ ] **Step 5: Lấy mẫu 300 địa chỉ thật từ Overture (ẩn danh: chỉ giữ chuỗi địa chỉ)**

`pipelines/poi/scripts/sample-addresses.mjs` (chạy **trong image**; đọc S3 công khai bằng DuckDB CLI, phân tầng 4 nhóm; ghi nháp `expected` bằng parser để người review sửa):
```js
#!/usr/bin/env node
// Dùng: node pipelines/poi/scripts/sample-addresses.mjs <OVERTURE_VER> >> packages/core/tests/fixtures/addresses.jsonl
import { execFileSync } from 'node:child_process';
import { parseAddress } from '../../../packages/core/dist/index.js';

const ver = process.argv[2];
if (!ver) throw new Error('Dùng: sample-addresses.mjs <OVERTURE_VER ví dụ 2026-08-20.0>');
const src = `s3://overturemaps-us-west-2/release/${ver}/theme=places/type=place/*.parquet`;
const base = `SELECT addresses[1].freeform AS a FROM read_parquet('${src}')
  WHERE bbox.xmin BETWEEN 102.1 AND 109.6 AND bbox.ymin BETWEEN 8.1 AND 23.5
    AND addresses[1].country = 'VN' AND length(addresses[1].freeform) BETWEEN 12 AND 120`;
const strata = [
  [`${base} AND a LIKE '%/%'`, 100],
  [`${base} AND regexp_matches(lower(strip_accents(a)), '(hem|ngo|ngach|kiet) ?[0-9]')`, 60],
  [`${base} AND regexp_matches(a, '(?i)(p\\.|q\\.|phường|quận)')`, 60],
  [`${base} AND a NOT LIKE '%/%'`, 80],
];
const sql = `INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';
${strata.map(([q, n], i) => `SELECT a FROM (${q}) USING SAMPLE reservoir(${n} ROWS) REPEATABLE (${41 + i})`).join(' UNION ALL ')};`;
const rows = JSON.parse(execFileSync('duckdb', ['-json', '-c', sql], { encoding: 'utf8', maxBuffer: 64 * 2 ** 20 }) || '[]');
const seen = new Set();
for (const { a } of rows) {
  const input = String(a).replace(/\s+/g, ' ').trim();
  if (seen.has(input)) continue;
  seen.add(input);
  const { confidence, ...draft } = parseAddress(input);
  process.stdout.write(`${JSON.stringify({ input, expected: draft, curated: false, reviewed: false })}\n`);
}
console.error(`✓ ${seen.size} địa chỉ (nháp expected bằng parser — PHẢI review tay)`);
```

Run: `pnpm --filter @mapslibvn/core build && PIPE pipeline node pipelines/poi/scripts/sample-addresses.mjs <OVERTURE_VER> >> packages/core/tests/fixtures/addresses.jsonl`
Expected: `✓ ~300 địa chỉ` (2–5 phút — DuckDB chỉ đọc row-group VN nhờ thống kê `bbox`). Nếu dưới 300 do trùng: tăng số dòng mỗi tầng thêm 20% và chạy lại (xoá phần đã nối trước).

- [ ] **Step 6: Review tay kỳ vọng (không bỏ qua)**

Mở `addresses.jsonl`, với **mỗi** dòng `"reviewed": false`: so `input` với `expected` nháp; sửa `expected` khi parser sai (ví dụ tên toà nhà lọt vào `ward`, tỉnh không nhận ra, số nhà dính chữ) — chỉ giữ trong `expected` các trường bạn chắc chắn; xoá dòng không phải địa chỉ (rác, tiếng nước ngoài); đổi `"reviewed": true`. Ghi số dòng đã sửa. Mục tiêu của bước này là kỳ vọng đúng **theo ngữ nghĩa**, không phải theo parser.

Run: `grep -c '"reviewed":false' packages/core/tests/fixtures/addresses.jsonl`
Expected: `0`.

Run: `pnpm test`
Expected: test "≥ 300 dòng" xanh; test "≥ 95%" in `address fixture: N/M khớp` — nếu < 95%: xem 10 ví dụ lệch, sửa parser (thêm rule vào `RE_IGNORE`/alias tỉnh/alley) rồi chạy lại; ghi DEVLOG các rule thêm.

- [ ] **Step 7: Ngân sách kích cỡ core ≤ 8 kB gzip (spec 7.1)**

`packages/core/.size-limit.json`:
```json
[{ "path": "dist/index.js", "limit": "8 kB", "gzip": true }]
```
`packages/core/package.json`: devDependencies thêm `"size-limit": "^11.1.0"`, `"@size-limit/file": "^11.1.0"`; script `build` nối `&& size-limit`.

Run: `pnpm install && pnpm --filter @mapslibvn/core build`
Expected: `dist/index.js … Size: X kB with all dependencies, minified and gzipped` với X ≤ 8. Nếu vượt: chuyển `provinces.json` + `brand_alias.json` sang subpath export `@mapslibvn/core/vi` (tsup entry thứ hai `src/vi.ts`, client web import từ `.`), ghi DEVLOG.

- [ ] **Step 8: Lint, typecheck, DEVLOG, commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`

Sửa `docs/DEVLOG.md`: "Task đang làm: Task 5"; mục 3: "Danh sách 34 tỉnh + alias tên cũ nằm trong `packages/core/src/provinces.json` (NQ 202/2025/QH15)"; mục 4 dòng `M2 T4` kèm tỉ lệ khớp fixture và số dòng review đã sửa.

```bash
git add -A
git commit -m "feat(core): parseAddress theo spec 5.7 — số nhà/chuỗi hẻm, đường, phường/quận/tỉnh (34 tỉnh 2025), fixture 49 curated + 300 địa chỉ thật"
git push
```

---

### Task 5: Ingest 3 nguồn — DuckDB/osmium → JSONL → `COPY` Postgres, fixture Quận 1

**Files:**
- Create: `pipelines/poi/package.json`, `pipelines/poi/tsconfig.json`, `pipelines/poi/README.md`, `pipelines/poi/src/lib/{env,vn-bbox,copy-format,geometry,osmium-id}.mjs`, `pipelines/poi/src/{duck,pg}.mjs`, `pipelines/poi/src/ingest/{osm,overture,fsq}.mjs`, `pipelines/poi/scripts/{make-vn-boundary,make-fixture}.mjs`, `pipelines/poi/data/vn-boundary.geojson`, `pipelines/poi/fixtures/{q1.osm.pbf,overture-q1.parquet,fsq-q1.parquet}`, `pipelines/poi/tests/{copy-format,geometry,osmium-id}.test.mjs`, `pipelines/poi/tests/ingest.dbtest.mjs`
- Modify: `pipelines/Dockerfile`, `infra/dev/compose.yml` (bind mount mã nguồn cho service `pipeline`), `.dockerignore`, `.github/workflows/dbtest.yml` (chạy trong image), `.env.example`

- [ ] **Step 1: Package, env, và test hàm định dạng COPY + tâm hình học (thất bại)**

`pipelines/poi/package.json`:
```json
{
  "name": "@mapslibvn/pipeline-poi",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Pipeline kho POI: ingest (DuckDB/osmium) → chuẩn hoá → gộp → anchors → Postgres → poi.pmtiles",
  "scripts": { "typecheck": "tsc -p tsconfig.json" },
  "dependencies": {
    "@duckdb/node-api": "1.5.5-r.4",
    "@mapslibvn/core": "workspace:*",
    "postgres": "^3.4.5"
  },
  "devDependencies": { "typescript": "^5.6.0" }
}
```

`pipelines/poi/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "allowJs": true, "checkJs": true, "noEmit": true, "types": ["node"], "module": "NodeNext", "moduleResolution": "NodeNext" },
  "include": ["src/**/*.mjs", "scripts/**/*.mjs"]
}
```

`pipelines/poi/src/lib/env.mjs`:
```js
import { resolve } from 'node:path';

export const WORK = process.env.MAPSLIBVN_WORK ?? resolve('work');
export const OUT = process.env.MAPSLIBVN_OUT ?? resolve('out');
export const POI_WORK = resolve(WORK, 'poi');
export const FIXTURES = resolve('pipelines/poi/fixtures');
export const VN_BOUNDARY = resolve('pipelines/poi/data/vn-boundary.geojson');
/** --fixture: chạy trên dữ liệu Quận 1 trong repo (test tích hợp, máy dev). */
export const FIXTURE = process.argv.includes('--fixture');
/** PBF đã patch chủ quyền do pipeline tiles tạo (M1b), hoặc fixture. */
export const OSM_PBF = FIXTURE ? resolve(FIXTURES, 'q1.osm.pbf') : resolve(WORK, 'vietnam-patched.osm.pbf');

/** @param {string} release ví dụ 2026-08-20.0 */
export const overtureSource = (release) =>
  FIXTURE ? resolve(FIXTURES, 'overture-q1.parquet') : `s3://overturemaps-us-west-2/release/${release}/theme=places/type=place/*.parquet`;
/** FSQ OS Places qua Hugging Face (gated; S3 công khai đã đóng 2026). @param {string} dt ví dụ 2026-08-11 */
export const fsqSource = (dt) =>
  FIXTURE ? resolve(FIXTURES, 'fsq-q1.parquet') : `hf://datasets/foursquare/fsq-os-places/release/dt=${dt}/places/parquet/*.parquet`;

/** @param {string} name @param {string | undefined} fallback */
export function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

/** Ngày giờ VN dạng YYYY-MM-DD */
export function vnDate(d = new Date()) {
  return new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}
```

`pipelines/poi/src/lib/vn-bbox.mjs`:
```js
/** Bbox lọc sơ bộ Overture/FSQ: đất liền + Phú Quốc + Côn Đảo. Hoàng Sa/Trường Sa (lon > 111) cố ý nằm ngoài —
 *  POI thương mại ở hai quần đảo không nhận từ nguồn nước ngoài; tên đảo lấy từ OSM đã patch (spec 4.3). */
export const VN_BBOX = /** @type {[number, number, number, number]} */ ([102.1, 8.1, 109.6, 23.5]);
export const Q1_BBOX = /** @type {[number, number, number, number]} */ ([106.68, 10.76, 106.72, 10.8]);

/** Điều kiện SQL DuckDB cho cột bbox struct của Overture. @param {[number, number, number, number]} b */
export const overtureBboxWhere = (b) => `bbox.xmin >= ${b[0]} AND bbox.xmax <= ${b[2]} AND bbox.ymin >= ${b[1]} AND bbox.ymax <= ${b[3]}`;
/** Điều kiện SQL cho cột lon/lat. @param {[number, number, number, number]} b */
export const lonLatWhere = (b, lon = 'longitude', lat = 'latitude') =>
  `${lon} BETWEEN ${b[0]} AND ${b[2]} AND ${lat} BETWEEN ${b[1]} AND ${b[3]}`;
```

`pipelines/poi/tests/copy-format.test.mjs`:
```js
import { describe, expect, it } from 'vitest';
import { copyRow, copyText, ewkt, pgArray, pgJson } from '../src/lib/copy-format.mjs';

describe('copyText', () => {
  it('NULL → \\N; escape tab, newline, backslash', () => {
    expect(copyText(null)).toBe('\\N');
    expect(copyText(undefined)).toBe('\\N');
    expect(copyText('a\tb\nc\\d')).toBe('a\\tb\\nc\\\\d');
    expect(copyText(12)).toBe('12');
  });
});

describe('pgArray / pgJson / ewkt', () => {
  it('text[] literal có quote và escape', () => {
    expect(pgArray(['a', 'b"c', 'd\\e'])).toBe('{"a","b\\"c","d\\\\e"}');
    expect(pgArray([])).toBe('{}');
    expect(pgArray(null)).toBeNull();
  });
  it('json giữ unicode, null → null', () => {
    expect(pgJson({ name: 'Cà phê Cộng' })).toBe('{"name":"Cà phê Cộng"}');
    expect(pgJson(null)).toBeNull();
  });
  it('EWKT điểm 4326', () => {
    expect(ewkt(106.7, 10.77)).toBe('SRID=4326;POINT(106.7 10.77)');
  });
  it('copyRow ghép tab + newline, array literal được escape lần nữa cho COPY', () => {
    expect(copyRow(['x', null, pgArray(['a"b'])])).toBe('x\t\\N\t{"a\\\\"b"}\n');
  });
});
```

`pipelines/poi/tests/geometry.test.mjs`:
```js
import { describe, expect, it } from 'vitest';
import { featureCentroid, polygonCentroid } from '../src/lib/geometry.mjs';

describe('polygonCentroid', () => {
  it('hình vuông → tâm', () => {
    expect(polygonCentroid([[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]])).toEqual([1, 1]);
  });
  it('đa giác suy biến (diện tích 0) → trung bình đỉnh', () => {
    expect(polygonCentroid([[0, 0], [2, 0], [0, 0]])).toEqual([1, 0]);
  });
});

describe('featureCentroid', () => {
  it('Point giữ nguyên; Polygon lấy vòng ngoài; MultiPolygon lấy phần lớn nhất; khác → null', () => {
    expect(featureCentroid({ type: 'Point', coordinates: [106.7, 10.77] })).toEqual([106.7, 10.77]);
    expect(featureCentroid({ type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]], [[0.5, 0.5], [1, 0.5], [1, 1], [0.5, 0.5]]] })).toEqual([1, 1]);
    expect(
      featureCentroid({ type: 'MultiPolygon', coordinates: [[[[10, 10], [11, 10], [11, 11], [10, 10]]], [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]]] }),
    ).toEqual([2, 2]);
    expect(featureCentroid({ type: 'LineString', coordinates: [[0, 0], [1, 1]] })).toBeNull();
    expect(featureCentroid(null)).toBeNull();
  });
});
```

`pipelines/poi/tests/osmium-id.test.mjs` (id do `osmium export --add-unique-id=type_id` sinh: node/way/relation là `n…`/`w…`/`r…`; **vùng** (polygon dựng từ way đóng hoặc relation) là `a…` với area id = way·2 hoặc relation·2+1):
```js
import { describe, expect, it } from 'vitest';
import { parseOsmiumId } from '../src/lib/osmium-id.mjs';

describe('parseOsmiumId', () => {
  it('n/w/r trực tiếp; a = area: chẵn → way/2, lẻ → relation (id-1)/2', () => {
    expect(parseOsmiumId('n123')).toEqual({ type: 'n', id: 123 });
    expect(parseOsmiumId('w45')).toEqual({ type: 'w', id: 45 });
    expect(parseOsmiumId('r7')).toEqual({ type: 'r', id: 7 });
    expect(parseOsmiumId('a90')).toEqual({ type: 'w', id: 45 });
    expect(parseOsmiumId('a15')).toEqual({ type: 'r', id: 7 });
    expect(parseOsmiumId('x1')).toBeNull();
    expect(parseOsmiumId(undefined)).toBeNull();
  });
});
```

Run: `pnpm install && pnpm test`
Expected: FAIL — không tìm thấy `../src/lib/copy-format.mjs`, `../src/lib/geometry.mjs`, `../src/lib/osmium-id.mjs`.

- [ ] **Step 2: Hàm thuần `copy-format.mjs`, `geometry.mjs`, `osmium-id.mjs`**

`pipelines/poi/src/lib/osmium-id.mjs`:
```js
/** ID do `osmium export --add-unique-id=type_id` sinh: n/w/r<id>, hoặc a<area_id> (chẵn = way·2, lẻ = relation·2+1). @param {unknown} s */
export function parseOsmiumId(s) {
  const m = /^([nwra])(\d+)$/.exec(String(s ?? ''));
  if (!m) return null;
  const n = Number(m[2]);
  if (m[1] !== 'a') return { type: /** @type {'n' | 'w' | 'r'} */ (m[1]), id: n };
  return n % 2 === 0 ? { type: /** @type {const} */ ('w'), id: n / 2 } : { type: /** @type {const} */ ('r'), id: (n - 1) / 2 };
}
```

`pipelines/poi/src/lib/copy-format.mjs`:
```js
// Định dạng COPY … FROM STDIN (text): tab ngăn cột, \N là NULL, escape \ \t \n \r.

/** @param {unknown} v */
export function copyText(v) {
  if (v === null || v === undefined) return '\\N';
  return String(v).replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

/** @param {unknown[]} values */
export function copyRow(values) {
  return `${values.map(copyText).join('\t')}\n`;
}

/** text[] → literal Postgres {"a","b"}. @param {unknown[] | null | undefined} list */
export function pgArray(list) {
  if (list === null || list === undefined) return null;
  return `{${list.map((x) => `"${String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;
}

/** @param {unknown} v */
export function pgJson(v) {
  return v === null || v === undefined ? null : JSON.stringify(v);
}

/** @param {number} lon @param {number} lat */
export function ewkt(lon, lat) {
  return `SRID=4326;POINT(${lon} ${lat})`;
}
```

`pipelines/poi/src/lib/geometry.mjs`:
```js
/** Tâm diện tích (shoelace) của một vòng; suy biến → trung bình đỉnh. @param {number[][]} ring */
export function polygonCentroid(ring) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = /** @type {[number, number]} */ (ring[i]);
    const [x1, y1] = /** @type {[number, number]} */ (ring[i + 1]);
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-12) {
    const pts = ring.slice(0, -1);
    return [pts.reduce((s, p) => s + (p[0] ?? 0), 0) / pts.length, pts.reduce((s, p) => s + (p[1] ?? 0), 0) / pts.length];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** @param {number[][]} ring */
function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += (ring[i]?.[0] ?? 0) * (ring[i + 1]?.[1] ?? 0) - (ring[i + 1]?.[0] ?? 0) * (ring[i]?.[1] ?? 0);
  return Math.abs(a) / 2;
}

/**
 * Điểm đại diện cho geometry GeoJSON: Point → chính nó; Polygon → tâm vòng ngoài; MultiPolygon → tâm đa giác lớn nhất.
 * @param {{ type: string, coordinates: unknown } | null | undefined} g
 * @returns {[number, number] | null}
 */
export function featureCentroid(g) {
  if (!g) return null;
  if (g.type === 'Point') return /** @type {[number, number]} */ (g.coordinates);
  if (g.type === 'Polygon') {
    const c = polygonCentroid(/** @type {number[][][]} */ (g.coordinates)[0] ?? []);
    return [c[0] ?? 0, c[1] ?? 0];
  }
  if (g.type === 'MultiPolygon') {
    const polys = /** @type {number[][][][]} */ (g.coordinates);
    const biggest = polys.reduce((best, p) => (ringArea(p[0] ?? []) > ringArea(best[0] ?? []) ? p : best), polys[0] ?? []);
    const c = polygonCentroid(biggest[0] ?? []);
    return [c[0] ?? 0, c[1] ?? 0];
  }
  return null;
}
```

Run: `pnpm test`
Expected: xanh.

- [ ] **Step 3: `duck.mjs` và `pg.mjs`**

`pipelines/poi/src/duck.mjs` (bọc `@duckdb/node-api`; tên phương thức theo README của bản pin — kiểm `node_modules/@duckdb/node-api/README.md` nếu khác):
```js
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { POI_WORK } from './lib/env.mjs';

/** Mở DuckDB in-memory có spatial + httpfs, giới hạn RAM (mặc định 3GB), tạm trong work/poi/duck-tmp. */
export async function openDuck({ memory = process.env.DUCKDB_MEMORY ?? '3GB', threads = process.env.DUCKDB_THREADS ?? '4' } = {}) {
  const tmp = resolve(POI_WORK, 'duck-tmp');
  mkdirSync(tmp, { recursive: true });
  const instance = await DuckDBInstance.create(':memory:', { memory_limit: memory, threads: String(threads), temp_directory: tmp });
  const conn = await instance.connect();
  await conn.run('INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs;');
  return {
    /** @param {string} sql */
    run: (sql) => conn.run(sql),
    /** Kết quả nhỏ (đếm, DESCRIBE). BigInt → Number. @param {string} sql */
    all: async (sql) => {
      const reader = await conn.runAndReadAll(sql);
      return reader.getRowObjects().map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])));
    },
    /** Đọc S3 công khai không cần khoá. @param {string} region */
    anonymousS3: (region) => conn.run(`CREATE OR REPLACE SECRET s3anon (TYPE s3, REGION '${region}')`),
    /** Dataset gated trên Hugging Face (FSQ). Cần HF_TOKEN; bỏ qua khi --fixture (đọc file local). */
    huggingface: () => {
      const token = process.env.HF_TOKEN;
      if (!token) {
        if (process.argv.includes('--fixture')) return Promise.resolve();
        throw new Error('Thiếu HF_TOKEN (token Read của Hugging Face, đã chấp nhận điều khoản foursquare/fsq-os-places)');
      }
      return conn.run(`CREATE OR REPLACE SECRET hf (TYPE huggingface, TOKEN '${token.replace(/'/g, "''")}')`);
    },
    close: () => {
      conn.closeSync();
      instance.closeSync();
    },
  };
}
```

`pipelines/poi/src/pg.mjs`:
```js
import 'dotenv/config';
import { createReadStream, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import postgres from 'postgres';
import { databaseUrlFromEnv } from '../../../scripts/lib/migrations.mjs';
import { copyRow } from './lib/copy-format.mjs';
import { VN_BOUNDARY } from './lib/env.mjs';

export function connect() {
  // work_mem cao cho session pipeline: sort/hash của poi_work_pair (hàng chục triệu dòng) không tràn đĩa với 32MB mặc định
  return postgres(databaseUrlFromEnv(process.env), {
    max: 4, onnotice: () => {}, idle_timeout: 60, connect_timeout: 30, connection: { work_mem: '512MB' },
  });
}

/** Tạo bảng <name>_new giống <name> (INCLUDING ALL: cột, default, CHECK, index; KHÔNG copy FK — bảng thật giữ FK). */
export async function createNewTable(sql, name) {
  await sql.unsafe(`DROP TABLE IF EXISTS ${name}_new`);
  await sql.unsafe(`CREATE TABLE ${name}_new (LIKE ${name} INCLUDING ALL)`);
}

/** COPY … FROM STDIN từ một (async) iterable các mảng giá trị. Trả số dòng. */
export async function copyInto(sql, table, columns, rows) {
  let n = 0;
  const writable = await sql`COPY ${sql(table)} (${sql(columns)}) FROM STDIN`.writable();
  async function* chunks() {
    for await (const r of rows) {
      n++;
      yield copyRow(r);
    }
  }
  await pipeline(Readable.from(chunks()), writable);
  return n;
}

/** Đọc JSONL từng dòng. Bỏ ký tự RS (mã 30, GeoJSON Text Sequence) nếu đứng đầu dòng. @param {string} file */
export async function* readJsonl(file) {
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Number.POSITIVE_INFINITY });
  for await (const raw of rl) {
    const line = (raw.charCodeAt(0) === 30 ? raw.slice(1) : raw).trim();
    if (line) yield JSON.parse(line);
  }
}

/**
 * Phát hành: trong MỘT transaction TRUNCATE các bảng (một câu — thoả FK), INSERT … SELECT từ <name>_new, chỉnh sequence, DROP <name>_new.
 * Bảng thật giữ nguyên identity (FK, index, grant); dữ liệu cũ vẫn phục vụ cho đến COMMIT.
 * @param {string[]} names theo thứ tự: bảng cha trước
 */
export async function publishNew(sql, names) {
  await sql.begin(async (tx) => {
    await tx.unsafe(`TRUNCATE ${names.join(', ')}`);
    for (const name of names) {
      await tx.unsafe(`INSERT INTO ${name} SELECT * FROM ${name}_new`);
      // pg_get_serial_sequence NÉM LỖI (không trả NULL) khi bảng không có cột id — src_*, admin_alias. Kiểm cột trước.
      const [col] = await tx.unsafe(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${name}' AND column_name = 'id'`,
      );
      if (col) {
        const [seq] = await tx.unsafe(`SELECT pg_get_serial_sequence('${name}', 'id') AS s`);
        if (seq?.s) await tx.unsafe(`SELECT setval('${seq.s}', COALESCE((SELECT max(id) FROM ${name}), 0) + 1, false)`);
      }
      await tx.unsafe(`DROP TABLE ${name}_new`);
    }
  });
}

/** Bảng phụ vn_boundary (đa giác VN đệm 2 km, chia nhỏ) — tạo một lần từ data/vn-boundary.geojson. */
export async function ensureVnBoundary(sql) {
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS vn_boundary (id serial PRIMARY KEY, geom geometry(Polygon, 4326) NOT NULL)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS vn_boundary_geom_idx ON vn_boundary USING gist (geom)`);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM vn_boundary`;
  if (n > 0) return;
  const geometry = JSON.stringify(JSON.parse(readFileSync(VN_BOUNDARY, 'utf8')).geometry);
  await sql`INSERT INTO vn_boundary (geom)
    SELECT ST_Subdivide(ST_Buffer(ST_GeomFromGeoJSON(${geometry})::geography, 2000)::geometry, 256)`;
}

/** Xoá bản ghi ngoài VN (đệm 2 km). Trả số dòng xoá. */
export async function deleteOutsideVn(sql, table) {
  const r = await sql.unsafe(`DELETE FROM ${table} t WHERE NOT EXISTS (SELECT 1 FROM vn_boundary b WHERE ST_Intersects(b.geom, t.geom))`);
  return r.count;
}

/** @param {string} table */
export async function countRows(sql, table) {
  const [{ n }] = await sql.unsafe(`SELECT count(*)::int AS n FROM ${table}`);
  return Number(n);
}
```

- [ ] **Step 4: Ranh giới VN (Natural Earth, public domain) — sinh một lần và commit**

`pipelines/poi/scripts/make-vn-boundary.mjs`:
```js
#!/usr/bin/env node
// Tải Natural Earth 10m admin_0 countries (public domain), lấy Việt Nam, đơn giản hoá 0,002° → data/vn-boundary.geojson (commit).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from '../../../scripts/lib/run.mjs';
import { POI_WORK, VN_BOUNDARY } from '../src/lib/env.mjs';

mkdirSync(POI_WORK, { recursive: true });
const zip = resolve(POI_WORK, 'ne_10m_admin_0_countries.zip');
const out = resolve(POI_WORK, 'vn-ne.json');
run('curl', ['-fsSL', '--retry', '5', '-o', zip, 'https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_countries.zip']);
run('duckdb', ['-c', `INSTALL spatial; LOAD spatial;
COPY (SELECT ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.002)) AS geometry
      FROM ST_Read('/vsizip/${zip}/ne_10m_admin_0_countries.shp') WHERE ADM0_A3 = 'VNM') TO '${out}' (FORMAT json);`]);
const first = readFileSync(out, 'utf8').split('\n').find((l) => l.trim());
if (!first) throw new Error('Không thấy Việt Nam trong Natural Earth');
const geometry = JSON.parse(JSON.parse(first).geometry);
writeFileSync(
  VN_BOUNDARY,
  JSON.stringify({ type: 'Feature', properties: { source: 'Natural Earth 10m admin_0_countries (public domain)', simplify_deg: 0.002 }, geometry }),
);
console.log(`✓ ${VN_BOUNDARY} (${geometry.type}, ${JSON.stringify(geometry).length} byte)`);
```

Run (sau Step 5 để có bind mount): `mkdir -p pipelines/poi/data && PIPE pipeline node pipelines/poi/scripts/make-vn-boundary.mjs && ls -la pipelines/poi/data/`
Expected: `✓ … (MultiPolygon, N byte)` với N < 300.000.

- [ ] **Step 5: Image và compose dev**

`pipelines/Dockerfile` stage `app` — sau `RUN pnpm install … && node packages/style/scripts/build.mjs` thêm lớp cài sẵn extension DuckDB cho `@duckdb/node-api` (để chạy offline/nhanh):
```dockerfile
RUN cd pipelines/poi && node -e "import('@duckdb/node-api').then(async (m) => { const i = await m.DuckDBInstance.create(':memory:'); const c = await i.connect(); await c.run('INSTALL spatial; INSTALL httpfs;'); console.log('duckdb node-api + extensions OK'); })"
```

`infra/dev/compose.yml` service `pipeline` — thêm bind mount mã nguồn (dev sửa code không cần build lại image; `node_modules` vẫn của image vì symlink pnpm là tương đối):
```yaml
    volumes:
      - pipeline-work:/app/work
      - pipeline-out:/app/out
      - ../../pipelines:/app/pipelines
      - ../../scripts:/app/scripts
      - ../../db:/app/db
      - ../../infra:/app/infra
      - ../../packages/core/dist:/app/packages/core/dist
      - ../../packages/style/dist:/app/packages/style/dist
```

`.dockerignore` thêm dòng `pipelines/poi/fixtures` (fixture nạp qua bind mount, không vào image).

Thêm vào `.env.example`:
```
# ---- Nguồn POI (M2) — để trống thì data:update tự dò bản mới nhất ----
OVERTURE_RELEASE=
FSQ_RELEASE=
# Token Read của Hugging Face — dataset gated foursquare/fsq-os-places (chấp nhận điều khoản trên web trước)
HF_TOKEN=
DUCKDB_MEMORY=3GB
DUCKDB_THREADS=4
```

Run: `pnpm --filter @mapslibvn/core build && pnpm --filter @mapslibvn/style build && pnpm image:build && PIPE pipeline sh -c "cd pipelines/poi && node -e \"import('@duckdb/node-api').then(async m=>{const i=await m.DuckDBInstance.create(':memory:');const c=await i.connect();await c.run('LOAD spatial; LOAD httpfs'); console.log('ok')})\""`
Expected: `ok` (không tải extension). Rồi chạy Step 4. (Build `dist` của core/style trên host trước để bind mount không tạo thư mục rỗng thuộc root trên Linux.)

- [ ] **Step 6: Ingest OSM (`osmium` → GeoJSONSeq → COPY)**

`pipelines/poi/src/ingest/osm.mjs`:
```js
#!/usr/bin/env node
// OSM POI + đối tượng có số nhà từ PBF đã patch chủ quyền: osmium tags-filter → osmium export (GeoJSONSeq) → tâm hình → COPY src_osm_place.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from '../../../../scripts/lib/run.mjs';
import { ewkt, pgJson } from '../lib/copy-format.mjs';
import { OSM_PBF, POI_WORK, vnDate } from '../lib/env.mjs';
import { featureCentroid } from '../lib/geometry.mjs';
import { parseOsmiumId } from '../lib/osmium-id.mjs';
import { connect, copyInto, countRows, createNewTable, deleteOutsideVn, ensureVnBoundary, publishNew, readJsonl } from '../pg.mjs';

/** Khoá tag coi là "địa điểm" + đối tượng có số nhà (cho address_anchor ở Task 8). */
export const OSM_POI_FILTERS = [
  'nwr/amenity', 'nwr/shop', 'nwr/tourism', 'nwr/leisure', 'nwr/office', 'nwr/craft', 'nwr/healthcare', 'nwr/historic',
  'nwr/public_transport', 'nwr/aeroway=aerodrome,terminal', 'nwr/railway=station,halt', 'nwr/addr:housenumber',
];

mkdirSync(POI_WORK, { recursive: true });
const filtered = resolve(POI_WORK, 'osm-pois.osm.pbf');
const seq = resolve(POI_WORK, 'osm-pois.geojsonseq');
const release = vnDate();

run('osmium', ['tags-filter', '--overwrite', '-o', filtered, OSM_PBF, ...OSM_POI_FILTERS]);
run('osmium', ['export', '--overwrite', '-f', 'geojsonseq', '-x', 'print_record_separator=false', '--add-unique-id=type_id',
  '--geometry-types=point,polygon', '-o', seq, filtered]);

async function* rows() {
  for await (const f of readJsonl(seq)) {
    const c = featureCentroid(f.geometry);
    const id = parseOsmiumId(f.properties?.id); // vùng (polygon) mang id 'a…' → quy về way/relation gốc
    if (!c || !id) continue;
    const { id: _id, ...tags } = f.properties;
    const names = Object.fromEntries(Object.entries(tags).filter(([k]) => k === 'name' || k.startsWith('name:')));
    yield [id.type, String(id.id), tags.name ?? null, Object.keys(names).length ? pgJson(names) : null, pgJson(tags), ewkt(c[0], c[1]), release];
  }
}

const sql = connect();
try {
  await ensureVnBoundary(sql);
  await createNewTable(sql, 'src_osm_place');
  const copied = await copyInto(sql, 'src_osm_place_new', ['osm_type', 'osm_id', 'name', 'names', 'tags', 'geom', 'release'], rows());
  const removed = await deleteOutsideVn(sql, 'src_osm_place_new');
  await publishNew(sql, ['src_osm_place']);
  console.log(`✓ src_osm_place: ${await countRows(sql, 'src_osm_place')} dòng (COPY ${copied}, ngoài VN ${removed}, release ${release})`);
} finally {
  await sql.end();
}
```

Run: `PIPE pipeline node pipelines/poi/src/ingest/osm.mjs --fixture`
Expected: log osmium (2 lệnh, vài giây), rồi `✓ src_osm_place: N dòng (COPY N, ngoài VN 0, …)` với N ≈ 2.000–8.000 cho Quận 1 (cần fixture ở Step 8 — tạo fixture trước nếu chưa có). Nếu osmium báo `unknown option -x`: bỏ `-x print_record_separator=false` (readJsonl đã bỏ RS).

- [ ] **Step 7: Ingest Overture và Foursquare (DuckDB S3 → JSONL → COPY)**

`pipelines/poi/src/ingest/overture.mjs`:
```js
#!/usr/bin/env node
// Overture Places (CDLA-Permissive 2.0): đọc parquet S3 công khai theo bbox VN → JSONL → COPY src_overture_place.
// Dùng: node overture.mjs --release 2026-08-20.0 [--fixture]
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDuck } from '../duck.mjs';
import { ewkt, pgArray, pgJson } from '../lib/copy-format.mjs';
import { FIXTURE, POI_WORK, arg, overtureSource } from '../lib/env.mjs';
import { VN_BBOX, overtureBboxWhere } from '../lib/vn-bbox.mjs';
import { connect, copyInto, countRows, createNewTable, deleteOutsideVn, ensureVnBoundary, publishNew, readJsonl } from '../pg.mjs';

const release = arg('--release', process.env.OVERTURE_RELEASE) ?? (FIXTURE ? 'fixture-q1' : undefined);
if (!release) throw new Error('Thiếu --release <ver> (hoặc OVERTURE_RELEASE)');
mkdirSync(POI_WORK, { recursive: true });
const out = resolve(POI_WORK, 'overture.jsonl');

const duck = await openDuck();
try {
  await duck.anonymousS3('us-west-2');
  await duck.run(`COPY (
    SELECT id, names.primary AS name, names, categories.primary AS category, categories, confidence, addresses, websites, phones, sources,
           socials, operating_status,
           ST_X(geometry) AS lon, ST_Y(geometry) AS lat            -- geometry là GEOMETRY native (DuckDB 1.5), không phải WKB
    FROM read_parquet('${overtureSource(release)}', hive_partitioning = true)
    WHERE ${overtureBboxWhere(VN_BBOX)}
  ) TO '${out}' (FORMAT json)`);
} finally {
  duck.close();
}

async function* rows() {
  for await (const r of readJsonl(out)) {
    if (r.lon === null || r.lat === null) continue;
    // socials/operating_status nhét vào sources JSON để không đổi lược đồ 0002: records.mjs đọc lại từ đó
    const sources = [...(r.sources ?? []), { dataset: '_overture_extra', socials: r.socials ?? [], operating_status: r.operating_status ?? null }];
    yield [r.id, r.name ?? null, pgJson(r.names), r.category ?? null, pgJson(r.categories), r.confidence ?? null, pgJson(r.addresses),
      pgArray(r.websites), pgArray(r.phones), pgJson(sources), ewkt(r.lon, r.lat), release];
  }
}

const sql = connect();
try {
  await ensureVnBoundary(sql);
  await createNewTable(sql, 'src_overture_place');
  const copied = await copyInto(sql, 'src_overture_place_new',
    ['id', 'name', 'names', 'category', 'categories', 'confidence', 'addresses', 'websites', 'phones', 'sources', 'geom', 'release'], rows());
  const removed = await deleteOutsideVn(sql, 'src_overture_place_new');
  await publishNew(sql, ['src_overture_place']);
  console.log(`✓ src_overture_place: ${await countRows(sql, 'src_overture_place')} dòng (COPY ${copied}, ngoài VN ${removed}, release ${release})`);
} finally {
  await sql.end();
}
```

`pipelines/poi/src/ingest/fsq.mjs`:
```js
#!/usr/bin/env node
// Foursquare OS Places (Apache-2.0, gated trên Hugging Face — cần HF_TOKEN): parquet theo bbox VN → JSONL → COPY src_fsq_place.
// Dùng: node fsq.mjs --release 2026-08-11 [--fixture]
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDuck } from '../duck.mjs';
import { ewkt, pgJson } from '../lib/copy-format.mjs';
import { FIXTURE, POI_WORK, arg, fsqSource } from '../lib/env.mjs';
import { VN_BBOX, lonLatWhere } from '../lib/vn-bbox.mjs';
import { connect, copyInto, countRows, createNewTable, deleteOutsideVn, ensureVnBoundary, publishNew, readJsonl } from '../pg.mjs';

const release = arg('--release', process.env.FSQ_RELEASE) ?? (FIXTURE ? '2000-01-01' : undefined);
if (!release) throw new Error('Thiếu --release <YYYY-MM-DD> (hoặc FSQ_RELEASE)');
mkdirSync(POI_WORK, { recursive: true });
const out = resolve(POI_WORK, 'fsq.jsonl');

const duck = await openDuck();
try {
  await duck.huggingface();
  await duck.run(`COPY (
    SELECT fsq_place_id, name, fsq_category_labels AS categories, address, locality, region, tel, website,
           NULLIF(date_closed, '') AS date_closed,                 -- date_closed là VARCHAR trong parquet FSQ
           longitude AS lon, latitude AS lat
    FROM read_parquet('${fsqSource(release)}')
    WHERE ${lonLatWhere(VN_BBOX)} AND (country IS NULL OR country = 'VN')
  ) TO '${out}' (FORMAT json)`);
} finally {
  duck.close();
}

async function* rows() {
  for await (const r of readJsonl(out)) {
    yield [r.fsq_place_id, r.name ?? null, pgJson(r.categories), r.address ?? null, r.locality ?? null, r.region ?? null, r.tel ?? null,
      r.website ?? null, r.date_closed ?? null, ewkt(r.lon, r.lat), release];
  }
}

const sql = connect();
try {
  await ensureVnBoundary(sql);
  await createNewTable(sql, 'src_fsq_place');
  const copied = await copyInto(sql, 'src_fsq_place_new',
    ['fsq_place_id', 'name', 'categories', 'address', 'locality', 'region', 'tel', 'website', 'date_closed', 'geom', 'release'], rows());
  const removed = await deleteOutsideVn(sql, 'src_fsq_place_new');
  await publishNew(sql, ['src_fsq_place']);
  console.log(`✓ src_fsq_place: ${await countRows(sql, 'src_fsq_place')} dòng (COPY ${copied}, ngoài VN ${removed}, release ${release})`);
} finally {
  await sql.end();
}
```

SELECT ở trên đã theo lược đồ thật đo ngày 27/08 (G4/G5). Nếu release mới đổi cột: `DESCRIBE` lại như Task 0 Step 2 rồi sửa, ghi DEVLOG.

- [ ] **Step 8: Fixture Quận 1 (commit, ≤ 20 MB)**

`pipelines/poi/scripts/make-fixture.mjs`:
```js
#!/usr/bin/env node
// Tạo fixture Quận 1 cũ: q1.osm.pbf (từ PBF đã patch), overture-q1.parquet, fsq-q1.parquet (cột thô, giữ nguyên lược đồ nguồn).
// Dùng: node make-fixture.mjs --overture 2026-08-20.0 --fsq 2026-08-05
import { mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from '../../../scripts/lib/run.mjs';
import { openDuck } from '../src/duck.mjs';
import { FIXTURES, WORK, arg, fsqSource, overtureSource } from '../src/lib/env.mjs';
import { Q1_BBOX, lonLatWhere, overtureBboxWhere } from '../src/lib/vn-bbox.mjs';

const overture = arg('--overture', process.env.OVERTURE_RELEASE);
const fsq = arg('--fsq', process.env.FSQ_RELEASE);
if (!overture || !fsq) throw new Error('Dùng: make-fixture.mjs --overture <ver> --fsq <YYYY-MM-DD>');
mkdirSync(FIXTURES, { recursive: true });

// -s smart -S types=any: giữ trọn relation (ranh giới hành chính, multipolygon) chạm bbox để Task 8 dựng được admin_area trên fixture
run('osmium', ['extract', '--overwrite', '-s', 'smart', '-S', 'types=any', '-b', Q1_BBOX.join(','), resolve(WORK, 'vietnam-patched.osm.pbf'), '-o', resolve(FIXTURES, 'q1.osm.pbf')]);

const duck = await openDuck();
try {
  await duck.anonymousS3('us-west-2');
  await duck.run(`COPY (SELECT * FROM read_parquet('${overtureSource(overture)}', hive_partitioning = true) WHERE ${overtureBboxWhere(Q1_BBOX)})
    TO '${resolve(FIXTURES, 'overture-q1.parquet')}' (FORMAT parquet, COMPRESSION zstd)`);
  await duck.huggingface();
  await duck.run(`COPY (SELECT * FROM read_parquet('${fsqSource(fsq)}') WHERE ${lonLatWhere(Q1_BBOX)})
    TO '${resolve(FIXTURES, 'fsq-q1.parquet')}' (FORMAT parquet, COMPRESSION zstd)`);
} finally {
  duck.close();
}
for (const f of ['q1.osm.pbf', 'overture-q1.parquet', 'fsq-q1.parquet']) console.log(f, `${(statSync(resolve(FIXTURES, f)).size / 2 ** 20).toFixed(1)} MB`);
```

Run: `PIPE pipeline node pipelines/poi/scripts/make-fixture.mjs --overture <OVERTURE_VER> --fsq <FSQ_DT>`
Expected: 3 dòng kích cỡ; tổng ≤ 20 MB (Overture ~5–10 nghìn dòng ≈ 2–4 MB; FSQ ≈ 1–2 MB; PBF ≈ 3–6 MB). FSQ đọc toàn bộ ~10 GB partition qua Hugging Face (không có thống kê theo toạ độ) — 20–40 phút lần đầu, cần `HF_TOKEN` trong `.env`; chấp nhận vì chỉ tạo fixture một lần. Nếu tổng > 20 MB: thu bbox còn `106.69,10.77,106.71,10.79` (đổi `Q1_BBOX`) và chạy lại.

Chạy 3 ingest trên fixture:
Run: `PIPE pipeline sh -c "node pipelines/poi/src/ingest/osm.mjs --fixture && node pipelines/poi/src/ingest/overture.mjs --fixture && node pipelines/poi/src/ingest/fsq.mjs --fixture"`
Expected: 3 dòng `✓ src_*: N dòng`, N > 0 cho cả ba.

- [ ] **Step 9: Test tích hợp ingest (dbtest, chạy trong image)**

`pipelines/poi/tests/ingest.dbtest.mjs`:
```js
// Chạy trong image: PIPE pipeline pnpm test:db  (cần osmium, duckdb, Postgres host `postgres`)
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseUrlFromEnv } from '../../../scripts/lib/migrations.mjs';

const sql = postgres(databaseUrlFromEnv(process.env), { max: 1, onnotice: () => {} });
const node = (/** @type {string[]} */ ...args) => execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const duckCount = (/** @type {string} */ file) =>
  Number(execFileSync('duckdb', ['-csv', '-noheader', '-c', `SELECT count(*) FROM read_parquet('${file}')`], { encoding: 'utf8' }).trim());

beforeAll(() => {
  node('scripts/db-migrate.mjs');
  node('pipelines/poi/src/ingest/osm.mjs', '--fixture');
  node('pipelines/poi/src/ingest/overture.mjs', '--fixture');
  node('pipelines/poi/src/ingest/fsq.mjs', '--fixture');
});
afterAll(() => sql.end());

describe('ingest fixture Quận 1', () => {
  it('src_overture_place và src_fsq_place khớp số dòng parquet (±0 — Quận 1 nằm trọn trong VN)', async () => {
    const [[o], [f]] = await Promise.all([sql`SELECT count(*)::int AS n FROM src_overture_place`, sql`SELECT count(*)::int AS n FROM src_fsq_place`]);
    expect(o.n).toBe(duckCount('pipelines/poi/fixtures/overture-q1.parquet'));
    expect(f.n).toBe(duckCount('pipelines/poi/fixtures/fsq-q1.parquet'));
    expect(o.n).toBeGreaterThan(1000);
  });
  it('src_osm_place có Chợ Bến Thành, có POI dạng vùng (way) và có names jsonb', async () => {
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM src_osm_place`;
    expect(n).toBeGreaterThan(500);
    const [bt] = await sql`SELECT osm_type, names FROM src_osm_place WHERE name ILIKE '%Bến Thành%' AND tags ? 'amenity' LIMIT 1`;
    expect(bt).toBeDefined();
    const [{ ways }] = await sql`SELECT count(*)::int AS ways FROM src_osm_place WHERE osm_type = 'w'`;
    expect(ways).toBeGreaterThan(50);
  });
  it('geometry hợp lệ, SRID 4326, nằm trong bbox Quận 1', async () => {
    const [{ bad }] = await sql`SELECT count(*)::int AS bad FROM (
      SELECT geom FROM src_osm_place UNION ALL SELECT geom FROM src_overture_place UNION ALL SELECT geom FROM src_fsq_place) g
      WHERE ST_SRID(geom) <> 4326 OR NOT ST_Within(geom, ST_MakeEnvelope(106.67, 10.75, 106.73, 10.81, 4326))`;
    expect(bad).toBe(0);
  });
  it('chạy lại idempotent: số dòng không đổi, không còn bảng _new', async () => {
    const before = (await sql`SELECT count(*)::int AS n FROM src_fsq_place`)[0].n;
    node('pipelines/poi/src/ingest/fsq.mjs', '--fixture');
    expect((await sql`SELECT count(*)::int AS n FROM src_fsq_place`)[0].n).toBe(before);
    expect((await sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name LIKE '%\\_new'`)[0].n).toBe(0);
  });
});
```

Run: `PIPE pipeline pnpm test:db`
Expected: `db/schema.dbtest.mjs` + `ingest.dbtest.mjs` xanh (2–4 phút).

Sửa `.github/workflows/dbtest.yml` (Task 2) để job chạy trong image (có osmium/duckdb) với service Postgres — giữ nguyên `on:`/`concurrency:`, thay phần `jobs:`:
```yaml
jobs:
  dbtest:
    runs-on: ubuntu-latest
    container:
      image: ghcr.io/dotienphong/mapslibvn-pipeline:latest
      credentials:
        username: ${{ github.actor }}
        password: ${{ secrets.GITHUB_TOKEN }}
    services:
      postgres:
        image: postgis/postgis:16-3.4
        env:
          POSTGRES_USER: mapslibvn
          POSTGRES_PASSWORD: mapslibvn
          POSTGRES_DB: mapslibvn
        options: >-
          --health-cmd "pg_isready -U mapslibvn" --health-interval 5s --health-timeout 3s --health-retries 30
    env:
      DATABASE_URL: postgres://mapslibvn:mapslibvn@postgres:5432/mapslibvn
      MAPSLIBVN_WORK: /tmp/work
      HF_TOKEN: ${{ secrets.HF_TOKEN }}   # không cần cho --fixture, nhưng để sẵn cho test đọc HF sau này
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @mapslibvn/core build
      - run: pnpm test:db
```
(Image `latest` là bản build từ commit `main` trước — chỉ cung cấp công cụ; mã lấy từ checkout.)

- [ ] **Step 10: Chạy ingest thật toàn VN (máy dev, DB dev; hoặc máy chủ) — đo thời gian, kiểm chất lượng**

Run: `PIPE pipeline sh -c "node pipelines/poi/src/ingest/osm.mjs && node pipelines/poi/src/ingest/overture.mjs --release <OVERTURE_VER> && node pipelines/poi/src/ingest/fsq.mjs --release <FSQ_DT>"`
Expected: `src_osm_place` ≈ 300–600 nghìn (gồm đối tượng có số nhà); `src_overture_place` ≈ 1,9–2,1 triệu (spec 5.1: 2.011.764 trong bbox, trừ phần ngoài ranh giới); `src_fsq_place` ≈ 0,5–1 triệu (đo lần đầu — ghi DEVLOG, đây là con số spec 5.1 để trống). Thời gian: OSM 5–10 phút, Overture 10–20 phút, FSQ 20–40 phút.

Run: `docker compose --env-file .env -f infra/dev/compose.yml exec -T postgres psql -U mapslibvn -d mapslibvn -c "SELECT 'overture' s, count(*) FILTER (WHERE name IS NULL) no_name, count(*) FILTER (WHERE category IS NULL) no_cat, count(*) FILTER (WHERE addresses IS NULL) no_addr, count(*) total FROM src_overture_place"`
Expected: `no_cat` ≈ 7%, `no_addr` ≈ 10% (khớp spec 5.1: 93% có phân loại, 90% có địa chỉ).

- [ ] **Step 11: README pipeline, lint, DEVLOG, commit**

`pipelines/poi/README.md`:
```markdown
# pipelines/poi — kho POI

Chạy trong image (`PIPE pipeline …`, xem plan M2). Mọi bước idempotent: tạo `<bảng>_new` → nạp → hoán đổi trong một transaction.

| Bước | Lệnh | Đầu vào → đầu ra |
|---|---|---|
| Ingest OSM | `node pipelines/poi/src/ingest/osm.mjs [--fixture]` | `work/vietnam-patched.osm.pbf` → `src_osm_place` |
| Ingest Overture | `node pipelines/poi/src/ingest/overture.mjs --release <ver>` | S3 parquet → `src_overture_place` |
| Ingest FSQ | `node pipelines/poi/src/ingest/fsq.mjs --release <dt>` | S3 parquet → `src_fsq_place` |

Bảng phụ do pipeline tạo: `vn_boundary` (ranh giới VN đệm 2 km), `poi_work_*` (Task 7–8).

Fixture Quận 1: `pipelines/poi/fixtures/` (tạo lại bằng `scripts/make-fixture.mjs`). Ranh giới: `data/vn-boundary.geojson` (Natural Earth, public domain).

## admin_level thực tế trong OSM VN
(điền ở Task 8)
```

Run: `pnpm lint && pnpm typecheck && pnpm test`

Sửa `docs/DEVLOG.md`: "Task đang làm: Task 6"; mục 3: "OSM POI qua osmium export (không ST_ReadOSM); nạp Postgres bằng COPY từ Node; ranh giới VN Natural Earth đệm 2 km; Overture/FSQ bỏ hai quần đảo theo bbox"; mục 4 dòng `M2 T5` kèm số dòng và thời gian 3 nguồn.

```bash
git add -A
git commit -m "feat(pipeline-poi): ingest OSM/Overture/FSQ → src_* (osmium, DuckDB S3, COPY), ranh giới VN, fixture Quận 1, dbtest"
git push
```

---

### Task 6: Taxonomy — 12 nhóm, 163 mã lá, ánh xạ 3 nguồn, `mapCategory`

**Files:**
- Create: `db/seed/category.json`, `db/seed/category_map_osm.csv`, `db/seed/category_map_overture.csv`, `db/seed/category_map_fsq.csv`, `pipelines/poi/src/taxonomy.mjs`, `pipelines/poi/scripts/category-coverage.mjs`, `pipelines/poi/tests/taxonomy.test.mjs`

- [ ] **Step 1: `category.json` (spec 5.6) — 12 nhóm thật + nhóm giả `other`**

`db/seed/category.json` — mỗi dòng một lá `{code, group, vi, en, icon, rank}`; `icon` là tên sprite Maki trong osm-liberty (style Task 9 vẽ icon theo **nhóm**, `icon` lá dùng cho API); `rank` 1 = hiện sớm nhất theo zoom:
```json
[
{"code":"restaurant","group":"food_drink","vi":"Nhà hàng","en":"Restaurant","icon":"restaurant","rank":3},
{"code":"cafe","group":"food_drink","vi":"Quán cà phê","en":"Cafe","icon":"cafe","rank":3},
{"code":"fast_food","group":"food_drink","vi":"Đồ ăn nhanh","en":"Fast food","icon":"fast_food","rank":4},
{"code":"bar","group":"food_drink","vi":"Quầy bar","en":"Bar","icon":"bar","rank":4},
{"code":"pub","group":"food_drink","vi":"Quán bia","en":"Pub","icon":"beer","rank":4},
{"code":"bakery","group":"food_drink","vi":"Tiệm bánh","en":"Bakery","icon":"bakery","rank":4},
{"code":"food_court","group":"food_drink","vi":"Khu ẩm thực","en":"Food court","icon":"restaurant","rank":3},
{"code":"street_food","group":"food_drink","vi":"Quán ăn vỉa hè","en":"Street food","icon":"restaurant","rank":5},
{"code":"ice_cream","group":"food_drink","vi":"Tiệm kem","en":"Ice cream","icon":"ice_cream","rank":5},
{"code":"tea_house","group":"food_drink","vi":"Quán trà","en":"Tea house","icon":"cafe","rank":4},
{"code":"bubble_tea","group":"food_drink","vi":"Trà sữa","en":"Bubble tea","icon":"cafe","rank":5},
{"code":"dessert","group":"food_drink","vi":"Quán tráng miệng","en":"Dessert","icon":"ice_cream","rank":5},
{"code":"juice_bar","group":"food_drink","vi":"Quán nước ép","en":"Juice bar","icon":"cafe","rank":5},
{"code":"food_drink_other","group":"food_drink","vi":"Ăn uống khác","en":"Other food & drink","icon":"restaurant","rank":5},
{"code":"supermarket","group":"shopping","vi":"Siêu thị","en":"Supermarket","icon":"grocery","rank":2},
{"code":"convenience","group":"shopping","vi":"Cửa hàng tiện lợi","en":"Convenience store","icon":"grocery","rank":4},
{"code":"mall","group":"shopping","vi":"Trung tâm thương mại","en":"Shopping mall","icon":"shop","rank":1},
{"code":"market","group":"shopping","vi":"Chợ","en":"Market","icon":"shop","rank":2},
{"code":"department_store","group":"shopping","vi":"Cửa hàng bách hoá","en":"Department store","icon":"shop","rank":2},
{"code":"clothes","group":"shopping","vi":"Cửa hàng thời trang","en":"Clothing store","icon":"clothing_store","rank":4},
{"code":"shoes","group":"shopping","vi":"Cửa hàng giày","en":"Shoe store","icon":"clothing_store","rank":5},
{"code":"electronics","group":"shopping","vi":"Cửa hàng điện máy","en":"Electronics store","icon":"shop","rank":4},
{"code":"mobile_phone","group":"shopping","vi":"Cửa hàng điện thoại","en":"Mobile phone store","icon":"shop","rank":4},
{"code":"furniture","group":"shopping","vi":"Cửa hàng nội thất","en":"Furniture store","icon":"shop","rank":4},
{"code":"hardware","group":"shopping","vi":"Cửa hàng vật liệu/kim khí","en":"Hardware store","icon":"shop","rank":5},
{"code":"jewelry","group":"shopping","vi":"Tiệm vàng, trang sức","en":"Jewelry store","icon":"shop","rank":4},
{"code":"bookshop","group":"shopping","vi":"Nhà sách","en":"Bookshop","icon":"library","rank":4},
{"code":"stationery","group":"shopping","vi":"Văn phòng phẩm","en":"Stationery","icon":"shop","rank":5},
{"code":"florist","group":"shopping","vi":"Cửa hàng hoa","en":"Florist","icon":"shop","rank":5},
{"code":"gift","group":"shopping","vi":"Cửa hàng quà tặng","en":"Gift shop","icon":"shop","rank":5},
{"code":"cosmetics","group":"shopping","vi":"Mỹ phẩm","en":"Cosmetics","icon":"shop","rank":5},
{"code":"sports_shop","group":"shopping","vi":"Cửa hàng thể thao","en":"Sports store","icon":"shop","rank":5},
{"code":"pet_shop","group":"shopping","vi":"Cửa hàng thú cưng","en":"Pet store","icon":"shop","rank":5},
{"code":"toys","group":"shopping","vi":"Cửa hàng đồ chơi","en":"Toy store","icon":"shop","rank":5},
{"code":"motorcycle_shop","group":"shopping","vi":"Cửa hàng xe máy","en":"Motorcycle dealer","icon":"shop","rank":4},
{"code":"car_dealer","group":"shopping","vi":"Đại lý ô tô","en":"Car dealer","icon":"car","rank":4},
{"code":"bicycle_shop","group":"shopping","vi":"Cửa hàng xe đạp","en":"Bicycle shop","icon":"bicycle","rank":5},
{"code":"shopping_other","group":"shopping","vi":"Mua sắm khác","en":"Other shopping","icon":"shop","rank":5},
{"code":"hair_salon","group":"services","vi":"Tiệm tóc","en":"Hair salon","icon":"shop","rank":5},
{"code":"beauty_salon","group":"services","vi":"Thẩm mỹ, làm đẹp","en":"Beauty salon","icon":"shop","rank":5},
{"code":"spa","group":"services","vi":"Spa, massage","en":"Spa","icon":"shop","rank":5},
{"code":"laundry","group":"services","vi":"Giặt ủi","en":"Laundry","icon":"laundry","rank":5},
{"code":"tailor","group":"services","vi":"Tiệm may","en":"Tailor","icon":"clothing_store","rank":5},
{"code":"photo_studio","group":"services","vi":"Tiệm ảnh","en":"Photo studio","icon":"shop","rank":5},
{"code":"printing","group":"services","vi":"In ấn, photocopy","en":"Printing","icon":"shop","rank":5},
{"code":"real_estate","group":"services","vi":"Bất động sản","en":"Real estate","icon":"shop","rank":5},
{"code":"lawyer","group":"services","vi":"Văn phòng luật","en":"Lawyer","icon":"shop","rank":5},
{"code":"accounting","group":"services","vi":"Kế toán, kiểm toán","en":"Accounting","icon":"shop","rank":5},
{"code":"travel_agency","group":"services","vi":"Công ty du lịch","en":"Travel agency","icon":"shop","rank":5},
{"code":"coworking","group":"services","vi":"Không gian làm việc chung","en":"Coworking","icon":"shop","rank":4},
{"code":"office","group":"services","vi":"Văn phòng công ty","en":"Office","icon":"shop","rank":5},
{"code":"car_repair","group":"services","vi":"Sửa xe ô tô","en":"Car repair","icon":"car","rank":5},
{"code":"motorcycle_repair","group":"services","vi":"Sửa xe máy","en":"Motorcycle repair","icon":"car","rank":5},
{"code":"car_wash","group":"services","vi":"Rửa xe","en":"Car wash","icon":"car","rank":5},
{"code":"fuel","group":"services","vi":"Trạm xăng","en":"Fuel station","icon":"fuel","rank":2},
{"code":"courier","group":"services","vi":"Chuyển phát","en":"Courier","icon":"post","rank":5},
{"code":"insurance","group":"services","vi":"Bảo hiểm","en":"Insurance","icon":"shop","rank":5},
{"code":"it_services","group":"services","vi":"Dịch vụ CNTT","en":"IT services","icon":"shop","rank":5},
{"code":"services_other","group":"services","vi":"Dịch vụ khác","en":"Other services","icon":"shop","rank":5},
{"code":"hospital","group":"health","vi":"Bệnh viện","en":"Hospital","icon":"hospital","rank":1},
{"code":"clinic","group":"health","vi":"Phòng khám","en":"Clinic","icon":"doctors","rank":3},
{"code":"pharmacy","group":"health","vi":"Nhà thuốc","en":"Pharmacy","icon":"pharmacy","rank":4},
{"code":"dentist","group":"health","vi":"Nha khoa","en":"Dentist","icon":"dentist","rank":4},
{"code":"doctor","group":"health","vi":"Bác sĩ","en":"Doctor","icon":"doctors","rank":4},
{"code":"veterinary","group":"health","vi":"Thú y","en":"Veterinary","icon":"veterinary","rank":5},
{"code":"optician","group":"health","vi":"Kính mắt","en":"Optician","icon":"shop","rank":5},
{"code":"medical_lab","group":"health","vi":"Xét nghiệm","en":"Medical laboratory","icon":"doctors","rank":4},
{"code":"maternity","group":"health","vi":"Sản khoa","en":"Maternity","icon":"hospital","rank":3},
{"code":"traditional_medicine","group":"health","vi":"Y học cổ truyền","en":"Traditional medicine","icon":"doctors","rank":5},
{"code":"health_other","group":"health","vi":"Y tế khác","en":"Other health","icon":"doctors","rank":4},
{"code":"kindergarten","group":"education","vi":"Trường mầm non","en":"Kindergarten","icon":"school","rank":3},
{"code":"primary_school","group":"education","vi":"Trường tiểu học","en":"Primary school","icon":"school","rank":2},
{"code":"secondary_school","group":"education","vi":"Trường THCS","en":"Secondary school","icon":"school","rank":2},
{"code":"high_school","group":"education","vi":"Trường THPT","en":"High school","icon":"school","rank":2},
{"code":"school","group":"education","vi":"Trường học","en":"School","icon":"school","rank":2},
{"code":"university","group":"education","vi":"Trường đại học","en":"University","icon":"college","rank":1},
{"code":"college","group":"education","vi":"Trường cao đẳng","en":"College","icon":"college","rank":2},
{"code":"language_center","group":"education","vi":"Trung tâm ngoại ngữ","en":"Language center","icon":"school","rank":4},
{"code":"training_center","group":"education","vi":"Trung tâm đào tạo","en":"Training center","icon":"school","rank":4},
{"code":"tutoring","group":"education","vi":"Lớp học thêm","en":"Tutoring","icon":"school","rank":5},
{"code":"driving_school","group":"education","vi":"Trung tâm dạy lái xe","en":"Driving school","icon":"car","rank":5},
{"code":"library","group":"education","vi":"Thư viện","en":"Library","icon":"library","rank":3},
{"code":"education_other","group":"education","vi":"Giáo dục khác","en":"Other education","icon":"school","rank":4},
{"code":"bank","group":"finance","vi":"Ngân hàng","en":"Bank","icon":"bank","rank":3},
{"code":"atm","group":"finance","vi":"ATM","en":"ATM","icon":"bank","rank":5},
{"code":"money_exchange","group":"finance","vi":"Đổi tiền","en":"Money exchange","icon":"bank","rank":5},
{"code":"pawnshop","group":"finance","vi":"Cầm đồ","en":"Pawnshop","icon":"shop","rank":5},
{"code":"credit_fund","group":"finance","vi":"Quỹ tín dụng, tài chính","en":"Credit fund","icon":"bank","rank":5},
{"code":"finance_other","group":"finance","vi":"Tài chính khác","en":"Other finance","icon":"bank","rank":5},
{"code":"hotel","group":"lodging","vi":"Khách sạn","en":"Hotel","icon":"lodging","rank":3},
{"code":"motel","group":"lodging","vi":"Nhà nghỉ","en":"Motel","icon":"lodging","rank":5},
{"code":"hostel","group":"lodging","vi":"Hostel","en":"Hostel","icon":"lodging","rank":5},
{"code":"guest_house","group":"lodging","vi":"Nhà khách","en":"Guest house","icon":"lodging","rank":5},
{"code":"homestay","group":"lodging","vi":"Homestay","en":"Homestay","icon":"lodging","rank":5},
{"code":"apartment_rental","group":"lodging","vi":"Căn hộ cho thuê","en":"Apartment rental","icon":"lodging","rank":5},
{"code":"resort","group":"lodging","vi":"Khu nghỉ dưỡng","en":"Resort","icon":"lodging","rank":2},
{"code":"lodging_other","group":"lodging","vi":"Lưu trú khác","en":"Other lodging","icon":"lodging","rank":5},
{"code":"cinema","group":"entertainment_sport","vi":"Rạp chiếu phim","en":"Cinema","icon":"cinema","rank":3},
{"code":"karaoke","group":"entertainment_sport","vi":"Karaoke","en":"Karaoke","icon":"music","rank":5},
{"code":"nightclub","group":"entertainment_sport","vi":"Vũ trường, club","en":"Nightclub","icon":"music","rank":5},
{"code":"gym","group":"entertainment_sport","vi":"Phòng gym","en":"Gym","icon":"stadium","rank":5},
{"code":"swimming_pool","group":"entertainment_sport","vi":"Hồ bơi","en":"Swimming pool","icon":"swimming","rank":4},
{"code":"stadium","group":"entertainment_sport","vi":"Sân vận động","en":"Stadium","icon":"stadium","rank":1},
{"code":"sports_center","group":"entertainment_sport","vi":"Trung tâm thể thao","en":"Sports center","icon":"stadium","rank":3},
{"code":"football_pitch","group":"entertainment_sport","vi":"Sân bóng đá","en":"Football pitch","icon":"stadium","rank":5},
{"code":"badminton_court","group":"entertainment_sport","vi":"Sân cầu lông","en":"Badminton court","icon":"stadium","rank":5},
{"code":"tennis_court","group":"entertainment_sport","vi":"Sân tennis","en":"Tennis court","icon":"stadium","rank":5},
{"code":"billiards","group":"entertainment_sport","vi":"Bida","en":"Billiards","icon":"stadium","rank":5},
{"code":"bowling","group":"entertainment_sport","vi":"Bowling","en":"Bowling","icon":"stadium","rank":5},
{"code":"gaming_center","group":"entertainment_sport","vi":"Phòng game, net","en":"Gaming center","icon":"music","rank":5},
{"code":"amusement_park","group":"entertainment_sport","vi":"Khu vui chơi","en":"Amusement park","icon":"attraction","rank":2},
{"code":"water_park","group":"entertainment_sport","vi":"Công viên nước","en":"Water park","icon":"swimming","rank":2},
{"code":"entertainment_sport_other","group":"entertainment_sport","vi":"Giải trí, thể thao khác","en":"Other entertainment & sport","icon":"stadium","rank":5},
{"code":"museum","group":"culture_tourism","vi":"Bảo tàng","en":"Museum","icon":"museum","rank":1},
{"code":"art_gallery","group":"culture_tourism","vi":"Phòng tranh","en":"Art gallery","icon":"art_gallery","rank":4},
{"code":"theatre","group":"culture_tourism","vi":"Nhà hát","en":"Theatre","icon":"theatre","rank":2},
{"code":"monument","group":"culture_tourism","vi":"Tượng đài, đài tưởng niệm","en":"Monument","icon":"monument","rank":2},
{"code":"historic_site","group":"culture_tourism","vi":"Di tích lịch sử","en":"Historic site","icon":"monument","rank":2},
{"code":"tourist_attraction","group":"culture_tourism","vi":"Điểm tham quan","en":"Tourist attraction","icon":"attraction","rank":2},
{"code":"viewpoint","group":"culture_tourism","vi":"Điểm ngắm cảnh","en":"Viewpoint","icon":"attraction","rank":3},
{"code":"zoo","group":"culture_tourism","vi":"Vườn thú","en":"Zoo","icon":"zoo","rank":1},
{"code":"aquarium","group":"culture_tourism","vi":"Thuỷ cung","en":"Aquarium","icon":"aquarium","rank":2},
{"code":"park","group":"culture_tourism","vi":"Công viên","en":"Park","icon":"park","rank":1},
{"code":"garden","group":"culture_tourism","vi":"Vườn hoa, vườn thực vật","en":"Garden","icon":"garden","rank":3},
{"code":"beach","group":"culture_tourism","vi":"Bãi biển","en":"Beach","icon":"swimming","rank":1},
{"code":"cultural_center","group":"culture_tourism","vi":"Trung tâm văn hoá","en":"Cultural center","icon":"town_hall","rank":3},
{"code":"tourist_info","group":"culture_tourism","vi":"Thông tin du lịch","en":"Tourist information","icon":"information","rank":4},
{"code":"culture_tourism_other","group":"culture_tourism","vi":"Văn hoá, du lịch khác","en":"Other culture & tourism","icon":"attraction","rank":4},
{"code":"bus_stop","group":"transport","vi":"Trạm xe buýt","en":"Bus stop","icon":"bus","rank":5},
{"code":"bus_station","group":"transport","vi":"Bến xe","en":"Bus station","icon":"bus","rank":1},
{"code":"train_station","group":"transport","vi":"Ga tàu","en":"Train station","icon":"railway","rank":1},
{"code":"metro_station","group":"transport","vi":"Ga metro","en":"Metro station","icon":"railway_metro","rank":1},
{"code":"airport","group":"transport","vi":"Sân bay","en":"Airport","icon":"airport","rank":1},
{"code":"ferry_terminal","group":"transport","vi":"Bến phà, bến tàu","en":"Ferry terminal","icon":"ferry","rank":2},
{"code":"taxi_stand","group":"transport","vi":"Điểm đón taxi","en":"Taxi stand","icon":"car","rank":5},
{"code":"parking","group":"transport","vi":"Bãi đỗ xe","en":"Parking","icon":"car","rank":4},
{"code":"parking_motorcycle","group":"transport","vi":"Bãi giữ xe máy","en":"Motorcycle parking","icon":"car","rank":5},
{"code":"charging_station","group":"transport","vi":"Trạm sạc","en":"Charging station","icon":"fuel","rank":4},
{"code":"toll_booth","group":"transport","vi":"Trạm thu phí","en":"Toll booth","icon":"car","rank":3},
{"code":"port","group":"transport","vi":"Cảng","en":"Port","icon":"harbor","rank":1},
{"code":"transport_other","group":"transport","vi":"Giao thông khác","en":"Other transport","icon":"bus","rank":4},
{"code":"town_hall","group":"public_admin","vi":"UBND, trụ sở chính quyền","en":"Town hall","icon":"town_hall","rank":1},
{"code":"police","group":"public_admin","vi":"Công an","en":"Police","icon":"police","rank":2},
{"code":"fire_station","group":"public_admin","vi":"Trạm cứu hoả","en":"Fire station","icon":"fire_station","rank":2},
{"code":"courthouse","group":"public_admin","vi":"Toà án","en":"Courthouse","icon":"town_hall","rank":2},
{"code":"post_office","group":"public_admin","vi":"Bưu điện","en":"Post office","icon":"post","rank":3},
{"code":"embassy","group":"public_admin","vi":"Đại sứ quán, lãnh sự quán","en":"Embassy","icon":"embassy","rank":2},
{"code":"government_office","group":"public_admin","vi":"Cơ quan nhà nước","en":"Government office","icon":"town_hall","rank":2},
{"code":"tax_office","group":"public_admin","vi":"Cơ quan thuế","en":"Tax office","icon":"town_hall","rank":3},
{"code":"social_facility","group":"public_admin","vi":"Cơ sở xã hội","en":"Social facility","icon":"town_hall","rank":4},
{"code":"community_center","group":"public_admin","vi":"Nhà văn hoá, trung tâm cộng đồng","en":"Community center","icon":"town_hall","rank":3},
{"code":"public_toilet","group":"public_admin","vi":"Nhà vệ sinh công cộng","en":"Public toilet","icon":"toilets","rank":5},
{"code":"cemetery","group":"public_admin","vi":"Nghĩa trang","en":"Cemetery","icon":"cemetery","rank":2},
{"code":"public_admin_other","group":"public_admin","vi":"Công cộng khác","en":"Other public","icon":"town_hall","rank":4},
{"code":"pagoda","group":"religion_community","vi":"Chùa","en":"Buddhist temple","icon":"place_of_worship","rank":2},
{"code":"church","group":"religion_community","vi":"Nhà thờ","en":"Church","icon":"religious_christian","rank":2},
{"code":"temple","group":"religion_community","vi":"Đền, miếu, đình","en":"Temple/shrine","icon":"place_of_worship","rank":3},
{"code":"mosque","group":"religion_community","vi":"Thánh đường Hồi giáo","en":"Mosque","icon":"religious_muslim","rank":2},
{"code":"cathedral","group":"religion_community","vi":"Nhà thờ chính toà","en":"Cathedral","icon":"religious_christian","rank":1},
{"code":"shrine","group":"religion_community","vi":"Am, điện thờ","en":"Shrine","icon":"place_of_worship","rank":4},
{"code":"monastery","group":"religion_community","vi":"Tu viện, thiền viện","en":"Monastery","icon":"place_of_worship","rank":3},
{"code":"community_hall","group":"religion_community","vi":"Hội quán, nhà sinh hoạt","en":"Community hall","icon":"town_hall","rank":4},
{"code":"religion_community_other","group":"religion_community","vi":"Tôn giáo, cộng đồng khác","en":"Other religion & community","icon":"place_of_worship","rank":4},
{"code":"other","group":"other","vi":"Địa điểm khác","en":"Other place","icon":"marker","rank":5}
]
```

- [ ] **Step 2: Test taxonomy (thất bại)**

`pipelines/poi/tests/taxonomy.test.mjs`:
```js
import { describe, expect, it } from 'vitest';
import { GROUPS, categoryFor, loadCategories, loadCategoryMaps, mapCategory, osmCandidates, parseMapCsv, refineSchool } from '../src/taxonomy.mjs';

const cats = loadCategories();
const codes = new Set(cats.map((c) => c.code));
const maps = loadCategoryMaps();

describe('category.json', () => {
  it('mã duy nhất, nhóm hợp lệ, mỗi nhóm có lá <nhóm>_other, ~150 lá', () => {
    expect(codes.size).toBe(cats.length);
    expect(cats.length).toBeGreaterThanOrEqual(140);
    for (const c of cats) {
      expect([...GROUPS, 'other']).toContain(c.group);
      expect(c.vi.length).toBeGreaterThan(0);
      expect(c.en.length).toBeGreaterThan(0);
      expect(c.icon.length).toBeGreaterThan(0);
      expect(c.rank).toBeGreaterThanOrEqual(1);
      expect(c.rank).toBeLessThanOrEqual(5);
    }
    for (const g of GROUPS) expect(codes.has(`${g}_other`)).toBe(true);
    expect(codes.has('other')).toBe(true);
  });
});

describe('category_map_*.csv', () => {
  it('mọi mã đích tồn tại; không trùng giá trị nguồn', () => {
    for (const [source, m] of Object.entries(maps)) {
      expect(m.size).toBeGreaterThan(50);
      for (const [value, code] of m) expect(codes.has(code), `${source}: ${value} → ${code}`).toBe(true);
    }
  });
  it('parseMapCsv bỏ comment, trim, giữ dấu phẩy trong nhãn FSQ nhờ tách ở dấu phẩy cuối', () => {
    const m = parseMapCsv('# c\nCoffee Shop,cafe\n"Cafe, Coffee, and Tea House",cafe\n  Bar ,bar\n');
    expect([...m]).toEqual([['Coffee Shop', 'cafe'], ['Cafe, Coffee, and Tea House', 'cafe'], ['Bar', 'bar']]);
  });
});

describe('mapCategory', () => {
  it('OSM: khoá=giá trị chính xác, rồi khoá=* theo nhóm, rồi other', () => {
    expect(mapCategory(maps, 'osm', 'amenity=cafe')).toEqual({ code: 'cafe', group: 'food_drink' });
    expect(mapCategory(maps, 'osm', 'shop=weird_thing')).toEqual({ code: 'shopping_other', group: 'shopping' });
    expect(mapCategory(maps, 'osm', 'building=yes')).toEqual({ code: 'other', group: 'other' });
  });
  it('OSM: ưu tiên amenity > shop > tourism … và bỏ qua tag không phải POI', () => {
    expect(osmCandidates({ building: 'yes', shop: 'convenience', amenity: 'cafe' })).toEqual(['amenity=cafe', 'shop=convenience']);
    expect(categoryFor(maps, 'osm', { 'addr:housenumber': '12' })).toBeNull();
    expect(categoryFor(maps, 'osm', { amenity: 'cafe', shop: 'convenience' }).code).toBe('cafe');
  });
  it('OSM: tag phụ (religion/sport/station) được thử trước; đối tượng trong OSM_DROP → null', () => {
    expect(osmCandidates({ amenity: 'place_of_worship', religion: 'buddhist' })).toEqual(['amenity=place_of_worship/buddhist', 'amenity=place_of_worship']);
    expect(categoryFor(maps, 'osm', { amenity: 'place_of_worship', religion: 'christian' }).code).toBe('church');
    expect(categoryFor(maps, 'osm', { leisure: 'pitch', sport: 'badminton' }).code).toBe('badminton_court');
    expect(categoryFor(maps, 'osm', { railway: 'station', station: 'subway' }).code).toBe('metro_station');
    expect(categoryFor(maps, 'osm', { amenity: 'bench' })).toBeNull();
    expect(categoryFor(maps, 'osm', { amenity: 'bench', shop: 'convenience' }).code).toBe('convenience');
  });
  it('refineSchool tách cấp trường theo tên tiếng Việt', () => {
    expect(refineSchool('school', 'Trường Tiểu học Hoàng Diệu')).toBe('primary_school');
    expect(refineSchool('school', 'Trường THCS Linh Xuân')).toBe('secondary_school');
    expect(refineSchool('school', 'Trường THPT Lê Quý Đôn')).toBe('high_school');
    expect(refineSchool('school', 'Trường Mầm non Hoa Hồng')).toBe('kindergarten');
    expect(refineSchool('school', 'Trường Quốc tế ABC')).toBe('school');
    expect(refineSchool('cafe', 'Trường Tiểu học')).toBe('cafe');
  });
  it('Overture: primary rồi alternate', () => {
    expect(mapCategory(maps, 'overture', 'coffee_shop').code).toBe('cafe');
    expect(categoryFor(maps, 'overture', ['not_a_real_category', 'vietnamese_restaurant']).code).toBe('restaurant');
    expect(categoryFor(maps, 'overture', []).code).toBe('other');
  });
  it('FSQ: lá cuối, rồi cấp 2, rồi cấp 1', () => {
    expect(mapCategory(maps, 'fsq', 'Dining and Drinking > Cafe, Coffee, and Tea House > Coffee Shop').code).toBe('cafe');
    expect(mapCategory(maps, 'fsq', 'Dining and Drinking > Cafe, Coffee, and Tea House > Unheard Of Leaf').code).toBe('cafe');
    expect(mapCategory(maps, 'fsq', 'Dining and Drinking > Something Odd').code).toBe('food_drink_other');
    expect(mapCategory(maps, 'fsq', 'Totally Unknown').code).toBe('other');
  });
});
```

Run: `pnpm test`
Expected: FAIL — không tìm thấy `../src/taxonomy.mjs`.

- [ ] **Step 3: `taxonomy.mjs`**

```js
#!/usr/bin/env node
// Taxonomy spec 5.6: đọc db/seed/category.json + 3 CSV ánh xạ; mapCategory(); lệnh `load` upsert vào Postgres.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SEED = resolve('db/seed');
export const GROUPS = [
  'food_drink', 'shopping', 'services', 'health', 'education', 'finance', 'lodging', 'entertainment_sport',
  'culture_tourism', 'transport', 'public_admin', 'religion_community',
];
/** Thứ tự ưu tiên khoá OSM khi một đối tượng có nhiều tag (spec 5.6: amenity=cafe → cafe). */
export const OSM_KEYS = ['amenity', 'shop', 'tourism', 'leisure', 'office', 'craft', 'healthcare', 'historic', 'public_transport', 'aeroway', 'railway'];
/** Tag phụ làm rõ loại: ứng viên "khoá=giá trị/phụ" được thử TRƯỚC "khoá=giá trị". */
const OSM_QUALIFIER = /** @type {Record<string, string[]>} */ ({
  'amenity=place_of_worship': ['religion'],
  'leisure=pitch': ['sport'],
  'railway=station': ['station'],
  'public_transport=station': ['station'],
});
/** Đối tượng OSM không phải địa điểm để tìm kiếm — không tạo poi. */
export const OSM_DROP = new Set([
  'amenity=bench', 'amenity=waste_basket', 'amenity=vending_machine', 'amenity=bicycle_parking', 'amenity=shelter', 'amenity=drinking_water',
  'amenity=fountain', 'amenity=recycling', 'amenity=waste_disposal', 'amenity=parking_entrance', 'amenity=parking_space', 'amenity=telephone',
  'amenity=post_box', 'amenity=bbq', 'amenity=hunting_stand', 'amenity=loading_dock', 'amenity=grit_bin', 'amenity=clock',
  'public_transport=stop_position', 'leisure=picnic_table', 'leisure=slipway', 'leisure=track', 'leisure=common', 'leisure=firepit',
]);

/** @returns {{ code: string, group: string, vi: string, en: string, icon: string, rank: number }[]} */
export function loadCategories() {
  return JSON.parse(readFileSync(resolve(SEED, 'category.json'), 'utf8'));
}

/** CSV `source_value,code`: tách ở dấu phẩy CUỐI (nhãn FSQ có dấu phẩy), bỏ dấu nháy bao ngoài, bỏ dòng #/trống. @param {string} text */
export function parseMapCsv(text) {
  /** @type {Map<string, string>} */
  const m = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const cut = line.lastIndexOf(',');
    if (cut < 0) continue;
    const value = line.slice(0, cut).trim().replace(/^"(.*)"$/, '$1').trim();
    const code = line.slice(cut + 1).trim();
    if (value && code) m.set(value, code);
  }
  return m;
}

export function loadCategoryMaps() {
  const read = (/** @type {string} */ f) => parseMapCsv(readFileSync(resolve(SEED, f), 'utf8'));
  return { osm: read('category_map_osm.csv'), overture: read('category_map_overture.csv'), fsq: read('category_map_fsq.csv') };
}

const GROUP_OF = new Map(loadCategories().map((c) => [c.code, c.group]));
const OTHER = { code: 'other', group: 'other' };
/** @param {string} code */
const withGroup = (code) => ({ code, group: GROUP_OF.get(code) ?? 'other' });

/**
 * @param {{ osm: Map<string, string>, overture: Map<string, string>, fsq: Map<string, string> }} maps
 * @param {'osm' | 'overture' | 'fsq'} source
 * @param {string} value osm: "amenity=cafe"; overture: "coffee_shop"; fsq: "A > B > C"
 */
export function mapCategory(maps, source, value) {
  const m = maps[source];
  const direct = m.get(value);
  if (direct) return withGroup(direct);
  if (source === 'osm') {
    const key = value.split('=')[0];
    const wildcard = m.get(`${key}=*`);
    return wildcard ? withGroup(wildcard) : OTHER;
  }
  if (source === 'fsq') {
    const parts = value.split('>').map((s) => s.trim());
    for (let depth = parts.length; depth >= 1; depth--) {
      const leaf = parts[depth - 1];
      const path = parts.slice(0, depth).join(' > ');
      const hit = (leaf && m.get(leaf)) || m.get(path);
      if (hit) return withGroup(hit);
    }
  }
  return OTHER;
}

/** Danh sách "khoá=giá trị" POI của một đối tượng OSM theo ưu tiên OSM_KEYS (kèm biến thể tag phụ). @param {Record<string, string>} tags */
export function osmCandidates(tags) {
  /** @type {string[]} */
  const out = [];
  for (const k of OSM_KEYS) {
    if (tags[k] === undefined) continue;
    const kv = `${k}=${tags[k]}`;
    for (const q of OSM_QUALIFIER[kv] ?? []) if (tags[q]) out.push(`${kv}/${tags[q]}`);
    out.push(kv);
  }
  return out;
}

/** Tách cấp trường theo tên tiếng Việt khi loại chỉ là `school`. @param {string} code @param {string | null | undefined} name */
export function refineSchool(code, name) {
  if (code !== 'school' || !name) return code;
  const n = name.toLowerCase();
  if (/mầm non|mẫu giáo|mam non|mau giao|kindergarten|preschool/.test(n)) return 'kindergarten';
  if (/tiểu học|tieu hoc|primary|elementary/.test(n)) return 'primary_school';
  if (/thpt|trung học phổ thông|trung hoc pho thong|high school/.test(n)) return 'high_school';
  if (/thcs|trung học cơ sở|trung hoc co so|secondary|middle school/.test(n)) return 'secondary_school';
  return code;
}

/**
 * Chọn loại cho một bản ghi: lấy ứng viên đầu tiên ánh xạ được (không phải *_other/other); nếu không có ứng viên nào → theo ứng viên đầu.
 * @param {{ osm: Map<string, string>, overture: Map<string, string>, fsq: Map<string, string> }} maps
 * @param {'osm' | 'overture' | 'fsq'} source
 * @param {Record<string, string> | (string | null | undefined)[]} input tags OSM, hoặc mảng giá trị (Overture: [primary, …alternate]; FSQ: nhãn)
 * @returns {{ code: string, group: string } | null} null khi đối tượng OSM không có tag POI nào
 */
export function categoryFor(maps, source, input) {
  const values = Array.isArray(input)
    ? input.filter((v) => typeof v === 'string' && v)
    : osmCandidates(input).filter((v) => !OSM_DROP.has(v));
  if (values.length === 0) return source === 'osm' ? null : OTHER;
  let fallback = null;
  for (const v of values) {
    const r = mapCategory(maps, source, /** @type {string} */ (v));
    if (r.code !== 'other' && !r.code.endsWith('_other')) return r;
    fallback ??= r;
  }
  return fallback ?? OTHER;
}

// ---- CLI: node pipelines/poi/src/taxonomy.mjs load  (upsert category + category_map vào Postgres) ----
if (process.argv[1]?.endsWith('taxonomy.mjs') && process.argv[2] === 'load') {
  const { connect } = await import('./pg.mjs');
  const sql = connect();
  try {
    const cats = loadCategories();
    const maps = loadCategoryMaps();
    await sql.begin(async (tx) => {
      for (const c of cats) {
        await tx`INSERT INTO category (code, group_code, name_vi, name_en, icon, rank) VALUES (${c.code}, ${c.group}, ${c.vi}, ${c.en}, ${c.icon}, ${c.rank})
          ON CONFLICT (code) DO UPDATE SET group_code = EXCLUDED.group_code, name_vi = EXCLUDED.name_vi, name_en = EXCLUDED.name_en, icon = EXCLUDED.icon, rank = EXCLUDED.rank`;
      }
      await tx`DELETE FROM category_map`;
      for (const [source, m] of Object.entries(maps)) {
        for (const [value, code] of m) await tx`INSERT INTO category_map (source, source_value, code) VALUES (${source}, ${value}, ${code})`;
      }
    });
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM category`;
    console.log(`✓ category ${n} mã; category_map ${maps.osm.size + maps.overture.size + maps.fsq.size} dòng`);
  } finally {
    await sql.end();
  }
}
```

- [ ] **Step 4: Ba bảng ánh xạ (`source_value,code`; tách ở dấu phẩy cuối; `khoá=*` là dự phòng theo khoá)**

`db/seed/category_map_osm.csv`:
```
# OSM: "khoá=giá trị" (kèm "/tag phụ" cho place_of_worship, pitch, station). "khoá=*" = dự phòng theo khoá.
amenity=cafe,cafe
amenity=restaurant,restaurant
amenity=fast_food,fast_food
amenity=bar,bar
amenity=pub,pub
amenity=biergarten,pub
amenity=food_court,food_court
amenity=ice_cream,ice_cream
amenity=bank,bank
amenity=atm,atm
amenity=bureau_de_change,money_exchange
amenity=money_transfer,finance_other
amenity=hospital,hospital
amenity=clinic,clinic
amenity=doctors,doctor
amenity=dentist,dentist
amenity=pharmacy,pharmacy
amenity=veterinary,veterinary
amenity=school,school
amenity=kindergarten,kindergarten
amenity=childcare,kindergarten
amenity=university,university
amenity=college,college
amenity=library,library
amenity=language_school,language_center
amenity=driving_school,driving_school
amenity=music_school,training_center
amenity=training,training_center
amenity=fuel,fuel
amenity=charging_station,charging_station
amenity=parking,parking
amenity=motorcycle_parking,parking_motorcycle
amenity=bus_station,bus_station
amenity=ferry_terminal,ferry_terminal
amenity=taxi,taxi_stand
amenity=car_wash,car_wash
amenity=car_rental,services_other
amenity=townhall,town_hall
amenity=police,police
amenity=fire_station,fire_station
amenity=courthouse,courthouse
amenity=post_office,post_office
amenity=embassy,embassy
amenity=community_centre,community_center
amenity=social_facility,social_facility
amenity=toilets,public_toilet
amenity=grave_yard,cemetery
amenity=place_of_worship/buddhist,pagoda
amenity=place_of_worship/christian,church
amenity=place_of_worship/muslim,mosque
amenity=place_of_worship/taoist,temple
amenity=place_of_worship/caodaism,temple
amenity=place_of_worship/hoahaoism,temple
amenity=place_of_worship/hindu,temple
amenity=place_of_worship/confucian,temple
amenity=place_of_worship,temple
amenity=monastery,monastery
amenity=cinema,cinema
amenity=theatre,theatre
amenity=nightclub,nightclub
amenity=karaoke_box,karaoke
amenity=casino,entertainment_sport_other
amenity=gambling,entertainment_sport_other
amenity=marketplace,market
amenity=arts_centre,cultural_center
amenity=events_venue,entertainment_sport_other
amenity=internet_cafe,gaming_center
amenity=coworking_space,coworking
amenity=*,services_other
shop=convenience,convenience
shop=supermarket,supermarket
shop=mall,mall
shop=department_store,department_store
shop=general,convenience
shop=kiosk,convenience
shop=clothes,clothes
shop=fashion,clothes
shop=boutique,clothes
shop=shoes,shoes
shop=bag,clothes
shop=electronics,electronics
shop=computer,electronics
shop=hifi,electronics
shop=mobile_phone,mobile_phone
shop=furniture,furniture
shop=interior_decoration,furniture
shop=hardware,hardware
shop=doityourself,hardware
shop=paint,hardware
shop=jewelry,jewelry
shop=watches,jewelry
shop=books,bookshop
shop=stationery,stationery
shop=florist,florist
shop=gift,gift
shop=cosmetics,cosmetics
shop=chemist,cosmetics
shop=perfumery,cosmetics
shop=beauty,beauty_salon
shop=hairdresser,hair_salon
shop=massage,spa
shop=laundry,laundry
shop=dry_cleaning,laundry
shop=tailor,tailor
shop=copyshop,printing
shop=travel_agency,travel_agency
shop=sports,sports_shop
shop=pet,pet_shop
shop=toys,toys
shop=motorcycle,motorcycle_shop
shop=motorcycle_repair,motorcycle_repair
shop=car,car_dealer
shop=car_repair,car_repair
shop=tyres,car_repair
shop=bicycle,bicycle_shop
shop=bakery,bakery
shop=optician,optician
shop=medical_supply,health_other
shop=pawnbroker,pawnshop
shop=money_lender,credit_fund
shop=photo,photo_studio
shop=*,shopping_other
tourism=hotel,hotel
tourism=motel,motel
tourism=hostel,hostel
tourism=guest_house,guest_house
tourism=apartment,apartment_rental
tourism=chalet,lodging_other
tourism=camp_site,lodging_other
tourism=attraction,tourist_attraction
tourism=museum,museum
tourism=gallery,art_gallery
tourism=viewpoint,viewpoint
tourism=information,tourist_info
tourism=zoo,zoo
tourism=aquarium,aquarium
tourism=theme_park,amusement_park
tourism=artwork,monument
tourism=*,culture_tourism_other
leisure=park,park
leisure=garden,garden
leisure=playground,entertainment_sport_other
leisure=fitness_centre,gym
leisure=fitness_station,gym
leisure=sports_centre,sports_center
leisure=stadium,stadium
leisure=swimming_pool,swimming_pool
leisure=water_park,water_park
leisure=pitch/soccer,football_pitch
leisure=pitch/badminton,badminton_court
leisure=pitch/tennis,tennis_court
leisure=pitch,entertainment_sport_other
leisure=amusement_arcade,gaming_center
leisure=adult_gaming_centre,gaming_center
leisure=bowling_alley,bowling
leisure=beach_resort,beach
leisure=nature_reserve,culture_tourism_other
leisure=*,entertainment_sport_other
office=company,office
office=estate_agent,real_estate
office=lawyer,lawyer
office=notary,lawyer
office=accountant,accounting
office=insurance,insurance
office=travel_agent,travel_agency
office=coworking,coworking
office=government,government_office
office=diplomatic,embassy
office=it,it_services
office=financial,credit_fund
office=*,office
craft=tailor,tailor
craft=photographer,photo_studio
craft=*,services_other
healthcare=hospital,hospital
healthcare=clinic,clinic
healthcare=centre,clinic
healthcare=doctor,doctor
healthcare=dentist,dentist
healthcare=pharmacy,pharmacy
healthcare=laboratory,medical_lab
healthcare=alternative,traditional_medicine
healthcare=midwife,maternity
healthcare=*,health_other
historic=monument,monument
historic=memorial,monument
historic=castle,historic_site
historic=ruins,historic_site
historic=archaeological_site,historic_site
historic=temple,temple
historic=*,historic_site
public_transport=platform,bus_stop
public_transport=station/bus,bus_station
public_transport=station/train,train_station
public_transport=station/subway,metro_station
public_transport=station,transport_other
public_transport=*,transport_other
aeroway=aerodrome,airport
aeroway=terminal,airport
aeroway=*,transport_other
railway=station/subway,metro_station
railway=station/light_rail,metro_station
railway=station,train_station
railway=halt,train_station
railway=*,transport_other
```

`db/seed/category_map_overture.csv`:
```
# Overture categories.primary (snake_case)
restaurant,restaurant
vietnamese_restaurant,restaurant
asian_restaurant,restaurant
seafood_restaurant,restaurant
chinese_restaurant,restaurant
japanese_restaurant,restaurant
korean_restaurant,restaurant
thai_restaurant,restaurant
barbecue_restaurant,restaurant
hot_pot_restaurant,restaurant
vegetarian_restaurant,restaurant
vegan_restaurant,restaurant
pizza_restaurant,restaurant
burger_restaurant,fast_food
chicken_restaurant,fast_food
fast_food_restaurant,fast_food
sushi_restaurant,restaurant
steakhouse,restaurant
buffet_restaurant,restaurant
breakfast_and_brunch_restaurant,restaurant
noodles_restaurant,restaurant
soup_restaurant,restaurant
street_vendor,street_food
food_stand,street_food
food_court,food_court
cafe,cafe
coffee_shop,cafe
coffee_roastery,cafe
tea_room,tea_house
bubble_tea,bubble_tea
juice_bar,juice_bar
bakery,bakery
dessert_shop,dessert
ice_cream_shop,ice_cream
bar,bar
beer_bar,bar
beer_garden,pub
pub,pub
cocktail_bar,bar
lounge,bar
hookah_bar,bar
night_club,nightclub
karaoke,karaoke
eat_and_drink,food_drink_other
grocery_store,convenience
supermarket,supermarket
convenience_store,convenience
shopping_center,mall
shopping,shopping_other
market,market
flea_market,market
farmers_market,market
clothing_store,clothes
womens_clothing_store,clothes
mens_clothing_store,clothes
childrens_clothing_store,clothes
fashion,clothes
fashion_accessories_store,clothes
shoe_store,shoes
electronics_store,electronics
computer_store,electronics
mobile_phone_store,mobile_phone
mobile_phone_accessories_store,mobile_phone
furniture_store,furniture
home_improvement_store,hardware
hardware_store,hardware
building_supply_store,hardware
jewelry_store,jewelry
watch_store,jewelry
bookstore,bookshop
office_supply_store,stationery
florist,florist
gift_shop,gift
souvenir_shop,gift
cosmetics_store,cosmetics
beauty_supply_store,cosmetics
sporting_goods_store,sports_shop
pet_store,pet_shop
toy_store,toys
baby_store,toys
motorcycle_dealer,motorcycle_shop
motorcycle_parts_and_accessories,motorcycle_shop
car_dealer,car_dealer
auto_parts_and_supplies,shopping_other
bicycle_shop,bicycle_shop
department_store,department_store
discount_store,shopping_other
retail,shopping_other
eyewear_store,optician
liquor_store,shopping_other
beauty_salon,beauty_salon
hair_salon,hair_salon
barber_shop,hair_salon
nail_salon,beauty_salon
spa,spa
massage,spa
laundry_services,laundry
dry_cleaning,laundry
tailor,tailor
photography_studio,photo_studio
printing_service,printing
real_estate_agency,real_estate
real_estate,real_estate
lawyer,lawyer
legal_services,lawyer
accountant,accounting
travel_agency,travel_agency
coworking_space,coworking
professional_services,services_other
business_to_business_service,services_other
consulting,services_other
marketing_agency,services_other
advertising_agency,services_other
construction_company,services_other
contractor,services_other
interior_design,services_other
automotive_repair,car_repair
auto_repair,car_repair
motorcycle_repair,motorcycle_repair
car_wash,car_wash
gas_station,fuel
shipping_and_mailing,courier
courier,courier
insurance_agency,insurance
it_service_and_computer_repair,it_services
web_design,it_services
financial_service,credit_fund
bank_credit_union,bank
atm,atm
currency_exchange,money_exchange
pawn_shop,pawnshop
hospital,hospital
medical_center,clinic
medical_clinic,clinic
urgent_care,clinic
doctor,doctor
dermatologist,doctor
pediatrician,doctor
dentist,dentist
pharmacy,pharmacy
veterinarian,veterinary
optometrist,optician
medical_lab,medical_lab
laboratory_testing,medical_lab
obstetrician_and_gynecologist,maternity
traditional_chinese_medicine,traditional_medicine
acupuncture,traditional_medicine
physical_therapy,health_other
health_and_medical,health_other
preschool,kindergarten
kindergarten,kindergarten
elementary_school,primary_school
middle_school,secondary_school
high_school,high_school
school,school
private_school,school
public_school,school
college_university,university
university,university
college,college
community_college,college
language_school,language_center
tutoring_center,tutoring
vocational_and_technical_school,training_center
driving_school,driving_school
library,library
music_school,training_center
art_school,training_center
education,education_other
educational_services,education_other
hotel,hotel
motel,motel
hostel,hostel
guest_house,guest_house
bed_and_breakfast,guest_house
vacation_rental,homestay
resort,resort
serviced_apartments,apartment_rental
lodging,lodging_other
accommodation,lodging_other
movie_theater,cinema
gym,gym
fitness_center,gym
yoga_studio,gym
martial_arts_club,gym
swimming_pool,swimming_pool
stadium_arena,stadium
sports_club,sports_center
sports_and_recreation_venue,sports_center
soccer_field,football_pitch
badminton_court,badminton_court
tennis_court,tennis_court
pool_hall,billiards
billiards,billiards
bowling_alley,bowling
internet_cafe,gaming_center
video_game_arcade,gaming_center
amusement_park,amusement_park
theme_park,amusement_park
water_park,water_park
golf_course,entertainment_sport_other
dance_studio,entertainment_sport_other
arts_and_entertainment,entertainment_sport_other
active_life,entertainment_sport_other
museum,museum
art_gallery,art_gallery
theater,theatre
performing_arts_venue,theatre
monument,monument
historical_landmark,historic_site
landmark_and_historical_building,historic_site
tourist_attraction,tourist_attraction
scenic_lookout,viewpoint
zoo,zoo
aquarium,aquarium
park,park
garden,garden
botanical_garden,garden
beach,beach
cultural_center,cultural_center
tourist_information_center,tourist_info
attractions_and_activities,culture_tourism_other
bus_stop,bus_stop
bus_station,bus_station
train_station,train_station
metro_station,metro_station
airport,airport
ferry_terminal,ferry_terminal
taxi_service,taxi_stand
parking,parking
parking_lot,parking
motorcycle_parking,parking_motorcycle
ev_charging_station,charging_station
toll_booth,toll_booth
port,port
marina,port
transportation,transport_other
public_transportation,transport_other
travel_and_transportation,transport_other
city_hall,town_hall
town_hall,town_hall
government_office,government_office
public_service_government,government_office
public_and_government_association,government_office
police_department,police
fire_department,fire_station
courthouse,courthouse
post_office,post_office
embassy,embassy
social_services,social_facility
community_center,community_center
public_toilet,public_toilet
cemetery,cemetery
political_party_office,public_admin_other
buddhist_temple,pagoda
church,church
church_cathedral,church
catholic_church,church
temple,temple
hindu_temple,temple
mosque,mosque
shrine,shrine
monastery,monastery
place_of_worship,religion_community_other
religious_organization,religion_community_other
community_services_non_profits,religion_community_other
```

`db/seed/category_map_fsq.csv` (nhãn FSQ; mapCategory thử **lá**, rồi đường dẫn cấp 2, rồi cấp 1 — nên có cả dòng cấp 1/2 làm dự phòng):
```
# FSQ fsq_category_labels — lá, cấp 2, cấp 1
Dining and Drinking,food_drink_other
Restaurant,restaurant
Vietnamese Restaurant,restaurant
Asian Restaurant,restaurant
Seafood Restaurant,restaurant
Chinese Restaurant,restaurant
Japanese Restaurant,restaurant
Korean Restaurant,restaurant
Thai Restaurant,restaurant
BBQ Joint,restaurant
Hot Pot Restaurant,restaurant
Vegan and Vegetarian Restaurant,restaurant
Noodle Restaurant,restaurant
Pizzeria,restaurant
Sushi Restaurant,restaurant
Steakhouse,restaurant
Buffet,restaurant
Breakfast Spot,restaurant
Burger Joint,fast_food
Fried Chicken Joint,fast_food
Fast Food Restaurant,fast_food
Street Food Gathering,street_food
Food Truck,street_food
Food Stand,street_food
Food Court,food_court
"Cafe, Coffee, and Tea House",cafe
Café,cafe
Cafe,cafe
Coffee Shop,cafe
Tea Room,tea_house
Bubble Tea Shop,bubble_tea
Juice Bar,juice_bar
Bakery,bakery
Dessert Shop,dessert
Ice Cream Parlor,ice_cream
Bar,bar
Beer Bar,bar
Beer Garden,pub
Pub,pub
Cocktail Bar,bar
Lounge,bar
Hookah Bar,bar
Night Club,nightclub
Karaoke Bar,karaoke
Retail,shopping_other
Grocery Store,convenience
Supermarket,supermarket
Convenience Store,convenience
Shopping Mall,mall
Market,market
Flea Market,market
Fashion Retail,clothes
Clothing Store,clothes
Women's Store,clothes
Men's Store,clothes
Kids Store,clothes
Shoe Store,shoes
Computers and Electronics Retail,electronics
Electronics Store,electronics
Mobile Phone Store,mobile_phone
Furniture and Home Store,furniture
Hardware Store,hardware
Jewelry Store,jewelry
Bookstore,bookshop
Office Supply Store,stationery
Flower Store,florist
Gift Store,gift
Cosmetics Store,cosmetics
Sporting Goods Retail,sports_shop
Pet Supplies Store,pet_shop
Toy Store,toys
Motorcycle Dealership,motorcycle_shop
Car Dealership,car_dealer
Automotive Retail,shopping_other
Bicycle Store,bicycle_shop
Department Store,department_store
Discount Store,shopping_other
Drugstore,pharmacy
Pharmacy,pharmacy
Optical Store,optician
Food and Beverage Retail,shopping_other
Liquor Store,shopping_other
Business and Professional Services,services_other
Health and Beauty Service,beauty_salon
Hair Salon,hair_salon
Barbershop,hair_salon
Nail Salon,beauty_salon
Skin Care Clinic,beauty_salon
Spa,spa
Massage Clinic,spa
Laundromat,laundry
Laundry Service,laundry
Dry Cleaner,laundry
Tailor,tailor
Photography Studio,photo_studio
Print Store,printing
Real Estate Service,real_estate
Real Estate Agency,real_estate
Legal Service,lawyer
Lawyer,lawyer
Accounting and Bookkeeping Service,accounting
Travel Agency,travel_agency
Coworking Space,coworking
Office,office
Automotive Service,car_repair
Automotive Repair Shop,car_repair
Motorcycle Repair Shop,motorcycle_repair
Car Wash and Detail,car_wash
Fuel Station,fuel
Shipping Store,courier
Insurance Agency,insurance
IT Service,it_services
Computer Repair Service,it_services
Advertising Agency,services_other
Financial Service,credit_fund
Bank,bank
ATM,atm
Currency Exchange,money_exchange
Pawn Shop,pawnshop
Health and Medicine,health_other
Hospital,hospital
Emergency Room,hospital
Medical Center,clinic
Urgent Care Center,clinic
Physician,doctor
Dermatologist,doctor
Pediatrician,doctor
Dentist,dentist
Veterinarian,veterinary
Optometrist,optician
Medical Lab,medical_lab
Obstetrician Gynecologist (Ob-gyn),maternity
Maternity Clinic,maternity
Alternative Medicine Clinic,traditional_medicine
Acupuncture Clinic,traditional_medicine
Physical Therapy Clinic,health_other
Community and Government,public_admin_other
Education,education_other
Preschool,kindergarten
Elementary School,primary_school
Middle School,secondary_school
High School,high_school
School,school
Private School,school
College and University,university
University,university
Community College,college
Language School,language_center
Tutoring Service,tutoring
Vocational School,training_center
Driving School,driving_school
Library,library
Music School,training_center
Art School,training_center
Government Building,government_office
City Hall,town_hall
Town Hall,town_hall
Police Station,police
Fire Station,fire_station
Courthouse,courthouse
Post Office,post_office
Embassy or Consulate,embassy
Social Services Organization,social_facility
Community Center,community_center
Public Bathroom,public_toilet
Cemetery,cemetery
Organization,public_admin_other
Non-Profit Organization,public_admin_other
Spiritual Center,religion_community_other
Buddhist Temple,pagoda
Church,church
Temple,temple
Mosque,mosque
Hindu Temple,temple
Shrine,shrine
Monastery,monastery
Arts and Entertainment,entertainment_sport_other
Movie Theater,cinema
Museum,museum
Art Gallery,art_gallery
Theater,theatre
Performing Arts Venue,theatre
Concert Hall,theatre
Music Venue,theatre
Amusement Park,amusement_park
Water Park,water_park
Arcade,gaming_center
Internet Cafe,gaming_center
Bowling Alley,bowling
Pool Hall,billiards
Zoo,zoo
Aquarium,aquarium
Stadium,stadium
Casino,entertainment_sport_other
Sports and Recreation,entertainment_sport_other
Gym and Studio,gym
Gym,gym
Yoga Studio,gym
Martial Arts Dojo,gym
Swimming Pool,swimming_pool
Soccer Field,football_pitch
Athletic Field,football_pitch
Badminton Court,badminton_court
Tennis Court,tennis_court
Sports Club,sports_center
Golf Course,entertainment_sport_other
Basketball Court,entertainment_sport_other
Playground,entertainment_sport_other
Landmarks and Outdoors,culture_tourism_other
Park,park
Garden,garden
Botanical Garden,garden
Beach,beach
Scenic Lookout,viewpoint
Historic and Protected Site,historic_site
Monument,monument
Public Art,monument
Lake,culture_tourism_other
Mountain,culture_tourism_other
Plaza,culture_tourism_other
Bridge,culture_tourism_other
Island,culture_tourism_other
Travel and Transportation,transport_other
Lodging,lodging_other
Hotel,hotel
Motel,motel
Hostel,hostel
Bed and Breakfast,guest_house
Resort,resort
Vacation Rental,homestay
Bus Stop,bus_stop
Bus Station,bus_station
Train Station,train_station
Metro Station,metro_station
Airport,airport
Airport Terminal,airport
Boat or Ferry,ferry_terminal
Taxi,taxi_stand
Parking,parking
Electric Vehicle Charging Station,charging_station
Toll Plaza,toll_booth
Port,port
Pier,port
Rest Area,transport_other
```

Run: `pnpm test`
Expected: toàn bộ test taxonomy xanh. Nếu một mã đích gõ sai (test "mọi mã đích tồn tại" đỏ) → sửa CSV theo `category.json`.

- [ ] **Step 5: Script đo độ phủ trên dữ liệu thật + nạp taxonomy vào DB**

`pipelines/poi/scripts/category-coverage.mjs`:
```js
#!/usr/bin/env node
// Đo độ phủ ánh xạ trên src_*: top-200 giá trị mỗi nguồn, giá trị chưa ánh xạ, tỉ lệ rơi vào other/*_other. Dùng: node category-coverage.mjs [--top 200]
import { connect } from '../src/pg.mjs';
import { arg } from '../src/lib/env.mjs';
import { OSM_DROP, OSM_KEYS, categoryFor, loadCategoryMaps, mapCategory } from '../src/taxonomy.mjs';

const top = Number(arg('--top', '200'));
const maps = loadCategoryMaps();
const isOther = (/** @type {string} */ code) => code === 'other' || code.endsWith('_other');
const sql = connect();
try {
  const osm = await sql.unsafe(`SELECT k || '=' || v AS value, count(*)::int AS n FROM src_osm_place, jsonb_each_text(tags) AS t(k, v)
    WHERE k = ANY($1) GROUP BY 1 ORDER BY 2 DESC LIMIT ${top}`, [OSM_KEYS]);
  const overture = await sql.unsafe(`SELECT category AS value, count(*)::int AS n FROM src_overture_place WHERE category IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT ${top}`);
  const fsq = await sql.unsafe(`SELECT label AS value, count(*)::int AS n FROM src_fsq_place, jsonb_array_elements_text(categories) AS label GROUP BY 1 ORDER BY 2 DESC LIMIT ${top}`);
  let exit = 0;
  for (const [source, rows] of /** @type {const} */ ([['osm', osm], ['overture', overture], ['fsq', fsq]])) {
    let total = 0;
    let other = 0;
    const unmapped = [];
    for (const r of rows) {
      if (source === 'osm' && OSM_DROP.has(r.value)) continue;
      total += r.n;
      const { code } = mapCategory(maps, source, r.value);
      if (isOther(code)) {
        other += r.n;
        unmapped.push(`${r.value} (${r.n})`);
      }
    }
    const pct = total ? ((100 * other) / total).toFixed(1) : '0';
    console.log(`\n== ${source}: top-${rows.length} giá trị, ${pct}% rơi vào other — chưa ánh xạ (${unmapped.length}):`);
    for (const u of unmapped.slice(0, 60)) console.log('  -', u);
    if (Number(pct) >= 10) exit = 1;
  }
  // Tỉ lệ other trên toàn bộ bản ghi (mỗi bản ghi lấy loại theo categoryFor), ước lượng bằng mẫu 200k
  const sample = await sql`SELECT category AS primary, categories->'alternate' AS alt FROM src_overture_place TABLESAMPLE SYSTEM (10) LIMIT 200000`;
  let o = 0;
  for (const r of sample) if (isOther(categoryFor(maps, 'overture', [r.primary, ...(Array.isArray(r.alt) ? r.alt : [])]).code)) o++;
  console.log(`\nOverture (mẫu ${sample.length}): ${((100 * o) / Math.max(1, sample.length)).toFixed(1)}% other sau khi dùng alternate`);
  process.exit(exit);
} finally {
  await sql.end();
}
```

Run: `PIPE pipeline node pipelines/poi/scripts/category-coverage.mjs`
Expected: 3 khối `== osm/overture/fsq: … X% rơi vào other`, mỗi X < 10, exit 0. Nếu ≥ 10%: thêm dòng ánh xạ cho các giá trị in ra (ưu tiên số lượng lớn) vào CSV tương ứng, chạy lại tới khi đạt; mọi giá trị top-200 phải có ánh xạ **không phải** other/*_other trừ khi thật sự không phân loại được (ghi chú `#` trong CSV).

Run: `PIPE pipeline node pipelines/poi/src/taxonomy.mjs load`
Expected: `✓ category 163 mã; category_map N dòng`.

Run: `PIPE pipeline node pipelines/poi/src/taxonomy.mjs load` (lần 2)
Expected: cùng kết quả — idempotent.

- [ ] **Step 6: Lint, DEVLOG, commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`

Sửa `docs/DEVLOG.md`: "Task đang làm: Task 7"; mục 3: "Taxonomy: 163 lá + nhóm giả `other`; OSM có `OSM_DROP` và tag phụ (religion/sport/station); cấp trường suy từ tên"; mục 4 dòng `M2 T6` kèm % other từng nguồn.

```bash
git add -A
git commit -m "feat(taxonomy): 12 nhóm/163 lá, ánh xạ OSM/Overture/FSQ, mapCategory + đo độ phủ, nạp category vào DB"
git push
```

---

### Task 7: Gộp (conflation) — `records` → cặp ứng viên PostGIS → ghép tham lam → `poi` (ID ULID ổn định)

**Files:**
- Create: `pipelines/poi/src/lib/{contacts,stable-id,greedy}.mjs`, `pipelines/poi/src/{records,score,conflate,publish,report}.mjs`, `pipelines/poi/tests/{contacts,stable-id,greedy,score}.test.mjs`, `pipelines/poi/tests/conflate.dbtest.mjs`
- Modify: `pipelines/poi/README.md`

Dòng chảy (spec 5.4): `records.mjs` quét `src_*` → `poi_work_record` (tên chuẩn hoá, `name_core`, loại, sđt E.164, domain, địa chỉ đã tách, điểm đầy đủ) → `conflate.mjs` tạo `poi_work_pair` bằng PostGIS (≤ 150 m, `similarity(name_core) ≥ 0,4`, nhóm tương thích) → Node ghép tham lam 2 lượt (0: trùng cùng nguồn, sim ≥ 0,8; 1: liên nguồn, sim ≥ 0,6 hoặc ≥ 0,45 khi trùng sđt/domain; **không** gộp nếu hai bên có số nhà khác nhau) → `poi_work_cluster` + `poi_work_cluster_meta` (nguồn chính, ID, quality, popularity) → `publish.mjs` dựng `poi_new` rồi **gộp** vào `poi`/`poi_source_link` trong một transaction có kiểm sanity ≤ 10 %.

- [ ] **Step 1: Test hàm thuần liên hệ, ID ổn định, điểm, ghép tham lam (thất bại)**

`pipelines/poi/tests/contacts.test.mjs`:
```js
import { describe, expect, it } from 'vitest';
import { domainOf, domainsOf, normalizePhoneVN, phonesOf } from '../src/lib/contacts.mjs';

describe('normalizePhoneVN → E.164', () => {
  it('cố định và di động, mọi cách viết', () => {
    expect(normalizePhoneVN('028 3822 9999')).toBe('+842838229999');
    expect(normalizePhoneVN('(028) 3822-9999')).toBe('+842838229999');
    expect(normalizePhoneVN('+84 28 3822 9999')).toBe('+842838229999');
    expect(normalizePhoneVN('0909 123 456')).toBe('+84909123456');
    expect(normalizePhoneVN('84909123456')).toBe('+84909123456');
    expect(normalizePhoneVN('0084909123456')).toBe('+84909123456');
  });
  it('tổng đài 1900/1800, số quá ngắn/dài, rác → null', () => {
    expect(normalizePhoneVN('1900 1234')).toBeNull();
    expect(normalizePhoneVN('0123')).toBeNull();
    expect(normalizePhoneVN('0909123456789')).toBeNull();
    expect(normalizePhoneVN('không có')).toBeNull();
  });
  it('phonesOf: tách ; và /, loại trùng, bỏ null', () => {
    expect(phonesOf(['0909 123 456; 028 3822 9999', '+84909123456', 'abc'])).toEqual(['+84909123456', '+842838229999']);
  });
});

describe('domainOf / domainsOf', () => {
  it('lấy host, bỏ www, thêm scheme nếu thiếu', () => {
    expect(domainOf('https://www.highlandscoffee.com.vn/stores/1')).toBe('highlandscoffee.com.vn');
    expect(domainOf('phuclong.com.vn')).toBe('phuclong.com.vn');
    expect(domainOf('HTTP://Shop.Example.COM')).toBe('shop.example.com');
  });
  it('mạng xã hội/sàn TMĐT không dùng để khớp → null', () => {
    expect(domainOf('https://www.facebook.com/congcaphe')).toBeNull();
    expect(domainOf('https://shopee.vn/abc')).toBeNull();
    expect(domainOf('not a url at all ...')).toBeNull();
  });
  it('domainsOf loại trùng', () => {
    expect(domainsOf(['https://a.vn/x', 'http://www.a.vn', 'https://facebook.com/a'])).toEqual(['a.vn']);
  });
});
```

`pipelines/poi/tests/stable-id.test.mjs`:
```js
import { describe, expect, it } from 'vitest';
import { stableId } from '../src/lib/stable-id.mjs';

describe('stableId', () => {
  it('26 ký tự Crockford base32, xác định, khác nhau theo đầu vào', () => {
    const a = stableId('overture', '08f3a1b2c3d4e5f6');
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(stableId('overture', '08f3a1b2c3d4e5f6')).toBe(a);
    expect(stableId('osm', 'n123')).not.toBe(stableId('osm', 'w123'));
    expect(stableId('osm', '123')).not.toBe(stableId('fsq', '123'));
  });
});
```

`pipelines/poi/tests/score.test.mjs`:
```js
import { describe, expect, it } from 'vitest';
import { SOURCE_ORDER, pickPrimary, popularity, qualityScore } from '../src/score.mjs';

describe('qualityScore (spec 5.5)', () => {
  it('đủ mọi trường, 2 nguồn, mới → 100', () => {
    expect(qualityScore({ hasPhone: true, hasWebsite: true, hasHours: true, hasHousenumber: true, sourceCount: 2, confidence: 1, monthsOld: 3 })).toBe(100);
  });
  it('1 nguồn confidence 0,5, không trường, 30 tháng → 10 (conf) + 10 (độ mới)', () => {
    expect(qualityScore({ hasPhone: false, hasWebsite: false, hasHours: false, hasHousenumber: false, sourceCount: 1, confidence: 0.5, monthsOld: 30 })).toBe(20);
  });
  it('độ mới: ≤ 12 tháng = 20, ≥ 48 tháng = 0; 1 nguồn confidence ≥ 0,7 được 10 đồng thuận', () => {
    expect(qualityScore({ hasPhone: true, hasWebsite: false, hasHours: false, hasHousenumber: false, sourceCount: 1, confidence: 0.7, monthsOld: 60 })).toBe(10 + 10 + 14);
  });
});

describe('popularity', () => {
  it('log2(1+nguồn) + 0,5 nếu có FSQ + 0,2/đóng góp (tối đa 1)', () => {
    expect(popularity({ sourceCount: 1, hasFsq: false })).toBe(1);
    expect(popularity({ sourceCount: 3, hasFsq: true })).toBe(2.5);
    expect(popularity({ sourceCount: 1, hasFsq: false, approvedEdits: 10 })).toBe(2);
  });
});

describe('pickPrimary', () => {
  it('điểm đầy đủ cao nhất; hoà → OSM > Overture > FSQ', () => {
    expect(SOURCE_ORDER).toEqual({ osm: 0, overture: 1, fsq: 2 });
    expect(pickPrimary([{ rid: 1, source: 'fsq', completeness: 8 }, { rid: 2, source: 'overture', completeness: 9 }]).rid).toBe(2);
    expect(pickPrimary([{ rid: 1, source: 'fsq', completeness: 8 }, { rid: 2, source: 'osm', completeness: 8 }]).rid).toBe(2);
  });
});
```

`pipelines/poi/tests/greedy.test.mjs`:
```js
import { describe, expect, it } from 'vitest';
import { createClusterer, pairAllowed, pairScore } from '../src/lib/greedy.mjs';

const base = { sa: 'osm', sb: 'overture', sim: 0.9, dist_m: 20, ga: 'food_drink', gb: 'food_drink', pa: [], pb: [], da: [], db: [], ha: null, hb: null, sta: null, stb: null };

describe('pairAllowed (spec 5.4 bước 1–3 + luật chuỗi cửa hàng)', () => {
  it('Cộng ~ Cong Caphe: sim cao, cùng nhóm, gần → gộp', () => {
    expect(pairAllowed({ ...base, sim: 0.75 })).toBe(true);
  });
  it('ngưỡng 0,6; hoặc 0,45 khi trùng sđt/domain', () => {
    expect(pairAllowed({ ...base, sim: 0.5 })).toBe(false);
    expect(pairAllowed({ ...base, sim: 0.5, pa: ['+84909123456'], pb: ['+84909123456'] })).toBe(true);
    expect(pairAllowed({ ...base, sim: 0.5, da: ['a.vn'], db: ['a.vn'] })).toBe(true);
  });
  it('nhóm khác → không; một bên other → được', () => {
    expect(pairAllowed({ ...base, gb: 'health' })).toBe(false);
    expect(pairAllowed({ ...base, gb: 'other' })).toBe(true);
  });
  it('bán kính 75 m; 150 m khi CẢ HAI thuộc education/health/public_admin/transport', () => {
    expect(pairAllowed({ ...base, dist_m: 90 })).toBe(false);
    expect(pairAllowed({ ...base, dist_m: 90, ga: 'education', gb: 'education' })).toBe(true);
    expect(pairAllowed({ ...base, dist_m: 90, ga: 'education', gb: 'other' })).toBe(false);
  });
  it('hai quán cùng chuỗi cách 60 m, số nhà khác nhau → KHÔNG gộp; cùng số nhà → gộp', () => {
    expect(pairAllowed({ ...base, sim: 1, dist_m: 60, ha: '18', hb: '76', sta: 'nguyen hue', stb: 'nguyen hue' })).toBe(false);
    expect(pairAllowed({ ...base, sim: 1, dist_m: 60, ha: '18', hb: '18', sta: 'nguyen hue', stb: 'nguyen hue' })).toBe(true);
    expect(pairAllowed({ ...base, sim: 1, dist_m: 60, ha: '18', hb: null })).toBe(true);
  });
  it('đường khác nhau (không chứa nhau) → không gộp', () => {
    expect(pairAllowed({ ...base, sta: 'nguyen hue', stb: 'le loi' })).toBe(false);
    expect(pairAllowed({ ...base, sta: 'nguyen hue', stb: 'duong nguyen hue' })).toBe(true);
  });
  it('cùng nguồn: sim ≥ 0,8 và (≤ 30 m hoặc trùng sđt/domain hoặc cùng số nhà)', () => {
    const same = { ...base, sb: 'osm' };
    expect(pairAllowed({ ...same, sim: 0.9, dist_m: 20 })).toBe(true);
    expect(pairAllowed({ ...same, sim: 0.9, dist_m: 60 })).toBe(false);
    expect(pairAllowed({ ...same, sim: 0.9, dist_m: 60, pa: ['+84909123456'], pb: ['+84909123456'] })).toBe(true);
    expect(pairAllowed({ ...same, sim: 0.7, dist_m: 10 })).toBe(false);
  });
  it('pairScore = 0,6·sim + 0,4·(1 − d/75), d kẹp ở 75', () => {
    expect(pairScore({ sim: 1, dist_m: 0 })).toBeCloseTo(1);
    expect(pairScore({ sim: 0.5, dist_m: 75 })).toBeCloseTo(0.3);
    expect(pairScore({ sim: 0.5, dist_m: 150 })).toBeCloseTo(0.3);
  });
});

describe('createClusterer — ghép tham lam, không bắc cầu', () => {
  const src = { 1: 'osm', 2: 'overture', 3: 'fsq', 4: 'overture', 5: 'osm' };
  it('mỗi bản ghi một cụm; tối đa 1 bản ghi mỗi nguồn; không gộp hai cụm đã có', () => {
    const c = createClusterer(5, { sourceOf: (r) => src[r], onePerSource: true });
    c.consider(1, 2); // cụm A {1,2}
    c.consider(2, 3); // 3 (fsq) vào A → {1,2,3}
    c.consider(2, 4); // 4 là overture, A đã có overture → bỏ
    c.consider(4, 5); // cụm B {4,5}
    c.consider(3, 5); // 3 ∈ A, 5 ∈ B → không gộp cụm
    const { clusterOf, members } = c.result();
    expect(clusterOf[1]).toBe(clusterOf[2]);
    expect(clusterOf[3]).toBe(clusterOf[1]);
    expect(clusterOf[4]).toBe(clusterOf[5]);
    expect(clusterOf[4]).not.toBe(clusterOf[1]);
    expect(members.get(clusterOf[1])).toEqual([1, 2, 3]);
  });
  it('lượt trùng cùng nguồn: không giới hạn nguồn nhưng giới hạn kích cỡ', () => {
    const c = createClusterer(5, { sourceOf: () => 'overture', onePerSource: false, maxSize: 2 });
    c.consider(1, 2);
    c.consider(2, 3); // cụm đã đủ 2 → bỏ
    const { clusterOf } = c.result();
    expect(clusterOf[3]).toBe(0);
  });
});
```

Run: `pnpm test`
Expected: FAIL — thiếu 4 module.

- [ ] **Step 2: Viết hàm thuần**

`pipelines/poi/src/lib/contacts.mjs`:
```js
const SOCIAL = new Set(['facebook.com', 'fb.com', 'm.me', 'instagram.com', 'tiktok.com', 'youtube.com', 'zalo.me', 'shopee.vn', 'lazada.vn', 'tiki.vn', 'google.com', 'goo.gl', 'linktr.ee', 'twitter.com', 'x.com', 'grab.com', 'foody.vn']);

/** Số điện thoại VN → E.164 (+84…); tổng đài 1900/1800 và số không hợp lệ → null. @param {unknown} raw */
export function normalizePhoneVN(raw) {
  let s = String(raw ?? '').replace(/[^\d+]/g, '');
  if (s.startsWith('+84')) s = s.slice(3);
  else if (s.startsWith('0084')) s = s.slice(4);
  else if (s.startsWith('84') && s.length >= 11) s = s.slice(2);
  else if (s.startsWith('0')) s = s.slice(1);
  else return null;
  if (!/^[1-9]\d{8,9}$/.test(s)) return null; // di động 9 số, cố định 10 số (mã vùng 3 số + 7–8 số)
  return `+84${s}`;
}

/** @param {(string | null | undefined)[] | null | undefined} list */
export function phonesOf(list) {
  const out = new Set();
  for (const item of list ?? []) for (const part of String(item ?? '').split(/[;/,]/)) {
    const p = normalizePhoneVN(part);
    if (p) out.add(p);
  }
  return [...out];
}

/** Host của URL (bỏ www.), null nếu là mạng xã hội/sàn TMĐT hoặc không phải URL. @param {unknown} url */
export function domainOf(url) {
  const s = String(url ?? '').trim();
  if (!s || /\s/.test(s)) return null;
  try {
    const host = new URL(/^https?:\/\//i.test(s) ? s : `http://${s}`).hostname.toLowerCase().replace(/^www\./, '');
    if (!host.includes('.') || SOCIAL.has(host) || [...SOCIAL].some((d) => host.endsWith(`.${d}`))) return null;
    return host;
  } catch {
    return null;
  }
}

/** @param {(string | null | undefined)[] | null | undefined} list */
export function domainsOf(list) {
  return [...new Set((list ?? []).map(domainOf).filter((d) => d !== null))];
}
```

`pipelines/poi/src/lib/stable-id.mjs`:
```js
import { createHash } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32 (bảng chữ của ULID)

/** poi.id = ULID(hash(primary_source, primary_source_id)) — spec 5.4.8: 128 bit đầu của sha256 → 26 ký tự. */
export function stableId(source, sourceId) {
  const bytes = createHash('sha256').update(`${source}:${sourceId}`).digest().subarray(0, 16);
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  let out = '';
  for (let i = 0; i < 26; i++) {
    out = ALPHABET[Number(bits & 31n)] + out;
    bits >>= 5n;
  }
  return out;
}
```

`pipelines/poi/src/lib/greedy.mjs`:
```js
const BIG_AREA = new Set(['education', 'health', 'public_admin', 'transport']);

/** @param {unknown[] | null | undefined} a @param {unknown[] | null | undefined} b */
const overlap = (a, b) => Boolean(a?.length && b?.length && a.some((x) => b.includes(x)));
/** @param {string} h */
const normHn = (h) => h.toLowerCase().replace(/\s+/g, '');

/**
 * Luật gộp một cặp ứng viên (spec 5.4 bước 1–4 + luật chuỗi cửa hàng).
 * @param {{ sa: string, sb: string, sim: number, dist_m: number, ga: string, gb: string,
 *   pa?: string[] | null, pb?: string[] | null, da?: string[] | null, db?: string[] | null,
 *   ha?: string | null, hb?: string | null, sta?: string | null, stb?: string | null }} p
 */
export function pairAllowed(p) {
  if (!(p.ga === p.gb || p.ga === 'other' || p.gb === 'other')) return false;
  const radius = BIG_AREA.has(p.ga) && BIG_AREA.has(p.gb) ? 150 : 75;
  if (p.dist_m > radius) return false;
  if (p.ha && p.hb && normHn(p.ha) !== normHn(p.hb)) return false;
  if (p.sta && p.stb && p.sta !== p.stb && !p.sta.includes(p.stb) && !p.stb.includes(p.sta)) return false;
  const shared = overlap(p.pa, p.pb) || overlap(p.da, p.db);
  if (p.sa === p.sb) return p.sim >= 0.8 && (p.dist_m <= 30 || shared || Boolean(p.ha && p.hb));
  return p.sim >= 0.6 || (p.sim >= 0.45 && shared);
}

/** @param {{ sim: number, dist_m: number }} p */
export function pairScore(p) {
  return 0.6 * p.sim + 0.4 * (1 - Math.min(p.dist_m, 75) / 75);
}

/**
 * Ghép tham lam: cặp đưa vào theo điểm giảm dần; mỗi bản ghi chỉ vào một cụm; không gộp hai cụm đã có (không bắc cầu).
 * @param {number} maxRid
 * @param {{ sourceOf: (rid: number) => string, onePerSource: boolean, maxSize?: number }} opts
 */
export function createClusterer(maxRid, opts) {
  const clusterOf = new Int32Array(maxRid + 1); // 0 = chưa có cụm
  /** @type {Map<number, number[]>} */
  const members = new Map();
  let next = 1;
  const maxSize = opts.maxSize ?? 3;
  /** @param {number} cid @param {number} rid */
  const canJoin = (cid, rid) => {
    const m = members.get(cid) ?? [];
    if (m.length >= maxSize) return false;
    return !opts.onePerSource || !m.some((x) => opts.sourceOf(x) === opts.sourceOf(rid));
  };
  return {
    /** @param {number} a @param {number} b */
    consider(a, b) {
      const ca = clusterOf[a] ?? 0;
      const cb = clusterOf[b] ?? 0;
      if (ca && cb) return; // cùng cụm hoặc hai cụm khác nhau → không gộp
      if (!ca && !cb) {
        if (opts.onePerSource && opts.sourceOf(a) === opts.sourceOf(b)) return;
        const cid = next++;
        clusterOf[a] = cid;
        clusterOf[b] = cid;
        members.set(cid, [a, b]);
        return;
      }
      const [cid, rid] = ca ? [ca, b] : [cb, a];
      if (!canJoin(cid, rid)) return;
      clusterOf[rid] = cid;
      members.get(cid)?.push(rid);
    },
    result: () => ({ clusterOf, members }),
  };
}
```

`pipelines/poi/src/score.mjs`:
```js
export const SOURCE_ORDER = /** @type {Record<string, number>} */ ({ osm: 0, overture: 1, fsq: 2 });

/** spec 5.5 quality_score 0–100. @param {{ hasPhone: boolean, hasWebsite: boolean, hasHours: boolean, hasHousenumber: boolean, sourceCount: number, confidence: number, monthsOld: number }} r */
export function qualityScore(r) {
  const fields = 10 * (Number(r.hasPhone) + Number(r.hasWebsite) + Number(r.hasHours) + Number(r.hasHousenumber));
  const consensus = r.sourceCount >= 2 ? 20 : r.confidence >= 0.7 ? 10 : 0;
  const conf = Math.round(20 * Math.min(1, Math.max(0, r.confidence)));
  const recency = r.monthsOld <= 12 ? 20 : r.monthsOld >= 48 ? 0 : Math.round((20 * (48 - r.monthsOld)) / 36);
  return Math.min(100, fields + consensus + conf + recency);
}

/** spec 5.5 popularity (không hiển thị). @param {{ sourceCount: number, hasFsq: boolean, approvedEdits?: number }} r */
export function popularity(r) {
  return Math.log2(1 + r.sourceCount) + (r.hasFsq ? 0.5 : 0) + Math.min(1, (r.approvedEdits ?? 0) * 0.2);
}

/** Nguồn chính: điểm đầy đủ cao nhất; hoà → OSM > Overture > FSQ. @param {{ rid: number, source: string, completeness: number }[]} members */
export function pickPrimary(members) {
  return [...members].sort((a, b) => b.completeness - a.completeness || (SOURCE_ORDER[a.source] ?? 9) - (SOURCE_ORDER[b.source] ?? 9))[0];
}
```

Run: `pnpm test`
Expected: xanh.

- [ ] **Step 3: `records.mjs` — bảng làm việc `poi_work_record`**

```js
#!/usr/bin/env node
// Bước 1 gộp: quét src_osm_place / src_overture_place / src_fsq_place → poi_work_record. Idempotent (dựng lại toàn bộ).
import { nameCore, normalizeVi, parseAddress } from '@mapslibvn/core';
import { ewkt, pgArray, pgJson } from './lib/copy-format.mjs';
import { domainsOf, phonesOf } from './lib/contacts.mjs';
import { vnDate } from './lib/env.mjs';
import { connect, copyInto, countRows } from './pg.mjs';
import { categoryFor, loadCategories, loadCategoryMaps, refineSchool } from './taxonomy.mjs';

/** Nhóm cho phép POI OSM không có tên (tên = tên loại): spec "khung xương" cơ sở công. */
const UNNAMED_OK = new Set(['transport', 'public_admin', 'health', 'education', 'religion_community']);
const maps = loadCategoryMaps();
const catVi = new Map(loadCategories().map((c) => [c.code, c.vi]));
const today = vnDate();
const dateStr = (/** @type {unknown} */ v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : today);

export const RECORD_COLUMNS = [
  'source', 'source_id', 'name', 'name_norm', 'name_core', 'name_alt', 'group_code', 'category', 'confidence', 'phones', 'domains',
  'housenumber', 'street', 'street_norm', 'ward', 'ward_norm', 'province', 'province_norm', 'address_text', 'contact', 'hours',
  'has_phone', 'has_website', 'has_hours', 'has_housenumber', 'has_category', 'completeness', 'updated_at', 'closed', 'geom',
];

/** @param {{ source: string, sourceId: string, name: string, nameAlt: string[], cat: { code: string, group: string }, confidence: number,
 *   phones: unknown[], websites: unknown[], facebook: string | null, hours: Record<string, unknown> | null, address: string | null,
 *   updatedAt: unknown, closed: boolean, lon: number, lat: number }} r */
export function buildRow(r) {
  const addr = r.address ? parseAddress(r.address) : { alleyChain: [], confidence: 0 };
  const e164 = phonesOf(/** @type {string[]} */ (r.phones));
  const domains = domainsOf(/** @type {string[]} */ (r.websites));
  const websites = r.websites.filter(Boolean).map(String);
  const f = {
    phone: e164.length > 0,
    website: websites.length > 0,
    hours: r.hours !== null,
    hn: Boolean(addr.housenumber),
    cat: r.cat.code !== 'other' && !r.cat.code.endsWith('_other'),
  };
  const completeness = 3 * Number(f.phone) + 3 * Number(f.website) + 2 * Number(f.hours) + 2 * Number(f.hn) + Number(f.cat) + 2 * r.confidence;
  return [
    r.source, r.sourceId, r.name, normalizeVi(r.name), nameCore(r.name), r.nameAlt.length ? pgArray(r.nameAlt) : null, r.cat.group, r.cat.code, r.confidence,
    pgArray(e164), pgArray(domains), addr.housenumber ?? null, addr.street ?? null, addr.streetNorm ?? null, addr.ward ?? null,
    addr.ward ? normalizeVi(addr.ward) : null, addr.province ?? null, addr.province ? normalizeVi(addr.province) : null, r.address,
    pgJson({ phone: e164, website: websites, facebook: r.facebook }), r.hours ? pgJson(r.hours) : null,
    f.phone, f.website, f.hours, f.hn, f.cat, completeness, dateStr(r.updatedAt), r.closed, ewkt(r.lon, r.lat),
  ];
}

async function* osmRows(sql) {
  for await (const rows of sql`SELECT osm_type, osm_id, name, tags, ST_X(geom) AS lon, ST_Y(geom) AS lat, release FROM src_osm_place`.cursor(2000)) {
    for (const r of rows) {
      const t = /** @type {Record<string, string>} */ (r.tags);
      const cat0 = categoryFor(maps, 'osm', t);
      if (!cat0) continue; // chỉ có addr:* (dùng cho anchors) hoặc thuộc OSM_DROP
      let name = r.name;
      if (!name) {
        if (!UNNAMED_OK.has(cat0.group)) continue;
        name = catVi.get(cat0.code) ?? cat0.code;
      }
      const cat = { code: refineSchool(cat0.code, name), group: cat0.group };
      const line1 = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
      const address = line1 ? [line1, t['addr:suburb'] ?? t['addr:quarter'], t['addr:district'], t['addr:city'] ?? t['addr:province']].filter(Boolean).join(', ') : null;
      yield buildRow({
        source: 'osm', sourceId: `${r.osm_type}${r.osm_id}`, name,
        nameAlt: [t['name:en'], t.alt_name, t.old_name, t.official_name].filter((x) => x && x !== name),
        cat, confidence: 1,
        phones: [t.phone, t['contact:phone'], t.mobile, t['contact:mobile']],
        websites: [t.website, t['contact:website'], t.url],
        facebook: t['contact:facebook'] ?? null,
        hours: t.opening_hours ? { osm: t.opening_hours } : null,
        address, updatedAt: r.release, closed: t.disused === 'yes' || 'disused:amenity' in t || 'disused:shop' in t, lon: r.lon, lat: r.lat,
      });
    }
  }
}

async function* overtureRows(sql) {
  for await (const rows of sql`SELECT id, name, names, category, categories, confidence, addresses, websites, phones, sources, ST_X(geom) AS lon, ST_Y(geom) AS lat FROM src_overture_place WHERE name IS NOT NULL`.cursor(2000)) {
    for (const r of rows) {
      const alt = /** @type {string[]} */ (r.categories?.alternate ?? []);
      const cat = categoryFor(maps, 'overture', [r.category, ...alt]) ?? { code: 'other', group: 'other' };
      const a = r.addresses?.[0] ?? {};
      const meta = (r.sources ?? []).find((s) => s?.dataset === 'meta');
      const extra = (r.sources ?? []).find((s) => s?.dataset === '_overture_extra') ?? {};
      const fb = (extra.socials ?? []).find((u) => /facebook\.com|fb\.com/.test(String(u))) ?? (meta?.record_id ? `https://www.facebook.com/${meta.record_id}` : null);
      const common = r.names?.common ? Object.values(r.names.common) : [];
      yield buildRow({
        source: 'overture', sourceId: r.id, name: r.name,
        nameAlt: /** @type {string[]} */ (common.filter((x) => typeof x === 'string' && x !== r.name)),
        cat: { code: refineSchool(cat.code, r.name), group: cat.group }, confidence: r.confidence ?? 0.5,
        phones: r.phones ?? [], websites: r.websites ?? [],
        facebook: fb,
        hours: null, address: [a.freeform, a.locality, a.region].filter(Boolean).join(', ') || null,
        updatedAt: r.sources?.[0]?.update_time ?? today,
        closed: extra.operating_status !== null && extra.operating_status !== undefined && extra.operating_status !== 'open', // Overture operating_status
        lon: r.lon, lat: r.lat,
      });
    }
  }
}

async function* fsqRows(sql) {
  for await (const rows of sql`SELECT fsq_place_id, name, categories, address, locality, region, tel, website, date_closed, ST_X(geom) AS lon, ST_Y(geom) AS lat, release FROM src_fsq_place WHERE name IS NOT NULL`.cursor(2000)) {
    for (const r of rows) {
      const cat = categoryFor(maps, 'fsq', r.categories ?? []) ?? { code: 'other', group: 'other' };
      yield buildRow({
        source: 'fsq', sourceId: r.fsq_place_id, name: r.name, nameAlt: [],
        cat: { code: refineSchool(cat.code, r.name), group: cat.group }, confidence: 0.8,
        phones: [r.tel], websites: [r.website], facebook: null, hours: null,
        address: [r.address, r.locality, r.region].filter(Boolean).join(', ') || null,
        updatedAt: r.release, closed: r.date_closed !== null, lon: r.lon, lat: r.lat,
      });
    }
  }
}

if (process.argv[1]?.endsWith('records.mjs')) {
  const sql = connect();
  try {
    await sql.unsafe(`DROP TABLE IF EXISTS poi_work_pair, poi_work_cluster_meta, poi_work_cluster, poi_work_record`);
    await sql.unsafe(`CREATE TABLE poi_work_record (
      rid serial PRIMARY KEY, source text NOT NULL, source_id text NOT NULL, name text NOT NULL, name_norm text NOT NULL, name_core text NOT NULL,
      name_alt text[], group_code text NOT NULL, category text NOT NULL, confidence real NOT NULL, phones text[] NOT NULL, domains text[] NOT NULL,
      housenumber text, street text, street_norm text, ward text, ward_norm text, province text, province_norm text, address_text text,
      contact jsonb, hours jsonb, has_phone boolean, has_website boolean, has_hours boolean, has_housenumber boolean, has_category boolean,
      completeness real NOT NULL, updated_at date NOT NULL, closed boolean NOT NULL, geom geometry(Point, 4326) NOT NULL, UNIQUE (source, source_id))`);
    let n = 0;
    for (const gen of [osmRows, overtureRows, fsqRows]) n += await copyInto(sql, 'poi_work_record', RECORD_COLUMNS, gen(sql));
    await sql.unsafe(`CREATE INDEX poi_work_record_geom_idx ON poi_work_record USING gist (geom)`);
    await sql.unsafe(`CREATE INDEX poi_work_record_source_idx ON poi_work_record (source)`);
    await sql.unsafe(`ANALYZE poi_work_record`);
    const by = await sql`SELECT source, count(*)::int AS n FROM poi_work_record GROUP BY 1 ORDER BY 1`;
    console.log(`✓ poi_work_record: ${await countRows(sql, 'poi_work_record')} dòng (COPY ${n}) — ${by.map((b) => `${b.source}=${b.n}`).join(', ')}`);
  } finally {
    await sql.end();
  }
}
```

Run: `PIPE pipeline node pipelines/poi/src/records.mjs`
Expected (fixture đã ingest ở Task 5): `✓ poi_work_record: N dòng — fsq=…, osm=…, overture=…` với osm < số dòng `src_osm_place` (bỏ đối tượng chỉ có số nhà).

- [ ] **Step 4: `conflate.mjs` — cặp ứng viên (PostGIS) và ghép tham lam (Node)**

```js
#!/usr/bin/env node
// Bước 2 gộp (spec 5.4): poi_work_record → poi_work_pair (PostGIS) → 2 lượt ghép tham lam → poi_work_cluster + poi_work_cluster_meta.
import { createClusterer, pairAllowed } from './lib/greedy.mjs';
import { stableId } from './lib/stable-id.mjs';
import { connect, copyInto, countRows } from './pg.mjs';
import { SOURCE_ORDER, pickPrimary, popularity, qualityScore } from './score.mjs';

const SOURCES = ['osm', 'overture', 'fsq'];
const sql = connect();
try {
  // 1) Cặp ứng viên: ≤ 150 m (lọc thô theo độ, ~167 m), nhóm tương thích, sim ≥ 0,4. Điểm sắp = 0,6·sim + 0,4·(1 − min(d,75)/75).
  await sql.unsafe(`DROP TABLE IF EXISTS poi_work_pair, poi_work_cluster, poi_work_cluster_meta`);
  console.log('Tạo poi_work_pair …');
  await sql.unsafe(`CREATE TABLE poi_work_pair AS
    SELECT a.rid AS a, b.rid AS b, a.source AS sa, b.source AS sb, a.group_code AS ga, b.group_code AS gb,
           ST_Distance(a.geom::geography, b.geom::geography) AS dist_m, similarity(a.name_core, b.name_core) AS sim,
           a.phones AS pa, b.phones AS pb, a.domains AS da, b.domains AS db,
           a.housenumber AS ha, b.housenumber AS hb, a.street_norm AS sta, b.street_norm AS stb
    FROM poi_work_record a JOIN poi_work_record b
      ON a.rid < b.rid AND ST_DWithin(a.geom, b.geom, 0.0015)
     AND (a.group_code = b.group_code OR a.group_code = 'other' OR b.group_code = 'other')
    WHERE ST_Distance(a.geom::geography, b.geom::geography) <= 150 AND similarity(a.name_core, b.name_core) >= 0.4`);
  await sql.unsafe(`ALTER TABLE poi_work_pair ADD COLUMN score real; UPDATE poi_work_pair SET score = 0.6 * sim + 0.4 * (1 - LEAST(dist_m, 75) / 75)`);
  console.log(`  ${await countRows(sql, 'poi_work_pair')} cặp`);

  // 2) Thuộc tính bản ghi vào mảng typed (3,5 triệu dòng ≈ vài chục MB)
  const [{ max }] = await sql`SELECT max(rid)::int AS max FROM poi_work_record`;
  const maxRid = Number(max ?? 0);
  const src = new Uint8Array(maxRid + 1);
  const completeness = new Float32Array(maxRid + 1);
  const conf = new Float32Array(maxRid + 1);
  const flags = new Uint8Array(maxRid + 1); // bit0 phone, bit1 website, bit2 hours, bit3 housenumber, bit4 closed
  const months = new Uint16Array(maxRid + 1);
  const sourceIds = /** @type {string[]} */ (new Array(maxRid + 1));
  for await (const rows of sql`SELECT rid, source, source_id, completeness, confidence, has_phone, has_website, has_hours, has_housenumber, closed,
      GREATEST(0, (EXTRACT(YEAR FROM age(now(), updated_at)) * 12 + EXTRACT(MONTH FROM age(now(), updated_at))))::int AS months FROM poi_work_record`.cursor(5000)) {
    for (const r of rows) {
      src[r.rid] = SOURCES.indexOf(r.source) + 1;
      completeness[r.rid] = r.completeness;
      conf[r.rid] = r.confidence;
      flags[r.rid] = Number(r.has_phone) | (Number(r.has_website) << 1) | (Number(r.has_hours) << 2) | (Number(r.has_housenumber) << 3) | (Number(r.closed) << 4);
      months[r.rid] = Math.min(65535, r.months);
      sourceIds[r.rid] = r.source_id;
    }
  }
  const sourceOf = (/** @type {number} */ rid) => SOURCES[src[rid] - 1] ?? 'other';

  // 3) Lượt 0: trùng cùng nguồn → đại diện (nhiều nhất 10 bản/cụm)
  const dup = createClusterer(maxRid, { sourceOf, onePerSource: false, maxSize: 10 });
  for await (const rows of sql`SELECT * FROM poi_work_pair WHERE sa = sb ORDER BY score DESC`.cursor(5000)) for (const p of rows) if (pairAllowed(p)) dup.consider(p.a, p.b);
  const dupRes = dup.result();
  const repOf = new Int32Array(maxRid + 1); // 0 = chính nó là đại diện
  for (const m of dupRes.members.values()) {
    const rep = pickPrimary(m.map((rid) => ({ rid, source: sourceOf(rid), completeness: completeness[rid] ?? 0 }))).rid;
    for (const rid of m) if (rid !== rep) repOf[rid] = rep;
  }

  // 4) Lượt 1: liên nguồn giữa các đại diện, tối đa 1 bản/nguồn, không bắc cầu
  const cross = createClusterer(maxRid, { sourceOf, onePerSource: true, maxSize: 3 });
  for await (const rows of sql`SELECT * FROM poi_work_pair WHERE sa <> sb ORDER BY score DESC`.cursor(5000)) {
    for (const p of rows) if (!repOf[p.a] && !repOf[p.b] && pairAllowed(p)) cross.consider(p.a, p.b);
  }
  const { clusterOf, members } = cross.result();

  // 5) Cụm cuối: cụm liên nguồn → đại diện đơn lẻ → bản trùng cùng nguồn vào cụm của đại diện (vai trò secondary)
  /** @type {Map<number, number[]>} */
  const finalMembers = new Map();
  const finalOf = new Int32Array(maxRid + 1);
  let nextId = 1;
  for (const m of members.values()) {
    const cid = nextId++;
    for (const rid of m) finalOf[rid] = cid;
    finalMembers.set(cid, [...m]);
  }
  for (let rid = 1; rid <= maxRid; rid++) {
    if (!src[rid] || repOf[rid] || finalOf[rid]) continue;
    const cid = nextId++;
    finalOf[rid] = cid;
    finalMembers.set(cid, [rid]);
  }
  for (let rid = 1; rid <= maxRid; rid++) {
    if (!repOf[rid]) continue;
    const cid = finalOf[repOf[rid]] ?? 0;
    finalOf[rid] = cid;
    finalMembers.get(cid)?.push(rid);
  }

  // 6) Ghi cụm + meta (nguồn chính, ID ổn định, quality, popularity, status)
  await sql.unsafe(`CREATE TABLE poi_work_cluster (cluster_no int NOT NULL, rid int NOT NULL PRIMARY KEY, role text NOT NULL)`);
  await sql.unsafe(`CREATE TABLE poi_work_cluster_meta (cluster_no int PRIMARY KEY, primary_rid int NOT NULL, stable_id text NOT NULL, poi_id text,
    quality_score smallint NOT NULL, popularity real NOT NULL, status text NOT NULL, source_count smallint NOT NULL)`);
  function* clusterRows() {
    for (const [cid, m] of finalMembers) {
      const reps = m.filter((rid) => !repOf[rid]);
      const primary = pickPrimary(reps.map((rid) => ({ rid, source: sourceOf(rid), completeness: completeness[rid] ?? 0 }))).rid;
      for (const rid of m) yield [cid, rid, rid === primary ? 'primary' : 'secondary'];
    }
  }
  function* metaRows() {
    for (const [cid, m] of finalMembers) {
      const reps = m.filter((rid) => !repOf[rid]);
      const primary = pickPrimary(reps.map((rid) => ({ rid, source: sourceOf(rid), completeness: completeness[rid] ?? 0 }))).rid;
      const srcs = new Set(m.map(sourceOf));
      const f = flags[primary] ?? 0;
      const c = conf[primary] ?? 0;
      // spec 5.4.10: Overture confidence < 0,4 và không khớp nguồn khác → không tạo poi
      if (srcs.size === 1 && sourceOf(primary) === 'overture' && c < 0.4) continue;
      const closed = m.some((rid) => ((flags[rid] ?? 0) >> 4) & 1);
      yield [cid, primary, stableId(sourceOf(primary), sourceIds[primary] ?? ''), null,
        qualityScore({ hasPhone: !!(f & 1), hasWebsite: !!(f & 2), hasHours: !!(f & 4), hasHousenumber: !!(f & 8), sourceCount: srcs.size, confidence: c, monthsOld: months[primary] ?? 0 }),
        popularity({ sourceCount: srcs.size, hasFsq: srcs.has('fsq') }), closed ? 'closed' : 'active', srcs.size];
    }
  }
  await copyInto(sql, 'poi_work_cluster', ['cluster_no', 'rid', 'role'], clusterRows());
  await copyInto(sql, 'poi_work_cluster_meta', ['cluster_no', 'primary_rid', 'stable_id', 'poi_id', 'quality_score', 'popularity', 'status', 'source_count'], metaRows());
  await sql.unsafe(`CREATE INDEX poi_work_cluster_cluster_idx ON poi_work_cluster (cluster_no)`);

  // 7) ID ổn định: dùng lại poi.id đang có nếu bất kỳ bản ghi của cụm đã liên kết (ưu tiên bản chính); xung đột → giữ cụm có bản chính khớp
  await sql.unsafe(`UPDATE poi_work_cluster_meta m SET poi_id = x.poi_id FROM (
      SELECT DISTINCT ON (c.cluster_no) c.cluster_no, l.poi_id, (c.role = 'primary') AS by_primary
      FROM poi_work_cluster c JOIN poi_work_record r ON r.rid = c.rid JOIN poi_source_link l ON (l.source, l.source_id) = (r.source, r.source_id)
      ORDER BY c.cluster_no, (c.role = 'primary') DESC) x WHERE x.cluster_no = m.cluster_no`);
  await sql.unsafe(`UPDATE poi_work_cluster_meta m SET poi_id = NULL WHERE poi_id IN (SELECT poi_id FROM poi_work_cluster_meta WHERE poi_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1)
      AND NOT EXISTS (SELECT 1 FROM poi_work_cluster c JOIN poi_work_record r ON r.rid = c.rid JOIN poi_source_link l ON (l.source, l.source_id) = (r.source, r.source_id)
                      WHERE c.cluster_no = m.cluster_no AND c.role = 'primary' AND l.poi_id = m.poi_id)`);
  await sql.unsafe(`UPDATE poi_work_cluster_meta SET poi_id = stable_id WHERE poi_id IS NULL`);
  await sql.unsafe(`ANALYZE poi_work_cluster; ANALYZE poi_work_cluster_meta`);

  const [s] = await sql`SELECT count(*)::int AS clusters, count(*) FILTER (WHERE source_count >= 2)::int AS multi,
      count(*) FILTER (WHERE poi_id <> stable_id)::int AS reused FROM poi_work_cluster_meta`;
  const [d] = await sql`SELECT count(*)::int AS dups FROM poi_work_cluster WHERE role = 'secondary'`;
  console.log(`✓ gộp: ${s.clusters} cụm (${s.multi} đa nguồn = ${((100 * s.multi) / Math.max(1, s.clusters)).toFixed(1)} %), ${d.dups} bản ghi phụ, ${s.reused} ID dùng lại`);
} finally {
  await sql.end();
}
```

Run: `PIPE pipeline node pipelines/poi/src/conflate.mjs`
Expected (fixture): `Tạo poi_work_pair … N cặp` rồi `✓ gộp: … cụm (… đa nguồn …)` với tỉ lệ đa nguồn 5–30 %.

- [ ] **Step 5: `publish.mjs` — dựng `poi_new`, kiểm sanity, gộp vào `poi` + `poi_source_link`**

```js
#!/usr/bin/env node
// Bước 3 gộp: poi_work_* → poi_new → gộp vào poi (UPDATE pipeline-POI, INSERT mới, xoá/đóng POI biến mất; không đụng created_by='user').
// Sanity: số poi active mới không giảm > 10 % so hiện tại, trừ --force (spec 5.9). Thoát mã 3 nếu vi phạm.
import { connect, countRows, createNewTable } from './pg.mjs';

const force = process.argv.includes('--force');
const sql = connect();
try {
  await createNewTable(sql, 'poi');
  await sql.unsafe(`INSERT INTO poi_new (id, name, name_norm, name_alt, category, geom, housenumber, street, ward, province, address_text, contact, hours,
      primary_source, primary_source_id, quality_score, popularity, status, locked_fields, created_by, created_at, updated_at)
    SELECT m.poi_id, r.name, r.name_norm, r.name_alt, r.category,
           COALESCE(osm.geom, r.geom),                      -- spec 5.4.6: cụm có OSM → toạ độ OSM
           r.housenumber, r.street, r.ward, r.province, r.address_text, r.contact, r.hours,
           r.source, r.source_id, m.quality_score, m.popularity, m.status, '{}', 'pipeline', now(), now()
    FROM poi_work_cluster_meta m
    JOIN poi_work_record r ON r.rid = m.primary_rid
    LEFT JOIN LATERAL (SELECT r2.geom FROM poi_work_cluster c2 JOIN poi_work_record r2 ON r2.rid = c2.rid
                       WHERE c2.cluster_no = m.cluster_no AND r2.source = 'osm' ORDER BY c2.role LIMIT 1) osm ON true`);

  const before = Number((await sql`SELECT count(*)::int AS n FROM poi WHERE status = 'active' AND created_by = 'pipeline'`)[0].n);
  const after = Number((await sql`SELECT count(*)::int AS n FROM poi_new WHERE status = 'active'`)[0].n);
  if (before > 0 && after < before * 0.9 && !force) {
    console.error(`SANITY: poi active giảm ${before} → ${after} (> 10 %). Dừng, không đổi gì. Dùng --force nếu cố ý.`);
    process.exit(3);
  }

  await sql.begin(async (tx) => {
    // POI pipeline không còn trong nguồn: xoá nếu chưa có đóng góp, ngược lại đóng
    await tx.unsafe(`DELETE FROM poi p WHERE p.created_by = 'pipeline' AND NOT EXISTS (SELECT 1 FROM poi_new n WHERE n.id = p.id)
                      AND NOT EXISTS (SELECT 1 FROM poi_edit e WHERE e.poi_id = p.id)`);
    await tx.unsafe(`UPDATE poi p SET status = 'closed', updated_at = now() WHERE p.created_by = 'pipeline' AND p.status <> 'closed'
                      AND NOT EXISTS (SELECT 1 FROM poi_new n WHERE n.id = p.id)`);
    // Cập nhật POI pipeline hiện có (M4 sẽ loại trừ locked_fields); chỉ chạm updated_at khi có thay đổi thật
    await tx.unsafe(`UPDATE poi p SET name = n.name, name_norm = n.name_norm, name_alt = n.name_alt, category = n.category, geom = n.geom,
        housenumber = n.housenumber, street = n.street, ward = n.ward, province = n.province, address_text = n.address_text,
        contact = n.contact, hours = n.hours, primary_source = n.primary_source, primary_source_id = n.primary_source_id,
        quality_score = n.quality_score, popularity = n.popularity, status = n.status, updated_at = now()
      FROM poi_new n WHERE n.id = p.id AND p.created_by = 'pipeline'
        AND (p.name, p.category, p.address_text, p.contact::text, p.hours::text, p.primary_source, p.primary_source_id, p.quality_score, p.status, ST_AsText(p.geom))
            IS DISTINCT FROM (n.name, n.category, n.address_text, n.contact::text, n.hours::text, n.primary_source, n.primary_source_id, n.quality_score, n.status, ST_AsText(n.geom))`);
    await tx.unsafe(`INSERT INTO poi SELECT n.* FROM poi_new n WHERE NOT EXISTS (SELECT 1 FROM poi p WHERE p.id = n.id)`);
    // Liên kết nguồn: dựng lại cho POI pipeline
    await tx.unsafe(`DELETE FROM poi_source_link l USING poi p WHERE l.poi_id = p.id AND p.created_by = 'pipeline'`);
    await tx.unsafe(`INSERT INTO poi_source_link (poi_id, source, source_id, confidence, role)
      SELECT m.poi_id, r.source, r.source_id, r.confidence, c.role
      FROM poi_work_cluster c JOIN poi_work_record r ON r.rid = c.rid JOIN poi_work_cluster_meta m ON m.cluster_no = c.cluster_no
      ON CONFLICT (source, source_id) DO UPDATE SET poi_id = EXCLUDED.poi_id, role = EXCLUDED.role, confidence = EXCLUDED.confidence`);
    await tx.unsafe(`DROP TABLE poi_new`);
  });
  await sql.unsafe(`ANALYZE poi; ANALYZE poi_source_link`);
  const [s] = await sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'active')::int AS active,
      count(*) FILTER (WHERE category = 'other' OR category LIKE '%\\_other')::int AS other FROM poi`;
  console.log(`✓ poi: ${s.total} (active ${s.active}, trước đó ${before}); other ${((100 * s.other) / Math.max(1, s.total)).toFixed(1)} %; links ${await countRows(sql, 'poi_source_link')}`);
} finally {
  await sql.end();
}
```

Run: `PIPE pipeline sh -c "node pipelines/poi/src/taxonomy.mjs load && node pipelines/poi/src/publish.mjs"`
Expected (fixture): `✓ poi: N (active …)`, N ≈ 3.000–15.000; `other` < 10 %.

Run lại toàn bộ: `PIPE pipeline sh -c "node pipelines/poi/src/records.mjs && node pipelines/poi/src/conflate.mjs && node pipelines/poi/src/publish.mjs"`
Expected: `… ID dùng lại` = số cụm (ID ổn định), `poi` cùng số dòng.

- [ ] **Step 6: `report.mjs` — báo cáo gộp (nghiệm thu M2 "báo cáo số liệu gộp")**

```js
#!/usr/bin/env node
// Báo cáo số liệu kho POI → out/poi-report-<YYYYMMDD>.json + bảng console. Dùng: node report.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OUT, vnDate } from './lib/env.mjs';
import { connect } from './pg.mjs';

const sql = connect();
try {
  const [poi] = await sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'active')::int AS active, count(*) FILTER (WHERE status = 'closed')::int AS closed,
      round(avg(quality_score))::int AS avg_quality, count(*) FILTER (WHERE quality_score >= 60)::int AS q60,
      count(*) FILTER (WHERE category = 'other' OR category LIKE '%\\_other')::int AS other FROM poi`;
  const bySource = await sql`SELECT primary_source AS source, count(*)::int AS n FROM poi GROUP BY 1 ORDER BY 2 DESC`;
  const byGroup = await sql`SELECT c.group_code, count(*)::int AS n FROM poi p JOIN category c ON c.code = p.category GROUP BY 1 ORDER BY 2 DESC`;
  const [links] = await sql`SELECT count(*)::int AS links, count(DISTINCT poi_id)::int AS pois,
      count(*) FILTER (WHERE role = 'secondary')::int AS secondary FROM poi_source_link`;
  const [multi] = await sql`SELECT count(*)::int AS n FROM (SELECT poi_id FROM poi_source_link GROUP BY 1 HAVING count(DISTINCT source) >= 2) x`;
  const [geo] = await sql`SELECT (SELECT count(*)::int FROM address_anchor) AS anchors, (SELECT count(*)::int FROM street) AS streets,
      (SELECT count(*)::int FROM alley) AS alleys, (SELECT count(*)::int FROM admin_area) AS admin_areas`;
  const report = { date: vnDate(), poi, bySource, byGroup, links: { ...links, multiSourcePois: multi.n, multiSourcePct: Number(((100 * multi.n) / Math.max(1, poi.total)).toFixed(1)) }, geocode: geo };
  mkdirSync(OUT, { recursive: true });
  const file = resolve(OUT, `poi-report-${vnDate().replace(/-/g, '')}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.table({ total: poi.total, active: poi.active, closed: poi.closed, avg_quality: poi.avg_quality, other_pct: ((100 * poi.other) / Math.max(1, poi.total)).toFixed(1), multi_source_pct: report.links.multiSourcePct, anchors: geo.anchors, streets: geo.streets, alleys: geo.alleys });
  console.log(`✓ ${file}`);
} finally {
  await sql.end();
}
```
(Bảng `address_anchor`/`street`/`alley`/`admin_area` rỗng cho tới Task 8 — đếm 0 là bình thường.)

- [ ] **Step 7: Test tích hợp gộp trên fixture (dbtest) — fixture khó của spec 10**

`pipelines/poi/tests/conflate.dbtest.mjs`:
```js
// Chạy trong image: PIPE pipeline pnpm test:db — cần ingest fixture (ingest.dbtest chạy trước theo thứ tự tên file? KHÔNG — tự chạy lại ở đây)
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseUrlFromEnv } from '../../../scripts/lib/migrations.mjs';

const sql = postgres(databaseUrlFromEnv(process.env), { max: 1, onnotice: () => {} });
const node = (/** @type {string[]} */ ...args) => execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const runAll = () => {
  node('pipelines/poi/src/records.mjs');
  node('pipelines/poi/src/conflate.mjs');
  node('pipelines/poi/src/publish.mjs', '--force');
};

beforeAll(async () => {
  node('scripts/db-migrate.mjs');
  for (const s of ['osm', 'overture', 'fsq']) node(`pipelines/poi/src/ingest/${s}.mjs`, '--fixture');
  node('pipelines/poi/src/taxonomy.mjs', 'load');
  // Tiêm fixture khó (spec 10) vào src_overture_place / src_osm_place — toạ độ trong Quận 1
  await sql`DELETE FROM src_overture_place WHERE id LIKE 'test-%'`;
  await sql`DELETE FROM src_osm_place WHERE osm_type = 'n' AND osm_id >= 900000000000`;
  await sql`INSERT INTO src_osm_place (osm_type, osm_id, name, names, tags, geom, release) VALUES
    ('n', 900000000001, 'Cà phê Cộng', '{"name":"Cà phê Cộng"}', '{"amenity":"cafe","name":"Cà phê Cộng"}', ST_SetSRID(ST_MakePoint(106.7000, 10.7760), 4326), current_date),
    ('n', 900000000002, 'Highlands Coffee Nguyễn Huệ', '{"name":"Highlands Coffee Nguyễn Huệ"}', '{"amenity":"cafe","name":"Highlands Coffee Nguyễn Huệ","addr:housenumber":"18","addr:street":"Nguyễn Huệ"}', ST_SetSRID(ST_MakePoint(106.7040, 10.7740), 4326), current_date)`;
  await sql`INSERT INTO src_overture_place (id, name, names, category, categories, confidence, addresses, websites, phones, sources, geom, release) VALUES
    ('test-cong', 'Cong Caphe', '{"primary":"Cong Caphe"}', 'coffee_shop', '{"primary":"coffee_shop"}', 0.8, '[{"freeform":"Quận 1"}]', '{}', '{}', '[]', ST_SetSRID(ST_MakePoint(106.7002, 10.7761), 4326), 'fixture-q1'),
    ('test-hl-1', 'Highlands Nguyen Hue', '{"primary":"Highlands Nguyen Hue"}', 'coffee_shop', '{"primary":"coffee_shop"}', 0.8, '[{"freeform":"18 Nguyễn Huệ, Quận 1"}]', '{}', '{}', '[]', ST_SetSRID(ST_MakePoint(106.7041, 10.7741), 4326), 'fixture-q1'),
    ('test-hl-2', 'Highlands Coffee', '{"primary":"Highlands Coffee"}', 'coffee_shop', '{"primary":"coffee_shop"}', 0.8, '[{"freeform":"76 Nguyễn Huệ, Quận 1"}]', '{}', '{}', '[]', ST_SetSRID(ST_MakePoint(106.7044, 10.7745), 4326), 'fixture-q1'),
    ('test-lowconf', 'Quán Không Tên Rõ', '{"primary":"Quán Không Tên Rõ"}', 'restaurant', '{"primary":"restaurant"}', 0.2, '[]', '{}', '{}', '[]', ST_SetSRID(ST_MakePoint(106.6900, 10.7900), 4326), 'fixture-q1')`;
  runAll();
});
afterAll(() => sql.end());

const poiOf = async (/** @type {string} */ source, /** @type {string} */ id) =>
  (await sql`SELECT p.* FROM poi_source_link l JOIN poi p ON p.id = l.poi_id WHERE l.source = ${source} AND l.source_id = ${id}`)[0];

describe('gộp trên fixture Quận 1', () => {
  it('"Cà phê Cộng" ~ "Cong Caphe" gộp một poi, toạ độ lấy OSM, nguồn chính có 2 liên kết', async () => {
    const a = await poiOf('osm', 'n900000000001');
    const b = await poiOf('overture', 'test-cong');
    expect(a.id).toBe(b.id);
    const [{ x }] = await sql`SELECT ST_X(geom) AS x FROM poi WHERE id = ${a.id}`;
    expect(Number(x)).toBeCloseTo(106.7, 4);
  });
  it('"Highlands Coffee Nguyễn Huệ" ~ "Highlands Nguyen Hue" (cùng số 18) gộp; "Highlands Coffee" số 76 cách 60 m KHÔNG gộp', async () => {
    const osm = await poiOf('osm', 'n900000000002');
    expect((await poiOf('overture', 'test-hl-1')).id).toBe(osm.id);
    expect((await poiOf('overture', 'test-hl-2')).id).not.toBe(osm.id);
  });
  it('Overture confidence < 0,4 đơn lẻ → không tạo poi (spec 5.4.10)', async () => {
    expect(await poiOf('overture', 'test-lowconf')).toBeUndefined();
  });
  it('mỗi bản ghi nguồn liên kết đúng một poi; poi nào cũng có category và geom; other < 10 %', async () => {
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM poi p WHERE NOT EXISTS (SELECT 1 FROM poi_source_link l WHERE l.poi_id = p.id)`;
    expect(n).toBe(0);
    const [s] = await sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE category = 'other' OR category LIKE '%\\_other')::int AS other,
        count(*) FILTER (WHERE category IS NULL OR geom IS NULL)::int AS bad FROM poi`;
    expect(s.total).toBeGreaterThan(2000);
    expect(s.bad).toBe(0);
    expect(s.other / s.total).toBeLessThan(0.1);
  });
  it('ID ổn định khi chạy lại; khi nguồn chính biến mất, ID giữ và primary_source đổi', async () => {
    const before = await poiOf('osm', 'n900000000001');
    runAll();
    const again = await poiOf('osm', 'n900000000001');
    expect(again.id).toBe(before.id);
    expect(again.primary_source).toBe('osm');
    await sql`DELETE FROM src_osm_place WHERE osm_type = 'n' AND osm_id = 900000000001`;
    runAll();
    const moved = await poiOf('overture', 'test-cong');
    expect(moved.id).toBe(before.id);
    expect(moved.primary_source).toBe('overture');
  });
});
```

Run: `PIPE pipeline pnpm test:db`
Expected: schema + ingest + conflate dbtest xanh (5–10 phút). Nếu "Cộng" không gộp: in `SELECT * FROM poi_work_pair WHERE a IN (…)` để xem `sim`/`dist_m`; `nameCore('Cong Caphe')` phải là `cong` (alias Task 3).

- [ ] **Step 8: Chạy thật toàn VN, đo, README, DEVLOG, commit**

Run (DB đã ingest toàn VN ở Task 5 Step 10): `PIPE pipeline sh -c "time node pipelines/poi/src/records.mjs && time node pipelines/poi/src/conflate.mjs && node pipelines/poi/src/publish.mjs --force && node pipelines/poi/src/report.mjs"`
Expected: records 5–15 phút; `poi_work_pair` vài chục triệu cặp, conflate 20–60 phút; `poi` **≥ 1,5 triệu active** (nghiệm thu M2); đa nguồn 10–25 %; other < 10 %. Ghi các con số vào DEVLOG. Nếu `poi_work_pair` quá lớn (> 100 triệu) hoặc quá chậm: hạ lọc thô còn 0,0009° (100 m) cho các nhóm không thuộc BIG_AREA — thêm điều kiện vào JOIN và ghi DEVLOG.

Thêm vào `pipelines/poi/README.md` bảng bước: `records.mjs` → `poi_work_record`; `conflate.mjs` → `poi_work_pair/cluster/cluster_meta`; `publish.mjs [--force]` → `poi`, `poi_source_link` (gộp, sanity 10 %); `report.mjs` → `out/poi-report-*.json`.

Run: `pnpm lint && pnpm typecheck && pnpm test`

Sửa `docs/DEVLOG.md`: "Task đang làm: Task 8"; mục 3: "Gộp: luật không gộp khi số nhà khác nhau (chuỗi cửa hàng); confidence OSM=1, FSQ=0,8; `name_alt` chỉ lấy từ nguồn chính (ODbL); POI OSM không tên chỉ giữ cho nhóm công cộng"; mục 4 dòng `M2 T7` kèm số cụm/đa nguồn/thời gian.

```bash
git add -A
git commit -m "feat(pipeline-poi): gộp 3 nguồn — records, cặp ứng viên PostGIS, ghép tham lam, ID ULID ổn định, quality/popularity, publish gộp vào poi"
git push
```

---

### Task 8: Kho mốc địa chỉ, đường, hẻm, hành chính (`address_anchor`, `street`, `alley`, `admin_area`, `admin_alias`)

**Files:**
- Create: `pipelines/poi/src/geocode/{osm-roads,admin,streets,alleys,anchors,alley-name}.mjs`, `db/seed/admin_alias_2025.csv`, `pipelines/poi/tests/alley-name.test.mjs`, `pipelines/poi/tests/geocode.dbtest.mjs`
- Modify: `pipelines/poi/README.md` (mục admin_level)

Thứ tự chạy: `osm-roads.mjs` (osmium → 2 bảng thô `osm_road_raw`, `osm_admin_raw`) → `admin.mjs` → `streets.mjs` → `alleys.mjs` → `anchors.mjs` (cần `poi_work_record` của Task 7). Tất cả dựng `_new` rồi `publishNew`.

- [ ] **Step 1: Test hàm thuần tên hẻm / tên đường (thất bại)**

`pipelines/poi/tests/alley-name.test.mjs`:
```js
import { describe, expect, it } from 'vitest';
import { parseAlleyName, streetNameNorm } from '../src/geocode/alley-name.mjs';

describe('parseAlleyName (spec 5.7: ^(Hẻm|Ngõ|Ngách|Kiệt) (\\d+[A-Z]?)( .+)?$)', () => {
  it('nhận 4 từ khoá, số có chữ, tên đường mẹ tuỳ chọn', () => {
    expect(parseAlleyName('Hẻm 112 Nguyễn Lâm')).toEqual({ keyword: 'hem', number: '112', parentName: 'Nguyễn Lâm', parentNorm: 'nguyen lam' });
    expect(parseAlleyName('Ngõ 25')).toEqual({ keyword: 'ngo', number: '25', parentName: null, parentNorm: null });
    expect(parseAlleyName('Kiệt 42A Trần Cao Vân')).toEqual({ keyword: 'kiet', number: '42A', parentName: 'Trần Cao Vân', parentNorm: 'tran cao van' });
    expect(parseAlleyName('ngách 15 ngõ 78')).toEqual({ keyword: 'ngach', number: '15', parentName: 'ngõ 78', parentNorm: 'ngo 78' });
  });
  it('không phải hẻm → null', () => {
    expect(parseAlleyName('Đường Nguyễn Lâm')).toBeNull();
    expect(parseAlleyName('Hẻm Cây Bàng')).toBeNull();
    expect(parseAlleyName(null)).toBeNull();
  });
});

describe('streetNameNorm', () => {
  it('bỏ "đường/phố" đứng đầu trừ khi theo sau là số/mã; giữ đại lộ/quốc lộ', () => {
    expect(streetNameNorm('Đường Nguyễn Lâm')).toBe('nguyen lam');
    expect(streetNameNorm('Phố Vũ Ngọc Phan')).toBe('vu ngoc phan');
    expect(streetNameNorm('Đường số 7')).toBe('duong so 7');
    expect(streetNameNorm('Đường D2')).toBe('duong d2');
    expect(streetNameNorm('Đại lộ Thăng Long')).toBe('dai lo thang long');
    expect(streetNameNorm('Quốc lộ 1A')).toBe('quoc lo 1a');
  });
});
```

Run: `pnpm test`
Expected: FAIL — không tìm thấy `../src/geocode/alley-name.mjs`.

- [ ] **Step 2: `alley-name.mjs`**

```js
import { normalizeVi } from '@mapslibvn/core';

const ALLEY_RE = /^(hẻm|hem|ngõ|ngo|ngách|ngach|kiệt|kiet)\s+(\d+[a-z]?)(?:\s+(.+))?$/i;
const KEYWORD = /** @type {Record<string, 'hem' | 'ngo' | 'ngach' | 'kiet'>} */ ({ hẻm: 'hem', hem: 'hem', ngõ: 'ngo', ngo: 'ngo', ngách: 'ngach', ngach: 'ngach', kiệt: 'kiet', kiet: 'kiet' });

/** Tách tên way hẻm OSM. @param {string | null | undefined} name */
export function parseAlleyName(name) {
  const m = ALLEY_RE.exec((name ?? '').trim());
  if (!m) return null;
  const parentName = m[3]?.trim() || null;
  return { keyword: KEYWORD[m[1]?.toLowerCase() ?? ''] ?? 'hem', number: (m[2] ?? '').toUpperCase(), parentName, parentNorm: parentName ? streetNameNorm(parentName) : null };
}

/** Tên đường chuẩn hoá để khớp giữa OSM, parser địa chỉ và mốc: bỏ "đường/phố" đầu trừ khi theo sau là "số …" hoặc mã ngắn (D2, N1). @param {string} name */
export function streetNameNorm(name) {
  const n = normalizeVi(name);
  return n.replace(/^(?:duong|pho)\s+(?!so\b|[a-z]{1,2}\d)/, '');
}
```

Run: `pnpm test`
Expected: xanh.

- [ ] **Step 3: `osm-roads.mjs` — trích đường + ranh giới từ PBF đã patch → bảng thô**

```js
#!/usr/bin/env node
// osmium tags-filter (w/highway có name, r/boundary=administrative) → export GeoJSONSeq → osm_road_raw, osm_admin_raw. Dùng: node osm-roads.mjs [--fixture]
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeVi } from '@mapslibvn/core';
import { run } from '../../../../scripts/lib/run.mjs';
import { OSM_PBF, POI_WORK } from '../lib/env.mjs';
import { parseOsmiumId } from '../lib/osmium-id.mjs';
import { connect, copyInto, countRows, readJsonl } from '../pg.mjs';
import { parseAlleyName, streetNameNorm } from './alley-name.mjs';

const ROAD_TYPES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'pedestrian', 'road',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'track', 'path', 'footway']);
mkdirSync(POI_WORK, { recursive: true });
const roadsPbf = resolve(POI_WORK, 'roads.osm.pbf');
const adminPbf = resolve(POI_WORK, 'admin.osm.pbf');
const roadsSeq = resolve(POI_WORK, 'roads.geojsonseq');
const adminSeq = resolve(POI_WORK, 'admin.geojsonseq');

run('osmium', ['tags-filter', '--overwrite', '-o', roadsPbf, OSM_PBF, 'w/highway']);
run('osmium', ['export', '--overwrite', '-f', 'geojsonseq', '-x', 'print_record_separator=false', '--add-unique-id=type_id', '--geometry-types=linestring', '-o', roadsSeq, roadsPbf]);
run('osmium', ['tags-filter', '--overwrite', '-o', adminPbf, OSM_PBF, 'r/boundary=administrative']);
run('osmium', ['export', '--overwrite', '-f', 'geojsonseq', '-x', 'print_record_separator=false', '--add-unique-id=type_id', '--geometry-types=polygon', '-o', adminSeq, adminPbf]);

/** GeoJSON geometry → EWKT (LineString / Polygon / MultiPolygon). @param {{ type: string, coordinates: unknown }} g */
function ewktOf(g) {
  const pt = (/** @type {number[]} */ c) => `${c[0]} ${c[1]}`;
  const ring = (/** @type {number[][]} */ r) => `(${r.map(pt).join(',')})`;
  if (g.type === 'LineString') return `SRID=4326;LINESTRING(${(/** @type {number[][]} */ (g.coordinates)).map(pt).join(',')})`;
  if (g.type === 'Polygon') return `SRID=4326;MULTIPOLYGON((${(/** @type {number[][][]} */ (g.coordinates)).map(ring).join(',')}))`;
  if (g.type === 'MultiPolygon') return `SRID=4326;MULTIPOLYGON(${(/** @type {number[][][][]} */ (g.coordinates)).map((p) => `(${p.map(ring).join(',')})`).join(',')})`;
  return null;
}

async function* roadRows() {
  for await (const f of readJsonl(roadsSeq)) {
    const p = f.properties ?? {};
    const id = parseOsmiumId(p.id);
    if (!id || id.type !== 'w' || !p.name || !ROAD_TYPES.has(p.highway) || f.geometry?.type !== 'LineString') continue;
    const alley = parseAlleyName(p.name);
    yield [id.id, p.name, streetNameNorm(p.name), p.highway, alley?.keyword ?? null, alley?.number ?? null, alley?.parentNorm ?? null, ewktOf(f.geometry)];
  }
}
async function* adminRows() {
  for await (const f of readJsonl(adminSeq)) {
    const p = f.properties ?? {};
    const id = parseOsmiumId(p.id);
    const level = Number(p.admin_level);
    const name = p['name:vi'] ?? p.name;
    if (!id || id.type !== 'r' || !Number.isInteger(level) || !name || !f.geometry) continue;
    const wkt = ewktOf(f.geometry);
    if (!wkt) continue;
    yield [id.id, level, name, normalizeVi(name).replace(/^(?:tinh|thanh pho|quan|huyen|thi xa|phuong|xa|thi tran)\s+/, ''), wkt];
  }
}

const sql = connect();
try {
  await sql.unsafe(`DROP TABLE IF EXISTS osm_road_raw, osm_admin_raw`);
  await sql.unsafe(`CREATE TABLE osm_road_raw (osm_way_id bigint PRIMARY KEY, name text NOT NULL, name_norm text NOT NULL, highway text NOT NULL,
    alley_keyword text, alley_number text, parent_norm text, geom geometry(LineString, 4326) NOT NULL, province_norm text)`);
  await sql.unsafe(`CREATE TABLE osm_admin_raw (osm_relation_id bigint PRIMARY KEY, level smallint NOT NULL, name text NOT NULL, name_norm text NOT NULL, geom geometry(MultiPolygon, 4326) NOT NULL)`);
  const r = await copyInto(sql, 'osm_road_raw', ['osm_way_id', 'name', 'name_norm', 'highway', 'alley_keyword', 'alley_number', 'parent_norm', 'geom'], roadRows());
  const a = await copyInto(sql, 'osm_admin_raw', ['osm_relation_id', 'level', 'name', 'name_norm', 'geom'], adminRows());
  await sql.unsafe(`CREATE INDEX osm_road_raw_geom_idx ON osm_road_raw USING gist (geom); CREATE INDEX osm_admin_raw_geom_idx ON osm_admin_raw USING gist (geom);
    UPDATE osm_admin_raw SET geom = ST_Multi(ST_CollectionExtract(ST_MakeValid(geom), 3)) WHERE NOT ST_IsValid(geom); ANALYZE osm_road_raw; ANALYZE osm_admin_raw`);
  const levels = await sql`SELECT level, count(*)::int AS n FROM osm_admin_raw GROUP BY 1 ORDER BY 1`;
  console.log(`✓ osm_road_raw ${r} đường có tên (${await countRows(sql, 'osm_road_raw')}), osm_admin_raw ${a} ranh giới — admin_level: ${levels.map((l) => `${l.level}=${l.n}`).join(', ')}`);
} finally {
  await sql.end();
}
```

Run: `PIPE pipeline node pipelines/poi/src/geocode/osm-roads.mjs --fixture`
Expected: `✓ osm_road_raw N đường có tên (…), osm_admin_raw M ranh giới — admin_level: 4=…, 8=…` (fixture: N ≈ 300–1.500, M ≥ 1).

- [ ] **Step 4: `admin.mjs` — `admin_area` + `admin_alias` (seed 63 → 34 tỉnh)**

`db/seed/admin_alias_2025.csv` (`alias,level,current_name,province`; `alias` viết thường không dấu như `normalizeVi`; `province` để trống cho cấp 4; nguồn: NQ 202/2025/QH15; **phường/xã** bổ sung dần từ các nghị quyết của UBTVQH — việc tay, ghi DEVLOG "Việc tay còn lại"):
```
# alias,level,current_name,province
ha giang,4,Tuyên Quang,
yen bai,4,Lào Cai,
bac kan,4,Thái Nguyên,
bac can,4,Thái Nguyên,
vinh phuc,4,Phú Thọ,
hoa binh,4,Phú Thọ,
bac giang,4,Bắc Ninh,
thai binh,4,Hưng Yên,
hai duong,4,Hải Phòng,
ha nam,4,Ninh Bình,
nam dinh,4,Ninh Bình,
quang binh,4,Quảng Trị,
quang nam,4,Đà Nẵng,
kon tum,4,Quảng Ngãi,
binh dinh,4,Gia Lai,
ninh thuan,4,Khánh Hòa,
dak nong,4,Lâm Đồng,
binh thuan,4,Lâm Đồng,
phu yen,4,Đắk Lắk,
binh duong,4,Thành phố Hồ Chí Minh,
ba ria - vung tau,4,Thành phố Hồ Chí Minh,
ba ria-vung tau,4,Thành phố Hồ Chí Minh,
ba ria vung tau,4,Thành phố Hồ Chí Minh,
binh phuoc,4,Đồng Nai,
long an,4,Tây Ninh,
soc trang,4,Cần Thơ,
hau giang,4,Cần Thơ,
ben tre,4,Vĩnh Long,
tra vinh,4,Vĩnh Long,
tien giang,4,Đồng Tháp,
bac lieu,4,Cà Mau,
kien giang,4,An Giang,
thua thien hue,4,Huế,
thua thien-hue,4,Huế,
# Phường/xã cũ → mới (ví dụ spec 5.7; bổ sung theo NQ UBTVQH 2025):
phuong 6 quan 10,8,Phường Diên Hồng,Thành phố Hồ Chí Minh
```

`pipelines/poi/src/geocode/admin.mjs`:
```js
#!/usr/bin/env node
// osm_admin_raw → admin_area_new (parent theo chứa tâm) + admin_alias_new từ db/seed/admin_alias_2025.csv → publishNew.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeVi } from '@mapslibvn/core';
import { connect, countRows, createNewTable, publishNew } from '../pg.mjs';

const sql = connect();
try {
  await createNewTable(sql, 'admin_area');
  await createNewTable(sql, 'admin_alias');
  await sql.unsafe(`INSERT INTO admin_area_new (id, level, name, name_norm, osm_relation_id, geom)
    SELECT row_number() OVER (ORDER BY level, osm_relation_id), level, name, name_norm, osm_relation_id, geom FROM osm_admin_raw WHERE level IN (4, 6, 8)`);
  // parent: cấp 8 → cấp 6 nếu có, không thì cấp 4; cấp 6 → cấp 4 (theo điểm trong bề mặt)
  await sql.unsafe(`UPDATE admin_area_new c SET parent_id = p.id FROM LATERAL (
      SELECT p.id FROM admin_area_new p WHERE p.level < c.level AND ST_Contains(p.geom, ST_PointOnSurface(c.geom)) ORDER BY p.level DESC LIMIT 1) p WHERE c.level > 4`);
  // alias
  const rows = readFileSync(resolve('db/seed/admin_alias_2025.csv'), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  let ok = 0;
  const missing = [];
  for (const line of rows) {
    const [alias, levelS, current, province] = line.split(',').map((s) => s.trim());
    const level = Number(levelS);
    const nameNorm = normalizeVi(current ?? '').replace(/^(?:tinh|thanh pho|quan|huyen|thi xa|phuong|xa|thi tran)\s+/, '');
    const provNorm = province ? normalizeVi(province).replace(/^(?:tinh|thanh pho)\s+/, '') : null;
    const [area] = await sql`SELECT a.id FROM admin_area_new a LEFT JOIN admin_area_new p ON p.id = a.parent_id OR (a.level = 8 AND p.id = (SELECT parent_id FROM admin_area_new WHERE id = a.parent_id))
      WHERE a.level = ${level} AND a.name_norm = ${nameNorm} AND (${provNorm}::text IS NULL OR p.name_norm = ${provNorm}) ORDER BY a.id LIMIT 1`;
    if (!area) {
      missing.push(line);
      continue;
    }
    await sql`INSERT INTO admin_alias_new (alias_norm, level, admin_area_id, valid_until) VALUES (${normalizeVi(alias ?? '')}, ${level}, ${area.id}, '2025-06-30') ON CONFLICT DO NOTHING`;
    ok++;
  }
  await publishNew(sql, ['admin_area', 'admin_alias']);
  const levels = await sql`SELECT level, count(*)::int AS n FROM admin_area GROUP BY 1 ORDER BY 1`;
  console.log(`✓ admin_area ${await countRows(sql, 'admin_area')} (${levels.map((l) => `L${l.level}=${l.n}`).join(', ')}); admin_alias ${ok} dòng, không khớp ${missing.length}${missing.length ? `: ${missing.slice(0, 5).join(' | ')}` : ''}`);
} finally {
  await sql.end();
}
```
(`publishNew` TRUNCATE `admin_area, admin_alias` cùng câu → FK thoả; id giữ nguyên từ `_new`.)

Run: `PIPE pipeline node pipelines/poi/src/geocode/admin.mjs`
Expected (fixture): `✓ admin_area N (L4=…, L8=…); admin_alias …` — fixture chỉ có vài ranh giới nên "không khớp" nhiều là bình thường; toàn VN: L4 = 34, L8 ≈ 3.300, "không khớp" phải = 0 cho các dòng cấp 4 (nếu tỉnh mới thiếu trong OSM → ghi DEVLOG).

- [ ] **Step 5: `streets.mjs` — gộp way cùng tên liền kề trong tỉnh; phường chạm**

```js
#!/usr/bin/env node
// osm_road_raw (không phải hẻm) → street_new: cụm DBSCAN theo (name_norm, tỉnh), eps ≈ 100 m → MultiLineString; ward_norm = phường chạm.
import { connect, countRows, createNewTable } from '../pg.mjs';

const sql = connect();
try {
  await sql.unsafe(`UPDATE osm_road_raw r SET province_norm = a.name_norm FROM admin_area a
    WHERE a.level = 4 AND ST_Contains(a.geom, ST_LineInterpolatePoint(r.geom, 0.5)) AND r.province_norm IS NULL`);
  await createNewTable(sql, 'street');
  await sql.unsafe(`INSERT INTO street_new (osm_way_ids, name, name_norm, province_norm, geom)
    SELECT array_agg(osm_way_id ORDER BY osm_way_id), (array_agg(name ORDER BY length(name) DESC, name))[1], name_norm, province_norm,
           ST_Multi(ST_LineMerge(ST_Collect(geom)))
    FROM (SELECT *, ST_ClusterDBSCAN(geom, eps := 0.001, minpoints := 1) OVER (PARTITION BY name_norm, province_norm) AS cid
          FROM osm_road_raw WHERE alley_number IS NULL) w
    GROUP BY name_norm, province_norm, cid`);
  await sql.unsafe(`UPDATE street_new s SET ward_norm = COALESCE((SELECT array_agg(DISTINCT a.name_norm) FROM admin_area a WHERE a.level = 8 AND ST_Intersects(a.geom, s.geom)), '{}')`);
  await sql.unsafe(`ANALYZE street_new`);
  console.log(`✓ street_new ${await countRows(sql, 'street_new')} tuyến (chưa phát hành — alleys.mjs phát hành cùng)`);
} finally {
  await sql.end();
}
```

- [ ] **Step 6: `alleys.mjs` — hẻm, đường mẹ (a) theo tên, (b) theo chạm; `entrance`**

```js
#!/usr/bin/env node
// osm_road_raw (alley_number IS NOT NULL) → alley_new; parent_street_id: (a) tên sau số khớp street_new gần nhất ≤ 300 m, (b) đường có tên chạm đầu/cuối ≤ 15 m; entrance = điểm chạm.
import { connect, countRows, createNewTable, publishNew } from '../pg.mjs';

const sql = connect();
try {
  await createNewTable(sql, 'alley');
  await sql.unsafe(`INSERT INTO alley_new (osm_way_id, number, name, geom) SELECT osm_way_id, alley_number, name, geom FROM osm_road_raw WHERE alley_number IS NOT NULL`);
  await sql.unsafe(`UPDATE alley_new a SET parent_street_id = s.id FROM osm_road_raw r, LATERAL (
      SELECT s.id FROM street_new s WHERE s.name_norm = r.parent_norm AND ST_DWithin(s.geom, a.geom, 0.003) ORDER BY ST_Distance(s.geom, a.geom) LIMIT 1) s
    WHERE r.osm_way_id = a.osm_way_id AND r.parent_norm IS NOT NULL`);
  await sql.unsafe(`UPDATE alley_new a SET parent_street_id = s.id FROM LATERAL (
      SELECT s.id FROM street_new s WHERE ST_DWithin(s.geom, ST_StartPoint(a.geom), 0.00015) OR ST_DWithin(s.geom, ST_EndPoint(a.geom), 0.00015)
      ORDER BY LEAST(ST_Distance(s.geom, ST_StartPoint(a.geom)), ST_Distance(s.geom, ST_EndPoint(a.geom))) LIMIT 1) s
    WHERE a.parent_street_id IS NULL`);
  await sql.unsafe(`UPDATE alley_new a SET entrance = ST_ClosestPoint(s.geom,
      CASE WHEN ST_Distance(s.geom, ST_StartPoint(a.geom)) <= ST_Distance(s.geom, ST_EndPoint(a.geom)) THEN ST_StartPoint(a.geom) ELSE ST_EndPoint(a.geom) END)
    FROM street_new s WHERE s.id = a.parent_street_id`);
  await publishNew(sql, ['street', 'alley']);
  const [s] = await sql`SELECT count(*)::int AS n, count(parent_street_id)::int AS with_parent, count(entrance)::int AS with_entrance FROM alley`;
  console.log(`✓ street ${await countRows(sql, 'street')} tuyến; alley ${s.n} (có đường mẹ ${s.with_parent}, có entrance ${s.with_entrance})`);
} finally {
  await sql.end();
}
```

Run: `PIPE pipeline sh -c "node pipelines/poi/src/geocode/streets.mjs && node pipelines/poi/src/geocode/alleys.mjs"`
Expected (fixture): `✓ street … tuyến; alley N (có đường mẹ ≥ 60 % N, …)`.

- [ ] **Step 7: `anchors.mjs` — mốc số nhà từ OSM + Overture/FSQ đã tách; gộp trùng < 30 m (trung vị)**

```js
#!/usr/bin/env node
// address_anchor_new: OSM addr:housenumber+addr:street (0,8) + poi_work_record có housenumber & street (Overture 0,6, FSQ 0,7); gộp trùng < 30 m; phường/tỉnh theo chứa.
import { parseAddress } from '@mapslibvn/core';
import { ewkt, pgArray } from '../lib/copy-format.mjs';
import { vnDate } from '../lib/env.mjs';
import { connect, copyInto, countRows, createNewTable, publishNew } from '../pg.mjs';
import { streetNameNorm } from './alley-name.mjs';

const release = vnDate();
const sql = connect();
try {
  await sql.unsafe(`DROP TABLE IF EXISTS address_anchor_raw; CREATE TABLE address_anchor_raw (housenumber text NOT NULL, alley_chain text[] NOT NULL, house_in_alley text,
    street_norm text NOT NULL, geom geometry(Point, 4326) NOT NULL, source text NOT NULL, source_id text, confidence real NOT NULL)`);
  const cols = ['housenumber', 'alley_chain', 'house_in_alley', 'street_norm', 'geom', 'source', 'source_id', 'confidence'];
  async function* osmRows() {
    for await (const rows of sql`SELECT osm_type, osm_id, tags->>'addr:housenumber' AS hn, tags->>'addr:street' AS st, ST_X(geom) AS lon, ST_Y(geom) AS lat
        FROM src_osm_place WHERE tags ? 'addr:housenumber' AND tags ? 'addr:street'`.cursor(5000)) {
      for (const r of rows) {
        const p = parseAddress(`${r.hn} ${r.st}`);
        if (!p.housenumber) continue;
        yield [p.housenumber, pgArray(p.alleyChain), p.houseInAlley ?? null, streetNameNorm(r.st), ewkt(r.lon, r.lat), 'osm', `${r.osm_type}${r.osm_id}`, 0.8];
      }
    }
  }
  async function* recordRows() {
    for await (const rows of sql`SELECT source, source_id, housenumber, street, ST_X(geom) AS lon, ST_Y(geom) AS lat FROM poi_work_record
        WHERE source <> 'osm' AND housenumber IS NOT NULL AND street IS NOT NULL`.cursor(5000)) {
      for (const r of rows) {
        const p = parseAddress(`${r.housenumber} ${r.street}`);
        if (!p.housenumber || p.confidence < 0.5) continue;
        yield [p.housenumber, pgArray(p.alleyChain), p.houseInAlley ?? null, streetNameNorm(r.street), ewkt(r.lon, r.lat), r.source, r.source_id, r.source === 'fsq' ? 0.7 : 0.6];
      }
    }
  }
  const n1 = await copyInto(sql, 'address_anchor_raw', cols, osmRows());
  const n2 = await copyInto(sql, 'address_anchor_raw', cols, recordRows());
  await sql.unsafe(`CREATE INDEX address_anchor_raw_geom_idx ON address_anchor_raw USING gist (geom); ANALYZE address_anchor_raw`);
  await createNewTable(sql, 'address_anchor');
  // Gộp: cùng (số nhà, đường) và cách nhau < 30 m (≈ 0,00027°) → trung vị hình học; confidence cao nhất; nguồn của bản tốt nhất
  await sql.unsafe(`INSERT INTO address_anchor_new (housenumber, alley_chain, house_in_alley, street_norm, geom, source, source_id, confidence, release)
    SELECT housenumber, (array_agg(alley_chain ORDER BY confidence DESC))[1], (array_agg(house_in_alley ORDER BY confidence DESC))[1], street_norm,
           ST_GeometricMedian(ST_Multi(ST_Collect(geom))), (array_agg(source ORDER BY confidence DESC))[1], (array_agg(source_id ORDER BY confidence DESC))[1], max(confidence), '${release}'
    FROM (SELECT *, ST_ClusterDBSCAN(geom, eps := 0.00027, minpoints := 1) OVER (PARTITION BY housenumber, street_norm) AS cid FROM address_anchor_raw) x
    GROUP BY housenumber, street_norm, cid`);
  await sql.unsafe(`UPDATE address_anchor_new n SET ward_norm = w.name_norm FROM admin_area w WHERE w.level = 8 AND ST_Contains(w.geom, n.geom)`);
  await sql.unsafe(`UPDATE address_anchor_new n SET province_norm = p.name_norm FROM admin_area p WHERE p.level = 4 AND ST_Contains(p.geom, n.geom)`);
  await publishNew(sql, ['address_anchor']);
  await sql.unsafe(`DROP TABLE address_anchor_raw; ANALYZE address_anchor`);
  const [nl] = await sql`SELECT count(*)::int AS n FROM address_anchor WHERE street_norm = 'nguyen lam'`;
  console.log(`✓ address_anchor ${await countRows(sql, 'address_anchor')} mốc (thô OSM ${n1} + POI ${n2}); Nguyễn Lâm: ${nl.n}`);
} finally {
  await sql.end();
}
```

Run: `PIPE pipeline node pipelines/poi/src/geocode/anchors.mjs`
Expected (fixture): `✓ address_anchor N mốc (…); Nguyễn Lâm: 0` (Nguyễn Lâm ở Quận 10, ngoài fixture). Toàn VN (Step 9): Nguyễn Lâm ≥ 15.

- [ ] **Step 8: Test tích hợp geocode trên fixture (dbtest)**

`pipelines/poi/tests/geocode.dbtest.mjs`:
```js
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseUrlFromEnv } from '../../../scripts/lib/migrations.mjs';

const sql = postgres(databaseUrlFromEnv(process.env), { max: 1, onnotice: () => {} });
const node = (/** @type {string[]} */ ...args) => execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

beforeAll(() => {
  node('scripts/db-migrate.mjs');
  for (const s of ['osm', 'overture', 'fsq']) node(`pipelines/poi/src/ingest/${s}.mjs`, '--fixture');
  node('pipelines/poi/src/taxonomy.mjs', 'load');
  node('pipelines/poi/src/records.mjs');
  node('pipelines/poi/src/geocode/osm-roads.mjs', '--fixture');
  node('pipelines/poi/src/geocode/admin.mjs');
  node('pipelines/poi/src/geocode/streets.mjs');
  node('pipelines/poi/src/geocode/alleys.mjs');
  node('pipelines/poi/src/geocode/anchors.mjs');
});
afterAll(() => sql.end());

describe('geocode tables trên fixture Quận 1', () => {
  it('admin_area có cấp 8 chứa Chợ Bến Thành và cấp 4 là Thành phố Hồ Chí Minh', async () => {
    const [w] = await sql`SELECT name, name_norm, parent_id FROM admin_area WHERE level = 8 AND ST_Contains(geom, ST_SetSRID(ST_MakePoint(106.698, 10.772), 4326)) LIMIT 1`;
    expect(w).toBeDefined();
    const [p] = await sql`SELECT name_norm FROM admin_area WHERE level = 4 AND ST_Contains(geom, ST_SetSRID(ST_MakePoint(106.698, 10.772), 4326))`;
    expect(p?.name_norm).toBe('ho chi minh');
  });
  it('street: Lê Lợi là một tuyến MultiLineString, có ward_norm, không có hẻm trong street', async () => {
    const rows = await sql`SELECT name, ward_norm, GeometryType(geom) AS t, array_length(osm_way_ids, 1) AS ways FROM street WHERE name_norm = 'le loi'`;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].t).toBe('MULTILINESTRING');
    expect(rows[0].ways).toBeGreaterThanOrEqual(1);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM street WHERE name ~* '^(hẻm|ngõ|ngách|kiệt) [0-9]'`;
    expect(n).toBe(0);
  });
  it('alley: mọi hẻm có number; ≥ 60 % có đường mẹ và entrance nằm trên đường mẹ (≤ 1 m)', async () => {
    const [s] = await sql`SELECT count(*)::int AS n, count(parent_street_id)::int AS wp, count(entrance)::int AS we FROM alley`;
    expect(s.n).toBeGreaterThan(0);
    expect(s.wp / s.n).toBeGreaterThanOrEqual(0.6);
    expect(s.we).toBe(s.wp);
    const [{ far }] = await sql`SELECT count(*)::int AS far FROM alley a JOIN street s ON s.id = a.parent_street_id WHERE ST_Distance(a.entrance::geography, s.geom::geography) > 1`;
    expect(far).toBe(0);
  });
  it('address_anchor: có mốc Lê Lợi, không trùng (số nhà, đường) trong 30 m, ward/province điền', async () => {
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM address_anchor WHERE street_norm = 'le loi'`;
    expect(n).toBeGreaterThanOrEqual(3);
    const [{ dup }] = await sql`SELECT count(*)::int AS dup FROM address_anchor a JOIN address_anchor b ON a.id < b.id AND a.housenumber = b.housenumber AND a.street_norm = b.street_norm AND ST_DWithin(a.geom::geography, b.geom::geography, 30)`;
    expect(dup).toBe(0);
    const [{ filled, total }] = await sql`SELECT count(province_norm)::int AS filled, count(*)::int AS total FROM address_anchor`;
    expect(filled / total).toBeGreaterThan(0.95);
  });
  it('chạy lại idempotent (không còn _new, số dòng không đổi)', async () => {
    const before = (await sql`SELECT count(*)::int AS n FROM street`)[0].n;
    node('pipelines/poi/src/geocode/streets.mjs');
    node('pipelines/poi/src/geocode/alleys.mjs');
    expect((await sql`SELECT count(*)::int AS n FROM street`)[0].n).toBe(before);
    expect((await sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name LIKE '%\\_new'`)[0].n).toBe(0);
  });
});
```

Run: `PIPE pipeline pnpm test:db`
Expected: xanh. Nếu admin cấp 8 rỗng trong fixture: kiểm `make-fixture.mjs` (Task 5) đã dùng `-s smart -S types=any` và tạo lại fixture.

- [ ] **Step 9: Chạy thật toàn VN; xác nhận `admin_level` (G6) và ghi README**

Run: `PIPE pipeline sh -c "node pipelines/poi/src/geocode/osm-roads.mjs && node pipelines/poi/src/geocode/admin.mjs && node pipelines/poi/src/geocode/streets.mjs && node pipelines/poi/src/geocode/alleys.mjs && node pipelines/poi/src/geocode/anchors.mjs && node pipelines/poi/src/report.mjs"`
Expected: `admin_level: 4=34, 8=~3300` (và `6=…` nếu OSM còn quận/huyện cũ); `street` ≈ 150–300 nghìn; `alley` ≥ 40 nghìn (spec 5.1: 29.917 hẻm có tên riêng TP.HCM); `address_anchor` ≈ 1–2 triệu; **Nguyễn Lâm ≥ 15** (nghiệm thu). Thời gian 20–40 phút.

Điền `pipelines/poi/README.md` mục "admin_level thực tế trong OSM VN": bảng level → số vùng → dùng cho (4 tỉnh/thành; 6 quận/huyện cũ nếu còn → `admin_alias`; 8 phường/xã), ngày đo, và ghi chú tỉnh nào thiếu ranh giới (nếu có).

- [ ] **Step 10: Lint, DEVLOG, commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`

Sửa `docs/DEVLOG.md`: "Task đang làm: Task 9"; mục 3: "admin_level thực tế: …; alias phường/xã 2025 mới có ví dụ spec — việc tay: biên soạn từ NQ UBTVQH"; mục 1 thêm "Việc tay còn lại: bảng đối chiếu phường/xã 2025"; mục 4 dòng `M2 T8` kèm số street/alley/anchor và Nguyễn Lâm.

```bash
git add -A
git commit -m "feat(pipeline-poi): admin_area/admin_alias (63→34 tỉnh), street gộp way liền kề, alley + đường mẹ + entrance, address_anchor gộp trùng"
git push
```

---

### Task 9: `poi-YYYYMMDD.pmtiles` (tippecanoe) + lớp POI trong style + Worker điền `{POI_FILE}`

**Files:**
- Create: `pipelines/poi/src/export-tiles.mjs`, `pipelines/poi/tests/export-tiles.test.mjs`, `packages/style/src/poi-layers.mjs`, `packages/style/src/poi-layers.test.ts`
- Modify: `packages/style/scripts/build.mjs`, `packages/style/src/transform.d.mts`, `apps/api/src/style.ts`, `apps/api/test/styles.test.ts`, `pipelines/tiles/src/smoke.mjs` (`--set poi`), `apps/docs/public/playground.html` (hiện tên/loại khi bấm POI)

- [ ] **Step 1: Test hàm thuần xuất tiles và lớp style (thất bại)**

`pipelines/poi/tests/export-tiles.test.mjs`:
```js
import { describe, expect, it } from 'vitest';
import { LOW_ZOOM_GROUPS, featureLine, tippecanoeFilter } from '../src/export-tiles.mjs';

describe('featureLine', () => {
  it('thuộc tính tối thiểu id/name/cat/grp/q (bucket 0–9), toạ độ [lon, lat]', () => {
    const f = JSON.parse(featureLine({ id: '01ARZ', name: 'Cà phê Cộng', cat: 'cafe', grp: 'food_drink', quality_score: 67, lon: 106.7, lat: 10.77 }));
    expect(f).toEqual({ type: 'Feature', properties: { id: '01ARZ', name: 'Cà phê Cộng', cat: 'cafe', grp: 'food_drink', q: 6 }, geometry: { type: 'Point', coordinates: [106.7, 10.77] } });
    expect(JSON.parse(featureLine({ id: 'x', name: 'y', cat: 'other', grp: 'other', quality_score: 100, lon: 0, lat: 0 })).properties.q).toBe(9);
    expect(JSON.parse(featureLine({ id: 'x', name: 'y', cat: 'other', grp: 'other', quality_score: null, lon: 0, lat: 0 })).properties.q).toBe(0);
  });
});

describe('tippecanoeFilter (spec 5.8)', () => {
  it('z15–16 tất cả; z12–14 q ≥ 6; z10–11 chỉ 5 nhóm công cộng q ≥ 7', () => {
    const f = tippecanoeFilter().poi;
    expect(f[0]).toBe('any');
    expect(f[1]).toEqual(['>=', '$zoom', 15]);
    expect(f[2]).toEqual(['all', ['>=', '$zoom', 12], ['<=', '$zoom', 14], ['>=', 'q', 6]]);
    expect(f[3]).toEqual(['all', ['<=', '$zoom', 11], ['>=', 'q', 7], ['in', 'grp', ...LOW_ZOOM_GROUPS]]);
    expect(LOW_ZOOM_GROUPS).toEqual(['education', 'health', 'transport', 'public_admin', 'culture_tourism']);
  });
});
```

`packages/style/src/poi-layers.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { POI_GROUP_ICONS, addPoiLayers } from './poi-layers.mjs';
import { fillTemplate, transformStyle } from './transform.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const sovereignty = JSON.parse(readFileSync(resolve(here, 'sovereignty.geojson'), 'utf8'));
const sprite = JSON.parse(readFileSync(resolve(here, '../assets/sprites/osm-liberty.json'), 'utf8'));
const base = JSON.parse(readFileSync(resolve(here, 'base/osm-liberty.json'), 'utf8'));
const filled = (tpl: unknown) =>
  JSON.parse(fillTemplate(JSON.stringify(tpl), { TILES_BASE: 'https://tiles.test', VN_FILE: 'vn-20260826', POI_FILE: 'poi-20260901' }));

describe('addPoiLayers', () => {
  const out = addPoiLayers(transformStyle(base, { theme: 'light', sovereignty }), { theme: 'light' });
  const poi = out.layers.find((l: { id: string }) => l.id === 'poi');

  it('thêm nguồn poi (template POI_FILE) và lớp symbol poi minzoom 10 trước lớp chủ quyền', () => {
    expect(out.sources.poi.url).toBe('pmtiles://{TILES_BASE}/tiles/{POI_FILE}.pmtiles');
    expect(poi).toBeDefined();
    expect(poi.type).toBe('symbol');
    expect(poi['source-layer']).toBe('poi');
    expect(poi.minzoom).toBe(10);
    expect(out.layers.at(-1).id).toBe('sovereignty-label');
    expect(out.layers.indexOf(poi)).toBe(out.layers.length - 2);
  });
  it('bỏ các lớp POI của base (source-layer poi từ openmaptiles) để không trùng icon', () => {
    expect(out.layers.some((l: { source?: string; 'source-layer'?: string }) => l.source === 'openmaptiles' && l['source-layer'] === 'poi')).toBe(false);
  });
  it('icon theo 12 nhóm + other, mọi icon có trong sprite osm-liberty; nhãn dùng font Noto; sắp theo q', () => {
    expect(Object.keys(POI_GROUP_ICONS)).toHaveLength(13);
    for (const icon of Object.values(POI_GROUP_ICONS)) expect(sprite[icon], `sprite thiếu ${icon}`).toBeDefined();
    expect(poi.layout['text-font']).toEqual(['Noto Sans Regular']);
    expect(poi.layout['symbol-sort-key']).toEqual(['-', 9, ['get', 'q']]);
  });
  it('template điền xong hợp lệ theo style-spec', () => {
    expect(validateStyleMin(filled(out))).toEqual([]);
  });
});
```

Run: `pnpm test`
Expected: FAIL — thiếu `export-tiles.mjs`, `poi-layers.mjs`.

- [ ] **Step 2: `poi-layers.mjs` và build style**

`packages/style/src/poi-layers.mjs`:
```js
// Lớp POI (poi-YYYYMMDD.pmtiles, spec 5.8) cho template style. Icon theo nhóm (sprite osm-liberty/Maki); chi tiết lấy qua API khi bấm.
export const POI_GROUP_ICONS = {
  food_drink: 'restaurant',
  shopping: 'shop',
  services: 'shop',
  health: 'hospital',
  education: 'school',
  finance: 'bank',
  lodging: 'lodging',
  entertainment_sport: 'stadium',
  culture_tourism: 'museum',
  transport: 'bus',
  public_admin: 'town_hall',
  religion_community: 'place_of_worship',
  other: 'marker',
};

/**
 * @param {Record<string, any>} style template đã qua transformStyle (lớp cuối là sovereignty-label)
 * @param {{ theme: 'light' | 'dark' }} opts
 */
export function addPoiLayers(style, opts) {
  const dark = opts.theme === 'dark';
  const layers = style.layers.filter((l) => !(l.source === 'openmaptiles' && l['source-layer'] === 'poi'));
  const poiLayer = {
    id: 'poi',
    type: 'symbol',
    source: 'poi',
    'source-layer': 'poi',
    minzoom: 10,
    layout: {
      'icon-image': ['match', ['get', 'grp'], ...Object.entries(POI_GROUP_ICONS).filter(([g]) => g !== 'other').flat(), POI_GROUP_ICONS.other],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.7, 16, 1],
      'icon-allow-overlap': false,
      'text-field': ['step', ['zoom'], '', 13, ['get', 'name']],
      'text-font': ['Noto Sans Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 18, 13],
      'text-offset': [0, 1.1],
      'text-anchor': 'top',
      'text-max-width': 8,
      'text-optional': true,
      'symbol-sort-key': ['-', 9, ['get', 'q']],
    },
    paint: {
      'text-color': dark ? '#e8e8e8' : '#333333',
      'text-halo-color': dark ? '#111111' : '#ffffff',
      'text-halo-width': 1.2,
    },
  };
  const sovereigntyIdx = layers.findIndex((l) => l.id === 'sovereignty-label');
  layers.splice(sovereigntyIdx < 0 ? layers.length : sovereigntyIdx, 0, poiLayer);
  return {
    ...style,
    sources: {
      ...style.sources,
      poi: {
        type: 'vector',
        url: 'pmtiles://{TILES_BASE}/tiles/{POI_FILE}.pmtiles',
        attribution: 'Places: Overture Maps Foundation (CDLA-Permissive 2.0), Foursquare OS Places (Apache-2.0)',
      },
    },
    layers,
  };
}
```

Sửa `packages/style/scripts/build.mjs`: import `addPoiLayers` và đổi dòng tạo `out` thành `const out = addPoiLayers(transformStyle(read(base), { theme, sovereignty }), { theme });`.

Thêm vào `packages/style/src/transform.d.mts` (kiểu cho Worker/TS):
```ts
export const POI_GROUP_ICONS: Record<string, string>;
export function addPoiLayers(style: Record<string, unknown> & { layers: Record<string, unknown>[] }, opts: { theme: 'light' | 'dark' }): Record<string, unknown> & { layers: Record<string, unknown>[] };
```
và trong `packages/style/package.json` `exports` thêm `"./poi-layers": { "types": "./src/transform.d.mts", "default": "./src/poi-layers.mjs" }` (tuỳ chọn, cho tương lai).

Run: `pnpm --filter @mapslibvn/style build && pnpm test`
Expected: test poi-layers xanh. Nếu test "sprite thiếu X" đỏ: `node -e "console.log(Object.keys(require('./packages/style/assets/sprites/osm-liberty.json')).sort().join(' '))"` và đổi tên icon trong `POI_GROUP_ICONS` sang tên có thật (ưu tiên: restaurant, shop, hospital, school, bank, lodging, stadium, museum, bus, town_hall, place_of_worship, marker/circle).

- [ ] **Step 3: `export-tiles.mjs`**

```js
#!/usr/bin/env node
// poi active → GeoJSONSeq → tippecanoe → out/<release>.pmtiles (spec 5.8). Dùng: node export-tiles.mjs [--release poi-YYYYMMDD]
import { createWriteStream, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { run } from '../../../scripts/lib/run.mjs';
import { releaseName } from '../../tiles/src/lib/dates.mjs';
import { OUT, POI_WORK, arg } from './lib/env.mjs';
import { connect } from './pg.mjs';

export const LOW_ZOOM_GROUPS = ['education', 'health', 'transport', 'public_admin', 'culture_tourism'];

/** Bộ lọc tippecanoe theo zoom: z10–11 nhóm công cộng q ≥ 7; z12–14 mọi nhóm q ≥ 6; z15–16 tất cả (spec 5.8). */
export function tippecanoeFilter() {
  return {
    poi: [
      'any',
      ['>=', '$zoom', 15],
      ['all', ['>=', '$zoom', 12], ['<=', '$zoom', 14], ['>=', 'q', 6]],
      ['all', ['<=', '$zoom', 11], ['>=', 'q', 7], ['in', 'grp', ...LOW_ZOOM_GROUPS]],
    ],
  };
}

/** @param {{ id: string, name: string, cat: string, grp: string, quality_score: number | null, lon: number, lat: number }} r */
export function featureLine(r) {
  const q = Math.max(0, Math.min(9, Math.floor((r.quality_score ?? 0) / 10)));
  return `${JSON.stringify({ type: 'Feature', properties: { id: r.id, name: r.name, cat: r.cat, grp: r.grp, q }, geometry: { type: 'Point', coordinates: [r.lon, r.lat] } })}\n`;
}

if (process.argv[1]?.endsWith('export-tiles.mjs')) {
  const release = arg('--release', undefined) ?? releaseName('poi');
  mkdirSync(POI_WORK, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const seq = resolve(POI_WORK, 'poi.geojsonseq');
  const filterFile = resolve(POI_WORK, 'poi-filter.json');
  const output = resolve(OUT, `${release}.pmtiles`);
  const sql = connect();
  let n = 0;
  try {
    async function* lines() {
      for await (const rows of sql`SELECT p.id, p.name, p.category AS cat, c.group_code AS grp, p.quality_score, ST_X(p.geom) AS lon, ST_Y(p.geom) AS lat
          FROM poi p JOIN category c ON c.code = p.category WHERE p.status = 'active'`.cursor(5000)) {
        for (const r of rows) {
          n++;
          yield featureLine(r);
        }
      }
    }
    await pipeline(Readable.from(lines()), createWriteStream(seq));
  } finally {
    await sql.end();
  }
  writeFileSync(filterFile, JSON.stringify(tippecanoeFilter()));
  // Không dùng --extend-zooms-if-still-dropping: nó có thể đẩy maxzoom > 16 làm smoke/inspect lệch với spec 5.8.
  run('tippecanoe', ['-o', output, '--force', '-l', 'poi', '-Z10', '-z16', '-r1', '--drop-densest-as-needed',
    '-J', filterFile, '-P', '-y', 'id', '-y', 'name', '-y', 'cat', '-y', 'grp', '-y', 'q', seq]);
  const mb = statSync(output).size / 2 ** 20;
  console.log(`✓ ${output}: ${n} POI, ${mb.toFixed(1)} MB`);
  if (mb > 400) {
    console.error('Vượt 400 MB — thêm --maximum-tile-bytes=300000 hoặc nâng ngưỡng q ở z12–14; xem spec 5.8 (mục tiêu ≤ 300 MB)');
    process.exit(4);
  }
  if (mb > 300) console.warn('⚠ vượt mục tiêu 300 MB (spec 5.8) — ghi DEVLOG, cân nhắc siết bộ lọc');
}
```

Run: `PIPE pipeline node pipelines/poi/src/export-tiles.mjs --release poi-fixture`
Expected (fixture): tippecanoe chạy vài giây; `✓ /app/out/poi-fixture.pmtiles: N POI, X MB` (X < 5). Nếu tippecanoe báo không hỗ trợ `-J`: dùng `-j "$(cat filter)"` — sửa mảng đối số thành `['-j', JSON.stringify(tippecanoeFilter())]`.

Run: `PIPE pipeline sh -c "node pipelines/tiles/src/inspect.mjs /app/out/poi-fixture.pmtiles && node pipelines/tiles/src/qa.mjs /app/out/poi-fixture.pmtiles --skip-islands"`
Expected: `zoom: [10, 16]`, `layers: ["poi"]`; QA `✓` (không có tile trong bbox chủ quyền; template style vẫn có 2 nhãn).

- [ ] **Step 4: Worker điền `{POI_FILE}` hoặc bỏ lớp POI khi chưa phát hành**

`apps/api/src/style.ts` — thay `renderStyle`:
```ts
export function renderStyle(theme: Theme, manifest: Manifest, tilesBase: string): string {
  const filled = fillTemplate(TEMPLATES[theme], {
    TILES_BASE: tilesBase.replace(/\/+$/, ''),
    VN_FILE: manifest.vn ?? '',
    POI_FILE: manifest.poi ?? '',
  });
  if (manifest.poi) return filled;
  // Chưa có bản POI: bỏ nguồn + lớp poi để MapLibre không tải file rỗng
  const style = JSON.parse(filled) as { sources: Record<string, unknown>; layers: { source?: string }[] };
  delete style.sources.poi;
  style.layers = style.layers.filter((l) => l.source !== 'poi');
  return JSON.stringify(style);
}
```

Thêm vào `apps/api/test/styles.test.ts` (describe `GET /v1/styles/:theme.json`):
```ts
  it('manifest chưa có poi → style không có nguồn/lớp poi', async () => {
    const res = await SELF.fetch('https://api/v1/styles/light.json');
    const style = (await res.json()) as { sources: Record<string, unknown>; layers: { id: string }[] };
    expect(style.sources.poi).toBeUndefined();
    expect(style.layers.some((l) => l.id === 'poi')).toBe(false);
  });

  it('manifest có poi → nguồn poi trỏ đúng file, lớp poi minzoom 10', async () => {
    await env.META.put('release:current', JSON.stringify({ vn: 'vn-20260826', poi: 'poi-20260901' }));
    const res = await SELF.fetch('https://api/v1/styles/dark.json');
    const style = (await res.json()) as { sources: Record<string, { url?: string }>; layers: { id: string; minzoom?: number }[] };
    expect(style.sources.poi?.url).toBe('pmtiles://https://tiles.test/tiles/poi-20260901.pmtiles');
    expect(style.layers.find((l) => l.id === 'poi')?.minzoom).toBe(10);
  });
```

Run: `pnpm --filter @mapslibvn/style build && pnpm --filter @mapslibvn/api test`
Expected: xanh.

- [ ] **Step 5: `smoke.mjs --set poi`, playground hiện tên/loại khi bấm**

Sửa `pipelines/tiles/src/smoke.mjs` (thay phần đầu và vòng lặp):
```js
const argv = process.argv.slice(2);
const release = argv[0];
const set = argv.includes('--set') ? argv[argv.indexOf('--set') + 1] : 'vn';
const expectMaxZoom = set === 'poi' ? 16 : 14;
const zooms = set === 'poi' ? [12, 14, 15, 16] : [10, 12, 13, 14];
const url = `${requireEnv('TILES_BASE')}/tiles/${release}.pmtiles`;
const p = new PMTiles(new FetchSource(url));
const h = await p.getHeader();
if (h.maxZoom !== expectMaxZoom) throw new Error(`maxZoom lạ: ${h.maxZoom} (mong ${expectMaxZoom})`);
const centers = [[106.7, 10.77], [105.85, 21.03], [108.2, 16.05], [106.35, 9.99], [109.19, 12.24]];
let ok = 0;
let empty = 0;
for (const [lon, lat] of centers) {
  for (const z of zooms) {
    const { x, y } = lonLatToTile(lon, lat, z);
    const t = await p.getZxy(z, x, y);
    if (!t?.data?.byteLength) {
      if (set === 'vn') throw new Error(`tile trống z${z}/${x}/${y} tại ${lon},${lat}`);
      empty++;
      continue;
    }
    ok++;
  }
}
if (set === 'poi' && ok < 15) throw new Error(`POI tiles: chỉ ${ok}/20 tile có dữ liệu tại trung tâm 5 thành phố`);
console.log(`✓ smoke ${ok} tile (${empty} trống) từ ${url}`);
```

Sửa `apps/docs/public/playground.html` — sau `map.addMarker(…)` thêm:
```js
      map.on('poiClick', (poi) => { status.textContent = `${poi.name} · ${poi.category} (${poi.group})`; });
```

Run: `pnpm --filter @mapslibvn/web build && pnpm --filter @mapslibvn/docs build && pnpm --filter @mapslibvn/docs e2e`
Expected: E2E vẫn xanh (fixture chưa có POI, style bỏ lớp poi).

- [ ] **Step 6: Lint, DEVLOG, commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`

Sửa `docs/DEVLOG.md`: "Task đang làm: Task 10"; mục 3: "Style: bỏ lớp poi của base OSM Liberty, dùng lớp `poi` riêng; Worker bỏ nguồn poi khi manifest.poi null"; mục 4 dòng `M2 T9` kèm kích cỡ pmtiles fixture.

```bash
git add -A
git commit -m "feat(poi-tiles): export poi.pmtiles bằng tippecanoe theo luật mật độ 5.8, lớp poi trong style, Worker điền POI_FILE, smoke --set poi"
git push
```

---

### Task 10: `pnpm data:update` đầy đủ (3 nguồn, nhánh `--poi`, nối DB qua Tunnel), `pnpm db:restore`, nghiệm thu M2

**Files:**
- Create: `scripts/lib/sources.mjs`, `scripts/lib/sources.test.mjs`, `scripts/db-restore.mjs`, `pipelines/poi/tests/pipeline-fixture.dbtest.mjs`
- Modify: `scripts/lib/update-plan.mjs`, `scripts/lib/update-plan.test.mjs` (viết lại cho 3 nguồn), `scripts/data-update.mjs` (viết lại), `.github/workflows/data-update.yml` (thêm biến DB qua Tunnel), `infra/server/README.md`, `pipelines/poi/README.md`, `docs/DEVLOG.md`

- [ ] **Step 1: Test dò phiên bản Overture/FSQ và kế hoạch 3 nguồn (thất bại)**

`scripts/lib/sources.test.mjs`:
```js
import { describe, expect, it, vi } from 'vitest';
import { detectSources, latestFsqRelease, latestOvertureRelease, parseS3Prefixes } from './sources.mjs';

const XML = `<?xml version="1.0"?><ListBucketResult><Name>overturemaps-us-west-2</Name><Prefix>release/</Prefix><Delimiter>/</Delimiter>
<CommonPrefixes><Prefix>release/2026-06-25.0/</Prefix></CommonPrefixes><CommonPrefixes><Prefix>release/2026-08-20.0/</Prefix></CommonPrefixes>
<CommonPrefixes><Prefix>release/2026-07-23.1/</Prefix></CommonPrefixes></ListBucketResult>`;

describe('parseS3Prefixes / latest*', () => {
  it('lấy CommonPrefixes, bỏ Prefix gốc', () => {
    expect(parseS3Prefixes(XML, 'release/')).toEqual(['release/2026-06-25.0/', 'release/2026-08-20.0/', 'release/2026-07-23.1/']);
  });
  it('Overture: bản mới nhất theo thứ tự chuỗi YYYY-MM-DD.N', () => {
    expect(latestOvertureRelease(['release/2026-06-25.0/', 'release/2026-08-20.0/', 'release/2026-07-23.1/'])).toBe('2026-08-20.0');
  });
  it('FSQ: partition dt= mới nhất từ cây thư mục Hugging Face', () => {
    expect(latestFsqRelease([{ path: 'release/dt=2026-07-08', type: 'directory' }, { path: 'release/dt=2026-08-11', type: 'directory' }, { path: 'release/README.md', type: 'file' }])).toBe('2026-08-11');
  });
});

describe('detectSources', () => {
  it('gộp Geofabrik HEAD + md5 + 2 listing S3', async () => {
    const fetchFn = vi.fn(async (url) => {
      const u = String(url);
      if (u.endsWith('.md5')) return new Response('abc123  vietnam-latest.osm.pbf\n');
      if (u.includes('geofabrik')) return new Response(null, { headers: { 'last-modified': 'Mon, 24 Aug 2026 20:00:00 GMT' } });
      if (u.includes('overturemaps')) return new Response(XML);
      return new Response(JSON.stringify([{ path: 'release/dt=2026-08-11', type: 'directory' }]));
    });
    expect(await detectSources(fetchFn, 'hf_test')).toEqual({
      osm: { lastModified: 'Mon, 24 Aug 2026 20:00:00 GMT', md5: 'abc123' },
      overture: { release: '2026-08-20.0' },
      fsq: { release: '2026-08-11' },
    });
    expect(fetchFn.mock.calls.some(([url, init]) => String(url).includes('huggingface.co') && init?.headers?.Authorization === 'Bearer hf_test')).toBe(true);
  });
});
```

`scripts/lib/update-plan.test.mjs` (thay toàn bộ):
```js
import { describe, expect, it } from 'vitest';
import { decideWork, nextState } from './update-plan.mjs';

const state = {
  osm: { lastModified: 'Mon, 18 Aug 2026 20:00:00 GMT', md5: 'aaa' },
  overture: { release: '2026-07-23.1' },
  fsq: { release: '2026-07-08' },
  releases: { vn: 'vn-20260819', poi: 'poi-20260819' },
};
const same = { osm: state.osm, overture: state.overture, fsq: state.fsq };
const osmNew = { ...same, osm: { lastModified: 'Mon, 25 Aug 2026 20:00:00 GMT', md5: 'bbb' } };
const overtureNew = { ...same, overture: { release: '2026-08-20.0' } };

describe('decideWork (spec 5.9)', () => {
  it('không có gì mới → không làm gì', () => {
    expect(decideWork(state, same, {})).toEqual({ tiles: false, poi: false, reasons: [] });
  });
  it('OSM mới → tiles và poi', () => {
    expect(decideWork(state, osmNew, {})).toEqual({ tiles: true, poi: true, reasons: ['OSM đổi (md5 aaa → bbb)'] });
  });
  it('Overture/FSQ mới → chỉ poi', () => {
    expect(decideWork(state, overtureNew, {})).toEqual({ tiles: false, poi: true, reasons: ['Overture đổi (2026-07-23.1 → 2026-08-20.0)'] });
    expect(decideWork(state, { ...same, fsq: { release: '2026-08-05' } }, {}).tiles).toBe(false);
  });
  it('--force làm tất cả; --tiles/--poi giới hạn', () => {
    expect(decideWork(state, same, { force: true })).toEqual({ tiles: true, poi: true, reasons: ['--force'] });
    expect(decideWork(state, osmNew, { onlyTiles: true }).poi).toBe(false);
    expect(decideWork(state, osmNew, { onlyPoi: true }).tiles).toBe(false);
  });
  it('state rỗng (lần đầu) → làm tất cả với 3 lý do', () => {
    expect(decideWork({}, same, {}).reasons).toHaveLength(3);
  });
});

describe('nextState', () => {
  it('ghi cả 3 nguồn và release mới, giữ release cũ nếu không build', () => {
    expect(nextState(state, overtureNew, { poi: 'poi-20260826' })).toEqual({
      osm: state.osm, overture: { release: '2026-08-20.0' }, fsq: state.fsq, releases: { vn: 'vn-20260819', poi: 'poi-20260826' },
    });
  });
});
```

Run: `pnpm test`
Expected: FAIL — `sources.mjs` chưa có; test update-plan đỏ (chưa có overture/fsq).

- [ ] **Step 2: `sources.mjs` và `update-plan.mjs`**

`scripts/lib/sources.mjs`:
```js
export const GEOFABRIK_PBF = 'https://download.geofabrik.de/asia/vietnam-latest.osm.pbf';
const OVERTURE_LIST = 'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/?list-type=2&prefix=release/&delimiter=/';
// FSQ: S3 công khai đã đóng (2026) — dò qua API cây thư mục của dataset gated trên Hugging Face (cần token Read)
const FSQ_TREE = 'https://huggingface.co/api/datasets/foursquare/fsq-os-places/tree/main/release';

/** CommonPrefixes của ListObjectsV2 (delimiter=/), bỏ Prefix gốc. @param {string} xml @param {string} base */
export function parseS3Prefixes(xml, base) {
  return [...xml.matchAll(/<Prefix>([^<]+)<\/Prefix>/g)].map((m) => m[1] ?? '').filter((p) => p !== base && p.startsWith(base));
}

/** @param {string[]} prefixes */
export function latestOvertureRelease(prefixes) {
  const versions = prefixes.map((p) => /release\/(\d{4}-\d{2}-\d{2}\.\d+)\//.exec(p)?.[1]).filter((v) => v !== undefined);
  return [...versions].sort().at(-1) ?? null;
}

/** @param {{ path: string, type: string }[]} entries kết quả JSON của HF tree API */
export function latestFsqRelease(entries) {
  const dts = entries.filter((e) => e.type === 'directory').map((e) => /dt=(\d{4}-\d{2}-\d{2})$/.exec(e.path)?.[1]).filter((v) => v !== undefined);
  return [...dts].sort().at(-1) ?? null;
}

/** Dò phiên bản 3 nguồn (spec 5.9 bước 1). @param {typeof fetch} fetchFn @param {string | undefined} hfToken */
export async function detectSources(fetchFn = fetch, hfToken = process.env.HF_TOKEN) {
  if (!hfToken) throw new Error('Thiếu HF_TOKEN để dò phiên bản Foursquare (dataset gated)');
  const [head, md5Text, overtureXml, fsqTree] = await Promise.all([
    fetchFn(GEOFABRIK_PBF, { method: 'HEAD' }),
    fetchFn(`${GEOFABRIK_PBF}.md5`).then((r) => r.text()),
    fetchFn(OVERTURE_LIST).then((r) => r.text()),
    fetchFn(FSQ_TREE, { headers: { Authorization: `Bearer ${hfToken}` } }).then((r) => {
      if (!r.ok) throw new Error(`HF tree API: HTTP ${r.status} — token hết hạn hoặc chưa chấp nhận điều khoản dataset`);
      return r.json();
    }),
  ]);
  const overture = latestOvertureRelease(parseS3Prefixes(overtureXml, 'release/'));
  const fsq = latestFsqRelease(/** @type {{ path: string, type: string }[]} */ (fsqTree));
  if (!overture || !fsq) throw new Error(`Không dò được phiên bản: overture=${overture} fsq=${fsq}`);
  return {
    osm: { lastModified: head.headers.get('last-modified') ?? '', md5: md5Text.split(/\s+/)[0] ?? '' },
    overture: { release: overture },
    fsq: { release: fsq },
  };
}
```

`scripts/lib/update-plan.mjs` (thay toàn bộ):
```js
/**
 * @typedef {{ osm?: { lastModified: string, md5: string }, overture?: { release: string }, fsq?: { release: string },
 *   releases?: { vn: string | null, poi: string | null } }} State
 * @typedef {{ osm: { lastModified: string, md5: string }, overture: { release: string }, fsq: { release: string } }} Versions
 * @typedef {{ force?: boolean, onlyTiles?: boolean, onlyPoi?: boolean }} Flags
 */

/** Spec 5.9 bước 2: OSM đổi → tiles + poi; Overture/FSQ đổi → chỉ poi. @param {State} state @param {Versions} v @param {Flags} flags */
export function decideWork(state, v, flags) {
  const reasons = [];
  const osmChanged = !state.osm || state.osm.md5 !== v.osm.md5;
  const overtureChanged = !state.overture || state.overture.release !== v.overture.release;
  const fsqChanged = !state.fsq || state.fsq.release !== v.fsq.release;
  if (osmChanged) reasons.push(`OSM đổi (md5 ${state.osm?.md5 ?? '∅'} → ${v.osm.md5})`);
  if (overtureChanged) reasons.push(`Overture đổi (${state.overture?.release ?? '∅'} → ${v.overture.release})`);
  if (fsqChanged) reasons.push(`FSQ đổi (${state.fsq?.release ?? '∅'} → ${v.fsq.release})`);
  if (flags.force) reasons.push('--force');
  let tiles = osmChanged || Boolean(flags.force);
  let poi = osmChanged || overtureChanged || fsqChanged || Boolean(flags.force);
  if (flags.onlyTiles) poi = false;
  if (flags.onlyPoi) tiles = false;
  return { tiles, poi, reasons };
}

/** @param {State} state @param {Versions} v @param {{ vn?: string, poi?: string }} built */
export function nextState(state, v, built) {
  return {
    osm: v.osm,
    overture: v.overture,
    fsq: v.fsq,
    releases: { vn: built.vn ?? state.releases?.vn ?? null, poi: built.poi ?? state.releases?.poi ?? null },
  };
}

const LIVE_ENV = [
  'TILES_BASE', 'R2_BUCKET', 'CLOUDFLARE_ACCOUNT_ID', 'KV_NAMESPACE_ID_META', 'CLOUDFLARE_API_TOKEN',
  'RCLONE_CONFIG_R2_ACCESS_KEY_ID', 'RCLONE_CONFIG_R2_SECRET_ACCESS_KEY', 'RCLONE_CONFIG_R2_ENDPOINT',
  'RCLONE_CONFIG_R2_NO_CHECK_BUCKET', 'HF_TOKEN',
];

/** Preflight (quyết định M1b T6): thiếu credential thì dừng TRƯỚC khi build hàng giờ. @param {Record<string, string | undefined>} env @param {Flags & { dryRun?: boolean }} flags */
export function missingLiveEnv(env, flags) {
  if (flags.dryRun) return [];
  return LIVE_ENV.filter((name) => !env[name]?.trim());
}
```
(Giữ test `missingLiveEnv` của M1b trong `update-plan.test.mjs`; thêm trường hợp `HF_TOKEN` thiếu → có trong danh sách.)

Run: `pnpm test`
Expected: xanh.

- [ ] **Step 3: `scripts/data-update.mjs` — viết lại với nhánh POI và nối DB qua Tunnel**

```js
#!/usr/bin/env node
// Một lệnh cập nhật dữ liệu (spec 5.9). Ngoài container: tự chạy lại chính nó trong image pipeline (compose dev).
// Trong container: dò 3 nguồn → so state R2 → build tiles/POI có điều kiện → QA → upload → manifest → state.
import 'dotenv/config';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { releaseName } from '../pipelines/tiles/src/lib/dates.mjs';
import { hasListedFile } from '../pipelines/tiles/src/lib/manifest-state.mjs';
import { run, sleep } from './lib/run.mjs';
import { detectSources } from './lib/sources.mjs';
import { decideWork, missingLiveEnv, nextState } from './lib/update-plan.mjs';

const argv = process.argv.slice(2);
const flags = { force: argv.includes('--force'), onlyTiles: argv.includes('--tiles'), onlyPoi: argv.includes('--poi'), dryRun: argv.includes('--dry-run') };
if (flags.onlyTiles && flags.onlyPoi) throw new Error('Chỉ dùng một trong --tiles hoặc --poi');
const missingEnv = missingLiveEnv(process.env, flags);
if (missingEnv.length > 0) {
  throw new Error(`Thiếu credentials cho lần chạy live: ${missingEnv.join(', ')}. Điền vào .env / infra/server/.env; không gửi secret qua chat.`);
}
const compose = ['compose', '--env-file', '.env', '-f', 'infra/dev/compose.yml', '--profile', 'pipeline'];

if (process.env.MAPSLIBVN_IN_CONTAINER !== '1') {
  run('docker', [...compose, 'build', 'pipeline']);
  run('docker', [...compose, 'run', '--rm', 'pipeline', 'node', 'scripts/data-update.mjs', ...argv]);
  process.exit(0);
}

const t0 = Date.now();
const log = (/** @type {string} */ m) => console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${m}`);
const WORK = process.env.MAPSLIBVN_WORK ?? '/app/work';
const OUT = process.env.MAPSLIBVN_OUT ?? '/app/out';
const bucket = process.env.R2_BUCKET ?? 'mapslibvn-tiles';
const stateKey = `r2:${bucket}/state/releases.json`;
/** @param {string[]} args */
const rcloneText = (args) => execFileSync('rclone', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
// Không nuốt lỗi rclone: credential sai phải DỪNG ở đây, không được coi là "state rỗng" rồi lên kế hoạch rebuild toàn bộ
const readState = () => {
  const listed = rcloneText(['lsf', `r2:${bucket}/state`, '--files-only']);
  if (!hasListedFile(listed, 'releases.json')) return {};
  return JSON.parse(rcloneText(['cat', stateKey]));
};
const writeState = (/** @type {unknown} */ s) => execFileSync('rclone', ['rcat', stateKey], { input: JSON.stringify(s, null, 2) });

// DB qua Cloudflare Tunnel khi chạy ngoài máy chủ (spec 5.9 "cloudflared access tcp")
if (process.env.DB_TUNNEL_HOSTNAME && process.env.PIPELINE_DATABASE_URL) {
  const child = spawn('cloudflared', ['access', 'tcp', '--hostname', process.env.DB_TUNNEL_HOSTNAME, '--url', '127.0.0.1:5433',
    '--service-token-id', process.env.CF_ACCESS_CLIENT_ID ?? '', '--service-token-secret', process.env.CF_ACCESS_CLIENT_SECRET ?? ''], { stdio: 'inherit' });
  child.unref();
  for (let i = 0; i < 30; i++) {
    const ok = await new Promise((res) => { const s = createConnection(5433, '127.0.0.1'); s.once('connect', () => { s.end(); res(true); }); s.once('error', () => res(false)); });
    if (ok) break;
    await sleep(1000);
  }
  process.env.DATABASE_URL = process.env.PIPELINE_DATABASE_URL;
  log(`DB qua Tunnel ${process.env.DB_TUNNEL_HOSTNAME}`);
}

const versions = await detectSources();
const state = readState();
const work = decideWork(state, versions, flags);
log(`Phiên bản: OSM md5 ${versions.osm.md5} · Overture ${versions.overture.release} · FSQ ${versions.fsq.release}`);
log(`Kế hoạch: ${JSON.stringify(work)}`);
if (flags.dryRun || (!work.tiles && !work.poi)) {
  console.log(flags.dryRun ? '(dry-run) dừng.' : 'Không có gì mới. Dừng.');
  process.exit(0);
}

const osmChanged = !state.osm || state.osm.md5 !== versions.osm.md5;
const patched = `${WORK}/vietnam-patched.osm.pbf`;
const ensurePatchedPbf = () => {
  if (existsSync(patched) && !osmChanged) return;
  run('node', ['pipelines/tiles/src/download.mjs']);
  run('python', ['pipelines/tiles/python/patch_sovereignty.py', `${WORK}/data/sources/vietnam.osm.pbf`, patched]);
};

/** @type {{ vn?: string, poi?: string }} */
const built = {};
if (work.tiles) {
  ensurePatchedPbf();
  const release = releaseName('vn');
  run('node', ['pipelines/tiles/src/build.mjs', '--release', release]);
  run('node', ['pipelines/tiles/src/qa.mjs', `${OUT}/${release}.pmtiles`]);
  run('node', ['pipelines/tiles/src/upload.mjs', release]);
  run('node', ['pipelines/tiles/src/smoke.mjs', release]);
  run('node', ['pipelines/tiles/src/manifest.mjs', 'set', '--vn', release]);
  built.vn = release;
  log(`✓ tiles ${release}`);
}
if (work.poi) {
  ensurePatchedPbf();
  // Không chạy db-migrate ở đây: trên máy chủ role `pipeline` không phải superuser; migration do `pnpm server:setup/update` áp dụng.
  run('node', ['pipelines/poi/src/ingest/osm.mjs']);
  run('node', ['pipelines/poi/src/ingest/overture.mjs', '--release', versions.overture.release]);
  run('node', ['pipelines/poi/src/ingest/fsq.mjs', '--release', versions.fsq.release]);
  run('node', ['pipelines/poi/src/taxonomy.mjs', 'load']);
  run('node', ['pipelines/poi/src/records.mjs']);
  run('node', ['pipelines/poi/src/conflate.mjs']);
  run('node', ['pipelines/poi/src/publish.mjs', ...(flags.force ? ['--force'] : [])]);
  run('node', ['pipelines/poi/src/geocode/osm-roads.mjs']);
  run('node', ['pipelines/poi/src/geocode/admin.mjs']);
  run('node', ['pipelines/poi/src/geocode/streets.mjs']);
  run('node', ['pipelines/poi/src/geocode/alleys.mjs']);
  run('node', ['pipelines/poi/src/geocode/anchors.mjs']);
  const release = releaseName('poi');
  run('node', ['pipelines/poi/src/export-tiles.mjs', '--release', release]);
  run('node', ['pipelines/tiles/src/qa.mjs', `${OUT}/${release}.pmtiles`, '--skip-islands']);
  run('node', ['pipelines/tiles/src/upload.mjs', release]);
  run('node', ['pipelines/tiles/src/smoke.mjs', release, '--set', 'poi']);
  run('node', ['pipelines/tiles/src/manifest.mjs', 'set', '--poi', release]);
  run('node', ['pipelines/poi/src/report.mjs']);
  run('rclone', ['copy', OUT, `r2:${bucket}/state/reports/`, '--include', 'poi-report-*.json']);
  built.poi = release;
  log(`✓ POI ${release}`);
}
writeState(nextState(state, versions, built));
log(`✓ data:update xong ${JSON.stringify(built)} — ${Math.round((Date.now() - t0) / 60000)} phút`);
```

Cập nhật `.github/workflows/data-update.yml` (M1c): thêm vào `env` **`RCLONE_CONFIG_R2_NO_CHECK_BUCKET: "true"`** (M1c để thiếu — `upload.mjs` bắt buộc, dry-run không lộ), `HF_TOKEN: ${{ secrets.HF_TOKEN }}`, các secret `DB_TUNNEL_HOSTNAME`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`, `PIPELINE_DATABASE_URL`, `OVERTURE_RELEASE: ''`, `FSQ_RELEASE: ''`; `timeout-minutes: 300`; thêm 5 secret tương ứng vào repo GitHub (`gh secret set NAME -R dotienphong/maps-library-vietnam` đọc từ stdin bằng `printf '%s' "$v" |` — **không** dùng `--body -`, xem DEVLOG M1c).

Run: `pnpm data:update --dry-run`
Expected: `Phiên bản: OSM md5 … · Overture 2026-… · FSQ 2026-…`, `Kế hoạch: {"tiles":false,"poi":true,"reasons":["Overture đổi (∅ → …)","FSQ đổi (∅ → …)"]}` (state cũ chưa có Overture/FSQ), `(dry-run) dừng.`

- [ ] **Step 4: `scripts/db-restore.mjs`**

```js
#!/usr/bin/env node
// Phục hồi DB từ backup R2 (spec 11.1–11.2). Dùng: pnpm db:restore --latest | --file <tên.dump.zst> [--yes]
// Ngoài container: tự chạy lại trong image (pg_restore, zstd, rclone). Chỉ cho DB local (localhost/postgres) trừ khi --yes.
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { databaseUrlFromEnv } from './lib/migrations.mjs';
import { run } from './lib/run.mjs';

const argv = process.argv.slice(2);
const compose = ['compose', '--env-file', '.env', '-f', 'infra/dev/compose.yml', '--profile', 'pipeline'];
if (process.env.MAPSLIBVN_IN_CONTAINER !== '1') {
  run('docker', [...compose, 'run', '--rm', 'pipeline', 'node', 'scripts/db-restore.mjs', ...argv]);
  process.exit(0);
}
const bucket = process.env.R2_BUCKET ?? 'mapslibvn-tiles';
const url = databaseUrlFromEnv(process.env);
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', 'postgres'].includes(host) && !argv.includes('--yes')) {
  console.error(`Từ chối: DB ${host} không phải local. Thêm --yes nếu cố ý (ghi đè toàn bộ dữ liệu).`);
  process.exit(2);
}
let name = argv[argv.indexOf('--file') + 1];
if (argv.includes('--latest') || !argv.includes('--file')) {
  const list = JSON.parse(execFileSync('rclone', ['lsjson', `r2:${bucket}/backups/daily`], { encoding: 'utf8' }));
  name = list.map((e) => e.Name).sort().at(-1);
  if (!name) throw new Error('Không có backup nào trong backups/daily');
}
const work = resolve(process.env.MAPSLIBVN_WORK ?? 'work', 'restore');
mkdirSync(work, { recursive: true });
const zst = resolve(work, name);
const dump = zst.replace(/\.zst$/, '');
console.log(`Tải ${name} …`);
run('rclone', ['copyto', `r2:${bucket}/backups/daily/${name}`, zst]);
run('zstd', ['-d', '-f', '-q', zst, '-o', dump]);
// Phục hồi vào DB MỚI rồi đổi tên: không dùng --clean lên DB đang có PostGIS (spatial_ref_sys là bảng cấu hình của extension → trùng khoá),
// và DB đang phục vụ không bị bỏ trống nếu pg_restore lỗi giữa chừng.
const target = new URL(url);
const dbName = target.pathname.slice(1);
const adminUrl = new URL(url);
adminUrl.pathname = '/postgres';
const psql = (/** @type {string} */ cmd) => run('psql', ['-v', 'ON_ERROR_STOP=1', '-d', adminUrl.href, '-c', cmd]);
psql(`DROP DATABASE IF EXISTS ${dbName}_restore`);
psql(`CREATE DATABASE ${dbName}_restore TEMPLATE template0`);
const restoreUrl = new URL(url);
restoreUrl.pathname = `/${dbName}_restore`;
console.log('pg_restore vào DB tạm …');
// Không --exit-on-error: cảnh báo về extension đã có sẵn là bình thường; kiểm số bảng sau restore
run('pg_restore', ['--no-owner', '--no-privileges', '-d', restoreUrl.href, dump]);
const tables = execFileSync('psql', ['-tAc', "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'", '-d', restoreUrl.href], { encoding: 'utf8' }).trim();
if (Number(tables) < 16) throw new Error(`Restore thiếu bảng (${tables} < 16) — không đổi DB`);
console.log(`Đổi ${dbName}_restore → ${dbName} (ngắt kết nối đang mở) …`);
psql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('${dbName}', '${dbName}_restore') AND pid <> pg_backend_pid()`);
psql(`DROP DATABASE IF EXISTS ${dbName}_old`);
psql(`ALTER DATABASE ${dbName} RENAME TO ${dbName}_old`);
psql(`ALTER DATABASE ${dbName}_restore RENAME TO ${dbName}`);
psql(`DROP DATABASE ${dbName}_old`);
run(process.execPath, ['scripts/db-migrate.mjs']); // áp dụng migration mới hơn bản backup, nếu có
rmSync(work, { recursive: true, force: true });
console.log(`✓ đã phục hồi ${name} vào ${host}`);
```

Run (máy dev, DB dev đang có dữ liệu fixture): `pnpm db:restore --latest`
Expected: `Tải mapslibvn-YYYYMMDD-HHMM.dump.zst …`, pg_restore chạy 5–15 phút cho bản toàn VN (~1 GB nén), `✓ đã phục hồi …`. Kiểm: `docker compose --env-file .env -f infra/dev/compose.yml exec -T postgres psql -U mapslibvn -d mapslibvn -tAc "select count(*) from poi"` → ≥ 1,5 triệu.

Lưu ý: phục hồi qua DB tạm `<db>_restore` rồi `ALTER DATABASE … RENAME` — DB đang chạy không bị đụng nếu restore lỗi; mọi kết nối đang mở bị ngắt đúng lúc đổi tên (trên máy dev không sao; trên máy chủ dừng `pipeline`/`backup` trước). Role `api`/`pipeline` phải tồn tại trước (migration 0002 hoặc `init-roles.sh`). Cách này đã được thử ở Task 1 Step 8.

- [ ] **Step 5: Test tích hợp toàn pipeline trên fixture (spec 10 "Tích hợp pipeline")**

`pipelines/poi/tests/pipeline-fixture.dbtest.mjs`:
```js
// Toàn chuỗi trên fixture Quận 1 → poi hợp lý, poi.pmtiles sinh ra và qua QA. Chạy trong image.
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseUrlFromEnv } from '../../../scripts/lib/migrations.mjs';

const OUT = process.env.MAPSLIBVN_OUT ?? resolve('out');
const sql = postgres(databaseUrlFromEnv(process.env), { max: 1, onnotice: () => {} });
const node = (/** @type {string[]} */ ...args) => execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

beforeAll(() => {
  node('scripts/db-migrate.mjs');
  for (const s of ['osm', 'overture', 'fsq']) node(`pipelines/poi/src/ingest/${s}.mjs`, '--fixture');
  node('pipelines/poi/src/taxonomy.mjs', 'load');
  node('pipelines/poi/src/records.mjs');
  node('pipelines/poi/src/conflate.mjs');
  node('pipelines/poi/src/publish.mjs', '--force');
  node('pipelines/poi/src/geocode/osm-roads.mjs', '--fixture');
  for (const s of ['admin', 'streets', 'alleys', 'anchors']) node(`pipelines/poi/src/geocode/${s}.mjs`);
  node('pipelines/poi/src/export-tiles.mjs', '--release', 'poi-fixture');
  node('pipelines/poi/src/report.mjs');
});
afterAll(() => sql.end());

describe('pipeline POI trọn vòng trên fixture', () => {
  it('số poi hợp lý cho Quận 1 (3.000–20.000), ≥ 90 % active có category không phải other', async () => {
    const [s] = await sql`SELECT count(*)::int AS n, count(*) FILTER (WHERE status = 'active')::int AS active,
        count(*) FILTER (WHERE status = 'active' AND category <> 'other' AND category NOT LIKE '%\\_other')::int AS good FROM poi`;
    expect(s.n).toBeGreaterThanOrEqual(3000);
    expect(s.n).toBeLessThanOrEqual(20000);
    expect(s.good / s.active).toBeGreaterThan(0.9);
  });
  it('poi-fixture.pmtiles sinh ra, ≤ 20 MB, zoom 10–16, layer poi, qua QA chủ quyền', () => {
    const file = resolve(OUT, 'poi-fixture.pmtiles');
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).size).toBeLessThan(20 * 2 ** 20);
    const info = JSON.parse(node('pipelines/tiles/src/inspect.mjs', file));
    expect(info.zoom).toEqual([10, 16]);
    expect(info.layers).toEqual(['poi']);
    expect(() => node('pipelines/tiles/src/qa.mjs', file, '--skip-islands')).not.toThrow();
  });
  it('báo cáo ghi ra out/poi-report-*.json với các khối poi/links/geocode', () => {
    const files = execFileSync('sh', ['-c', `ls ${OUT}/poi-report-*.json | tail -1`], { encoding: 'utf8' }).trim();
    const report = JSON.parse(execFileSync('cat', [files], { encoding: 'utf8' }));
    expect(report.poi.total).toBeGreaterThan(0);
    expect(report.links.links).toBeGreaterThan(0);
    expect(report.geocode.streets).toBeGreaterThan(0);
  });
});
```

Run: `PIPE pipeline pnpm test:db`
Expected: toàn bộ dbtest xanh (10–15 phút).

- [ ] **Step 5b: `pnpm db:fixture` — nạp kho POI Quận 1 vào DB dev một lệnh (spec 3.4 "nạp fixture Quận 1", nền cho test API ở M3)**

`scripts/db-fixture.mjs`:
```js
#!/usr/bin/env node
// Nạp fixture Quận 1 vào Postgres dev: ingest 3 nguồn → taxonomy → gộp → geocode → poi-fixture.pmtiles. Chạy trong image pipeline (compose dev).
import { run } from './lib/run.mjs';

const compose = ['compose', '--env-file', '.env', '-f', 'infra/dev/compose.yml', '--profile', 'pipeline'];
if (process.env.MAPSLIBVN_IN_CONTAINER !== '1') {
  run('docker', [...compose, 'run', '--rm', 'pipeline', 'node', 'scripts/db-fixture.mjs']);
  process.exit(0);
}
const steps = [
  ['scripts/db-migrate.mjs'],
  ['pipelines/poi/src/ingest/osm.mjs', '--fixture'],
  ['pipelines/poi/src/ingest/overture.mjs', '--fixture'],
  ['pipelines/poi/src/ingest/fsq.mjs', '--fixture'],
  ['pipelines/poi/src/taxonomy.mjs', 'load'],
  ['pipelines/poi/src/records.mjs'],
  ['pipelines/poi/src/conflate.mjs'],
  ['pipelines/poi/src/publish.mjs', '--force'],
  ['pipelines/poi/src/geocode/osm-roads.mjs', '--fixture'],
  ['pipelines/poi/src/geocode/admin.mjs'],
  ['pipelines/poi/src/geocode/streets.mjs'],
  ['pipelines/poi/src/geocode/alleys.mjs'],
  ['pipelines/poi/src/geocode/anchors.mjs'],
  ['pipelines/poi/src/export-tiles.mjs', '--release', 'poi-fixture'],
  ['pipelines/poi/src/report.mjs'],
];
const t0 = Date.now();
for (const args of steps) run(process.execPath, args);
console.log(`✔ Fixture Quận 1 đã nạp sau ${Math.round((Date.now() - t0) / 1000)}s. Xem out/poi-report-*.json`);
```

Thêm vào `package.json` scripts: `"db:fixture": "node scripts/db-fixture.mjs"`. Trong `scripts/setup.mjs`, đoạn in "Tiếp theo" thêm dòng `  pnpm db:fixture   # nạp kho POI Quận 1 (~3 phút, cần image pipeline)`.

Run: `pnpm db:fixture`
Expected: 15 bước chạy lần lượt, `✔ Fixture Quận 1 đã nạp sau N s` với N ≤ 300 (spec 3.4: ~3 phút).

- [ ] **Step 6: Chạy `data:update` thật trên máy chủ (nghiệm thu "chạy trọn trên máy nội bộ")**

Trên máy chủ (hoặc từ máy dev qua Tunnel khi đã điền `DB_TUNNEL_HOSTNAME`/`PIPELINE_DATABASE_URL`):
Run: `docker compose --env-file infra/server/.env -f infra/server/compose.yml exec pipeline node scripts/data-update.mjs --poi --force`
Expected (1,5–3 giờ lần đầu): ingest 3 nguồn → gộp → geocode → `✓ /app/out/poi-YYYYMMDD.pmtiles: N POI, X MB` (X ≤ 300) → QA ✓ → upload → `✓ smoke … tile` → `✓ manifest {"vn":…,"poi":"poi-YYYYMMDD"}` → báo cáo → `✓ data:update xong`.

Run: `pnpm data:update --dry-run`
Expected: `Kế hoạch: {"tiles":false,"poi":false,"reasons":[]}` — idempotent với state 3 nguồn.

Run: `curl -s https://mapslibvn-api-production.<account>.workers.dev/v1/styles/light.json | grep -o 'poi-[0-9]*\.pmtiles'`
Expected: `poi-YYYYMMDD.pmtiles`.

Mở `https://mapslibvn-docs.pages.dev/playground?api=https://mapslibvn-api-production.dotienphong1993.workers.dev` (Cloudflare Pages bỏ đuôi `.html`): z10–11 chỉ hiện trường/bệnh viện/bến xe/UBND chất lượng cao; z13+ hiện tên; bấm một POI → dòng trạng thái hiện `Tên · loại (nhóm)` (nghiệm thu "bấm POI thấy tên/loại từ tile").

- [ ] **Step 7: Nghiệm thu M2 (spec 13/M2 + roadmap mục 3) — ghi kết quả thật vào DEVLOG mục 4**

1. Máy nội bộ chạy Postgres nhận kết nối TLS qua Tunnel từ Worker: `curl <worker>/healthz/db` → `{"ok":true,"user":"api"}` ✓ (Task 1).
2. `data:update` chạy trọn trên máy nội bộ: thời gian … phút; log cron kế tiếp thứ Hai 02:00 (`docker compose … logs pipeline | tail -1`).
3. `SELECT count(*) FROM poi WHERE status='active'` ≥ 1.500.000: … .
4. POI hiện theo zoom trên playground; bấm POI thấy tên/loại ✓ (ảnh chụp lưu `docs/assets/m2-playground-poi.png` — tuỳ chọn).
5. Báo cáo gộp: `out/poi-report-*.json` (đa nguồn … %, other … %, anchors …, Nguyễn Lâm ≥ 15).
6. `pnpm db:restore --latest` trên máy dev phục hồi được: … phút, `count(poi)` = … .
7. `pnpm test`, `PIPE pipeline pnpm test:db`, E2E docs, CI (job test + dbtest + image) xanh.
8. Việc tay còn lại ghi rõ: bảng đối chiếu phường/xã 2025 (`admin_alias`), quyết định spec 4.2 nếu M1 để lại, Windows `pnpm run setup` nếu chưa.

- [ ] **Step 8: Chuyển mốc**

`docs/DEVLOG.md` mục 1: "Mốc: M3 — Places API"; "Plan: (viết plan cấp bước bằng skill writing-plans theo roadmap mục 4 — chưa có file)"; "Task đang làm: viết plan M3"; mục 2: "Viết `docs/superpowers/plans/YYYY-MM-DD-m3-places-api.md` từ roadmap mục 4 (2 fixture bắt buộc: 'Trường Tiểu học Hoàng Diệu', '88/9 Nguyễn Lâm')"; mục 4 dòng nghiệm thu M2.

Tick toàn bộ checkbox trong plan này.

```bash
git add -A
git commit -m "docs: nghiệm thu M2 (kho POI + máy chủ nội bộ), chuyển sang M3"
git push
```

---

## Ghi chú thực thi

- **Thứ tự bắt buộc** trong mỗi lần `data:update --poi`: ingest → taxonomy load → records → conflate → publish → osm-roads → admin → streets → alleys → anchors → export-tiles → qa → upload → smoke → manifest → report. `anchors.mjs` đọc `poi_work_record` (do `records.mjs` tạo) và `admin_area` (do `admin.mjs` phát hành).
- **Bảng làm việc** (`vn_boundary`, `poi_work_*`, `osm_road_raw`, `osm_admin_raw`) do pipeline tạo lúc chạy, không nằm trong migration; role `pipeline` có `CREATE` trên schema public (0002). Có thể `DROP` an toàn.
- **Tài nguyên**: máy chủ 8 GB RAM đủ (DuckDB 3 GB, Node 4 GB heap, Postgres shared_buffers 2 GB) nhưng không chạy song song tiles và POI — `data-update.mjs` chạy tuần tự. Nếu OOM ở `conflate.mjs`: giảm `NODE_OPTIONS=--max-old-space-size=3072` và thay `sourceIds` (mảng chuỗi) bằng truy vấn `source_id` theo `primary_rid` lúc ghi meta.
- **M4 sẽ sửa** `publish.mjs`: loại trừ `locked_fields` khi UPDATE và không re-point `poi_source_link` đang trỏ tới POI `created_by='user'`; `admin.mjs`/`anchors.mjs` thêm nguồn `user` (confidence 0,95).
- **Lint**: Biome `lineWidth: 100`; mã trong plan dài hơn — trước mỗi `pnpm lint` chạy `pnpm exec biome check --write <thư mục vừa sửa>` (đây là bước đã lặp lại ở mọi task M1c).
- **Foursquare qua Hugging Face**: `HF_TOKEN` ở ba nơi — `.env` máy dev, `infra/server/.env`, secret Actions. Token là Read-only; nếu Foursquare đổi điều khoản gated hoặc token hết hạn, `detectSources` dừng có thông điệp rõ; khi đó `data:update --tiles` vẫn chạy (không cần FSQ). Điều khoản gated cần được PHONG đọc lại một lần về quyền phân phối lại dữ liệu đã gộp (ghi `docs/legal/` ở M5).
- **Danh sách file bổ sung** so với mục "Cấu trúc file" ở đầu plan: `pipelines/poi/tests/{geometry,osmium-id,export-tiles}.test.mjs`, `pipelines/poi/src/lib/{geometry,osmium-id}.mjs`, `scripts/db-fixture.mjs`, `.github/workflows/dbtest.yml`.
- **dbtest chạy lại ingest fixture trong từng file** (ingest / conflate / geocode / pipeline-fixture đều tự ingest ở `beforeAll`) — cố ý để mỗi file độc lập; tổng 10–15 phút. Nếu quá chậm, gom vào một `globalSetup` của `vitest.db.config.ts`.
