# Progressive POI Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay cách vẽ gần như toàn bộ POI bằng một pipeline chọn POI xác định theo category rank, popularity, quality và mật độ Web Mercator, rồi hiển thị icon/nhãn tăng dần theo zoom trên Web và React Native.

**Architecture:** Exporter dẫn xuất contract tile `q/r/d`, đọc POI theo priority toàn phần và truyền từng bản ghi qua selector streaming giữ một POI trên mỗi ô toàn cục. Feature được chọn mang `tippecanoe.minzoom`; style dùng một layer icon có ID công khai `poi` và hai layer nhãn, còn Core/Web/Native cùng ẩn tất cả layer nguồn POI khi `poiLayer=false`.

**Tech Stack:** Node.js 22 ESM, PostgreSQL/PostGIS 16, Tippecanoe, PMTiles, MapLibre Style Spec, TypeScript 5.6, Vitest 2, Cloudflare Workers, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-04-progressive-poi-display-design.md`

## Global Constraints

- Không thêm migration/cột DB và không đổi `PoiFeature`, Places API, taxonomy, conflation hoặc cách tính `popularity`.
- Giữ source và source-layer tên `poi`; layer icon tương tác tiếp tục có ID `poi` để `poiClick` không đổi.
- Tile giữ `id/name/cat/grp/q`, thêm `r` (1–5) và `d` (số thấp ưu tiên); không xuất popularity thô.
- Category rank 1/2/3/4/5 được xét sớm nhất ở zoom 10/12/13/14/15.
- `cellPx` z10..16 lần lượt là 160, 160, 144, 128, 112, 96, 80; tối đa một POI mỗi ô.
- Archive giữ `-Z10 -z16 -r1 --drop-densest-as-needed`, không dùng `--extend-zooms-if-still-dropping`, và phải ≤300 MiB.
- Style dùng padding hằng (`icon-padding:8`, `text-padding:4`) để tương thích Web và MapLibre Native.
- Tile cũ thiếu `r/d` phải còn render được bằng fallback `r=5`, sort theo `9-q`.
- National build, upload R2 và đổi manifest là cổng riêng; không chạy khi chưa có xác nhận sau visual acceptance.
- Không đọc, in, commit hoặc truyền secrets qua argv; mọi lệnh production dùng env repo hiện có.

## File Map

- Create `pipelines/poi/src/display-priority.mjs`: chuẩn hoá rank/bucket và tạo `d` xác định.
- Create `pipelines/poi/tests/display-priority.test.mjs`: contract priority và MD5 tie-break.
- Create `pipelines/poi/src/display-selector.mjs`: Web Mercator grid + selector streaming.
- Create `pipelines/poi/tests/display-selector.test.mjs`: cell math, quota và minzoom đơn điệu.
- Modify `pipelines/poi/src/export-tiles.mjs`: cursor priority, selector, GeoJSON minzoom, log và Tippecanoe args.
- Modify `pipelines/poi/tests/export-tiles.test.mjs`: contract `q/r/d/minzoom`, bỏ filter cũ.
- Modify `pipelines/poi/tests/pipeline-fixture.dbtest.mjs`: kiểm intermediate GeoJSON và archive fixture.
- Modify `packages/style/src/poi-layers.mjs`: layer icon + hai layer nhãn.
- Modify `packages/style/src/poi-layers.test.ts`: style contract, fallback và style-spec.
- Modify `packages/core/src/style-transform.ts` và `.test.ts`: nhận diện/ẩn mọi layer source `poi`.
- Modify `packages/web/src/map.ts` và `.test.ts`: ẩn mọi layer POI nhưng click chỉ query `poi`.
- Modify `packages/react-native/src/use-style.test.ts`: xác nhận ba layer cùng bị ẩn/localize đúng.
- Modify `apps/api/test/styles.test.ts`: manifest có/không POI với ba layer.
- Modify `apps/api/scripts/seed-local.mjs`: tuỳ chọn seed candidate POI local phục vụ visual QA.
- Modify `pipelines/poi/README.md`, bốn trang docs và `docs/DEVLOG.md`: contract/behavior/bằng chứng.

---

### Task 1: Display priority thuần và xác định

**Files:**
- Create: `pipelines/poi/src/display-priority.mjs`
- Create: `pipelines/poi/tests/display-priority.test.mjs`

**Interfaces:**
- Consumes: `{ id: string, rank: unknown, popularity: unknown, qualityScore: unknown }` từ cursor DB.
- Produces: `displayFields(input): { r: number, p: number, q: number, tie: number, d: number, earliestZoom: number, rankFallback: boolean }` và `priorityOrderSql` dùng ở Task 3.

- [x] **Step 1: Viết test đỏ cho normalize, bucket và tie-break**

```js
import { describe, expect, it } from 'vitest';
import { displayFields, idTie } from '../src/display-priority.mjs';

describe('displayFields', () => {
  it('clamp rank/popularity/quality và ánh xạ zoom', () => {
    expect(displayFields({ id: 'x', rank: 1, popularity: 99, qualityScore: 100 }))
      .toMatchObject({ r: 1, p: 9, q: 9, earliestZoom: 10 });
    expect(displayFields({ id: 'x', rank: null, popularity: null, qualityScore: null }))
      .toMatchObject({ r: 5, p: 0, q: 0, earliestZoom: 15, rankFallback: true });
    expect(displayFields({ id: 'x', rank: 8, popularity: -2, qualityScore: -20 }))
      .toMatchObject({ r: 5, p: 0, q: 0, earliestZoom: 15 });
  });

  it('rank thắng popularity, popularity thắng quality', () => {
    const d = (rank, popularity, qualityScore) =>
      displayFields({ id: 'same', rank, popularity, qualityScore }).d;
    expect(d(1, 0, 0)).toBeLessThan(d(2, 9, 100));
    expect(d(3, 2, 0)).toBeLessThan(d(3, 1, 100));
    expect(d(3, 2, 90)).toBeLessThan(d(3, 2, 10));
  });

  it('MD5 12 bit ổn định', () => {
    expect(idTie('poi-a')).toBe(3418);
    expect(idTie('poi-b')).toBe(2558);
  });
});
```

- [x] **Step 2: Chạy test và xác nhận RED**

Run: `pnpm vitest run pipelines/poi/tests/display-priority.test.mjs`

Expected: FAIL vì chưa có `display-priority.mjs`.

- [x] **Step 3: Implement module priority tối thiểu**

```js
import { createHash } from 'node:crypto';

export const EARLIEST_ZOOM_BY_RANK = /** @type {Readonly<Record<number, number>>} */ (
  Object.freeze({ 1: 10, 2: 12, 3: 13, 4: 14, 5: 15 })
);

/** @param {unknown} value @param {number} [fallback] */
const finite = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
/** @param {number} value @param {number} min @param {number} max */
const clampInt = (value, min, max) => Math.max(min, Math.min(max, Math.floor(value)));

/** @param {string} id */
export function idTie(id) {
  return Number.parseInt(createHash('md5').update(String(id), 'utf8').digest('hex').slice(0, 3), 16);
}

/** @param {{ id: string, rank: unknown, popularity: unknown, qualityScore: unknown }} input */
export function displayFields({ id, rank, popularity, qualityScore }) {
  const rawRank = Number(rank);
  const rankFallback = !Number.isInteger(rawRank) || rawRank < 1 || rawRank > 5;
  const r = rankFallback ? 5 : rawRank;
  const p = clampInt(finite(popularity) * 2, 0, 9);
  const q = clampInt(finite(qualityScore) / 10, 0, 9);
  const tie = idTie(id);
  const base = (r - 1) * 100 + (9 - p) * 10 + (9 - q);
  return { r, p, q, tie, d: base * 4096 + tie,
    earliestZoom: EARLIEST_ZOOM_BY_RANK[r] ?? 15, rankFallback };
}

export const priorityOrderSql = `
  CASE WHEN c.rank BETWEEN 1 AND 5 THEN c.rank ELSE 5 END ASC,
  LEAST(9, GREATEST(0, FLOOR(COALESCE(p.popularity, 0) * 2))) DESC,
  LEAST(9, GREATEST(0, FLOOR(COALESCE(p.quality_score, 0) / 10))) DESC,
  SUBSTRING(md5(p.id), 1, 3) ASC,
  p.id ASC`;
```

- [x] **Step 4: Chạy focused test + typecheck script**

Run: `pnpm vitest run pipelines/poi/tests/display-priority.test.mjs && pnpm exec tsc -p pipelines/poi/tsconfig.json`

Expected: PASS; TypeScript không báo lỗi JSDoc.

- [x] **Step 5: Commit Task 1**

```bash
git add pipelines/poi/src/display-priority.mjs pipelines/poi/tests/display-priority.test.mjs
git commit -m "feat(poi): tính độ ưu tiên hiển thị xác định"
```

---

### Task 2: Selector mật độ Web Mercator streaming

**Files:**
- Create: `pipelines/poi/src/display-selector.mjs`
- Create: `pipelines/poi/tests/display-selector.test.mjs`

**Interfaces:**
- Consumes: `select({ lon, lat, earliestZoom }): number | null`, gọi đúng thứ tự priority từ Task 1.
- Produces: `globalCellKey(lon, lat, zoom, cellPx)`, `createDisplaySelector()` và `snapshot()`.

- [x] **Step 1: Viết test đỏ cho cell và selector**

```js
import { describe, expect, it } from 'vitest';
import { CELL_PX_BY_ZOOM, createDisplaySelector, globalCellKey } from '../src/display-selector.mjs';

describe('globalCellKey', () => {
  it('ổn định, phân biệt zoom và clamp latitude', () => {
    expect(globalCellKey(106.7, 10.77, 14, 112)).toBe(globalCellKey(106.7, 10.77, 14, 112));
    expect(globalCellKey(106.7, 10.77, 14, 112)).not.toBe(globalCellKey(106.7, 10.77, 15, 96));
    expect(globalCellKey(0, 90, 10, 160)).toBe(globalCellKey(0, 85.05112878, 10, 160));
    expect(() => globalCellKey(181, 0, 10, 160)).toThrow(/longitude/);
  });
});

describe('createDisplaySelector', () => {
  it('giữ POI ưu tiên trước, dời POI khác sang zoom sau hoặc loại', () => {
    const selector = createDisplaySelector();
    expect(selector.select({ lon: 106.7, lat: 10.77, earliestZoom: 10 })).toBe(10);
    const second = selector.select({ lon: 106.700001, lat: 10.770001, earliestZoom: 10 });
    expect(second === null || second > 10).toBe(true);
    expect(selector.snapshot().selected).toBe(second === null ? 1 : 2);
  });

  it('feature nhận minzoom thì giữ chỗ ở mọi zoom cao hơn', () => {
    const selector = createDisplaySelector({ cellPx: Object.fromEntries(
      Object.keys(CELL_PX_BY_ZOOM).map((z) => [z, 10_000]),
    ) });
    expect(selector.select({ lon: 106.7, lat: 10.77, earliestZoom: 12 })).toBe(12);
    expect(selector.select({ lon: 106.8, lat: 10.8, earliestZoom: 16 })).toBeNull();
    expect(selector.snapshot().byMinZoom).toEqual({ 12: 1 });
  });
});
```

- [x] **Step 2: Chạy test và xác nhận RED**

Run: `pnpm vitest run pipelines/poi/tests/display-selector.test.mjs`

Expected: FAIL vì module chưa tồn tại.

- [x] **Step 3: Implement phép chiếu và selector**

```js
export const CELL_PX_BY_ZOOM = /** @type {Readonly<Record<number, number>>} */ (
  Object.freeze({ 10: 160, 11: 160, 12: 144, 13: 128, 14: 112, 15: 96, 16: 80 })
);
const MAX_LAT = 85.05112878;

/** @param {number} lon @param {number} lat @param {number} zoom @param {number} cellPx */
export function globalCellKey(lon, lat, zoom, cellPx) {
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new RangeError('longitude ngoài [-180,180]');
  if (!Number.isFinite(lat)) throw new RangeError('latitude không hữu hạn');
  const limitedLat = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const sin = Math.sin((limitedLat * Math.PI) / 180);
  const scale = 256 * 2 ** zoom;
  const x = ((lon + 180) / 360) * scale;
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return `${zoom}:${Math.floor(x / cellPx)}:${Math.floor(y / cellPx)}`;
}

/** @param {{ cellPx?: Readonly<Record<number, number>> }} [options] */
export function createDisplaySelector({ cellPx = CELL_PX_BY_ZOOM } = {}) {
  const occupied = new Map(Object.keys(cellPx).map((z) => [Number(z), new Set()]));
  /** @type {Record<number, number>} */
  const byMinZoom = {};
  let selected = 0;
  let thinned = 0;
  return {
    /** @param {{ lon: number, lat: number, earliestZoom: number }} feature */
    select({ lon, lat, earliestZoom }) {
      for (let candidate = earliestZoom; candidate <= 16; candidate++) {
        /** @type {[number, string][]} */
        const keys = [];
        for (let z = candidate; z <= 16; z++) {
          const key = globalCellKey(lon, lat, z, cellPx[z] ?? CELL_PX_BY_ZOOM[z] ?? 80);
          keys.push([z, key]);
        }
        if (keys.some(([z, key]) => occupied.get(z)?.has(key))) continue;
        for (const [z, key] of keys) occupied.get(z)?.add(key);
        selected++;
        byMinZoom[candidate] = (byMinZoom[candidate] ?? 0) + 1;
        return candidate;
      }
      thinned++;
      return null;
    },
    snapshot: () => ({ selected, thinned, byMinZoom: { ...byMinZoom } }),
  };
}
```

- [x] **Step 4: Thêm test chunk-independence và biên ô**

```js
it('không phụ thuộc biên chunk của cursor', () => {
  const rows = [
    { id: 'a', lon: 106.7, lat: 10.77, earliestZoom: 10 },
    { id: 'b', lon: 106.8, lat: 10.78, earliestZoom: 12 },
    { id: 'c', lon: 106.9, lat: 10.79, earliestZoom: 15 },
  ];
  const run = (chunks) => {
    const selector = createDisplaySelector();
    return chunks.flatMap((chunk) => chunk.map((row) => [row.id, selector.select(row)]));
  };
  expect(run([rows])).toEqual(run([rows.slice(0, 1), rows.slice(1)]));
});

it('hai phía biên ô có key khác', () => {
  const left = globalCellKey(106.7, 10.77, 16, 80);
  let lon = 106.7;
  while (globalCellKey(lon, 10.77, 16, 80) === left) lon += 0.00001;
  expect(globalCellKey(lon, 10.77, 16, 80)).not.toBe(left);
});
```

- [x] **Step 5: Chạy focused tests**

Run: `pnpm vitest run pipelines/poi/tests/display-selector.test.mjs pipelines/poi/tests/display-priority.test.mjs`

Expected: PASS toàn bộ.

- [x] **Step 6: Commit Task 2**

```bash
git add pipelines/poi/src/display-selector.mjs pipelines/poi/tests/display-selector.test.mjs
git commit -m "feat(poi): chọn POI theo lưới Web Mercator"
```

---

### Task 3: Tích hợp priority/minzoom vào exporter

**Files:**
- Modify: `pipelines/poi/src/export-tiles.mjs:1-86`
- Modify: `pipelines/poi/tests/export-tiles.test.mjs:1-69`

**Interfaces:**
- Consumes: `displayFields()` và `createDisplaySelector()` từ Tasks 1–2.
- Produces: `featureLine(row, display, minZoom)` với properties `q/r/d` và top-level `tippecanoe.minzoom`.

- [x] **Step 1: Thay test filter cũ bằng contract feature mới**

```js
it('ghi q/r/d và tippecanoe.minzoom, không lộ popularity', () => {
  const row = { id: '01ARZ', name: 'Bảo tàng', cat: 'museum', grp: 'culture_tourism',
    quality_score: 87, popularity: 2.5, rank: 1, lon: 106.7, lat: 10.77 };
  const display = displayFields({ id: row.id, rank: row.rank,
    popularity: row.popularity, qualityScore: row.quality_score });
  const f = JSON.parse(featureLine(row, display, 10));
  expect(f.tippecanoe).toEqual({ minzoom: 10 });
  expect(f.properties).toEqual({ id: row.id, name: row.name, cat: row.cat,
    grp: row.grp, q: 8, r: 1, d: display.d });
  expect(f.properties.popularity).toBeUndefined();
});
```

Xoá tests/imports cho `LOW_ZOOM_GROUPS` và `tippecanoeFilter`.

- [x] **Step 2: Chạy test và xác nhận RED đúng contract**

Run: `pnpm vitest run pipelines/poi/tests/export-tiles.test.mjs`

Expected: FAIL vì `featureLine` chưa nhận display/minzoom và filter cũ còn tồn tại.

- [x] **Step 3: Đổi cursor và streaming loop**

Cursor phải SELECT `c.rank`, `p.popularity`, `p.quality_score`, lon/lat và dùng
`ORDER BY ${sql.unsafe(priorityOrderSql)}`. Trong loop:

```js
const display = displayFields({ id: r.id, rank: r.rank, popularity: r.popularity,
  qualityScore: r.quality_score });
if (display.rankFallback) rankFallback++;
let minZoom;
try {
  minZoom = selector.select({ lon: Number(r.lon), lat: Number(r.lat), earliestZoom: display.earliestZoom });
} catch (error) {
  invalidCoordinates++;
  console.error(`POI ${r.id}: ${error instanceof Error ? error.message : String(error)}`);
  continue;
}
if (minZoom !== null) yield featureLine(r, display, minZoom);
```

Không nối raw user value vào SQL; `priorityOrderSql` là hằng nội bộ không nhận input.

- [x] **Step 4: Đổi GeoJSON và Tippecanoe args**

`featureLine()` thêm top-level `tippecanoe:{minzoom:minZoom}` và `r/d`; bỏ tạo `poi-filter.json`,
bỏ `-J filterFile`, thêm `-y r -y d`, giữ nguyên `-y q` và các thuộc tính cũ.

```js
export function featureLine(r, display, minZoom) {
  return `${JSON.stringify({
    type: 'Feature',
    tippecanoe: { minzoom: minZoom },
    properties: { id: r.id, name: r.name, cat: r.cat, grp: r.grp,
      q: display.q, r: display.r, d: display.d },
    geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
  })}\n`;
}
```

- [x] **Step 5: Thêm log và fail-closed cho toạ độ lỗi**

Sau pipeline ghi GeoJSON, log một dòng JSON có `activeRead`, `selected`, `thinned`, `byMinZoom`,
`rankFallback`, `invalidCoordinates`. Nếu `invalidCoordinates > 0`, `throw new Error(...)` trước khi
gọi Tippecanoe; không tạo/ghi đè archive đích.

- [x] **Step 6: Chạy focused tests và lint file**

Run: `pnpm vitest run pipelines/poi/tests/display-priority.test.mjs pipelines/poi/tests/display-selector.test.mjs pipelines/poi/tests/export-tiles.test.mjs && pnpm exec biome check pipelines/poi/src/display-priority.mjs pipelines/poi/src/display-selector.mjs pipelines/poi/src/export-tiles.mjs pipelines/poi/tests/display-priority.test.mjs pipelines/poi/tests/display-selector.test.mjs pipelines/poi/tests/export-tiles.test.mjs`

Expected: PASS, không warning/error.

- [x] **Step 7: Commit Task 3**

```bash
git add pipelines/poi/src/export-tiles.mjs pipelines/poi/tests/export-tiles.test.mjs
git commit -m "feat(poi): xuất tile theo display priority và minzoom"
```

---

### Task 4: Style ba tầng icon/nhãn

**Files:**
- Modify: `packages/style/src/poi-layers.mjs:1-69`
- Modify: `packages/style/src/poi-layers.test.ts:25-70`

**Interfaces:**
- Consumes: tile properties `r/d/q` từ Task 3.
- Produces: layer IDs `poi`, `poi-label-major`, `poi-label-local`, đều source `poi`.

- [ ] **Step 1: Viết test đỏ cho ba layer và fallback**

```ts
const poiLayers = out.layers.filter((l: { source?: string }) => l.source === 'poi');
expect(poiLayers.map((l: { id: string }) => l.id)).toEqual([
  'poi', 'poi-label-major', 'poi-label-local',
]);
expect(poi.layout['icon-padding']).toBe(8);
expect(poi.layout['text-field']).toBeUndefined();
expect(poi.layout['symbol-sort-key']).toEqual([
  'coalesce', ['get', 'd'], ['-', 9, ['coalesce', ['get', 'q'], 0]],
]);
expect(major.minzoom).toBe(12);
expect(major.layout['text-padding']).toBe(4);
expect(local.minzoom).toBe(16);
```

Test thêm rằng cả ba layer đứng liền nhau ngay trước `sovereignty-label`, filter dùng
`['coalesce',['get','r'],5]`, và `validateStyleMin(filled(out))` trả `[]`.

- [ ] **Step 2: Chạy style test và xác nhận RED**

Run: `pnpm vitest run packages/style/src/poi-layers.test.ts`

Expected: FAIL vì hiện chỉ có layer `poi` ghép icon + text.

- [ ] **Step 3: Tách style thành icon và hai label**

Tạo các expression dùng chung:

```js
const rank = ['coalesce', ['get', 'r'], 5];
const sortKey = ['coalesce', ['get', 'd'], ['-', 9, ['coalesce', ['get', 'q'], 0]]];
```

`poi` giữ icon mapping hiện có, bỏ toàn bộ `text-*`, thêm padding/sort. Hai label dùng
`text-field:['get','name']`, font/size/offset/max-width và paint theme hiện có; major filter
`['<=', rank, 2]`, local filter `['>=', rank, 3]`.

- [ ] **Step 4: Chạy style test + build templates**

Run: `pnpm vitest run packages/style/src/poi-layers.test.ts && pnpm --filter @mapslibvn/core build && pnpm --filter @mapslibvn/style build`

Expected: test PASS; hai template build hợp lệ.

- [ ] **Step 5: Commit Task 4**

```bash
git add packages/style/src/poi-layers.mjs packages/style/src/poi-layers.test.ts
git commit -m "feat(style): phân tầng icon và nhãn POI"
```

---

### Task 5: Giữ tương thích `poiLayer`, ngôn ngữ và click trên SDK

**Files:**
- Modify: `packages/core/src/style-transform.ts:8-58`
- Modify: `packages/core/src/style-transform.test.ts:1-84`
- Modify: `packages/web/src/map.ts:89-103`
- Modify: `packages/web/src/map.test.ts:1-155`
- Modify: `packages/react-native/src/use-style.test.ts:10-58`

**Interfaces:**
- Consumes: ba layer source `poi` từ Task 4.
- Produces: `isPoiStyleLayer(layer): boolean`; `hidePoiLayer()` ẩn mọi layer POI; click vẫn dùng `POI_LAYER_ID`.

- [ ] **Step 1: Viết test Core đỏ cho ba layer**

Fixture Core phải có `poi`, `poi-label-major`, `poi-label-local` đều `source:'poi'`, cộng một layer
khác. Assert ba layout nhận `visibility:'none'`, layer khác giữ nguyên và input không bị mutate.

```ts
const poiLayers = [
  { id: 'poi', type: 'symbol', source: 'poi', layout: {} },
  { id: 'poi-label-major', type: 'symbol', source: 'poi', layout: { 'text-field': ['get', 'name'] } },
  { id: 'poi-label-local', type: 'symbol', source: 'poi', layout: { 'text-field': ['get', 'name'] } },
];
const out = hidePoiLayer({ layers: [...poiLayers, { id: 'city', type: 'symbol', source: 'vn' }] });
expect(out.layers.slice(0, 3).map((layer) => layer.layout?.visibility)).toEqual([
  'none', 'none', 'none',
]);
expect(out.layers[3]?.id).toBe('city');
```

- [ ] **Step 2: Chạy Core test và xác nhận RED**

Run: `pnpm vitest run packages/core/src/style-transform.test.ts`

Expected: FAIL vì helper hiện chỉ so ID `poi`.

- [ ] **Step 3: Implement nhận diện POI dùng chung**

```ts
export interface StyleLayerLike {
  id: string;
  type: string;
  source?: string | undefined;
  layout?: Record<string, unknown> | undefined;
}
export function isPoiStyleLayer(layer: StyleLayerLike): boolean {
  return layer.id === POI_LAYER_ID || layer.source === 'poi';
}
```

`hidePoiLayer()` gọi `isPoiStyleLayer`. `localizeStyle()` vẫn nhận ra hai text layer qua
`text-field` và không đổi `sovereignty-label`.

- [ ] **Step 4: Viết test Web đỏ cho `poiLayer=false`**

Fake map trả `getStyle().layers` gồm ba layer POI. Sau event `load`, assert
`setLayoutProperty(id,'visibility','none')` được gọi đúng ba ID. Test click vẫn assert
`queryRenderedFeatures(...,{layers:['poi']})` đúng một layer.

```ts
(m.gl.getStyle as ReturnType<typeof vi.fn>).mockReturnValue({ layers: [
  { id: 'poi', type: 'symbol', source: 'poi' },
  { id: 'poi-label-major', type: 'symbol', source: 'poi' },
  { id: 'poi-label-local', type: 'symbol', source: 'poi' },
] });
fire('load');
expect(m.gl.setLayoutProperty).toHaveBeenCalledTimes(3);
for (const id of ['poi', 'poi-label-major', 'poi-label-local']) {
  expect(m.gl.setLayoutProperty).toHaveBeenCalledWith(id, 'visibility', 'none');
}
```

- [ ] **Step 5: Implement Web ẩn theo source**

Trong load handler, khi `poiLayer===false`, đọc `gl.getStyle().layers ?? []`, lọc bằng
`isPoiStyleLayer`, kiểm `gl.getLayer(layer.id)` rồi set visibility. Không đổi click handler.

```ts
if (opts.poiLayer === false) {
  for (const layer of gl.getStyle().layers ?? []) {
    if (isPoiStyleLayer(layer) && gl.getLayer(layer.id)) {
      gl.setLayoutProperty(layer.id, 'visibility', 'none');
    }
  }
}
```

- [ ] **Step 6: Mở rộng fixture React Native**

Trong `use-style.test.ts`, đổi source của ba POI layer thành `'poi'`; assert `transformStyle` với
`lang:'en', poiLayer:false` vừa đổi text-field hai label vừa ẩn cả ba. Test `map.test.tsx` hiện có
phải tiếp tục xác nhận onPress chỉ query `['poi']`.

```ts
const transformed = transformStyle(styleJson, { lang: 'en', poiLayer: false });
expect(transformed.layers.filter((layer) => layer.source === 'poi'))
  .toHaveLength(3);
for (const layer of transformed.layers.filter((item) => item.source === 'poi')) {
  expect(layer.layout?.visibility).toBe('none');
}
expect(mapRefMock.queryRenderedFeatures).toHaveBeenCalledWith([10, 20], { layers: ['poi'] });
```

- [ ] **Step 7: Chạy SDK tests + build Core**

Run: `pnpm vitest run packages/core/src/style-transform.test.ts packages/web/src/map.test.ts packages/react-native/src/use-style.test.ts packages/react-native/src/map.test.tsx && pnpm --filter @mapslibvn/core build`

Expected: PASS; Core declaration export được `isPoiStyleLayer` qua `index.ts` hiện đã `export *`.

- [ ] **Step 8: Commit Task 5**

```bash
git add packages/core/src/style-transform.ts packages/core/src/style-transform.test.ts packages/web/src/map.ts packages/web/src/map.test.ts packages/react-native/src/use-style.test.ts
git commit -m "fix(sdk): ẩn đầy đủ các tầng POI"
```

---

### Task 6: API style và fixture tile end-to-end

**Files:**
- Modify: `apps/api/test/styles.test.ts:30-57`
- Modify: `pipelines/poi/tests/pipeline-fixture.dbtest.mjs:1-69`
- Modify: `apps/api/scripts/seed-local.mjs:1-28`

**Interfaces:**
- Consumes: templates build từ Task 4 và archive fixture từ Task 3.
- Produces: contract Worker ba layer; `MAPSLIBVN_POI_FIXTURE`, `MAPSLIBVN_POI_RELEASE` và
  `MAPSLIBVN_VN_RELEASE` để preview candidate mà không đổi production.

- [ ] **Step 1: Viết API test đỏ cho manifest có/không POI**

Khi manifest có POI, assert IDs source `poi` đúng `['poi','poi-label-major','poi-label-local']` và
layer `poi` minzoom 10. Khi manifest không có POI, assert không layer nào có `source==='poi'`.

```ts
const poiLayers = style.layers.filter((layer) => layer.source === 'poi');
expect(poiLayers.map((layer) => layer.id)).toEqual([
  'poi', 'poi-label-major', 'poi-label-local',
]);
expect(poiLayers.find((layer) => layer.id === 'poi')?.minzoom).toBe(10);
```

- [ ] **Step 2: Build dependencies rồi chạy API test**

Run: `pnpm --filter @mapslibvn/core build && pnpm --filter @mapslibvn/style build && pnpm --filter @mapslibvn/api test -- styles.test.ts`

Expected: PASS nếu API đã lọc theo source như hiện tại; nếu test lộ type fixture cũ thì chỉ sửa type
trong test, không đổi `renderStyle()` trừ khi thực sự còn sót layer.

- [ ] **Step 3: Mở rộng pipeline fixture test**

Sau exporter, đọc `MAPSLIBVN_WORK/poi.geojsonseq`, parse từng dòng và assert:

```js
expect(features.length).toBeGreaterThan(0);
for (const feature of features) {
  expect(feature.tippecanoe.minzoom).toBeGreaterThanOrEqual(10);
  expect(feature.tippecanoe.minzoom).toBeLessThanOrEqual(16);
  expect(feature.properties.r).toBeGreaterThanOrEqual(1);
  expect(feature.properties.r).toBeLessThanOrEqual(5);
  expect(Number.isInteger(feature.properties.d)).toBe(true);
  expect(feature.properties.popularity).toBeUndefined();
}
```

Nhóm feature theo `(z, globalCellKey(lon,lat,z,CELL_PX_BY_ZOOM[z]))` cho mọi z từ minzoom đến 16;
assert mỗi nhóm có đúng một phần tử. Assert số dòng GeoJSON nhỏ hơn số POI active; chọn một ID active
không có trong GeoJSON và query lại DB vẫn thấy đúng `status='active'` để chứng minh thinning không
sửa/xoá dữ liệu.

Decode tile chứa feature đầu tiên để khóa property trong PMTiles thật:

```js
const sample = features[0];
const z = sample.tippecanoe.minzoom;
const { x, y } = lonLatToTile(sample.geometry.coordinates[0], sample.geometry.coordinates[1], z);
const decoded = JSON.parse(execFileSync('tippecanoe-decode',
  [file, String(z), String(x), String(y)], { encoding: 'utf8' }));
const decodedFeatures = decoded.features.flatMap((item) =>
  item.type === 'FeatureCollection' ? item.features : [item]);
const actual = decodedFeatures.find((item) => item.properties?.id === sample.properties.id);
expect(actual.properties).toMatchObject({ r: sample.properties.r, d: sample.properties.d });
```

Giữ tests archive ≤20 MiB, zoom `[10,16]`, layer `poi`, QA.

- [ ] **Step 4: Thêm seed local tùy chọn, không đổi CI mặc định**

```js
const poiFixture = process.env.MAPSLIBVN_POI_FIXTURE;
const poiRelease = poiFixture ? 'poi-local-candidate' : (process.env.MAPSLIBVN_POI_RELEASE ?? null);
const vnRelease = process.env.MAPSLIBVN_VN_RELEASE ?? release;
if (poiFixture) {
  w(['r2', 'object', 'put', `mapslibvn-tiles/tiles/${poiRelease}.pmtiles`,
    '--file', resolve(poiFixture), '--local']);
}
// Chỉ upload q1.pmtiles khi MAPSLIBVN_VN_RELEASE vắng; manifest dùng { vn: vnRelease, poi: poiRelease }.
```

Nếu env có giá trị nhưng file không tồn tại, script phải throw trước khi ghi KV.

- [ ] **Step 5: Chạy fixture DB trong pipeline image**

Run: `pnpm --filter @mapslibvn/core build && pnpm --filter @mapslibvn/style build && pnpm test:db`

Expected: toàn bộ DB tests PASS; fixture sinh PMTiles và grid assertions xanh. Không dùng DB dev làm
oracle; harness phải dùng DB cô lập `mapslibvn_task8_test`.

- [ ] **Step 6: Commit Task 6**

```bash
git add apps/api/test/styles.test.ts apps/api/scripts/seed-local.mjs pipelines/poi/tests/pipeline-fixture.dbtest.mjs
git commit -m "test(poi): khóa contract tile và style tăng dần"
```

---

### Task 7: Tài liệu, visual acceptance local và full gate

**Files:**
- Modify: `pipelines/poi/README.md`
- Modify: `apps/docs/src/content/docs/tinh-nang.md:20-32`
- Modify: `apps/docs/src/content/docs/ban-do-web.md:155-166`
- Modify: `apps/docs/src/content/docs/react-native.md:88-96`
- Modify: `apps/docs/src/content/docs/nhung-thu.md:110-118`
- Modify: `docs/superpowers/plans/2026-08-27-m2-kho-poi-may-chu.md` (ghi chú lịch sử spec 5.8)
- Modify: `docs/DEVLOG.md:1-115` và bảng quyết định cuối file

**Interfaces:**
- Consumes: behavior đã test ở Tasks 1–6.
- Produces: hướng dẫn đúng hiện trạng và evidence matrix trước national release.

- [ ] **Step 1: Cập nhật docs contract và hành vi zoom**

README ghi đủ `q/r/d`, bảng rank→earliest zoom, bảng cellPx, log counters và lý do POI bị ẩn vẫn có
trong search. Bốn trang docs thay câu “nhãn POI từ zoom 13” bằng:

> Biểu tượng POI xuất hiện tăng dần từ zoom 10 theo độ quan trọng và mật độ. Nhãn địa danh lớn xuất
> hiện từ zoom 12; nhãn địa điểm địa phương từ zoom 16. POI không hiện trên nền vẫn tìm được qua
> Search/Nearby.

Trong plan M2 đã nghiệm thu, chỉ thêm một ghi chú ngay mục Task 9: luật `q` của spec 5.8 là bằng
chứng lịch sử và đã được thay thế bởi
`docs/superpowers/specs/2026-09-04-progressive-poi-display-design.md`; không đổi checkbox cũ.

- [ ] **Step 2: Ghi DEVLOG implementation evidence**

Thêm mục ngày 04/09/2026 mô tả contract, công thức, tests, số fixture trước/sau và ghi rõ national
release **chưa chạy**. Thêm quyết định “display priority không dùng quality làm tín hiệu chính”.

- [ ] **Step 3: Chạy full CI-equivalent gate**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @mapslibvn/docs e2e
git diff --check
```

Expected: tất cả exit 0; ghi số test/build pages thật vào DEVLOG trước commit.

- [ ] **Step 4: Khởi động preview với POI fixture**

Tạo fixture vào named volume, bật service pipeline đủ lâu để copy archive ra host, rồi chạy E2E:

```bash
pnpm db:fixture
docker compose --env-file .env -f infra/dev/compose.yml --profile pipeline up -d pipeline
docker compose --env-file .env -f infra/dev/compose.yml cp pipeline:/app/out/poi-fixture.pmtiles out/poi-fixture.pmtiles
MAPSLIBVN_POI_FIXTURE=../../out/poi-fixture.pmtiles pnpm --filter @mapslibvn/docs e2e
```

Sau đó chạy API/docs preview với cùng env và dùng browser thật mở playground ở light/dark.

- [ ] **Step 5: Thu visual matrix**

Chụp viewport 1000×800 ở TP.HCM fixture tại z10, z12, z14, z15, z16 cho light và dark. Ghi vào
DEVLOG: số icon/nhãn quan sát, POI rank 1–2 còn hiện khi zoom, local label chỉ ở z16, không có dải
icon tại biên tile, click trả đúng `id/name/cat/grp`, `poi=0` ẩn cả icon/nhãn, `lang=en` không lỗi.
Không biến số icon thành golden test vì collision còn phụ thuộc nhãn nền.

- [ ] **Step 6: Commit docs và acceptance local**

```bash
git add pipelines/poi/README.md apps/docs/src/content/docs/tinh-nang.md apps/docs/src/content/docs/ban-do-web.md apps/docs/src/content/docs/react-native.md apps/docs/src/content/docs/nhung-thu.md docs/superpowers/plans/2026-08-27-m2-kho-poi-may-chu.md docs/DEVLOG.md
git commit -m "docs: ghi nhận hiển thị POI tăng dần"
```

- [ ] **Step 7: Dừng ở cổng national release**

Báo commit list, full gate, fixture tile size và visual matrix cho PHONG. Không upload R2, không sửa
manifest và không push nếu người dùng chưa yêu cầu push/release trong turn thực thi.

---

### Task 8: National candidate và production release sau phê duyệt riêng

**Files:**
- Modify: `docs/DEVLOG.md`
- Runtime only: Docker server volume, R2 immutable archive, KV `release:current`

**Interfaces:**
- Consumes: code đã push, CI/image xanh, production DB read-only cho exporter.
- Produces: archive `poi-20260904` mới và manifest production có rollback history.

- [ ] **Step 1: Xác nhận quyền release và trạng thái an toàn**

Chỉ tiếp tục khi PHONG nói rõ chạy national build/publish. Chạy `df -h /`, `docker info`,
`git status --short`, `git rev-parse HEAD`, và kiểm CI/image của đúng commit đã xanh.

- [ ] **Step 2: Push code, chờ CI/image rồi nạp image mới vào server**

Run `git push origin main`; chờ CI, DB tests, API tests và image workflow của đúng SHA đều xanh,
sau đó chạy `pnpm server:update`.

Expected: pipeline container dùng image chứa commit progressive POI; Postgres vẫn healthy. Không
in nội dung `infra/server/.env`.

- [ ] **Step 3: Build candidate từ production DB nhưng chưa upload**

Run trong service pipeline:

```bash
docker compose --env-file infra/server/.env -f infra/server/compose.yml exec -T pipeline \
  node pipelines/poi/src/export-tiles.mjs --release poi-20260904
```

Expected: invalidCoordinates 0, log đủ selected/thinned/byMinZoom, archive ≤300 MiB. Nếu immutable
key `poi-20260904` đã tồn tại trên R2 thì dừng và sửa plan/DEVLOG sang ngày hiện tại trước khi build;
không ghi đè object. Không dùng `data:update --poi --force` vì lệnh đó tự upload và đổi manifest
trước visual gate.

- [ ] **Step 4: QA rồi upload immutable candidate, chưa đổi manifest**

Chạy từ host qua service pipeline:

```bash
docker compose --env-file infra/server/.env -f infra/server/compose.yml exec -T pipeline \
  node pipelines/tiles/src/qa.mjs /app/out/poi-20260904.pmtiles --skip-islands
docker compose --env-file infra/server/.env -f infra/server/compose.yml exec -T pipeline \
  node pipelines/tiles/src/upload.mjs poi-20260904
docker compose --env-file infra/server/.env -f infra/server/compose.yml exec -T pipeline \
  node pipelines/tiles/src/smoke.mjs poi-20260904 --set poi
```

Expected: QA xanh, 20-point smoke có ít nhất 15 tile dữ liệu. Upload chỉ tạo object immutable;
manifest chưa đổi nên client production chưa bị ảnh hưởng.

- [ ] **Step 5: Visual smoke national qua Worker local**

Đọc `current.vn` bằng `manifest.mjs get` mà không in credentials. Seed KV local bằng
`MAPSLIBVN_VN_RELEASE` và `MAPSLIBVN_POI_RELEASE=poi-20260904`, rồi chạy Worker local với
`TILES_BASE=https://tiles.ai-solutions.io.vn`; như vậy cả nền quốc gia và candidate POI được đọc từ
R2 nhưng production manifest chưa đổi. Chụp đủ 4 địa bàn × 5 zoom × 2 theme như spec. So với
production cũ; nếu dày/thưa bất thường, dừng và tuning, không set manifest.

```bash
cd apps/api
MAPSLIBVN_VN_RELEASE=vn-20260827 MAPSLIBVN_POI_RELEASE=poi-20260904 \
  node scripts/seed-local.mjs
pnpm exec wrangler dev --port 8787 --var TILES_BASE:https://tiles.ai-solutions.io.vn --var ENVIRONMENT:test
```

Trước khi chạy, thay `vn-20260827` trong command bằng đúng `current.vn` vừa đọc nếu production đã
đổi. Đây là giá trị runtime lấy từ manifest, không đoán từ DEVLOG.

- [ ] **Step 6: Đổi manifest và verify production**

Run từ host:

```bash
docker compose --env-file infra/server/.env -f infra/server/compose.yml exec -T pipeline \
  node pipelines/tiles/src/manifest.mjs set --poi poi-20260904
```

Verify `GET /v1/styles/light.json`, `dark.json`, PMTiles range requests, playground light/dark,
`poiClick`, `poi=0`, và các viewport production. Nếu bất kỳ check nào lỗi, chạy ngay
`docker compose --env-file infra/server/.env -f infra/server/compose.yml exec -T pipeline node pipelines/tiles/src/manifest.mjs rollback`, rồi verify style/playground lại.

- [ ] **Step 7: Ghi bằng chứng release, commit và push**

DEVLOG ghi release ID, activeRead/selected/thinned/byMinZoom, dung lượng, smoke, visual matrix,
manifest trước/sau và kết quả rollback drill logic. Chạy `git diff --check`, commit:

```bash
git add docs/DEVLOG.md
git commit -m "docs: nghiệm thu phát hành POI tăng dần"
git push origin main
```

Expected: remote main chứa code + bằng chứng; giữ archive cũ trên R2 để rollback.
