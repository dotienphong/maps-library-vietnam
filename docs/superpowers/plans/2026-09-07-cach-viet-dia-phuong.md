# Nhận diện cách viết địa phương — Implementation Plan (Hạng mục 3 của spec 05/09)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Trạng thái 08/09/2026 sau khi thực thi xong:** Task 0–15 đóng. Task 16 đóng trừ **bước 7** —
> tiêu chí 11.6 đo trên production được **3/20**, không đạt mốc 18/20. Nguyên nhân đã đo tách bạch
> (bậc 2/3 không kích hoạt ở quy mô 1,52 triệu POI; `LIMIT 20` bão hoà trong bậc 1; OSM thiếu
> `old_name` cho tên đường cũ) và ghi ở `docs/evidence/search-keys/16-nghiem-thu-production.md`.
> Sửa được đòi **đổi spec mục 5.4**, nên dừng lại chờ quyết định.

**Goal:** Người dùng gõ địa danh theo cách viết khác (`qui nhon`, `kontum`, `dak lak`, `tan son nhut`, `ban me thuot`), gõ theo phát âm vùng (`bin than`, `mi tho`) hoặc gõ **tên cũ** của đường (`cong ly`) vẫn tìm ra đúng đích trong top 3 của autocomplete, mà p95 nhánh có kết quả sớm không tăng quá 50 ms.

**Architecture:** Ba lớp bổ trợ nhau, từ rẻ đến đắt, tất cả dùng cùng khung "chuẩn hoá ở `@mapslibvn/core`, cột dẫn xuất tính trong pipeline, truy vấn theo **bậc** trong API". (1) Từ điển biến thể địa danh áp lên **cả truy vấn lẫn dữ liệu**; (2) khoá ngữ âm `viKey()` — bảng luật dưới dạng dữ liệu — sinh cột `name_key` cho `poi`/`street`/`admin_area`/`admin_area_old` và `alias_key` cho `admin_alias`; (3) tên thay thế của OSM (`alt_name`/`old_name`) thành cột `name_alt_norm` cho `poi` và `street`. API thêm bậc 2 (token không kể thứ tự, tsvector) và bậc 3 (`qKey <% name_key`), **chỉ chạy khi bậc trước chưa đủ `limit`**; kết quả bậc sau chịu `STAGE_PENALTY`. Cột mới **NULL cho tới khi pipeline chạy**, API phải coi NULL là không khớp — điều này được **chứng minh bằng test DB thật**, không suy từ lời văn.

**Tech Stack:** Node ≥22, pnpm 9.15, TypeScript, PostgreSQL 16 + pg_trgm + tsvector `'simple'`, postgres.js, Hono/Cloudflare Workers, Vitest (`@cloudflare/vitest-pool-workers` cho `apps/api`), Biome, Osmium trong pipeline container.

**Spec:** [Thiết kế đã duyệt](../specs/2026-09-05-tim-kiem-alias-fuzzy-dia-phuong-design.md) mục **6** (toàn bộ), **5.4–5.7** (bậc 2, 3, 3b, xếp hạng/đo), **7** (hợp đồng API/SDK), **8** (migration 0009), **9** (kiểm thử), **11** (tiêu chí 3, 4, 6, 7).

**Trạng thái:** viết 07/09/2026 bởi Fable 5.1 sau khi hạng mục 1 đóng (Task 0–9, `405dadf`). Chưa thực thi. Viết plan **không** đồng nghĩa đã chạy migration, backfill hay deploy.

---

## Quy tắc repo phải nhớ (từ memory dự án và bài học hôm 07/09)

- Test trong `apps/api` **không được cần Postgres**: Hyperdrive trong `apps/api/vitest.config.ts` trỏ cổng đóng. Mọi test SQL ở đây dùng tag `sql` giả `apps/api/test/helpers/fake-sql.ts` (ghi `{ text, params }`).
- **Bind mảng trong SQL của Workers**: KHÔNG bao giờ viết `${[...arr]}::text[]`. Bản `postgres/cf` nối mảng thành chuỗi `"a,b,c"` và Postgres ném `malformed array literal`; bản Node serialize đúng nên **unit test không thấy** — sự cố 07/09 làm 4 route 503. Dùng `textArray(sql, arr)` từ `apps/api/src/geocode.ts` (đã export). Bộ `pnpm test:api-db` là tầng duy nhất bắt được lớp lỗi này — mọi task chạm SQL của API phải chạy nó.
- `tsconfig.base.json` bật `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`; `scripts/*.mjs` và `pipelines/**/*.mjs` bị `checkJs`. `pnpm typecheck` giờ **build core trước** (`44da644`), nên chạy nó là đủ; `pnpm lint` không bắt lỗi kiểu.
- `pnpm test:db` trên máy dev luôn đỏ ở `pipeline-fixture.dbtest.mjs` vì thiếu `tippecanoe`; các dbtest khác phải xanh; CI `dbtest.yml` là cổng đầy đủ. Chạy dbtest lẻ bằng `DATABASE_URL=postgres://mapslibvn:mapslibvn@localhost:5432/mapslibvn_task8_test pnpm exec vitest run --config vitest.db.config.ts <file>` sau khi tạo lại DB đó (xem Task 5 bước 4). **Không chạy hai runner reset DB cùng lúc.**
- `.dockerignore` loại `pipelines/poi/fixtures` và `pipelines/tiles/fixtures`; file nào trong đó mà **code chạy thật** cần thì phải thêm ngoại lệ `!…` (bài học `731cc10`). Plan này không thêm fixture vào hai thư mục đó.
- Sau khi sửa code pipeline: `pnpm image:build && pnpm image:smoke`, rồi `cd infra/server && docker compose --env-file .env -f compose.yml up -d --force-recreate pipeline backup`. **Không** để container chạy code `docker cp`; cron `data:update` thứ Hai 02:00 dùng code trong container.
- Deploy API giờ **bị chặn** bởi `apitest.yml` (`f9f5fdb`) — push chạm `apps/api/**` sẽ chạy bộ DB thật trước khi deploy. Đừng tắt cổng đó để đi nhanh.
- Thứ tự phát hành: **migration trước, deploy sau**, và kiểm `/healthz/db` trả `schema_migration: 0009_search_keys.sql` trước khi tin (memory `deploy-truoc-migration`).
- Lệnh `wrangler` chạy từ `apps/api`; `.env` ở gốc repo. Máy chủ "nội bộ" là docker compose **trên chính máy dev** (`mapslibvn-server-*`), DB đó **là production**; postgres không mở cổng, đi qua container `pipeline`.
- Commit message tiếng Việt kiểu `feat(core): …`, kết bằng dòng `Co-Authored-By`. Mỗi task cập nhật DEVLOG và ghi bằng chứng trước commit.

## Quyết định triển khai cần đọc cùng spec

Các điểm dưới cụ thể hoá hoặc **sửa** giả định kỹ thuật của spec; nếu thực nghiệm buộc đổi hợp đồng, cập nhật spec và báo PHONG trước phần phụ thuộc.

1. **`name_tsv` là cột thường, không phải `GENERATED ALWAYS … STORED` như spec 5.4.** Cả hai đường publish của repo đều chép nguyên cột: `publishNew()` chạy `INSERT INTO t SELECT * FROM t_new` và `publish.mjs` chạy `INSERT INTO poi SELECT n.* FROM poi_new n`. Với generated column, `INSERT … SELECT *` thất bại (`cannot insert a non-DEFAULT value into column "name_tsv"`). Sửa `publishNew` thành liệt kê cột trừ generated là đụng hạ tầng dùng chung cho mọi bảng; đơn giản và tường minh hơn là cột thường, giá trị `to_tsvector('simple', name_norm)` tính **trong cùng câu INSERT/UPDATE** của pipeline. Migration 0009 **backfill `name_tsv` bằng SQL** ngay (rẻ, không cần Node) để bậc 2 có hiệu lực từ lúc deploy; `name_key`/`name_alt_norm` không backfill được bằng SQL (hàm ở TS) nên NULL cho tới Task 16.
2. **`name_alt_norm` là chuỗi nối `' | '` (có chỉ số GIN trgm) và `name_alt` giữ mảng gốc song song**, để tìm được **tên gốc** đã khớp cho `matched_alt`: `unnest(name_alt, string_to_array(name_alt_norm, ' | '))` giữ thẳng hàng hai mảng. `normalizeVi` xoá `|` (không nằm trong `[a-z0-9/\-\s]`) nên dấu phân cách an toàn. `street` chưa có `name_alt` → migration 0009 thêm `name_alt text[]`.
3. **Từ điển 6.1 áp cả hai phía.** Phía dữ liệu: `name_key = viKey(applyToponymAlias(name_norm))` (đúng spec). Phía truy vấn: ngoài `qKey` cho bậc 3, bậc 1 thêm nhánh `${qAlias} <% name_norm` khi `qAlias = applyToponymAlias(qNorm)` **khác** `qNorm`, để `qui nhon` khớp `name_norm = 'quy nhon'` ngay ở bậc 1 mà không chờ backfill. Đây là lý do tiêu chí 11.6 đạt được **trước** khi pipeline chạy lại.
4. **Mỗi dòng từ điển phải có `source`** kiểm được (OSM `alt_name`/`old_name` qua Overpass, hoặc Wikipedia). Task 2 cho lệnh kiểm; dòng không kiểm được thì **bỏ**, không đoán. Danh sách spec là danh sách **ứng viên**.
5. **Cặp "không được gộp" trong fixture `viKey`:** spec nêu `Tân/Tần` — nhưng hai từ đó đã **trùng** sau `normalizeVi` (`tan`), không luật nào tách được; thay bằng các cặp thật sự khác nhau trước `viKey` và phải giữ khác sau `viKey`: `ha noi`/`ha loi` (không áp `l/n`), `tan`/`tran` (`tr→c` cho `can`), `nam`/`lam`, `bac`/`bat`? — không: `-c` giữ, `-t→-c` nên `bat→bac` **gộp với** `bac` — đây là hành vi **cố ý** của spec (âm cuối miền Nam) và fixture phải ghi rõ là cặp **được** gộp. Task 1 liệt kê cả hai nhóm.
6. **Bậc chỉ chạy khi thiếu**, dedup theo `type + (id ?? name + secondary)` để bậc 3 không lặp lại kết quả bậc 1. `STAGE_PENALTY = 0.05·(stage−1)` trừ vào điểm, đúng 5.7.
7. **Bậc 3b (Telex/VNI) cài nhưng TẮT** sau cờ `AUTOCOMPLETE_TELEX` (vars trong `wrangler.toml`, mặc định không đặt). Spec 5.6 nói bật sau khi có số liệu `stage_hit`.
8. **`stage_hit` ghi vào Analytics Engine** bằng `doubles[2]` của middleware sẵn có (`analytics.ts`), không thêm dataset mới. `-1` khi route không đặt (endpoint khác).
9. **Backfill một lần bằng script**, không chờ cron thứ Hai: `scripts/backfill-search-keys.mjs` chạy trong container pipeline trên production, ghi theo lô qua bảng tạm + `UPDATE … FROM`, idempotent. Tên thay thế của đường (`street.name_alt`) thì cần chạy lại `osm-roads.mjs → streets.mjs → alleys.mjs` (khoảng 10 phút theo số đo 07/09), làm ở Task 16 như một lần publish có chủ đích.
10. **Không đổi PK, không đổi `word_similarity_threshold`, không đổi xếp hạng POI/đường đã nghiệm thu** ngoài `STAGE_PENALTY` (chỉ ảnh hưởng kết quả bậc 2–3). Không làm đồng nghĩa loại địa điểm (spec 12).

## Global Constraints

- Mọi thay đổi hợp đồng API/SDK là **bổ sung**: chỉ thêm `matched_alt?`. Không đổi/bỏ trường hiện có.
- **Mọi nhánh WHERE phải có chỉ số**: `name_key`/`alias_key`/`name_alt_norm` GIN trgm, `name_tsv` GIN. Task 16 kiểm `EXPLAIN` trên production cho một truy vấn mỗi bậc.
- API phải chạy đúng khi mọi cột mới NULL (trước backfill) — Task 13 kiểm bằng DB thật.
- Không nạp dataset cộng đồng khác giấy phép; từ điển biên soạn tay có nguồn OSM/Wikipedia.
- Không sửa `AGENTS.md`.

## Bản đồ file

| Nhóm | File | Trách nhiệm |
|---|---|---|
| Core | `packages/core/src/vi_key_rules.json` (mới), `vi-key.ts` (mới), `toponym_alias.json` (mới), `toponym.ts` (mới), `search-keys.ts` (mới), `telex.ts` (mới), `types.ts`, `index.ts` | `viKey`, `applyToponymAlias`, `searchKeys`, `foldTelex`/`looksLikeTelex`; `AutocompleteItem.matched_alt?` |
| Core tests | `packages/core/tests/vi-key.test.ts`, `fixtures/vi-key.csv`, `tests/toponym.test.ts`, `tests/search-keys.test.ts`, `tests/telex.test.ts` (mới) | fixture ≥ 100 dòng; test "biến thể ≠ chuẩn sau normalizeVi" |
| Schema | `db/migrations/0009_search_keys.sql`, `.down.sql` (mới); `db/schema.dbtest.mjs`; `scripts/lib/odbl.mjs`; `db/export-odbl.dbtest.mjs` | cột + chỉ số; backfill `name_tsv`; export ODbL có cột mới |
| Pipeline | `pipelines/poi/src/lib/search-keys.mjs` (mới, +`.test.mjs`), `records.mjs`, `publish.mjs`, `geocode/raw-tables.mjs`, `geocode/osm-roads.mjs`, `geocode/streets.mjs`, `geocode/admin.mjs`, `geocode/admin-overlay.mjs` | tính `name_key`/`name_alt_norm`/`name_tsv` trong bảng `_new`; `street.name_alt` từ tag OSM |
| Pipeline tests | `pipelines/poi/tests/geocode.dbtest.mjs`, `admin-old.dbtest.mjs`, `pipelines/poi/src/records.test.mjs` (mới nếu chưa có) | đối chiếu `name_key` tính lại bằng Node |
| Backfill | `scripts/backfill-search-keys.mjs` (+`.test.mjs`) (mới) | điền cột mới cho dữ liệu đã publish, theo lô, idempotent |
| API | `apps/api/src/stages.ts` (mới), `autocomplete-sql.ts`, `area-candidates.ts`, `ranking.ts`, `routes/autocomplete.ts`, `routes/search.ts`, `geocode.ts`, `analytics.ts`, `env.ts` | bậc 2–3, `matched_alt`, `STAGE_PENALTY`, `stage_hit`, cờ Telex |
| API tests | `apps/api/test/stages.test.ts` (mới), `autocomplete-sql.test.ts`, `ranking.test.ts`, `search.test.ts`, `geocode.test.ts`; `apps/api/test-db/setup.sql`, `places.itest.mjs` | không DB: chuỗi SQL; DB thật: NULL-safe + biến thể |
| SDK/docs | `packages/web/src/autocomplete.ts` (dòng phụ `matched_alt`), 4 `package.json` (0.4.0), `apps/docs/src/content/docs/tim-kiem.md`, `api.md`, `pipelines/poi/README.md`, `apps/docs/e2e/*` | hiển thị tên cũ; tài liệu; e2e "qui nhon" |
| Đo | `scripts/fixtures/local-variant-queries.txt` (mới), `scripts/perf-autocomplete.mjs` | bộ 20 truy vấn biến thể; baseline/after |
| Hồ sơ | `docs/evidence/search-keys/*.md|json` (mới), `docs/DEVLOG.md`, plan này | số đo, EXPLAIN, `stage_hit` |

---

## Task 0: Baseline trước khi đổi bất cứ gì

**Files:**
- Create: `scripts/fixtures/local-variant-queries.txt`
- Create: `docs/evidence/search-keys/0-baseline.md`

- [x] **Bước 1: Tạo bộ truy vấn biến thể** (20 dòng, mỗi dòng `q|đích`; đích là chuỗi không dấu phải nằm trong `name` của top-3)

```
# 20 truy vấn cách viết địa phương — spec 11.6 và mục 6.1/6.2. Baseline đo TRƯỚC hạng mục 3.
# --- 8 biến thể chính tả địa danh (6.1) ---
qui nhon|quy nhon
quinhon|quy nhon
kontum|kon tum
dak lak|dak lak
dac lac|dak lak
ban me thuot|buon ma thuot
bmt|buon ma thuot
tan son nhut|tan son nhat
# --- 6 phát âm vùng / i-y (6.2) ---
mi tho|my tho
bin than|binh thanh
ly thuong kiet|ly thuong kiet
li thuong kiet|ly thuong kiet
bac can|bac kan
plei ku|pleiku
# --- 4 tên cũ của đường (6.3) — cần street.name_alt, kỳ vọng ĐỎ ở baseline ---
cong ly|nam ky khoi nghia
duong cong ly|nam ky khoi nghia
hien vuong|vo thi sau
truong minh giang|le van sy
# --- 2 dính/tách từ ---
saigon|sai gon
hoian|hoi an
```

- [x] **Bước 2: Đo baseline trên production** (dùng công cụ đã có; `API_KEY` là `KEY_EXAMPLE_EMBED` trong `.env`)

Run:
```bash
set -a; . ./.env; set +a
node scripts/perf-autocomplete.mjs https://api.ai-solutions.io.vn "$KEY_EXAMPLE_EMBED" --queries scripts/fixtures/local-variant-queries.txt
node scripts/perf-autocomplete.mjs https://api.ai-solutions.io.vn "$KEY_EXAMPLE_EMBED" --queries scripts/fixtures/fuzzy-queries.txt
```
Expected: dòng `hit@3=<n>/20 miss: …` cho bộ mới (kỳ vọng thấp, đặc biệt 4 ca tên đường cũ đỏ) và `hit@3=37/40` cho bộ fuzzy (baseline đã biết).

- [x] **Bước 3: Ghi baseline** vào `docs/evidence/search-keys/0-baseline.md` — bảng hai bộ (hit@3, p50/p95/p99), ngày giờ, SHA production (`git rev-parse --short HEAD`), và số đo phía Worker lấy như 8.5 (`$workers.wallTimeMs` p50/p95 cho `/v1/autocomplete` 30 phút quanh lúc đo).

- [x] **Bước 4: Commit**

```bash
git add scripts/fixtures/local-variant-queries.txt docs/evidence/search-keys/0-baseline.md
git commit -m "test(search): bộ 20 truy vấn cách viết địa phương và baseline trước hạng mục 3"
```

---

## Task 1: `viKey()` trong core — bảng luật là dữ liệu

**Files:**
- Create: `packages/core/src/vi_key_rules.json`
- Create: `packages/core/src/vi-key.ts`
- Create: `packages/core/tests/fixtures/vi-key.csv`
- Create: `packages/core/tests/vi-key.test.ts`
- Modify: `packages/core/src/index.ts`

- [x] **Bước 1: Viết fixture ≥ 100 dòng** `packages/core/tests/fixtures/vi-key.csv`, định dạng `input|key`, `#` là chú thích. Nhóm bắt buộc có đủ: i/y, `quy`, `k→c`, `ph→f`, `gi/r/d→d`, `tr/ch→c`, `x→s`, `gh/ngh`, âm cuối `-ng/-nh→-n`, `-t→-c`, dính/tách từ, và hai nhóm cặp: **được gộp** (cùng key) và **không được gộp** (khác key). Mẫu 30 dòng đầu (viết tiếp tới ≥ 100, mỗi luật ≥ 8 ca):

```
# input|key — input là chuỗi ĐÃ normalizeVi (không dấu, thường). key nối từ không khoảng trắng.
# i/y
my tho|mitho
mi tho|mitho
ly thuong kiet|lithuonkiec
li thuong kiet|lithuonkiec
ky anh|kian
hy vong|hivon
quy nhon|quinhon
qui nhon|quinhon
# k dau tu truoc a o u -> c
bac kan|baccan
bac can|baccan
kon tum|contum
kontum|contum
# ph -> f
pho co|foco
fo co|foco
# gi / r / d -> d
gia lai|dalai
da lai|dalai
rach gia|dachda
# tr / ch -> c
tran hung dao|canhundao
chan hung dao|canhundao
# x -> s
xoc trang|soccan
soc trang|soccan
# gh, ngh
nghe an|ngean
ghenh rang|gendan
# am cuoi -ng/-nh -> -n, -t -> -c
binh thanh|binthan
bin than|binthan
viet nam|viecnam
viec nam|viecnam
# dinh / tach tu (g giữa từ KHÔNG đổi — chỉ ^gi trước nguyên âm mới thành d)
saigon|saigon
sai gon|saigon
# --- CAP KHONG DUOC GOP (key phai KHAC nhau) — test doc theo cap, xem vi-key.test.ts ---
# ha noi|hanoi     vs   ha loi|haloi      (khong ap l/n)
# tan|tan          vs   tran|can          (tr->c)
# nam|nam          vs   lam|lam
# --- CAP DUOC GOP CO Y (am cuoi mien Nam) ---
# bac|bac          vs   bat|bac
```

- [x] **Bước 2: Viết test đỏ** `packages/core/tests/vi-key.test.ts`

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeVi } from '../src/normalize';
import { viKey } from '../src/vi-key';

const lines = readFileSync(fileURLToPath(new URL('./fixtures/vi-key.csv', import.meta.url)), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => {
    const [input, key] = l.split('|') as [string, string];
    return { input, key };
  });

describe('viKey — fixture vi-key.csv', () => {
  it('có ≥ 100 dòng', () => {
    expect(lines.length).toBeGreaterThanOrEqual(100);
  });
  for (const { input, key } of lines) {
    it(`${input} → ${key}`, () => {
      expect(viKey(input)).toBe(key);
    });
  }
  it('input trong fixture đã là dạng normalizeVi (không dấu, thường)', () => {
    for (const { input } of lines) expect(normalizeVi(input)).toBe(input);
  });
});

describe('viKey — cặp không được gộp (spec 6.2)', () => {
  const distinct: [string, string][] = [
    ['ha noi', 'ha loi'], // không áp l/n: va chạm tên riêng thật
    ['tan', 'tran'], // tr→c cho 'can', khác 'tan'
    ['nam', 'lam'],
    ['hue', 'hua'],
  ];
  for (const [a, b] of distinct) {
    it(`${a} ≠ ${b}`, () => {
      expect(viKey(a)).not.toBe(viKey(b));
    });
  }
});

describe('viKey — cặp được gộp cố ý (âm cuối miền Nam)', () => {
  const merged: [string, string][] = [
    ['bac', 'bat'],
    ['binh thanh', 'bin than'],
    ['viet', 'viec'],
  ];
  for (const [a, b] of merged) {
    it(`${a} = ${b}`, () => {
      expect(viKey(a)).toBe(viKey(b));
    });
  }
});

describe('viKey — hình dạng', () => {
  it('không có khoảng trắng và không có ký tự ngoài a-z0-9', () => {
    expect(viKey('88/9 nguyen lam')).toMatch(/^[a-z0-9]+$/);
  });
  it('chuỗi rỗng → rỗng', () => {
    expect(viKey('')).toBe('');
  });
  it('idempotent trên dữ liệu đã là key', () => {
    const k = viKey('binh thanh');
    expect(viKey(k)).toBe(k);
  });
});
```

- [x] **Bước 3: Chạy test, xác nhận đỏ**

Run: `pnpm exec vitest run packages/core/tests/vi-key.test.ts`
Expected: FAIL — `Cannot find module '../src/vi-key'`.

- [x] **Bước 4: Viết bảng luật** `packages/core/src/vi_key_rules.json` — thứ tự **có ý nghĩa**: đầu từ trước, âm cuối sau, i/y cuối cùng. Mỗi luật `[regex, thay]` áp trên **từng từ** với cờ `g`.

```json
{
  "$comment": "Spec 05/09 mục 6.2. Áp SAU normalizeVi + toponym alias, theo từng từ, rồi nối không khoảng trắng. Chỉ dùng ở bậc 3 nên va chạm chỉ ảnh hưởng thứ tự trong nhóm mờ. KHÔNG áp l/n (Hà Nội ↔ Hà Lội va chạm tên riêng thật quá nhiều).",
  "wordStart": [
    ["^ngh", "ng"],
    ["^gh", "g"],
    ["^ph", "f"],
    ["^gi(?=[aeiouy])", "d"],
    ["^r", "d"],
    ["^tr", "c"],
    ["^ch", "c"],
    ["^x", "s"],
    ["^k(?=[aou])", "c"]
  ],
  "wordEnd": [
    ["ng$", "n"],
    ["nh$", "n"],
    ["t$", "c"]
  ],
  "anywhere": [
    ["quy", "qui"],
    ["([bcdfghklmnpqrstvx])y$", "$1i"]
  ]
}
```

- [x] **Bước 5: Viết `packages/core/src/vi-key.ts`**

```ts
import rulesJson from './vi_key_rules.json';

type Rule = [string, string];
interface Rules {
  wordStart: Rule[];
  wordEnd: Rule[];
  anywhere: Rule[];
}

const RULES: Rules = rulesJson as Rules;
const compile = (rules: Rule[]) =>
  rules.map(([pattern, replacement]) => ({ re: new RegExp(pattern, 'g'), replacement }));
const WORD_START = compile(RULES.wordStart);
const WORD_END = compile(RULES.wordEnd);
const ANYWHERE = compile(RULES.anywhere);

/**
 * Khoá ngữ âm cho tiếng Việt không dấu (spec 6.2). Đầu vào phải là chuỗi đã `normalizeVi`
 * (và đã qua `applyToponymAlias` nếu muốn — xem `searchKeys`). Áp luật theo TỪNG từ, thứ tự:
 * đầu từ → âm cuối → i/y, rồi nối không khoảng trắng để bao luôn dính/tách từ.
 * Chỉ giữ a-z0-9: dấu `/` `-` trong số nhà bị bỏ.
 */
export function viKey(normalized: string): string {
  const words = normalized
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const out = words.map((word) => {
    let w = word;
    for (const { re, replacement } of WORD_START) w = w.replace(re, replacement);
    for (const { re, replacement } of WORD_END) w = w.replace(re, replacement);
    for (const { re, replacement } of ANYWHERE) w = w.replace(re, replacement);
    return w;
  });
  return out.join('');
}
```

Lưu ý khi chạy fixture: luật `^gi(?=[aeiouy])` biến `gia`→`da` nhưng giữ `gin`; luật `quy`→`qui` chạy ở `anywhere` nên `quynh`→`quinh`. Nếu một dòng fixture đỏ, **sửa fixture cho khớp luật spec** chỉ khi luật đúng spec; nếu luật sai spec thì sửa JSON. Ghi lại từng quyết định vào chú thích của fixture.

- [x] **Bước 6: Export** — thêm vào `packages/core/src/index.ts`:

```ts
export * from './vi-key';
```

- [x] **Bước 7: Chạy test, xác nhận xanh**

Run: `pnpm exec vitest run packages/core/tests/vi-key.test.ts`
Expected: PASS toàn bộ (≥ 100 ca fixture + 4 cặp khác + 3 cặp gộp + 3 hình dạng).

- [x] **Bước 8: Typecheck + lint + build core**

Run: `pnpm --filter @mapslibvn/core build && pnpm typecheck && pnpm lint`
Expected: cả ba xanh. `size-limit` trong build core có thể báo vượt — nếu vượt vì `vi_key_rules.json` (rất nhỏ) thì không; nếu vượt thì xem lại `.size-limit.json` trước khi nới.

- [x] **Bước 9: Commit**

```bash
git add packages/core/src/vi_key_rules.json packages/core/src/vi-key.ts packages/core/src/index.ts packages/core/tests/vi-key.test.ts packages/core/tests/fixtures/vi-key.csv
git commit -m "feat(core): viKey — khoá ngữ âm theo bảng luật dữ liệu, fixture ≥100 dòng"
```

---

## Task 2: Từ điển biến thể địa danh `applyToponymAlias()`

**Files:**
- Create: `packages/core/src/toponym_alias.json`
- Create: `packages/core/src/toponym.ts`
- Create: `packages/core/tests/toponym.test.ts`
- Modify: `packages/core/src/index.ts`

- [x] **Bước 1: Kiểm nguồn cho từng ứng viên** (spec: mỗi dòng phải có nguồn). Với mỗi cặp trong bảng 6.1, chạy Overpass tìm relation/node có `name` chuẩn và xem `alt_name`/`old_name`/`official_name`/`name:en`:

```bash
curl -s -G https://overpass-api.de/api/interpreter --data-urlencode 'data=[out:json][timeout:25];
area["ISO3166-1"="VN"]->.vn;
(relation["boundary"="administrative"]["name"~"^(Quy Nhơn|Thành phố Quy Nhơn)$"](area.vn);
 node["place"]["name"~"^Quy Nhơn$"](area.vn););
out tags;' | python3 -c "import sys,json; [print(e['type'],e['id'],{k:v for k,v in e['tags'].items() if k in ('name','alt_name','old_name','official_name','name:en','short_name')}) for e in json.load(sys.stdin)['elements']]"
```

Ghi `source` = `"osm:<type>/<id> <tag>"` khi tag chứa biến thể; nếu không, tìm trên Wikipedia tiếng Việt (mục "Tên gọi") và ghi `"wikipedia:vi:<Tiêu đề trang>"`. **Không có nguồn thì không đưa vào.** Kỳ vọng thực tế: `bmt`, `sg` khó có nguồn OSM — chỉ giữ nếu Wikipedia có; `tourane`, `faifo` có trên Wikipedia.

- [x] **Bước 2: Viết test đỏ** `packages/core/tests/toponym.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { normalizeVi } from '../src/normalize';
import toponymJson from '../src/toponym_alias.json';
import { TOPONYM_ALIAS, applyToponymAlias } from '../src/toponym';

describe('toponym_alias.json — hình dạng và nguồn', () => {
  const entries = Object.entries(toponymJson as Record<string, { variants: string[]; source: string }>);
  it('có ít nhất 15 địa danh', () => {
    expect(entries.length).toBeGreaterThanOrEqual(15);
  });
  for (const [canonical, { variants, source }] of entries) {
    it(`${canonical}: chuẩn và biến thể đã normalizeVi, có nguồn`, () => {
      expect(normalizeVi(canonical)).toBe(canonical);
      expect(source).toMatch(/^(osm:(node|way|relation)\/\d+ \S+|wikipedia:vi:.+)$/);
      for (const v of variants) expect(normalizeVi(v)).toBe(v);
    });
    // Spec 6.1: cặp chỉ khác DẤU đã trùng sau normalizeVi → không được đưa vào; test này đỏ để
    // người biên soạn xoá dòng.
    it(`${canonical}: mọi biến thể phải KHÁC dạng chuẩn`, () => {
      for (const v of variants) expect(v).not.toBe(canonical);
    });
  }
  it('không biến thể nào trùng giữa hai địa danh khác nhau', () => {
    const seen = new Map<string, string>();
    for (const [canonical, { variants }] of entries)
      for (const v of variants) {
        expect(seen.get(v), `biến thể "${v}" thuộc cả ${seen.get(v)} và ${canonical}`).toBeUndefined();
        seen.set(v, canonical);
      }
  });
});

describe('applyToponymAlias', () => {
  it('thay ở đầu, giữa và cuối chuỗi theo biên từ', () => {
    expect(applyToponymAlias('qui nhon')).toBe('quy nhon');
    expect(applyToponymAlias('cafe qui nhon 2')).toBe('cafe quy nhon 2');
    expect(applyToponymAlias('duong ve qui nhon')).toBe('duong ve quy nhon');
  });
  it('không thay khi biến thể là một phần của từ khác', () => {
    expect(applyToponymAlias('sgd')).toBe('sgd'); // 'sg' không được khớp bên trong 'sgd'
  });
  it('biến thể dài ưu tiên trước biến thể ngắn', () => {
    // 'buon me thuot' phải thành 'buon ma thuot' trọn cụm, không bị 'bmt' hay từ đơn xen vào
    expect(applyToponymAlias('buon me thuot')).toBe('buon ma thuot');
  });
  it('chuỗi không có biến thể thì trả nguyên', () => {
    expect(applyToponymAlias('nguyen hue')).toBe('nguyen hue');
  });
  it('TOPONYM_ALIAS export để pipeline dùng cùng bảng', () => {
    expect(Object.keys(TOPONYM_ALIAS)).toContain('quy nhon');
  });
});
```

- [x] **Bước 3: Chạy test, xác nhận đỏ**

Run: `pnpm exec vitest run packages/core/tests/toponym.test.ts`
Expected: FAIL — `Cannot find module '../src/toponym'`.

- [x] **Bước 4: Viết `packages/core/src/toponym_alias.json`** — chỉ những dòng đã kiểm nguồn ở bước 1. Hình dạng bắt buộc:

```json
{
  "quy nhon": { "variants": ["qui nhon", "quinhon"], "source": "wikipedia:vi:Quy Nhơn" },
  "bac kan": { "variants": ["bac can"], "source": "wikipedia:vi:Bắc Kạn" },
  "dak lak": { "variants": ["dac lac", "daklak", "dak lac", "dac lak"], "source": "wikipedia:vi:Đắk Lắk" },
  "dak nong": { "variants": ["dac nong"], "source": "wikipedia:vi:Đắk Nông" },
  "pleiku": { "variants": ["plei ku", "play cu"], "source": "wikipedia:vi:Pleiku" },
  "buon ma thuot": { "variants": ["ban me thuot", "buon me thuot"], "source": "wikipedia:vi:Buôn Ma Thuột" },
  "kon tum": { "variants": ["kontum"], "source": "wikipedia:vi:Kon Tum" },
  "my tho": { "variants": ["mi tho"], "source": "wikipedia:vi:Mỹ Tho" },
  "sai gon": { "variants": ["saigon"], "source": "wikipedia:vi:Sài Gòn" },
  "ha noi": { "variants": ["hanoi"], "source": "wikipedia:vi:Hà Nội" },
  "da nang": { "variants": ["danang", "tourane"], "source": "wikipedia:vi:Đà Nẵng" },
  "da lat": { "variants": ["dalat"], "source": "wikipedia:vi:Đà Lạt" },
  "nha trang": { "variants": ["nhatrang"], "source": "wikipedia:vi:Nha Trang" },
  "sa pa": { "variants": ["sapa"], "source": "wikipedia:vi:Sa Pa" },
  "tan son nhat": { "variants": ["tan son nhut"], "source": "wikipedia:vi:Sân bay quốc tế Tân Sơn Nhất" },
  "cho lon": { "variants": ["cholon"], "source": "wikipedia:vi:Chợ Lớn" },
  "hai phong": { "variants": ["haiphong"], "source": "wikipedia:vi:Hải Phòng" },
  "can tho": { "variants": ["cantho"], "source": "wikipedia:vi:Cần Thơ" },
  "soc trang": { "variants": ["xoc trang", "soctrang"], "source": "wikipedia:vi:Sóc Trăng" },
  "rach gia": { "variants": ["rachgia"], "source": "wikipedia:vi:Rạch Giá" },
  "hoi an": { "variants": ["faifo", "hoian"], "source": "wikipedia:vi:Hội An" },
  "ly son": { "variants": ["li son"], "source": "wikipedia:vi:Lý Sơn" },
  "ky anh": { "variants": ["ki anh"], "source": "wikipedia:vi:Kỳ Anh" }
}
```

Mỗi `source` ở trên là **giả định** để plan có hình dạng; bước 1 quyết định dòng nào ở lại và `source` thật là gì. `bmt`, `sg`, `phan rang thap cham`, `thua thien hue` (đây là đổi nghĩa, không phải cách viết) bỏ trừ khi bước 1 tìm được nguồn.

- [x] **Bước 5: Viết `packages/core/src/toponym.ts`**

```ts
import toponymJson from './toponym_alias.json';

interface ToponymEntry {
  variants: string[];
  source: string;
}

/** Dạng chuẩn → biến thể (đã `normalizeVi`), mỗi mục có nguồn. Pipeline và API dùng cùng bảng. */
export const TOPONYM_ALIAS: Record<string, ToponymEntry> = toponymJson as Record<string, ToponymEntry>;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Biến thể dài trước để "buon me thuot" không bị một biến thể con nuốt trước.
const RULES = Object.entries(TOPONYM_ALIAS)
  .flatMap(([canonical, { variants }]) => variants.map((variant) => ({ variant, canonical })))
  .sort((a, b) => b.variant.length - a.variant.length)
  .map(({ variant, canonical }) => ({
    re: new RegExp(`(^|\\s)${escapeRegExp(variant)}(?=\\s|$)`, 'g'),
    replacement: `$1${canonical}`,
  }));

/**
 * Thay biến thể địa danh bằng dạng chuẩn ở BẤT KỲ vị trí theo biên từ (khác `applyBrandAlias`
 * chỉ thay ở đầu chuỗi). Đầu vào phải đã `normalizeVi`. Dùng cho cả truy vấn (bậc 1 `qAlias`) và
 * dữ liệu (`name_key` — xem `searchKeys`).
 */
export function applyToponymAlias(normalized: string): string {
  let out = normalized;
  for (const { re, replacement } of RULES) out = out.replace(re, replacement);
  return out;
}
```

- [x] **Bước 6: Export** trong `packages/core/src/index.ts`:

```ts
export * from './toponym';
```

- [x] **Bước 7: Chạy test, xác nhận xanh**

Run: `pnpm exec vitest run packages/core/tests/toponym.test.ts`
Expected: PASS. Nếu test "biến thể phải KHÁC chuẩn" đỏ → xoá đúng dòng đó khỏi JSON (đó là mục đích của test).

- [x] **Bước 8: Typecheck + lint + build**

Run: `pnpm --filter @mapslibvn/core build && pnpm typecheck && pnpm lint`
Expected: xanh.

- [x] **Bước 9: Commit**

```bash
git add packages/core/src/toponym_alias.json packages/core/src/toponym.ts packages/core/src/index.ts packages/core/tests/toponym.test.ts
git commit -m "feat(core): từ điển biến thể địa danh có nguồn, áp theo biên từ ở mọi vị trí"
```

---

## Task 3: `foldTelex()` và `looksLikeTelex()` (bậc 3b, mặc định tắt)

**Files:**
- Create: `packages/core/src/telex.ts`
- Create: `packages/core/tests/telex.test.ts`
- Modify: `packages/core/src/index.ts`

- [x] **Bước 1: Test đỏ** `packages/core/tests/telex.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { foldTelex, looksLikeTelex } from '../src/telex';

describe('looksLikeTelex', () => {
  it('nhận mẫu telex/VNI', () => {
    for (const q of ['saif gonf', 'ddoongf khoiwr', 'ha noij', 'quan 1 ddaof', 'bach hoa xanh', 'tan binh1']) {
      expect(looksLikeTelex(q), q).toBe(true);
    }
  });
  it('không nhận chuỗi thường', () => {
    for (const q of ['sai gon', 'highlands', 'quan 10', 'circle k', '88/9 nguyen lam']) {
      expect(looksLikeTelex(q), q).toBe(false);
    }
  });
});

describe('foldTelex', () => {
  it('gộp nguyên âm đôi và dd', () => {
    expect(foldTelex('ddoongf khoiwr')).toBe('dong khoi');
    expect(foldTelex('saif gonf')).toBe('sai gon');
  });
  it('bỏ s f r x j cuối từ sau nguyên âm', () => {
    expect(foldTelex('ha noij')).toBe('ha noi');
    expect(foldTelex('hueex')).toBe('hue');
  });
  it('bỏ chữ số 1–9 dính cuối từ (VNI) nhưng giữ số đứng riêng', () => {
    expect(foldTelex('tan binh1')).toBe('tan binh');
    expect(foldTelex('quan 10')).toBe('quan 10');
  });
  it('không đổi chuỗi thường', () => {
    expect(foldTelex('bach hoa xanh')).toBe('bach hoa xanh');
  });
});
```

Ghi chú: `'bach hoa xanh'` chứa `h` cuối `xanh` — không phải dấu telex; và `'x'` cuối `hueex` là dấu ngã VNI/telex → bỏ. Test này khoá đúng ranh giới đó.

- [x] **Bước 2: Chạy, xác nhận đỏ**

Run: `pnpm exec vitest run packages/core/tests/telex.test.ts`
Expected: FAIL — module không tồn tại.

- [x] **Bước 3: Viết `packages/core/src/telex.ts`**

```ts
/** Mẫu telex/VNI còn sót trong chuỗi đã bỏ dấu (spec 5.6). */
const TELEX_PATTERN = /(aa|ee|oo|dd|[aeiouy][sfrxj]\b|[a-z][1-9]\b)/;

export function looksLikeTelex(normalized: string): boolean {
  return TELEX_PATTERN.test(normalized);
}

/**
 * Gập telex/VNI sót: aa→a, ee→e, oo→o, dd→d, aw→a, ow→o, uw→u; bỏ s f r x j đứng cuối từ sau
 * nguyên âm; bỏ chữ số 1–9 dính cuối từ. Chỉ áp cho TRUY VẤN, không cho dữ liệu; chỉ chạy khi
 * `looksLikeTelex` và các bậc trước rỗng; mặc định tắt (cờ AUTOCOMPLETE_TELEX).
 */
export function foldTelex(normalized: string): string {
  return normalized
    .replace(/aa/g, 'a')
    .replace(/ee/g, 'e')
    .replace(/oo/g, 'o')
    .replace(/dd/g, 'd')
    .replace(/aw/g, 'a')
    .replace(/ow/g, 'o')
    .replace(/uw/g, 'u')
    .replace(/([aeiouy])[sfrxj]\b/g, '$1')
    .replace(/([a-z])[1-9]\b/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
```

- [x] **Bước 4: Export** `export * from './telex';` trong `index.ts`; chạy test xanh; `pnpm typecheck && pnpm lint`.

- [x] **Bước 5: Commit**

```bash
git add packages/core/src/telex.ts packages/core/src/index.ts packages/core/tests/telex.test.ts
git commit -m "feat(core): foldTelex/looksLikeTelex cho bậc 3b (mặc định tắt)"
```

---

## Task 4: `searchKeys()` — một hàm quyết định cách sinh cột dẫn xuất

**Files:**
- Create: `packages/core/src/search-keys.ts`
- Create: `packages/core/tests/search-keys.test.ts`
- Modify: `packages/core/src/index.ts`

Pipeline (`records.mjs`, `streets.mjs`, `admin*.mjs`, backfill) và test đối chiếu dbtest đều gọi **đúng một hàm** này, để không có hai định nghĩa `name_key`.

- [x] **Bước 1: Test đỏ** `packages/core/tests/search-keys.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { searchKeys } from '../src/search-keys';

describe('searchKeys', () => {
  it('name_key = viKey(applyToponymAlias(name_norm)); name_alt_norm nối " | " sau normalizeVi', () => {
    // toponym: qui nhon → quy nhon; viKey: quy→qui, nhon giữ, coffee giữ (không có luật ee).
    expect(searchKeys('qui nhon coffee', ['Quy Nhon Cafe', 'Café Qui Nhơn'])).toEqual({
      nameKey: 'quinhoncoffee',
      nameAltNorm: 'quy nhon cafe | cafe qui nhon',
    });
  });
  it('không có tên thay thế → nameAltNorm null', () => {
    // 'nguyen' không đổi: y ở giữa từ không thuộc luật ([cons])y$.
    expect(searchKeys('nguyen hue', [])).toEqual({ nameKey: 'nguyenhue', nameAltNorm: null });
    expect(searchKeys('nguyen hue', null)).toEqual({ nameKey: 'nguyenhue', nameAltNorm: null });
  });
  it('tên thay thế rỗng/trùng/trùng tên chính bị bỏ, giữ thứ tự xuất hiện', () => {
    // cong → con (ng$→n); ly → li.
    expect(searchKeys('cong ly', ['', 'Nam Kỳ Khởi Nghĩa', 'nam ky khoi nghia', 'Công Lý'])).toEqual({
      nameKey: 'conli',
      nameAltNorm: 'nam ky khoi nghia',
    });
  });
  it('dấu | trong tên thay thế không phá dấu phân cách', () => {
    expect(searchKeys('a', ['b|c']).nameAltNorm).toBe('b c');
  });
});
```

Các giá trị kỳ vọng ở trên đã được tính tay theo bảng luật Task 1; nếu test đỏ ở **chữ** thì bảng luật hoặc thứ tự luật đang sai so với Task 1 — sửa code, không sửa test.

- [x] **Bước 2: Chạy, đỏ**

Run: `pnpm exec vitest run packages/core/tests/search-keys.test.ts`
Expected: FAIL — module không tồn tại.

- [x] **Bước 3: Viết `packages/core/src/search-keys.ts`**

```ts
import { normalizeVi } from './normalize';
import { applyToponymAlias } from './toponym';
import { viKey } from './vi-key';

export interface SearchKeys {
  /** `viKey(applyToponymAlias(name_norm))` — cột `name_key`/`alias_key`. */
  nameKey: string;
  /** Tên thay thế đã `normalizeVi`, nối `' | '` giữ biên từ; null khi không có. Thứ tự = `name_alt`. */
  nameAltNorm: string | null;
}

/**
 * Nguồn sự thật duy nhất cho cột dẫn xuất tìm kiếm (spec 6.1–6.3). Pipeline, backfill và test đối
 * chiếu dbtest đều gọi hàm này. `nameNorm` phải đã `normalizeVi`. `nameAlt` là mảng gốc của OSM;
 * phần tử rỗng, trùng nhau (sau chuẩn hoá) hoặc trùng tên chính bị bỏ nhưng KHÔNG đổi thứ tự —
 * `matched_alt` trong API dựa vào việc `name_alt` và `string_to_array(name_alt_norm, ' | ')` thẳng
 * hàng, nên pipeline phải ghi `name_alt` đã lọc bằng `filterNameAlt` dưới đây.
 */
export function searchKeys(nameNorm: string, nameAlt: readonly string[] | null | undefined): SearchKeys {
  const alts = filterNameAlt(nameNorm, nameAlt);
  return {
    nameKey: viKey(applyToponymAlias(nameNorm)),
    nameAltNorm: alts.length ? alts.map((a) => normalizeVi(a)).join(' | ') : null,
  };
}

/** Lọc `name_alt` theo đúng luật của `searchKeys`, để pipeline ghi mảng gốc thẳng hàng với `name_alt_norm`. */
export function filterNameAlt(nameNorm: string, nameAlt: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>([nameNorm]);
  const out: string[] = [];
  for (const raw of nameAlt ?? []) {
    const norm = normalizeVi(raw ?? '');
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(raw);
  }
  return out;
}
```

- [x] **Bước 4: Export** `export * from './search-keys';`; chạy test → xanh.

- [x] **Bước 5: `pnpm --filter @mapslibvn/core build && pnpm typecheck && pnpm lint`** — xanh.

- [x] **Bước 6: Commit**

```bash
git add packages/core/src/search-keys.ts packages/core/src/index.ts packages/core/tests/search-keys.test.ts
git commit -m "feat(core): searchKeys/filterNameAlt — một định nghĩa cho name_key và name_alt_norm"
```

---

## Task 5: Migration `0009_search_keys.sql` + `.down.sql`, schema dbtest, export ODbL

**Files:**
- Create: `db/migrations/0009_search_keys.sql`, `db/migrations/0009_search_keys.down.sql`
- Modify: `db/schema.dbtest.mjs`
- Modify: `scripts/lib/odbl.mjs`
- Modify: `db/export-odbl.dbtest.mjs`

- [x] **Bước 1: Thêm assert đỏ vào `db/schema.dbtest.mjs`** (trong `describe('lược đồ spec 5.2')`):

```js
  it('0009: cột dẫn xuất tìm kiếm và chỉ số GIN (spec 6, quyết định 1: name_tsv là cột thường)', async () => {
    const cols = async (/** @type {string} */ table) =>
      (
        await sql`SELECT column_name, is_generated FROM information_schema.columns
          WHERE table_schema='public' AND table_name=${table}`
      ).map((r) => `${r.column_name}:${r.is_generated}`);
    expect(await cols('poi')).toEqual(
      expect.arrayContaining(['name_key:NEVER', 'name_alt_norm:NEVER', 'name_tsv:NEVER']),
    );
    expect(await cols('street')).toEqual(
      expect.arrayContaining(['name_alt:NEVER', 'name_key:NEVER', 'name_alt_norm:NEVER', 'name_tsv:NEVER']),
    );
    expect(await cols('admin_area')).toEqual(expect.arrayContaining(['name_key:NEVER']));
    expect(await cols('admin_area_old')).toEqual(expect.arrayContaining(['name_key:NEVER']));
    expect(await cols('admin_alias')).toEqual(expect.arrayContaining(['alias_key:NEVER']));

    const defs = (await sql`SELECT indexdef FROM pg_indexes WHERE schemaname='public'`).map((r) => r.indexdef);
    for (const needle of [
      'poi_name_key_trgm_idx ON public.poi USING gin (name_key gin_trgm_ops)',
      'poi_name_alt_norm_trgm_idx ON public.poi USING gin (name_alt_norm gin_trgm_ops)',
      'poi_name_tsv_idx ON public.poi USING gin (name_tsv)',
      'street_name_key_trgm_idx ON public.street USING gin (name_key gin_trgm_ops)',
      'street_name_alt_norm_trgm_idx ON public.street USING gin (name_alt_norm gin_trgm_ops)',
      'street_name_tsv_idx ON public.street USING gin (name_tsv)',
      'admin_area_name_key_trgm_idx ON public.admin_area USING gin (name_key gin_trgm_ops)',
      'admin_area_old_name_key_trgm_idx ON public.admin_area_old USING gin (name_key gin_trgm_ops)',
      'admin_alias_alias_key_trgm_idx ON public.admin_alias USING gin (alias_key gin_trgm_ops)',
    ]) {
      expect(defs.some((d) => d.includes(needle)), needle).toBe(true);
    }
  });

  it('0009: name_tsv được backfill bằng SQL ngay trong migration', async () => {
    await sql`INSERT INTO street (osm_way_ids, name, name_norm, geom)
      VALUES ('{9}', 'Đường 0009 Test', 'duong 0009 test', ST_Multi(ST_GeomFromText('LINESTRING(106.7 10.77,106.71 10.77)',4326)))`;
    // Migration đã chạy TRƯỚC dòng này, nên dòng mới không có tsv — kiểm bằng cách chạy lại cùng
    // câu UPDATE backfill (idempotent) rồi xem.
    await sql`UPDATE street SET name_tsv = to_tsvector('simple', name_norm) WHERE name_tsv IS NULL`;
    const [row] = await sql`SELECT name_tsv::text AS tsv FROM street WHERE name_norm='duong 0009 test'`;
    expect(row?.tsv).toContain("'duong':1");
    await sql`DELETE FROM street WHERE name_norm='duong 0009 test'`;
  });
```

Và sửa test `--down`: chú thích `// 0002…0009: tám migration sau 0001` và vòng `for (let i = 0; i < 8; i++) migrate('--down');` (hiện là 7). Đọc kỹ điều kiện "0008 chỉ down khi dữ liệu alias còn 1–1" đã có trong test đó — 0009 down **không** có điều kiện dữ liệu.

- [x] **Bước 2: Tạo lại DB test cô lập và chạy, xác nhận đỏ**

Run:
```bash
node -e "
import('postgres').then(async ({default: postgres}) => {
  const a = postgres('postgres://mapslibvn:mapslibvn@localhost:5432/postgres',{max:1,onnotice(){}});
  await a.unsafe(\"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='mapslibvn_task8_test' AND pid<>pg_backend_pid()\");
  await a.unsafe('DROP DATABASE IF EXISTS mapslibvn_task8_test'); await a.unsafe('CREATE DATABASE mapslibvn_task8_test TEMPLATE template0'); await a.end();
});"
DATABASE_URL=postgres://mapslibvn:mapslibvn@localhost:5432/mapslibvn_task8_test pnpm exec vitest run --config vitest.db.config.ts db/schema.dbtest.mjs
```
Expected: FAIL ở hai test 0009 và test `--down` (thiếu một lần revert).

- [x] **Bước 3: Viết `db/migrations/0009_search_keys.sql`**

```sql
-- Spec 05/09 mục 6 + 8 (plan hạng mục 3). Cột dẫn xuất tìm kiếm:
--   name_key      = viKey(applyToponymAlias(name_norm))   — tính trong pipeline (hàm ở TS), NULL tới khi backfill
--   name_alt_norm = tên thay thế OSM đã normalizeVi, nối ' | '  — tính trong pipeline, NULL tới khi backfill
--   name_tsv      = to_tsvector('simple', name_norm)      — cột THƯỜNG (không generated: publishNew/publish.mjs
--                   chép SELECT * nên generated column làm INSERT thất bại); backfill ngay tại đây bằng SQL.
-- API coi NULL là "không khớp" (toán tử trên NULL trả NULL) — chứng minh bằng test:api-db, không suy diễn.

ALTER TABLE poi
  ADD COLUMN IF NOT EXISTS name_key      text,
  ADD COLUMN IF NOT EXISTS name_alt_norm text,
  ADD COLUMN IF NOT EXISTS name_tsv      tsvector;

ALTER TABLE street
  ADD COLUMN IF NOT EXISTS name_alt      text[],
  ADD COLUMN IF NOT EXISTS name_key      text,
  ADD COLUMN IF NOT EXISTS name_alt_norm text,
  ADD COLUMN IF NOT EXISTS name_tsv      tsvector;

ALTER TABLE admin_area     ADD COLUMN IF NOT EXISTS name_key text;
ALTER TABLE admin_area_old ADD COLUMN IF NOT EXISTS name_key text;
ALTER TABLE admin_alias    ADD COLUMN IF NOT EXISTS alias_key text;

-- Backfill tsvector bằng SQL (rẻ, không cần Node). Viết lại toàn bảng poi (~1,5 triệu dòng) → dead tuple
-- tạm thời cho tới autovacuum; chấp nhận ở giai đoạn nội bộ (spec 8). VACUUM không chạy được trong
-- transaction của db-migrate nên không gọi ở đây.
UPDATE poi    SET name_tsv = to_tsvector('simple', name_norm) WHERE name_tsv IS NULL;
UPDATE street SET name_tsv = to_tsvector('simple', name_norm) WHERE name_tsv IS NULL;

CREATE INDEX IF NOT EXISTS poi_name_key_trgm_idx        ON poi    USING gin (name_key gin_trgm_ops);
CREATE INDEX IF NOT EXISTS poi_name_alt_norm_trgm_idx   ON poi    USING gin (name_alt_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS poi_name_tsv_idx             ON poi    USING gin (name_tsv);
CREATE INDEX IF NOT EXISTS street_name_key_trgm_idx      ON street USING gin (name_key gin_trgm_ops);
CREATE INDEX IF NOT EXISTS street_name_alt_norm_trgm_idx ON street USING gin (name_alt_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS street_name_tsv_idx           ON street USING gin (name_tsv);
CREATE INDEX IF NOT EXISTS admin_area_name_key_trgm_idx     ON admin_area     USING gin (name_key gin_trgm_ops);
CREATE INDEX IF NOT EXISTS admin_area_old_name_key_trgm_idx ON admin_area_old USING gin (name_key gin_trgm_ops);
CREATE INDEX IF NOT EXISTS admin_alias_alias_key_trgm_idx   ON admin_alias    USING gin (alias_key gin_trgm_ops);
-- Không GRANT mới: api đã có SELECT trên các bảng này (cột mới thừa hưởng); OWNER là pipeline sẵn.
```

- [x] **Bước 4: Viết `db/migrations/0009_search_keys.down.sql`**

```sql
DROP INDEX IF EXISTS admin_alias_alias_key_trgm_idx, admin_area_old_name_key_trgm_idx, admin_area_name_key_trgm_idx,
  street_name_tsv_idx, street_name_alt_norm_trgm_idx, street_name_key_trgm_idx,
  poi_name_tsv_idx, poi_name_alt_norm_trgm_idx, poi_name_key_trgm_idx;
ALTER TABLE admin_alias    DROP COLUMN IF EXISTS alias_key;
ALTER TABLE admin_area_old DROP COLUMN IF EXISTS name_key;
ALTER TABLE admin_area     DROP COLUMN IF EXISTS name_key;
ALTER TABLE street DROP COLUMN IF EXISTS name_tsv, DROP COLUMN IF EXISTS name_alt_norm,
  DROP COLUMN IF EXISTS name_key, DROP COLUMN IF EXISTS name_alt;
ALTER TABLE poi    DROP COLUMN IF EXISTS name_tsv, DROP COLUMN IF EXISTS name_alt_norm,
  DROP COLUMN IF EXISTS name_key;
```

- [x] **Bước 5: Chạy schema dbtest, xanh**

Run: (tạo lại DB như bước 2, rồi) `DATABASE_URL=… pnpm exec vitest run --config vitest.db.config.ts db/schema.dbtest.mjs`
Expected: PASS, gồm test `--down` với 8 lần revert.

- [x] **Bước 6: Export ODbL thêm cột mới** — `scripts/lib/odbl.mjs`: `admin_area` thêm `'name_key'`; `admin_area_old` thêm `'name_key'`; `admin_alias` thêm `'alias_key'`; `street` thêm `'name_alt'`, `'name_key'`, `'name_alt_norm'`. Trong `db/export-odbl.dbtest.mjs`, sau phần đọc `admin_area.csv.gz`, thêm assert header:

```js
    const streetCsv = gunzipSync(readFileSync(join(dir, 'street.csv.gz'))).toString('utf8');
    expect(streetCsv.split('\n')[0]).toContain('name_alt_norm');
    const aliasCsv = gunzipSync(readFileSync(join(dir, 'admin_alias.csv.gz'))).toString('utf8');
    expect(aliasCsv.split('\n')[0]).toContain('alias_key');
```

Run: `DATABASE_URL=… pnpm exec vitest run --config vitest.db.config.ts db/export-odbl.dbtest.mjs` — Expected: PASS.

- [x] **Bước 7: `pnpm typecheck && pnpm lint`** — xanh (`scripts/lib/odbl.mjs` bị checkJs).

- [x] **Bước 8: Commit**

```bash
git add db/migrations/0009_search_keys.sql db/migrations/0009_search_keys.down.sql db/schema.dbtest.mjs scripts/lib/odbl.mjs db/export-odbl.dbtest.mjs
git commit -m "feat(db): migration 0009 — name_key, name_alt_norm, name_tsv (cột thường) và chỉ số GIN; export ODbL có cột mới"
```

---

## Task 6: Pipeline POI — `records.mjs` và `publish.mjs` điền cột mới

**Files:**
- Modify: `pipelines/poi/src/records.mjs:25-110`
- Modify: `pipelines/poi/src/publish.mjs:10-70`
- Create: `pipelines/poi/src/records.test.mjs` (nếu chưa có file test cho `buildRow`)

- [x] **Bước 1: Test đỏ cho `buildRow`** — `pipelines/poi/src/records.test.mjs`

```js
import { describe, expect, it } from 'vitest';
import { pgArray } from './lib/copy-format.mjs';
import { RECORD_COLUMNS, buildRow } from './records.mjs';

const record = {
  source: 'osm', sourceId: '1', name: 'Café Qui Nhơn', nameAlt: ['Quy Nhon Coffee', 'Café Qui Nhơn'],
  cat: { code: 'cafe', group: 'food_drink' }, confidence: 0.9, phones: [], websites: [], facebook: null,
  hours: null, address: null, updatedAt: '2026-09-07', closed: false, lon: 106.7, lat: 10.77,
};

describe('records.buildRow — cột dẫn xuất tìm kiếm (spec 6)', () => {
  it('RECORD_COLUMNS có name_key và name_alt_norm ngay sau name_alt', () => {
    const i = RECORD_COLUMNS.indexOf('name_alt');
    expect(RECORD_COLUMNS.slice(i, i + 3)).toEqual(['name_alt', 'name_key', 'name_alt_norm']);
  });
  it('name_key/name_alt_norm khớp searchKeys của core và name_alt đã lọc thẳng hàng', () => {
    const row = buildRow(record);
    const col = (/** @type {string} */ c) => row[RECORD_COLUMNS.indexOf(c)];
    expect(col('name_norm')).toBe('cafe qui nhon');
    // toponym: cafe quy nhon; viKey: cafe giữ, quy→qui, nhon giữ.
    expect(col('name_key')).toBe('cafequinhon');
    // Alt trùng tên chính bị bỏ → chỉ còn 'Quy Nhon Coffee'; name_alt và name_alt_norm cùng 1 phần tử.
    expect(col('name_alt')).toBe(pgArray(['Quy Nhon Coffee']));
    expect(col('name_alt_norm')).toBe('quy nhon coffee');
  });
  it('không có tên thay thế → name_alt null và name_alt_norm null', () => {
    const row = buildRow({ ...record, nameAlt: [] });
    expect(row[RECORD_COLUMNS.indexOf('name_alt')]).toBeNull();
    expect(row[RECORD_COLUMNS.indexOf('name_alt_norm')]).toBeNull();
  });
});
```

- [x] **Bước 2: Chạy đỏ**

Run: `pnpm exec vitest run pipelines/poi/src/records.test.mjs`
Expected: FAIL — `RECORD_COLUMNS` chưa có `name_key`.

- [x] **Bước 3: Sửa `records.mjs`** — import và cột:

```js
import { filterNameAlt, nameCore, normalizeVi, parseAddress, searchKeys } from '@mapslibvn/core';
```

Trong `RECORD_COLUMNS`, sau `'name_alt'` thêm `'name_key'`, `'name_alt_norm'`. Trong `buildRow`, trước `return [...]`:

```js
  const nameNorm = normalizeVi(r.name);
  const nameAlt = filterNameAlt(nameNorm, r.nameAlt);
  const keys = searchKeys(nameNorm, nameAlt);
```

và thay ba phần tử tương ứng của mảng trả về:

```js
    r.name,
    nameNorm,
    nameCore(r.name),
    nameAlt.length ? pgArray(nameAlt) : null,
    keys.nameKey,
    keys.nameAltNorm,
```

Trong `CREATE TABLE poi_work_record` (dòng ~250) thêm `name_key text NOT NULL, name_alt_norm text,` sau `name_alt text[],`.

- [x] **Bước 4: Sửa `publish.mjs`** — câu INSERT `poi_new`: thêm `name_key, name_alt_norm, name_tsv` vào danh sách cột (sau `name_alt`) và `r.name_key, r.name_alt_norm, to_tsvector('simple', r.name_norm)` vào SELECT. Câu UPDATE gộp: thêm

```sql
        name_key      = CASE WHEN 'name_norm' = ANY(p.locked_fields) THEN p.name_key ELSE n.name_key END,
        name_alt_norm = n.name_alt_norm,
        name_tsv      = CASE WHEN 'name_norm' = ANY(p.locked_fields) THEN p.name_tsv ELSE n.name_tsv END,
```

và thêm `p.name_key, p.name_alt_norm` / `n.name_key, n.name_alt_norm` vào hai tuple `IS DISTINCT FROM` (không đưa `name_tsv` vào tuple — nó suy từ `name_norm`). Câu `INSERT INTO poi SELECT n.* FROM poi_new n` giữ nguyên: `poi_new` được tạo `LIKE poi INCLUDING ALL` nên có đủ cột mới và cùng thứ tự.

- [x] **Bước 5: Chạy test đơn vị xanh + kiểm cả pipeline fixture** (dbtest có `tippecanoe` chỉ trong container — ở máy dev chạy `conflate.dbtest.mjs` và `ingest.dbtest.mjs` là đủ; CI `dbtest.yml` chạy đủ):

Run: `pnpm exec vitest run pipelines/poi/src/records.test.mjs` → PASS.
Run: `DATABASE_URL=… pnpm exec vitest run --config vitest.db.config.ts pipelines/poi/tests/conflate.dbtest.mjs` → PASS (dùng `poi_work_record` có cột mới).

- [x] **Bước 6: `pnpm typecheck && pnpm lint`**, rồi commit

```bash
git add pipelines/poi/src/records.mjs pipelines/poi/src/records.test.mjs pipelines/poi/src/publish.mjs
git commit -m "feat(pipeline): poi có name_key/name_alt_norm từ searchKeys core, name_tsv tính trong publish"
```

---

## Task 7: Pipeline đường — tên thay thế OSM và cột dẫn xuất cho `street`

**Files:**
- Create: `pipelines/poi/src/lib/search-keys.mjs`, `pipelines/poi/src/lib/search-keys.test.mjs`
- Modify: `pipelines/poi/src/geocode/raw-tables.mjs:110-132`
- Modify: `pipelines/poi/src/geocode/osm-roads.mjs:100-120`
- Modify: `pipelines/poi/src/geocode/streets.mjs`
- Modify: `pipelines/poi/tests/geocode.dbtest.mjs`

- [x] **Bước 1: Test đỏ cho helper điền cột theo lô** — `pipelines/poi/src/lib/search-keys.test.mjs` (test thuần, `sql` giả ghi lại lệnh):

```js
import { describe, expect, it } from 'vitest';
import { pgArray } from './copy-format.mjs';
import { planFill } from './search-keys.mjs';

describe('planFill — chuẩn bị dữ liệu điền name_key/name_alt_norm', () => {
  it('khoá theo id: mỗi dòng → [id, name_key, name_alt_norm, name_alt đã lọc]', () => {
    const rows = planFill(
      [{ id: 7, name_norm: 'qui nhon', name_alt: ['Quy Nhon City', 'Qui Nhon'] }],
      { joinColumns: ['id'], nameNormColumn: 'name_norm', altColumn: 'name_alt' },
    );
    // 'Qui Nhon' trùng name_norm sau normalizeVi → bị lọc; mảng gốc còn 1 phần tử, thẳng hàng với norm.
    expect(rows).toEqual([[7, 'quinhon', 'quy nhon city', pgArray(['Quy Nhon City'])]]);
  });
  it('khoá theo alias_norm (admin_alias): trùng alias_norm chỉ tính một lần, không có alt', () => {
    const rows = planFill(
      [{ alias_norm: 'quan 10' }, { alias_norm: 'quan 10' }, { alias_norm: 'phuong 6' }],
      { joinColumns: ['alias_norm'], nameNormColumn: 'alias_norm', altColumn: null },
    );
    expect(rows.map((r) => r[0])).toEqual(['quan 10', 'phuong 6']);
    expect(rows[0]?.slice(2)).toEqual([null, null]);
  });
});
```

- [x] **Bước 2: Chạy đỏ** — `pnpm exec vitest run pipelines/poi/src/lib/search-keys.test.mjs` → FAIL module không có.

- [x] **Bước 3: Viết `pipelines/poi/src/lib/search-keys.mjs`**

```js
// Điền name_key / name_alt_norm (và name_tsv) cho một bảng theo lô: đọc bằng cursor, tính bằng
// `searchKeys` của core (một định nghĩa duy nhất), ghi qua bảng tạm + UPDATE … FROM. Dùng chung cho
// streets.mjs, admin.mjs, admin-overlay.mjs và scripts/backfill-search-keys.mjs.
import { filterNameAlt, searchKeys } from '@mapslibvn/core';
import { pgArray } from './copy-format.mjs';
import { copyInto } from '../pg.mjs';

/**
 * @typedef {{ joinColumns: string[], nameNormColumn: string, altColumn: string | null }} FillOptions
 */

/**
 * Thuần, để test không cần DB: từ các dòng đã đọc → [join…, name_key, name_alt_norm, name_alt_đã_lọc].
 * Phần tử cuối là `pgArray(filterNameAlt(...))` hoặc null — pipeline ghi lại cột `name_alt` bằng
 * mảng đã lọc để nó thẳng hàng với `name_alt_norm` (API dựa vào điều này cho `matched_alt`).
 * Với joinColumns không phải id (vd alias_norm) thì khử trùng theo khoá join.
 * @param {Record<string, any>[]} rows @param {FillOptions} options
 */
export function planFill(rows, { joinColumns, nameNormColumn, altColumn }) {
  const seen = new Set();
  /** @type {unknown[][]} */
  const out = [];
  for (const row of rows) {
    const key = joinColumns.map((c) => String(row[c])).join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    const nameNorm = String(row[nameNormColumn]);
    const rawAlt = altColumn ? row[altColumn] : null;
    const keys = searchKeys(nameNorm, rawAlt);
    const filtered = altColumn ? filterNameAlt(nameNorm, rawAlt) : [];
    out.push([
      ...joinColumns.map((c) => row[c]),
      keys.nameKey,
      keys.nameAltNorm,
      filtered.length ? pgArray(filtered) : null,
    ]);
  }
  return out;
}

/**
 * @param {import('postgres').Sql} sql
 * @param {string} table bảng đích (vd 'street_new', 'poi', 'admin_alias_new')
 * @param {FillOptions & { keyColumn?: string, altNormColumn?: string | null, tsvColumn?: string | null,
 *   rewriteAlt?: boolean, onlyNull?: boolean, batch?: number }} options
 * @returns {Promise<{ updated: number }>}
 */
export async function fillSearchKeys(sql, table, options) {
  const {
    joinColumns, nameNormColumn, altColumn,
    keyColumn = 'name_key', altNormColumn = 'name_alt_norm', tsvColumn = 'name_tsv',
    rewriteAlt = Boolean(altColumn), onlyNull = false, batch = 5000,
  } = options;
  const ident = /^[a-z_][a-z0-9_]*$/;
  if (![table, keyColumn, nameNormColumn, ...joinColumns].every((s) => ident.test(s)))
    throw new Error('tên bảng/cột không hợp lệ');
  const tmp = `${table}_keys_tmp`;
  // Cột join trong bảng tạm là text; so bằng `t.col::text = s.col` để dùng chung cho id bigint và alias_norm text.
  const joinDefs = joinColumns.map((c) => `${c} text`).join(', ');
  await sql.unsafe(`DROP TABLE IF EXISTS ${tmp};
    CREATE TEMP TABLE ${tmp} (${joinDefs}, k text NOT NULL, an text, af text[])`);
  const selectCols = [...joinColumns, nameNormColumn, ...(altColumn ? [altColumn] : [])].join(', ');
  const where = onlyNull ? `WHERE ${keyColumn} IS NULL` : '';
  const cursor = sql.unsafe(`SELECT ${selectCols} FROM ${table} ${where}`).cursor(batch);
  for await (const rows of cursor) {
    const planned = planFill(rows, { joinColumns, nameNormColumn, altColumn });
    if (planned.length) await copyInto(sql, tmp, [...joinColumns, 'k', 'an', 'af'], planned);
  }
  const on = joinColumns.map((c) => `t.${c}::text = s.${c}`).join(' AND ');
  const setAlt = altNormColumn ? `, ${altNormColumn} = s.an` : '';
  const setAltArr = rewriteAlt && altColumn ? `, ${altColumn} = coalesce(s.af, '{}')` : '';
  const setTsv = tsvColumn ? `, ${tsvColumn} = to_tsvector('simple', t.${nameNormColumn})` : '';
  const result = await sql.unsafe(
    `UPDATE ${table} t SET ${keyColumn} = s.k${setAlt}${setAltArr}${setTsv} FROM ${tmp} s WHERE ${on}`,
  );
  await sql.unsafe(`DROP TABLE IF EXISTS ${tmp}`);
  return { updated: result.count };
}
```

Import đầu file: `import { filterNameAlt, searchKeys } from '@mapslibvn/core'; import { pgArray } from './copy-format.mjs'; import { copyInto } from '../pg.mjs';`. `copyInto` nhận chuỗi `pgArray(...)` cho cột `text[]` như `records.mjs` đang làm.

- [x] **Bước 4: Chạy test thuần xanh** — `pnpm exec vitest run pipelines/poi/src/lib/search-keys.test.mjs`.

- [x] **Bước 5: `raw-tables.mjs`** — `CREATE TABLE osm_road_raw_new` thêm `name_alt text[],` sau `name_norm text NOT NULL,`; `copyInto` thêm `'name_alt'` sau `'name_norm'`.

- [x] **Bước 6: `osm-roads.mjs` `roadRows()`** — trước `yield`, gom tên thay thế:

```js
    const alt = ['old_name', 'alt_name', 'short_name', 'name:vi', 'official_name']
      .map((k) => properties[k])
      .filter((v) => typeof v === 'string' && v.trim() && v !== properties.name)
      .flatMap((v) => v.split(';').map((s) => s.trim()).filter(Boolean));
```

và trong mảng `yield`, sau `streetNameNorm(properties.name)` thêm `alt.length ? pgArray(alt) : null`, với `import { pgArray } from '../lib/copy-format.mjs';` (cùng helper `records.mjs` đang dùng).

- [x] **Bước 7: `streets.mjs`** — sau câu `UPDATE street_new … ward_norm`, thêm:

```js
  // Tên thay thế: hợp mảng của các way cùng tuyến, bỏ trùng và bỏ tên chính (spec 6.3).
  await sql.unsafe(`UPDATE street_new s SET name_alt = COALESCE((
      SELECT array_agg(DISTINCT alt ORDER BY alt)
      FROM osm_road_raw r, unnest(r.name_alt) alt
      WHERE r.osm_way_id = ANY(s.osm_way_ids) AND alt <> s.name
    ), '{}')`);
  const filled = await fillSearchKeys(sql, 'street_new', {
    joinColumns: ['id'], nameNormColumn: 'name_norm', altColumn: 'name_alt',
  });
  console.log(`✓ street_new name_key/name_alt_norm/name_tsv: ${filled.updated} dòng`);
```

với `import { fillSearchKeys } from '../lib/search-keys.mjs';`. Vì `altColumn` có mặt, `rewriteAlt` mặc định bật: `name_alt` được ghi lại bằng mảng **đã lọc** (bỏ trùng tên chính, bỏ trùng nhau) để thẳng hàng với `name_alt_norm` — đúng hợp đồng `matched_alt` của API.

- [x] **Bước 8: dbtest** — trong `pipelines/poi/tests/geocode.dbtest.mjs`, sau khi pipeline fixture đã chạy `streets.mjs`, thêm:

```js
  it('street có name_key khớp searchKeys tính lại bằng Node và name_alt thẳng hàng name_alt_norm', async () => {
    const { searchKeys } = await import('@mapslibvn/core');
    const rows = await sql`SELECT name_norm, name_alt, name_key, name_alt_norm, name_tsv FROM street ORDER BY random() LIMIT 200`;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const k = searchKeys(r.name_norm, r.name_alt);
      expect(r.name_key).toBe(k.nameKey);
      expect(r.name_alt_norm).toBe(k.nameAltNorm);
      expect(r.name_tsv).not.toBeNull();
      if (r.name_alt_norm) expect(r.name_alt_norm.split(' | ')).toHaveLength(r.name_alt.length);
    }
  });
```

Chạy trong container CI (`dbtest.yml`) vì cần `osmium`; ở máy dev xác nhận ít nhất file biên dịch: `pnpm typecheck`.

- [x] **Bước 9: `pnpm typecheck && pnpm lint`**, commit

```bash
git add pipelines/poi/src/lib/search-keys.mjs pipelines/poi/src/lib/search-keys.test.mjs pipelines/poi/src/geocode/raw-tables.mjs pipelines/poi/src/geocode/osm-roads.mjs pipelines/poi/src/geocode/streets.mjs pipelines/poi/tests/geocode.dbtest.mjs
git commit -m "feat(pipeline): street.name_alt từ tag OSM, fillSearchKeys điền name_key/name_alt_norm/name_tsv theo lô"
```

---

## Task 8: Pipeline hành chính — `name_key` cho `admin_area`/`admin_area_old`, `alias_key` cho `admin_alias`

**Files:**
- Modify: `pipelines/poi/src/geocode/admin.mjs` (`buildCurrentAdmin`, cuối hàm)
- Modify: `pipelines/poi/src/geocode/admin-overlay.mjs` (sau khi dựng `admin_area_old_new` và sau `copyInto admin_alias_new`)
- Modify: `pipelines/poi/tests/admin-old.dbtest.mjs`

- [x] **Bước 1: Test đỏ** trong `admin-old.dbtest.mjs` (thêm vào `describe('overlay ranh giới hành chính cũ')`):

```js
  it('admin_area_old_new.name_key và admin_alias_new.alias_key khớp searchKeys của core', async () => {
    await buildOldAdmin(sql, { currentTable: 'admin_area', fixture: true });
    const { searchKeys } = await import('@mapslibvn/core');
    const olds = await sql`SELECT name_norm, name_key FROM admin_area_old_new`;
    expect(olds.length).toBeGreaterThan(0);
    for (const r of olds) expect(r.name_key).toBe(searchKeys(r.name_norm, null).nameKey);
    const aliases = await sql`SELECT alias_norm, alias_key FROM admin_alias_new LIMIT 50`;
    for (const r of aliases) expect(r.alias_key).toBe(searchKeys(r.alias_norm, null).nameKey);
  });
```

- [x] **Bước 2: Chạy đỏ** — tạo lại DB cô lập (bước 2 Task 5), rồi `DATABASE_URL=… pnpm exec vitest run --config vitest.db.config.ts pipelines/poi/tests/admin-old.dbtest.mjs` → FAIL (`name_key` NULL).

- [x] **Bước 3: `admin-overlay.mjs`** — import `fillSearchKeys`; ngay sau `ANALYZE admin_area_old_new` (dòng ~99) thêm:

```js
  await fillSearchKeys(sql, 'admin_area_old_new', {
    joinColumns: ['id'], nameNormColumn: 'name_norm', altColumn: null, altNormColumn: null, tsvColumn: null,
  });
```

và **sau** `copyInto(sql, 'admin_alias_new', …)` (dòng ~274) và sau vòng seed (dòng ~290, để cả seed cũng có key) — đặt một lần ngay trước phần `levelCounts`:

```js
  await fillSearchKeys(sql, 'admin_alias_new', {
    joinColumns: ['alias_norm'], nameNormColumn: 'alias_norm', altColumn: null,
    keyColumn: 'alias_key', altNormColumn: null, tsvColumn: null,
  });
```

- [x] **Bước 4: `admin.mjs` `buildCurrentAdmin`** — sau `UPDATE admin_area_new child SET parent_id … ANALYZE admin_area_new` thêm:

```js
  await fillSearchKeys(sql, 'admin_area_new', {
    joinColumns: ['id'], nameNormColumn: 'name_norm', altColumn: null, altNormColumn: null, tsvColumn: null,
  });
```

- [x] **Bước 5: Chạy dbtest xanh** — cả `admin-old.dbtest.mjs` (11 ca cũ + 1 mới) và `db/admin-old.dbtest.mjs`.

- [x] **Bước 6: `pnpm typecheck && pnpm lint`**, commit

```bash
git add pipelines/poi/src/geocode/admin.mjs pipelines/poi/src/geocode/admin-overlay.mjs pipelines/poi/tests/admin-old.dbtest.mjs
git commit -m "feat(pipeline): name_key cho admin_area/admin_area_old và alias_key cho admin_alias"
```

---

## Task 9: `scripts/backfill-search-keys.mjs` — điền cột mới cho dữ liệu đã publish

**Files:**
- Create: `scripts/backfill-search-keys.mjs`, `scripts/backfill-search-keys.test.mjs`

- [x] **Bước 1: Test đỏ** `scripts/backfill-search-keys.test.mjs` (thuần: kiểm bảng kế hoạch và chốt migration):

```js
import { describe, expect, it } from 'vitest';
import { BACKFILL_PLAN, requireMigration } from './backfill-search-keys.mjs';

describe('backfill-search-keys', () => {
  it('kế hoạch phủ đúng 5 bảng với cột khoá đúng', () => {
    expect(BACKFILL_PLAN.map((p) => `${p.table}:${p.keyColumn ?? 'name_key'}`)).toEqual([
      'poi:name_key', 'street:name_key', 'admin_area:name_key', 'admin_area_old:name_key', 'admin_alias:alias_key',
    ]);
  });
  it('từ chối chạy khi schema_migration chưa tới 0009', () => {
    expect(() => requireMigration('0008_admin_old.sql')).toThrow(/0009_search_keys/);
    expect(() => requireMigration('0009_search_keys.sql')).not.toThrow();
  });
});
```

- [x] **Bước 2: Chạy đỏ** — `pnpm exec vitest run scripts/backfill-search-keys.test.mjs`.

- [x] **Bước 3: Viết script**

```js
#!/usr/bin/env node
// Điền name_key / name_alt_norm / name_tsv (poi, street, admin_area, admin_area_old) và alias_key
// (admin_alias) cho dữ liệu ĐÃ publish — dùng một lần sau migration 0009, không chờ cron thứ Hai.
// Idempotent: mặc định chỉ điền dòng còn NULL (--all để tính lại toàn bộ). Chạy trong container
// pipeline (role pipeline, có UPDATE). Đọc DATABASE_URL qua helper repo.
//
//   node scripts/backfill-search-keys.mjs [--all] [--table poi]
import 'dotenv/config';
import { pathToFileURL } from 'node:url';

export const BACKFILL_PLAN = [
  { table: 'poi', joinColumns: ['id'], nameNormColumn: 'name_norm', altColumn: 'name_alt' },
  { table: 'street', joinColumns: ['id'], nameNormColumn: 'name_norm', altColumn: 'name_alt' },
  { table: 'admin_area', joinColumns: ['id'], nameNormColumn: 'name_norm', altColumn: null, altNormColumn: null, tsvColumn: null },
  { table: 'admin_area_old', joinColumns: ['id'], nameNormColumn: 'name_norm', altColumn: null, altNormColumn: null, tsvColumn: null },
  { table: 'admin_alias', joinColumns: ['alias_norm'], nameNormColumn: 'alias_norm', altColumn: null, keyColumn: 'alias_key', altNormColumn: null, tsvColumn: null },
];

/** @param {string | null | undefined} latest tên migration cuối trong schema_migrations */
export function requireMigration(latest) {
  if (!latest || latest < '0009_search_keys.sql') {
    throw new Error(`Cần migration 0009_search_keys.sql trước khi backfill (hiện: ${latest ?? 'không có'})`);
  }
}

async function main() {
  const { default: postgres } = await import('postgres');
  const { databaseUrlFromEnv } = await import('./lib/migrations.mjs');
  const { fillSearchKeys } = await import('../pipelines/poi/src/lib/search-keys.mjs');
  const all = process.argv.includes('--all');
  const onlyIndex = process.argv.indexOf('--table');
  const only = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : undefined;
  const sql = postgres(databaseUrlFromEnv(process.env), { max: 2, onnotice: () => {}, idle_timeout: 600 });
  try {
    const [m] = await sql`SELECT max(name) AS latest FROM schema_migrations`;
    requireMigration(m?.latest);
    for (const step of BACKFILL_PLAN) {
      if (only && step.table !== only) continue;
      const t0 = performance.now();
      const { updated } = await fillSearchKeys(sql, step.table, { ...step, onlyNull: !all, batch: 5000 });
      console.log(`✓ ${step.table}: ${updated} dòng (${Math.round(performance.now() - t0)} ms)`);
    }
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
```

- [x] **Bước 4: Test xanh; `pnpm typecheck && pnpm lint`.** Kiểm thật trên DB dev (fixture Quận 1 sau `pnpm db:fixture`, đã có migration 0009): `node scripts/backfill-search-keys.mjs` in 5 dòng `✓ … n dòng`; chạy lần hai → mọi bảng `0 dòng` (idempotent); `--all` → điền lại toàn bộ.

- [x] **Bước 5: Commit**

```bash
git add scripts/backfill-search-keys.mjs scripts/backfill-search-keys.test.mjs
git commit -m "feat(scripts): backfill-search-keys — điền cột dẫn xuất tìm kiếm cho dữ liệu đã publish, idempotent"
```

---

## Task 10: API bậc 1 — nhánh `qAlias`, `name_alt_norm`, `matched_alt`

**Files:**
- Modify: `apps/api/src/autocomplete-sql.ts` (`CandidateRow`, `CandidateQueryInput`, `poiCandidates`, `streetCandidates`)
- Modify: `apps/api/src/routes/autocomplete.ts` (tính `queryAlias`, map `matched_alt`)
- Modify: `apps/api/src/routes/search.ts:37-45`
- Modify: `apps/api/src/geocode.ts:272-320` (`stepStreet` fallback)
- Modify: `apps/api/test/autocomplete-sql.test.ts`, `apps/api/test/search.test.ts`, `apps/api/test/geocode.test.ts`

- [x] **Bước 1: Test đỏ** trong `apps/api/test/autocomplete-sql.test.ts` (theo khuôn `fakeSql` sẵn có):

```ts
  it('bậc 1 POI: có nhánh name_alt_norm và matched_alt lấy tên gốc thẳng hàng', async () => {
    const { sql, calls } = fakeSql([]);
    await poiCandidates(sql, { ...input, queryNorm: 'cong ly', queryCore: 'cong ly', queryAlias: 'cong ly', prefixPattern: 'cong ly%' });
    const q = calls[0]?.text ?? '';
    expect(q).toMatch(/<% name_alt_norm/);
    expect(q).toMatch(/unnest\(name_alt, string_to_array\(name_alt_norm, ' \| '\)\)/);
    expect(q).toMatch(/AS matched_alt/);
  });
  it('bậc 1 POI: queryAlias khác queryNorm thì thêm nhánh qAlias <% name_norm; bằng thì không', async () => {
    const a = fakeSql([]);
    await poiCandidates(a.sql, { ...input, queryNorm: 'qui nhon', queryCore: 'qui nhon', queryAlias: 'quy nhon', prefixPattern: 'qui nhon%' });
    expect(a.calls[0]?.params).toContain('quy nhon');
    const b = fakeSql([]);
    await poiCandidates(b.sql, { ...input, queryNorm: 'quy nhon', queryCore: 'quy nhon', queryAlias: 'quy nhon', prefixPattern: 'quy nhon%' });
    expect(b.calls[0]?.params.filter((p) => p === 'quy nhon').length).toBeLessThan(a.calls[0]?.params.filter((p) => p === 'quy nhon').length ?? 0);
  });
  it('bậc 1 street: cũng có name_alt_norm và matched_alt', async () => {
    const { sql, calls } = fakeSql([]);
    await streetCandidates(sql, { ...input, queryNorm: 'cong ly', queryCore: 'cong ly', queryAlias: 'cong ly', prefixPattern: 'cong ly%' });
    expect(calls[0]?.text).toMatch(/<% name_alt_norm/);
    expect(calls[0]?.text).toMatch(/AS matched_alt/);
  });
```

Mọi `input` trong file test phải thêm `queryAlias` (bằng `queryNorm` khi không có biến thể) — sửa hằng `input` dùng chung.

- [x] **Bước 2: Chạy đỏ** — `pnpm --filter @mapslibvn/api test autocomplete-sql` → FAIL (`queryAlias` không tồn tại trong kiểu / SQL không có nhánh).

- [x] **Bước 3: Sửa `autocomplete-sql.ts`**

`CandidateRow` thêm `matched_alt?: string | null; stage?: 1 | 2 | 3;`. `CandidateQueryInput` thêm **cả ba** trường (Task 11 mới dùng hai trường sau, nhưng thêm ngay để `input` trong test không phải sửa hai lần):

```ts
  /** `applyToponymAlias(queryNorm)`; bằng `queryNorm` khi không có biến thể. Bậc 1 thêm nhánh khi khác. */
  queryAlias: string;
  /** `tsQueryFor(queryNorm)` — null khi < 2 token; bậc 2 (Task 11). */
  tsQuery: string | null;
  /** `viKey(queryAlias)` — bậc 3 (Task 11). */
  queryKey: string;
```

Hằng `input` dùng chung trong `apps/api/test/autocomplete-sql.test.ts` và `area-candidates.test.ts` thêm `queryAlias: <bằng queryNorm>, tsQuery: null, queryKey: ''`.

Trong `poiCandidates`:

```ts
  const { queryNorm, queryCore, queryAlias, prefixPattern, near, sources } = input;
  const aliasBranch = queryAlias === queryNorm ? sql`` : sql`OR ${queryAlias} <% name_norm`;
  // Tên thay thế OSM (spec 6.3): khớp name_alt_norm và trả tên GỐC đã khớp nhờ hai mảng thẳng hàng.
  const matchedAlt = sql`(SELECT a.orig FROM unnest(name_alt, string_to_array(name_alt_norm, ' | ')) AS a(orig, norm)
      WHERE ${queryNorm} <% a.norm ORDER BY word_similarity(${queryNorm}, a.norm) DESC LIMIT 1)`;
```

`sim` thêm `word_similarity(${queryNorm}, coalesce(name_alt_norm, ''))` vào `greatest(...)`; SELECT thêm `${matchedAlt} AS matched_alt`; WHERE thêm `${aliasBranch} OR ${queryNorm} <% name_alt_norm`. Với `word_similarity(q, NULL)` → NULL → `greatest` bỏ qua NULL: đúng. `${queryNorm} <% name_alt_norm` với NULL → NULL → không khớp: đúng (NULL-safe theo thiết kế; Task 13 chứng minh bằng DB thật).

`streetCandidates`: tương tự (`street` giờ có `name_alt`, `name_alt_norm`).

- [x] **Bước 4: Route** `routes/autocomplete.ts` — import `applyToponymAlias`, tính `const queryAlias = applyToponymAlias(queryNorm);`, truyền vào `collectCandidates`; khi map item thêm `...(row.matched_alt ? { matched_alt: row.matched_alt } : {})`. Cache key: thêm `qa=${encodeURIComponent(queryAlias)}` **chỉ khi khác** `queryNorm`? — không cần: `queryAlias` là hàm thuần của `queryNorm`, cache theo `queryNorm` đã đủ. Nhưng đổi **phiên bản** cache `v=src1` → `v=src2` vì hình dạng item thêm trường và kết quả có thể đổi.

- [x] **Bước 5: `search.ts`** — thêm `const queryAlias = applyToponymAlias(queryNorm);` và trong WHERE: `${queryAlias !== queryNorm ? sql\`OR ${queryAlias} <% p.name_norm\` : sql\`\`} OR ${queryNorm} <% p.name_alt_norm`. Test `search.test.ts` thêm một ca chuỗi SQL chứa `name_alt_norm`.

- [x] **Bước 6: `geocode.ts` `stepStreet`** fallback không exact: thêm `OR ${parsed.streetNorm} <% name_alt_norm` trong ngoặc của nhánh fuzzy; `geocode.test.ts` thêm ca chuỗi SQL. `matched.former`/`display_name` không đổi.

- [x] **Bước 7: Chạy** `pnpm --filter @mapslibvn/api test` → xanh 100%; `pnpm typecheck && pnpm lint`.

- [x] **Bước 8: Commit**

```bash
git add apps/api/src/autocomplete-sql.ts apps/api/src/routes/autocomplete.ts apps/api/src/routes/search.ts apps/api/src/geocode.ts apps/api/test/autocomplete-sql.test.ts apps/api/test/search.test.ts apps/api/test/geocode.test.ts
git commit -m "feat(api): bậc 1 thêm nhánh biến thể địa danh và tên thay thế OSM, trả matched_alt"
```

---

## Task 11: API bậc 2 (tsvector) và bậc 3 (`name_key`) — bộ lập bậc thuần

**Files:**
- Create: `apps/api/src/stages.ts`, `apps/api/test/stages.test.ts`
- Modify: `apps/api/src/autocomplete-sql.ts` (`collectCandidates` theo bậc, hàm SQL bậc 2/3)
- Modify: `apps/api/src/area-candidates.ts` (nhánh `alias_key`/`name_key` trong bậc fuzzy)
- Modify: `apps/api/src/ranking.ts` (`STAGE_PENALTY`), `apps/api/test/ranking.test.ts`
- Modify: `apps/api/src/routes/autocomplete.ts` (`queryKey`, `stage`), `apps/api/src/analytics.ts`, `apps/api/src/env.ts`

- [x] **Bước 1: Test đỏ** `apps/api/test/stages.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { planStages, tsQueryFor } from '../src/stages';

describe('tsQueryFor', () => {
  it('mọi token là tiền tố, AND, bỏ token < 2 ký tự, giữ token toàn số', () => {
    expect(tsQueryFor('ng hue highl')).toBe('ng:* & hue:* & highl:*');
    expect(tsQueryFor('a quan 10')).toBe('quan:* & 10:*');
  });
  it('tách trên / và - để không lọt ký tự tsquery', () => {
    expect(tsQueryFor('88/9 nguyen-lam')).toBe('88:* & nguyen:* & lam:*');
  });
  it('không đủ 2 token hợp lệ → null (bậc 2 không chạy)', () => {
    expect(tsQueryFor('highlands')).toBeNull();
    expect(tsQueryFor('a b')).toBeNull();
  });
});

describe('planStages', () => {
  it('chỉ bậc 1 khi đã đủ limit', () => {
    expect(planStages({ have: 10, limit: 10, tsQuery: 'a:* & b:*', queryKey: 'ab' })).toEqual([]);
  });
  it('thiếu và có ≥2 token → bậc 2 rồi bậc 3; thiếu mà 1 token → chỉ bậc 3', () => {
    expect(planStages({ have: 3, limit: 10, tsQuery: 'a:* & b:*', queryKey: 'ab' })).toEqual([2, 3]);
    expect(planStages({ have: 3, limit: 10, tsQuery: null, queryKey: 'highlands' })).toEqual([3]);
  });
  it('queryKey rỗng thì không có bậc 3', () => {
    expect(planStages({ have: 0, limit: 10, tsQuery: null, queryKey: '' })).toEqual([]);
  });
});
```

Và trong `apps/api/test/autocomplete-sql.test.ts`:

```ts
  it('collectCandidates: bậc 1 đủ limit thì KHÔNG gọi SQL bậc 2/3', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ type: 'poi', id: String(i), name: `p${i}`, sim: 0.9, prefix: false, pop: 0, d: null, lat: 0, lng: 0, secondary: null, precision: null }));
    const { sql, calls } = fakeSql(rows);
    await collectCandidates(sql, { ...input, tsQuery: 'a:* & b:*', queryKey: 'ab' }, new Set(['poi']), 10);
    expect(calls.filter((c) => c.text.includes('name_tsv @@'))).toHaveLength(0);
    expect(calls.filter((c) => c.text.includes('<% name_key'))).toHaveLength(0);
  });
  it('collectCandidates: thiếu → chạy bậc 2 (tsvector) rồi bậc 3 (name_key), gắn stage và dedup theo id', async () => {
    let n = 0;
    const { sql, calls } = fakeSql(() => (n++ === 0 ? [{ type: 'poi', id: '1', name: 'a', sim: 0.9, prefix: false, pop: 0, d: null, lat: 0, lng: 0, secondary: null, precision: null }] : [{ type: 'poi', id: '1', name: 'a', sim: 0.5, prefix: false, pop: 0, d: null, lat: 0, lng: 0, secondary: null, precision: null }, { type: 'poi', id: '2', name: 'b', sim: 0.5, prefix: false, pop: 0, d: null, lat: 0, lng: 0, secondary: null, precision: null }]));
    const rows = await collectCandidates(sql, { ...input, tsQuery: 'a:* & b:*', queryKey: 'ab' }, new Set(['poi']), 10);
    expect(calls.some((c) => c.text.includes("to_tsquery('simple'"))).toBe(true);
    expect(calls.some((c) => c.text.includes('<% name_key'))).toBe(true);
    expect(rows.map((r) => `${r.id}:${r.stage}`)).toEqual(['1:1', '2:2']); // id 1 giữ của bậc 1, không lặp
  });
```

`ranking.test.ts` thêm: `rankScore({...base, stage: 3})` nhỏ hơn `rankScore({...base, stage: 1})` đúng `2 * STAGE_PENALTY`; và `stage` mặc định 1 không đổi điểm cũ.

- [x] **Bước 2: Chạy đỏ** — `pnpm --filter @mapslibvn/api test stages autocomplete-sql ranking`.

- [x] **Bước 3: Viết `apps/api/src/stages.ts`**

```ts
/** Bộ lập bậc truy vấn (spec 5.4–5.5): thuần TS, test không cần DB. */

/** `to_tsquery('simple', …)` từ chuỗi đã normalizeVi: mọi token là tiền tố, AND, không kể thứ tự. */
export function tsQueryFor(queryNorm: string): string | null {
  const tokens = queryNorm
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 || /^\d+$/.test(t))
    .filter(Boolean);
  if (tokens.length < 2) return null;
  return tokens.map((t) => `${t}:*`).join(' & ');
}

export type Stage = 2 | 3;

/** Bậc nào còn phải chạy sau bậc 1. Không chạy gì khi đã đủ `limit`. */
export function planStages(input: { have: number; limit: number; tsQuery: string | null; queryKey: string }): Stage[] {
  if (input.have >= input.limit) return [];
  const stages: Stage[] = [];
  if (input.tsQuery) stages.push(2);
  if (input.queryKey) stages.push(3);
  return stages;
}
```

- [x] **Bước 4: `autocomplete-sql.ts`** — `CandidateQueryInput` thêm `tsQuery: string | null; queryKey: string;`. Hai hàm bậc 2 cho poi/street:

```ts
/** Bậc 2 (spec 5.4): mọi token khớp tiền tố, không kể thứ tự; sim cùng thang bậc 1 (word_similarity). */
export function poiTokenCandidates(sql: Sql, input: CandidateQueryInput) {
  const { queryNorm, tsQuery, near, sources } = input;
  return sql<CandidateRow[]>`
    SELECT 'poi' AS type, id, name, concat_ws(', ', street, ward, province) AS secondary,
      ST_Y(geom) AS lat, ST_X(geom) AS lng, NULL AS precision,
      word_similarity(${queryNorm}, name_norm) AS sim, false AS prefix,
      coalesce(popularity, 0) AS pop, ${distance(sql, near, 'geom')} AS d, NULL AS matched_alt
    FROM poi p
    WHERE status = 'active' AND ${poiSourceFilter(sql, sources)}
      AND name_tsv @@ to_tsquery('simple', ${tsQuery})
    ORDER BY sim DESC, pop DESC LIMIT 20`;
}
export function streetTokenCandidates(sql: Sql, input: CandidateQueryInput) {
  const { queryNorm, tsQuery, near } = input;
  return sql<CandidateRow[]>`
    SELECT 'street' AS type, NULL AS id, name, coalesce(province_norm, '') AS secondary,
      ST_Y(ST_PointOnSurface(geom)) AS lat, ST_X(ST_PointOnSurface(geom)) AS lng, NULL AS precision,
      word_similarity(${queryNorm}, name_norm) AS sim, false AS prefix, 0 AS pop,
      ${distance(sql, near, 'geom')} AS d, NULL AS matched_alt
    FROM street
    WHERE name_tsv @@ to_tsquery('simple', ${tsQuery})
    ORDER BY sim DESC LIMIT 20`;
}

/** Bậc 3 (spec 5.5/6.2): khoá ngữ âm; name_key không có khoảng trắng nên bao luôn dính/tách từ. */
export function poiKeyCandidates(sql: Sql, input: CandidateQueryInput) {
  const { queryKey, near, sources } = input;
  return sql<CandidateRow[]>`
    SELECT 'poi' AS type, id, name, concat_ws(', ', street, ward, province) AS secondary,
      ST_Y(geom) AS lat, ST_X(geom) AS lng, NULL AS precision,
      word_similarity(${queryKey}, name_key) AS sim, false AS prefix,
      coalesce(popularity, 0) AS pop, ${distance(sql, near, 'geom')} AS d, NULL AS matched_alt
    FROM poi p
    WHERE status = 'active' AND ${poiSourceFilter(sql, sources)}
      AND ${queryKey} <% name_key
    ORDER BY sim DESC, pop DESC LIMIT 20`;
}
export function streetKeyCandidates(sql: Sql, input: CandidateQueryInput) {
  const { queryKey, near } = input;
  return sql<CandidateRow[]>`
    SELECT 'street' AS type, NULL AS id, name, coalesce(province_norm, '') AS secondary,
      ST_Y(ST_PointOnSurface(geom)) AS lat, ST_X(ST_PointOnSurface(geom)) AS lng, NULL AS precision,
      word_similarity(${queryKey}, name_key) AS sim, false AS prefix, 0 AS pop,
      ${distance(sql, near, 'geom')} AS d, NULL AS matched_alt
    FROM street
    WHERE ${queryKey} <% name_key
    ORDER BY sim DESC LIMIT 20`;
}
```

`collectCandidates(sql, input, types, limit)`:

```ts
export async function collectCandidates(sql: Sql, input: CandidateQueryInput, types: Set<ItemType>, limit = 10): Promise<CandidateRow[]> {
  const stage1: Promise<CandidateRow[]>[] = [];
  if (types.has('poi')) stage1.push(poiCandidates(sql, input));
  if (types.has('street')) stage1.push(streetCandidates(sql, input));
  if (types.has('area')) stage1.push(areaCandidates(sql, input));
  const { housenumber, streetNorm } = input.parsed;
  if (types.has('address') && housenumber && streetNorm) stage1.push(addressCandidates(sql, input, housenumber, streetNorm));
  const rows: CandidateRow[] = (await Promise.all(stage1)).flat().map((r) => ({ ...r, stage: 1 as const }));
  const keyOf = (r: CandidateRow) => `${r.type}:${r.id ?? `${r.name}|${r.secondary ?? ''}`}`;
  const seen = new Set(rows.map(keyOf));
  for (const stage of planStages({ have: rows.length, limit, tsQuery: input.tsQuery, queryKey: input.queryKey })) {
    const runners: Promise<CandidateRow[]>[] = [];
    if (types.has('poi')) runners.push(stage === 2 ? poiTokenCandidates(sql, input) : poiKeyCandidates(sql, input));
    if (types.has('street')) runners.push(stage === 2 ? streetTokenCandidates(sql, input) : streetKeyCandidates(sql, input));
    for (const r of (await Promise.all(runners)).flat()) {
      const k = keyOf(r);
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push({ ...r, stage });
    }
    if (rows.length >= limit) break;
  }
  return rows;
}
```

`area-candidates.ts`: trong nhánh `fuzzy=true`, `currentMatch` thêm `OR ${input.queryKey} <% a.name_key`, `aliasMatch` thêm `OR ${input.queryKey} <% aa.alias_key` (chỉ khi `queryKey` không rỗng). Test `area-candidates.test.ts` thêm một ca chuỗi.

- [x] **Bước 5: `ranking.ts`** — `export const STAGE_PENALTY = 0.05;`; `rankScore` nhận `stage?: 1 | 2 | 3` và trả `… - STAGE_PENALTY * ((input.stage ?? 1) - 1)`.

- [x] **Bước 6: Route + analytics** — `routes/autocomplete.ts`: `const queryKey = viKey(queryAlias); const tsQuery = tsQueryFor(queryNorm);` truyền vào input, gọi `collectCandidates(sql, input, types, limit)`, truyền `stage: row.stage` vào `rankScore`, và đặt `c.set('stageHit', rows.length ? Math.max(...rows.map((r) => r.stage ?? 1)) : 0)` (0 = rỗng, theo spec 5.7). `env.ts` `Variables` thêm `stageHit?: number`. `analytics.ts` `doubles: [c.res.status, Date.now() - t0, c.get('stageHit') ?? -1]`. Test `analytics.test.ts` (nếu có) cập nhật độ dài `doubles`.

- [x] **Bước 7: Chạy** `pnpm --filter @mapslibvn/api test` xanh; `pnpm typecheck && pnpm lint`.

- [x] **Bước 8: Commit**

```bash
git add apps/api/src/stages.ts apps/api/test/stages.test.ts apps/api/src/autocomplete-sql.ts apps/api/src/area-candidates.ts apps/api/src/ranking.ts apps/api/src/routes/autocomplete.ts apps/api/src/analytics.ts apps/api/src/env.ts apps/api/test/autocomplete-sql.test.ts apps/api/test/ranking.test.ts apps/api/test/area-candidates.test.ts
git commit -m "feat(api): bậc 2 tsvector và bậc 3 khoá ngữ âm chỉ chạy khi thiếu, STAGE_PENALTY, stage_hit"
```

---

## Task 12: Cờ Telex (bậc 3b) — cài, mặc định tắt

**Files:**
- Modify: `apps/api/src/stages.ts`, `apps/api/test/stages.test.ts`
- Modify: `apps/api/src/routes/autocomplete.ts`, `apps/api/src/env.ts`, `apps/api/wrangler.toml` (chú thích, không đặt giá trị)

Test route trong `apps/api` chạy với DB **đóng** và không quan sát được SQL, nên quyết định "có chạy lại bằng chuỗi đã gập không" phải là **hàm thuần** trong `stages.ts`; route chỉ gọi nó.

- [x] **Bước 1: Test đỏ** — thêm vào `apps/api/test/stages.test.ts`:

```ts
import { telexFallback } from '../src/stages';

describe('telexFallback (bậc 3b, spec 5.6)', () => {
  it('tắt cờ → luôn null, kể cả khi chuỗi rõ ràng là telex và kết quả rỗng', () => {
    expect(telexFallback({ enabled: false, have: 0, queryNorm: 'saif gonf' })).toBeNull();
  });
  it('bật cờ nhưng đã có kết quả → null (chỉ chạy khi các bậc trước rỗng)', () => {
    expect(telexFallback({ enabled: true, have: 1, queryNorm: 'saif gonf' })).toBeNull();
  });
  it('bật cờ, rỗng, khớp mẫu telex → trả chuỗi đã gập', () => {
    expect(telexFallback({ enabled: true, have: 0, queryNorm: 'saif gonf' })).toBe('sai gon');
    expect(telexFallback({ enabled: true, have: 0, queryNorm: 'ddoongf khoiwr' })).toBe('dong khoi');
  });
  it('bật cờ, rỗng, nhưng không phải telex hoặc gập xong không đổi → null', () => {
    expect(telexFallback({ enabled: true, have: 0, queryNorm: 'highlands' })).toBeNull();
  });
});
```

- [x] **Bước 2: Chạy đỏ** — `pnpm --filter @mapslibvn/api test stages` → FAIL (`telexFallback` không tồn tại).

- [x] **Bước 3: Cài `telexFallback` trong `stages.ts`**

```ts
import { foldTelex, looksLikeTelex } from '@mapslibvn/core';

/** Chuỗi đã gập telex để chạy lại toàn bộ bậc, hoặc null khi không áp dụng. */
export function telexFallback(input: { enabled: boolean; have: number; queryNorm: string }): string | null {
  if (!input.enabled || input.have > 0 || !looksLikeTelex(input.queryNorm)) return null;
  const folded = foldTelex(input.queryNorm);
  return folded !== input.queryNorm ? folded : null;
}
```

- [x] **Bước 4: Route + env** — `env.ts` `Bindings` thêm `AUTOCOMPLETE_TELEX?: string`. Trong route, sau `collectCandidates`:

```ts
      const folded = telexFallback({ enabled: c.env.AUTOCOMPLETE_TELEX === '1', have: rows.length, queryNorm });
      if (folded) {
        const alias = applyToponymAlias(folded);
        const retry = await collectCandidates(sql, {
          queryNorm: folded, queryCore: nameCore(folded) || folded, queryAlias: alias,
          prefixPattern: `${folded.replace(/[\\%_]/g, '\\$&')}%`, near, parsed, sources,
          tsQuery: tsQueryFor(folded), queryKey: viKey(alias),
        }, types, limit);
        rows.push(...retry.map((r) => ({ ...r, stage: 3 as const })));
      }
```

`wrangler.toml` thêm chú thích dưới `[vars]`: `# AUTOCOMPLETE_TELEX = "1"  # bậc 3b, spec 5.6 — bật sau khi có số liệu stage_hit`. Cache key: chuỗi telex và chuỗi gập là hai `queryNorm` khác nhau nên không đụng cache.

- [x] **Bước 5: Xanh, typecheck, lint, commit**

```bash
git add apps/api/src/stages.ts apps/api/test/stages.test.ts apps/api/src/routes/autocomplete.ts apps/api/src/env.ts apps/api/wrangler.toml
git commit -m "feat(api): bậc 3b Telex/VNI sau cờ AUTOCOMPLETE_TELEX, mặc định tắt"
```

---

## Task 13: Test DB thật — NULL-safe trước backfill, biến thể sau backfill

**Files:**
- Modify: `apps/api/test-db/setup.sql`
- Modify: `apps/api/test-db/places.itest.mjs`

Đây là task **chứng minh** hai điều spec mục 8 chỉ **khẳng định**: (a) cột mới NULL không làm 5xx và không khớp; (b) sau khi điền, biến thể/tên cũ tìm được. Bộ `pnpm test:api-db` chạy migration → `setup.sql` → wrangler local → itest; `deploy-api.yml` giờ gọi nó trước deploy.

Tại sao seed phải **tất định**: `word_similarity` của pg_trgm rất khoan dung — hầu hết truy vấn nhiều từ đã trúng ngay bậc 1 nếu chỉ chia sẻ một từ, nên không thể "đoán" một chuỗi mà chắc chắn rơi xuống bậc 2 hay 3. Để chứng minh **cơ chế** bậc 2/3 chạy đúng trên Postgres thật, seed dòng có `name_norm` vô nghĩa (bậc 1 chắc chắn không khớp) nhưng `name_tsv`/`name_key` được **đặt tay** đúng giá trị đích. Backfill trong describe "sau" chạy **không** `--all` (chỉ điền dòng NULL) nên các dòng đặt tay giữ nguyên giá trị.

- [x] **Bước 1: Thêm dữ liệu vào `setup.sql`** (marker `t3-`), chạy **sau** migration nên các cột mới tồn tại:

```sql
-- Hạng mục 3 (spec 6, 8). Ba lớp dòng:
--  (a) t3-poi-null: cột dẫn xuất NULL — mô phỏng dữ liệu chưa backfill; phải KHÔNG gây 5xx và vẫn tìm được ở bậc 1 qua qAlias.
--  (b) t3-street-alt: có name_alt, chưa backfill — itest gọi backfill rồi kiểm matched_alt.
--  (c) t3-poi-key / t3-street-tsv: name_norm vô nghĩa, name_key/name_tsv ĐẶT TAY — chứng minh cơ chế bậc 3 / bậc 2.
INSERT INTO poi (id, name, name_norm, category, geom, ward, province, status, created_by, primary_source, primary_source_id, popularity)
VALUES
  ('t3-poi-null', 'Quán Qui Nhơn Chưa Backfill', 'quan qui nhon chua backfill', 'cafe',
     ST_SetSRID(ST_MakePoint(106.700, 10.776), 4326), 'Phường Sài Gòn', 'Thành phố Hồ Chí Minh', 'active', 'pipeline', 'osm', 't3-1', 0.5),
  ('t3-poi-key', 'Hẻm Vô Nghĩa Bậc Ba', 'zqxv kkkq', 'cafe',
     ST_SetSRID(ST_MakePoint(106.701, 10.777), 4326), 'Phường Sài Gòn', 'Thành phố Hồ Chí Minh', 'active', 'pipeline', 'osm', 't3-2', 0.5)
ON CONFLICT (id) DO NOTHING;
-- viKey('chan bien') = 'canbien' (ch→c, bien giữ). Đặt tay để bậc 3 khớp khi bậc 1/2 chắc chắn rỗng.
UPDATE poi SET name_key = 'canbien' WHERE id = 't3-poi-key';

INSERT INTO street (osm_way_ids, name, name_norm, name_alt, province_norm, geom) VALUES
  ('{930001}', 'Nam Kỳ Khởi Nghĩa', 'nam ky khoi nghia', '{"Công Lý"}', 'ho chi minh',
     ST_Multi(ST_GeomFromText('LINESTRING(106.690 10.780,106.695 10.790)', 4326))),
  ('{930002}', 'Đường Vô Nghĩa Bậc Hai', 'wwqq zzxx', '{}', 'ho chi minh',
     ST_Multi(ST_GeomFromText('LINESTRING(106.680 10.780,106.685 10.790)', 4326)));
-- Bậc 2 khớp qua name_tsv đặt tay; name_norm vô nghĩa để bậc 1 rỗng.
UPDATE street SET name_tsv = to_tsvector('simple', 'khoi nghia bac hai') WHERE name_norm = 'wwqq zzxx';
```

- [x] **Bước 2: Test đỏ** trong `places.itest.mjs` (thêm `beforeAll` vào import từ `vitest`):

```js
describe('hạng mục 3 — trước backfill: cột dẫn xuất NULL không gây 5xx (spec 8)', () => {
  it('autocomplete/search 200; dòng NULL vẫn tìm được ở bậc 1 qua nhánh qAlias', async () => {
    const a = await get(`/v1/autocomplete?q=${enc('qui nhon')}&types=poi`);
    expect(a.status).toBe(200);
    expect(a.body.items.some((i) => i.id === 't3-poi-null')).toBe(true);
    const s = await get(`/v1/search?q=${enc('qui nhon')}`);
    expect(s.status).toBe(200);
    expect(s.body.items.some((i) => i.id === 't3-poi-null')).toBe(true);
  });
  it('bậc 2 + 3 chạy thật trên Postgres khi cột NULL ở phần lớn dòng: 200 và rỗng đúng nghĩa', async () => {
    const r = await get(`/v1/autocomplete?q=${enc('zzq wwx')}&types=poi,street`);
    expect(r.status).toBe(200);
    expect(r.body.items).toEqual([]);
  });
  it('bậc 3 — cơ chế: "chan bien" (bậc 1/2 rỗng) ra t3-poi-key qua name_key đặt tay', async () => {
    const r = await get(`/v1/autocomplete?q=${enc('chan bien')}&types=poi`);
    expect(r.status).toBe(200);
    expect(r.body.items.map((i) => i.id)).toContain('t3-poi-key');
  });
  it('bậc 2 — cơ chế: "hai bac nghia" (đảo thứ tự, bậc 1 rỗng) ra đường qua name_tsv đặt tay', async () => {
    const r = await get(`/v1/autocomplete?q=${enc('hai bac nghia')}&types=street`);
    expect(r.status).toBe(200);
    expect(r.body.items.some((i) => i.name === 'Đường Vô Nghĩa Bậc Hai')).toBe(true);
  });
});

describe('hạng mục 3 — sau backfill (chỉ điền dòng NULL, giữ dòng đặt tay)', () => {
  beforeAll(async () => {
    const { execFileSync } = await import('node:child_process');
    execFileSync(process.execPath, ['scripts/backfill-search-keys.mjs'], { stdio: 'inherit', env: process.env });
  });
  it('tên cũ của đường: "cong ly" trả Nam Kỳ Khởi Nghĩa với matched_alt "Công Lý"', async () => {
    const r = await get(`/v1/autocomplete?q=${enc('cong ly')}&types=street`);
    expect(r.status).toBe(200);
    const hit = r.body.items.find((i) => i.name === 'Nam Kỳ Khởi Nghĩa');
    expect(hit?.matched_alt).toBe('Công Lý');
  });
  it('geocode "Công Lý" qua tên thay thế của đường trả precision street', async () => {
    const r = await get(`/v1/geocode?q=${enc('Công Lý')}&near=10.78,106.69`);
    expect(r.status).toBe(200);
    expect(r.body.items[0]?.precision).toBe('street');
  });
  it('dòng NULL đã được điền đúng searchKeys; dòng đặt tay giữ nguyên', async () => {
    const { default: postgres } = await import('postgres');
    const { searchKeys } = await import('@mapslibvn/core');
    const sql = postgres(process.env.DATABASE_URL ?? '', { max: 1, onnotice: () => {} });
    try {
      const [n] = await sql`SELECT name_norm, name_key FROM poi WHERE id = 't3-poi-null'`;
      expect(n.name_key).toBe(searchKeys(n.name_norm, null).nameKey);
      const [k] = await sql`SELECT name_key FROM poi WHERE id = 't3-poi-key'`;
      expect(k.name_key).toBe('canbien');
    } finally {
      await sql.end();
    }
  });
});
```

`DATABASE_URL` trong env của itest là DB cô lập (`api-db-test.mjs` đặt sẵn); `backfill-search-keys.mjs` yêu cầu 0009 — `api-db-test.mjs` đã `db-migrate` trước. Test cuối nối Postgres trực tiếp giống `edits.itest.mjs`.

- [x] **Bước 3: Chạy `pnpm test:api-db` để thấy đỏ đúng nghĩa.** Thứ tự đề nghị của plan: làm Task 13 **ngay sau Task 9**, chạy thấy các ca mới đỏ (API chưa có bậc 2/3, chưa có `matched_alt`), rồi làm Task 10–12, chạy lại thấy xanh.

- [x] **Bước 4: Xanh: `pnpm test:api-db`** — mọi file itest pass, gồm 4 ca mới. **Đây là bằng chứng cho khẳng định NULL-safe của spec 8.**

- [x] **Bước 5: Commit**

```bash
git add apps/api/test-db/setup.sql apps/api/test-db/places.itest.mjs
git commit -m "test(api-db): chứng minh cột dẫn xuất NULL không làm 5xx; tên đường cũ và bậc 2/3 chạy thật trên Postgres"
```

---

## Task 14: SDK — `matched_alt` trong kiểu và web component; bump 0.4.0

**Files:**
- Modify: `packages/core/src/types.ts:53-63`
- Modify: `packages/web/src/autocomplete.ts` (+ test tương ứng)
- Modify: `packages/core/package.json`, `packages/web/package.json`, `packages/react/package.json`, `packages/react-native/package.json` (version `0.4.0`)

- [x] **Bước 1: Test đỏ** cho web component: item có `matched_alt` thì dòng phụ hiển thị `"<secondary> · tên cũ: <matched_alt>"`; không có thì y như cũ. Viết trong test hiện có của component (tìm `describe` render item).

- [x] **Bước 2: `types.ts`** — `AutocompleteItem` thêm `/** Tên thay thế (OSM alt_name/old_name) đã khớp, ví dụ "Công Lý" (spec 6.3). */ matched_alt?: string;`.

- [x] **Bước 3: Web component** — nơi dựng dòng phụ: `const secondary = item.matched_alt ? \`${item.secondary}${item.secondary ? ' · ' : ''}tên cũ: ${item.matched_alt}\` : item.secondary;`. React/RN dùng lại component/hook web hoặc chỉ truyền dữ liệu — kiểm `packages/react/src` và `packages/react-native/src` có render `secondary` riêng không; nếu có, áp cùng công thức và test.

- [x] **Bước 4: Bump** `version` bốn gói `0.3.0` → `0.4.0` (thêm API, không phá — spec 7). **Không publish npm** (PHONG chốt 07/09: phát hành sau khi cần).

- [x] **Bước 5: `pnpm exec vitest run packages && pnpm typecheck && pnpm lint && pnpm build`** xanh; commit

```bash
git add packages/core/src/types.ts packages/web/src packages/react/src packages/react-native/src packages/*/package.json
git commit -m "feat(sdk): AutocompleteItem.matched_alt và dòng phụ 'tên cũ', bump 0.4.0 (chưa publish)"
```

---

## Task 15: Tài liệu và E2E docs

**Files:**
- Modify: `apps/docs/src/content/docs/tim-kiem.md` (mục 5 `autocomplete`), `apps/docs/src/content/docs/api.md` (bảng item autocomplete)
- Modify: `pipelines/poi/README.md` (bước pipeline + cột mới + backfill)
- Modify: `apps/docs/e2e/*.spec.ts` (thêm ca "qui nhon")
- Modify: `docs/DEVLOG.md`

- [x] **Bước 1: `tim-kiem.md`** — thêm tiểu mục "Cách viết địa phương và tên cũ" dưới mục 5: ví dụ `qui nhon`, `kontum`, `bin than`, `cong ly` kèm `matched_alt`; nêu ba bậc và rằng bậc sau chỉ chạy khi thiếu. **`api.md`**: bảng trường item thêm `matched_alt` (tuỳ chọn) và một ví dụ JSON `street` có `"matched_alt": "Công Lý"`.

- [x] **Bước 2: `pipelines/poi/README.md`** — bảng "Chạy trọn vòng": ghi `streets.mjs` giờ đọc `old_name/alt_name/short_name/name:vi/official_name` và điền `name_key/name_alt_norm/name_tsv`; mục mới "Backfill cột tìm kiếm" với lệnh `node scripts/backfill-search-keys.mjs [--all] [--table …]` và điều kiện migration 0009.

- [x] **Bước 3: E2E docs playground** — theo khuôn ca "Quận 10" hiện có: gõ `qui nhon` → có item tên chứa `Quy Nhơn`. Chạy `pnpm --filter @mapslibvn/docs e2e` với API local + fixture (xem cách các ca hiện có khởi động API).

- [x] **Bước 4: DEVLOG** mục 4: một dòng cho hạng mục 3 (chưa có số production; ghi "chờ Task 16").

- [x] **Bước 5: Link check + commit**

```bash
pnpm --filter @mapslibvn/docs build
git add apps/docs/src/content/docs/tim-kiem.md apps/docs/src/content/docs/api.md pipelines/poi/README.md apps/docs/e2e docs/DEVLOG.md
git commit -m "docs: cách viết địa phương, matched_alt, backfill cột tìm kiếm; e2e qui nhon"
```

---

## Task 16: Full gate, phát hành và nghiệm thu trên production

**Files:**
- Create: `docs/evidence/search-keys/16-nghiem-thu-production.md`, `16-perf.json`
- Modify: `docs/DEVLOG.md`, plan này (tick + trạng thái)

- [x] **Bước 1: Full gate local** (theo 9.1 của plan hạng mục 1):

```bash
pnpm --filter @mapslibvn/core build && pnpm --filter @mapslibvn/style build
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm test:api-db
# dbtest: tạo lại mapslibvn_task8_test (Task 5 bước 2) rồi
DATABASE_URL=postgres://mapslibvn:mapslibvn@localhost:5432/mapslibvn_task8_test pnpm exec vitest run --config vitest.db.config.ts db/ pipelines/poi/tests/admin-old.dbtest.mjs pipelines/poi/tests/conflate.dbtest.mjs pipelines/poi/tests/ingest.dbtest.mjs
git diff --check
```
Expected: mọi bước xanh (trừ `pipeline-fixture.dbtest.mjs` — chạy trong CI).

- [x] **Bước 2: Áp migration 0009 lên production TRƯỚC khi push.** Push sẽ kích `Deploy API`; API mới tham chiếu `name_key`/`name_alt_norm`/`name_tsv` — nếu cột chưa có, Postgres ném 42703 và route trả 503 (đúng lớp sự cố 0008 ngày 07/09). Chạy trong container pipeline, trong một transaction, theo đúng cách đã làm cho 0008:

```bash
docker exec mapslibvn-server-pipeline-1 sh -c 'cd /app && node scripts/db-migrate.mjs'
curl -s https://api.ai-solutions.io.vn/healthz/db
```
Expected: `[db:migrate] Áp dụng 0009_search_keys.sql …` rồi `/healthz/db` trả `"schema_migration":"0009_search_keys.sql"`. Container phải chạy image **đã build từ HEAD có file migration** — nếu chưa, `pnpm image:build && pnpm image:smoke` và `force-recreate` trước. Thời gian: UPDATE backfill `name_tsv` trên 1,5 triệu POI cộng 9 chỉ số GIN — ước 5–10 phút; API hiện hành vẫn phục vụ (`ALTER TABLE ADD COLUMN` nhanh; `CREATE INDEX` không CONCURRENTLY giữ ShareLock chặn ghi, đọc vẫn được). Ghi `pg_database_size` trước/sau.

- [x] **Bước 3: Push và chờ workflow thật theo SHA** — `CI`, `Deploy API` (gồm job cổng `apitest`), `Deploy Docs`, `DB tests`. Ghi run URL + conclusion cho từng workflow; không suy deploy thành công từ local build.

- [x] **Bước 4: Sau khi Deploy API xanh** — kiểm production NULL-safe thật: 5 endpoint 200, `autocomplete?q=qui nhon` có kết quả (nhánh `qAlias` bậc 1), `q=cong ly&types=street` **chưa** có Nam Kỳ Khởi Nghĩa (chưa có `name_alt`).

- [x] **Bước 5: Backfill production** trong container:

```bash
docker exec mapslibvn-server-pipeline-1 sh -c 'cd /app && node scripts/backfill-search-keys.mjs'
```
Expected: 5 dòng `✓ <bảng>: n dòng`; poi ≈ 1,52 triệu; admin_alias ≈ 19.254 (số `alias_norm` phân biệt). Chạy lần hai → `0 dòng` mỗi bảng.

- [x] **Bước 6: Tên thay thế của đường** — chạy lại đúng ba bước pipeline liên quan, có chủ đích, trong container (đường chỉ phát hành ở `alleys.mjs`):

```bash
docker exec mapslibvn-server-pipeline-1 sh -c 'cd /app && node pipelines/poi/src/geocode/osm-roads.mjs && node pipelines/poi/src/geocode/streets.mjs && node pipelines/poi/src/geocode/alleys.mjs'
```
Expected: `✓ street_new name_key/name_alt_norm/name_tsv: N dòng` rồi publish street+alley. Ghi số `street` có `name_alt` khác `{}`.

- [ ] **Bước 7: Nghiệm thu tiêu chí 11.6 trên production** (bộ Task 0): **CHƯA ĐẠT — 9/20 sau hai vòng sửa (3/20 → 6/20 → 9/20), mốc 18/20. Tiêu chí 11.6 đạt 4/5.** Giữ mở theo đúng chỉ dẫn của chính bước này ("nếu trượt ca nào, giữ task mở với ca cụ thể, không chọn lại bộ mẫu"). Ca trượt và nguyên nhân từng ca: `docs/evidence/search-keys/16-nghiem-thu-production.md`. Đã đổi spec mục 5.4 (`89d7fca`) và sửa chấm điểm nhánh alias (`a76761a`). Còn lại là (1) thiếu dữ liệu tên đường cũ trong OSM và (2) câu hỏi tiêu chí: 4 ca API trả đúng địa phương nhưng tên viết theo cách người dùng gõ, fixture đòi dạng chuẩn. Không tự sửa bộ mẫu.

```bash
set -a; . ./.env; set +a
node scripts/perf-autocomplete.mjs https://api.ai-solutions.io.vn "$KEY_EXAMPLE_EMBED" --queries scripts/fixtures/local-variant-queries.txt
node scripts/perf-autocomplete.mjs https://api.ai-solutions.io.vn "$KEY_EXAMPLE_EMBED" --queries scripts/fixtures/fuzzy-queries.txt
```
Expected: bộ biến thể hit@3 **≥ 18/20** và đủ 5 ca spec 11.6 (`qui nhon`, `kontum`, `dak lak`, `tan son nhut`, `cong ly`) trong top 3; bộ fuzzy **≥ 36/40** (không hồi quy so 37/40). Nếu trượt ca nào, **giữ task mở với ca cụ thể**, không chọn lại bộ mẫu.

- [x] **Bước 8: p95 và `stage_hit`** *(p95 đã đo; phân bố `stage_hit` cần 24 giờ lưu lượng, lấy sau)* — đo xen kẽ như 8.5 (`--paired --rounds 3`) với cohort `default` mới; so p95 warm với baseline Task 0: **≤ +50 ms**. Đo "nhánh chạy hết 3 bậc" bằng 10 truy vấn cố tình rỗng ở bậc 1 (ví dụ `zzq wwx`, `bin than cofe`) → p95 **≤ 600 ms** (server-side `wallTimeMs`). Lấy phân bố `stage_hit` từ Analytics Engine (SQL API: `SELECT double3, count() FROM mapslibvn_api WHERE blob3='/v1/autocomplete' GROUP BY 1`) sau 24 giờ và ghi vào hồ sơ — đây là dữ liệu để quyết bật 3b.

- [x] **Bước 9: EXPLAIN mỗi bậc trên production** (đọc): một truy vấn bậc 1 có `name_alt_norm`, một bậc 2 (`name_tsv @@`), một bậc 3 (`<% name_key`) — xác nhận **Bitmap Index Scan** trên đúng chỉ số 0009, không Seq Scan trên `poi`.

- [x] **Bước 10: Dọn theo memory** — `pnpm image:build && pnpm image:smoke`; `cd infra/server && docker compose --env-file .env -f compose.yml up -d --force-recreate pipeline backup`; xác nhận `docker logs mapslibvn-server-pipeline-1 | tail -1` in mốc cron.

- [x] **Bước 11: Hồ sơ + DEVLOG + tick plan** — `16-nghiem-thu-production.md`: bảng trước/sau (hit@3 hai bộ, p50/p95/p99 warm/cold, `stage_hit`), số dòng backfill, kích cỡ DB trước/sau, EXPLAIN tóm tắt, run URL 5 workflow, artifact rollback (backup trước migration + `0009_search_keys.down.sql` **chỉ** dùng sau khi API đã rollback về bản trước — down xoá cột, API mới đang tham chiếu cột sẽ 503). Cập nhật spec mục 11.6 trạng thái.

- [x] **Bước 12: Commit**

```bash
git add docs/evidence/search-keys docs/DEVLOG.md docs/superpowers/plans/2026-09-07-cach-viet-dia-phuong.md docs/superpowers/specs/2026-09-05-tim-kiem-alias-fuzzy-dia-phuong-design.md
git commit -m "docs(search): nghiệm thu hạng mục 3 trên production — cách viết địa phương, tên đường cũ, bậc 2–3"
```

---

## Ma trận nghiệm thu

| Tiêu chí spec | Task | Bằng chứng bắt buộc |
|---|---|---|
| 11.6 — `qui nhon`, `kontum`, `dak lak`, `tan son nhut`, `cong ly` top-3 | 2, 7, 10, 16 | `perf-autocomplete` trên bộ `local-variant-queries.txt` production |
| 11.3 — fuzzy ≥ 36/40 không hồi quy | 11, 16 | hit@3 bộ 40 trước/sau |
| 11.4 — p95 bậc-1-đủ ≤ baseline + 50 ms; 3 bậc ≤ 600 ms | 0, 11, 16 | đo xen kẽ + `wallTimeMs` phía Worker |
| 9 — `viKey` fixture ≥ 100; "biến thể ≠ chuẩn" | 1, 2 | vitest core |
| 9 — SQL builder từng bậc là hàm thuần | 10, 11 | `fake-sql` ghi chuỗi |
| 9 — đối chiếu `name_key` 1.000 dòng | 7, 8 | dbtest (200 dòng street ngẫu nhiên + toàn bộ old/alias fixture; CI chạy fixture Q1) |
| 8 — NULL an toàn trước backfill | 13 | `pnpm test:api-db` (Postgres thật, cf build) |
| 7 — hợp đồng chỉ bổ sung | 14 | `matched_alt?` duy nhất; SDK 0.4.0 |
| 11.7 — CI xanh 4 gói, api test không Postgres, ODbL có cột mới | 5, 16 | workflow URL |

## Rủi ro riêng của plan này

| Rủi ro | Giảm thiểu |
|---|---|
| Deploy API trước migration 0009 → 42703 → 503 (đã xảy ra với 0008 ngày 07/09) | Task 16 bước 3 làm **trước** push; kiểm `/healthz/db` = 0009 trước khi tin |
| Bind mảng trong SQL mới (bậc 2/3) → `malformed array literal` chỉ trên Workers | Không có mảng nào bind trực tiếp trong Task 10–12 (tsquery là chuỗi); `test:api-db` là cổng deploy |
| `UPDATE poi` backfill `name_tsv` trong migration làm bảng phình tạm | Ghi `pg_database_size` trước/sau; autovacuum; nếu quá, tách backfill ra `backfill-search-keys.mjs --tsv` (không trong transaction) |
| Generated column vỡ `INSERT … SELECT *` | Quyết định 1: cột thường |
| `viKey` gộp quá tay lọt kết quả lạ | Chỉ bậc 3, `STAGE_PENALTY`, fixture "không được gộp", `stage_hit` đo |
| Từ điển có dòng không nguồn | Test bắt hình dạng `source`; Task 2 bước 1 bắt buộc kiểm |
| Cache autocomplete giữ hình dạng cũ | đổi `v=src1` → `v=src2` |

---

**Điểm tiếp theo sau plan này:** không tự implement. Chờ PHONG duyệt plan, rồi thực thi theo thứ tự Task 0 → 5 → 1–4 → 6–9 → 13 (đỏ) → 10–12 → 13 (xanh) → 14–15 → 16.
