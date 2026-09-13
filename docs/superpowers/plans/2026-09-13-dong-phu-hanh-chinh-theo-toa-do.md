# Dòng phụ gợi ý theo đơn vị hành chính hiện hành suy từ toạ độ — Plan thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mọi POI có phường/xã và tỉnh/thành **hiện hành (2025)** suy từ toạ độ qua `admin_area`, lưu ở hai cột riêng; dòng phụ (`secondary`) của `/v1/autocomplete` và `address.ward/province` của Places API đọc từ hai cột đó, còn địa chỉ gốc của nguồn giữ nguyên trong `address_text`.

**Architecture:** Migration `0014` thêm `poi.admin_ward`, `poi.admin_province`. Bước pipeline mới `geocode/poi-admin.mjs` chạy **sau** `geocode/admin.mjs`, UPDATE toàn bảng `poi` bằng `ST_Contains` với `admin_area` cấp 8 và cấp 4, chỉ ghi dòng có giá trị đổi. API đổi biểu thức `secondary` của ba nhánh POI và `placeColumns` sang `coalesce(admin_*, cột nguồn)`; `ward`/`province` nguồn không bị ghi đè nên rollback chỉ là trả biểu thức SQL về cũ.

**Tech Stack:** PostgreSQL 16 + PostGIS, Node ESM `.mjs` + JSDoc (pipeline), TypeScript + Hono (Worker API), Vitest (`fakeSql` cho API, `*.dbtest.mjs` trong container pipeline), Docker compose máy chủ.

**Bối cảnh (chẩn đoán 13/09/2026, production):** `secondary = concat_ws(', ', street, ward, province)`; ba cột này do `records.mjs` điền bằng `parseAddress` lên chuỗi địa chỉ **của nguồn**. POI nguồn không có địa chỉ (ví dụ "Phở Phan Đăng Lưu", fsq, `address: {}`) → dòng phụ rỗng. Foursquare ghi thành phố tiếng Anh ("Ho Chi Minh City", "HCMC") mà `provinces.json` không có alias → rơi vào ô phường, sinh "Ho Chi Minh City, Thành phố Hồ Chí Minh". Địa chỉ nguồn là hệ hành chính **cũ** (Q. Phú Nhuận, P. 3 Bình Thạnh); `admin_area` là hệ **mới 2025** (33 tỉnh + Khánh Hoà dựng bù, phường/xã từ OSM level 6 map sang 8).

**Quyết định đã chốt (PHONG duyệt 13/09/2026 "ok hướng này được"):**

- Chuẩn hoá theo toạ độ cho **tất cả** POI, không chỉ chỗ trống → một hệ hành chính duy nhất trong gợi ý.
- Hai cột **riêng** `admin_ward`, `admin_province`; **không** ghi đè `ward`/`province` nguồn; `address_text` giữ nguyên.
- API: `secondary` và `address.ward/province` dùng `coalesce(admin_x, x)`. Fallback về cột nguồn chỉ còn tác dụng với POI người dùng vừa tạo/di chuyển giữa hai lần chạy pipeline hoặc điểm nằm ngoài mọi ranh giới.
- Không thêm alias tiếng Anh vào `provinces.json`, không sửa `parseAddress`, không đổi export snapshot/tiles — ngoài phạm vi.
- Không bump SDK: kiểu `PlaceAddress`/`AutocompleteItem` không đổi.

**Hợp đồng dùng chung:**

```sql
-- db/migrations/0014_poi_admin.sql
ALTER TABLE poi ADD COLUMN IF NOT EXISTS admin_ward text, ADD COLUMN IF NOT EXISTS admin_province text;
-- API (autocomplete-sql.ts, place.ts)
concat_ws(', ', street, coalesce(admin_ward, ward), coalesce(admin_province, province)) AS secondary
coalesce(p.admin_ward, p.ward) AS ward, coalesce(p.admin_province, p.province) AS province
```

```js
// pipelines/poi/src/geocode/poi-admin.mjs
export async function fillPoiAdmin(sql) → Promise<{ updated: number, total: number, wardNull: number, provinceNull: number }>
```

---

## Task 1: Migration `0014_poi_admin`

**Files:**
- Create: `db/migrations/0014_poi_admin.sql`
- Create: `db/migrations/0014_poi_admin.down.sql`

- [ ] **Step 1: Viết migration lên**

```sql
-- Đơn vị hành chính HIỆN HÀNH (2025) suy từ toạ độ qua admin_area (plan docs/superpowers/plans/2026-09-13-dong-phu-hanh-chinh-theo-toa-do.md).
-- Khác với ward/province (parseAddress lên địa chỉ CỦA NGUỒN — hệ cũ, hay lệch ô: "Ho Chi Minh City" rơi vào ward),
-- hai cột này do pipelines/poi/src/geocode/poi-admin.mjs điền sau geocode/admin.mjs. NULL tới khi backfill;
-- API dùng coalesce(admin_x, x) nên chịu được NULL. Không ghi đè cột nguồn để rollback chỉ là đổi biểu thức SQL.
ALTER TABLE poi
  ADD COLUMN IF NOT EXISTS admin_ward     text,
  ADD COLUMN IF NOT EXISTS admin_province text;
```

- [ ] **Step 2: Viết migration xuống**

```sql
-- Revert 0014: bỏ hai cột hành chính suy từ toạ độ. API bản trước 0014 không đọc chúng.
ALTER TABLE poi DROP COLUMN IF EXISTS admin_ward, DROP COLUMN IF EXISTS admin_province;
```

- [ ] **Step 3: Kiểm cú pháp bằng typecheck/lint chung (không cần DB)**

Run: `pnpm lint`
Expected: không lỗi (Biome bỏ qua .sql; bước này chỉ đảm bảo không lỡ tay hỏng file khác).

- [ ] **Step 4: Commit**

```bash
git add db/migrations/0014_poi_admin.sql db/migrations/0014_poi_admin.down.sql
git commit -m "feat(db): 0014 thêm poi.admin_ward/admin_province suy từ toạ độ"
```

---

## Task 2: Bước pipeline `geocode/poi-admin.mjs` (TDD trên dbtest)

**Files:**
- Create: `pipelines/poi/src/geocode/poi-admin.mjs`
- Create: `pipelines/poi/tests/poi-admin.dbtest.mjs`
- Modify: `scripts/data-update.mjs:149` (sau `admin.mjs`)
- Modify: `scripts/db-fixture.mjs:29` (sau `admin.mjs`)
- Modify: `pipelines/poi/tests/pipeline-fixture.dbtest.mjs:44` (thêm stage)
- Modify: `pipelines/poi/README.md` (bảng bước, sau dòng "Hành chính")

- [ ] **Step 1: Viết dbtest thất bại**

`pipelines/poi/tests/poi-admin.dbtest.mjs`:

```js
// Chạy trên DB fixture cô lập trong container pipeline (pnpm test:db). Không cần ingest: tự dựng admin_area + poi tổng hợp.
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseUrlFromEnv } from '../../../scripts/lib/migrations.mjs';
import { fillPoiAdmin } from '../src/geocode/poi-admin.mjs';

const databaseUrl = databaseUrlFromEnv(process.env);
if (new URL(databaseUrl).pathname !== '/mapslibvn_task8_test') {
  throw new Error('poi-admin.dbtest chỉ được chạy trên database mapslibvn_task8_test');
}
const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
const IDS = ['PADM0000000000000000000001', 'PADM0000000000000000000002', 'PADM0000000000000000000003', 'PADM0000000000000000000004'];

beforeAll(async () => {
  execFileSync(process.execPath, ['scripts/db-migrate.mjs'], { stdio: 'inherit' });
  await sql`DELETE FROM poi WHERE id = ANY(${IDS})`;
  await sql`DELETE FROM admin_area WHERE name_norm IN ('tinh thu', 'phuong thu', 'phuong khac')`;
  // Tỉnh thử: ô 106–107 E, 10–11 N. Phường thử: nửa tây; Phường khác: nửa đông.
  await sql`INSERT INTO admin_area (level, name, name_norm, geom) VALUES
    (4, 'Tỉnh Thử', 'tinh thu', ST_Multi(ST_MakeEnvelope(106, 10, 107, 11, 4326))),
    (8, 'Phường Thử', 'phuong thu', ST_Multi(ST_MakeEnvelope(106, 10, 106.5, 11, 4326))),
    (8, 'Phường Khác', 'phuong khac', ST_Multi(ST_MakeEnvelope(106.5, 10, 107, 11, 4326)))`;
  await sql`INSERT INTO poi (id, name, name_norm, geom, ward, province, status, locked_fields, created_by, admin_ward, admin_province) VALUES
    (${IDS[0]}, 'Trong phường thử', 'trong phuong thu', ST_SetSRID(ST_MakePoint(106.25, 10.5), 4326), 'Ho Chi Minh City', NULL, 'active', '{}', 'pipeline', NULL, NULL),
    (${IDS[1]}, 'Trong phường khác', 'trong phuong khac', ST_SetSRID(ST_MakePoint(106.75, 10.5), 4326), NULL, NULL, 'active', '{}', 'user', 'Phường Cũ Sai', 'Tỉnh Cũ Sai'),
    (${IDS[2]}, 'Ngoài mọi ranh giới', 'ngoai moi ranh gioi', ST_SetSRID(ST_MakePoint(120, 20), 4326), 'Phường nguồn', 'Tỉnh nguồn', 'active', '{}', 'pipeline', 'Phường Cũ', 'Tỉnh Cũ'),
    (${IDS[3]}, 'Đã đúng sẵn', 'da dung san', ST_SetSRID(ST_MakePoint(106.25, 10.75), 4326), NULL, NULL, 'closed', '{}', 'pipeline', 'Phường Thử', 'Tỉnh Thử')`;
});

afterAll(async () => {
  await sql`DELETE FROM poi WHERE id = ANY(${IDS})`;
  await sql`DELETE FROM admin_area WHERE name_norm IN ('tinh thu', 'phuong thu', 'phuong khac')`;
  await sql.end({ timeout: 5 });
});

describe('fillPoiAdmin — phường/tỉnh hiện hành suy từ toạ độ', () => {
  it('điền theo ST_Contains, ghi đè giá trị cũ sai, xoá giá trị khi ra ngoài ranh giới, bỏ qua dòng đã đúng', async () => {
    const stats = await fillPoiAdmin(sql);
    const rows = await sql`SELECT id, ward, province, admin_ward, admin_province FROM poi WHERE id = ANY(${IDS}) ORDER BY id`;
    expect(rows).toEqual([
      { id: IDS[0], ward: 'Ho Chi Minh City', province: null, admin_ward: 'Phường Thử', admin_province: 'Tỉnh Thử' },
      { id: IDS[1], ward: null, province: null, admin_ward: 'Phường Khác', admin_province: 'Tỉnh Thử' },
      { id: IDS[2], ward: 'Phường nguồn', province: 'Tỉnh nguồn', admin_ward: null, admin_province: null },
      { id: IDS[3], ward: null, province: null, admin_ward: 'Phường Thử', admin_province: 'Tỉnh Thử' },
    ]);
    // Cột nguồn ward/province KHÔNG bị đụng (dòng 1 vẫn giữ "Ho Chi Minh City").
    expect(stats.updated).toBe(3); // dòng 4 đã đúng → không ghi
    expect(stats.total).toBeGreaterThanOrEqual(4);
  });

  it('chạy lần hai không ghi gì (idempotent)', async () => {
    const stats = await fillPoiAdmin(sql);
    expect(stats.updated).toBe(0);
  });
});
```

- [ ] **Step 2: Chạy để thấy thất bại**

Run (trong container pipeline, DB cô lập):
```bash
docker compose --env-file .env -f infra/dev/compose.yml --profile pipeline run --rm \
  -e DATABASE_URL=postgres://mapslibvn:mapslibvn@postgres:5432/mapslibvn_task8_test pipeline \
  pnpm exec vitest run --config vitest.db.config.ts pipelines/poi/tests/poi-admin.dbtest.mjs
```
Expected: FAIL — `Cannot find module '../src/geocode/poi-admin.mjs'`. (Nếu DB `mapslibvn_task8_test` chưa có: chạy `pnpm test:db` một lần hoặc tạo bằng `CREATE DATABASE mapslibvn_task8_test` trong container postgres dev.)

- [ ] **Step 3: Viết `poi-admin.mjs`**

```js
#!/usr/bin/env node
// Điền poi.admin_ward / admin_province = đơn vị hành chính HIỆN HÀNH chứa toạ độ (admin_area cấp 8 và 4).
// Chạy SAU geocode/admin.mjs (admin_area vừa publish) — publish.mjs chạy trước admin nên không làm ở đó.
// Quét TOÀN bảng (kể cả created_by='user', mọi status) nhưng chỉ ghi dòng có giá trị đổi → idempotent, ít bloat.
// KHÔNG đụng ward/province của nguồn (records.mjs) và không bump updated_at: đây là cột dẫn xuất.
import { pathToFileURL } from 'node:url';
import { connect } from '../pg.mjs';

/** @typedef {import('postgres').Sql} Sql */

/** @param {Sql} sql */
export async function fillPoiAdmin(sql) {
  const updated = await sql.unsafe(`
    UPDATE poi p SET admin_ward = a.ward, admin_province = a.province
    FROM (
      SELECT p2.id,
        (SELECT w.name FROM admin_area w WHERE w.level = 8 AND ST_Contains(w.geom, p2.geom) ORDER BY w.id LIMIT 1) AS ward,
        (SELECT pr.name FROM admin_area pr WHERE pr.level = 4 AND ST_Contains(pr.geom, p2.geom) ORDER BY pr.id LIMIT 1) AS province
      FROM poi p2
    ) a
    WHERE a.id = p.id AND (p.admin_ward, p.admin_province) IS DISTINCT FROM (a.ward, a.province)`);
  const [row] = await sql`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE admin_ward IS NULL)::int AS ward_null,
      count(*) FILTER (WHERE admin_province IS NULL)::int AS province_null
    FROM poi`;
  const stats = /** @type {{ total: number, ward_null: number, province_null: number }} */ (row);
  return {
    updated: updated.count,
    total: stats.total,
    wardNull: stats.ward_null,
    provinceNull: stats.province_null,
  };
}

async function main() {
  const sql = connect();
  try {
    const s = await fillPoiAdmin(sql);
    await sql.unsafe('ANALYZE poi');
    console.log(
      `✓ poi admin: ghi ${s.updated}/${s.total}; thiếu phường ${s.wardNull} (${((100 * s.wardNull) / Math.max(1, s.total)).toFixed(2)} %), thiếu tỉnh ${s.provinceNull}`,
    );
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
```

- [ ] **Step 4: Chạy dbtest → PASS**

Cùng lệnh Step 2. Expected: 2 passed.

- [ ] **Step 5: Nối vào chuỗi chạy**

`scripts/data-update.mjs` — sau dòng `run('node', ['pipelines/poi/src/geocode/admin.mjs']);` thêm:
```js
    run('node', ['pipelines/poi/src/geocode/poi-admin.mjs']);
```
`scripts/db-fixture.mjs` — sau `['pipelines/poi/src/geocode/admin.mjs', '--fixture'],` thêm:
```js
  ['pipelines/poi/src/geocode/poi-admin.mjs'],
```
`pipelines/poi/tests/pipeline-fixture.dbtest.mjs` — đổi mảng stage:
```js
  for (const stage of ['admin', 'poi-admin', 'streets', 'alleys', 'anchors']) {
```
và trong `describe` hiện có, thêm một `it`:
```js
  it('POI fixture Quận 1 có phường/tỉnh hiện hành suy từ toạ độ', async () => {
    const [row] = await sql`SELECT count(*)::int AS n, count(*) FILTER (WHERE admin_province IS NOT NULL)::int AS with_province,
        count(*) FILTER (WHERE admin_ward IS NOT NULL)::int AS with_ward
      FROM poi WHERE created_by = 'pipeline' AND status = 'active'`;
    expect(row.n).toBeGreaterThan(0);
    // Fixture Quận 1 nằm trọn trong TP.HCM và có ranh giới phường; điểm OSM geocode lệch ra biển là ngoại lệ hiếm.
    expect(row.with_province / row.n).toBeGreaterThan(0.95);
    expect(row.with_ward / row.n).toBeGreaterThan(0.9);
  });
```
`pipelines/poi/README.md` — sau dòng bảng "Hành chính" thêm:
```
| POI ↔ hành chính hiện hành | `node pipelines/poi/src/geocode/poi-admin.mjs` | `admin_area` cấp 8/4 ∋ `poi.geom` → `poi.admin_ward`, `poi.admin_province` (chỉ ghi dòng đổi; không đụng `ward`/`province` nguồn) |
```

- [ ] **Step 6: Lint + typecheck scripts**

Run: `pnpm lint && pnpm typecheck`
Expected: xanh (checkJs cho `.mjs` — chú ý cast `updated.count` và kiểu row như trên).

- [ ] **Step 7: Commit**

```bash
git add pipelines/poi/src/geocode/poi-admin.mjs pipelines/poi/tests/poi-admin.dbtest.mjs pipelines/poi/tests/pipeline-fixture.dbtest.mjs scripts/data-update.mjs scripts/db-fixture.mjs pipelines/poi/README.md
git commit -m "feat(pipeline): điền poi.admin_ward/admin_province theo toạ độ sau geocode/admin"
```

---

## Task 3: API autocomplete — `secondary` từ cột hành chính hiện hành

**Files:**
- Modify: `apps/api/src/autocomplete-sql.ts:129,220,250`
- Test: `apps/api/test/autocomplete-sql.test.ts`

- [ ] **Step 1: Test thất bại**

Thêm vào cuối `apps/api/test/autocomplete-sql.test.ts` (import thêm `poiKeyCandidates`, `poiTokenCandidates` từ `../src/autocomplete-sql`; kiểm tra tên export có sẵn ở dòng 216 và 246):

```ts
describe('autocomplete-sql — secondary dùng hành chính hiện hành suy từ toạ độ (13/09/2026)', () => {
  const SECONDARY =
    "concat_ws(', ', street, coalesce(admin_ward, ward), coalesce(admin_province, province)) AS secondary";
  it('cả ba bậc POI dùng chung một biểu thức secondary', async () => {
    for (const fn of [poiCandidates, poiTokenCandidates, poiKeyCandidates]) {
      const { sql, calls } = fakeSql([]);
      await fn(sql, { ...input, tsQuery: 'coffee & highlands', queryKey: 'kofi hailan' });
      const [query] = calls.filter((call) => call.text.startsWith('SELECT'));
      expect(query?.text).toContain(SECONDARY);
      expect(query?.text).not.toContain("concat_ws(', ', street, ward, province)");
    }
  });
});
```

- [ ] **Step 2: Chạy → FAIL**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/autocomplete-sql.test.ts`
Expected: FAIL, `expected ... to contain "concat_ws(', ', street, coalesce(admin_ward, ward)..."`.

- [ ] **Step 3: Sửa SQL**

Trong `apps/api/src/autocomplete-sql.ts`, ngay sau `type Sql = ...` thêm một fragment (cùng kiểu với `distance(sql, …)` để `fakeSql` nối phẳng được):
```ts
/**
 * Dòng phụ của POI: phường/tỉnh HIỆN HÀNH suy từ toạ độ (pipelines/poi/src/geocode/poi-admin.mjs), fallback
 * cột nguồn khi chưa backfill hoặc POI người dùng vừa tạo. Cột nguồn `ward` hay lệch ("Ho Chi Minh City" của
 * Foursquare) và theo hệ hành chính cũ — chẩn đoán 13/09/2026 trên production với truy vấn "Phan Đăng Lưu".
 */
const poiSecondary = (sql: Sql) =>
  sql`concat_ws(', ', street, coalesce(admin_ward, ward), coalesce(admin_province, province)) AS secondary`;
```
Thay cả ba chỗ `concat_ws(', ', street, ward, province) AS secondary` (dòng 129, 220, 250) bằng `${poiSecondary(sql)}`.

- [ ] **Step 4: Chạy toàn bộ test API → PASS**

Run: `pnpm --filter @mapslibvn/api test`
Expected: tất cả xanh (test cũ chỉ kiểm nhánh WHERE/ORDER, không kiểm chuỗi secondary).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/autocomplete-sql.ts apps/api/test/autocomplete-sql.test.ts
git commit -m "feat(api): secondary autocomplete dùng phường/tỉnh hiện hành suy từ toạ độ"
```

---

## Task 4: Places API — `address.ward/province` hiện hành, giữ `text` nguồn

**Files:**
- Modify: `apps/api/src/place.ts:31-36` (`placeColumns`)
- Test: `apps/api/test/place.test.ts`
- Modify: `apps/docs/src/content/docs/api.md` (mục autocomplete ~dòng 140, mục places `address`)

- [ ] **Step 1: Test thất bại cho `placeColumns`**

Thêm vào `apps/api/test/place.test.ts` (import `placeColumns` và `fakeSql` từ `./helpers/fake-sql`):

```ts
describe('placeColumns', () => {
  it('ward/province ưu tiên cột hành chính hiện hành suy từ toạ độ, fallback cột nguồn', () => {
    const { sql } = fakeSql([]);
    const text = (placeColumns(sql) as unknown as { text: string }).text;
    expect(text).toContain('coalesce(p.admin_ward, p.ward) AS ward');
    expect(text).toContain('coalesce(p.admin_province, p.province) AS province');
    expect(text).toContain('p.address_text');
  });
});
```

- [ ] **Step 2: Chạy → FAIL**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/place.test.ts`
Expected: FAIL `expected 'p.id, p.name, ...' to contain 'coalesce(p.admin_ward, p.ward) AS ward'`.

- [ ] **Step 3: Sửa `placeColumns`**

```ts
/** Cột SELECT chuẩn cho Place — luôn dùng alias `p` (poi) và `c` (category).
 *  ward/province: hành chính HIỆN HÀNH suy từ toạ độ (poi-admin.mjs), fallback cột nguồn; `address_text` giữ nguyên bản nguồn. */
export function placeColumns(sql: Sql) {
  return sql`p.id, p.name, ST_Y(p.geom) AS lat, ST_X(p.geom) AS lng,
    p.housenumber, p.street, coalesce(p.admin_ward, p.ward) AS ward, coalesce(p.admin_province, p.province) AS province, p.address_text,
    p.contact, p.hours, p.quality_score, p.status, p.updated_at,
    c.code AS cat_code, c.group_code AS cat_group, c.name_vi AS cat_vi, c.name_en AS cat_en`;
}
```
`PlaceRow` và `toPlace` không đổi (alias `ward`/`province` giữ tên cột).

- [ ] **Step 4: Chạy test API → PASS**

Run: `pnpm --filter @mapslibvn/api test`
Expected: xanh. Kiểm thêm `grep -rn "p.ward\b\|p.province\b" apps/api/src` chỉ còn trong `placeColumns`.

- [ ] **Step 5: Cập nhật docs API**

`apps/docs/src/content/docs/api.md`, ngay dưới đoạn "`near` không lọc theo bán kính…" thêm:

```md
`secondary` của kết quả `poi` là `đường, phường/xã, tỉnh/thành` theo **đơn vị hành chính hiện hành (2025)** suy từ toạ độ POI qua ranh giới OSM, không phải địa chỉ nguyên văn của nguồn — nên hai quán cùng con đường luôn hiện cùng một hệ tên phường. Địa chỉ gốc của nguồn (có thể là quận/phường cũ) vẫn nằm ở `address.text` của `GET /v1/places/{id}`. POI người dùng vừa tạo chưa qua pipeline tuần thì tạm dùng phường/tỉnh do người tạo nhập.
```
Tìm mục mô tả `address` của Places (grep `address.text` hoặc `PlaceAddress`) và thêm một câu: "`ward`/`province` là đơn vị hiện hành suy từ toạ độ; `text` là địa chỉ nguyên văn của nguồn."

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/place.ts apps/api/test/place.test.ts apps/docs/src/content/docs/api.md
git commit -m "feat(api): address.ward/province của Places theo hành chính hiện hành; docs secondary"
```

---

## Task 5: DEVLOG + cổng local

**Files:**
- Modify: `docs/DEVLOG.md` (thêm mục mới cuối file)

- [ ] **Step 1: Ghi DEVLOG**

```md
## 15. Dòng phụ gợi ý theo đơn vị hành chính hiện hành suy từ toạ độ — 13/09/2026

PHONG hỏi vì sao gợi ý "Phan Đăng Lưu" có dòng hiện "Phở Phan Đăng Lưu" trống, có dòng hiện
"…, Ho Chi Minh City, Thành phố Hồ Chí Minh". Gốc rễ: `secondary = concat_ws(street, ward, province)`
lấy từ địa chỉ **của nguồn** qua `parseAddress`; FSQ không có địa chỉ → rỗng; FSQ ghi "Ho Chi Minh City"
(không có alias) → rơi vào ô phường. Không có bước nào gán hành chính theo toạ độ dù `admin_area` đã có.

Hướng đã duyệt: cột riêng `poi.admin_ward`/`admin_province` (migration 0014) do bước mới
`geocode/poi-admin.mjs` điền bằng `ST_Contains` sau `geocode/admin.mjs`; API đọc `coalesce(admin_x, x)`
cho `secondary` và `address.ward/province`; `address.text` giữ nguyên bản nguồn. Rủi ro đã cân:
toạ độ FSQ rơi về tâm thành phố 0,4 % (evidence 13/09) và POI sát ranh giới có thể gán sang phường
liền kề; đổi lại một hệ hành chính (mới 2025) duy nhất trong gợi ý. Plan:
`docs/superpowers/plans/2026-09-13-dong-phu-hanh-chinh-theo-toa-do.md`.
```

- [ ] **Step 2: Cổng local đầy đủ**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: xanh. dbtest đầy đủ (`pnpm test:db`) chạy trên CI khi push (workflow `DB tests`, ~20 phút); local chỉ chạy file `poi-admin.dbtest.mjs` như Task 2.

- [ ] **Step 3: Commit**

```bash
git add docs/DEVLOG.md
git commit -m "docs: DEVLOG mục 15 — dòng phụ theo hành chính hiện hành"
```

---

## Task 6: Phát hành production (thứ tự bắt buộc)

Bài học đã ghi: deploy Worker trước migration làm API 5xx vì SELECT cột chưa có. Thứ tự:

- [ ] **Step 1: Migration lên DB máy chủ trước** (không pull/up, chỉ áp `db/` của working tree)

Run: `pnpm server:migrate`
Expected: log `✓ 0014_poi_admin` và `✔ server:migrate xong`. Kiểm: `curl -s https://api.ai-solutions.io.vn/healthz/db` có `schema_migration: "0014_poi_admin"`.

- [ ] **Step 2: Backfill ngay trên production** (không chờ cron thứ Hai)

```bash
docker compose --env-file infra/server/.env -f infra/server/compose.yml run --rm \
  -v "$PWD/pipelines:/app/pipelines" pipeline node pipelines/poi/src/geocode/poi-admin.mjs
```
Expected: `✓ poi admin: ghi N/1.5xx.xxx; thiếu phường x %`. Ghi con số vào DEVLOG mục 15. Mount `pipelines/` vì image GHCR chưa có file mới (giống lý do ở `server-migrate.mjs`).

- [ ] **Step 3: Push → CI deploy API + DB tests**

```bash
git push origin main
gh run list --limit 4
```
Expected: `Deploy API`, `CI`, `DB tests` xanh. Sau deploy, kiểm:
```bash
curl -s -G https://api.ai-solutions.io.vn/v1/autocomplete --data-urlencode "q=Phan Đăng Lưu" -H "X-Api-Key: $MAPSLIBVN_API_KEY"
```
Expected: "Phở Phan Đăng Lưu" có `secondary` dạng `"Phường …, Thành phố Hồ Chí Minh"`; không còn chuỗi "Ho Chi Minh City"; "Mobifone Phan Đăng Lưu" → `"Phan Đăng Lưu, Phường …, Thành phố Hồ Chí Minh"`.

- [ ] **Step 4: Ghi nhận**

Cập nhật DEVLOG mục 15 với: số dòng ghi, % thiếu phường/tỉnh, ví dụ trước/sau. Commit `docs: số đo backfill admin 13/09`.
