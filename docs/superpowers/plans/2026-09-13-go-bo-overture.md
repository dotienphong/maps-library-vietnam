# Gỡ bỏ hoàn toàn nguồn POI Overture — Plan thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xoá sạch nguồn POI Overture khỏi code, test, docs, playground, SDK, schema DB, dữ liệu production, archive R2 và manifest; hệ thống chỉ còn hai nguồn `osm` và `fsq`.

**Architecture:** Registry `POI_SOURCE_PROFILES` trong `@mapslibvn/core` là nguồn sự thật duy nhất cho API, SDK, pipeline; đổi nó trước, mọi tầng khác theo. Pipeline bỏ bước ingest Overture, conflate/publish rebuild toàn bộ bảng `poi` từ hai nguồn còn lại (spec 5.4.8 giữ `poi.id` khi nguồn chính biến mất). Manifest/state/rollback lọc `poiProfiles` theo registry để khoá `overture*` không kẹt lại sau khi xoá archive.

**Tech Stack:** TypeScript (core/api/SDK), Node ESM `.mjs` + JSDoc (pipeline/scripts), PostgreSQL 16 + PostGIS, Vitest, Biome, Astro docs, Wrangler (KV/Workers), rclone (R2), Docker compose máy chủ.

**Quyết định đã chốt (PHONG yêu cầu 13/09/2026 "remove sạch POI từ overture"):**

- Tài liệu **lịch sử** (`docs/DEVLOG.md`, `docs/evidence/**`, `docs/superpowers/plans|specs/**` cũ) **giữ nguyên** vì là biên bản đã xảy ra; chỉ thêm mục DEVLOG mới. Mọi tài liệu **đang hiệu lực** (README, docs site, legal, notices) sửa hết.
- Profile `osm-fsq` bị bỏ vì trùng `all` sau khi gỡ Overture. Registry mới: `all = ['osm','fsq']`, `osm`, `fsq`.
- Chuỗi attribution mới, dùng nguyên văn ở mọi nơi:
  `© MapsLibVN · © OpenStreetMap contributors (ODbL) · © OpenMapTiles · Foursquare OS Places (Apache-2.0)`
- `poi.category_map`/`poi_source_link`/`address_anchor` đổi CHECK bỏ `'overture'` bằng migration `0013`; bảng `src_overture_place` DROP.
- SDK bump `0.6.0 → 0.7.0` (kiểu `PoiSource` hẹp lại là breaking). **Không** publish npm trong plan này; PHONG quyết sau.
- Không dùng `word_similarity` hay đổi luật conflate — ngoài phạm vi.

**Hợp đồng dùng chung (mọi task phải khớp):**

```ts
// packages/core/src/poi-sources.ts
export const POI_SOURCES = ['osm', 'fsq'] as const;
export const POI_SOURCE_PROFILES = {
  all: ['osm', 'fsq'],
  osm: ['osm'],
  fsq: ['fsq'],
} as const;
// Thông điệp 400 của API: 'sources chỉ nhận osm,fsq,all'
// Header x-poi-profile: 'all' | 'osm' | 'fsq' | 'all;fallback'
```

---

## Task 1: `@mapslibvn/core` — registry nguồn, attribution, kiểu

**Files:**
- Modify: `packages/core/src/poi-sources.ts`
- Modify: `packages/core/src/attribution.ts`
- Modify: `packages/core/src/types.ts:32`
- Modify: `packages/core/src/poi-sources.test.ts`, `packages/core/src/attribution.test.ts`, `packages/core/src/client.test.ts`, `packages/core/src/client.places.test.ts`
- Modify: `packages/core/README.md` (dòng 16, 19, 65, 68)
- Modify: `packages/core/package.json` version `0.7.0`

- [ ] **Step 1: Sửa test registry trước (RED)**

Trong `packages/core/src/poi-sources.test.ts`, thay mọi kỳ vọng ba nguồn bằng hai nguồn. Các ca bắt buộc có:

```ts
expect(POI_SOURCES).toEqual(['osm', 'fsq']);
expect(POI_SOURCE_PROFILES).toEqual({ all: ['osm', 'fsq'], osm: ['osm'], fsq: ['fsq'] });
expect(parsePoiSourcesCsv('overture')).toBeNull();
expect(parsePoiSourcesCsv('osm,overture')).toBeNull();
expect(parsePoiSourcesCsv('fsq,osm')).toEqual(['osm', 'fsq']);
expect(profileForSources(['osm', 'fsq'])).toBe('all');
expect(profileForSources(['fsq'])).toBe('fsq');
expect(poiSourcesKey(['fsq', 'osm'])).toBe('osm,fsq');
```

Trong `attribution.test.ts` kỳ vọng nguyên văn:

```ts
expect(attributionText()).toBe(
  '© MapsLibVN · © OpenStreetMap contributors (ODbL) · © OpenMapTiles · Foursquare OS Places (Apache-2.0)',
);
expect(ATTRIBUTION_LINKS.map((l) => l.text)).not.toContain('Places: Overture Maps Foundation');
```

Trong `client.test.ts` / `client.places.test.ts`: mọi `poiSources: ['overture', ...]` đổi thành `['fsq']` hoặc `['osm','fsq']`; mọi chuỗi `sources=osm,overture,fsq` → `sources=osm,fsq`; mọi `sources=overture,fsq` → `sources=fsq`.

- [ ] **Step 2: Chạy để thấy đỏ**

Run: `pnpm --filter @mapslibvn/core exec vitest run src/poi-sources.test.ts src/attribution.test.ts`
Expected: FAIL (registry còn `overture`).

- [ ] **Step 3: Sửa `poi-sources.ts`**

```ts
export const POI_SOURCES = ['osm', 'fsq'] as const;
export type PoiSource = (typeof POI_SOURCES)[number];

export const POI_SOURCE_PROFILES = {
  all: ['osm', 'fsq'],
  osm: ['osm'],
  fsq: ['fsq'],
} as const satisfies Readonly<Record<string, readonly PoiSource[]>>;
```

Sửa comment JSDoc: bỏ "cả ba", bỏ đoạn viện dẫn đo 07/09 về `osm` 7 %; thay bằng: "Overture đã gỡ 13/09/2026 (plan `2026-09-13-go-bo-overture.md`); `all` = OSM + Foursquare." `parsePoiSourcesCsv`: comment "`all` là bí danh cả hai".

- [ ] **Step 4: Sửa `attribution.ts`**

Xoá phần tử `Places: Overture Maps Foundation` khỏi `ATTRIBUTION_LINKS`. Hàm `join`:

```ts
/** Ghép bốn mục bằng " · ". */
function join(parts: string[]): string {
  const [mapsLibVN, osm, openMapTiles, foursquare] = parts as [string, string, string, string];
  return `${mapsLibVN} · ${osm} · ${openMapTiles} · ${foursquare}`;
}
```

- [ ] **Step 5: Sửa `types.ts:32`**

```ts
source: PoiSource;
```
(import `PoiSource` từ `./poi-sources` nếu file chưa import.)

- [ ] **Step 6: README + version**

`packages/core/README.md`: dòng 16 "mix OpenStreetMap and Foursquare Open Places per request…", dòng 19 "OSM/Foursquare data licenses", dòng 65 "trộn OpenStreetMap và Foursquare Open Places… mặc định cả hai (`all`)", dòng 68 "OSM/Foursquare". `package.json` version `0.7.0`.

- [ ] **Step 7: Xanh**

Run: `pnpm --filter @mapslibvn/core build && pnpm --filter @mapslibvn/core exec vitest run`
Expected: PASS toàn bộ.

- [ ] **Step 8: Commit**

```bash
git add packages/core
git commit -m "feat(core)!: gỡ nguồn POI Overture khỏi registry và attribution"
```

---

## Task 2: `apps/api` — tham số, style, fixture DB test

**Files:**
- Modify: `apps/api/src/params.ts:50-57`, `apps/api/src/poi-sources.ts` (comment), `apps/api/src/style.ts:20` (comment)
- Modify: `apps/api/test/params.test.ts`, `apps/api/test/styles.test.ts`, `apps/api/test/area-candidates.test.ts`, `apps/api/test/tiles.test.ts`, `apps/api/test/autocomplete-sql.test.ts`
- Modify: `apps/api/test-db/setup.sql` (dòng 145-178), `apps/api/test-db/places.itest.mjs`

- [ ] **Step 1: Sửa test (RED)**

`params.test.ts`: `parseSources('overture')` phải ném `ApiError` 400 với message `'sources chỉ nhận osm,fsq,all'`; `parseSources('')` → `['osm','fsq']`; `parseSources('fsq,osm')` → `['osm','fsq']`.
`styles.test.ts`: bỏ ca `overture`, `overture-fsq`, `osm-fsq`; header hợp lệ chỉ `all`, `osm`, `fsq`, `all;fallback`.
`area-candidates.test.ts`, `tiles.test.ts`, `autocomplete-sql.test.ts`: thay `'overture'` bằng `'fsq'` trong dữ liệu mẫu.

- [ ] **Step 2: Chạy**

Run: `pnpm --filter @mapslibvn/api test`
Expected: FAIL ở message 400.

- [ ] **Step 3: Sửa `params.ts`**

```ts
/** `sources=osm,fsq` | `all`; rỗng → mặc định cả hai nguồn. */
export function parseSources(raw: string | undefined): PoiSource[] {
  const sources = parsePoiSourcesCsv(raw);
  if (!sources) throw new ApiError(400, 'invalid_request', 'sources chỉ nhận osm,fsq,all');
  return sources;
}
```

`poi-sources.ts` comment: `"osm,fsq"`. `style.ts:20`: `` `osm`, `fsq`, `all` hoặc `all;fallback` ``.

- [ ] **Step 4: Fixture DB test**

`setup.sql`: bốn dòng POI `R5SOURCEOVERTURE*` đổi `primary_source` thành `'fsq'`, đổi ID thành `R5SOURCEFSQ…` cùng độ dài 26 ký tự (ví dụ `R5SOURCEFSQB000000000000001`, giữ đúng 26 ký tự), đổi tên `Overture` → `Fsq Beta` để không trùng fixture FSQ sẵn có. `places.itest.mjs`: cập nhật ma trận: profile `all` gồm osm+fsq, `osm`, `fsq`; xoá các ca `overture`, `overture-fsq`, `osm-fsq`; `sources=overture` phải trả 400; cache đổi chiều `osm → all` và `all → fsq`.

- [ ] **Step 5: Xanh**

Run: `pnpm --filter @mapslibvn/api test`
Expected: PASS. (Ghi chú: `pnpm test:api-db` cần Wrangler + Postgres, chạy ở Task 8.)

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api)!: sources chỉ nhận osm,fsq,all; bỏ profile Overture"
```

---

## Task 3: SDK `web`, `react`, `react-native` — test, README, version

**Files:**
- Modify: `packages/web/src/map.test.ts`, `packages/react/src/map.test.tsx`, `packages/react-native/src/map.test.tsx`, `packages/react-native/src/use-style.test.ts`
- Modify: `packages/react/README.md:18,69`
- Modify: `packages/web/package.json`, `packages/react/package.json`, `packages/react-native/package.json` version `0.7.0`

- [ ] **Step 1: Sửa test**

Mọi `poiSources: ['overture', 'fsq']` → `['fsq']`; `['overture']` → `['osm']` hoặc `['fsq']` sao cho ca "đổi prop → tạo lại map" vẫn dùng hai giá trị khác nhau (ví dụ `['fsq']` → `['osm','fsq']`). Ca "tổ hợp không có profile → throw" đổi đầu vào thành `['overture' as never]` hoặc `['fsq','bogus' as never]`; kỳ vọng vẫn ném lỗi.

- [ ] **Step 2: Chạy**

Run: `pnpm --filter @mapslibvn/core build && pnpm exec vitest run packages/web packages/react packages/react-native`
Expected: PASS (core đã đổi ở Task 1; nếu đỏ, sửa cho khớp hợp đồng).

- [ ] **Step 3: README + version**

`packages/react/README.md` dòng 18, 69: "(OSM / Foursquare)". Ba `package.json` → `0.7.0`; nếu gói nào khai `peerDependencies`/`dependencies` `@mapslibvn/core` theo version cứng thì đổi khớp `0.7.0`.

- [ ] **Step 4: Build + size**

Run: `pnpm --filter @mapslibvn/web build && pnpm --filter @mapslibvn/react build && pnpm --filter @mapslibvn/react-native build`
Expected: build sạch, size-limit không vượt.

- [ ] **Step 5: Commit**

```bash
git add packages/web packages/react packages/react-native
git commit -m "feat(sdk)!: poiSources chỉ còn osm/fsq; bump 0.7.0"
```

---

## Task 4: Docs site + Playground

**Files:**
- Modify: `apps/docs/src/content/docs/{api,ban-do-web,tinh-nang,tim-kiem,sdk,react,react-native,giay-phep,tu-host}.md`, `index.mdx`
- Modify: `apps/docs/public/playground.html:176-180`, `apps/docs/public/playground-lib.js:34-68`
- Modify: `apps/docs/scripts/playground-lib.test.mjs:71-82`, `apps/docs/e2e/playground.spec.ts:187-188`

- [ ] **Step 1: Test playground (RED)**

`playground-lib.test.mjs`: `parseState('?sources=osm,fsq').sources` → `'all'`; `parseState('?sources=overture')` → mặc định `'all'` (giá trị lạ về mặc định); bảng ca giữ `['?sources=fsq','fsq','fsq',"poiSources: ['fsq']"]`, xoá hai dòng overture và dòng `osm-fsq`.

- [ ] **Step 2: `playground-lib.js`**

```js
const PROFILES = { all: ['osm', 'fsq'], osm: ['osm'], fsq: ['fsq'] };
/** @property {'all' | 'osm' | 'fsq'} sources Profile nguồn POI. */
```
Giữ nguyên tên hằng/hàm hiện có trong file; chỉ thu registry và JSDoc.

- [ ] **Step 3: `playground.html`**

```html
<option value="all">Tất cả — OSM + Foursquare</option>
<option value="osm">Chỉ OpenStreetMap</option>
<option value="fsq">Chỉ Foursquare</option>
```
Xoá option `osm-fsq`, `overture-fsq`, `overture`.

- [ ] **Step 4: E2E**

`playground.spec.ts:187-188` xoá hai dòng overture và dòng `osm-fsq` nếu có; giữ ma trận `all`, `osm`, `fsq`.

- [ ] **Step 5: Nội dung docs**

Sửa từng dòng đã liệt kê:
- `api.md` 128/197/242/368: "`osm`, `fsq`; `all` = cả hai"; 302: ví dụ `source` đổi `"fsq"` với `source_id` dạng `"4b0588c0f964a520e7cd22e3"`; 540: chuỗi attribution mới; 558: "`osm,fsq` (`all`), `osm` hoặc `fsq`"; 562-563: header `all`, `osm`, `fsq`; 643: `source: 'osm' | 'fsq'`.
- `ban-do-web.md` 56: kiểu `('osm' | 'fsq')[]`, mặc định "cả hai (`all`)", "nhận đúng ba profile"; 179-195: ba profile, ví dụ `poiSources: ['fsq']`, `sources="fsq"`.
- `tinh-nang.md` 50-52: ba profile; 57: **xoá** dòng "Phân bố nguồn chính hiện tại…" (số sẽ đo lại ở Task 9 rồi điền); 59: "hai nguồn mở: OpenStreetMap (ODbL) và Foursquare OS Places (Apache-2.0)"; 142: "Pipeline dữ liệu OSM, Foursquare".
- `tim-kiem.md` 140-146, `sdk.md` 33-40, `react.md` 71/86-87, `react-native.md` 56/73/77-78: ba profile, ví dụ `['fsq']`.
- `giay-phep.md` 3: description bỏ Overture; 18: xoá hàng Overture; 28: chuỗi attribution mới.
- `tu-host.md` 15/50, `index.mdx` 38: bỏ "Overture".

- [ ] **Step 6: Xanh**

Run: `pnpm exec vitest run apps/docs/scripts && pnpm --filter @mapslibvn/docs build`
Expected: PASS, build Astro sạch (link check nội bộ chạy trong build).

- [ ] **Step 7: Commit**

```bash
git add apps/docs
git commit -m "docs: gỡ Overture khỏi docs site và playground; ba profile all/osm/fsq"
```

---

## Task 5: `pipelines/poi` — bỏ ingest, records, conflate, taxonomy, fixture

**Files:**
- Delete: `pipelines/poi/src/ingest/overture.mjs`, `pipelines/poi/fixtures/overture-q1.parquet`, `pipelines/poi/fixtures/conflate-pairs.json`, `db/seed/category_map_overture.csv`
- Modify: `pipelines/poi/src/records.mjs` (xoá `overtureRows`, mảng gen chỉ `[osmRows, fsqRows]`), `pipelines/poi/src/conflate.mjs` (`SOURCES = ['osm','fsq']`; xoá dòng `if (srcs.size === 1 && sourceOf(primaryRid) === 'overture' && c < 0.4) continue;`), `pipelines/poi/src/score.mjs` (`SOURCE_ORDER = { osm: 0, fsq: 1 }`; comment "hoà → OSM > FSQ"), `pipelines/poi/src/taxonomy.mjs` (bỏ `overture` khỏi `loadCategoryMaps`, kiểu JSDoc `'osm' | 'fsq'`, log tổng), `pipelines/poi/src/lib/env.mjs` (xoá `overtureSource`), `pipelines/poi/src/lib/vn-bbox.mjs` (xoá `overtureBboxWhere`, sửa comment "Bbox lọc sơ bộ FSQ"), `pipelines/poi/src/duck.mjs` (xoá `anonymousS3` nếu không còn ai gọi — kiểm `grep -rn anonymousS3 pipelines scripts`), `pipelines/poi/src/lib/poi-filter.mjs` (comment), `pipelines/poi/src/geocode/anchors.mjs:2` (comment "record FSQ"), `pipelines/poi/scripts/make-fixture.mjs` (bỏ phần Overture), `pipelines/poi/scripts/category-coverage.mjs` (bỏ nguồn overture), `pipelines/poi/scripts/sample-addresses.mjs` (chuyển sang đọc `src_fsq_place` hoặc xoá script nếu chỉ phục vụ Overture — ghi rõ trong commit), `pipelines/poi/README.md`, `scripts/db-fixture.mjs:23`
- Modify tests: `pipelines/poi/tests/{ingest,conflate,pipeline-fixture,geocode}.dbtest.mjs`, `{score,taxonomy,greedy,stable-id,export-snapshot}.test.mjs`, `pipelines/poi/src/lib/poi-filter.test.mjs`, `db/schema.dbtest.mjs`

- [ ] **Step 1: Unit test trước (RED)**

`score.test.mjs`: `pickPrimary` hoà → `osm` trước `fsq`; xoá ca có `overture`. `taxonomy.test.mjs`: `loadCategoryMaps()` chỉ có khoá `osm`, `fsq`; tổng dòng = OSM + FSQ. `greedy.test.mjs`: thay `'overture'` bằng `'fsq'` trong ca cùng nguồn/khác nguồn. `stable-id.test.mjs`: thay ví dụ `stableId('overture', …)` bằng `stableId('fsq', …)` (giá trị kỳ vọng tính lại bằng cách chạy hàm một lần rồi ghim). `export-snapshot.test.mjs`, `poi-filter.test.mjs`: profile chỉ `all/osm/fsq`; `sourcesForProfile('overture')` ném lỗi.

- [ ] **Step 2: Chạy**

Run: `pnpm exec vitest run pipelines/poi`
Expected: FAIL.

- [ ] **Step 3: Sửa source theo danh sách Files**

`records.mjs` — sau khi xoá `overtureRows`, vòng chạy:
```js
for (const gen of [osmRows, fsqRows])
  n += await copyInto(sql, 'poi_work_record', RECORD_COLUMNS, gen(sql));
```
`taxonomy.mjs` `loadCategoryMaps`:
```js
return {
  osm: read('category_map_osm.csv'),
  fsq: read('category_map_fsq.csv'),
};
```
và log `maps.osm.size + maps.fsq.size`.

- [ ] **Step 4: dbtest**

`ingest.dbtest.mjs`: xoá ca Overture; `conflate.dbtest.mjs`: fixture `test-hl-*`/`test-cong`/`test-lowconf` chuyển sang `src_fsq_place` (cột: `fsq_place_id, name, categories, address, locality, region, tel, website, date_closed, geom, release`) hoặc `src_osm_place`; ca "Overture confidence < 0,4 đơn lẻ → không tạo poi" **xoá**; ca kế thừa `poi_id` giữ nhưng dùng nguồn `fsq`. `pipeline-fixture.dbtest.mjs`: bước ingest chỉ OSM + FSQ; các assert "Overture thắng ô, OSM phục hồi ở `osm`" đổi thành FSQ. `geocode.dbtest.mjs`: thay nguồn. `db/schema.dbtest.mjs`: bỏ `src_overture_place` khỏi `ALL_TABLES` và vòng GIST; đổi tiêu đề "đủ 16 bảng" → "đủ 15 bảng".

- [ ] **Step 5: README pipeline**

Bảng bước: xoá hàng "Ingest Overture"; đoạn số liệu Task 10: thêm câu "Overture đã gỡ 13/09/2026; số liệu dưới là lịch sử ba nguồn" ngay trên đoạn số cũ, không sửa số cũ. Taxonomy: "2 CSV ánh xạ (OSM 296, FSQ 279)".

- [ ] **Step 6: Xanh unit**

Run: `pnpm exec vitest run pipelines/poi db && pnpm lint && pnpm typecheck`
Expected: PASS; `checkJs` không còn tham chiếu `overtureSource`/`overtureBboxWhere`.

- [ ] **Step 7: Commit**

```bash
git add -A pipelines/poi db/seed db/schema.dbtest.mjs scripts/db-fixture.mjs
git commit -m "feat(pipeline)!: bỏ ingest/records/taxonomy Overture; conflate hai nguồn osm+fsq"
```

---

## Task 6: Migration 0013 + scripts vận hành + notices + legal

**Files:**
- Create: `db/migrations/0013_drop_overture.sql`, `db/migrations/0013_drop_overture.down.sql`
- Modify: `scripts/lib/db-permissions.mjs:13,34`, `scripts/lib/odbl.mjs:122`, `scripts/data-update.mjs`, `scripts/lib/sources.mjs` (+ `sources.test.mjs`), `scripts/lib/update-plan.mjs` (+ `update-plan.test.mjs`), `scripts/data-rollback.mjs` (+ test), `scripts/poi-profile-publish.mjs` (comment dòng 6), `scripts/perf-autocomplete.mjs:18-19,333` (+ test), `pipelines/tiles/src/lib/manifest-state.mjs:77-80` (+ test), `pipelines/tiles/src/lib/dates.test.mjs:39-48`, `.github/workflows/data-update.yml:44`, `.env.example:25`, `README.md:4,66,80`, `THIRD_PARTY_NOTICES.md:50,56`, `docs/legal/dieu-khoan-tenant.md:10,21`, `docs/legal/checklist-phap-ly.md:25`

- [ ] **Step 1: Migration**

`0013_drop_overture.sql`:
```sql
-- Gỡ nguồn Overture (13/09/2026). Dữ liệu poi/poi_source_link do pipeline rebuild ngay sau migration.
DROP TABLE IF EXISTS src_overture_place;
DELETE FROM category_map WHERE source = 'overture';
DELETE FROM poi_source_link WHERE source = 'overture';
ALTER TABLE category_map DROP CONSTRAINT IF EXISTS category_map_source_check;
ALTER TABLE category_map ADD CONSTRAINT category_map_source_check CHECK (source IN ('osm', 'fsq'));
ALTER TABLE poi_source_link DROP CONSTRAINT IF EXISTS poi_source_link_source_check;
ALTER TABLE poi_source_link ADD CONSTRAINT poi_source_link_source_check CHECK (source IN ('osm', 'fsq'));
ALTER TABLE address_anchor DROP CONSTRAINT IF EXISTS address_anchor_source_check;
ALTER TABLE address_anchor ADD CONSTRAINT address_anchor_source_check CHECK (source IN ('osm', 'fsq', 'user'));
```
Trước khi viết, xác minh tên constraint thật bằng `SELECT conname FROM pg_constraint WHERE conrelid = 'category_map'::regclass AND contype = 'c'` trên DB dev; nếu tên khác thì dùng tên thật. Kiểm cả `poi.primary_source` (0003 dòng 31): nếu có CHECK liệt kê `'overture'` thì thêm cặp DROP/ADD tương tự với `('osm','fsq')`. Lưu ý `poi_source_link` có cột `role` — không đụng.

`0013_drop_overture.down.sql`: tạo lại `src_overture_place` đúng định nghĩa ở `0002_sources.sql:22-36` + `OWNER TO pipeline` + `GRANT SELECT … TO api`, và khôi phục ba CHECK cũ có `'overture'`.

- [ ] **Step 2: Scripts quyền/ODbL**

`db-permissions.mjs`: xoá `ALTER TABLE src_overture_place OWNER TO pipeline;` và bỏ `src_overture_place` khỏi GRANT. `odbl.mjs:122`: bỏ `` `src_overture_place` (CDLA-Permissive 2.0) ``.

- [ ] **Step 3: Dò nguồn + kế hoạch cập nhật (RED → GREEN)**

`sources.test.mjs`: xoá ca `latestOvertureRelease`; `detectSources` trả `{ osm, fsq }` không có `overture`. `update-plan.test.mjs`: `decideWork` không còn lý do "Overture đổi"; `nextState` **lọc** `poiProfiles` theo registry:

```js
// update-plan.mjs — trong nextState, thay khối poiProfiles bằng:
const allowed = new Set(Object.keys(POI_SOURCE_PROFILES));
const poiProfiles = Object.fromEntries(
  Object.entries({
    ...(legacyOsm ? { osm: legacyOsm } : {}),
    ...state.releases?.poiProfiles,
    ...built.poiProfiles,
  }).filter(([profile]) => allowed.has(profile)),
);
```
(import `POI_SOURCE_PROFILES` từ `../../pipelines/poi/src/lib/poi-filter.mjs`, cùng cách `poi-profile.mjs` đang làm.) Test: state cũ có `overture: 'poi-overture-x'` → `nextState` không còn khoá đó.

`sources.mjs`: xoá `OVERTURE_LIST`, `latestOvertureRelease`, fetch Overture; `detectSources` trả `{ osm, fsq }`. `data-update.mjs`: xoá dòng `run('node', ['pipelines/poi/src/ingest/overture.mjs', …])`; log phiên bản chỉ OSM + FSQ. `.github/workflows/data-update.yml:44` xoá `OVERTURE_RELEASE`; `.env.example:25` xoá.

- [ ] **Step 4: Manifest và rollback lọc theo registry**

`manifest-state.mjs:77-80`:
```js
const poiProfiles = Object.fromEntries(
  Object.entries({ ...(current.poiProfiles ?? {}), ...profileUpdates }).filter(([profile]) =>
    availableProfiles.has(profile),
  ),
);
```
`manifest-state.test.mjs:74-88`: ca `set --poi-profile fsq=…` trên current có `overture` → kết quả không còn `overture`. `dates.test.mjs:39-48`: profile chỉ `osm`, `fsq`.
`data-rollback.mjs` `verifyRollbackArchives`: lọc `Object.entries(target.poiProfiles ?? {})` theo `POI_SOURCE_PROFILES` trước khi gom release; test `data-rollback.test.mjs:52-88`: target có `overture: 'poi-overture-old'` mà R2 không có archive → **không** ném lỗi, kết quả không chứa `poi-overture-old`.

- [ ] **Step 5: perf-autocomplete**

```js
const POI_SOURCE_ORDER = ['osm', 'fsq'];
const PAIRED_SOURCE_PROFILES = new Set(['osm', 'fsq']);
```
usage dòng 333: `--paired-sources [osm|fsq]`. Test 307-327: `fsq,osm,fsq` → `'osm,fsq'` phải bị **từ chối** vì `osm,fsq` = `all` không phải profile riêng; giữ ca `fsq`.

- [ ] **Step 6: README gốc, notices, legal**

`README.md:4` "(OpenStreetMap, Foursquare OS)"; 66 "OSM hoặc Foursquare"; 80 "Foursquare thay đổi chỉ cập nhật POI". `THIRD_PARTY_NOTICES.md`: xoá hàng 50; dòng 56 chuỗi attribution mới. Chạy `pnpm notices:sync` để đồng bộ 4 bản sao. `dieu-khoan-tenant.md:10` "gồm dữ liệu OpenStreetMap (ODbL), Foursquare OS Places (Apache-2.0) và dữ liệu do người dùng đóng góp"; dòng 21 chuỗi mới. `checklist-phap-ly.md:25` "chỉ có OSM, Foursquare".

- [ ] **Step 7: Xanh**

Run: `pnpm lint && pnpm typecheck && pnpm exec vitest run scripts pipelines/tiles && node scripts/notices-sync.mjs --check`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A db/migrations scripts pipelines/tiles .github .env.example README.md THIRD_PARTY_NOTICES.md packages/*/THIRD_PARTY_NOTICES.md docs/legal
git commit -m "feat(db,scripts)!: migration 0013 drop Overture; manifest/state/rollback lọc profile theo registry"
```

---

## Task 7: Cổng đầy đủ trước khi lên production

- [ ] **Step 1: Unit + API**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: tất cả xanh; không còn file nào `grep -ril overture` ngoài `docs/DEVLOG.md`, `docs/evidence/`, `docs/superpowers/`, `db/migrations/0002*`, `db/migrations/0013*`, `pnpm-lock.yaml`.

- [ ] **Step 2: Kiểm kê lần cuối**

Run:
```bash
grep -ril overture . | grep -v -E "node_modules|/\.git/|/dist/|^\./out/|^\./work/|docs/DEVLOG.md|docs/evidence/|docs/superpowers/|pnpm-lock|db/migrations/000[2-9]|db/migrations/0013|\.turbo/"
```
Expected: không có dòng nào.

- [ ] **Step 3: Test DB trong container**

Run: `pnpm image:build && pnpm test:db`
Expected: xanh (tạo lại DB cô lập `mapslibvn_task8_test`, chạy migration tới 0013, fixture Quận 1 hai nguồn).

- [ ] **Step 4: Push**

```bash
git push origin main
```
Theo dõi 4 workflow: CI, Deploy API, Deploy Docs, DB tests. Deploy API lên trước là an toàn: `sources=overture` → 400 ngay; `all` lọc `primary_source IN ('osm','fsq')` nên POI Overture biến mất khỏi Places API kể cả khi DB chưa rebuild.

---

## Task 8: Production — migration, rebuild POI, archive, manifest

Chạy trên máy chủ (chính máy này). Mọi bước ghi log vào `docs/evidence/overture-removal/2026-09-13-go-bo-overture.md` (Task 9).

- [ ] **Step 1: Backup trước khi phá**

```bash
docker compose -f infra/server/compose.yml --env-file infra/server/.env exec backup node infra/server/backup/backup.mjs --once
```
Expected: có file mới trong `r2:mapslibvn-backups/backups/daily`.

- [ ] **Step 2: Image mới + recreate container pipeline/backup**

```bash
pnpm image:build
docker compose -f infra/server/compose.yml --env-file infra/server/.env up -d --force-recreate pipeline backup
```

- [ ] **Step 3: Migration 0013 bằng superuser**

```bash
docker compose -f infra/server/compose.yml --env-file infra/server/.env run --rm \
  -e POSTGRES_USER=mapslibvn -e POSTGRES_PASSWORD=<POSTGRES_SUPER_PASSWORD từ infra/server/.env> \
  pipeline node scripts/db-migrate.mjs
```
Kiểm: `curl -s https://api.ai-solutions.io.vn/healthz/db` có `schema_migration` = `0013_drop_overture.sql`; `SELECT count(*) FROM category_map WHERE source='overture'` = 0; `\dt src_*` không còn `src_overture_place`.

- [ ] **Step 4: Rebuild POI + geocode + archive + manifest**

```bash
docker compose -f infra/server/compose.yml --env-file infra/server/.env exec -d pipeline \
  sh -c 'node scripts/data-update.mjs --poi --force --skip-routing > /app/out/go-bo-overture.log 2>&1'
```
Theo dõi `docker compose … exec pipeline tail -f /app/out/go-bo-overture.log`. Kỳ vọng: ingest OSM + FSQ, taxonomy, records (~500 nghìn), conflate, `publish --force` (active giảm từ 1.515.984 xuống ~350 nghìn — cố ý), geocode, export ba profile `all`/`osm`/`fsq`, upload, smoke, manifest set, report, state.

- [ ] **Step 5: Xoá archive Overture trên R2**

Trong container pipeline: `rclone lsf r2:mapslibvn-tiles --files-only | grep -E '^poi-(overture|osm-fsq)'` → xoá từng file `.pmtiles` và `.pmtiles.sha256` bằng `rclone deletefile`. Kiểm `manifest.mjs get`: `poiProfiles` chỉ còn `osm`, `fsq`; `history` có thể còn khoá cũ (đã lọc khi rollback).

- [ ] **Step 6: Kiểm production**

- `GET /v1/search?q=Highlands&sources=overture` → 400 `invalid_request`.
- `GET /v1/styles/light.json` → `x-poi-profile: all`, source `poi` trỏ release mới; `?sources=fsq` → `fsq`; `?sources=osm` → `osm`; `?sources=overture` → 400.
- `GET /v1/attribution` → chuỗi mới, không có "Overture".
- DB: `SELECT primary_source, count(*) FROM poi WHERE status='active' GROUP BY 1` chỉ `osm`, `fsq`, `NULL` (user).
- Playground canonical mở được, selector ba lựa chọn, không console error.

---

## Task 9: Ghi chép

**Files:**
- Create: `docs/evidence/overture-removal/2026-09-13-go-bo-overture.md`
- Modify: `docs/DEVLOG.md` (thêm mục đầu), `apps/docs/src/content/docs/tinh-nang.md` (điền lại phân bố nguồn mới đo được)

- [ ] **Step 1: Evidence** — số POI trước/sau theo nguồn, release/SHA-256 ba archive, manifest JSON, các lệnh đã chạy, kết quả kiểm production, danh sách archive đã xoá.
- [ ] **Step 2: DEVLOG** — mục "13/09/2026 — Gỡ hoàn toàn nguồn Overture", lý do (đo 13/09: 99,2 % là trang Facebook, 3,4 % POI chồng tâm thành phố, trùng lặp liên nguồn), phạm vi, việc để sau (publish npm 0.7.0 do PHONG quyết; sửa `pairAllowed` để gộp FSQ↔OSM).
- [ ] **Step 3: Commit + push**

```bash
git add docs apps/docs
git commit -m "docs: evidence và DEVLOG gỡ Overture"
git push origin main
```
