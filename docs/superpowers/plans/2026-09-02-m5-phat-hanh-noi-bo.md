# M5 — Phát hành nội bộ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đóng MVP (spec bản 2): một ứng dụng nhúng độc lập (trang HTML ngoài docs, không thuộc dự án nào khác) dùng được bản đồ bằng key riêng của tenant thử nghiệm; docs đủ 5 trang + điều khoản tenant + `THIRD_PARTY_NOTICES.md` đóng gói trong SDK; báo cáo sử dụng tuần tự động gửi email từ Analytics Engine; `pnpm export:odbl` xuất được các bảng dẫn xuất OSM; checklist pháp lý ghi rõ việc tay còn lại và được PHONG ký.

**Architecture:** Không thêm endpoint API. Ba nhóm việc độc lập: (1) **tài liệu/pháp lý** — 3 trang Starlight mới + 2 trang sinh lúc prebuild từ file canonical (`docs/legal/dieu-khoan-tenant.md`, `THIRD_PARTY_NOTICES.md`), notices/LICENSE được đồng bộ vào 3 gói SDK và CI kiểm bản sao không lệch; (2) **vận hành** — hai script Node chạy trong container `pipeline` trên máy chủ: `weekly-report.mjs` gọi Analytics Engine SQL API rồi gửi email qua Cloudflare Email Sending REST API, `export-odbl.mjs` `COPY … TO STDOUT` 5 bảng ODbL ra CSV gzip + manifest; `cron.mjs` mở rộng thành nhiều job; (3) **khoá & nghiệm thu** — tenant thử nghiệm `nhung_thu` seed idempotent, key sinh ngẫu nhiên bằng script (không commit key thật), checklist pháp lý và DEVLOG mục 10.

**Tech Stack:** Node 22 (`fetch`, `node:crypto`, `node:zlib`), `postgres` (porsager, `COPY … TO STDOUT` qua `.readable()`), Vitest (unit `scripts/lib/*.test.mjs` + dbtest `db/*.dbtest.mjs`), Astro Starlight 0.30, Playwright (link check docs), Cloudflare Workers Analytics Engine SQL API, Cloudflare Email Sending REST API, GitHub Actions.

**Nguồn sự thật:** spec `docs/superpowers/specs/2026-08-26-mapslibvn-maps-sdk-design.md` mục 3.2–3.3 (ma trận giấy phép, dòng 139–162), 6.3 (thang `precision`, dòng 418–432), 6.4 (đo lường Analytics Engine, dòng 438), 7.4 (5 trang docs, dòng 491), 11.1–11.3 (tự host, giám sát, dòng 531–546), 12.1–12.5 (pháp lý, ODbL, attribution, dòng 566–588), 13 hàng M5 (dòng 598), 15 (việc tay, dòng 618–623); roadmap `docs/superpowers/plans/2026-08-26-roadmap-toan-bo-spec.md` mục 6 (dòng 141–149) và mục 7 (dòng 153–162).

**Nghiệm thu M5 (spec mục 13, hàng M5):**
1. Một ứng dụng nhúng độc lập — trang HTML tĩnh `examples/embed-web/index.html` chạy ở origin riêng, không thuộc docs và không thuộc dự án nào khác của PHONG — hiện bản đồ bằng key riêng (tenant `nhung_thu`, kind `web`, `allowed_origins` = origin đó); tile tải, autocomplete chạy, attribution hiện; origin lạ bị 403.
2. Báo cáo sử dụng tuần đầu nhận được qua email (có dòng của key ứng dụng nhúng độc lập).
3. Docs deploy đủ trang `bat-dau`, `tu-host`, `giay-phep`, `do-chinh-xac`, `dong-gop` (+ `dieu-khoan`, `thong-bao-ben-thu-ba`), link nội bộ không vỡ (Playwright).
4. `pnpm export:odbl` tạo thư mục xuất với 5 CSV gzip + `manifest.json` + `README.md` ghi ODbL (dbtest xanh).
5. Checklist pháp lý `docs/legal/checklist-phap-ly.md` ghi rõ việc tay còn lại, PHONG ký ngày.

---

## Bối cảnh — cái gì đã có sẵn (KHÔNG làm lại)

- **Analytics Engine đã ghi dữ liệu** cho mọi request `/v1/*` (`apps/api/src/analytics.ts`): `blobs=[tenantId, key, pathname]`, `doubles=[status, ms]`, `indexes=[key]`; dataset `mapslibvn_api` binding `ANALYTICS` ở cả dev và production (`apps/api/wrangler.toml`). Trong SQL API: `blob1`=tenant, `blob2`=key, `blob3`=path, `double1`=status, `double2`=ms, `_sample_interval`=trọng số mẫu.
- **Docs**: Starlight tại `apps/docs`, site `https://mapslibvn-docs.pages.dev`, sidebar trong `apps/docs/astro.config.mjs` (2 mục + Playground). Prebuild `apps/docs/scripts/copy-sdk.mjs` copy UMD/CSS vào `public/sdk/`. Playwright `apps/docs/e2e/playground.spec.ts` + `playwright.config.ts` (webServer API `dev:e2e` :8787 + `pnpm preview` :4321). Deploy `deploy-docs.yml` mỗi push `main` động `apps/docs/**` hoặc `packages/**`.
- **Trang đã có**: `bat-dau.md` (còn URL giả `maps-docs.example.com` / `maps-api.example.com`), `dong-gop.md`, `index.mdx`. Production thật: API `https://api.ai-solutions.io.vn`, docs `https://mapslibvn-docs.pages.dev`.
- **Attribution** đã chuẩn trong `packages/core/src/attribution.ts` (`ATTRIBUTION_LINKS`, `attributionText()`, `attributionHtml()`), route `GET /v1/attribution`.
- **Tenant/key**: `db/migrations/0005_tenant.sql` (key phải khớp `^mlv_live_[0-9A-Za-z]{24}$`; `kind` web/mobile/server; `allowed_origins text[]`; `scopes` mặc định `{places:read}`); seed idempotent `db/seed/tenant_internal.sql` (UUID `…000001`), `tenant_free_test.sql` (`…0000bb`); `scripts/db-seed-tenant.mjs` nạp file SQL. `GRANT SELECT ON tenant, api_key TO api, pipeline`.
- **Bảng ODbL** (spec 12.2, đều đã có GRANT SELECT cho `api`/`pipeline`): `src_osm_place(osm_type, osm_id, name, names, tags, geom, release)`, `admin_area(id, level, name, name_norm, parent_id, osm_relation_id, geom)`, `admin_alias(alias_norm, level, admin_area_id, valid_until)`, `street(id, osm_way_ids, name, name_norm, ward_norm, province_norm, geom)`, `alley(id, osm_way_id, number, parent_street_id, name, geom, entrance)`.
- **Cron máy chủ**: `scripts/cron.mjs` (1 job data:update thứ Hai 02:00 VN, khoá file trong `MAPSLIBVN_WORK`), `scripts/lib/schedule.mjs#nextRun(now, {hour, minute, weekday})` đã có test. Container `pipeline` (`infra/server/compose.yml`) chạy `node scripts/cron.mjs`, `env_file: .env` (= `infra/server/.env`), user DB `pipeline`, có `POSTGRES_SSL=require`.
- **Script pattern**: `#!/usr/bin/env node` + `import 'dotenv/config'`; hàm thuần trong `scripts/lib/*.mjs` có `*.test.mjs` cạnh bên (vitest root include `scripts/**/*.test.mjs`); main-guard `if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)`; DB qua `databaseUrlFromEnv(process.env)` (`scripts/lib/migrations.mjs`); `run/capture/sleep` trong `scripts/lib/run.mjs`. `tsconfig.scripts.json` bật `checkJs` cho `scripts/**/*.mjs` — xem "Bẫy typecheck" dưới.
- **dbtest**: `db/**/*.dbtest.mjs` chạy bằng `pnpm test:db` (`scripts/db-test.mjs` tạo DB cô lập `mapslibvn_task8_test`, migrate, chạy `vitest.db.config.ts`, `fileParallelism: false`). Trên máy dev `pipeline-fixture.dbtest` luôn đỏ vì thiếu tippecanoe (memory) — dbtest mới của M5 phải xanh **riêng** khi chạy bằng `pnpm exec vitest run --config vitest.db.config.ts db/export-odbl.dbtest.mjs` sau khi `pnpm db:up && pnpm db:migrate`.
- **Gói SDK**: `packages/core|web|react` đều `"license": "MIT"`, `"files": ["dist"]`. **Chưa có** `LICENSE` ở gốc repo, chưa có `THIRD_PARTY_NOTICES.md`, chưa có `docs/legal/`. `packages/style` chỉ dùng nội bộ (Worker), không publish.
- **CI**: `ci.yml` = `pnpm lint` → `pnpm typecheck` → `pnpm test` (root `test` = build core + vitest root + build admin + test api). `apitest.yml`, `dbtest.yml` riêng (paths filter). Repo private, 2.000 phút Actions/tháng — không thêm job nặng.
- **`.env`** đã có `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (token deploy — **không** dùng cho báo cáo; tạo token riêng quyền hẹp), `PIPELINE_DATABASE_URL`. `.gitignore` đã bỏ `out/`, `work/`, `.cache/`.

## Bẫy typecheck (memory `m3-plan-ky-thuat`) — áp cho mọi `scripts/*.mjs` của M5

- Không destructure `const [{ n }] = await sql…` → dùng `const [row] = …; row?.n ?? 0`.
- Không gán `string | undefined` vào property optional → spread có điều kiện.
- `noUncheckedIndexedAccess`: `arr[0]` là `T | undefined` → kiểm `if (!x) throw …` hoặc `?? mặc định`.
- Sau khi viết script: `pnpm exec tsc -p tsconfig.scripts.json` **trước** khi commit (biome không bắt lỗi kiểu).

## Quyết định thiết kế (chốt khi viết plan — ghi vào DEVLOG mục 3 ở Task 9)

1. **Gửi email bằng Cloudflare Email Sending REST API** (`POST /accounts/{id}/email/sending/send`, token quyền *Email Sending: Edit*), không phải "Email Routing" như roadmap ghi — Email Routing chỉ nhận/chuyển tiếp thư, không gửi từ script ngoài Worker. Điều kiện tay: bật Email Sending cho zone `ai-solutions.io.vn` (dashboard **Email Service → Email Sending → Add domain**, Cloudflare tự thêm DNS SPF/DKIM). Script có `--dry-run` in báo cáo ra stdout để test và để vẫn dùng được nếu chưa bật email.
2. **Báo cáo tuần chạy trong container `pipeline` bằng `cron.mjs`** (thứ Hai **08:00 VN**, sau data:update 02:00), không dùng Worker Cron Trigger: giữ Worker không có secret token Cloudflare API, tận dụng DB (role `pipeline` đọc được `api_key`/`tenant` để đổi key → nhãn), và hạ tầng cron đã có. Token mới `CF_REPORT_API_TOKEN` chỉ có 2 quyền: *Account Analytics: Read* + *Email Sending: Edit*.
3. **Key ứng dụng nhúng độc lập KHÔNG commit vào git.** `db/seed/tenant_nhung_thu.sql` chỉ tạo hàng `tenant` (UUID cố định `…000002`, plan `internal`); key sinh ngẫu nhiên bởi `scripts/api-key-issue.mjs` (`randomBytes` + rejection sampling trên bảng 62 ký tự) và in ra đúng một lần. Lý do: key `web` không phải bí mật (spec 9) nhưng đưa giá trị đoán được vào repo là thói xấu; tenant_internal có key cố định vì là demo/test.
4. **Trang "Điều khoản" và "Thông báo bên thứ ba" trên docs là bản sinh lúc prebuild** từ file canonical `docs/legal/dieu-khoan-tenant.md` và `THIRD_PARTY_NOTICES.md` (script `apps/docs/scripts/copy-legal.mjs` gắn frontmatter, bỏ H1). Hai file sinh nằm trong `.gitignore`. Một nguồn sự thật, không copy tay.
5. **`LICENSE` + `THIRD_PARTY_NOTICES.md` được đồng bộ vào 3 gói SDK** (`scripts/notices-sync.mjs`, có `--check` chạy trong CI) và thêm vào `files` của package.json — npm chỉ tự kèm LICENSE/README, không kèm file notices. `packages/style` không publish nên không cần.
6. **`export:odbl` xuất CSV gzip + WKT** (`ST_AsText(geom)`), một file mỗi bảng, kèm `manifest.json` (số dòng, SHA-256, ngày, release OSM) và `README.md` ghi ODbL 1.0 + attribution. Không xuất `poi`, `address_anchor`, `src_overture_place`, `src_fsq_place`, `poi_edit` (spec 12.2: không phải Derivative Database của OSM hoặc là dữ liệu riêng/nguồn khác).
7. **Không thêm quota/KV, không đổi API.** Giai đoạn nội bộ mọi tenant `internal` (spec 6.4). Tenant thử nghiệm dùng plan `internal`.
8. **Sửa URL thật vào `bat-dau.md`** (`api.ai-solutions.io.vn`, `mapslibvn-docs.pages.dev`) — khi PHONG mua domain riêng chỉ cần thay 2 chuỗi; ghi nhắc trong "Việc tay còn lại".
9. **Link check docs bằng Playwright** (`apps/docs/e2e/docs.spec.ts`) thay vì thêm tool link-checker: đã có Playwright + webServer; chỉ kiểm link nội bộ (`href` bắt đầu `/`), không kiểm link ngoài để CI không phụ thuộc Internet.
10. **Windows và QA `requireIslands` vẫn PENDING** — chuyển nguyên văn vào "Việc tay còn lại", không chặn nghiệm thu M5 (roadmap mục 7 đã chấp nhận PENDING Windows từ M1).

## Cây file (Create/Modify toàn milestone)

```
LICENSE                                              (C) Task 1
THIRD_PARTY_NOTICES.md                               (C) Task 1
scripts/lib/notices.mjs                              (C) Task 1
scripts/lib/notices.test.mjs                         (C) Task 1
scripts/notices-sync.mjs                             (C) Task 1
packages/core/package.json                           (M) Task 1 (files)
packages/web/package.json                            (M) Task 1 (files)
packages/react/package.json                          (M) Task 1 (files)
packages/{core,web,react}/LICENSE                    (C) Task 1 (sinh bởi notices-sync)
packages/{core,web,react}/THIRD_PARTY_NOTICES.md     (C) Task 1 (sinh bởi notices-sync)
package.json (root)                                  (M) Task 1, 4, 5, 7 (scripts)
.github/workflows/ci.yml                             (M) Task 1 (notices --check)
docs/legal/dieu-khoan-tenant.md                      (C) Task 2
apps/docs/scripts/copy-legal.mjs                     (C) Task 2
apps/docs/package.json                               (M) Task 2 (prebuild/predev)
.gitignore                                           (M) Task 2 (2 trang sinh)
.github/workflows/deploy-docs.yml                    (M) Task 2 (paths docs/legal, notices)
apps/docs/astro.config.mjs                           (M) Task 2, 3 (sidebar)
apps/docs/src/content/docs/giay-phep.md              (C) Task 3
apps/docs/src/content/docs/do-chinh-xac.md           (C) Task 3
apps/docs/src/content/docs/tu-host.md                (C) Task 3
apps/docs/src/content/docs/bat-dau.md                (M) Task 3 (URL thật)
apps/docs/src/content/docs/index.mdx                 (M) Task 3 (card giấy phép)
apps/docs/e2e/docs.spec.ts                           (C) Task 3
db/seed/tenant_nhung_thu.sql                            (C) Task 4
scripts/lib/api-key.mjs                              (C) Task 4
scripts/lib/api-key.test.mjs                         (C) Task 4
scripts/api-key-issue.mjs                            (C) Task 4
scripts/lib/odbl.mjs                                 (C) Task 5
scripts/lib/odbl.test.mjs                            (C) Task 5
scripts/export-odbl.mjs                              (C) Task 5
db/export-odbl.dbtest.mjs                            (C) Task 5
scripts/lib/weekly-report.mjs                        (C) Task 6
scripts/lib/weekly-report.test.mjs                   (C) Task 6
scripts/weekly-report.mjs                            (C) Task 7
scripts/lib/schedule.mjs                             (M) Task 7 (nextJob)
scripts/lib/schedule.test.mjs                        (M) Task 7
scripts/cron.mjs                                     (M) Task 7 (nhiều job)
.env.example                                         (M) Task 7
infra/server/README.md                               (M) Task 7 (biến báo cáo + Email Sending)
examples/embed-web/index.html                        (C) Task 9 (ứng dụng nhúng độc lập để nghiệm thu)
docs/legal/checklist-phap-ly.md                      (C) Task 9
docs/DEVLOG.md                                       (M) mỗi task + Task 8, 9 (mục 10)
docs/superpowers/plans/2026-08-26-roadmap-toan-bo-spec.md  (M) Task 9 (tick M5 + dòng cuối mục 7)
```

Lệnh kiểm tra dùng xuyên suốt (chạy từ gốc repo):

- Unit root: `pnpm exec vitest run scripts/lib/<file>.test.mjs` · toàn bộ: `pnpm test`
- Typecheck script: `pnpm exec tsc -p tsconfig.scripts.json` · toàn repo: `pnpm typecheck`
- Lint: `pnpm exec biome check --write <files>` · toàn repo: `pnpm lint`
- Docs: `pnpm --filter @mapslibvn/web build && pnpm --filter @mapslibvn/docs build` · typecheck docs: `pnpm --filter @mapslibvn/docs typecheck` · E2E docs: `pnpm --filter @mapslibvn/docs e2e`
- dbtest đơn lẻ (cần `pnpm db:up && pnpm db:migrate`): `pnpm exec vitest run --config vitest.db.config.ts db/export-odbl.dbtest.mjs`

Quy tắc bất biến: kết thúc mỗi task = tick checkbox plan + cập nhật DEVLOG mục 1–2 + dòng mục 4 + commit (Conventional Commits tiếng Việt, ví dụ `docs(legal): …`, `feat(scripts): …`). Không commit khi test đỏ. Git identity cá nhân (`pnpm check:git`).

---

### Task 0: Kiểm tra trạng thái trước khi bắt đầu (DEVLOG mục 2, bước 2)

**Files:** không sửa mã.

- [x] **Step 1: Git sạch, đúng nhánh, đúng identity**

Run: `git status --short && git branch --show-current && pnpm check:git`
Expected: không có dòng thay đổi; `main`; check:git in OK (remote `github.com-dotienphong`, email cá nhân).

- [x] **Step 2: CI remote của commit đầu `main` xanh**

Run: `GH_TOKEN="$(cat ~/.config/gh-dotienphong.token)" gh run list --repo dotienphong/maps-library-vietnam --limit 6`
Expected: các workflow CI / Deploy API / Deploy Docs / API DB / DB tests của commit `f95cb2d` (hoặc mới hơn) đều `completed success`.

- [x] **Step 3: Runtime production còn sống**

Run:
```bash
curl -s https://api.ai-solutions.io.vn/healthz/db
curl -s -o /dev/null -w '%{http_code}\n' https://mapslibvn-docs.pages.dev/bat-dau/
```
Expected: `{"ok":true,"user":"api","version":"PostgreSQL 16.x"}` và `200`.

- [x] **Step 4: Analytics Engine đã có dữ liệu (chuẩn bị Task 6–7)**

Run (dùng token deploy hiện có chỉ để kiểm — token này có thể **không** có quyền Analytics Read; nếu trả `authentication error` thì ghi lại và chuyển sang bước tạo token ở Task 8, không chặn):
```bash
set -a; source .env; set +a
curl -s "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/analytics_engine/sql" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --data "SELECT blob3 AS path, SUM(_sample_interval) AS requests FROM mapslibvn_api WHERE timestamp > NOW() - INTERVAL '7' DAY GROUP BY path ORDER BY requests DESC LIMIT 5 FORMAT JSON"
```
Expected: JSON `{"meta":[…],"data":[{"path":"/v1/…","requests":…}],"rows":N}` (hoặc lỗi quyền — ghi vào DEVLOG mục 2 là việc tay Task 8).

- [x] **Step 5: Ghi DEVLOG mục 2**

Thay đoạn "BẮT ĐẦU TỪ ĐÂY: lập plan cấp bước M5" bằng:
```
**BẮT ĐẦU TỪ ĐÂY: thực thi plan M5 `docs/superpowers/plans/2026-09-02-m5-phat-hanh-noi-bo.md`, Task 1.**
Kết quả kiểm tra trước M5 (Task 0, <ngày>): git sạch trên `main`; CI remote xanh; `/healthz/db` ok;
Analytics SQL API: <có dữ liệu | token deploy thiếu quyền Analytics Read → tạo token riêng ở Task 8>.
```

- [x] **Step 6: Commit**

```bash
git add docs/DEVLOG.md docs/superpowers/plans/2026-09-02-m5-phat-hanh-noi-bo.md
git commit -m "docs: plan M5 phát hành nội bộ + kiểm tra trạng thái trước M5"
```

---

### Task 1: `LICENSE`, `THIRD_PARTY_NOTICES.md` và đồng bộ vào 3 gói SDK

**Files:**
- Create: `LICENSE`, `THIRD_PARTY_NOTICES.md`
- Create: `scripts/lib/notices.mjs`, `scripts/lib/notices.test.mjs`, `scripts/notices-sync.mjs`
- Modify: `packages/core/package.json`, `packages/web/package.json`, `packages/react/package.json` (`files`)
- Modify: `package.json` (script `notices:sync`), `.github/workflows/ci.yml`

- [x] **Step 1: Viết test thất bại cho helper đồng bộ (RED)**

Tạo `scripts/lib/notices.test.mjs`:

```js
import { describe, expect, it } from 'vitest';
import { NOTICE_FILES, SDK_PACKAGES, noticePlan, staleCopies } from './notices.mjs';

describe('noticePlan', () => {
  it('mỗi gói SDK nhận đủ LICENSE và THIRD_PARTY_NOTICES.md', () => {
    const plan = noticePlan();
    expect(NOTICE_FILES).toEqual(['LICENSE', 'THIRD_PARTY_NOTICES.md']);
    expect(SDK_PACKAGES).toEqual(['packages/core', 'packages/web', 'packages/react']);
    expect(plan).toHaveLength(6);
    expect(plan).toContainEqual({ src: 'LICENSE', dst: 'packages/web/LICENSE' });
    expect(plan).toContainEqual({
      src: 'THIRD_PARTY_NOTICES.md',
      dst: 'packages/react/THIRD_PARTY_NOTICES.md',
    });
  });
});

describe('staleCopies', () => {
  const files = {
    LICENSE: 'MIT',
    'THIRD_PARTY_NOTICES.md': 'notices v2',
    'packages/core/LICENSE': 'MIT',
    'packages/core/THIRD_PARTY_NOTICES.md': 'notices v1', // lệch
    'packages/web/LICENSE': 'MIT',
    'packages/web/THIRD_PARTY_NOTICES.md': 'notices v2',
    // packages/react thiếu cả hai
  };
  const read = (/** @type {string} */ p) => files[/** @type {keyof typeof files} */ (p)];

  it('liệt kê bản sao lệch hoặc thiếu, bỏ qua bản sao đúng', () => {
    expect(staleCopies(noticePlan(), read)).toEqual([
      'packages/core/THIRD_PARTY_NOTICES.md',
      'packages/react/LICENSE',
      'packages/react/THIRD_PARTY_NOTICES.md',
    ]);
  });

  it('trả mảng rỗng khi mọi bản sao khớp', () => {
    const all = { ...files, 'packages/core/THIRD_PARTY_NOTICES.md': 'notices v2',
      'packages/react/LICENSE': 'MIT', 'packages/react/THIRD_PARTY_NOTICES.md': 'notices v2' };
    expect(staleCopies(noticePlan(), (p) => all[/** @type {keyof typeof all} */ (p)])).toEqual([]);
  });
});
```

- [x] **Step 2: Chạy test, xác nhận đỏ**

Run: `pnpm exec vitest run scripts/lib/notices.test.mjs`
Expected: FAIL — `Failed to load url ./notices.mjs`.

- [x] **Step 3: Viết `scripts/lib/notices.mjs`**

```js
// Đồng bộ LICENSE + THIRD_PARTY_NOTICES.md từ gốc repo vào các gói SDK publish npm (spec 12.1).
export const NOTICE_FILES = ['LICENSE', 'THIRD_PARTY_NOTICES.md'];
export const SDK_PACKAGES = ['packages/core', 'packages/web', 'packages/react'];

/** @returns {{ src: string, dst: string }[]} */
export function noticePlan() {
  return SDK_PACKAGES.flatMap((pkg) =>
    NOTICE_FILES.map((file) => ({ src: file, dst: `${pkg}/${file}` })),
  );
}

/**
 * Bản sao thiếu hoặc khác nội dung gốc.
 * @param {{ src: string, dst: string }[]} plan
 * @param {(path: string) => string | undefined} read trả undefined nếu file không tồn tại
 */
export function staleCopies(plan, read) {
  return plan.filter(({ src, dst }) => read(dst) !== read(src)).map(({ dst }) => dst);
}
```

- [x] **Step 4: Chạy test, xác nhận xanh**

Run: `pnpm exec vitest run scripts/lib/notices.test.mjs`
Expected: PASS 3 test.

- [x] **Step 5: Viết `LICENSE` (MIT, gốc repo)**

```
MIT License

Copyright (c) 2026 Đỗ Tiến Phong (MapsLibVN)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Phạm vi MIT chỉ áp cho `packages/*` (spec 3.3); `apps/*`, `pipelines/*`, `infra/*`, `db/*` private — ghi rõ trong `THIRD_PARTY_NOTICES.md` mục 0.

- [x] **Step 6: Viết `THIRD_PARTY_NOTICES.md` — khung + nguyên văn giấy phép lấy từ `node_modules`**

Khung (viết tay):

```markdown
# Thông báo bên thứ ba — MapsLibVN SDK

Tài liệu này đi kèm các gói `@mapslibvn/core`, `@mapslibvn/web`, `@mapslibvn/react` (giấy phép MIT, xem `LICENSE`).
Phần mã máy chủ của MapsLibVN (`apps/*`, `pipelines/*`, `infra/*`, `db/*`) không được phân phối và không nằm trong phạm vi tài liệu này.

## 1. Thư viện được đóng gói hoặc là peer dependency của SDK

| Thành phần | Phiên bản | Giấy phép | Vai trò |
|---|---|---|---|
| maplibre-gl | ^5.0.0 (peer) | BSD-3-Clause | bộ vẽ bản đồ |
| pmtiles | ^4.3.0 | BSD-3-Clause | đọc tiles PMTiles qua HTTP Range |
| react / react-dom | >=18 (peer, chỉ `@mapslibvn/react`) | MIT | |

Nguyên văn giấy phép ở mục 4.

## 2. Dữ liệu và tài nguyên bản đồ mà SDK hiển thị (nghĩa vụ ghi nguồn — spec 12.3)

| Nguồn | Giấy phép | Ghi nguồn bắt buộc |
|---|---|---|
| OpenStreetMap contributors | ODbL 1.0 | `© OpenStreetMap contributors` → https://www.openstreetmap.org/copyright |
| OpenMapTiles (lược đồ tiles) | BSD-3-Clause (mã) + CC-BY 4.0 (thiết kế lược đồ) | `© OpenMapTiles` → https://openmaptiles.org/ |
| Overture Maps Foundation — Places | CDLA-Permissive 2.0 | `Places: Overture Maps Foundation` |
| Foursquare OS Places | Apache-2.0 | `Foursquare OS Places` |
| Noto Sans (glyph PBF) | SIL Open Font License 1.1 | — |
| Maki, Temaki (icon) | CC0 1.0 | — |
| osm-liberty (style gốc) | BSD-3-Clause | — |

Chuỗi ghi nguồn đầy đủ do API trả tại `GET /v1/attribution`; SDK luôn hiển thị và không có tuỳ chọn tắt.

## 3. Công cụ phía máy chủ (không phân phối, liệt kê để minh bạch)

Planetiler (Apache-2.0), tippecanoe (BSD-2-Clause), osmium-tool (GPL-3.0, chạy như công cụ dòng lệnh, không liên kết), pyosmium (BSD-2-Clause), DuckDB (MIT), PostgreSQL (PostgreSQL License), PostGIS (GPL-2.0, chạy như dịch vụ), Hono (MIT), cloudflared (Apache-2.0), Astro Starlight (MIT).

## 4. Nguyên văn giấy phép

### 4.1 maplibre-gl — BSD-3-Clause

<nguyên văn>

### 4.2 pmtiles — BSD-3-Clause

<nguyên văn>

### 4.3 React — MIT

<nguyên văn>

### 4.4 Noto Sans — SIL Open Font License 1.1

Bản đầy đủ: https://openfontlicense.org/open-font-license-official-text/ — phông không được bán riêng lẻ; được nhúng/phân phối kèm phần mềm.

### 4.5 Maki, Temaki — CC0 1.0 Universal

https://creativecommons.org/publicdomain/zero/1.0/
```

Điền `<nguyên văn>` bằng lệnh (không gõ tay để khỏi sai chữ):
```bash
cat packages/web/node_modules/maplibre-gl/LICENSE.txt
cat packages/web/node_modules/pmtiles/LICENSE
cat packages/react/node_modules/react/LICENSE
```
Nếu đường dẫn khác, tìm bằng `find node_modules/.pnpm -maxdepth 3 -path '*maplibre-gl@*' -name 'LICENSE*' | head -1`. Dán nguyên văn vào 3 mục 4.1–4.3.

- [x] **Step 7: Viết `scripts/notices-sync.mjs`**

```js
#!/usr/bin/env node
// Đồng bộ LICENSE + THIRD_PARTY_NOTICES.md vào các gói SDK. `--check` chỉ kiểm (CI), thoát 1 nếu lệch.
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { noticePlan, staleCopies } from './lib/notices.mjs';

/** @param {string} path */
const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined);

/** @param {string[]} argv */
export function main(argv) {
  const plan = noticePlan();
  const stale = staleCopies(plan, read);
  if (argv.includes('--check')) {
    if (stale.length > 0) {
      console.error(`Bản sao notices lệch gốc: ${stale.join(', ')} — chạy pnpm notices:sync`);
      return 1;
    }
    console.log('✓ notices trong 3 gói SDK khớp gốc');
    return 0;
  }
  for (const { src, dst } of plan) copyFileSync(src, dst);
  console.log(`đã đồng bộ ${plan.length} file (${stale.length} thay đổi)`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
```

- [x] **Step 8: Chạy đồng bộ, thêm `files` vào 3 package.json, script root, bước CI**

Run: `node scripts/notices-sync.mjs && node scripts/notices-sync.mjs --check`
Expected: `đã đồng bộ 6 file (6 thay đổi)` rồi `✓ notices trong 3 gói SDK khớp gốc`.

Sửa `"files": ["dist"]` → `"files": ["dist", "LICENSE", "THIRD_PARTY_NOTICES.md"]` trong `packages/core/package.json`, `packages/web/package.json`, `packages/react/package.json`.

Thêm vào `package.json` gốc (`scripts`, ngay sau `"lint:fix"`):
```json
    "notices:sync": "node scripts/notices-sync.mjs",
```

Thêm vào `.github/workflows/ci.yml` job `test`, ngay sau dòng `- run: pnpm lint`:
```yaml
      - run: node scripts/notices-sync.mjs --check
```

- [x] **Step 9: Kiểm gói npm chứa notices**

Run: `pnpm --filter @mapslibvn/core pack --pack-destination /tmp && tar -tzf /tmp/mapslibvn-core-0.1.0.tgz | grep -E 'LICENSE|THIRD_PARTY'`
Expected: `package/LICENSE` và `package/THIRD_PARTY_NOTICES.md`. Xoá tgz sau khi xem.

- [x] **Step 10: Gate + commit**

Run: `pnpm exec tsc -p tsconfig.scripts.json && pnpm exec biome check --write scripts/lib/notices.mjs scripts/lib/notices.test.mjs scripts/notices-sync.mjs && pnpm exec vitest run scripts/lib`
Expected: typecheck sạch; biome không lỗi; toàn bộ test `scripts/lib` xanh.

DEVLOG mục 1: "Task vừa xong: M5 T1 — LICENSE + THIRD_PARTY_NOTICES đóng gói vào 3 gói SDK, CI kiểm `--check`"; mục 2: "Kế tiếp: M5 Task 2"; mục 4 thêm dòng `- 2026-09-0x · M5 T1 · LICENSE + THIRD_PARTY_NOTICES + notices-sync · <sha>`.

```bash
git add LICENSE THIRD_PARTY_NOTICES.md scripts/lib/notices.mjs scripts/lib/notices.test.mjs scripts/notices-sync.mjs packages/*/LICENSE packages/*/THIRD_PARTY_NOTICES.md packages/core/package.json packages/web/package.json packages/react/package.json package.json .github/workflows/ci.yml docs/DEVLOG.md docs/superpowers/plans/2026-09-02-m5-phat-hanh-noi-bo.md
git commit -m "feat(legal): LICENSE MIT + THIRD_PARTY_NOTICES đóng gói trong SDK, CI kiểm đồng bộ"
```

---

### Task 2: Điều khoản tenant + sinh 2 trang docs từ file canonical

**Files:**
- Create: `docs/legal/dieu-khoan-tenant.md`
- Create: `apps/docs/scripts/copy-legal.mjs`
- Modify: `apps/docs/package.json` (`prebuild`, `predev`), `.gitignore`, `apps/docs/astro.config.mjs`

- [x] **Step 1: Viết `docs/legal/dieu-khoan-tenant.md`**

```markdown
# Điều khoản sử dụng MapsLibVN dành cho tenant

*Bản nội bộ 1.0 — 02/09/2026. Áp dụng cho các ứng dụng nhúng MapsLibVN trong giai đoạn nội bộ. Chưa được luật sư rà soát; xem `docs/legal/checklist-phap-ly.md`.*

## 1. Định nghĩa

- **MapsLibVN**: nền tảng bản đồ (tiles, Places API, SDK web/React) do Đỗ Tiến Phong vận hành.
- **Tenant**: tổ chức hoặc cá nhân được cấp khoá API (`mlv_live_…`) để nhúng MapsLibVN vào ứng dụng của mình.
- **Người dùng cuối**: người sử dụng ứng dụng của tenant.
- **Dữ liệu nền**: dữ liệu bản đồ và địa điểm MapsLibVN cung cấp qua tiles và API, gồm dữ liệu OpenStreetMap (ODbL), Overture Maps (CDLA-Permissive 2.0), Foursquare OS Places (Apache-2.0) và dữ liệu do người dùng đóng góp.

## 2. Khoá API

1. Khoá `web` gắn với danh sách origin (`allowed_origins`); khoá `server` là bí mật, chỉ dùng phía máy chủ; khoá `mobile` gắn bundle id.
2. Tenant chịu trách nhiệm cho mọi request mang khoá của mình. Khoá bị lộ phải báo để thu hồi và cấp lại.
3. MapsLibVN có thể tạm ngưng khoá khi phát hiện vi phạm mục 4 hoặc tải bất thường gây ảnh hưởng tenant khác; sẽ thông báo qua email đăng ký.
4. Giai đoạn nội bộ: không thu phí, không cam kết SLA. Hạn mức (quota) có thể được áp dụng khi chuyển sang giai đoạn thương mại và sẽ được báo trước 30 ngày.

## 3. Ghi nguồn (attribution)

1. Tenant **phải giữ nguyên** chuỗi ghi nguồn do SDK hiển thị hoặc do `GET /v1/attribution` trả về, gồm ít nhất: `© MapsLibVN · © OpenStreetMap contributors (ODbL) · © OpenMapTiles · Places: Overture Maps Foundation (CDLA-Permissive 2.0), Foursquare OS Places (Apache-2.0)`.
2. Không được che, thu nhỏ đến mức không đọc được, hoặc gỡ điều khiển attribution của SDK. Chế độ `compact` được phép.
3. Khi hiển thị kết quả API ngoài bản đồ (danh sách, chi tiết địa điểm), tenant phải kèm dòng ghi nguồn dạng văn bản ở cùng màn hình.

## 4. Hành vi bị cấm

1. **Cào hoặc xuất hàng loạt** dữ liệu nền: gọi API có hệ thống để tái tạo kho địa điểm, tải toàn bộ tiles để lưu ngoài, hoặc lưu kết quả API quá 24 giờ ngoài mục đích cache hiển thị.
2. Bán lại, cấp phép lại hoặc cung cấp API/tiles MapsLibVN cho bên thứ ba như một dịch vụ độc lập.
3. Dùng dữ liệu nền để xây dựng cơ sở dữ liệu địa điểm cạnh tranh hoặc để huấn luyện mô hình mà không có thoả thuận riêng.
4. Chỉnh sửa hoặc che khuất các yếu tố thể hiện chủ quyền lãnh thổ Việt Nam trên bản đồ.
5. Vượt qua cơ chế kiểm origin, quota hoặc giả mạo header định danh.

Nếu tenant cần dữ liệu OSM dẫn xuất theo ODbL, hãy yêu cầu bản xuất chính thức (mục 6) thay vì cào API.

## 5. Dữ liệu cá nhân và vị trí (Nghị định 13/2023/NĐ-CP)

1. MapsLibVN **không nhận** dữ liệu định danh người dùng cuối. Khi gửi đóng góp (`POST /v1/edits`), SDK chỉ gửi mã băm không đảo ngược của định danh người dùng (`end_user_hash`) và MapsLibVN lưu mã băm IP có muối theo ngày để chống spam; địa chỉ IP thô không được lưu.
2. **Tenant là bên kiểm soát dữ liệu** đối với người dùng cuối của mình: tenant chịu trách nhiệm xin và ghi nhận sự đồng ý khi truy cập vị trí thiết bị, thông báo mục đích xử lý, và đáp ứng quyền của chủ thể dữ liệu theo Nghị định 13/2023.
3. Tenant không được truyền vào API các trường chứa dữ liệu cá nhân nhạy cảm (số điện thoại, email, CMND/CCCD) ngoài các trường công khai của địa điểm (`name`, `phone` của cơ sở kinh doanh, `website`, `hours`).
4. Log request của MapsLibVN giữ tối đa 30 ngày; số liệu tổng hợp (Analytics Engine) không chứa định danh người dùng cuối.

## 6. Dữ liệu người dùng đóng góp và ODbL

1. Đóng góp gửi qua `POST /v1/edits` được cấp cho MapsLibVN quyền sử dụng, sửa đổi, phân phối không giới hạn thời gian; tenant bảo đảm người dùng cuối đã đồng ý điều này trong điều khoản của ứng dụng.
2. Dữ liệu OSM và các bảng dẫn xuất thuần OSM (đường, hẻm, ranh giới hành chính) là Derivative Database của OpenStreetMap theo ODbL 1.0; MapsLibVN cung cấp bản xuất (`export:odbl`) khi có yêu cầu qua email ở mục 10. Bản đồ và kết quả API là Produced Work theo ODbL, chỉ yêu cầu ghi nguồn.

## 7. Độ chính xác và giới hạn trách nhiệm

1. Dữ liệu nền được tổng hợp từ nguồn mở và đóng góp cộng đồng; MapsLibVN **không bảo đảm** tính chính xác, đầy đủ hay cập nhật. Mỗi kết quả geocode kèm `precision` và `confidence` — tenant phải dùng chúng khi ra quyết định (xem trang "Độ chính xác geocode").
2. Không dùng MapsLibVN cho mục đích mà sai lệch vị trí có thể gây thiệt hại về người hoặc tài sản (điều hướng khẩn cấp, hàng không, hàng hải) nếu không có nguồn xác minh độc lập.
3. Trong mọi trường hợp, trách nhiệm của MapsLibVN đối với tenant không vượt quá số tiền tenant đã trả trong 12 tháng gần nhất (giai đoạn nội bộ: 0 đ).

## 8. Thay đổi dịch vụ

MapsLibVN có thể thay đổi API, style, domain hoặc điều khoản này; thay đổi không tương thích ngược sẽ được báo trước ít nhất 30 ngày qua email đăng ký và trang docs. Domain tiles/API hiện tại (`tiles.ai-solutions.io.vn`, `api.ai-solutions.io.vn`) là tạm thời trong giai đoạn nội bộ.

## 9. Chấm dứt

Tenant có thể ngừng sử dụng bất kỳ lúc nào. MapsLibVN thu hồi khoá khi tenant vi phạm mục 3–5 và không khắc phục trong 7 ngày sau thông báo, hoặc ngay lập tức nếu vi phạm gây hại cho hệ thống hoặc bên thứ ba.

## 10. Liên hệ

Email: dotienphong1993@gmail.com — ghi tiêu đề `[MapsLibVN]`. Yêu cầu bản xuất ODbL, báo lộ khoá, báo sai dữ liệu chủ quyền: gửi cùng địa chỉ này.
```

- [x] **Step 2: Viết `apps/docs/scripts/copy-legal.mjs`**

```js
#!/usr/bin/env node
// Sinh 2 trang docs từ file canonical ở gốc repo (một nguồn sự thật, không copy tay):
//   docs/legal/dieu-khoan-tenant.md → src/content/docs/dieu-khoan.md
//   THIRD_PARTY_NOTICES.md          → src/content/docs/thong-bao-ben-thu-ba.md
// Starlight tự vẽ H1 từ frontmatter nên bỏ dòng H1 đầu của file gốc. Hai file sinh nằm trong .gitignore.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PAGES = [
  {
    src: '../../docs/legal/dieu-khoan-tenant.md',
    dst: 'src/content/docs/dieu-khoan.md',
    title: 'Điều khoản tenant',
    description: 'Điều khoản sử dụng MapsLibVN dành cho ứng dụng nhúng: khoá API, ghi nguồn, cấm cào dữ liệu, dữ liệu cá nhân.',
  },
  {
    src: '../../THIRD_PARTY_NOTICES.md',
    dst: 'src/content/docs/thong-bao-ben-thu-ba.md',
    title: 'Thông báo bên thứ ba',
    description: 'Giấy phép của thư viện, phông, icon và dữ liệu mà SDK MapsLibVN sử dụng.',
  },
];

/**
 * @param {{ title: string, description: string }} meta
 * @param {string} body
 */
export function withFrontmatter(meta, body) {
  const withoutH1 = body.replace(/^# .*\n+/, '');
  return `---\ntitle: ${JSON.stringify(meta.title)}\ndescription: ${JSON.stringify(meta.description)}\n---\n\n${withoutH1}`;
}

for (const page of PAGES) {
  const src = resolve(page.src);
  if (!existsSync(src)) throw new Error(`Thiếu ${page.src}`);
  writeFileSync(resolve(page.dst), withFrontmatter(page, readFileSync(src, 'utf8')));
}
console.log(`✓ sinh ${PAGES.length} trang pháp lý vào src/content/docs`);
```

- [x] **Step 3: Nối vào prebuild/predev, gitignore, sidebar**

`apps/docs/package.json`:
```json
    "prebuild": "node scripts/copy-sdk.mjs && node scripts/copy-legal.mjs",
    "predev": "node scripts/copy-sdk.mjs && node scripts/copy-legal.mjs",
```

`.gitignore` thêm cuối file:
```
# Trang docs sinh lúc prebuild từ docs/legal + THIRD_PARTY_NOTICES.md (apps/docs/scripts/copy-legal.mjs)
apps/docs/src/content/docs/dieu-khoan.md
apps/docs/src/content/docs/thong-bao-ben-thu-ba.md
```

`.github/workflows/deploy-docs.yml` — sửa filter `paths` để đổi file canonical cũng deploy docs:
```yaml
    paths: ['apps/docs/**', 'packages/web/**', 'packages/core/**', 'packages/react/**', 'docs/legal/**', 'THIRD_PARTY_NOTICES.md', 'pnpm-lock.yaml']
```

`apps/docs/astro.config.mjs` — thay mảng `sidebar` bằng (Task 3 sẽ thêm 3 mục nữa vào nhóm "Hướng dẫn"):
```js
      sidebar: [
        {
          label: 'Hướng dẫn',
          items: [
            { label: 'Bắt đầu 5 phút', slug: 'bat-dau' },
            { label: 'Đóng góp & sửa POI', slug: 'dong-gop' },
          ],
        },
        {
          label: 'Pháp lý',
          items: [
            { label: 'Điều khoản tenant', slug: 'dieu-khoan' },
            { label: 'Thông báo bên thứ ba', slug: 'thong-bao-ben-thu-ba' },
          ],
        },
        { label: 'Playground', link: '/playground.html' },
      ],
```

- [x] **Step 4: Build docs, kiểm 2 trang có**

Run: `pnpm --filter @mapslibvn/web build && pnpm --filter @mapslibvn/docs build && ls apps/docs/dist/dieu-khoan apps/docs/dist/thong-bao-ben-thu-ba && git status --short apps/docs/src/content`
Expected: prebuild in `✓ sinh 2 trang pháp lý`; hai thư mục có `index.html`; `git status` **không** liệt kê 2 file sinh.

Run: `pnpm --filter @mapslibvn/docs typecheck`
Expected: `astro check` 0 lỗi.

- [x] **Step 5: Commit**

DEVLOG mục 1/2/4 như Task 1.

```bash
git add docs/legal/dieu-khoan-tenant.md apps/docs/scripts/copy-legal.mjs apps/docs/package.json .gitignore .github/workflows/deploy-docs.yml apps/docs/astro.config.mjs docs/DEVLOG.md docs/superpowers/plans/2026-09-02-m5-phat-hanh-noi-bo.md
git commit -m "docs(legal): điều khoản tenant + sinh trang Pháp lý trên docs lúc prebuild"
```

---

### Task 3: Ba trang docs mới, URL thật, link check Playwright

**Files:**
- Create: `apps/docs/src/content/docs/giay-phep.md`, `do-chinh-xac.md`, `tu-host.md`
- Create: `apps/docs/e2e/docs.spec.ts`
- Modify: `apps/docs/src/content/docs/bat-dau.md`, `index.mdx`, `apps/docs/astro.config.mjs`

- [x] **Step 1: Viết test link check thất bại trước (RED)**

Tạo `apps/docs/e2e/docs.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

// 5 trang spec 7.4 + 2 trang pháp lý sinh lúc prebuild (Task 2). Chỉ kiểm link nội bộ để CI không cần Internet.
const PAGES = [
  '/',
  '/bat-dau/',
  '/tu-host/',
  '/giay-phep/',
  '/do-chinh-xac/',
  '/dong-gop/',
  '/dieu-khoan/',
  '/thong-bao-ben-thu-ba/',
];

for (const path of PAGES) {
  test(`trang ${path} tải được và link nội bộ không vỡ`, async ({ page, request }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.locator('h1').first()).toBeVisible();

    const hrefs = await page.locator('a[href^="/"]').evaluateAll((links) =>
      links.map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? ''),
    );
    const unique = [...new Set(hrefs.map((h) => h.split('#')[0]).filter(Boolean))];
    expect(unique.length).toBeGreaterThan(0);
    for (const href of unique) {
      const r = await request.get(href);
      expect(r.status(), `link vỡ: ${href} trên ${path}`).toBeLessThan(400);
    }
  });
}
```

- [x] **Step 2: Chạy, xác nhận đỏ ở 3 trang chưa có**

Run: `pnpm --filter @mapslibvn/docs build && pnpm --filter @mapslibvn/docs e2e -- docs.spec.ts`
Expected: FAIL cho `/tu-host/`, `/giay-phep/`, `/do-chinh-xac/` (status 404); các trang khác PASS.

- [x] **Step 3: Viết `apps/docs/src/content/docs/giay-phep.md`**

```markdown
---
title: Giấy phép & ghi nguồn
description: SDK MIT; dữ liệu OpenStreetMap (ODbL), Overture (CDLA-Permissive 2.0), Foursquare OS Places (Apache-2.0); chuỗi ghi nguồn bắt buộc.
---

## 1. Mã nguồn SDK — MIT

`@mapslibvn/core`, `@mapslibvn/web`, `@mapslibvn/react` phát hành theo giấy phép **MIT**. Bạn được dùng thương mại, sửa, phân phối lại; chỉ cần giữ thông báo bản quyền. Mỗi gói kèm `LICENSE` và `THIRD_PARTY_NOTICES.md` — xem [Thông báo bên thứ ba](/thong-bao-ben-thu-ba/).

Phần máy chủ (Worker API, pipeline dữ liệu, hạ tầng) không được phân phối trong giai đoạn nội bộ.

## 2. Dữ liệu — bốn nguồn, bốn giấy phép

| Nguồn | Dùng cho | Giấy phép | Nghĩa vụ của bạn |
|---|---|---|---|
| OpenStreetMap contributors | tiles nền, đường, hẻm, ranh giới, một phần POI | ODbL 1.0 | giữ ghi nguồn `© OpenStreetMap contributors` |
| OpenMapTiles | lược đồ lớp tiles | BSD-3-Clause + CC-BY 4.0 | giữ ghi nguồn `© OpenMapTiles` |
| Overture Maps Foundation | địa điểm (POI) | CDLA-Permissive 2.0 | giữ ghi nguồn |
| Foursquare OS Places | địa điểm (POI) | Apache-2.0 | giữ ghi nguồn |

Dữ liệu người dùng đóng góp qua [Đóng góp & sửa POI](/dong-gop/) là dữ liệu riêng của MapsLibVN.

## 3. Chuỗi ghi nguồn bắt buộc

SDK luôn hiển thị điều khiển attribution (tuỳ chọn `compact`, **không có tuỳ chọn tắt**). Nếu bạn hiển thị kết quả API ngoài bản đồ, hãy kèm chuỗi từ `GET /v1/attribution`:

```
© MapsLibVN · © OpenStreetMap contributors (ODbL) · © OpenMapTiles · Places: Overture Maps Foundation (CDLA-Permissive 2.0), Foursquare OS Places (Apache-2.0)
```

```js
import { createClient } from '@mapslibvn/core';
const client = createClient({ apiKey: 'mlv_live_…', baseUrl: 'https://api.ai-solutions.io.vn' });
const { text, html, links } = await client.attribution();
```

## 4. ODbL — cách MapsLibVN áp dụng

- Dữ liệu OSM nằm trong bảng riêng; bảng đường, hẻm, ranh giới hành chính dẫn xuất thuần từ OSM là **Derivative Database** theo ODbL. MapsLibVN cung cấp bản xuất (CSV + WKT, kèm manifest) khi có yêu cầu — liên hệ theo [Điều khoản tenant](/dieu-khoan/) mục 10.
- Bản ghi địa điểm của MapsLibVN chép trường từ **đúng một** nguồn và chỉ liên kết các nguồn khác bằng ID (mô hình Collective Database), không trộn trường giữa nguồn.
- Bản đồ hiển thị và kết quả API là **Produced Work**: chỉ yêu cầu ghi nguồn, không yêu cầu chia sẻ lại.

## 5. Phông và icon

Noto Sans (SIL OFL 1.1), Maki và Temaki (CC0), style gốc osm-liberty (BSD-3-Clause). Tất cả tự host, không gọi CDN bên thứ ba.

## 6. Pháp luật Việt Nam

- Bản đồ thể hiện đầy đủ chủ quyền Việt Nam (Hoàng Sa, Trường Sa) ở mọi mức zoom; đây là yêu cầu kỹ thuật bắt buộc của pipeline tiles và là điều kiện sử dụng (xem [Điều khoản tenant](/dieu-khoan/) mục 4).
- Giai đoạn hiện tại là **sử dụng nội bộ**, chưa kinh doanh. Việc xin giấy phép hoạt động đo đạc và bản đồ (Điều 51 Luật Đo đạc và bản đồ 2018) sẽ được xác nhận với luật sư trước khi thương mại hoá.
- Về dữ liệu cá nhân (Nghị định 13/2023): MapsLibVN không nhận định danh người dùng cuối; nghĩa vụ xin phép vị trí thuộc ứng dụng nhúng.
```

- [x] **Step 4: Viết `apps/docs/src/content/docs/do-chinh-xac.md`**

```markdown
---
title: Độ chính xác geocode
description: Ý nghĩa của precision và confidence trong kết quả /v1/geocode và /v1/reverse; cách dùng đúng trong ứng dụng.
---

Mọi kết quả geocode của MapsLibVN kèm hai trường: `precision` (mức phân giải) và `confidence` (độ tin, 0–1). Ứng dụng **phải** đọc hai trường này trước khi dùng toạ độ — đây là nguyên tắc "trung thực về độ chính xác" của MapsLibVN.

## 1. Thang phân giải

API thử lần lượt từ mức chi tiết nhất, dừng ở mức đầu tiên có kết quả:

| `precision` | Khi nào | Vị trí trả về | `confidence` |
|---|---|---|---|
| `rooftop` | có mốc địa chỉ cùng số nhà (kể cả chuỗi hẻm `88/9`) và cùng đường | toạ độ mốc | 0,9 (0,95 nếu mốc do người dùng đóng góp) |
| `alley` | biết hẻm nhưng không có mốc số nhà | điểm trên hẻm, cách cửa hẻm ≈ 6 m × vị trí số nhà, tối đa chiều dài hẻm | 0,7 |
| `interpolated` | có mốc số nhỏ hơn và số lớn hơn cùng đường, cùng chẵn/lẻ, cách nhau ≤ 400 m | nội suy tuyến tính theo hình đường | 0,6 |
| `street` | chỉ khớp tên đường (trong phường/tỉnh đã nêu hoặc gần `near`) | điểm giữa tuyến đường | 0,4 |
| `ward` / `province` | chỉ khớp phường/xã hoặc tỉnh/thành | tâm đơn vị hành chính | 0,2 |

Đường trùng tên ở nhiều nơi (ví dụ 5 đường "Nguyễn Lâm"): API ưu tiên phường/tỉnh trong câu, rồi `near`, rồi trả nhiều kết quả (tối đa `limit`).

## 2. Ví dụ

```bash
curl "https://api.ai-solutions.io.vn/v1/geocode?q=88/9%20Nguy%E1%BB%85n%20L%C3%A2m,%20Ph%C6%B0%E1%BB%9Dng%206,%20Qu%E1%BA%A3n%2010" \
  -H "X-Api-Key: mlv_live_…"
```

```json
{
  "results": [
    {
      "lat": 10.7712,
      "lng": 106.6698,
      "precision": "alley",
      "confidence": 0.7,
      "address": { "housenumber": "88/9", "street": "Nguyễn Lâm", "ward": "Phường 6", "province": "Thành phố Hồ Chí Minh" }
    }
  ],
  "attribution": { "text": "© MapsLibVN · © OpenStreetMap contributors (ODbL) · …" }
}
```

## 3. Dùng đúng trong ứng dụng

- **Ghim marker chính xác** chỉ khi `precision` là `rooftop`. Với `alley` và `interpolated`, hiện vòng tròn bán kính 30–80 m hoặc ghi "≈".
- **Không tự động điều hướng** (giao hàng, đón khách) khi `confidence < 0,6`; hãy hỏi lại người dùng hoặc cho họ kéo marker.
- **`street`, `ward`, `province`** chỉ nên dùng để căn khung nhìn bản đồ, không dùng làm toạ độ điểm đến.
- Kết quả `reverse` trả khoảng số nhà ước lượng ("≈ 86–90 Nguyễn Lâm") khi có hai mốc cùng đường ở hai phía; nếu không, trả "gần *POI gần nhất*, *đường*, *phường*".
- Người dùng có thể sửa vị trí sai qua [Đóng góp & sửa POI](/dong-gop/); mốc địa chỉ do người dùng xác nhận được ưu tiên (`confidence` 0,95) ở lần geocode sau.

## 4. Giới hạn đã biết

- Tên phường/xã sau sắp xếp hành chính 2025 được ánh xạ từ tên cũ bằng bảng alias; một số alias còn thiếu nên câu địa chỉ dùng tên cũ có thể rơi xuống `province`.
- Số nhà không theo quy luật chẵn/lẻ (khu đô thị mới, số nhà cũ/mới song song) làm `interpolated` lệch — hãy xem `confidence` 0,6 là "cần xác minh".
- Dữ liệu ngoài đô thị thưa hơn TP.HCM/Hà Nội.
```

- [x] **Step 5: Viết `apps/docs/src/content/docs/tu-host.md`**

```markdown
---
title: Tự host
description: Dựng lại toàn bộ MapsLibVN từ repo — tiles trên R2, Worker API, Postgres/PostGIS trên máy nội bộ qua Cloudflare Tunnel — bằng các lệnh một dòng.
---

MapsLibVN được thiết kế để dựng lại **bằng một lệnh** trên macOS, Windows (WSL2) hay Linux. Trang này tóm tắt đường đi; chi tiết từng bước nằm trong repo (`infra/server/README.md`, `docs/DEVLOG.md`). Repo hiện **private** trong giai đoạn nội bộ — liên hệ theo [Điều khoản tenant](/dieu-khoan/) mục 10 để được cấp quyền.

## 1. Kiến trúc cần dựng

| Thành phần | Chạy ở đâu | Chi phí |
|---|---|---|
| Tiles PMTiles (nền VN + POI) | Cloudflare R2 + custom domain, đọc thẳng bằng HTTP Range | 0 đ egress |
| Places API (`/v1/*`), styles, trang admin | Cloudflare Worker (Hono) | Workers Free đủ cho nội bộ |
| Postgres 16 + PostGIS | máy nội bộ 24/7 (Docker), nối qua Cloudflare Tunnel → Access → Hyperdrive | điện + máy |
| Pipeline dữ liệu (OSM, Overture, Foursquare) | container `pipeline` trên máy chủ, cron thứ Hai 02:00 | — |
| Docs | Cloudflare Pages | 0 đ |

## 2. Máy dev — 2 thứ cài trên host

Docker Desktop (hoặc Docker Engine) và Node 22 (`fnm` + `corepack enable`). Mọi công cụ khác (Planetiler, tippecanoe, osmium, DuckDB, Postgres, cloudflared) nằm trong Docker.

```bash
git clone <repo> && cd maps-library-vietnam
pnpm install && pnpm run setup      # tạo .env, Postgres dev, migration, fixture Quận 1
pnpm dev                            # playground + wrangler dev
```

## 3. Máy chủ nội bộ 24/7

Máy ≥ 8 GB RAM, SSD ≥ 50 GB, Docker. Không dùng laptop làm việc; khuyến nghị UPS.

```bash
pnpm server:setup                   # sinh infra/server/.env, cert TLS, compose up, migration, in checklist
```

Việc tay một lần trên Cloudflare (theo checklist script in ra): tạo **Tunnel** `mapslibvn-db` (hostname TCP `maps-db.<domain>` → `postgres:5432`), **Service token** + **Access application** bảo vệ hostname đó, **Hyperdrive** trỏ tới hostname qua Access (user `api`, SSL `require`). Dán Hyperdrive ID vào `apps/api/wrangler.toml`.

Bốn dịch vụ compose: `postgres` (TLS bắt buộc, không mở cổng), `cloudflared`, `backup` (`pg_dump` 03:00 → R2, giữ 7 ngày + 4 tuần), `pipeline` (cron `data:update` + báo cáo tuần).

Chuyển máy: `pnpm server:setup` trên máy mới → `pnpm db:restore --latest` → dán lại `TUNNEL_TOKEN`. Dưới 1 giờ.

## 4. Tiles và dữ liệu

```bash
pnpm data:update --tiles            # build tiles nền VN (Planetiler) + QA chủ quyền + upload R2 + manifest KV
pnpm data:update                    # POI: OSM + Overture + Foursquare → gộp → Postgres → poi-YYYYMMDD.pmtiles
pnpm data:rollback                  # đổi manifest về bản trước (tức thì)
pnpm export:odbl                    # xuất các bảng dẫn xuất OSM theo ODbL
```

Bước chủ quyền (Hoàng Sa, Trường Sa) là **bắt buộc** trong pipeline tiles: patch dữ liệu trước Planetiler, lớp `sovereignty` trong style, và QA chặn publish nếu thiếu.

## 5. Worker API và docs

```bash
cd apps/api && pnpm exec wrangler deploy --env production   # cần R2, KV META, Hyperdrive, Analytics Engine trong wrangler.toml
pnpm --filter @mapslibvn/docs build && pnpm --filter @mapslibvn/docs exec wrangler pages deploy dist --project-name <pages-project>
```

Biến Worker cần có (`[env.production]`): `TILES_BASE`, `ENVIRONMENT`, `QUOTA_ENABLED`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` (bảo vệ `/admin` bằng Cloudflare Access). Seed khoá API: `pnpm db:seed-tenant` rồi `pnpm key:issue …`.

## 6. Giám sát

Cloudflare Tunnel health (email khi tunnel down), Workers metrics (5xx, p95) trên dashboard, báo cáo tuần tự động từ Analytics Engine gửi email (`scripts/weekly-report.mjs`, chạy trong container `pipeline` thứ Hai 08:00).
```

- [x] **Step 6: Sửa URL thật trong `bat-dau.md`, thêm card ở `index.mdx`, thêm sidebar**

Run: `grep -rn "example.com" apps/docs/src`
Thay **mọi** `https://maps-docs.example.com` → `https://mapslibvn-docs.pages.dev` và `https://maps-api.example.com` → `https://api.ai-solutions.io.vn` (dùng `sed -i '' 's#https://maps-docs.example.com#https://mapslibvn-docs.pages.dev#g; s#https://maps-api.example.com#https://api.ai-solutions.io.vn#g' <file>` cho từng file grep ra). Chạy grep lại → không còn kết quả.

`apps/docs/src/content/docs/index.mdx` — thêm một `Card` vào cuối `CardGrid`:
```mdx
  <Card title="Trung thực về độ chính xác" icon="approve-check">Mỗi kết quả geocode kèm `precision` và `confidence`. Xem [Độ chính xác geocode](/do-chinh-xac/).</Card>
```

`apps/docs/astro.config.mjs` — nhóm "Hướng dẫn" thành:
```js
          items: [
            { label: 'Bắt đầu 5 phút', slug: 'bat-dau' },
            { label: 'Độ chính xác geocode', slug: 'do-chinh-xac' },
            { label: 'Đóng góp & sửa POI', slug: 'dong-gop' },
            { label: 'Tự host', slug: 'tu-host' },
          ],
```
và nhóm "Pháp lý" thêm dòng đầu `{ label: 'Giấy phép & ghi nguồn', slug: 'giay-phep' },`.

- [x] **Step 7: Build + link check xanh**

Run: `pnpm --filter @mapslibvn/docs build && pnpm --filter @mapslibvn/docs typecheck && pnpm --filter @mapslibvn/docs e2e`
Expected: build liệt kê đủ trang; `astro check` 0 lỗi; Playwright PASS 8 test docs + 3 test playground cũ.

- [x] **Step 8: Commit**

DEVLOG mục 1/2/4.

```bash
git add apps/docs/src/content/docs apps/docs/e2e/docs.spec.ts apps/docs/astro.config.mjs docs/DEVLOG.md docs/superpowers/plans/2026-09-02-m5-phat-hanh-noi-bo.md
git commit -m "docs: trang Giấy phép, Độ chính xác geocode, Tự host + URL production + link check Playwright"
```

Sau push, kiểm `Deploy Docs` xanh và `curl -s -o /dev/null -w '%{http_code}' https://mapslibvn-docs.pages.dev/giay-phep/` → `200`.

---

### Task 4: Tenant ứng dụng nhúng thử nghiệm + script cấp khoá ngẫu nhiên

**Files:**
- Create: `db/seed/tenant_nhung_thu.sql`
- Create: `scripts/lib/api-key.mjs`, `scripts/lib/api-key.test.mjs`, `scripts/api-key-issue.mjs`
- Modify: `package.json` (script `key:issue`)

- [x] **Step 1: Test thất bại trước (RED)**

Tạo `scripts/lib/api-key.test.mjs`:

```js
import { describe, expect, it } from 'vitest';
import { KEY_RE, generateKey, parseIssueArgs } from './api-key.mjs';

describe('generateKey', () => {
  it('khớp ràng buộc DB ^mlv_live_[0-9A-Za-z]{24}$ và khác nhau mỗi lần', () => {
    const a = generateKey();
    const b = generateKey();
    expect(a).toMatch(KEY_RE);
    expect(b).toMatch(KEY_RE);
    expect(a).not.toBe(b);
  });

  it('bỏ byte >= 248 để không thiên lệch (rejection sampling)', () => {
    // 250 bị bỏ; 0→'0', 61→'z', 62→'0' (62 % 62), 123→'z' (123 % 62 = 61)
    const bytes = [250, 0, 61, 62, 123, ...new Array(20).fill(1)];
    const key = generateKey(() => Buffer.from(bytes));
    expect(key).toBe(`mlv_live_0z0z${'1'.repeat(20)}`);
  });
});

describe('parseIssueArgs', () => {
  it('đọc tenant/label/kind/origins/scopes', () => {
    expect(
      parseIssueArgs([
        '--tenant', '00000000-0000-4000-8000-000000000002',
        '--label', 'ứng dụng nhúng thử web',
        '--kind', 'web',
        '--origins', 'https://ungdung.example.vn,https://*.ungdung.example.vn',
      ]),
    ).toEqual({
      tenant: '00000000-0000-4000-8000-000000000002',
      label: 'ứng dụng nhúng thử web',
      kind: 'web',
      origins: ['https://ungdung.example.vn', 'https://*.ungdung.example.vn'],
      scopes: ['places:read'],
    });
  });

  it('từ chối kind lạ, origin không phải http(s), key web thiếu origins', () => {
    expect(() => parseIssueArgs(['--tenant', 'x', '--kind', 'ftp'])).toThrow(/kind/);
    expect(() =>
      parseIssueArgs(['--tenant', 'x', '--kind', 'web', '--origins', 'ungdung.vn']),
    ).toThrow(/origin/);
    expect(() => parseIssueArgs(['--tenant', 'x', '--kind', 'web'])).toThrow(/origins/);
    expect(() => parseIssueArgs(['--kind', 'server'])).toThrow(/tenant/);
  });

  it('server không cần origins; scopes tuỳ chọn', () => {
    expect(parseIssueArgs(['--tenant', 'x', '--kind', 'server', '--scopes', 'places:read,edits:write']))
      .toEqual({ tenant: 'x', label: '', kind: 'server', origins: [], scopes: ['places:read', 'edits:write'] });
  });
});
```

- [x] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm exec vitest run scripts/lib/api-key.test.mjs`
Expected: FAIL — không load được `./api-key.mjs`.

- [x] **Step 3: Viết `scripts/lib/api-key.mjs`**

```js
import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const KEY_LEN = 24;
/** Ràng buộc CHECK của api_key.key (db/migrations/0005_tenant.sql). */
export const KEY_RE = /^mlv_live_[0-9A-Za-z]{24}$/;
export const KINDS = ['web', 'mobile', 'server'];

/**
 * Sinh key mlv_live_ + 24 ký tự [0-9A-Za-z]. Rejection sampling: bỏ byte >= 248 (248 = 4 × 62)
 * để 62 ký tự đều xác suất.
 * @param {(n: number) => Buffer} random
 */
export function generateKey(random = randomBytes) {
  let out = '';
  while (out.length < KEY_LEN) {
    for (const b of random(KEY_LEN)) {
      if (b >= 248) continue;
      out += ALPHABET[b % 62];
      if (out.length === KEY_LEN) break;
    }
  }
  return `mlv_live_${out}`;
}

/** @param {string} s */
const isOrigin = (s) => /^https?:\/\/[A-Za-z0-9*.-]+(:\d+)?$/.test(s);

/**
 * @param {string[]} argv
 * @returns {{ tenant: string, label: string, kind: string, origins: string[], scopes: string[] }}
 */
export function parseIssueArgs(argv) {
  /** @type {Record<string, string>} */
  const opt = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a?.startsWith('--')) {
      const v = argv[i + 1];
      opt[a.slice(2)] = v !== undefined && !v.startsWith('--') ? v : '';
      if (opt[a.slice(2)] !== '') i += 1;
    }
  }
  const tenant = opt.tenant ?? '';
  if (!tenant) throw new Error('Thiếu --tenant <uuid>');
  const kind = opt.kind ?? 'web';
  if (!KINDS.includes(kind)) throw new Error(`--kind phải là ${KINDS.join('|')}`);
  const origins = (opt.origins ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const o of origins) if (!isOrigin(o)) throw new Error(`origin không hợp lệ: ${o}`);
  if (kind === 'web' && origins.length === 0) throw new Error('key web bắt buộc --origins');
  const scopes = (opt.scopes ?? 'places:read').split(',').map((s) => s.trim()).filter(Boolean);
  return { tenant, label: opt.label ?? '', kind, origins, scopes };
}
```

- [x] **Step 4: Chạy test xanh**

Run: `pnpm exec vitest run scripts/lib/api-key.test.mjs`
Expected: PASS 5 test.

- [x] **Step 5: Viết `db/seed/tenant_nhung_thu.sql` và `scripts/api-key-issue.mjs`**

`db/seed/tenant_nhung_thu.sql`:
```sql
-- Tenant ứng dụng nhúng thử nghiệm của PHONG (M5, spec 13 hàng M5). Idempotent.
-- KHÔNG seed key ở đây: key sinh ngẫu nhiên bằng `pnpm key:issue` và không commit vào git
-- (quyết định thiết kế 3 của plan M5). Origin của app điền lúc cấp key.
INSERT INTO tenant (id, name, plan)
VALUES ('00000000-0000-4000-8000-000000000002', 'Ứng dụng nhúng thử nghiệm (nội bộ)', 'internal')
ON CONFLICT (id) DO NOTHING;
```

`scripts/api-key-issue.mjs`:
```js
#!/usr/bin/env node
// Cấp API key ngẫu nhiên cho một tenant đã seed. In key đúng một lần — lưu vào password manager.
//   pnpm key:issue --tenant 00000000-0000-4000-8000-000000000002 --label "ứng dụng nhúng thử web" \
//     --kind web --origins https://ungdung.example.vn,https://*.ungdung.example.vn [--scopes places:read]
// DB: DATABASE_URL hoặc POSTGRES_* (dev). Production: DATABASE_URL trỏ qua Tunnel (xem infra/server/README.md).
import 'dotenv/config';
import postgres from 'postgres';
import { generateKey, parseIssueArgs } from './lib/api-key.mjs';
import { databaseUrlFromEnv } from './lib/migrations.mjs';

const { tenant, label, kind, origins, scopes } = parseIssueArgs(process.argv.slice(2));
const key = generateKey();
const sql = postgres(databaseUrlFromEnv(process.env), { max: 1, onnotice: () => {} });
try {
  const [t] = await sql`SELECT name, plan FROM tenant WHERE id = ${tenant}`;
  if (!t) throw new Error(`Không có tenant ${tenant} — chạy pnpm db:seed-tenant db/seed/tenant_nhung_thu.sql trước`);
  await sql`
    INSERT INTO api_key (key, tenant_id, label, kind, allowed_origins, scopes)
    VALUES (${key}, ${tenant}, ${label}, ${kind}, ${origins}, ${scopes})`;
  console.log(`tenant : ${t.name} (${t.plan})`);
  console.log(`kind   : ${kind}  scopes: ${scopes.join(',')}  origins: ${origins.join(',') || '(không kiểm)'}`);
  console.log(`KEY    : ${key}`);
  console.log('Lưu key ngay — script không in lại. Thu hồi: UPDATE api_key SET active=false, revoked_at=now() WHERE key=…');
} finally {
  await sql.end({ timeout: 5 });
}
```

Thêm vào `package.json` gốc sau `"db:seed-tenant"`:
```json
    "key:issue": "node scripts/api-key-issue.mjs",
```

- [x] **Step 6: Thử trên DB dev**

Run:
```bash
pnpm db:up && pnpm db:migrate && pnpm db:seed-tenant db/seed/tenant_nhung_thu.sql
pnpm key:issue --tenant 00000000-0000-4000-8000-000000000002 --label "thử dev" --kind web --origins http://localhost
```
Expected: `đã nạp db/seed/tenant_nhung_thu.sql`; script in `KEY : mlv_live_` + 24 ký tự. Kiểm: `curl -s "http://localhost:8787/v1/autocomplete?q=cafe" -H "X-Api-Key: <key>" -H "Origin: http://localhost:4321"` sau `pnpm --filter @mapslibvn/api dev` trả JSON (không 401/403). Dọn: `psql … -c "DELETE FROM api_key WHERE label='thử dev'"` hoặc để yên (DB dev).

- [x] **Step 7: Gate + commit**

Run: `pnpm exec tsc -p tsconfig.scripts.json && pnpm exec biome check --write scripts/lib/api-key.mjs scripts/lib/api-key.test.mjs scripts/api-key-issue.mjs && pnpm exec vitest run scripts/lib`
Expected: sạch, xanh.

DEVLOG mục 1/2/4.

```bash
git add db/seed/tenant_nhung_thu.sql scripts/lib/api-key.mjs scripts/lib/api-key.test.mjs scripts/api-key-issue.mjs package.json docs/DEVLOG.md docs/superpowers/plans/2026-09-02-m5-phat-hanh-noi-bo.md
git commit -m "feat(db): tenant ứng dụng nhúng thử nghiệm + pnpm key:issue cấp khoá ngẫu nhiên"
```

---

### Task 5: `pnpm export:odbl` — xuất 5 bảng dẫn xuất OSM

**Files:**
- Create: `scripts/lib/odbl.mjs`, `scripts/lib/odbl.test.mjs`, `scripts/export-odbl.mjs`, `db/export-odbl.dbtest.mjs`
- Modify: `package.json` (script `export:odbl`)

- [x] **Step 1: Unit test thất bại trước (RED)**

Tạo `scripts/lib/odbl.test.mjs`:

```js
import { describe, expect, it } from 'vitest';
import { ODBL_TABLES, copySql, exportDirFor, readmeFor } from './odbl.mjs';

describe('ODBL_TABLES', () => {
  it('đúng 5 bảng spec 12.2, geometry xuất WKT', () => {
    expect(ODBL_TABLES.map((t) => t.name)).toEqual([
      'src_osm_place', 'admin_area', 'admin_alias', 'street', 'alley',
    ]);
    expect(copySql(ODBL_TABLES[0])).toBe(
      'COPY (SELECT osm_type, osm_id, name, names, tags, ST_AsText(geom) AS geom_wkt, release FROM src_osm_place) TO STDOUT WITH (FORMAT csv, HEADER true)',
    );
    expect(copySql(ODBL_TABLES[4])).toContain('ST_AsText(entrance) AS entrance_wkt');
  });
});

describe('exportDirFor', () => {
  it('thư mục theo ngày UTC yyyymmdd dưới base', () => {
    expect(exportDirFor(new Date('2026-09-07T01:00:00Z'), 'out/odbl')).toBe('out/odbl/20260907');
  });
});

describe('readmeFor', () => {
  it('ghi ODbL, attribution, ngày, số dòng mỗi bảng', () => {
    const md = readmeFor({
      date: '2026-09-07',
      osmRelease: '2026-08-27',
      counts: { src_osm_place: 228000, admin_area: 3400, admin_alias: 120, street: 91000, alley: 30000 },
    });
    expect(md).toContain('Open Database License (ODbL) 1.0');
    expect(md).toContain('© OpenStreetMap contributors');
    expect(md).toContain('| street | 91000 |');
    expect(md).toContain('OSM release: 2026-08-27');
  });
});
```

- [x] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm exec vitest run scripts/lib/odbl.test.mjs`
Expected: FAIL — không load được `./odbl.mjs`.

- [x] **Step 3: Viết `scripts/lib/odbl.mjs`**

```js
// Bảng Derivative Database của OSM (spec 12.2) và cách xuất chúng theo ODbL.
/** @typedef {{ name: string, columns: string[] }} OdblTable */

/** @type {OdblTable[]} */
export const ODBL_TABLES = [
  { name: 'src_osm_place', columns: ['osm_type', 'osm_id', 'name', 'names', 'tags', 'ST_AsText(geom) AS geom_wkt', 'release'] },
  { name: 'admin_area', columns: ['id', 'level', 'name', 'name_norm', 'parent_id', 'osm_relation_id', 'ST_AsText(geom) AS geom_wkt'] },
  { name: 'admin_alias', columns: ['alias_norm', 'level', 'admin_area_id', 'valid_until'] },
  { name: 'street', columns: ['id', 'osm_way_ids', 'name', 'name_norm', 'ward_norm', 'province_norm', 'ST_AsText(geom) AS geom_wkt'] },
  { name: 'alley', columns: ['id', 'osm_way_id', 'number', 'parent_street_id', 'name', 'ST_AsText(geom) AS geom_wkt', 'ST_AsText(entrance) AS entrance_wkt'] },
];

/** @param {OdblTable | undefined} table */
export function copySql(table) {
  if (!table) throw new Error('table undefined');
  return `COPY (SELECT ${table.columns.join(', ')} FROM ${table.name}) TO STDOUT WITH (FORMAT csv, HEADER true)`;
}

/** @param {Date} now @param {string} base */
export function exportDirFor(now, base) {
  const d = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `${base}/${d}`;
}

/**
 * @param {{ date: string, osmRelease: string, counts: Record<string, number> }} info
 */
export function readmeFor({ date, osmRelease, counts }) {
  const rows = ODBL_TABLES.map((t) => `| ${t.name} | ${counts[t.name] ?? 0} |`).join('\n');
  return `# MapsLibVN — bản xuất dữ liệu dẫn xuất OpenStreetMap

Ngày xuất: ${date} · OSM release: ${osmRelease}

Các bảng trong thư mục này là **Derivative Database** của OpenStreetMap và được cung cấp theo
**Open Database License (ODbL) 1.0** — https://opendatacommons.org/licenses/odbl/1-0/
Ghi nguồn bắt buộc: **© OpenStreetMap contributors** — https://www.openstreetmap.org/copyright

Định dạng: CSV nén gzip, dòng đầu là tên cột; geometry ở dạng WKT (EPSG:4326). \`manifest.json\` ghi số dòng và SHA-256 từng file.

| Bảng | Số dòng |
|---|---|
${rows}

Không nằm trong bản xuất này (không phải dẫn xuất OSM hoặc là dữ liệu riêng): \`poi\`, \`poi_source_link\`,
\`address_anchor\`, \`src_overture_place\` (CDLA-Permissive 2.0), \`src_fsq_place\` (Apache-2.0), \`poi_edit\`.
`;
}
```

- [x] **Step 4: Chạy unit test xanh**

Run: `pnpm exec vitest run scripts/lib/odbl.test.mjs`
Expected: PASS 3 test.

- [x] **Step 5: Viết dbtest thất bại (RED) — `db/export-odbl.dbtest.mjs`**

```js
// Chạy: pnpm exec vitest run --config vitest.db.config.ts db/export-odbl.dbtest.mjs (cần pnpm db:up && pnpm db:migrate).
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseUrlFromEnv } from '../scripts/lib/migrations.mjs';

const url = databaseUrlFromEnv(process.env);
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', 'postgres'].includes(host)) {
  throw new Error(`dbtest chỉ chạy trên DB local, không phải ${host}`);
}
const sql = postgres(url, { max: 1, onnotice: () => {} });
const out = mkdtempSync(join(tmpdir(), 'odbl-'));
const AREA_NAME = 'm5test Phường Xuất ODbL';

describe('export-odbl', () => {
  beforeAll(async () => {
    await sql`INSERT INTO admin_area (level, name, name_norm, geom)
      VALUES (8, ${AREA_NAME}, 'm5test phuong xuat odbl',
        ST_Multi(ST_GeomFromText('POLYGON((106.7 10.77,106.71 10.77,106.71 10.78,106.7 10.78,106.7 10.77))', 4326)))`;
  });
  afterAll(async () => {
    await sql`DELETE FROM admin_area WHERE name = ${AREA_NAME}`;
    await sql.end({ timeout: 5 });
    rmSync(out, { recursive: true, force: true });
  });

  it('tạo 5 CSV gzip + manifest.json + README.md, số dòng khớp DB', async () => {
    const stdout = execFileSync(process.execPath, ['scripts/export-odbl.mjs', '--out', out], {
      encoding: 'utf8',
      env: process.env,
    });
    expect(stdout).toMatch(/đã xuất 5 bảng/);
    const dirs = readFileSync(join(out, 'LATEST'), 'utf8').trim();
    const dir = join(out, dirs);
    for (const t of ['src_osm_place', 'admin_area', 'admin_alias', 'street', 'alley']) {
      expect(existsSync(join(dir, `${t}.csv.gz`)), t).toBe(true);
    }
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    const [row] = await sql`SELECT count(*)::int AS n FROM admin_area`;
    expect(manifest.tables.admin_area.rows).toBe(row?.n ?? -1);
    expect(manifest.tables.admin_area.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.license).toBe('ODbL-1.0');

    const csv = gunzipSync(readFileSync(join(dir, 'admin_area.csv.gz'))).toString('utf8');
    expect(csv.split('\n')[0]).toBe('id,level,name,name_norm,parent_id,osm_relation_id,geom_wkt');
    expect(csv).toContain(AREA_NAME);
    expect(csv).toContain('MULTIPOLYGON((');

    const readme = readFileSync(join(dir, 'README.md'), 'utf8');
    expect(readme).toContain('ODbL');
    expect(readme).toContain(`| admin_area | ${row?.n} |`);
  });
});
```

Run: `pnpm exec vitest run --config vitest.db.config.ts db/export-odbl.dbtest.mjs`
Expected: FAIL — `scripts/export-odbl.mjs` không tồn tại (`Cannot find module`).

- [x] **Step 6: Viết `scripts/export-odbl.mjs`**

```js
#!/usr/bin/env node
// Xuất các bảng Derivative Database của OSM theo ODbL (spec 12.2): pnpm export:odbl [--out out/odbl]
// Mỗi bảng một CSV gzip (geometry WKT) + manifest.json (số dòng, SHA-256) + README.md (giấy phép, ghi nguồn).
// Chạy được trên máy dev (DB dev) hoặc trong container pipeline (role pipeline có SELECT trên 5 bảng).
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { createWriteStream, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import postgres from 'postgres';
import { databaseUrlFromEnv } from './lib/migrations.mjs';
import { ODBL_TABLES, copySql, exportDirFor, readmeFor } from './lib/odbl.mjs';

const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const base = outIdx >= 0 ? (argv[outIdx + 1] ?? 'out/odbl') : (process.env.MAPSLIBVN_OUT ? `${process.env.MAPSLIBVN_OUT}/odbl` : 'out/odbl');
const now = new Date();
const dir = exportDirFor(now, base);
mkdirSync(dir, { recursive: true });

const sql = postgres(databaseUrlFromEnv(process.env), { max: 1, onnotice: () => {} });
/** @type {Record<string, { rows: number, bytes: number, sha256: string, file: string }>} */
const tables = {};
try {
  const [rel] = await sql`SELECT max(release)::text AS release FROM src_osm_place`;
  for (const table of ODBL_TABLES) {
    const [cnt] = await sql.unsafe(`SELECT count(*)::int AS n FROM ${table.name}`);
    const file = `${table.name}.csv.gz`;
    const path = join(dir, file);
    const hash = createHash('sha256');
    const readable = await sql.unsafe(copySql(table)).readable();
    const gzip = createGzip();
    gzip.on('data', (chunk) => hash.update(chunk));
    await pipeline(readable, gzip, createWriteStream(path));
    tables[table.name] = {
      rows: Number(cnt?.n ?? 0),
      bytes: statSync(path).size,
      sha256: hash.digest('hex'),
      file,
    };
    console.log(`  ${table.name}: ${tables[table.name]?.rows} dòng → ${file}`);
  }
  const date = now.toISOString().slice(0, 10);
  const osmRelease = rel?.release ?? 'không rõ';
  writeFileSync(
    join(dir, 'manifest.json'),
    `${JSON.stringify({ exported_at: now.toISOString(), osm_release: osmRelease, license: 'ODbL-1.0', attribution: '© OpenStreetMap contributors', tables }, null, 2)}\n`,
  );
  const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.rows]));
  writeFileSync(join(dir, 'README.md'), readmeFor({ date, osmRelease, counts }));
  writeFileSync(join(base, 'LATEST'), `${dir.slice(base.length + 1)}\n`);
  console.log(`đã xuất ${ODBL_TABLES.length} bảng vào ${dir}`);
} finally {
  await sql.end({ timeout: 5 });
}
```

Thêm vào `package.json` gốc sau `"data:rollback"`:
```json
    "export:odbl": "node scripts/export-odbl.mjs",
```

- [x] **Step 7: dbtest xanh, thử tay**

Run: `pnpm exec vitest run --config vitest.db.config.ts db/export-odbl.dbtest.mjs`
Expected: PASS 1 test.

Run: `pnpm export:odbl && cat out/odbl/LATEST && ls -la out/odbl/$(cat out/odbl/LATEST)`
Expected: 5 `.csv.gz` + `manifest.json` + `README.md`; trên fixture Quận 1 `src_osm_place` vài nghìn dòng.

- [x] **Step 8: Gate + commit**

Run: `pnpm exec tsc -p tsconfig.scripts.json && pnpm exec biome check --write scripts/lib/odbl.mjs scripts/lib/odbl.test.mjs scripts/export-odbl.mjs db/export-odbl.dbtest.mjs && pnpm exec vitest run scripts/lib`
Expected: sạch, xanh. (Bẫy: `sql.unsafe(...).readable()` trả `Promise<Readable>` — đã `await`; `cnt?.n` là `any` từ `unsafe` — bọc `Number()`.)

DEVLOG mục 1/2/4.

```bash
git add scripts/lib/odbl.mjs scripts/lib/odbl.test.mjs scripts/export-odbl.mjs db/export-odbl.dbtest.mjs package.json docs/DEVLOG.md docs/superpowers/plans/2026-09-02-m5-phat-hanh-noi-bo.md
git commit -m "feat(scripts): pnpm export:odbl xuất 5 bảng dẫn xuất OSM (CSV gzip + manifest + README ODbL)"
```

Sau push, workflow `dbtest.yml` (paths `db/**`) phải xanh — kiểm bằng `gh run list`.

---

### Task 6: Thư viện báo cáo tuần — SQL, tổng hợp, kết xuất (thuần, có test)

**Files:**
- Create: `scripts/lib/weekly-report.mjs`, `scripts/lib/weekly-report.test.mjs`

- [x] **Step 1: Test thất bại trước (RED)**

Tạo `scripts/lib/weekly-report.test.mjs`:

```js
import { describe, expect, it } from 'vitest';
import {
  analyticsSql,
  maskKey,
  renderHtml,
  renderText,
  summarize,
  weekRange,
} from './weekly-report.mjs';

describe('weekRange', () => {
  it('tuần trước theo giờ VN: thứ Hai 00:00 VN → thứ Hai 00:00 VN, trả UTC', () => {
    // 2026-09-07 là thứ Hai. 08:00 VN = 01:00Z.
    const r = weekRange(new Date('2026-09-07T01:00:00Z'));
    expect(r.from.toISOString()).toBe('2026-08-30T17:00:00.000Z'); // 31/08 00:00 VN
    expect(r.to.toISOString()).toBe('2026-09-06T17:00:00.000Z'); // 07/09 00:00 VN
    expect(r.label).toBe('31/08/2026 → 06/09/2026');
  });
  it('chạy giữa tuần vẫn lấy trọn tuần trước', () => {
    const r = weekRange(new Date('2026-09-09T10:00:00Z')); // thứ Tư
    expect(r.from.toISOString()).toBe('2026-08-30T17:00:00.000Z');
  });
});

describe('analyticsSql', () => {
  it('lọc theo khoảng thời gian, gộp tenant/key/path, dùng _sample_interval', () => {
    const q = analyticsSql({
      from: new Date('2026-08-30T17:00:00Z'),
      to: new Date('2026-09-06T17:00:00Z'),
      dataset: 'mapslibvn_api',
    });
    expect(q).toContain("timestamp >= toDateTime('2026-08-30 17:00:00')");
    expect(q).toContain("timestamp < toDateTime('2026-09-06 17:00:00')");
    expect(q).toContain('SUM(_sample_interval) AS requests');
    expect(q).toContain('sumIf(_sample_interval, double1 >= 500) AS errors_5xx');
    expect(q).toContain('quantileWeighted(0.95)(double2, _sample_interval) AS p95_ms');
    expect(q).toContain('FROM mapslibvn_api');
    expect(q).toContain('GROUP BY tenant_id, api_key, path');
    expect(q.trim().endsWith('FORMAT JSON')).toBe(true);
  });
});

describe('maskKey', () => {
  it('giữ tiền tố + 4 đầu + 4 cuối', () => {
    expect(maskKey('mlv_live_demo00000000000000000000')).toBe('mlv_live_demo…0000');
    expect(maskKey('anon')).toBe('anon');
    expect(maskKey('')).toBe('(không key)');
  });
});

const rows = [
  { tenant_id: 't1', api_key: 'mlv_live_demo00000000000000000000', path: '/v1/autocomplete', requests: 900, errors_5xx: 2, quota_429: 0, p95_ms: 180 },
  { tenant_id: 't1', api_key: 'mlv_live_demo00000000000000000000', path: '/v1/places/x', requests: 100, errors_5xx: 0, quota_429: 0, p95_ms: 90 },
  { tenant_id: 't2', api_key: 'mlv_live_nhungthuAAAAAAAAAAAAAAAA', path: '/v1/autocomplete', requests: 50, errors_5xx: 0, quota_429: 0, p95_ms: 300 },
  { tenant_id: '', api_key: '', path: '/v1/styles/light.json', requests: 40, errors_5xx: 0, quota_429: 0, p95_ms: 20 },
];
const labels = {
  tenants: { t1: 'MapsLibVN nội bộ', t2: 'Ứng dụng nhúng thử nghiệm (nội bộ)' },
  keys: { mlv_live_demo00000000000000000000: 'demo docs/playground' },
};

describe('summarize', () => {
  it('tổng, theo tenant (tên), theo key (mask + nhãn), top path; /v1/places/:id gộp id', () => {
    const s = summarize(rows, labels);
    expect(s.total).toEqual({ requests: 1090, errors_5xx: 2, quota_429: 0 });
    expect(s.tenants[0]).toEqual({ name: 'MapsLibVN nội bộ', requests: 1000, errors_5xx: 2, quota_429: 0, p95_ms: 180 });
    expect(s.tenants[1]?.name).toBe('Ứng dụng nhúng thử nghiệm (nội bộ)');
    expect(s.tenants[2]?.name).toBe('(không key)');
    expect(s.keys[0]).toEqual({ key: 'mlv_live_demo…0000', label: 'demo docs/playground', tenant: 'MapsLibVN nội bộ', requests: 1000 });
    expect(s.keys[1]?.label).toBe('');
    expect(s.paths[0]).toEqual({ path: '/v1/autocomplete', requests: 950, errors_5xx: 2, p95_ms: 300 });
    expect(s.paths.find((p) => p.path === '/v1/places/:id')?.requests).toBe(100);
  });
  it('rỗng khi không có dữ liệu', () => {
    const s = summarize([], labels);
    expect(s.total.requests).toBe(0);
    expect(s.tenants).toEqual([]);
  });
});

describe('render', () => {
  const s = summarize(rows, labels);
  const range = { label: '31/08/2026 → 06/09/2026' };
  it('text có tiêu đề, tổng và bảng tenant', () => {
    const t = renderText(s, range);
    expect(t).toContain('MapsLibVN — báo cáo tuần 31/08/2026 → 06/09/2026');
    expect(t).toContain('Tổng request: 1090');
    expect(t).toContain('Ứng dụng nhúng thử nghiệm (nội bộ)');
    expect(t).toContain('mlv_live_demo…0000');
  });
  it('html escape và có 3 bảng', () => {
    const h = renderHtml(s, range);
    expect(h.match(/<table/g)?.length).toBe(3);
    expect(h).toContain('&rarr;');
    expect(h).not.toContain('<script');
  });
  it('không dữ liệu → ghi rõ', () => {
    expect(renderText(summarize([], labels), range)).toContain('Không có request nào');
  });
});
```

- [x] **Step 2: Chạy, xác nhận đỏ**

Run: `pnpm exec vitest run scripts/lib/weekly-report.test.mjs`
Expected: FAIL — không load được `./weekly-report.mjs`.

- [x] **Step 3: Viết `scripts/lib/weekly-report.mjs`**

```js
// Báo cáo tuần từ Workers Analytics Engine (spec 6.4, 11.3). Hàm thuần — I/O ở scripts/weekly-report.mjs.
// Dataset mapslibvn_api: blob1=tenant_id, blob2=api_key, blob3=path, double1=status, double2=ms (apps/api/src/analytics.ts).
const VN_OFFSET_MS = 7 * 3600 * 1000;

/** @typedef {{ tenant_id: string, api_key: string, path: string, requests: number, errors_5xx: number, quota_429: number, p95_ms: number }} Row */
/** @typedef {{ tenants: Record<string, string>, keys: Record<string, string> }} Labels */

/** @param {Date} d */
const ddmmyyyy = (d) => {
  const vn = new Date(d.getTime() + VN_OFFSET_MS);
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${p(vn.getUTCDate())}/${p(vn.getUTCMonth() + 1)}/${vn.getUTCFullYear()}`;
};

/**
 * Tuần trước trọn vẹn theo giờ VN: [thứ Hai 00:00 VN tuần trước, thứ Hai 00:00 VN tuần này).
 * @param {Date} now
 */
export function weekRange(now) {
  const vn = new Date(now.getTime() + VN_OFFSET_MS);
  const monday = new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()));
  const back = (monday.getUTCDay() + 6) % 7; // thứ Hai → 0, Chủ nhật → 6
  monday.setUTCDate(monday.getUTCDate() - back);
  const to = new Date(monday.getTime() - VN_OFFSET_MS);
  const from = new Date(to.getTime() - 7 * 86400_000);
  const last = new Date(to.getTime() - 1);
  return { from, to, label: `${ddmmyyyy(from)} → ${ddmmyyyy(last)}` };
}

/** @param {Date} d */
const sqlTs = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

/** @param {{ from: Date, to: Date, dataset: string }} o */
export function analyticsSql({ from, to, dataset }) {
  return `
SELECT
  blob1 AS tenant_id,
  blob2 AS api_key,
  blob3 AS path,
  SUM(_sample_interval) AS requests,
  sumIf(_sample_interval, double1 >= 500) AS errors_5xx,
  sumIf(_sample_interval, double1 = 429) AS quota_429,
  quantileWeighted(0.95)(double2, _sample_interval) AS p95_ms
FROM ${dataset}
WHERE timestamp >= toDateTime('${sqlTs(from)}') AND timestamp < toDateTime('${sqlTs(to)}')
GROUP BY tenant_id, api_key, path
ORDER BY requests DESC
LIMIT 1000
FORMAT JSON`;
}

/** @param {string} key */
export function maskKey(key) {
  if (!key) return '(không key)';
  if (!key.startsWith('mlv_live_')) return key;
  const body = key.slice('mlv_live_'.length);
  return `mlv_live_${body.slice(0, 4)}…${body.slice(-4)}`;
}

/** Gộp /v1/places/<id> thành /v1/places/:id để top path không vỡ theo id. @param {string} path */
const normalizePath = (path) => path.replace(/^\/v1\/places\/[^/]+$/, '/v1/places/:id');

/**
 * @param {Row[]} rows
 * @param {Labels} labels
 */
export function summarize(rows, labels) {
  const total = { requests: 0, errors_5xx: 0, quota_429: 0 };
  /** @type {Map<string, { name: string, requests: number, errors_5xx: number, quota_429: number, p95_ms: number }>} */
  const tenants = new Map();
  /** @type {Map<string, { key: string, label: string, tenant: string, requests: number }>} */
  const keys = new Map();
  /** @type {Map<string, { path: string, requests: number, errors_5xx: number, p95_ms: number }>} */
  const paths = new Map();

  for (const r of rows) {
    const requests = Number(r.requests) || 0;
    const errors = Number(r.errors_5xx) || 0;
    const quota = Number(r.quota_429) || 0;
    const p95 = Number(r.p95_ms) || 0;
    total.requests += requests;
    total.errors_5xx += errors;
    total.quota_429 += quota;

    const tenantName = r.tenant_id ? (labels.tenants[r.tenant_id] ?? r.tenant_id) : '(không key)';
    const t = tenants.get(tenantName) ?? { name: tenantName, requests: 0, errors_5xx: 0, quota_429: 0, p95_ms: 0 };
    t.requests += requests;
    t.errors_5xx += errors;
    t.quota_429 += quota;
    t.p95_ms = Math.max(t.p95_ms, p95);
    tenants.set(tenantName, t);

    const masked = maskKey(r.api_key);
    const k = keys.get(masked) ?? { key: masked, label: labels.keys[r.api_key] ?? '', tenant: tenantName, requests: 0 };
    k.requests += requests;
    keys.set(masked, k);

    const path = normalizePath(r.path);
    const p = paths.get(path) ?? { path, requests: 0, errors_5xx: 0, p95_ms: 0 };
    p.requests += requests;
    p.errors_5xx += errors;
    p.p95_ms = Math.max(p.p95_ms, p95);
    paths.set(path, p);
  }
  const byRequests = (/** @type {{ requests: number }} */ a, /** @type {{ requests: number }} */ b) => b.requests - a.requests;
  return {
    total,
    tenants: [...tenants.values()].sort(byRequests),
    keys: [...keys.values()].sort(byRequests),
    paths: [...paths.values()].sort(byRequests).slice(0, 15),
  };
}

/** @typedef {ReturnType<typeof summarize>} Summary */

/**
 * @param {Summary} s
 * @param {{ label: string }} range
 */
export function renderText(s, range) {
  const lines = [`MapsLibVN — báo cáo tuần ${range.label}`, ''];
  if (s.total.requests === 0) {
    lines.push('Không có request nào trong tuần.');
    return lines.join('\n');
  }
  lines.push(`Tổng request: ${s.total.requests} · 5xx: ${s.total.errors_5xx} · 429: ${s.total.quota_429}`, '');
  lines.push('Theo tenant:');
  for (const t of s.tenants) lines.push(`  ${t.name}: ${t.requests} request · 5xx ${t.errors_5xx} · 429 ${t.quota_429} · p95 ${Math.round(t.p95_ms)} ms`);
  lines.push('', 'Theo key:');
  for (const k of s.keys) lines.push(`  ${k.key}${k.label ? ` (${k.label})` : ''} — ${k.tenant}: ${k.requests}`);
  lines.push('', 'Endpoint nhiều nhất:');
  for (const p of s.paths) lines.push(`  ${p.path}: ${p.requests} · 5xx ${p.errors_5xx} · p95 ${Math.round(p.p95_ms)} ms`);
  return lines.join('\n');
}

/** @param {string | number} v */
const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * @param {string[]} head
 * @param {(string | number)[][]} body
 */
function table(head, body) {
  const th = head.map((h) => `<th align="left">${esc(h)}</th>`).join('');
  const rows = body.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
  return `<table cellpadding="4" style="border-collapse:collapse;font-family:monospace"><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table>`;
}

/**
 * @param {Summary} s
 * @param {{ label: string }} range
 */
export function renderHtml(s, range) {
  const title = `<h2>MapsLibVN &mdash; báo cáo tuần ${esc(range.label).replace('→', '&rarr;')}</h2>`;
  if (s.total.requests === 0) return `${title}<p>Không có request nào trong tuần.</p>`;
  return [
    title,
    `<p>Tổng request: <b>${s.total.requests}</b> · 5xx: ${s.total.errors_5xx} · 429: ${s.total.quota_429}</p>`,
    '<h3>Theo tenant</h3>',
    table(['Tenant', 'Request', '5xx', '429', 'p95 ms'], s.tenants.map((t) => [t.name, t.requests, t.errors_5xx, t.quota_429, Math.round(t.p95_ms)])),
    '<h3>Theo key</h3>',
    table(['Key', 'Nhãn', 'Tenant', 'Request'], s.keys.map((k) => [k.key, k.label, k.tenant, k.requests])),
    '<h3>Endpoint nhiều nhất</h3>',
    table(['Endpoint', 'Request', '5xx', 'p95 ms'], s.paths.map((p) => [p.path, p.requests, p.errors_5xx, Math.round(p.p95_ms)])),
  ].join('\n');
}
```

- [x] **Step 4: Chạy test xanh**

Run: `pnpm exec vitest run scripts/lib/weekly-report.test.mjs`
Expected: PASS 10 test. Nếu `weekRange` lệch 1 ngày, kiểm lại phép `(getUTCDay() + 6) % 7` trên ngày **VN** (không phải UTC).

- [x] **Step 5: Gate + commit**

Run: `pnpm exec tsc -p tsconfig.scripts.json && pnpm exec biome check --write scripts/lib/weekly-report.mjs scripts/lib/weekly-report.test.mjs`
Expected: sạch.

DEVLOG mục 1/2/4.

```bash
git add scripts/lib/weekly-report.mjs scripts/lib/weekly-report.test.mjs docs/DEVLOG.md docs/superpowers/plans/2026-09-02-m5-phat-hanh-noi-bo.md
git commit -m "feat(scripts): thư viện báo cáo tuần — SQL Analytics Engine, tổng hợp, kết xuất text/html"
```

---

### Task 7: `weekly-report.mjs` (I/O) + cron nhiều job + cấu hình máy chủ

**Files:**
- Create: `scripts/weekly-report.mjs`
- Modify: `scripts/lib/schedule.mjs`, `scripts/lib/schedule.test.mjs`, `scripts/cron.mjs`, `package.json` (`report:weekly`), `.env.example`, `infra/server/README.md`

- [x] **Step 1: Test `nextJob` thất bại trước (RED)** — thêm vào cuối `scripts/lib/schedule.test.mjs`:

```js
import { nextJob } from './schedule.mjs';

describe('nextJob', () => {
  const jobs = [
    { name: 'data:update', schedule: { hour: 2, minute: 0, weekday: 1 } },
    { name: 'report:weekly', schedule: { hour: 8, minute: 0, weekday: 1 } },
  ];
  it('chọn job sớm nhất kế tiếp', () => {
    // Thứ Hai 07/09/2026 03:00 VN = 06/09 20:00Z → data:update đã qua, report 08:00 VN là gần nhất
    const { job, at } = nextJob(new Date('2026-09-06T20:00:00Z'), jobs);
    expect(job.name).toBe('report:weekly');
    expect(at.toISOString()).toBe('2026-09-07T01:00:00.000Z');
  });
  it('sau 08:00 thứ Hai → data:update tuần sau', () => {
    const { job, at } = nextJob(new Date('2026-09-07T02:00:00Z'), jobs);
    expect(job.name).toBe('data:update');
    expect(at.toISOString()).toBe('2026-09-13T19:00:00.000Z');
  });
  it('ném lỗi khi không có job', () => {
    expect(() => nextJob(new Date(), [])).toThrow(/job/);
  });
});
```
(Nếu file test hiện chưa import `describe/expect/it` từ vitest ở đầu, đã có sẵn — chỉ thêm import `nextJob` cạnh `nextRun`.)

Run: `pnpm exec vitest run scripts/lib/schedule.test.mjs`
Expected: FAIL — `nextJob` không phải hàm.

- [x] **Step 2: Thêm `nextJob` vào `scripts/lib/schedule.mjs`**

```js
/**
 * Job sớm nhất kế tiếp trong danh sách.
 * @template {{ name: string, schedule: { hour: number, minute: number, weekday?: number } }} J
 * @param {Date} now
 * @param {J[]} jobs
 * @returns {{ job: J, at: Date }}
 */
export function nextJob(now, jobs) {
  /** @type {{ job: J, at: Date } | undefined} */
  let best;
  for (const job of jobs) {
    const at = nextRun(now, job.schedule);
    if (!best || at.getTime() < best.at.getTime()) best = { job, at };
  }
  if (!best) throw new Error('nextJob: danh sách job rỗng');
  return best;
}
```

Run: `pnpm exec vitest run scripts/lib/schedule.test.mjs` → PASS.

- [x] **Step 3: Viết lại `scripts/cron.mjs` cho nhiều job**

```js
#!/usr/bin/env node
// Lịch trong container `pipeline` trên máy chủ (giờ VN). Khoá file theo job, tránh chạy chồng.
//   thứ Hai 02:00  data:update      (spec 11.1)
//   thứ Hai 08:00  báo cáo tuần     (spec 11.3 — Analytics Engine → email)
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { run, sleep } from './lib/run.mjs';
import { nextJob } from './lib/schedule.mjs';

const work = process.env.MAPSLIBVN_WORK ?? 'work';
const JOBS = [
  { name: 'data:update', schedule: { hour: 2, minute: 0, weekday: 1 }, script: 'scripts/data-update.mjs' },
  { name: 'report:weekly', schedule: { hour: 8, minute: 0, weekday: 1 }, script: 'scripts/weekly-report.mjs' },
];
for (const job of JOBS) {
  const lock = resolve(work, `${job.name.replace(':', '-')}.lock`);
  if (existsSync(lock)) {
    console.warn(`[cron] xoá khoá cũ ${lock} (container vừa khởi động lại)`);
    rmSync(lock, { force: true });
  }
}
for (;;) {
  const { job, at } = nextJob(new Date(), JOBS);
  console.log(`[cron] ${job.name} kế tiếp ${at.toISOString()} (thứ Hai ${String(job.schedule.hour).padStart(2, '0')}:00 VN)`);
  await sleep(at.getTime() - Date.now());
  const lock = resolve(work, `${job.name.replace(':', '-')}.lock`);
  writeFileSync(lock, String(process.pid));
  try {
    run(process.execPath, [job.script]);
  } catch (e) {
    console.error(`[cron] ${job.name} LỖI`, e);
  } finally {
    rmSync(lock, { force: true });
  }
}
```

Lưu ý: `infra/server/README.md` mục "Kiểm tra → Cron" đang kỳ vọng log `data:update kế tiếp <ISO> (thứ Hai 02:00 VN)` — định dạng mới vẫn khớp chuỗi đó cho job data:update.

- [x] **Step 4: Viết `scripts/weekly-report.mjs`**

```js
#!/usr/bin/env node
// Báo cáo sử dụng tuần: Analytics Engine SQL API → tổng hợp → email qua Cloudflare Email Sending REST API.
//   pnpm report:weekly [--dry-run] [--no-db]
// Biến môi trường (infra/server/.env trên máy chủ, .env trên máy dev):
//   CLOUDFLARE_ACCOUNT_ID, CF_REPORT_API_TOKEN (quyền: Account Analytics Read + Email Sending Edit)
//   REPORT_EMAIL_TO (nhiều địa chỉ, phẩy), REPORT_EMAIL_FROM (domain đã bật Email Sending)
//   DB (tuỳ chọn, đổi id → nhãn): DATABASE_URL hoặc POSTGRES_*  — bỏ qua bằng --no-db
import 'dotenv/config';
import postgres from 'postgres';
import { databaseUrlFromEnv } from './lib/migrations.mjs';
import { analyticsSql, renderHtml, renderText, summarize, weekRange } from './lib/weekly-report.mjs';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const noDb = argv.includes('--no-db');
const DATASET = 'mapslibvn_api';

/** @param {string} name */
function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Thiếu biến môi trường ${name}`);
  return v;
}

const account = need('CLOUDFLARE_ACCOUNT_ID');
const token = need('CF_REPORT_API_TOKEN');
const range = weekRange(new Date());

// 1. Analytics Engine SQL API
const aeRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: analyticsSql({ from: range.from, to: range.to, dataset: DATASET }),
});
if (!aeRes.ok) throw new Error(`Analytics SQL API ${aeRes.status}: ${await aeRes.text()}`);
/** @type {{ data: import('./lib/weekly-report.mjs').Row[], rows: number }} */
const ae = await aeRes.json();
console.log(`[report] ${range.label}: ${ae.rows} nhóm từ Analytics Engine`);

// 2. Nhãn tenant/key từ DB (role pipeline/api đều có SELECT trên tenant, api_key)
/** @type {{ tenants: Record<string, string>, keys: Record<string, string> }} */
const labels = { tenants: {}, keys: {} };
if (!noDb) {
  const sql = postgres(databaseUrlFromEnv(process.env), { max: 1, onnotice: () => {} });
  try {
    for (const t of await sql`SELECT id::text AS id, name FROM tenant`) labels.tenants[t.id] = t.name;
    for (const k of await sql`SELECT key, coalesce(label, '') AS label FROM api_key`) labels.keys[k.key] = k.label;
  } catch (e) {
    console.warn('[report] không đọc được nhãn từ DB, dùng id thô:', e instanceof Error ? e.message : e);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// 3. Kết xuất
const summary = summarize(ae.data, labels);
const text = renderText(summary, range);
const html = renderHtml(summary, range);
if (dryRun) {
  console.log(text);
  process.exit(0);
}

// 4. Email — Cloudflare Email Sending REST API (from dùng `address`, không phải `email`)
const to = need('REPORT_EMAIL_TO').split(',').map((s) => s.trim()).filter(Boolean);
const from = need('REPORT_EMAIL_FROM');
const mailRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/email/sending/send`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    to,
    from: { address: from, name: 'MapsLibVN' },
    subject: `MapsLibVN — báo cáo tuần ${range.label}`,
    text,
    html,
  }),
});
const mail = await mailRes.text();
if (!mailRes.ok) throw new Error(`Email Sending API ${mailRes.status}: ${mail}`);
console.log(`[report] đã gửi tới ${to.join(', ')}: ${mail.slice(0, 200)}`);
```

Thêm vào `package.json` gốc sau `"export:odbl"`:
```json
    "report:weekly": "node scripts/weekly-report.mjs",
```

- [x] **Step 5: `.env.example` + README máy chủ**

Thêm vào cuối `.env.example`:
```
# ---- Báo cáo tuần (M5, spec 11.3) — chạy trong container pipeline thứ Hai 08:00 VN ----
# Token riêng, chỉ 2 quyền: Account Analytics: Read + Email Sending: Edit. KHÔNG dùng token deploy.
CF_REPORT_API_TOKEN=
REPORT_EMAIL_TO=
# Domain của FROM phải đã bật Email Sending (Email Service → Email Sending → Add domain)
REPORT_EMAIL_FROM=
```

`infra/server/README.md` — mục "Việc tay trên Cloudflare (một lần)" thêm bước 6, và mục "Kiểm tra" thêm một gạch đầu dòng:

```markdown
6. **Báo cáo tuần (M5)**: Email Service → Email Sending → **Add domain** `<domain>` (Cloudflare tự thêm SPF/DKIM; chờ "Active").
   My Profile → API Tokens → Create Custom Token `mapslibvn-report`: *Account Analytics: Read* + *Email Sending: Edit*, giới hạn account này.
   Điền `CF_REPORT_API_TOKEN`, `REPORT_EMAIL_TO=<email PHONG>`, `REPORT_EMAIL_FROM=maps-report@<domain>` vào `infra/server/.env`
   rồi `docker compose --env-file infra/server/.env -f infra/server/compose.yml up -d pipeline` để container nhận biến mới.
```

```markdown
- Báo cáo tuần: `docker compose --env-file infra/server/.env -f infra/server/compose.yml exec pipeline node scripts/weekly-report.mjs --dry-run`
  in bảng theo tenant/key/endpoint; bỏ `--dry-run` để gửi email thật. Log cron phải có dòng `report:weekly kế tiếp <ISO> (thứ Hai 08:00 VN)`.
```

- [x] **Step 6: Thử `--dry-run` trên máy dev**

Nếu đã có token (Task 8 có thể làm trước bước này — token là việc tay của PHONG): điền `CF_REPORT_API_TOKEN` vào `.env` rồi
Run: `pnpm report:weekly --dry-run`
Expected: `[report] <tuần>: N nhóm từ Analytics Engine` rồi bảng text có tenant "MapsLibVN nội bộ" (production đã có request từ M3/M4).

Nếu **chưa** có token: chạy `CLOUDFLARE_ACCOUNT_ID=x CF_REPORT_API_TOKEN=x pnpm report:weekly --dry-run --no-db` → phải thất bại rõ ràng `Analytics SQL API 400/403: …` (không crash kiểu khác). Ghi vào DEVLOG mục 2 là chờ Task 8.

- [x] **Step 7: Gate + commit**

Run: `pnpm exec tsc -p tsconfig.scripts.json && pnpm exec biome check --write scripts/weekly-report.mjs scripts/cron.mjs scripts/lib/schedule.mjs scripts/lib/schedule.test.mjs && pnpm test`
Expected: typecheck sạch (chú ý `ae.data` cast qua JSDoc; `t.id`/`k.key` từ template tag là `any` — OK); root test xanh.

DEVLOG mục 1/2/4.

```bash
git add scripts/weekly-report.mjs scripts/cron.mjs scripts/lib/schedule.mjs scripts/lib/schedule.test.mjs package.json .env.example infra/server/README.md docs/DEVLOG.md docs/superpowers/plans/2026-09-02-m5-phat-hanh-noi-bo.md
git commit -m "feat(scripts): báo cáo tuần qua Analytics Engine + Email Sending; cron máy chủ chạy nhiều job"
```

Sau push: `ci.yml` xanh; image pipeline được build lại (`image` job) — máy chủ nhận bản mới bằng `pnpm server:update` ở Task 8.

---

### Task 8: Việc tay của PHONG + báo cáo tuần đầu thật (nghiệm thu mục 2)

**Files:**
- Modify: `docs/DEVLOG.md` (mục 2 "Việc tay", mục 4)

Phần này **chỉ PHONG làm được** (dashboard Cloudflare, máy chủ). Agent chuẩn bị lệnh, PHONG dán kết quả.


> **Trạng thái 03/09/2026 — XONG:** PHONG đã tạo 2 token; đường tự động đã chạy thật trong container.
> Ghi chú lịch sử 02/09: Step 3 đã đạt — báo cáo đầu tiên gửi thật qua phiên OAuth của PHONG,
> Cloudflare trả `delivered`. Domain đã có sẵn Email Routing + SPF/DKIM nên **không cần Add domain**.
> Step 1 còn treo đúng một việc: tạo token `mapslibvn-report` rồi điền `infra/server/.env` để cron
> gửi tự động (Cloudflare không cho tạo token thay chủ tài khoản).

- [x] **Step 1: PHONG — bật Email Sending + token** (theo `infra/server/README.md` bước 6):
  1. Dashboard → **Email Service → Email Sending → Add domain** → `ai-solutions.io.vn` → chờ trạng thái Active (DNS tự thêm).
  2. **API Tokens → Create Custom Token** `mapslibvn-report`: permissions *Account · Account Analytics · Read* và *Account · Email Sending · Edit*; Account Resources = account này. Copy token.
  3. Trên máy chủ: thêm 3 biến vào `infra/server/.env` (`CF_REPORT_API_TOKEN`, `REPORT_EMAIL_TO=<email PHONG>`, `REPORT_EMAIL_FROM=maps-report@ai-solutions.io.vn`), rồi `pnpm server:update` (kéo image mới có cron 2 job) và `docker compose --env-file infra/server/.env -f infra/server/compose.yml up -d pipeline`.

- [x] **Step 2: Kiểm cron nhận 2 job**

Run (máy chủ): `docker compose --env-file infra/server/.env -f infra/server/compose.yml logs pipeline | tail -3`
Expected: dòng `[cron] report:weekly kế tiếp …T01:00:00.000Z (thứ Hai 08:00 VN)` hoặc `data:update kế tiếp …` (job nào gần hơn).

- [x] **Step 3: Gửi báo cáo tuần đầu thật (không đợi thứ Hai)**

Run (máy chủ):
```bash
C="docker compose --env-file infra/server/.env -f infra/server/compose.yml"
$C exec pipeline node scripts/weekly-report.mjs --dry-run
$C exec pipeline node scripts/weekly-report.mjs
```
Expected: dry-run in bảng có tenant `MapsLibVN nội bộ` (và `Free thử nghiệm` từ smoke M4); lần hai in `[report] đã gửi tới <email>: {"result":{"delivered":[…]…` và **email tới hộp thư PHONG** với 3 bảng.

- [x] **Step 4: Ghi DEVLOG**

Mục 4: `- <ngày> · M5 T8 · báo cáo tuần đầu gửi thành công tới <email>, N request tuần <label> · (không commit mã)`. Mục 2: đánh dấu việc tay Email Sending/token đã xong; nếu PHONG chưa làm được, ghi rõ "CHỜ PHONG: …" và **tiếp tục Task 9 phần không phụ thuộc** (checklist, docs) — nghiệm thu mục 2 để ngỏ cho tới khi email đến.

```bash
git add docs/DEVLOG.md docs/superpowers/plans/2026-09-02-m5-phat-hanh-noi-bo.md
git commit -m "docs: M5 T8 — báo cáo tuần đầu gửi thành công"
```

---

### Task 9: Ứng dụng nhúng độc lập, checklist pháp lý, nghiệm thu M5 (DEVLOG mục 10, roadmap)

**Files:**
- Create: `examples/embed-web/index.html`, `docs/legal/checklist-phap-ly.md`
- Modify: `docs/DEVLOG.md` (mục 1, 2, 3, 4, 10), `docs/superpowers/plans/2026-08-26-roadmap-toan-bo-spec.md` (mục 7)

MapsLibVN là thư viện độc lập; nghiệm thu "nhúng bằng key riêng" dùng một trang HTML tĩnh **ngoài** repo docs và ngoài mọi dự án khác, chạy ở origin riêng (`http://localhost:5500`) để chứng minh luồng key `web` + `allowed_origins` hoạt động với bất kỳ host nào. Nếu PHONG muốn thử thêm trên một web/mobile app thật thì cấp key khác cho origin đó — không bắt buộc.

- [x] **Step 1: Tạo `examples/embed-web/index.html`** (trang trắng, chỉ dùng UMD từ docs — đúng đoạn nhúng của `bat-dau.md` sau Task 3)

```html
<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Nhúng MapsLibVN — trang thử độc lập</title>
  <link rel="stylesheet" href="https://mapslibvn-docs.pages.dev/sdk/mapslibvn.css" />
  <style>body{margin:0;font-family:system-ui} #map{height:70vh} #log{padding:8px;font:12px monospace}</style>
</head>
<body>
  <div id="map"></div>
  <div id="log">key: <span id="k">(chưa)</span></div>
  <script src="https://mapslibvn-docs.pages.dev/sdk/mapslibvn.umd.js"></script>
  <script>
    // Key lấy từ ?key=mlv_live_… để không ghi key vào file. Origin của trang phải nằm trong allowed_origins.
    const key = new URLSearchParams(location.search).get('key') || '';
    document.getElementById('k').textContent = key ? `${key.slice(0, 13)}…${key.slice(-4)}` : '(thiếu ?key=)';
    const map = MapsLibVN.createMap({
      container: 'map',
      apiKey: key,
      apiBase: 'https://api.ai-solutions.io.vn',
      center: [106.70, 10.776],
      zoom: 13,
    });
    map.addMarker({ lng: 106.7, lat: 10.776, popupHtml: '<b>Chợ Bến Thành</b>' });
  </script>
</body>
</html>
```

- [x] **Step 2: Seed tenant thử nghiệm + cấp key production cho origin `http://localhost:5500`**

Từ máy dev qua Tunnel (giống cách seed M4 — `DATABASE_URL` trỏ `127.0.0.1:5433` sau `cloudflared access tcp`, user DB owner hoặc `pipeline`; xem `infra/server/README.md` mục Kiểm tra):
```bash
DATABASE_URL="postgres://<user>:<pass>@127.0.0.1:5433/mapslibvn?sslmode=require" pnpm db:seed-tenant db/seed/tenant_nhung_thu.sql
DATABASE_URL="…" pnpm key:issue --tenant 00000000-0000-4000-8000-000000000002 --label "embed-web thử độc lập" --kind web --origins http://localhost:5500
```
Expected: in `KEY : mlv_live_…`. **Không** ghi key vào DEVLOG (chỉ 4 ký tự cuối).

Mở trang ở origin riêng và kiểm:
```bash
python3 -m http.server 5500 --directory examples/embed-web
# trình duyệt: http://localhost:5500/?key=mlv_live_<key>
```
Expected trong DevTools Network: `/v1/styles/light.json` 200 (header `Origin: http://localhost:5500`), tiles 200/206 từ `tiles.ai-solutions.io.vn`, attribution hiện `OpenStreetMap`, marker hiện. Origin khác phải bị chặn:
```bash
curl -s "https://api.ai-solutions.io.vn/v1/autocomplete?q=cafe" -H "X-Api-Key: <key>" -H "Origin: https://evil.example" | head -c 200
curl -s "https://api.ai-solutions.io.vn/v1/autocomplete?q=cafe" -H "X-Api-Key: <key>" -H "Origin: http://localhost:5500" | head -c 200
```
Expected: lần 1 `403 {"error":{"code":"origin_not_allowed"…`; lần 2 JSON gợi ý.

- [x] **Step 3: Xác nhận key ứng dụng nhúng độc lập xuất hiện trong Analytics**

Run: `pnpm report:weekly --dry-run` (máy dev với `CF_REPORT_API_TOKEN` trong `.env`, hoặc trên máy chủ) — nếu tuần trước chưa có request của app, chạy truy vấn 1 ngày để thấy ngay:
```bash
set -a; source .env; set +a
curl -s "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/analytics_engine/sql" -H "Authorization: Bearer $CF_REPORT_API_TOKEN" \
  --data "SELECT blob1 AS tenant_id, SUM(_sample_interval) AS requests FROM mapslibvn_api WHERE timestamp > NOW() - INTERVAL '1' DAY GROUP BY tenant_id FORMAT JSON"
```
Expected: có dòng `tenant_id = 00000000-0000-4000-8000-000000000002`.

- [x] **Step 4: Viết `docs/legal/checklist-phap-ly.md`**

```markdown
# Checklist pháp lý MapsLibVN — nghiệm thu M5 (spec mục 12, 15; roadmap 0.5)

Trạng thái ngày: ____/____/2026. Người ký: Đỗ Tiến Phong. Chữ ký: ______________

## A. Đã làm trong M1–M5 (kỹ thuật, có bằng chứng trong repo)

- [ ] Attribution bắt buộc, không tắt được (SDK `AttributionControl`, `GET /v1/attribution`) — spec 12.3
- [ ] Bản đồ thể hiện chủ quyền Hoàng Sa, Trường Sa ở mọi zoom: patch dữ liệu + lớp `sovereignty` + QA chặn publish — spec 4.3
- [ ] Dữ liệu OSM tách bảng, `poi` chỉ liên kết nguồn bằng ID; `pnpm export:odbl` xuất được Derivative Database — spec 12.2
- [ ] `LICENSE` MIT + `THIRD_PARTY_NOTICES.md` đóng gói trong `@mapslibvn/core|web|react`; CI kiểm đồng bộ — spec 12.1
- [ ] Điều khoản tenant công bố trên docs (`/dieu-khoan/`): cấm cào/xuất hàng loạt, giữ attribution, tenant chịu trách nhiệm xin phép vị trí theo Nghị định 13/2023 — spec 9
- [ ] Không lưu IP thô; `poi_edit` chỉ có `ip_hash` (sha256 + muối theo ngày) và `end_user_hash` — spec 6.4
- [ ] Nominatim/Overpass công cộng chỉ dùng khi phát triển; production chạy trên dữ liệu tự host — spec 12.5
- [ ] Không có nguồn Google/Apple/Grab trong pipeline — spec 2.1

## B. Việc tay CÒN LẠI trước khi thương mại hoá (chặn việc thu phí, không chặn dùng nội bộ)

| # | Việc | Căn cứ | Ai | Hạn | Trạng thái |
|---|---|---|---|---|---|
| B1 | Hỏi luật sư: kinh doanh nền tảng bản đồ số có thuộc danh mục cần **giấy phép hoạt động đo đạc và bản đồ** (Điều 51 Luật ĐĐ&BĐ 2018, Nghị định 18/2020) | spec 12.4 | PHONG | trước khi thu phí | ☐ |
| B2 | Hỏi luật sư xác nhận cách đọc **ODbL Collective Database** (12.2): `poi` liên kết ID không phải Derivative Database; Produced Work chỉ cần ghi nguồn | spec 12.2 | PHONG | trước khi thu phí | ☐ |
| B3 | Rà soát **nhãn hiệu** "MapsLibVN" với chính sách nhãn hiệu MapLibre; nếu bị phản đối, đổi tên gói trước khi publish npm công khai | spec 12.4, 14 | PHONG | trước publish npm | ☐ |
| B4 | Luật sư rà soát **Điều khoản tenant** (`docs/legal/dieu-khoan-tenant.md`) trước khi ký với tenant ngoài | spec 9 | PHONG | trước tenant ngoài | ☐ |
| B5 | Khi thương mại: chuyển DB đóng góp lên hạ tầng có kiểm soát vật lý (VPS/cloud), không giữ ở nhà riêng — nghĩa vụ bảo vệ dữ liệu cá nhân | spec 12.4, 11.6 | PHONG | khi có tenant trả phí | ☐ |
| B6 | Mua **domain riêng** cho MapsLibVN; đổi `TILES_BASE`, `apiBase` trong docs (`bat-dau.md`, `tu-host.md`), `REPORT_EMAIL_FROM`; mang theo cặp Cache Rule (DEVLOG SC-1) | DEVLOG mục 3 (27/08) | PHONG | trước khi mở cho developer ngoài | ☐ |

## C. Việc kỹ thuật còn treo (không thuộc pháp lý, ghi để không quên)

- [ ] Nghiệm thu `pnpm run setup` trên **Windows** (PENDING từ M1) — chờ máy.
- [ ] QA `requireIslands` cho Hoàng Sa đang tắt (chỉ cảnh báo) vì extract Geofabrik không phủ; cần nguồn extract bổ sung rồi bật lại (DEVLOG mục 2).
- [ ] Bảng alias phường/xã trước→sau sắp xếp 2025 (M2 T8) còn thiếu.
- [ ] Bằng chứng edit #1/#2 của M4 còn nguyên sau `data:update` production kế tiếp.

Ký xác nhận: mục A đúng với hệ thống đang chạy; mục B là các việc PHONG cam kết hoàn thành trước mốc ghi ở cột "Hạn".
```

PHONG tick mục A (agent kiểm từng dòng bằng repo/production và đề xuất), điền ngày và ký (gõ tên + ngày là đủ trong giai đoạn nội bộ).

- [x] **Step 5: DEVLOG mục 10 — Nghiệm thu M5**

Thêm sau mục 9:

```markdown
## 10. Nghiệm thu M5 — Phát hành nội bộ — **ĐẠT <ngày>**

| # | Hạng mục | Kết quả |
|---|---|---|
| 1 | Ứng dụng nhúng độc lập (`examples/embed-web`) bằng key riêng | tenant `…000002`, key `web` đuôi `…XXXX`, origin `http://localhost:5500`; tiles 200/206, attribution hiện, origin lạ → 403 `origin_not_allowed` |
| 2 | Báo cáo tuần đầu nhận được | email `<ngày giờ>` tới `<email>`, tuần `<label>`, N request; có dòng tenant ứng dụng nhúng thử nghiệm từ `<ngày>` |
| 3 | Docs đủ trang, link không vỡ | Deploy Docs run `<id>`; Playwright docs.spec 8/8; các trang `/bat-dau/ /tu-host/ /giay-phep/ /do-chinh-xac/ /dong-gop/ /dieu-khoan/ /thong-bao-ben-thu-ba/` trả 200 trên production |
| 4 | `export:odbl` | dbtest `export-odbl` xanh (DB tests run `<id>`); chạy thật trên máy chủ: 5 bảng, `src_osm_place` N dòng, thư mục `out/odbl/<yyyymmdd>` |
| 5 | Checklist pháp lý | `docs/legal/checklist-phap-ly.md` ký ngày `<ngày>`; 6 việc tay B1–B6 ghi rõ hạn |

Gate cuối: lint · typecheck · root test N · api N · dbtest N · docs e2e 11/11. Remote trên `<sha>`: CI / Deploy API / Deploy Docs / API DB / DB tests đều xanh (link run).
```

Mục 3 (Quyết định phát sinh): thêm 10 dòng cho 10 quyết định thiết kế ở đầu plan (ngày, quyết định, lý do, commit).

Mục 1 (Trạng thái hiện tại): dòng đầu đổi thành
`- Mốc: **M5 — Phát hành nội bộ đã nghiệm thu <ngày>**. **Spec bản 2 hoàn tất; bước kế tiếp: brainstorming + spec `@mapslibvn/react-native`** (spec 8.1).`

Mục 2 (Bước kế tiếp): thay bằng
```
**BẮT ĐẦU TỪ ĐÂY: brainstorming + spec riêng cho `@mapslibvn/react-native` (spec 8.1; bọc
`@maplibre/maplibre-react-native`, dùng `/v1/styles/*.json` + `@mapslibvn/core`, key `mobile`).**
Trước đó đọc `docs/legal/checklist-phap-ly.md` mục B/C — các việc tay còn lại của PHONG.
```
Giữ nguyên các đoạn "Việc tay còn lại" cũ nhưng trỏ sang checklist mục C thay vì lặp lại.

- [x] **Step 6: Roadmap mục 7 tick + plan tick trọn**

`docs/superpowers/plans/2026-08-26-roadmap-toan-bo-spec.md`:
```
- [x] M5 nghiệm thu (ứng dụng nhúng độc lập bằng key riêng, docs, báo cáo tuần, việc tay pháp lý ghi rõ) — <ngày>.
- [x] `docs/DEVLOG.md` mục "Trạng thái hiện tại" ghi "Spec bản 2 hoàn tất; bước kế tiếp: spec React Native".
```
Mục 0.4 bảng plan: dòng 6 cột "Khi nào" → `Viết 02/09/2026: docs/superpowers/plans/2026-09-02-m5-phat-hanh-noi-bo.md`.

Kiểm plan này không còn `- [ ]`: `grep -c '^- \[ \]' docs/superpowers/plans/2026-09-02-m5-phat-hanh-noi-bo.md` → `0`.

- [x] **Step 7: Gate cuối + commit + kiểm remote**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @mapslibvn/docs build && pnpm --filter @mapslibvn/docs e2e`
Expected: tất cả xanh.

```bash
git add docs/legal/checklist-phap-ly.md docs/DEVLOG.md docs/superpowers/plans/2026-08-26-roadmap-toan-bo-spec.md docs/superpowers/plans/2026-09-02-m5-phat-hanh-noi-bo.md
git commit -m "docs: nghiệm thu M5 — phát hành nội bộ, checklist pháp lý, spec bản 2 hoàn tất"
git push
GH_TOKEN="$(cat ~/.config/gh-dotienphong.token)" gh run list --repo dotienphong/maps-library-vietnam --limit 6
```
Expected: mọi workflow của commit cuối `completed success`; dán link run vào DEVLOG mục 10 (commit sửa nhỏ `docs: link CI nghiệm thu M5` nếu cần).

---

## Thứ tự thực thi và phụ thuộc

`0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9`. Task 1–7 hoàn toàn làm được trên máy dev, không cần PHONG. Task 8 chặn bởi việc tay (Email Sending + token) — có thể xin PHONG làm song song ngay từ khi bắt đầu Task 6 để không phải chờ. Task 9 Step 1–3 làm được trên máy dev (origin `http://localhost:5500`, không cần app nào khác); Step 4 cần PHONG ký checklist.

## Khác biệt so với roadmap mục 6 (đã cân nhắc)

- "email qua Cloudflare Email Routing" → **Email Sending REST API** (Email Routing không gửi thư đi). Quyết định 1.
- `db/seed/tenant_nhung_thu.sql` (roadmap gọi `tenant_ketban.sql`) chỉ seed tenant; key sinh bằng `pnpm key:issue`. Quyết định 3.
- Nghiệm thu "nhúng bằng key riêng" dùng trang thử độc lập `examples/embed-web/index.html` ở origin riêng, **không gắn với app nào của PHONG** — MapsLibVN là thư viện độc lập; spec 13/M5 và roadmap mục 6 từng ghi "app kết bạn" làm ví dụ, đã sửa thành trung lập ngày 02/09/2026.
- Thêm `LICENSE` gốc repo, `scripts/notices-sync.mjs`, `docs/legal/checklist-phap-ly.md`, 2 trang docs sinh (`dieu-khoan`, `thong-bao-ben-thu-ba`) — không có trong bảng file roadmap nhưng cần để "notices đóng gói trong SDK" và "checklist ký bởi PHONG" có vật chứng cụ thể.
- `cron.mjs` đổi thành nhiều job để báo cáo tuần chạy tự động trên máy chủ (spec 11.3 "báo cáo tuần tự động").
