# DEVLOG — MapsLibVN

Đọc file này trước khi làm bất cứ việc gì. Cập nhật ở bước cuối của MỌI task (cùng
commit với code).

## 1. Trạng thái hiện tại

- Mốc: **M4 — Đóng góp (bắt đầu 01/09/2026)**; M3 — Places API đã nghiệm thu 01/09/2026
- Plan: `docs/superpowers/plans/2026-09-01-m4-dong-gop.md` — **11 task** (viết 01/09/2026,
  đã tự review 1 lượt: sửa test consensus, REVOKE PUBLIC cho hàm SECURITY DEFINER,
  ép `id::int` cho bigserial qua porsager, cwd Playwright). 10 quyết định thiết kế ghi
  trong plan — chốt vào mục 3 khi nghiệm thu Task 11
- Task đang làm: **Task 1–10 XONG 01/09/2026** (migration `0006` + 3 hàm SECURITY DEFINER;
  `apps/api/src/edits/*`; `POST /v1/edits`; POI pending cho tenant tạo; Access JWT +
  `/v1/admin/*`; Access giả lập + itest 22/22; `apps/admin` SPA tại `/admin` + E2E 3/3;
  pipeline tôn trọng `locked_fields` + giữ anchor người dùng; `suggestEdit` + docs "Đóng góp")
  → còn **Task 11 — nghiệm thu**, CHẶN bởi việc tay của PHONG trên Cloudflare
- Mốc trước: **M2 — Kho POI + máy chủ nội bộ đã nghiệm thu 31/08/2026**, 11/11 task; plan
  `docs/superpowers/plans/2026-08-27-m2-kho-poi-may-chu.md` đã tick trọn, kết quả ở mục 7
- Commit code cuối: M3 Task 11 `6eb4ade`; Task 10 `ece8d1e`; Task 9 `9c61812`.
  Remote trên `6eb4ade`: CI, Deploy API và API DB test xanh; DB tests chạy riêng
- Môi trường đã dựng: máy dev macOS; remote GitHub cá nhân; Postgres/PostGIS dev,
  migration `0001_extensions.sql`; `pnpm run setup` sạch đạt 6,51 giây; image
  pipeline local đã build/smoke trên arm64 và chạy được qua Compose; Dev Container
  đã dựng thành công và chạy đủ 20 test trong Linux container; CI GitHub xanh
  trên amd64 và image đã được push lên GHCR; R2 bucket `mapslibvn-tiles` (APAC),
  custom domain `tiles.ai-solutions.io.vn` (SSL active), CORS, KV
  `mapslibvn-META` và Cache Rule đã cấu hình; tiles `vn-20260827` đã publish,
  smoke 20/20 qua custom domain và manifest KV đã active; M1a/M1b đã nghiệm thu
  trên macOS arm64; Worker `mapslibvn-api-production.dotienphong1993.workers.dev`
  và docs `mapslibvn-docs.pages.dev` đã chạy production; repo GitHub chuyển **private**
  với 8 secret Actions; **M1 (M1a+M1b+M1c) đã nghiệm thu 27/08/2026**;
  **máy chủ nội bộ (compose `mapslibvn-server`) đã chạy đủ 4 dịch vụ trên chính máy dev
  (G3 — máy chủ tạm)**: `postgres` PostGIS TLS bắt buộc (không mở `ports:`), `cloudflared`
  (tunnel `mapslibvn-db`, 4 kết nối edge Singapore), `backup` daemon 03:00 VN → R2,
  `pipeline` cron thứ Hai 02:00 VN; Tunnel `maps-db.ai-solutions.io.vn` + Access application
  `mapslibvn-db` (policy Service Auth, token `hyperdrive`) + Hyperdrive
  `71d7a62b89e9462e91bb0094af1f750f` đã hoạt động — Worker `/healthz/db` qua
  `wrangler dev --remote` trả `{"ok":true,"user":"api","version":"PostgreSQL 16.4"}`;
  POI live `poi-20260830` đã publish vào manifest production;
  **PENDING Windows** (chờ PHONG có máy để kiểm)

## 2. Bước kế tiếp

**BẮT ĐẦU TỪ ĐÂY: chỉ còn Task 11 — nghiệm thu M4. ĐANG CHỜ VIỆC TAY CỦA PHONG:**

1. Gắn **custom domain** cho Worker `mapslibvn-api` production (vd `api.ai-solutions.io.vn`) —
   Cloudflare Access không bảo vệ được `*.workers.dev`. Nếu thêm mới thì cập nhật hằng API
   production trong `apps/docs/public/playground.html`.
2. Zero Trust → Access → Applications → **Add self-hosted**: domain `api.<zone>`, path `admin`,
   thêm đường dẫn thứ hai `v1/admin` trong cùng application. Policy Allow → email PHONG, session 24 h.
3. Đưa lại **AUD tag** + **team domain** (`<team>.cloudflareaccess.com`).

Có 2 giá trị đó thì chạy Task 11 (`docs/superpowers/plans/2026-09-01-m4-dong-gop.md`, 5 step):
điền vars `ACCESS_*` vào `[env.production]` của `apps/api/wrangler.toml` → chạy toàn bộ gate local
→ `pnpm db:seed-tenant` trên DB production + smoke `POST /v1/edits` sửa giờ mở cửa → mở
`https://api.<zone>/admin/` duyệt một POI thật → chốt DEVLOG mục 1–4 + tick roadmap mục 7.

**Trước khi làm Task 3/4 (cần DB thật):** nếu vừa chạy `pnpm test:db` thì dev DB đã bị
`schema.dbtest.mjs` down/up làm sạch — chạy lại `pnpm db:migrate && pnpm db:seed-tenant`
(và `pnpm db:fixture` nếu cần POI) trước.

**M4 Task 10 xong 01/09/2026.** `packages/core`: thêm `suggestEdit` (client giờ có 9 phương thức)
cùng types `EditKind`/`EditChanges`/`SuggestEditRequest`/`SuggestEditResponse`; tách `parseOrThrow`
dùng chung cho `get`/`post` nên bỏ được khối đọc lỗi trùng lặp. Bundle core 6,54 kB gzip (budget 8).
Trang docs `dong-gop.md` (bảng 5 `kind`, danh sách trường `changes` hợp lệ, luật duyệt, giới hạn
20/ngày/end-user + 500/ngày/key, ví dụ bắt `MapsLibVNError`) và thêm vào sidebar. 4 test mới —
có ca `create` và ca body lỗi không phải JSON mà trước đây chưa test nhánh `catch` của `parseOrThrow`.
Gate: core 327 test, root 490/490, api 87/87, docs build 5 trang, lint 225 file.

**M4 Task 9 xong 01/09/2026.** `publish.mjs` giờ dùng `CASE WHEN '<cột>' = ANY(p.locked_fields)`
cho 11 cột của `poi` nên pipeline không ghi đè trường người dùng đã sửa, và không đóng POI có
`'status'` trong `locked_fields` khi POI vắng mặt ở nguồn. `anchors.mjs` chép mốc `source='user'`
(confidence 0,95) sang `address_anchor_new` trước khi hoán đổi bảng — đặt sau bước gán
ward/province để giữ giá trị người dùng. `pipelines/poi/tests/edit-lock.dbtest.mjs` 3/3.
Hai điều khác plan: fixture `poi_work_record` phải có thêm cột `confidence` (publish.mjs dùng khi
dựng lại `poi_source_link`), và tôi thêm một test cho nhánh `status` bị khoá mà plan chưa có.
`pnpm test:db`: 38 passed / 3 skipped; `pipeline-fixture` vẫn đỏ trên máy dev vì thiếu
`tippecanoe` (chạy trong image GHCR trên CI).

**M4 Task 7 + 8 xong 01/09/2026.** `apps/admin` là SPA Vite + React 18 (`base:'/admin/'`,
`outDir dist/admin`, 146 kB / 47 kB gzip): danh sách edit theo `status`, nút Duyệt/Từ chối, báo
lỗi HTTP ra UI. Worker phục vụ nó qua `[assets] directory = "../admin/dist"` trong `wrangler.toml`
(cả `[env.production]`) — đã kiểm thật là assets **không che** `/healthz`, `/v1/*` hay 404-JSON.
`deploy-api.yml` + script `test` gốc + `api-db-test.mjs` đều build admin trước; `apitest.yml` chạy
thêm `pnpm test:admin-e2e`. E2E Playwright 3/3 với Access giả lập: bấm Duyệt trên trang thật →
POI `active` qua API; bấm Từ chối → POI 404; không JWT → 401. **Ba lỗi thật đã sửa:**
`test.use({extraHTTPHeaders})` không áp cho `fetch()` của trang (phải `page.setExtraHTTPHeaders`);
`access-fake.mjs` đọc `.cache/` theo cwd nên Playwright sinh cặp khoá thứ hai và JWT sai chữ ký
(sửa: đường dẫn tuyệt đối từ `import.meta.url`); `webServer` thiếu `gracefulShutdown` nên
Playwright treo sau khi test đã xanh. Gate: root 486/486, api 87/87, api-db 22/22, E2E 3/3,
typecheck 13 task, lint 223 file.

**M4 Task 5 + 6 xong 01/09/2026.** `apps/api/src/access.ts` verify JWT Cloudflare Access
(RS256 bằng WebCrypto, JWKS từ `${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs` cache KV 1 giờ, kiểm
`aud` + `exp` + `email`), mã lỗi mới `missing_access_jwt`/`invalid_access_jwt`.
`apps/api/src/routes/admin.ts`: `GET /v1/admin/edits?status=`, `POST /v1/admin/edits/{id}/approve`
và `/reject` — reviewer lấy từ email trong JWT. Vars mới `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD`
(+`ACCESS_CERTS_URL` chỉ để test). `scripts/lib/access-fake.mjs` sinh cặp RSA lưu `.cache/`
(gitignored), phục vụ JWKS và ký JWT cho itest/E2E; `api-db-test.mjs` chạy nó và thêm mode
`--serve` cho Playwright ở Task 8. **Lỗi kiến trúc test đã sửa:** JWKS server ban đầu nằm cùng
tiến trình harness, mà harness gọi vitest bằng `spawnSync` (chặn event loop) → 4 test admin
timeout 30 s dù Worker đúng (curl trả 401 trong 3 ms). Phải cho access-fake chạy **tiến trình
riêng**. Gate: api 19 file/87 test, `pnpm test:api-db` 3 file/22 test, root 486/486, lint 217 file.

**M4 Task 4 xong 01/09/2026.** `GET /v1/places/{id}` thêm nhánh POI `status='pending'`: chỉ hiện
cho tenant đã gửi edit `kind=create` (spec 6.5), truy vấn thẳng không cache vì phụ thuộc tenant;
nhánh này chỉ chạy khi nhánh cache trả 404 và `cachedJson` không cache lỗi < 500 nên cache không
bị đầu độc. `apps/api/test-db/edits.itest.mjs` (6 test, DB thật): internal sửa hours →
`auto_approved` và thấy ngay qua API; tenant free tạo POI → `pending`, chỉ tenant tạo thấy, không
lộ qua `/v1/search`, duyệt bằng `apply_poi_edit` → `active`; free sửa name → `pending`; đồng thuận
2 end-user → phiếu thứ hai `auto_approved` kéo phiếu đầu thành `auto:consensus`; 21 edit/ngày →
429; POI closed thì `update` → 400 còn `reopen` → `active`. Hai điều khác plan: khoá seed
`mlv_live_edit0…` trong plan thiếu 1 ký tự (CHECK đòi đúng 24 sau prefix) và test scope 403 trong
itest bị bỏ vì KV cache auth 5 phút làm nó không dứt khoát (đã phủ ở tầng workers).
Gate: `pnpm test:api-db` 18/18, api 79/79, root 486/486, typecheck sạch, lint 212 file.

**M4 Task 3 xong 01/09/2026.** `POST /v1/edits` (`apps/api/src/routes/edits.ts`):
`requireAuth('edits:write')` — `requireAuth` giờ nhận tham số scope, mặc định `places:read` nên
6 route M3 không đổi; kiểm POI đích tồn tại/đúng trạng thái, `category` phải có thật, đếm giới
hạn 20/ngày/end-user + 500/ngày/key bằng SQL theo ngày VN, đếm phiếu trùng 30 ngày, INSERT
`poi_edit`, `stage_poi_create` cho `kind=create`, và gọi `apply_poi_edit` ngay khi
`decideStatus` ra `auto_approved` (reviewer `auto:internal`/`auto:consensus`/`auto:rule`).
Khoá seed nội bộ được cấp `edits:write` (kèm UPDATE cho hàng cũ vì INSERT có DO NOTHING).
**Một lỗi thật chỉ smoke test bắt được:** `JSON.stringify(changes)` + cast `::jsonb` khiến
porsager stringify lần nữa → DB nhận jsonb *string*, `apply_poi_edit` vỡ ở `jsonb_object_keys`
(503). Phải dùng `sql.json(changes)` cho cả INSERT lẫn so sánh phiếu trùng; `ValidatedEdit.changes`
đổi sang kiểu JSON-safe `EditChanges`. Đã smoke test thật qua `wrangler dev` + dev DB: update
hours → `auto_approved` và POI đổi ngay; create → POI `active`, `created_by=user`, anchor `user`
confidence 0,95; POI lạ 404; category lạ 400. API test 18 file/79 test.

**M4 Task 2 xong 01/09/2026.** `apps/api/src/edits/`: `hash.ts` (`endUserHash` =
sha256(tenant+token), `ipHash` = sha256(ip+ngày VN) — không lưu token/IP thô), `ulid.ts` (ULID
Crockford cho POI người dùng tạo), `rules.ts` (`decideStatus` + hằng số 20/ngày/end-user,
500/ngày/key, `AUTO_UPDATE_FIELDS=[hours,contact]`, quality ≥ 60, đồng thuận 2 người),
`validate.ts` (whitelist `changes`, bbox VN, `hours` chuỗi → `{osm}`, dẫn xuất `*_norm` bằng
`normalizeVi` để hàm SQL 0006 áp dụng được thuần SQL). Thêm `vnDayStartUtc` vào `quota.ts`.
API test **17 file / 73 test** (trước 15/59), root 486/486, typecheck 12/12, lint sạch.
Task 2 khớp plan hoàn toàn, không có quyết định phát sinh.

**M4 Task 1 xong 01/09/2026.** `db/migrations/0006_edits.sql`: cột `api_key` + `new_poi_id`
cho `poi_edit`, 3 index đếm theo ngày, và 3 hàm `SECURITY DEFINER` owner `pipeline` —
`stage_poi_create` (tạo POI `pending` cho `kind='create'`), `apply_poi_edit` (cập nhật `poi`
theo `changes`, khoá trường vào `locked_fields`, tạo `address_anchor` `source='user'`
confidence 0,95, duyệt kèm phiếu trùng với reviewer `auto:consensus`), `reject_poi_edit`.
User `api` **không** có UPDATE/INSERT trên `poi` — chỉ EXECUTE 3 hàm (spec mục 9).
Ba điều khác plan đã xử lý và ghi ở cuối Task 1 trong plan: (1) `poi_edit.tenant_id` có FK
tới `tenant` nên test phải seed tenant trước; (2) `scripts/lib/db-permissions.mjs` phải giữ
owner/grant của 3 hàm, nếu không thì sau `db:restore` hàm rơi về superuser; (3)
`db/schema.dbtest.mjs` hardcode 4 lần `--down`, sửa thành 5.

**M3 Task 12 xong 01/09/2026 — M3 nghiệm thu ĐẠT.** Kết quả đầy đủ ở mục 8. Perf
production có ba lần cache-hit liên tiếp p95 177/192/168 ms từ máy dev tại Việt Nam;
fixture API DB, production Places API, quota 429 local và React demo production đều đạt.
Lưu ý thật: cold/cache warm-up từng tạo p95 2,5–3,2 giây; lần cuối vẫn có một cold miss
3.317 ms nhưng p95 168 ms. Theo dõi p99/cold miss ở M4, không xem đây là số p95 ổn định
cho traffic hoàn toàn lạnh.

**M3 Task 11 xong 01/09/2026.** Thêm quota KV cho cả 6 Places route, chặn ở 2× quota,
bỏ qua hoàn toàn tenant `internal`; Analytics Engine ghi tenant/key/path/status/ms và là
binding optional. TDD RED→GREEN; API 15 file/59 test, typecheck và Biome sạch. Nghiệm
runtime local với tenant free quota 25: 50 request đầu trả 200, request thứ 51 trả 429
`quota_exceeded`, `Retry-After: 3600`. Production vẫn để `QUOTA_ENABLED="0"`.

**M3 Task 9–10 xong 01/09/2026.** Task 9 thêm custom element
`<mapslibvn-autocomplete>` có debounce 200 ms, ARIA combobox/listbox/status, điều hướng bàn
phím, chống response cũ và playground/E2E thật. Sửa luôn lỗi runtime Hyperdrive trả mảng
Postgres dạng chuỗi (kể cả KV cache), nên auth origin production hoạt động đúng. Build web:
ESM 4,07 kB gzip, UMD 298,69 kB gzip; E2E playground 3/3. Task 10 thêm
`@mapslibvn/react` (`MapsLibVNMap`, `Marker`, `useMap`, `usePlaces`), 5 test hook và demo docs
responsive. Đã kiểm trên browser desktop/mobile: tìm được 10 Highlands, chọn kết quả tạo đúng
1 marker và fly-to; mobile 390×844 không tràn ngang. Local: typecheck 12/12 package, root
480/480 test, API 54/54, lint 194 file. Remote tại `ece8d1e`: CI `33463393201`, Deploy Docs
`33463393179`, Deploy API `33463393248`, API DB test `33463393195` — tất cả success.

**M3 Task 1 xong 31/08/2026** — `db/seed/tenant_internal.sql` + `scripts/db-seed-tenant.mjs` +
script gốc `pnpm db:seed-tenant`. Chạy 2 lần đều `api_key active: 2` (idempotent qua
`ON CONFLICT DO NOTHING`). DB dev hiện có 2 khoá tenant `internal`:
`mlv_live_demo00000000000000000000` (kind `web`, 4 origin: `http://localhost`,
`http://127.0.0.1`, `https://mapslibvn-docs.pages.dev`, `https://*.mapslibvn-docs.pages.dev`)
và `mlv_live_server000000000000000000` (kind `server`, không kiểm origin — dùng cho curl/test).
Cả hai `scopes={places:read}`, `active=t`, `revoked_at=NULL`. **Chưa seed lên DB máy chủ**
(cần mở tunnel `cloudflared access tcp` rồi chạy với `DATABASE_URL` qua tunnel — làm ở Task 12).

**Đã xong 31/08:** 5 Actions secret cho workflow `Data update` (`HF_TOKEN`,
`DB_TUNNEL_HOSTNAME`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`,
`PIPELINE_DATABASE_URL`) đã đặt — repo có 13 secret. Giá trị trong `.env` có dấu ngoặc bao,
phải bóc trước khi `gh secret set` nếu đặt lại. Workflow `Data update --dry-run` từ Actions
xanh 2/2 lần (run `33364362147` 62 giây, run `33364404492` 41 giây): image GHCR pull được,
state R2 đọc được, dò đúng OSM `c256eec…` · Overture `2026-08-19.0` · FSQ `2026-08-11` —
FSQ là dataset gated nên **`HF_TOKEN` trên Actions đã được chứng minh dùng được**.

**Chưa xác nhận (không chặn M3):** `DB_TUNNEL_HOSTNAME`, `CF_ACCESS_CLIENT_ID`,
`CF_ACCESS_CLIENT_SECRET`, `PIPELINE_DATABASE_URL` chỉ mới *có mặt*, chưa chạy thật.
`--dry-run` dừng ở `update-plan` (`missingLiveEnv` trả `[]` khi dry-run, và `LIVE_ENV`
không chứa 4 biến này); Tunnel chỉ mở ngay trước nhánh POI trong `data-update.mjs`. Muốn
kiểm đường `cloudflared access tcp` từ runner GitHub tới Postgres máy nội bộ thì phải chạy
`--poi` thật trên Actions (60–180 phút, mà quota private Free chỉ 2.000 phút/tháng). Cron
máy nội bộ vẫn chạy thứ Hai 02:00 VN nên đường Actions chỉ là dự phòng.

**Lưu ý vận hành máy dev:** đĩa đã đầy 97 % ngày 27/08 (`~/.cache/uv` 124 GB + JSONL Overture không nén);
đã dọn còn 44 GiB trống. Trước các bước nặng (Task 7 gộp, Task 10 `data:update`), kiểm `df -h /`.

**Việc tay vận hành:** nên chốt hẳn việc không ngủ máy: `caffeinate` đang giữ máy thức nhưng cài đặt gốc
vẫn là `sleep 1` phút — `sudo pmset -a sleep 0 disksleep 0`.

**Việc tay còn lại của M2 Task 8:** biên soạn bảng alias phường/xã trước→sau sắp xếp
2025 từ các nghị quyết UBTVQH; bổ sung relation level 4 Khánh Hòa vào nguồn OSM/override
đã duyệt để nạp được alias Ninh Thuận.

**Việc còn treo từ M1 (không chặn M2):**
- Nghiệm thu `pnpm run setup` trên **Windows** — chờ PHONG có máy.
- QA `requireIslands` cho Hoàng Sa đang tắt (chỉ cảnh báo): extract `vietnam.poly` của
  Geofabrik không phủ Hoàng Sa và chỉ phủ Trường Sa tới 114,6°E. Nhãn chủ quyền hiện do
  lớp `sovereignty` của style bảo đảm và đã kiểm chứng hiện thật ở z4. Cần PHONG chốt
  nguồn extract OSM bổ sung rồi bật lại.
- Tiles còn dùng `tiles.ai-solutions.io.vn`; khi có domain riêng, **nhớ mang theo cặp
  Cache Rule** ở SC-1.

## 3. Quyết định phát sinh

| Ngày | Quyết định | Lý do | Commit |
|---|---|---|---|
| 2026-09-01 | M4: ghi `poi` qua 3 hàm SQL `SECURITY DEFINER` owner `pipeline`, `api` chỉ EXECUTE | Giữ đúng spec 9 "Worker chỉ đọc + ghi `poi_edit`" ở tầng GRANT thay vì tin vào code Worker | (commit này) |
| 2026-09-01 | M4: `db-permissions.mjs` giữ owner/grant của 3 hàm 0006 | `pg_restore --no-owner --no-privileges` làm hàm rơi về superuser → Worker sẽ ghi `poi` với quyền superuser | (commit này) |
| 2026-09-01 | M4: `apps/admin` là Vite+React SPA do Worker phục vụ tại `/admin` (không phải Next.js trên Pages như spec 3.1) | Cùng origin với `/v1/admin/*` nên chỉ cần một Access application, JWT tự chảy, không CORS credentials, không thêm Pages project | (commit này) |
| 2026-09-01 | M4: xác thực admin bằng verify JWT `Cf-Access-Jwt-Assertion` (RS256, JWKS cache KV 1 giờ) | Không tin header do proxy chèn mà kiểm chữ ký + `aud` + `exp`; giả lập được trong itest/E2E bằng JWKS server riêng | (commit này) |
| 2026-09-01 | M4: mọi jsonb gửi từ Worker phải qua `sql.json()`, không `JSON.stringify` + `::jsonb` | porsager stringify lần nữa khi thấy cast → ghi jsonb *string*, hàm SQL vỡ ở `jsonb_object_keys`; tầng test workers không có DB nên không bắt được | (commit này) |
| 2026-09-01 | M4: `poi_edit` thêm cột `api_key` + `new_poi_id`; giới hạn edit đếm bằng SQL, không KV | `api_key` cần cho hạn 500/ngày/key và audit; `new_poi_id` vì `poi_id` có FK nên chỉ gán được sau khi stage POI. Đếm SQL chính xác và không tốn write KV (Workers Free 1.000 ghi/ngày) | (commit này) |
| 2026-08-26 | Lint/format dùng Biome thay ESLint+Prettier | Một công cụ, nhanh, không cấu hình rườm rà | `9cff9a8` |
| 2026-08-26 | Typecheck gốc kiểm thêm `vitest.config.ts` | TypeScript 5.9 trả TS18003 khi `scripts/` chưa tồn tại | `9cff9a8` |
| 2026-08-26 | Spec bản 2 đã được PHONG review | Trạng thái thiết kế đã được chủ dự án xác nhận | `cb98a09` |
| 2026-08-26 | Repo GitHub dùng slug `maps-library-vietnam`, tên sản phẩm vẫn là MapsLibVN | PHONG đã tạo repo và cung cấp URL chính thức | `e7f16d4` |
| 2026-08-26 | PostGIS dev chạy image `postgis/postgis:16-3.4` amd64 qua giả lập trên Mac arm64 | Tag đã chốt trong spec/plan chưa có manifest arm64; health và migration vẫn đạt | `d4186f3` |
| 2026-08-26 | Lệnh setup công khai là `pnpm run setup`, không phải `pnpm setup` | `pnpm setup` là built-in của pnpm 9.15 và không dispatch package script | `cc16199` |
| 2026-08-26 | Setup chỉ migrate khi PID 1 trong container là `postgres` và `pg_isready` đạt | PostGIS entrypoint chạy server tạm rồi restart; chỉ `pg_isready` gây ECONNRESET | `cc16199` |
| 2026-08-26 | Image pin Planetiler 0.10.2, tippecanoe 2.62.5, DuckDB 1.5.3, pyosmium 4.0.2, Node 22 và pnpm 9.15.0 | Các release/asset đã được build và smoke thật trên arm64; DuckDB 1.5.5 chưa có CLI asset | `67a7b99` |
| 2026-08-26 | Planetiler tải 8 HTTP range song song, cache từng part, kiểm tra đúng 93.278.824 byte và SHA-256 | GitHub release chỉ đạt khoảng 22 KB/s/kết nối; tải một luồng mất hơn một giờ và dễ mất tiến độ | `67a7b99` |
| 2026-08-27 | Override Dev Container dùng `../..` cho build context và bind mount | Đường dẫn Compose được resolve theo file đầu tiên ở `infra/dev`, không theo thư mục `.devcontainer` | `673f6fe` |
| 2026-08-27 | CI gọi chung `pnpm image:smoke` thay vì lặp lệnh kiểm tra tool trong YAML | Local và CI dùng cùng một hợp đồng smoke đã được kiểm chứng ở Task 6 | `469836a` |
| 2026-08-27 | `pnpm run setup` luôn cấu hình author cá nhân bằng `git config --local` trước khi kiểm | Clone sạch kế thừa email Bark từ Git global và không thể đạt setup; cấu hình local giữ global nguyên vẹn, hook vẫn chặn override sai | `4a7552c` |
| 2026-08-27 | Font vendor dùng asset `noto-sans.zip` của OpenMapTiles v2.0, không dùng `v2.0.zip` | `v2.0.zip` chỉ có Roboto; asset Noto riêng chứa đúng 3 stack cần phục vụ glyph | `1cfb4d2` |
| 2026-08-27 | Template style M1 chỉ dùng placeholder `TILES_BASE`/`VN_FILE` | `API_BASE`/`KEY` chỉ cần khi bổ sung POI details ở M2/M3 | `1cfb4d2` |
| 2026-08-27 | Dependency `pmtiles` được smoke từ workspace `pipelines/tiles`, không từ root `/app` | pnpm strict isolation chỉ expose dependency tại package khai báo nó | (Task M1b T3) |
| 2026-08-27 | Full build Planetiler bật `--compress-temp` | Temp mmap không nén tăng 7,9 GB và làm host chỉ còn 131 MiB; nén hoàn tất cùng archive 952 MiB và giữ host an toàn | (Task M1b T4) |
| 2026-08-27 | QA chỉ tính đối tượng có hình học giao bbox (giải mã `toGeoJSON`), không tính mọi feature trong tile giao bbox | Tile z4–z7 giao bbox trải tới đất liền và phần đệm nước láng giềng; công viên `花山` (Quảng Tây, 22°N) lọt vào tile z5/z6 của Hoàng Sa là dương tính giả | (Task M1b T5) |
| 2026-08-27 | Patch tầng 1 thêm vùng biển Đông `[102, 6, 117.8, 17.5]` với luật hẹp: `name` chữ CJK không có `name:vi` → xoá (có `name:vi` → thay), xoá `name:zh*`; tên Latin giữ nguyên; `Collector` dùng `locations=True` | Núi ngầm tên Trung Quốc ngay ngoài hai bbox (`镜台海山` 111,34°E 11,40°N, `流春海山` 111,62°E 12,36°N…) lọt vào tile z10 giao bbox Trường Sa; vùng dừng ở 17,5°N để không chạm Hải Nam và đệm biên giới bắc | (Task M1b T5) |
| 2026-08-27 | Test `lonLatToTile` kỳ vọng TP.HCM z10 = (815, 481) thay cho (815, 483) trong plan | Tính lại Web Mercator: ln(tan φ + sec φ)/π = 0,0602 → y = 481; plan gõ sai | (Task M1b T5) |
| 2026-08-27 | QA: kiểm "có đảo tên VI ở z8–10" cấu hình theo bbox (`requireIslands`); Hoàng Sa tạm **tắt, chỉ cảnh báo**; Trường Sa bắt buộc | Extract `vietnam.poly` của Geofabrik không phủ Hoàng Sa (6 node, 1 way) và chỉ phủ Trường Sa tới 114,6°E — không có đảo để kiểm; nhãn chủ quyền vẫn do lớp `sovereignty` (style) bảo đảm. **Việc còn lại:** merge thêm extract OSM cho bbox Hoàng Sa/Trường Sa đông (nguồn cần PHONG chốt) rồi bật lại `requireIslands` | (Task M1b T5) |
| 2026-08-27 | Thêm 4 MCP server Cloudflare vào `.mcp.json` (scope project): `cloudflare-api` (mcp.cloudflare.com — toàn bộ REST API qua search/execute), `cloudflare-bindings` (KV/R2/D1/Workers), `cloudflare-docs`, `cloudflare-observability` | Phần lớn "việc tay của PHONG" ở M1b T6 và M2 T1 (R2 bucket, custom domain, CORS, KV namespace, Cache Rule, Tunnel/Access/Hyperdrive) làm được qua API; scope project để không lẫn vào các repo khác. Xác thực OAuth qua `/mcp` — chỉ PHONG làm được. **Chưa chắc qua API:** khoá S3 của R2 API token và Workers API token có thể vẫn phải tạo trên dashboard | (sau M1b T5) |
| 2026-08-27 | Task 6 dùng preflight credentials trước khi build; `manifest.mjs get` dùng Wrangler 4 `--text`; `--poi` bị từ chối rõ ở M1 | Tránh build tốn thời gian rồi mới lỗi upload, tránh parse nhầm output nhị phân của KV, và không ghi OSM state khi pipeline POI chưa tồn tại | (Task M1b T6) |
| 2026-08-27 | Token R2 object-level bắt buộc `no_check_bucket=true`; image pin rclone 1.75.0 bằng SHA-256 cho arm64/amd64; rollback chạy lại trong pipeline container | Cloudflare yêu cầu bỏ bucket check cho token scoped; rclone 1.60.1-DEV của Ubuntu gây 501 cho từng object; chạy Wrangler trực tiếp trên host phụ thuộc DNS/quyền log | (Task M1b T6) |
| 2026-08-27 | Test Worker khai báo binding qua `apps/api/test/env.d.ts` (`interface ProvidedEnv extends Env`) | `cloudflare:test` không tự suy ra `META`/`TILES` từ `wrangler.toml`; không có file này `env.META` báo TS2339 | (Task M1c T1) |
| 2026-08-27 | Toạ độ kiểm tile Quận 1 z14 là `13048/7698`, không phải `13049/7752` như plan | Web Mercator cho 106,700°E 10,776°N: x = 13048, y = 7698; toạ độ trong plan trả 204 vì nằm ngoài fixture | (Task M1c T1) |
| 2026-08-27 | `fakeBucket` trong test R2Source phải cast `as unknown as Pick<R2Bucket, 'get'>` | `exactOptionalPropertyTypes: true` khiến overload `R2Bucket.get` (có `onlyIf`, `range: Headers \| R2Range`) không nhận stub hẹp | (Task M1c T1) |
| 2026-08-27 | Token Cloudflare mới `mapslibvn-deploy` (custom, 6 quyền: Workers Scripts Edit, Cloudflare Pages Edit, Workers KV Edit, Workers R2 Edit, Account Settings Read, User Details Read) thay token cũ chỉ có KV | Token cũ deploy Worker trả `Authentication error [code: 10000]`; template "Edit Cloudflare Workers" không kèm quyền Pages nên phải tạo custom | (Task M1c T1/T3) |
| 2026-08-27 | Tiles tạm giữ trên `tiles.ai-solutions.io.vn`, đổi sang domain riêng của MapsLibVN khi PHONG mua (dự kiến trước M5) | Tài khoản Cloudflare hiện chỉ có 1 zone; `TILES_BASE` đã tham số hoá nên chuyển domain chỉ tốn sửa `wrangler.toml` + `.env` + secret rồi redeploy. Tách domain là quyết định thương hiệu, độc lập với lỗi Range bên dưới | (Task M1c T3) |
| 2026-08-27 | Repo GitHub chuyển **private** đúng roadmap; `data-update.yml` bỏ `schedule`, chỉ còn `workflow_dispatch` | Repo private ở gói Free chỉ có 2.000 phút Actions/tháng, mà một lần `data:update` đủ tốn 60–180 phút; lịch định kỳ do máy nội bộ đảm nhận từ M2 | `058dafc` |
| 2026-08-27 | Đẩy secret bằng `printf '%s' "$v" \| gh secret set NAME` (stdin), **không dùng `--body -`** | `gh secret set --body -` không đọc stdin mà lưu đúng ký tự `-`; cả 8 secret nhận giá trị `-` khiến 3 workflow fail (`7003 No route for that URI`, `dial tcp: lookup -: no such host`). Dấu hiệu nhận biết: GitHub che **mọi** dấu `-` trong log thành `***` (`pnpm ***filter`, `maps***library***vietnam`) | (Task M1c T4) |
| 2026-08-27 | **Foursquare OS Places đọc qua Hugging Face** (`hf://datasets/foursquare/fsq-os-places/release/dt=…/places/parquet/`, gated, cần `HF_TOKEN` Read), không qua S3 | Bucket `fsq-os-places-us-east-1` chỉ còn LICENSE/NOTICE, `release/` trả `KeyCount 0`, file parquet cũ → 404; docs Foursquare: "now delivered through the Foursquare Places Portal … instead of the legacy public S3 bucket". PHONG chọn phương án HF thay vì bỏ FSQ hay dùng Places Portal/Iceberg | (review plan M2) |
| 2026-08-27 | **Máy dev là máy chủ nội bộ tạm** (G3); compose `mapslibvn-server` chạy song song compose dev; chuyển máy thật sau bằng `server:setup` + `db:restore --latest` + dán lại `TUNNEL_TOKEN` | PHONG chưa có máy 24/7; kiến trúc Docker-volume + backup R2 hằng ngày đã cho phép chuyển máy bằng ba lệnh — điều kiện: backup→restore phải được thử ngay ở Task 1 Step 8 | (review plan M2) |
| 2026-08-27 | Thứ tự thực thi M2: `0 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 1 → 10` (Task 1 sau Task 9) | Task 1 phụ thuộc việc tay Cloudflare + máy chủ; mọi task khác chạy trên Postgres dev. Commit binding Hyperdrive chỉ khi có ID thật vì `deploy-api.yml` tự deploy mỗi push chạm `apps/api/**` | (review plan M2) |
| 2026-08-27 | `pg_hba.conf` máy chủ: `hostssl all all all` + `hostnossl all all all reject`, không có dòng `samenet`; `databaseUrlFromEnv` thêm `?sslmode=require` khi `POSTGRES_SSL=require` | Plan cũ xếp `host … samenet` trước `hostssl` → cloudflared (cùng mạng compose) không bị buộc TLS, câu "sslmode=disable bị từ chối" trong README là sai; client `postgres` mặc định không TLS nên compose phải đặt `POSTGRES_SSL` | (review plan M2) |
| 2026-08-27 | `publishNew` chỉ `setval` khi bảng có cột `id` (kiểm `information_schema.columns`) | Đã chạy thật trên Postgres 16: `pg_get_serial_sequence('bảng_không_có_id','id')` **ném lỗi** `column "id" … does not exist`, không trả NULL như plan giả định → src_*, admin_alias sẽ fail ngay lần đầu | (review plan M2) |
| 2026-08-27 | `db:restore` phục hồi vào DB tạm `<db>_restore` (TEMPLATE template0) rồi `ALTER DATABASE … RENAME`, không `--clean` lên DB đang chạy | `spatial_ref_sys` là bảng cấu hình của extension PostGIS → dump có data → restore `--clean` trùng khoá/vướng phụ thuộc; DB đang phục vụ không bị bỏ trống nếu restore lỗi | (review plan M2) |
| 2026-08-27 | Job `dbtest` tách thành workflow `dbtest.yml` có `paths` filter + `workflow_dispatch`, không nằm trong `ci.yml` | Repo private chỉ có 2.000 phút Actions/tháng; dbtest 10–15 phút mỗi lần | (review plan M2) |
| 2026-08-27 | Pin `cloudflared 2026.8.2` (plan cũ 2025.8.1); `@duckdb/node-api` pin bản không pre-release (hiện `pnpm view` trả `1.5.5-r.4`); Overture mới nhất `2026-08-19.0` | Kiểm thật 27/08 | (review plan M2) |
| 2026-08-27 | Icon lá `category.json`: `rail`→`railway`, `rail_metro`→`railway_metro`, `doctor`→`doctors`, `beach`→`swimming` | Sprite osm-liberty (244 icon) không có 4 tên cũ; API M3 sẽ trả tên icon không tồn tại | (review plan M2) |
| 2026-08-27 | G4/G5/G7 kiểm xong bằng lược đồ thật: Overture `2026-08-19.0` có `geometry` kiểu **GEOMETRY native** (không WKB) + cột mới `socials`, `operating_status`, `taxonomy`; FSQ `dt=2026-08-11` qua HF đủ cột, `date_closed` là VARCHAR, có `country`; `@duckdb/node-api` pin `1.5.5-r.4` (mọi bản đều `-r.N`) | `ST_GeomFromWKB` trong plan sẽ lỗi trên GEOMETRY; `operating_status`/`socials` cho `closed`/facebook chính xác hơn suy từ `sources`; token HF của PHONG đã được cấp quyền gated (`HTTP 200`) | (M2 T0) |
| 2026-08-27 | M2 khác roadmap mục 3 ở 7 điểm (đã cân nhắc khi viết plan): (1) OSM POI qua `osmium tags-filter` + `export` GeoJSONSeq thay `ST_ReadOSM` để giữ POI dạng vùng; (2) cặp ứng viên gộp sinh bằng PostGIS (`ST_DWithin` + `similarity`) thay DuckDB; (3) nạp Postgres bằng `COPY FROM STDIN` từ Node thay `ATTACH postgres`; (4) test pipeline là `.mjs` + JSDoc, `*.dbtest.mjs` cần Postgres dev; (5) `init-roles.sql` → `init-roles.sh`, roles tạo NOLOGIN ở migration 0002; (6) `poi` gộp (UPDATE/INSERT/đóng) không hoán đổi bảng vì `poi_edit` FK; (7) thêm nhóm giả `other` + lá `<nhóm>_other` | Xem phần "Khác biệt so với roadmap" trong plan; ghi ở đây để roadmap mục 3 không bị hiểu là nguồn chân lý | (M2 T0) |
| 2026-08-27 | Vitest tách hai tầng: `vitest.config.ts` (unit, loại `**/*.dbtest.mjs`) và `vitest.db.config.ts` (`fileParallelism: false`, timeout 120 giây, `--passWithNoTests`) | dbtest cần Postgres dev và chạy hàng phút; không được lẫn vào `pnpm test` của CI chính | (M2 T0) |
| 2026-08-27 | `NAME_FILLERS` có thêm `mtv`; `abbrev.json` thêm `tx.`, `h.`, `x.` so với spec 5.3; alias thương hiệu chỉ áp ở đầu chuỗi | "Công ty TNHH MTV …" rất phổ biến trong tên đăng ký; thị xã/huyện/xã xuất hiện trong địa chỉ ngoài đô thị; alias giữa chuỗi gây dương tính giả ("Quán TCH") | (M2 T3) |
| 2026-08-27 | `parseAddress`: 9 luật thêm so với plan sau khi review 300 địa chỉ thật — (1) "N/M Hẻm N X" gộp chuỗi hẻm trùng đầu (`mergeChain`), số hẻm nhận dạng `A/B`; (2) tiền tố "Đường/Phố" chỉ khi bản gốc có `Đ`/`ố` (tránh nuốt "Dương Quảng Hàm", "Phổ Quang"); (3) `tỉnh lộ` không phải tỉnh; (4) phần đã tách dấu phẩy được tách tiếp ở phường/quận (không tách `xã` vì "Xã Đàn"); (5) tên đường ở phần kế sau số nhà đứng riêng ("736/169/10, Đ. Lê Đức Thọ"); (6) số nhà có chữ `272A4`, `E4/15`, `C33` (loại `p6/q10/f6/tp`, mã đường `QL/TL/ĐT/HL`); (7) "3 Tháng 2" là tên đường; (8) bỏ ngoặc đơn, gạch dài `–`, "Cư xá", "gần/đối diện/cuối", tiếng Anh `Ward`/`District`; (9) "Lô P2" không tách thành phường 2 | Lấy mẫu phân tầng 300 địa chỉ Overture (100 có `/`, 60 hẻm/ngõ, 60 có P./Q., 80 còn lại) lộ các mẫu địa chỉ thật mà 49 dòng curated không phủ | (M2 T4) |
| 2026-08-27 | JSONL trung gian của ingest Overture/FSQ **nén gzip** (`COPY … (FORMAT json, COMPRESSION gzip)`, `readJsonl` tự giải nén theo đuôi `.gz`) | Bản không nén ~3–4 GB cho 2 triệu dòng làm đầy đĩa dev (còn 435 MiB) → Docker treo, job bị giết; nguyên nhân gốc là `~/.cache/uv` 124 GB nhưng pipeline không nên cần vài GB tạm | `a70514c` |
| 2026-08-28 | Đo độ phủ taxonomy phân biệt **thiếu ánh xạ** (không có dòng CSV nào khớp, kể cả wildcard — ngưỡng chặn 2 %) với **`*_other` chủ đích** (có dòng CSV trỏ thẳng tới `<nhóm>_other`) | Bản đo đầu gộp chung hai loại nên báo Overture 29,3 % "chưa ánh xạ", nhưng phần lớn là nhóm cha chung của nguồn (`professional_services` → `services_other`) — ánh xạ đúng ngữ nghĩa, không thể chi tiết hơn | (M2 T6) |
| 2026-08-28 | `OSM_DROP` mở rộng thêm 22 giá trị: hạ tầng đường sắt (`railway=level_crossing/switch/signal/platform/stop/crossing/subway_entrance/buffer_stop/milestone`), sân bay (`aeroway=gate/taxiway/runway/holding_position/parking_position`), và `amenity=house/shower/watering_place/water_point/bicycle_repair_station/smoking_area/lounger/trolley_bay`, `leisure=outdoor_seating/swimming_area` | Đo trên 228 nghìn đối tượng OSM VN: đây là hạ tầng, không phải địa điểm để tìm kiếm; giữ lại sẽ tạo POI rác | (M2 T6) |
| 2026-08-28 | 55 ánh xạ bổ sung so với plan, chọn theo số lượng thật trong dữ liệu VN (Overture `health_spa` 4.114 → `spa`, `bridal_shop` 3.683 → `clothes`, `laundromat` 1.865 → `laundry`, `day_care_preschool` 1.752 → `kindergarten`…; FSQ `Structure`, `Factory`, `Assisted Living`…); `farm`/`agriculture`/`agricultural_service` cố ý để rơi vào `other` | Địa điểm nông nghiệp không thuộc 12 nhóm của spec 5.6; ghi chú `#` ngay trong CSV | (M2 T6) |
| 2026-08-28 | Cổng fixture phân biệt `category = 'other'` (chưa ánh xạ, <10 %) với tỷ lệ báo cáo `other OR *_other` | `*_other` là lá parent được Task 6 ánh xạ có chủ đích, không phải thất bại taxonomy; fixture gộp đo 16,1 % combined, toàn VN 19,5 %, đều được báo cáo nhưng không nới ánh xạ ở Task 7 | (M2 T7) |
| 2026-08-28 | Khi nhiều cụm cùng kế thừa một `poi_id`, giữ cụm chứa **previous** `primary_source`/`primary_source_id` của POI cũ, kể cả record đó hiện là secondary; tie bằng `poi_id`/`cluster_no` | Merge/split có thể đổi primary hiện tại; kiểm role mới không xác định POI lịch sử và tạo khoá trùng `poi_new` hoặc chọn ID tuỳ ý | (M2 T7) |
| 2026-08-28 | Ghép tham lam dùng thứ tự toàn phần `score DESC, a, b`; mọi quét nguồn có `ORDER BY` khoá nguồn; `pickPrimary` hoà cùng nguồn dùng `rid` thấp hơn | Không có tie-break làm số cụm thay đổi giữa các lần dựng và có thể tách/kế thừa `poi_id` không ổn định; hai pass toàn VN final-head cùng 402.210 cặp, 1.522.371 POI (1.515.938 active), 1.583.562 link và hash source-link `1434f2acaaa69fd3eee74a9dbdda47a2` | (M2 T7) |
| 2026-08-28 | Không nới ngưỡng gộp chỉ để đạt kỳ vọng đa nguồn 10–25 % | Audit cuối: 50.862/1.522.368 = 3,3 % đa nguồn; Overture chiếm 1.140.030 cụm đơn. 63.269 cặp liên nguồn được luật hiện hành chấp nhận (OSM+Overture 18.405, FSQ+OSM 9.701, FSQ+Overture 35.163); phần còn lại chủ yếu bị khoảng cách/tên/số nhà/đường loại. Đây là thực tế dữ liệu dưới luật chống gộp nhầm, cần quyết định sản phẩm riêng nếu muốn đổi recall | (M2 T7) |
| 2026-08-27 | `osmium export` ghi id đối tượng ở `feature.id`, không ở `properties.id` như plan giả định → `parseOsmiumId(f.id ?? f.properties?.id)`; sửa cả `osm-roads.mjs` (Task 8) trong plan | Ingest OSM fixture trả 0 dòng cho tới khi sửa | `f9f1fda` |
| 2026-08-27 | Fixture `q1.osm.pbf` dùng `-s smart -S types=any` nên có node ngoài bbox Quận 1 (bbox thật 105,77–108,43°E); test bbox chỉ áp cho Overture/FSQ, OSM kiểm trong VN + ≥ 500 đối tượng trong Quận 1 | Giữ trọn relation ranh giới để Task 8 dựng `admin_area` trên fixture | `f9f1fda` |
| 2026-08-27 | Dockerfile gộp luôn Task 1 Step 4 (`postgresql-client-16`, `zstd`, `cloudflared 2026.8.2`) vào lần rebuild của Task 5 | Chỉ rebuild image một lần (~10 phút) thay vì hai | `f9f1fda` |
| 2026-08-27 | DuckDB 1.5 `ST_AsGeoJSON` trả kiểu JSON (object) — `make-vn-boundary.mjs` nhận cả object lẫn chuỗi | Bản đầu `JSON.parse` hai lần → lỗi `[object Object]` | `a70514c` |
| 2026-08-27 | Danh sách 34 tỉnh + alias tên cũ nằm trong `packages/core/src/provinces.json` (NQ 202/2025/QH15) | Địa chỉ cũ ("Bình Dương", "Vũng Tàu", "Bến Tre") vẫn về đúng tỉnh mới | (M2 T4) |
| 2026-08-29 | OSM raw hiện dùng level 6 cho đơn vị cấp xã/đặc khu sau sắp xếp; map sang semantic level 8, nhưng chỉ nhận L6/L8 có point-on-surface nằm trong một L4 thuộc danh sách 34 tỉnh hiện hành | Raw có `L4=39, L6=3.322, L8=565`. Kết quả sau review là L4=33, L8=3.255; loại thêm 64 relation ngoài retained province. OSM thiếu riêng Khánh Hòa, không tạo geometry giả để ép đủ 34 | (M2 T8 review) |
| 2026-08-29 | Parser tên hẻm nhận thêm chuỗi `/`, khoảng `-`, mã chữ-số (`111K1`, `02/K01`), `+`, dấu phẩy/chấm và lỗi thiếu khoảng trắng | Regex spec hẹp làm 109 street cluster toàn VN vẫn mang tên hẻm số; RED từ mẫu OSM thật rồi mở rộng, final còn 0 | (M2 T8) |
| 2026-08-29 | Anchor dựng graph cạnh bằng geometry GiST prefilter + geography exact ≤30 m, lấy connected component và lặp trên median đến khi exact duplicate = 0 | Review phát hiện DBSCAN 0,0003°/30,5 m có thể gộp cặp >30 m. Regression 30,1 m giữ tách, 29,9 m gộp và OSM thắng source priority; national thành 923.541 anchor | (M2 T8 review) |
| 2026-08-29 | `osm_road_raw` + `osm_admin_raw` dựng `_new`, swap cả hai trong một transaction; anchor raw/edge/merge/new luôn cleanup trong `finally`. Alley dùng prefilter + geography exact ≤300/15 m | Fault-injection giữ nguyên hai raw table/bảng anchor published khi lỗi và staging=0; boundary regressions 299/301 m và 14,9/15,1 m xanh | (M2 T8 review) |
| 2026-08-29 | Style bỏ toàn bộ lớp POI của base OSM Liberty (`source-layer=poi` của `openmaptiles`) và dùng một lớp `poi` riêng từ `poi-YYYYMMDD.pmtiles` | Hai bộ icon chồng nhau ở cùng vị trí; lớp riêng mới có `q`/`grp`/`cat` để lọc theo mật độ 5.8 và bắt sự kiện `poiClick` | (M2 T9) |
| 2026-08-29 | Worker bỏ hẳn `sources.poi` + lớp `poi` khi `manifest.poi` null, thay vì điền chuỗi rỗng | `pmtiles://…/tiles/.pmtiles` làm MapLibre tải file không tồn tại và báo lỗi ở mọi phiên trước khi có bản POI đầu tiên | (M2 T9) |
| 2026-08-29 | `export-tiles.mjs` không dùng `--extend-zooms-if-still-dropping` | Cờ này có thể đẩy maxzoom vượt 16, làm `inspect`/`smoke --set poi` lệch với spec 5.8 | (M2 T9) |
| 2026-08-29 | `.dockerignore` thêm `**/.env` (trước chỉ có `.env` ở gốc) | Pattern gốc chỉ khớp `/.env`; `infra/server/.env` chứa mật khẩu superuser/api/pipeline sẽ bị nướng vào layer image ở mọi lần `pnpm image:build` chạy sau `server:setup` | (M2 T1) |
| 2026-08-29 | Lệnh restore-smoke dựng URL từ `POSTGRES_*` của container thay vì `$DATABASE_URL` | Container `backup` không export `DATABASE_URL` (backup.mjs tự dựng qua `databaseUrlFromEnv`); lệnh trong plan rơi về socket và báo `.s.PGSQL.5432: No such file or directory`. Recipe đúng đã ghi vào `infra/server/README.md` để Task 10 `db-restore.mjs` dùng lại | (M2 T1) |
| 2026-08-29 | `server-setup.mjs` gán `pipelineImage` có giá trị mặc định thay vì dùng thẳng `env.PIPELINE_IMAGE` | `parseEnv` trả `Record<string, string>` nhưng tsconfig bật `noUncheckedIndexedAccess` → `string \| undefined`, `pnpm typecheck` đỏ ở `spawnSync` | (M2 T1) |
| 2026-08-30 | Hyperdrive tạo bằng `wrangler hyperdrive create`, **không điền port** | Luồng private-database qua Tunnel yêu cầu `omit the port` (tài liệu Cloudflare); tunnel đã tự route tới `postgres:5432` qua published application route. Plan ghi port 5432 — sai | (M2 T1) |
| 2026-08-30 | Lệnh wrangler cho Hyperdrive phải chạy từ `apps/api`, không từ gốc repo | Wrangler 4 đọc `.env` của thư mục hiện tại; ở gốc repo nó nhặt `CLOUDFLARE_API_TOKEN` (token deploy, không có quyền Hyperdrive) và ghi đè OAuth → `Authentication error [code: 10000]` | (M2 T1) |
| 2026-08-30 | Access application phải tắt hết identity provider và đặt Session Duration “expires immediately” | Tài liệu Cloudflare nêu, plan bỏ sót; để IdP bật thì Access đòi đăng nhập người dùng thay vì chấp nhận service token và Hyperdrive không qua được cửa | (M2 T1) |
| 2026-08-30 | Test tầng `apps/api` trỏ binding Hyperdrive vào cổng đóng và chỉ kiểm nhánh lỗi 503 của `/healthz/db` | Bản đầu kiểm happy-path qua `localConnectionString` → xanh trên máy dev nhưng đỏ trên runner Deploy API (không có Postgres), chặn luôn bước `wrangler deploy`. Tầng api phải không cần DB — đó là lý do `dbtest` là workflow riêng. Đường đi thật tới Postgres nghiệm thu bằng `wrangler dev --remote` | (M2 T1) |
| 2026-08-31 | `detectSources` không phụ thuộc Geofabrik HEAD; tải OSM dùng GET có retry + checksum và có thể nhận PBF local | Geofabrik HEAD trả 502 trong lần chạy live dù GET/checksum vẫn tốt; không được biến lỗi CDN nhất thời thành rebuild thất bại | (M2 T10) |
| 2026-08-31 | `pnpm test:db` luôn reset DB cô lập `mapslibvn_task8_test`; hook 300 giây | Bộ test trước đây có thể sửa DB dev đã restore và conflate fixture vượt hook 120 giây | (M2 T10) |
| 2026-08-31 | Restore portable xong phải reconcile owner/grant `api`/`pipeline` | Backup dùng `--no-owner --no-privileges`; chỉ chạy migration pending không khôi phục ACL của schema đã đủ migration | (M2 T10) |
| 2026-08-31 | Partial run lưu `pending.tiles`/`pending.poi`; Tunnel chỉ mở trong nhánh POI, nhận service token qua env và luôn cleanup | `--poi` khi OSM đổi trước đây có thể cập nhật source state rồi làm lần sau bỏ sót tiles; secret trên argv lộ qua process list; dry-run không cần DB | (M2 T10 review) |
| 2026-08-27 | `apps/docs/tsconfig.json` phải `exclude: ["dist", "public"]` | `astro check` với `include: ["**/*"]` kéo cả `public/sdk/mapslibvn.umd.js` (1 MB) và sourcemap (2,4 MB) vào TypeScript → hết heap 4 GB, exit 137 | (Task M1c T3) |
| 2026-08-27 | `biome.json` bỏ qua `apps/docs/public/sdk/**` | Thư mục là artefact copy từ bản build web; biome báo vượt giới hạn 1 MiB và lỗi CSS của maplibre | (Task M1c T3) |

## 4. Nhật ký

- 2026-08-26 · M1a T1 · khung monorepo · `9cff9a8`
- 2026-08-26 · M1a T2 · DEVLOG + hook pre-push khoá account cá nhân · `cb98a09`
- 2026-08-26 · M1a T3 · remote GitHub cá nhân + push đầu tiên · `e7f16d4`
- 2026-08-26 · M1a T4 · Postgres/PostGIS dev + migration idempotent · `d4186f3`
- 2026-08-26 · M1a T5 · `pnpm run setup` sạch đạt 6,51 giây · `cc16199`
- 2026-08-26 · M1a T6 · image pipeline đủ 8 tool, cached rebuild 4,8 giây · `67a7b99`
- 2026-08-27 · M1a T7 · Dev Container dựng thành công, 20/20 test trong Linux · `673f6fe`
- 2026-08-27 · M1a T8 · CI xanh: test 18 giây, image + smoke 3 phút 52 giây · `469836a` · https://github.com/dotienphong/maps-library-vietnam/actions/runs/33024223882
- 2026-08-27 · M1a T9 · nghiệm thu đạt trên macOS arm64 · `c5e3f40`:
  - Clone sạch: install + setup `real 4,42s`; setup báo sẵn sàng sau 2 giây.
  - Máy dev: install lockfile, lint, typecheck và 21/21 test đều xanh.
  - Image local arm64 smoke đủ 8 tool; CI amd64 của bản sửa setup xanh: https://github.com/dotienphong/maps-library-vietnam/actions/runs/33024620355
  - Hook từ chối `someone@bark.com`, in `pre-push: BỊ CHẶN`, trả `exit=1`.
  - Windows: **PENDING Windows** (chờ PHONG có máy để kiểm).
- 2026-08-27 · M1b T1 · `@mapslibvn/core`: attribution spec 12.3, client
  `attribution()`/`styleUrl()`, lỗi có `code`/`requestId`; build ESM + declarations,
  typecheck và 27/27 test xanh · `595dd37`
- 2026-08-27 · M1b T2 · style light/dark vendor từ OSM Liberty/Dark Matter,
  template 105/48 layer hợp lệ, `name:vi` fallback, 3 stack Noto và 2 nhãn chủ
  quyền; typecheck và 35/35 test xanh · `1cfb4d2`
- 2026-08-27 · M1b T3 · pipeline tải nguồn trong 4 phút 4 giây, Geofabrik PBF
  327 MB khớp MD5 `620d0258ffecd450363e24560d0a7b8b`; patch thật đổi 108
  object trong 10.351 node/486 way thuộc bbox; Python fixture xanh và tổng 37/37
  test xanh · `889a500`
- 2026-08-27 · M1b T4 · fixture Quận 1 1,0 MB/25 tile; full archive
  `vn-20260827.pmtiles` 952 MiB, zoom 0–14, bounds toàn cầu, 16 layer và
  6.291.183 tile entry; build nén temp hoàn tất trong 3 phút 24 giây; lint,
  typecheck và 38/38 test xanh · `2534482`
- 2026-08-27 · M1b T5 · QA chủ quyền: `qa.mjs` giải mã 574 tile giao hai bbox (z4–z10 toàn
  phần, z11–z14 quanh 13 điểm đảo), lọc theo hình học thật; lần 1 bắt 259 vi phạm tên chữ Hán
  (núi ngầm `镜台海山`, `流春海山`… ngay ngoài bbox) → mở rộng patch vùng biển Đông (thêm 85
  object: 72 node, 13 way), build lại archive 952 MB (3 phút, cache) → 0 vi phạm tên, Trường Sa
  có đảo tên VI, Hoàng Sa cảnh báo vì extract Geofabrik không phủ; style 2 nhãn chủ quyền đạt;
  47/47 test JS + pytest xanh · `cceae80`
- 2026-08-27 · M1b T6 · Cloudflare resource active; pipeline thật dùng OSM MD5
  `620d0258ffecd450363e24560d0a7b8b`, patch 193 object, build archive 997 MB
  trong 3 phút 18 giây, QA giải mã 574 tile đạt; upload R2, smoke HTTP 20/20,
  manifest `vn-20260827`, state idempotent và rollback→restore đều đạt. Token
  object-level dùng `no_check_bucket=true`; image pin rclone 1.75.0 để loại 501;
  rollback chạy trong container; lint 46 file, typecheck 3/3, build 2/2,
  61/61 test JS, image smoke 8 tool và pytest 1/1 đều xanh · (commit hiện tại)
- 2026-08-27 · M1c T1 · Worker Hono `apps/api`: `/v1/styles/:theme.json` điền
  `TILES_BASE`/phiên bản từ manifest KV (cache 1 giờ), `/v1/attribution` (5 link),
  `/healthz`, TileJSON + tile `z/x/y.pbf` fallback đọc R2 qua `R2Source` (gzip
  passthrough, cache edge), `/r2/*` Range 206 cho dev/E2E; lỗi theo spec 6.6 có
  `request_id`. Kiểm thật với fixture Quận 1 qua `wrangler dev`: healthz OK,
  style trỏ `pmtiles://…/q1-fixture.pmtiles`, Range `206 16384`, tile
  `vn/14/13048/7698.pbf` → `200` 189.986 byte kèm `content-encoding: gzip`.
  Lint/typecheck xanh, 71/71 test (61 root + 10 api) · (commit hiện tại)
  — **Step 7 deploy production chưa chạy: bị bộ lọc quyền chặn.**
- 2026-08-27 · M1c T2 · `@mapslibvn/web`: `createMap` bọc maplibre-gl với dependency
  injection (test không cần WebGL), `pmtiles://` đăng ký đúng một lần, attribution ép
  bật bằng `AttributionControl` riêng (`attributionControl: false` + `customAttribution`),
  `addMarker`/`fitBounds`/`flyTo`/`poiClick`/`lang`, bản UMD gói kèm maplibre + CSS.
  Build: `dist/index.js` 1,47 kB gzip (giới hạn 15 kB), `dist/mapslibvn.umd.js`
  294 kB gzip (giới hạn 350 kB), `dist/mapslibvn.css` 10,06 kB gzip. Lint/typecheck
  xanh, 79/79 test (69 root + 10 api) · (commit hiện tại)
- 2026-08-27 · M1c T3 · docs Astro Starlight (tiếng Việt, 3 trang: trang chủ splash,
  "Bắt đầu 5 phút", playground) + `scripts/copy-sdk.mjs` đưa bản UMD vào `public/sdk`;
  E2E Playwright chạy **offline hoàn toàn** bằng fixture Quận 1: Worker `dev:e2e` seed
  R2/KV local rồi phục vụ `/r2/*`, Chromium tải bản đồ thật. Kết quả thật: build docs
  3 trang trong 7,11 giây, E2E **2/2 passed (11,4 giây)** — tile Range 206/200,
  attribution chứa "OpenStreetMap", marker Chợ Bến Thành hiện, style dark cũng tải.
  Lint 75 file, typecheck 9/9, 79/79 test · (commit hiện tại)
- 2026-08-27 · M1c T4 (một phần) · 3 workflow: `deploy-api.yml` (push chạm
  `apps/api`/`packages/core`/`packages/style` → build + test api + `wrangler deploy
  --env production`), `deploy-docs.yml` (build core+web+docs → `pages deploy`),
  `data-update.yml` (dispatch/cron chủ nhật 19:00 UTC, chạy trong image GHCR,
  `--memory 6g`, timeout 180 phút). **Chưa kiểm chạy: Step 1 đặt secret bị bộ lọc
  quyền chặn** · (commit hiện tại)
- 2026-08-27 · M1c · phát hiện khi chạy deploy: token Cloudflare thiếu
  `Workers Scripts: Edit` + `Cloudflare Pages: Edit` (chỉ có KV), PAT GitHub thiếu
  `Secrets: Read and write`. Dry-run bundle Worker production đạt 182,82 KiB
  (gzip 38,97 KiB) với đủ 4 binding · (commit hiện tại)
- 2026-08-27 · M1c T1 S7 · Worker deploy production thành công sau khi thay token:
  `mapslibvn-api-production.dotienphong1993.workers.dev`, 4 binding đúng (META KV,
  TILES R2, TILES_BASE, ENVIRONMENT=production) · (commit hiện tại)
- 2026-08-27 · M1c T3 S4 · Pages project `mapslibvn-docs` tạo + deploy 32 file:
  `https://mapslibvn-docs.pages.dev` · (commit hiện tại)
- 2026-08-31 · **M2 nghiệm thu ĐẠT** (bảng chi tiết ở mục 7) · `30f0274`: 1.515.983 POI
  `active` / tổng 1.522.416; `poi-20260830.pmtiles` 244,6 MiB đã vào manifest production,
  click POI trên playground hiện tên/loại/nhóm; `/healthz/db` trả `{"ok":true,"user":"api"}`
  qua Hyperdrive → Access → Tunnel → Postgres TLS trên máy nội bộ; `pnpm db:restore --latest`
  phục hồi từ R2 đạt (1.522.416 POI, owner/grant đúng); báo cáo gộp 3,3 % đa nguồn,
  19,6 % combined other, 923.567 anchor, "Nguyễn Lâm" 174. Remote CI xanh cả 3 job:
  `test` + `image` https://github.com/dotienphong/maps-library-vietnam/actions/runs/33358342667
  và `dbtest` 24 phút 37 giây
  https://github.com/dotienphong/maps-library-vietnam/actions/runs/33358342671

## 5. Sự cố

### SC-1 · Cache Rule nuốt Range của PMTiles — **ĐÃ ĐÓNG 27/08/2026**

**Triệu chứng.** Client đọc `https://tiles.ai-solutions.io.vn/tiles/vn-20260827.pmtiles`
bằng `Range: bytes=0-1023` nhận **HTTP 200 kèm toàn bộ 997.786.022 byte** thay vì
`206` + 1 KB. Trình duyệt sẽ tải 952 MB rồi mới vẽ được bản đồ.

**Nguyên nhân gốc.** Cache Rule của zone là `(http.host eq "tiles.ai-solutions.io.vn")`
→ `cache: true`, edge TTL 1 năm — áp cho **toàn bộ** hostname, gồm cả archive 951,6 MiB.
Zone ở gói **Free**, giới hạn object cache là **512 MB**. Khi gặp một cache key chưa biết,
Cloudflare cố cache-fill: bỏ qua header `Range`, kéo trọn object từ R2 và trả nguyên cho
client; chỉ sau đó mới kết luận không cache được (`cf-cache-status: BYPASS`) và ghi nhớ —
nên request sau **trên cùng cache key** mới được proxy Range đúng. Hệ quả: người dùng đầu
tiên chạm vào mỗi PoP chưa warm phải tải 952 MB.

**Bằng chứng phân biệt (trước khi sửa).**

| Phép đo | Kết quả |
|---|---|
| Range, cache key cũ | `206`, 1.024 B, `BYPASS` |
| Range, cache key mới × 3 | `200`, tải 245 MB / 207 MB / 189 MB trước khi ngắt |
| Range trên font nhỏ cùng bucket | `206`, 100 B |
| Worker đọc R2 qua binding | 200, tile đúng ở z8/z12/z14 |

Hai dòng cuối chứng minh archive trong R2 lành lặn và R2 hỗ trợ Range — lỗi ở tầng cache
của Cloudflare, không ở dữ liệu.

**Cách sửa (PHONG áp trên dashboard).** Tách rule cũ thành hai, loại trừ lẫn nhau nên
không phụ thuộc thứ tự:

1. `(http.host eq "tiles.ai-solutions.io.vn" and not ends_with(http.request.uri.path, ".pmtiles"))`
   → Eligible for cache, edge 1 năm, browser 1 ngày (font, sprite).
2. `(http.host eq "tiles.ai-solutions.io.vn" and ends_with(http.request.uri.path, ".pmtiles"))`
   → **Bypass cache**.

**Kiểm chứng sau khi sửa.** Cache key hoàn toàn mới → `206`, đúng 1.024 byte, 1,10 s rồi
0,34 s, `cf-cache-status: DYNAMIC`. Font → `206`, `cf-cache-status: HIT` (vẫn cache đúng).

**Bài học.** Với gói Free/Pro/Business, mọi object > 512 MB phục vụ qua Cloudflare phải
được đặt **Bypass cache** — nếu không, mỗi cache key lạnh phải trả giá một lần kéo trọn
file và Range bị vô hiệu. Khi đổi sang domain riêng của MapsLibVN, **phải mang theo cặp
rule này**, nếu không lỗi lặp lại y hệt.

## 6. Nghiệm thu M1 (spec mục 13, hàng M1)

Chạy 27/08/2026 trên production thật (Chromium headless qua Playwright, ảnh lưu ngoài repo).

| # | Hạng mục | Kết quả |
|---|---|---|
| 1 | `pnpm run setup` clone sạch | macOS arm64: `real 4,42s`, báo sẵn sàng sau 2 giây (M1a T9). **Windows: PENDING** |
| 2 | Playground production, style light | Bản đồ TP.HCM nhãn tiếng Việt đủ dấu; 14 tile request **toàn bộ `206`**, tải 3.127 KB; **0 request tới Worker cho tile** — client đọc thẳng R2 đúng kiến trúc spec |
| 2b | Style dark | Tải được, 14 tile `206`, 2.495 KB |
| 3 | Zoom z4, nhãn chủ quyền | `queryRenderedFeatures` trên lớp `sovereignty-label` trả đúng 2 nhãn **"Quần đảo Hoàng Sa (Việt Nam)"** và **"Quần đảo Trường Sa (Việt Nam)"** — hiện thật trên ảnh |
| 4 | Trang HTML trắng của bên thứ ba nhúng bằng một thẻ `<script>` UMD | Bản đồ Hà Nội tải, 8 tile `206`, attribution chứa cả "OpenStreetMap" lẫn "MapsLibVN", 1 marker, không lỗi trang |
| 5 | `pnpm data:update --dry-run` | `Kế hoạch: {"tiles":false,"poi":false,"reasons":[]}` → `(dry-run) dừng.` — idempotent |
| 5b | `data:update --tiles` trọn vòng | Đã chạy thật ở M1b T6 (download → patch → build → QA → R2 → smoke 20/20 → manifest). **Không chạy lại `--force`** ở bước nghiệm thu: tốn 60–90 phút build lại trong khi vòng đời đã được chứng minh và `--dry-run` xác nhận trạng thái nhất quán |
| 6 | Spec 4.2 — lớp thế giới ngoài VN ở z0–6 | **ĐẠT.** z2 hiển thị đầy đủ hình khối toàn cầu (landcover 25, boundary 7, water 10 feature), không có "lỗ đen"; Planetiler đã dùng Natural Earth cho z0–7. **Hạn chế đã biết:** không có nhãn địa danh ngoài Việt Nam — ở z2/z4 chỉ có nhãn "Việt Nam", z6 chỉ các đô thị VN (Huế, Pleiku, Kon Tum, Buôn Ma Thuột, Quảng Ngãi…). Chấp nhận được cho M1 ("bản đồ câm", định hướng Việt Nam trước); **không cần Protomaps**. Nếu sau này muốn tên nước láng giềng, cân nhắc ở M3: bật lớp place của Natural Earth trong profile Planetiler |
| 7 | Test và CI | lint 75 file, typecheck 9/9, **79/79 test** (69 root + 10 api), E2E Playwright 2/2 offline; CI xanh liên tiếp |
| 8 | 3 workflow deploy trên Actions | **Cả 3 xanh.** Deploy API 47 giây → `Deployed mapslibvn-api-production`, version `eedb3317-2431-4f89-91b8-6ea2118d823e`. Deploy Docs 1 phút 2 giây → `Uploaded 8 files (24 already uploaded)`, deployment complete. Data update 41 giây trong image GHCR → `Kế hoạch: {"tiles":false,"poi":false,"reasons":[]}` rồi `(dry-run) dừng.` |

**Kết luận: M1 (M1a + M1b + M1c) NGHIỆM THU ĐẠT ngày 27/08/2026**, trừ hai việc đã ghi
rõ ở mục 2 và không chặn M2: kiểm trên Windows, và bật lại `requireIslands` cho Hoàng Sa.
- 2026-08-27 · M1c · SC-1 đóng: sau khi tách Cache Rule, Range trên cache key mới trả
  `206`/1.024 B trong 1,10 s (`DYNAMIC`), font vẫn `HIT` · (commit hiện tại)
- 2026-08-27 · M1c T5 · nghiệm thu M1 trên production: playground light/dark, nhúng UMD
  từ trang bên thứ ba, z4 hiện đủ 2 nhãn chủ quyền, tile toàn `206` đọc thẳng R2,
  `data:update --dry-run` idempotent, spec 4.2 đánh giá ĐẠT · (commit hiện tại)
- 2026-08-27 · M1c T4 S1+S5 · 8 secret lên repo private; 3 workflow chạy: **Cả 3 xanh.** Deploy API 47 giây → `Deployed mapslibvn-api-production`, version `eedb3317-2431-4f89-91b8-6ea2118d823e`. Deploy Docs 1 phút 2 giây → `Uploaded 8 files (24 already uploaded)`, deployment complete. Data update 41 giây trong image GHCR → `Kế hoạch: {"tiles":false,"poi":false,"reasons":[]}` rồi `(dry-run) dừng.` · (commit hiện tại)
- 2026-08-27 · M1c T5 · **nghiệm thu M1 đạt**, chuyển mốc sang M2 — kho POI + máy chủ
  nội bộ, plan `2026-08-27-m2-kho-poi-may-chu.md`, Task 0 · (commit hiện tại)
- 2026-08-27 · M2 · review plan lần 3 trước khi thực thi: 4 điểm chặn (FSQ mất S3 công khai,
  `publishNew` lỗi trên bảng không có `id`, thiếu `RCLONE_CONFIG_R2_NO_CHECK_BUCKET` ở máy
  chủ/Actions, trình tự Hyperdrive vs auto-deploy) + 7 điểm quan trọng — đã sửa 55 chỗ
  thẳng vào plan; PHONG quyết FSQ qua Hugging Face và máy dev làm máy chủ tạm · (commit hiện tại)
- 2026-08-27 · M2 T0 · G1 (79/79 test, đủ file M1), G2 (image 8 công cụ), G4 Overture
  `2026-08-19.0` (GEOMETRY native), G5 FSQ `dt=2026-08-11` qua HF (`HTTP 200`), G7 pin
  `@duckdb/node-api 1.5.5-r.4`, G8 token HF của PHONG đã được cấp quyền gated; vitest tách
  unit/dbtest, scripts `test:db`/`server:setup`/`server:update`/`db:restore` khai báo sẵn;
  lint 76 file, typecheck 9/9 · (commit hiện tại)
- 2026-08-27 · M2 T2 · migration 0002–0005 (roles `api`/`pipeline` NOLOGIN, 3 bảng nguồn,
  `category`/`poi`/`poi_source_link`/`poi_edit`, 5 bảng geocoding, `tenant`/`api_key`) + 4 file
  `.down.sql`; `db:migrate --down` revert đúng một migration; `databaseUrlFromEnv` hỗ trợ
  `POSTGRES_SSL=require`; `db/schema.dbtest.mjs` 6/6 xanh (16 bảng, SRID, index, ràng buộc,
  quyền, down×4 → migrate lại); workflow `dbtest.yml` riêng có `paths`; unit 87/87 · (commit hiện tại)
- 2026-08-27 · M2 T3 · `@mapslibvn/core`: `stripDiacritics`/`expandAbbrev`/`normalizeVi`/
  `applyBrandAlias`/`nameCore` + `abbrev.json` (12 viết tắt) + `brand_alias.json` (25 thương
  hiệu); fixture 85 dòng × 3 biến thể (gốc/HOA/NFD) = 255 + 4 test hàm → **259/259 xanh ngay
  lần đầu**; build ESM + d.ts, lint, typecheck 9/9, unit 331/331 · (commit hiện tại)
- 2026-08-27 · M2 T4 · `parseAddress` + `provinces.json` (34 tỉnh); fixture 49 curated **49/49**;
  lấy mẫu 300 địa chỉ thật từ Overture `2026-08-19.0` (DuckDB trong image, 5 phút 13 giây),
  review tay từng dòng: bỏ 8 dòng không phải địa chỉ, sửa kỳ vọng 62 dòng, 70 dòng họ "N/M Hẻm N"
  đặt theo luật ngữ nghĩa, 160 dòng nháp xác nhận đúng → 292 dòng `reviewed: true`; sau 9 luật sửa
  parser đạt **339/341 = 99,4 %** (ngưỡng 95 %; 2 dòng lệch chấp nhận: "Tây Hồ Hà Nội",
  "Việt Hùng, Quế Võ" — không có từ khoá hành chính); `dist/index.js` 6,14 kB gzip (ngân sách 8 kB);
  unit 384/384 · (commit hiện tại)
- 2026-08-27/28 · M2 T5 · `pipelines/poi`: ingest 3 nguồn → `src_*`, ranh giới VN Natural Earth (MultiPolygon
  119 KB), fixture Quận 1 11,5 MB (PBF 2,0 + Overture 5,9 + FSQ 3,6; tạo trong ~2 phút), image rebuild
  có pg client/zstd/cloudflared + core dist + extension DuckDB cài sẵn; dbtest 10/10 (schema 6 + ingest 4)
  trong 11 giây; **toàn VN**: OSM 228.144 (10,5 s), Overture 1.501.161 (3 phút 18 s; 6,6 % không phân loại
  — spec 7 %; 6.7 % không có địa chỉ chữ), FSQ 272.349 (73 s); DB dev 2,2 GB. Sự cố đĩa đầy 97 %
  giữa chừng (xem mục 3), dọn xong còn 44 GiB · (commit hiện tại)
- 2026-08-28 · M2 T6 · taxonomy: `db/seed/category.json` 164 mã lá (12 nhóm thật + `other`, mọi icon có
  trong sprite osm-liberty), 3 CSV ánh xạ 955 dòng (OSM 296, Overture 380, FSQ 279), `taxonomy.mjs`
  (`mapCategory`, `osmCandidates` với tag phụ religion/sport/station, `refineSchool`, CLI `load`);
  9/9 test đơn vị; `category-coverage.mjs` đo trên dữ liệu VN thật: **thiếu ánh xạ OSM 0,4 % ·
  Overture 0,8 % · FSQ 0 %** (ngưỡng 2 %), `*_other` chủ đích 7,5 / 23,1 / 11,8 %, Overture còn
  24,6 % other ở mức bản ghi sau khi dùng `alternate`; nạp DB idempotent (164 mã, 955 dòng, chạy
  hai lần cùng kết quả); unit 402/402 · (commit hiện tại)
- 2026-08-28 · M2 T7 · final-head `records`/PostGIS pairs/ghép tham lam hai lượt/publish/report: toàn VN
  1.897.933 records → 402.210 cặp → 1.522.371 cụm (50.860 đa nguồn = 3,3 %, 61.201 secondary,
  946 ID lịch sử dùng lại) → 1.522.371 POI (1.515.938 active, 6.433 closed), 1.583.562 links. Hai pass
  toàn phần A/B có cùng hash canonical `(source,source_id,poi_id)` `1434f2acaaa69fd3eee74a9dbdda47a2`;
  B quan sát: records 1:36–2:07, conflate 4:04–10:41, publish 1:57–2:28, report 9,577 s. Báo cáo tách bare
  `other` 8,4 % (128.087), mapped `*_other` 11,1 % (169.733), combined 19,6 % (297.820); fixture combined
  16,1 % và bare `other` <10 %. dbtest có forward-link assertion và merge/split historical-primary regression ·
  (commit hiện tại)
- 2026-08-29 · M2 T8 · geocode full national từ PBF 313 MB: 215.360 named road ways / 9.073
  admin relation raw → `admin_area` 3.288 (L4=33, L8=3.255; OSM thiếu Khánh Hòa), 33
  alias distinct; 61.031 street; 58.388 alley, 52.408 (89,76 %) có parent+entrance và 0
  entrance xa đường mẹ >1 m; 923.541 anchor, Nguyễn Lâm 174, exact duplicate ≤30 m = 0.
  Task 7 bất biến: 1.897.933 records / 1.522.371 POI / 1.583.562 links. TDD pure 5/5,
  geocode fixture 7/7 async child trên DB `mapslibvn_task8_test`, gồm fault cleanup + exact
  boundary/source regressions; staging national=0; disk volume final 349 GiB trống, host 21 GiB trống ·
  (commit hiện tại)
- 2026-08-29 · M2 T9 · `export-tiles.mjs` (poi active → GeoJSONSeq → tippecanoe `-Z10 -z16
  -r1 --drop-densest-as-needed` + bộ lọc mật độ 5.8) chạy thật trên kho national:
  **1.515.938 POI → 244,6 MB** (dưới mục tiêu 300 MB), `inspect` `zoom: [10, 16]`,
  `layers: ["poi"]`, 192.467 tile; QA chủ quyền `--skip-islands` đạt. Giải mã tile z10/815/481
  (TP.HCM) chỉ có 5 nhóm công cộng q ≥ 7 — bộ lọc đúng. Style: lớp `poi` chèn ngay trước
  `sovereignty-label` (light 102 layers, dark 49), 13 icon nhóm đều có trong sprite
  osm-liberty; Worker bỏ nguồn/lớp `poi` khi manifest chưa có bản POI. `smoke.mjs --set poi`
  (maxZoom 16, z12–16, cho phép tile trống, ngưỡng ≥ 15/20); playground hiện tên · loại (nhóm)
  khi bấm POI. lint sạch, typecheck 10/10, **450/450 test** (438 root + 12 api), E2E 2/2 ·
  (commit hiện tại)
- 2026-08-29 · M2 T1 (Step 1–8, **Step 9–10 chờ PHONG**) · máy chủ nội bộ chạy thật trên máy
  dev với `PIPELINE_IMAGE=mapslibvn/pipeline:local`: `pnpm server:setup` sinh
  `infra/server/.env` (3 mật khẩu 32 ký tự, `PG_SHARED_BUFFERS` = 25 % RAM), chứng chỉ tự ký
  10 năm trong volume `pgcerts`, `docker compose up -d` 3 dịch vụ, áp dụng **5 migration**
  (0001–0005), đồng bộ role, `ssl = on`. Chạy lại **idempotent 8 giây** (`.env` giữ nguyên,
  chứng chỉ giữ nguyên, 0 migration). Kiểm chứng: `api|t` + `pipeline|t`; kết nối
  `sslmode=require` → `ssl = t`; `sslmode=disable` → `FATAL: pg_hba.conf rejects connection …
  no encryption` (TLS bắt buộc thật, không chỉ trên README). `backup --once` →
  `mapslibvn-20260829-2142.dump.zst` lên `r2:mapslibvn-tiles/backups/daily`; restore vào DB
  mới `restore_smoke` **không một lỗi nào**, `schema_migrations` = 5 = số migration up trong
  repo. Log daemon đúng lịch: backup `2026-08-29T20:00:00Z` (03:00 VN), cron
  `2026-08-30T19:00:00Z` (thứ Hai 02:00 VN). Image rebuild có `backup.mjs`/`cron.mjs`, không
  chứa `infra/server/.env`. lint sạch, typecheck 10/10, **462/462 test** (450 root + 12 api) ·
  `7af8c31`
- 2026-08-30 · M2 T1 Step 9–11 · **Task 1 ĐÓNG.** Tunnel `mapslibvn-db` HEALTHY (4 kết nối
  quic tới sin21/sin18/sin14). Kiểm hai chiều từ máy dev qua `cloudflared access tcp`: có
  service token → `current_user = api`, `ssl = t`; bỏ service token → Access đóng kết nối.
  Hyperdrive `71d7a62b89e9462e91bb0094af1f750f` tạo bằng `wrangler hyperdrive create`
  (host `maps-db.ai-solutions.io.vn`, user `api`, **không port**). Worker: `postgres@3.4.5`,
  `src/db.ts`, `Env.DB`, route `/healthz/db`, binding `DB` trong `wrangler.toml` (dev +
  production). **Nghiệm thu: `wrangler dev --remote` → `/healthz/db` trả
  `{"ok":true,"user":"api","version":"PostgreSQL 16.4"}`** — Worker → Hyperdrive → Access →
  Tunnel → máy nội bộ thông suốt. lint sạch, typecheck 10/10, **463/463 test**
  (450 root + 13 api) · (commit hiện tại)
- 2026-08-31 · M2 T10 · dò release 3 nguồn + kế hoạch/state R2; `data:update` đủ nhánh
  `--tiles`/`--poi`/`--force`; workflow Tunnel/HF; restore nguyên tử + reconcile quyền;
  fixture full-pipeline và DB test cô lập. Live national hoàn tất theo thứ tự pipeline qua
  các lần resume có kiểm soát sau lỗi mạng: 1.897.986 record → 402.242 cặp → 1.522.416 POI
  (1.515.983 active), 1.583.616 link; 3,3 % đa nguồn; 923.567 anchor; Nguyễn Lâm 174.
  `poi-20260830.pmtiles` 244,623 MiB đã QA/upload/smoke và active trong manifest; dry-run
  ngay sau live trả `tiles:false, poi:false`. Đến 09:55 ngày 31/08, Geofabrik đổi OSM
  `b0b8… → c256…`; dry-run đúng khi lên kế hoạch `tiles:true, poi:true` cho cron kế tiếp.
  Restore backup mới nhất trả đúng 1.522.416 POI và owner/grant; DB test **32/32** trong
  595 giây; unit/API **480/480**, E2E docs **2/2**,
  lint/typecheck/build/image smoke sạch. Production playground z14 render 653 POI và click
  thật hiện `Museum of Ho Chi Minh City · museum (culture_tourism)`. Sau merge vào `main`,
  remote CI cần 3 bản sửa (build `@mapslibvn/style` trước fixture QA, giữ pending work khi
  chạy partial, nới `DBTEST_CHILD_TIMEOUT_MS` 840 giây + `timeout-minutes: 45`) rồi xanh cả
  3 job trên `30f0274`. Còn 5 Actions secret là việc tay của PHONG (mục 2) · `30f0274`
- 2026-09-01 · M3 T9 · `<mapslibvn-autocomplete>` + playground/E2E; sửa normalization mảng
  Hyperdrive/KV trong auth; browser và E2E 3/3 xanh · `3aed3ab`, `9c61812`
- 2026-09-01 · M3 T10 · `@mapslibvn/react` + demo docs responsive; 5 test hook, desktop/mobile
  browser xanh; CI + Deploy Docs + Deploy API + API DB test remote đều xanh · `ece8d1e`
- 2026-09-01 · M3 T11 · quota KV 2× + Analytics Engine cho 6 Places route; local request
  51 trả 429 đúng; production giữ quota off · `6eb4ade`
- 2026-09-01 · M3 T12 · production fixture/p95/React demo đạt; khôi phục server Postgres
  bị bind mount vào worktree tạm; M3 đóng · (commit hiện tại)
- 2026-09-01 · M3 hậu nghiệm thu · playground tự chọn Worker production khi mở URL không
  có `?api=`; localhost và query override vẫn giữ; thêm unit regression + E2E URL ngắn · (commit này)
- 2026-09-01 · M4 T10 · `suggestEdit` + types Edit trong core (9 phương thức, 6,54 kB gzip) +
  trang docs "Đóng góp & sửa POI"; core 327 test, root 490/490 · (commit này)
- 2026-09-01 · M4 T9 · `publish.mjs` tôn trọng `locked_fields` (11 cột + nhánh status) và
  `anchors.mjs` giữ mốc `source='user'`; `edit-lock.dbtest.mjs` 3/3, test:db 38 passed · (commit này)
- 2026-09-01 · M4 T7+T8 · `apps/admin` SPA React + `[assets]` trong wrangler.toml + E2E Playwright
  với Access giả lập (3/3); sửa lỗi cwd của access-fake và gracefulShutdown webServer · (commit này)
- 2026-09-01 · M4 T5+T6 · `access.ts` (verify Access JWT RS256, JWKS cache KV) + `routes/admin.ts`
  (list/approve/reject) + `access-fake.mjs` tiến trình riêng + `admin.itest.mjs`; api 87/87,
  api-db 22/22 · (commit này)
- 2026-09-01 · M4 T4 · POI pending cho tenant tạo trong `routes/places.ts` + `edits.itest.mjs`
  (6 test DB thật) + seed itest M4; api-db 18/18, api 79/79, root 486/486 · (commit này)
- 2026-09-01 · M4 T3 · `POST /v1/edits` + `requireAuth(scope)` + seed `edits:write`; sửa lỗi
  double-encode jsonb (phải dùng `sql.json`) phát hiện bằng smoke test wrangler dev; api 79/79,
  root 486/486, lint 211 file sạch · (commit này)
- 2026-09-01 · M4 T2 · `edits/{hash,ulid,rules,validate}.ts` + `vnDayStartUtc`; 14 test mới,
  api 73/73, root 486/486, typecheck 12/12, lint 209 file sạch · (commit này)
- 2026-09-01 · M4 T1 · migration `0006_edits.sql` (cột `api_key`/`new_poi_id`, 3 index, 3 hàm
  SECURITY DEFINER owner `pipeline`); `db/apply-edit.dbtest.mjs` 6/6; `db-permissions.mjs` giữ
  owner/grant hàm sau restore; sửa `schema.dbtest.mjs` down 4→5. Local: 486 root + 59 api +
  12 dbtest `db/`, typecheck 12/12, lint sạch · (commit này)
- 2026-09-01 · M4 plan · viết + tự review plan cấp bước `2026-09-01-m4-dong-gop.md`
  (11 task: migration 0006 SECURITY DEFINER, POST /v1/edits, admin SPA sau Access,
  Access giả lập cho test, pipeline tôn trọng locked_fields, suggestEdit + docs) · (commit này)

## 7. Nghiệm thu M2 (spec mục 13, hàng M2) — **ĐẠT 31/08/2026**

| # | Hạng mục | Kết quả |
|---|---|---|
| 1 | Worker → Hyperdrive → Access → Tunnel → Postgres TLS | **ĐẠT:** `/healthz/db` trả `ok:true`, user `api`, PostgreSQL 16.4 sau khi recreate server |
| 2 | Pipeline POI national + cron máy nội bộ | **ĐẠT theo chuỗi resumable:** mọi stage live hoàn tất; không ghi duration one-shot vì có lỗi mạng và resume. Cron kế tiếp `2026-09-06T19:00:00Z` (02:00 thứ Hai VN) |
| 3 | POI active ≥ 1,5 triệu | **ĐẠT:** 1.515.983 / tổng 1.522.416 |
| 4 | PMTiles/playground/click POI | **ĐẠT:** 244,623 MiB; z14 có 653 feature; click hiện tên/loại/nhóm |
| 5 | Báo cáo gộp/geocode | **ĐẠT:** multi-source 50.868 (3,3 %), combined other 297.823 (19,6 %), 923.567 anchor, Nguyễn Lâm 174 |
| 6 | Backup/restore | **ĐẠT:** restore mới nhất vào DB tạm rồi rename; 1.522.416 POI; owner/grant đúng |
| 7 | Test/CI | **ĐẠT:** local lint, typecheck, build, 480 unit/API, 32 DB, 2 E2E, image smoke. Remote CI xanh cả 3 job trên `30f0274` — `test` + `image` (run `33358342667`, 2 phút 11 giây), `dbtest` (run `33358342671`, 24 phút 37 giây) |
| 8 | Việc tay còn lại | Alias phường/xã 2025 + relation level 4 Khánh Hòa (M2 T8); nghiệm thu `pnpm run setup` trên Windows (từ M1); bật lại QA `requireIslands` cho Hoàng Sa khi chốt nguồn extract OSM (từ M1); 5 Actions secret cho workflow `Data update` **đã thêm 31/08** (repo 13 secret), `--dry-run` từ Actions xanh 2/2 và `HF_TOKEN` đã chứng minh dùng được; 4 biến DB/Tunnel mới chỉ có mặt, chỉ một lần `--poi` thật trên Actions mới kiểm được — không chặn nghiệm thu vì cron máy nội bộ vẫn chạy. Production còn warning glyph Unicode hiếm (MapLibre fallback vẫn render) |

## 8. Nghiệm thu M3 — Places API — **ĐẠT 01/09/2026**

### Quyết định thiết kế đã áp dụng

1. Cache autocomplete dùng lưới 0,05° thay H3 res 6 để tránh thêm `h3-js` nặng.
2. Hai fixture bắt buộc dùng seed tổng hợp trong workflow API DB riêng.
3. Auth chỉ áp cho 6 Places route; các route style/tile/attribution cũ không đổi.
4. Bốn API key seed tuân CHECK 24 ký tự sau prefix và tách demo/server/itest/free-test.
5. `suggestEdit` để M4; client M3 có 6 Places method cộng 2 method map có sẵn.
6. Quota chỉ đếm khi `QUOTA_ENABLED=1`, bỏ qua hoàn toàn tenant `internal`.
7. Web component nhận `near` qua attribute hoặc property `.map`, không dùng registry toàn cục.
8. Analytics Engine là binding optional trong code; deploy production hiện có binding thật.

### Bằng chứng nghiệm thu

| # | Hạng mục | Kết quả |
|---|---|---|
| 1 | Hai fixture bắt buộc | **ĐẠT:** API DB workflow `33478585218` xanh trên `6eb4ade`; fixture trường Linh Xuân đứng đầu và `88/9 Nguyễn Lâm` đạt `interpolated` trong bán kính yêu cầu |
| 2 | Production Places API | **ĐẠT:** `highlands&near=10.776,106.700` trả 10 POI thật; `88/9 Nguyễn Lâm` trả `interpolated` tại `10.7624337,106.6622200`; `/healthz/db` trả user `api`, PostgreSQL 16.4 |
| 3 | p95 autocomplete từ Việt Nam | **ĐẠT trên cache-hit production:** ba lần liên tiếp `p50/p95 = 93/177 ms` (SIN), `107/192 ms` (HKG), `95/168 ms` (SIN), n=100/lần. Tool ghi 5 sample chậm nhất cùng cache/colo và fail ngay nếu HTTP lỗi |
| 4 | Quota tenant free | **ĐẠT local runtime:** quota 25, 50 request đầu HTTP 200; request 51 HTTP 429 `quota_exceeded`, `Retry-After: 3600`. Production cố ý giữ `QUOTA_ENABLED=0` đến khi có tenant free thật |
| 5 | Analytics Engine | **ĐẠT:** unit contract ghi tenant/key/path/status/ms; Wrangler local nhận dataset; Deploy API production `33478585196` xanh với binding `mapslibvn_api` |
| 6 | React demo production | **ĐẠT:** browser thật gọi autocomplete HTTP 200/10 items, chọn Highlands tạo đúng 1 marker và status `Đã chọn Highlands`. Ảnh: [React demo production](evidence/m3-react-demo-production.png) |
| 7 | Local gates | **ĐẠT:** lint 200 file; typecheck 12/12 task; root 42 file/482 test (gồm perf tool 2 test); API 15 file/59 test |
| 8 | Remote gates trên Task 11 | **ĐẠT:** CI `33478585207`, Deploy API `33478585196`, API DB `33478585218` đều xanh; DB tests `33478585185` chạy riêng |

### Sự cố và việc theo dõi

- Production Postgres từng dừng sau Docker restart vì container cũ bind ba file config vào
  worktree tạm `/private/tmp/mapslibvn-m2-task10` đã bị xoá. Recreate **riêng** service
  `postgres` từ checkout hiện tại giữ nguyên named volume `mapslibvn-server_pgdata`; health,
  1,5 triệu POI và đường Worker → Hyperdrive → Tunnel đã hoạt động lại. Khi dựng server từ
  worktree tạm, phải recreate compose từ checkout bền trước khi xoá worktree.
- Các lần đo ngay sau khôi phục DB/cache lạnh có p95 2,5–3,2 giây; lần nghiệm thu cuối vẫn
  có một cold miss 3.317 ms nhưng p95 168 ms. M3 đạt mục tiêu p95 cho hành vi client cache-hit;
  theo dõi p99/cold miss và cân nhắc Meilisearch theo spec 8.3 nếu traffic thật vẫn chậm.
- Browser console còn 404 glyph Unicode hiếm và WebGL readback warning; MapLibre fallback
  vẫn render. Đây là hạn chế production đã biết từ M2, không phát sinh từ React demo.
