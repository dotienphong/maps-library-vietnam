# Bậc nhanh cho /v1/autocomplete — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đưa độ trễ cache-miss của `/v1/autocomplete` từ p50 996 ms / p95 3.249 ms xuống khoảng 300–500 ms, không giảm hit@3 (baseline 38/40).

**Architecture:** Thêm một **bậc nhanh** cho nhánh POI: lọc bằng `name_tsv @@ to_tsquery('simple', 'tok:* & …')` (khớp tiền tố **theo từ**, đúng ngữ nghĩa mà `<%` đang lo), cắt 200 dòng phổ biến nhất, **rồi mới** tính `sim`. Các nhánh trigram hiện tại chỉ chạy khi bậc nhanh không đủ `limit` kết quả — tức khi người dùng gõ sai chính tả. Toàn bộ sau cờ `AUTOCOMPLETE_FAST`, mặc định TẮT.

**Tech Stack:** Hono trên Cloudflare Workers, postgres.js qua Hyperdrive, PostgreSQL 16 + pg_trgm + tsvector, vitest (+ vitest-pool-workers), Biome.

**Vì sao hình dạng này, không phải hình dạng khác:** đo trên production 18/09/2026 (`docs/evidence/perf/2026-09-18-autocomplete-cold.md`, vòng 3–4). Chi phí nằm ở việc tính 4 hàm trigram cho **mọi** dòng qua được WHERE, vì `sim` nằm trong `ORDER BY`; không nằm ở việc quét chỉ số (149 ms) hay đọc đĩa (0 lần đọc). Bậc nhanh của `qu` vẫn quét 29.107 dòng y như câu cũ nhưng chỉ tốn 183 ms, vì nó cắt 200 dòng trước khi tính `sim`.

**Không cần migration, không cần chỉ số mới.** Chỉ số `poi_name_tsv_idx` đã có từ migration 0009.

**Cảnh báo thiết kế đã loại:** tiền tố thuần `name_norm LIKE 'q%'` nhanh hơn nữa (16–117 ms) nhưng **sai ngữ nghĩa với tên tiếng Việt** — `ben thanh` không khớp "Chợ Bến Thành" vì tên đó bắt đầu bằng "cho". Không dùng.

**Rủi ro chính phải đo, không được suy luận:** cắt 200 dòng theo `coalesce(popularity, 0)` có thể bỏ sót POI đúng nhưng ít phổ biến, và `popularity` là `real` NULL-able nên nhiều dòng hoà 0 → thứ tự trong nhóm hoà là tuỳ ý. Task 6 là cổng nghiệm thu: hit@3 phải ≥ 38/40.

**Số đo production làm mốc (18/09, ngưỡng phiên 0,6):**

| q | `full` hiện tại | bậc nhanh | street | area | bậc 3 |
|---|---:|---:|---:|---:|---:|
| `qu` | 1.361 ms | 183 ms | 272 ms | 340 ms | 247 ms |
| `cafe` | 1.905 ms | 119 ms | 185 ms | 1 ms | 432 ms |
| `ben thanh` | 3.684 ms | 34 ms | 325 ms | 1 ms | 52 ms |

Sau khi sửa, nhánh chậm nhất trên đường nhanh là `street`/`area`/bậc 3 (≈ 340–432 ms), nên đích thực tế là **~450 ms tổng**, không phải 150 ms. Siết tiếp `street` và bậc 3 để lui về ~250 ms là việc của plan sau.

---

## File Structure

- **Modify** `apps/api/src/autocomplete-sql.ts` — thêm `poiFastCandidates()` và cổng trong `collectCandidates()`. File lên ~390 dòng.

  *Vì sao KHÔNG tách file riêng như `area-candidates.ts`:* câu bậc nhanh cần dùng lại `poiSecondary` (biểu thức dòng phụ) — nếu chép sang file khác thì cùng một POI sẽ hiện dòng phụ khác nhau tuỳ đường nào phục vụ, và hai bản sẽ lệch nhau lúc nào không biết. Còn nếu file mới `import { poiSecondary }` từ `autocomplete-sql.ts` trong khi `collectCandidates` gọi ngược lại thì thành **vòng lặp import runtime**. `area-candidates.ts` không vướng vì nó chỉ `import type` (bị xoá lúc build) và tự dựng câu riêng. Ở đây chia sẻ giá trị thật nên để chung file là đúng.

- **Modify** `apps/api/test/autocomplete-sql.test.ts` — test câu bậc nhanh và cổng, bằng `fakeSql`.
- **Modify** `apps/api/src/stages.ts` — thêm `tsQueryAnyToken()` và `fastGateFor()`.
- **Modify** `apps/api/src/env.ts` — khai báo cờ `AUTOCOMPLETE_FAST`.
- **Modify** `apps/api/src/routes/autocomplete.ts` — truyền cờ + `limit` xuống `collectCandidates`.
- **Modify** `apps/api/test/stages.test.ts` — test `tsQueryAnyToken()` và `fastGateFor()`.
- **Modify** `scripts/api-db-test.mjs` + `apps/api/test-db/places.itest.mjs` — hai ca chạy trên Postgres thật.

  `apps/api/test/autocomplete.test.ts` **không** đổi: tầng đó chạy `vitest-pool-workers` với DB đóng, nên nó là phép thử hồi quy "cờ tắt thì không có gì đổi", và giá trị của nó nằm ở chỗ giữ nguyên.
- **Modify** `apps/api/wrangler.toml` — ghi chú cờ (KHÔNG bật).

---

### Task 1: `tsQueryAnyToken` — tsquery cho cả truy vấn một token

`tsQueryFor` hiện trả `null` khi dưới 2 token, lý do ghi trong JSDoc là "một token thì bậc 1 đã lo xong". Điều đó đúng khi bậc 1 rẻ; nay bậc 1 chính là thứ tốn 1,3–3,7 s, nên bậc nhanh phải phục vụ được `cafe` và `qu`.

**Files:**
- Modify: `apps/api/src/stages.ts`
- Test: `apps/api/test/stages.test.ts`

- [ ] **Step 1: Viết test đỏ**

Thêm vào `apps/api/test/stages.test.ts`:

```ts
import { tsQueryAnyToken } from '../src/stages';

describe('tsQueryAnyToken', () => {
  it('nhận truy vấn MỘT token, khác tsQueryFor', () => {
    expect(tsQueryAnyToken('cafe')).toBe('cafe:*');
    expect(tsQueryFor('cafe')).toBeNull();
  });

  it('nhiều token nối bằng AND, mọi token là tiền tố', () => {
    expect(tsQueryAnyToken('ben thanh')).toBe('ben:* & thanh:*');
  });

  it('bỏ token 1 ký tự nhưng GIỮ token toàn số', () => {
    expect(tsQueryAnyToken('a cafe')).toBe('cafe:*');
    expect(tsQueryAnyToken('88/9 nguyen')).toBe('88:* & 9:* & nguyen:*');
  });

  it('không còn token nào thì trả null', () => {
    expect(tsQueryAnyToken('a')).toBeNull();
    expect(tsQueryAnyToken('')).toBeNull();
  });
});
```

- [ ] **Step 2: Chạy để chắc chắn nó ĐỎ**

Run: `npx vitest run --config apps/api/vitest.config.ts apps/api/test/stages.test.ts`
Expected: FAIL — `tsQueryAnyToken is not a function`.

- [ ] **Step 3: Cài đặt**

Trong `apps/api/src/stages.ts`, thay thân `tsQueryFor` bằng phiên bản dùng chung bộ tách token:

```ts
/**
 * Token của truy vấn đã `normalizeVi`: chỉ còn `a-z0-9/-` và khoảng trắng, nên tách trên mọi ký tự
 * không phải chữ-số là đủ để không ký tự cú pháp nào của tsquery lọt vào. Token 1 ký tự bị bỏ vì
 * `x:*` khớp gần như mọi tên — trừ token TOÀN SỐ: `9` trong `88/9` là số nhà thật.
 */
function tokensOf(queryNorm: string): string[] {
  return queryNorm
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((t) => t.length >= 2 || /^\d+$/.test(t));
}

export function tsQueryFor(queryNorm: string): string | null {
  const tokens = tokensOf(queryNorm);
  if (tokens.length < 2) return null;
  return tokens.map((t) => `${t}:*`).join(' & ');
}

/**
 * Như `tsQueryFor` nhưng nhận CẢ truy vấn một token — dùng cho bậc nhanh (spec bậc nhanh 18/09).
 *
 * `tsQueryFor` bỏ truy vấn một token vì "bậc 1 đã lo xong"; đúng với bậc 2 (chạy song song, chỉ để
 * thêm recall), sai với bậc nhanh (chạy THAY bậc 1). Đo production 18/09: `cafe:*` cho 119 ms so
 * với 1.905 ms của bậc 1.
 */
export function tsQueryAnyToken(queryNorm: string): string | null {
  const tokens = tokensOf(queryNorm);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `${t}:*`).join(' & ');
}
```

- [ ] **Step 4: Chạy lại, phải XANH**

Run: `npx vitest run --config apps/api/vitest.config.ts apps/api/test/stages.test.ts`
Expected: PASS, và các test cũ của `tsQueryFor` vẫn xanh.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/stages.ts apps/api/test/stages.test.ts
git commit -m "feat(api): tsQueryAnyToken cho bậc nhanh autocomplete"
```

---

### Task 2: `poiFastCandidates` — câu của bậc nhanh

**Files:**
- Modify: `apps/api/src/autocomplete-sql.ts`
- Test: `apps/api/test/autocomplete-sql.test.ts`

- [ ] **Step 1: Viết test đỏ**

Thêm vào `apps/api/test/autocomplete-sql.test.ts` (file đã có sẵn `input` 16 ký tự và `fakeSql`; thêm một input riêng vì bậc nhanh cần `near`):

```ts
import { FAST_CANDIDATE_POOL, poiFastCandidates } from '../src/autocomplete-sql';

const fastInput: CandidateQueryInput = {
  queryNorm: 'ben thanh',
  queryCore: 'ben thanh',
  prefixPattern: 'ben thanh%',
  near: { lat: 10.776, lng: 106.7 },
  parsed: { alleyChain: [], confidence: 0 },
  sources: ['osm', 'fsq'],
  queryAlias: 'ben thanh',
  tsQuery: 'ben:* & thanh:*',
  queryKey: 'benthan',
};

describe('poiFastCandidates', () => {
  const input = fastInput;
  /**
   * Mấu chốt của cả bậc nhanh: CẮT trước, tính `sim` sau. Nếu `sim` lọt vào ORDER BY của bước
   * quét thì Postgres tính 4 hàm trigram cho mọi dòng khớp (18.269–29.107 dòng đo trên production)
   * và bậc nhanh không còn nhanh. Test này khoá đúng thứ tự đó.
   */
  it('cắt theo popularity TRƯỚC rồi mới tính sim', async () => {
    const { sql, calls } = fakeSql([]);
    await poiFastCandidates(sql, input, 'ben:* & thanh:*');
    const text = calls[0]?.text ?? '';
    const viTriCat = text.indexOf('LIMIT $');
    expect(viTriCat).toBeGreaterThan(-1);
    expect(text.indexOf('ORDER BY coalesce(popularity, 0) DESC')).toBeLessThan(viTriCat);
    expect(text.indexOf('word_similarity')).toBeGreaterThan(viTriCat);
  });

  it('lọc bằng name_tsv, không dùng toán tử trigram trong WHERE', async () => {
    const { sql, calls } = fakeSql([]);
    await poiFastCandidates(sql, input, 'ben:* & thanh:*');
    const text = calls[0]?.text ?? '';
    expect(text).toContain("name_tsv @@ to_tsquery('simple', $");
    const where = text.slice(text.indexOf('WHERE'), text.indexOf('ORDER BY'));
    expect(where).not.toContain('<%');
    expect(where).not.toContain('LIKE');
  });

  it('giữ nguyên bộ lọc trạng thái và nguồn như bậc 1', async () => {
    const { sql, calls } = fakeSql([]);
    await poiFastCandidates(sql, input, 'ben:* & thanh:*');
    const text = calls[0]?.text ?? '';
    expect(text).toContain("status = 'active'");
    expect(text).toContain('p.primary_source = ANY(');
    expect(text).toContain("p.created_by = 'user'");
  });

  it('gửi tsQuery và kích thước bể ứng viên làm tham số', async () => {
    const { sql, calls } = fakeSql([]);
    await poiFastCandidates(sql, input, 'ben:* & thanh:*');
    expect(calls[0]?.params).toContain('ben:* & thanh:*');
    expect(calls[0]?.params).toContain(FAST_CANDIDATE_POOL);
  });

  it('không có near thì d là NULL, không gọi ST_DistanceSphere', async () => {
    const { sql, calls } = fakeSql([]);
    await poiFastCandidates(sql, { ...input, near: null }, 'ben:*');
    expect(calls[0]?.text).toContain('NULL::float8 AS d');
    expect(calls[0]?.text).not.toContain('ST_DistanceSphere');
  });
});
```

- [ ] **Step 2: Chạy để chắc chắn nó ĐỎ**

Run: `npx vitest run --config apps/api/vitest.config.ts apps/api/test/autocomplete-sql.test.ts`
Expected: FAIL — `poiFastCandidates is not a function`.

- [ ] **Step 3: Cài đặt**

Thêm vào `apps/api/src/autocomplete-sql.ts`, ngay sau `poiCandidates()`:

```ts
/**
 * Số ứng viên lấy ra trước khi tính `sim`.
 *
 * 200 chứ không phải `limit`: `sim` mới là thứ quyết định thứ hạng cuối, nên cắt đúng 20 theo
 * `popularity` sẽ vứt mất POI khớp tốt mà ít phổ biến. 200 đủ rộng để xếp hạng còn nghĩa, đủ hẹp
 * để 4 hàm trigram chạy trên nó là miễn phí (đo production 18/09: 34–183 ms trọn câu, so với
 * 1.361–3.684 ms khi tính `sim` cho toàn bộ dòng khớp).
 */
export const FAST_CANDIDATE_POOL = 200;

/**
 * Bậc nhanh (18/09/2026): khớp **tiền tố theo TỪ** bằng `name_tsv`, cắt bể ứng viên theo
 * `popularity`, rồi mới tính `sim` trên bể đó.
 *
 * Vì sao `name_tsv` chứ không phải `name_norm LIKE 'q%'`: tên POI tiếng Việt hầu hết mở đầu bằng
 * từ loại (Chợ, Trường, Bệnh viện, Quán), nên khớp tiền tố của CẢ CHUỖI là hỏng recall —
 * `ben thanh` sẽ không tìm ra "Chợ Bến Thành". `to_tsquery('simple','ben:* & thanh:*')` khớp mọi
 * tên có một từ bắt đầu bằng `ben` VÀ một từ bắt đầu bằng `thanh`, không kể vị trí, đúng cái
 * `<%` đang lo mà không phải tính trigram lúc quét.
 *
 * KHÔNG trả `matched_alt`: nó cần `unnest` hai mảng song song, và bậc nhanh không khớp theo
 * `name_alt_norm` nên không có tên thay thế nào để khoe. Đường dự phòng vẫn trả như cũ.
 */
export function poiFastCandidates(sql: Sql, input: CandidateQueryInput, tsQuery: string) {
  const { queryNorm, near, sources } = input;
  const point = near ? sql`ST_SetSRID(ST_MakePoint(${near.lng}, ${near.lat}), 4326)` : null;
  const distance = point ? sql`ST_DistanceSphere(geom, ${point})` : sql`NULL::float8`;
  return sql<CandidateRow[]>`
    WITH ung_vien AS (
      SELECT id, name, street, admin_ward, ward, admin_province, province, geom,
             name_norm, name_alt_norm, popularity
      FROM poi p
      WHERE status = 'active'
        AND ${poiSourceFilter(sql, sources)}
        AND name_tsv @@ to_tsquery('simple', ${tsQuery})
      ORDER BY coalesce(popularity, 0) DESC
      LIMIT ${FAST_CANDIDATE_POOL}
    )
    SELECT 'poi' AS type, id, name,
      ${poiSecondary(sql)},
      ST_Y(geom) AS lat, ST_X(geom) AS lng, NULL AS precision,
      greatest(
        word_similarity(${queryNorm}, name_norm),
        similarity(name_norm, ${queryNorm}),
        word_similarity(${queryNorm}, coalesce(name_alt_norm, ''))
      ) AS sim,
      starts_with(name_norm, ${queryNorm}) AS prefix,
      coalesce(popularity, 0) AS pop,
      ${distance} AS d,
      NULL AS matched_alt
    FROM ung_vien
    ORDER BY sim DESC, pop DESC
    LIMIT 20`;
}
```

- [ ] **Step 4: Chạy lại, phải XANH**

Run: `npx vitest run --config apps/api/vitest.config.ts apps/api/test/autocomplete-sql.test.ts`
Expected: PASS (5 test mới, và mọi test cũ vẫn xanh).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/autocomplete-sql.ts apps/api/test/autocomplete-sql.test.ts
git commit -m "feat(api): câu bậc nhanh autocomplete theo name_tsv + cắt popularity"
```

---

### Task 3: Cổng trong `collectCandidates`

**Files:**
- Modify: `apps/api/src/autocomplete-sql.ts` (hàm `collectCandidates`)
- Test: `apps/api/test/autocomplete-sql.test.ts`

- [ ] **Step 1: Viết test đỏ**

Thêm vào `apps/api/test/autocomplete-sql.test.ts`:

```ts
describe('collectCandidates — cổng bậc nhanh', () => {
  const fastRow = (i: number) => ({
    type: 'poi', id: `p${i}`, name: `POI ${i}`, secondary: '', lat: 10, lng: 106,
    precision: null, sim: 0.9, prefix: true, pop: 1, d: null,
  });

  it('bậc nhanh đủ limit thì KHÔNG chạy nhánh trigram nào', async () => {
    const { sql, calls } = fakeSql((query) =>
      query.text.includes('name_tsv @@') ? Array.from({ length: 10 }, (_, i) => fastRow(i)) : [],
    );
    const rows = await collectCandidates(sql, input, new Set(['poi']), {
      tsQuery: 'coffee:* & highlands:*',
      limit: 10,
    });
    expect(rows).toHaveLength(10);
    expect(calls.filter((c) => c.text.includes('<%'))).toHaveLength(0);
    expect(calls.filter((c) => c.text.includes('name_tsv @@'))).toHaveLength(1);
  });

  it('bậc nhanh thiếu limit thì chạy tiếp đường cũ', async () => {
    const { sql, calls } = fakeSql((query) =>
      query.text.includes('name_tsv @@') ? [fastRow(0)] : [],
    );
    await collectCandidates(sql, input, new Set(['poi']), {
      tsQuery: 'coffee:* & highlands:*',
      limit: 10,
    });
    expect(calls.filter((c) => c.text.includes('<%')).length).toBeGreaterThan(0);
  });

  /**
   * Bậc nhanh CHỈ thay nhánh POI. Trả sớm chỉ với dòng POI là làm biến mất street/area khỏi kết
   * quả — `types=area` sẽ trả rỗng. Đây là lỗi bắt được lúc soát plan trước khi thực hiện.
   */
  it('đi đường nhanh vẫn chạy street và area', async () => {
    const { sql, calls } = fakeSql((query) =>
      query.text.includes('name_tsv @@') ? Array.from({ length: 10 }, (_, i) => fastRow(i)) : [],
    );
    await collectCandidates(sql, input, new Set(['poi', 'street', 'area']), {
      tsQuery: 'coffee:* & highlands:*',
      limit: 10,
    });
    expect(calls.filter((c) => c.text.includes("'street' AS type")).length).toBe(1);
    expect(calls.filter((c) => c.text.includes('admin_alias')).length).toBeGreaterThan(0);
  });

  it('đi đường nhanh thì KHÔNG chạy bậc 2 và bậc 3', async () => {
    const { sql, calls } = fakeSql((query) =>
      query.text.includes('name_tsv @@ to_tsquery') && !query.text.includes('name_tsv @@ to_tsquery($2')
        ? Array.from({ length: 10 }, (_, i) => fastRow(i))
        : [],
    );
    await collectCandidates(
      sql,
      { ...input, tsQuery: 'coffee:* & highlands:*', queryKey: 'coffeehighland' },
      new Set(['poi']),
      { tsQuery: 'coffee:* & highlands:*', limit: 10 },
    );
    // Bậc 3 là nhánh duy nhất đụng `name_key`; bậc 2 đụng `name_tsv` nhưng đi cùng `word_similarity`
    // trên name_norm — cách phân biệt chắc chắn là không có truy vấn nào chạm name_key.
    expect(calls.filter((c) => c.text.includes('name_key'))).toHaveLength(0);
  });

  it('không truyền cổng thì hành vi y như trước', async () => {
    const { sql, calls } = fakeSql([]);
    await collectCandidates(sql, input, new Set(['poi']));
    expect(calls.filter((c) => c.text.includes('name_tsv @@ to_tsquery'))).toHaveLength(0);
    expect(calls.filter((c) => c.text.includes('<%')).length).toBeGreaterThan(0);
  });

  it('tsQuery null (truy vấn không còn token) thì bỏ qua bậc nhanh', async () => {
    const { sql, calls } = fakeSql([]);
    await collectCandidates(sql, input, new Set(['poi']), { tsQuery: null, limit: 10 });
    expect(calls.filter((c) => c.text.includes('name_tsv @@ to_tsquery'))).toHaveLength(0);
  });

  it('dòng bậc nhanh mang stage 1 nên không bị STAGE_PENALTY', async () => {
    const { sql } = fakeSql((query) =>
      query.text.includes('name_tsv @@') ? Array.from({ length: 10 }, (_, i) => fastRow(i)) : [],
    );
    const rows = await collectCandidates(sql, input, new Set(['poi']), {
      tsQuery: 'coffee:* & highlands:*',
      limit: 10,
    });
    expect(rows.every((row) => row.stage === 1)).toBe(true);
  });
});
```

- [ ] **Step 2: Chạy để chắc chắn nó ĐỎ**

Run: `npx vitest run --config apps/api/vitest.config.ts apps/api/test/autocomplete-sql.test.ts`
Expected: FAIL — `collectCandidates` chưa nhận tham số thứ tư.

- [ ] **Step 3: Cài đặt**

Trong `apps/api/src/autocomplete-sql.ts`, đổi chữ ký `collectCandidates` (không cần import gì thêm — `poiFastCandidates` nằm cùng file):

```ts
/**
 * Cổng bậc nhanh (18/09/2026). Vắng = hành vi trước bậc nhanh, dùng cho test cũ và khi cờ tắt.
 */
export interface FastGate {
  /** `tsQueryAnyToken(queryNorm)`; null = truy vấn không còn token nào dùng được. */
  tsQuery: string | null;
  /** `limit` của request. Bậc nhanh đủ ngần này dòng thì các nhánh trigram KHÔNG chạy. */
  limit: number;
}

export async function collectCandidates(
  sql: Sql,
  input: CandidateQueryInput,
  types: Set<ItemType>,
  fast?: FastGate,
): Promise<CandidateRow[]> {
  const jobs: { stage: 1 | 2 | 3; rows: Promise<CandidateRow[]> }[] = [];
  const add = (stage: 1 | 2 | 3, rows: Promise<CandidateRow[]>) => jobs.push({ stage, rows });

  // Bắn các loại KHÔNG phải poi TRƯỚC: chúng chạy y như nhau dù đi đường nào, nên không việc gì
  // phải chờ bậc nhanh trả lời rồi mới bắt đầu. Bậc nhanh CHỈ thay nhánh poi.
  if (types.has('street')) add(1, streetCandidates(sql, input));
  if (types.has('area')) add(1, areaCandidates(sql, input));
  const { housenumber, streetNorm } = input.parsed;
  if (types.has('address') && housenumber && streetNorm) {
    add(1, addressCandidates(sql, input, housenumber, streetNorm));
  }

  // Bậc nhanh phải CHỜ xong mới biết có cần các nhánh trigram không. Không bắn song song rồi bỏ:
  // chi phí nằm ở CPU của origin tính trigram, không ở thời gian chờ của Worker (đo 18/09).
  let fastRows: CandidateRow[] | null = null;
  if (fast?.tsQuery && types.has('poi')) {
    const rows = await poiFastCandidates(sql, input, fast.tsQuery);
    if (rows.length >= fast.limit) fastRows = rows;
  }

  if (fastRows) add(1, Promise.resolve(fastRows));
  else if (types.has('poi')) add(1, poiCandidates(sql, input));

  // Bậc 2/3 chỉ để thêm recall khi bậc 1 yếu. Đường nhanh đã đủ `limit` kết quả khớp theo từ thì
  // chúng chỉ là chi phí — bậc 3 đo được 247–432 ms với truy vấn ngắn.
  if (!fastRows) {
    for (const stage of planStages({ tsQuery: input.tsQuery, queryKey: input.queryKey })) {
      if (types.has('poi')) {
        add(stage, stage === 2 ? poiTokenCandidates(sql, input) : poiKeyCandidates(sql, input));
      }
      if (types.has('street')) {
        add(stage, stage === 2 ? streetTokenCandidates(sql, input) : streetKeyCandidates(sql, input));
      }
    }
  }

  // … phần dedup cũ (từ `const settled = await Promise.all(...)`) giữ NGUYÊN …
```

Thay đổi so với bản cũ: khối `add(...)` của street/area/address **chuyển lên trước** nhánh poi, nhánh poi thành nhánh rẽ hai đường, và vòng `planStages` được bọc trong `if (!fastRows)`. Phần dedup từ `const settled` trở xuống không đổi một dòng.

Thứ tự `jobs` đổi (street/area trước poi) **không ảnh hưởng dedup**: khoá dedup có tiền tố `type` nên `poi:` và `street:` không bao giờ đụng nhau, còn thứ tự trong cùng một type thì giữ nguyên. Route vẫn sắp xếp lại theo `score` sau đó.

- [ ] **Step 4: Chạy lại, phải XANH**

Run: `npx vitest run --config apps/api/vitest.config.ts apps/api/test/autocomplete-sql.test.ts`
Expected: PASS, gồm cả các test cũ.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/autocomplete-sql.ts apps/api/test/autocomplete-sql.test.ts
git commit -m "feat(api): cổng bậc nhanh trong collectCandidates"
```

---

### Task 4: Cờ `AUTOCOMPLETE_FAST` và nối vào route

**Files:**
- Modify: `apps/api/src/env.ts:50`
- Modify: `apps/api/src/routes/autocomplete.ts:11,86`
- Modify: `apps/api/wrangler.toml:22`
- Test: `apps/api/test/autocomplete.test.ts`

**Vì sao không test ở `apps/api/test/autocomplete.test.ts`:** tầng đó chạy trên `vitest-pool-workers` với `SELF.fetch` và **không có Postgres** — nó quan sát được HTTP, không quan sát được SQL. Nên quyết định "có bật cổng không" phải nằm trong một **hàm thuần** kiểm được, còn route chỉ gọi. Cùng khuôn với `telexFallback` trong `stages.ts`, và JSDoc của hàm đó nói thẳng lý do: route test chạy với DB đóng nên quyết định phải kiểm được ở nơi khác.

- [ ] **Step 1: Viết test đỏ**

Thêm vào `apps/api/test/stages.test.ts`:

```ts
import { fastGateFor } from '../src/stages';

describe('fastGateFor', () => {
  it('cờ khác "1" → undefined, tức giữ nguyên hành vi cũ', () => {
    expect(fastGateFor({ enabled: false, queryNorm: 'ben thanh', limit: 10 })).toBeUndefined();
  });

  it('cờ bật → cổng mang tsquery mọi-token và limit của request', () => {
    expect(fastGateFor({ enabled: true, queryNorm: 'ben thanh', limit: 7 })).toEqual({
      tsQuery: 'ben:* & thanh:*',
      limit: 7,
    });
  });

  it('truy vấn một token vẫn có cổng', () => {
    expect(fastGateFor({ enabled: true, queryNorm: 'cafe', limit: 10 })).toEqual({
      tsQuery: 'cafe:*',
      limit: 10,
    });
  });

  it('không còn token nào → tsQuery null, collectCandidates sẽ bỏ qua bậc nhanh', () => {
    expect(fastGateFor({ enabled: true, queryNorm: 'a', limit: 10 })).toEqual({
      tsQuery: null,
      limit: 10,
    });
  });
});
```

- [ ] **Step 2: Chạy để chắc chắn nó ĐỎ**

Run: `npx vitest run --config apps/api/vitest.config.ts apps/api/test/stages.test.ts`
Expected: FAIL — `fastGateFor is not a function`.

- [ ] **Step 3: Cài đặt**

`apps/api/src/env.ts`, ngay dưới `AUTOCOMPLETE_TELEX`:

```ts
  /**
   * '1' = bật bậc nhanh (name_tsv + cắt popularity) cho nhánh POI. Mặc định TẮT.
   * Bật/tắt không cần sửa mã: `wrangler deploy --env production --var AUTOCOMPLETE_FAST:1`.
   */
  AUTOCOMPLETE_FAST?: string;
```

`apps/api/src/stages.ts`, thêm hàm thuần quyết định cổng:

```ts
import type { FastGate } from './autocomplete-sql';

/**
 * Có bật cổng bậc nhanh cho request này không, và với tsquery nào.
 *
 * Là hàm THUẦN vì test route của `apps/api` chạy với DB đóng và không quan sát được SQL — quyết
 * định phải kiểm được ở đây, route chỉ gọi. Cùng lý do với `telexFallback`.
 */
export function fastGateFor(input: {
  enabled: boolean;
  queryNorm: string;
  limit: number;
}): FastGate | undefined {
  if (!input.enabled) return undefined;
  return { tsQuery: tsQueryAnyToken(input.queryNorm), limit: input.limit };
}
```

`apps/api/src/routes/autocomplete.ts`, sửa import dòng 11 và lời gọi dòng 86:

```ts
import { fastGateFor, telexFallback, tsQueryFor } from '../stages';
```

```ts
        const rows = await collectCandidates(
          sql,
          {
            queryNorm, queryCore, queryAlias, prefixPattern, near, parsed, sources, tsQuery, queryKey,
          },
          types,
          // Cờ tắt → `undefined` → collectCandidates chạy y như trước bậc nhanh.
          fastGateFor({ enabled: c.env.AUTOCOMPLETE_FAST === '1', queryNorm, limit }),
        );
```

Lời gọi `collectCandidates` thứ hai (nhánh telex, dòng 110) **không** truyền cổng: nhánh đó chỉ chạy khi mọi bậc trước đã rỗng, tức bậc nhanh cũng đã rỗng.

`apps/api/wrangler.toml`, dưới dòng ghi chú của `AUTOCOMPLETE_TELEX`:

```toml
# AUTOCOMPLETE_FAST = "1"  # bậc nhanh name_tsv (plan 2026-09-18). Bật trên production bằng
#   `wrangler deploy --env production --var AUTOCOMPLETE_FAST:1` sau khi hit@3 ≥ 38/40.
```

- [ ] **Step 4: Chạy lại, phải XANH**

Run: `npx vitest run --config apps/api/vitest.config.ts apps/api/test/stages.test.ts`
Expected: PASS.

- [ ] **Step 5: Chạy toàn bộ test API và typecheck**

Run: `pnpm test:api && pnpm typecheck`
Expected: PASS, không test nào đỏ. Đặc biệt `apps/api/test/autocomplete.test.ts` phải xanh nguyên: cờ mặc định tắt nên mọi hành vi HTTP không đổi.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/env.ts apps/api/src/stages.ts apps/api/src/routes/autocomplete.ts apps/api/wrangler.toml apps/api/test/stages.test.ts
git commit -m "feat(api): cờ AUTOCOMPLETE_FAST nối bậc nhanh vào route"
```

---

### Task 5: Test trên DB thật

Test đơn vị dùng `fakeSql` nên không bao giờ chạm Postgres — chúng khoá được **hình dạng** câu, không khoá được việc câu đó có chạy nổi không. Bài học đã trả giá hai lần trong dự án này: mảng SQL bind `::text[]` và bind timestamp mất micro giây đều chỉ lộ ở `test:api-db` và trên production.

Thêm nữa: `to_tsquery` **ném syntax error** với chuỗi sai dạng, và CTE + `LIMIT $n` tham số hoá đi qua postgres.js/Hyperdrive là đúng chỗ từng vỡ trước đây. Không có ca DB thật thì cờ bật trên production mới là lần đầu câu này chạm Postgres.

**Files:**
- Modify: `scripts/api-db-test.mjs:134` (khối `--var`)
- Modify: `apps/api/test-db/places.itest.mjs`

- [ ] **Step 1: Bật Postgres dev**

Run: `pnpm db:up`
Expected: container `mapslibvn-dev-postgres-1` báo `Up (healthy)`.

- [ ] **Step 2: Bật cờ cho tiến trình wrangler của itest**

Trong `scripts/api-db-test.mjs`, ngay sau cặp `'--var', 'AUTOCOMPLETE_TELEX:1',` thêm:

```js
    // Bậc nhanh (plan 2026-09-18): bật trong itest để câu `name_tsv` chạm Postgres thật ít nhất
    // một lần trước khi cờ được bật trên production.
    '--var',
    'AUTOCOMPLETE_FAST:1',
```

- [ ] **Step 3: Thêm ca itest**

Thêm vào `apps/api/test-db/places.itest.mjs`, cạnh ca `autocomplete Highlands có score giảm dần`:

```js
  it('bậc nhanh: name_tsv chạy được trên Postgres thật và vẫn xếp đúng', async () => {
    const { status, body } = await get('/v1/autocomplete?q=highlands&near=10.77,106.70');
    expect(status).toBe(200);
    expect(body.items[0].name).toBe('Highlands Coffee Test');
    const scores = body.items.map((item) => item.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('bậc nhanh: truy vấn MỘT token cũng chạy (tsQueryFor cũ trả null ở đây)', async () => {
    const { status, body } = await get('/v1/autocomplete?q=truong&near=10.77,106.70');
    expect(status).toBe(200);
    expect(Array.isArray(body.items)).toBe(true);
  });
```

- [ ] **Step 4: Chạy**

Run: `pnpm test:api-db`
Expected: PASS toàn bộ. Nếu `to_tsquery` ném thì route trả 503 `upstream_unavailable` và hai ca trên đỏ — đó chính là thứ cần bắt ở đây chứ không phải trên production.

- [ ] **Step 5: Chạy cả bộ DB để chắc không vỡ chỗ khác**

Run: `pnpm test:db`
Expected: PASS. Chạy **cả bộ**, không chọn lọc file — chọn lọc từng bỏ sót hồi 09/2026.

- [ ] **Step 6: Commit**

```bash
git add scripts/api-db-test.mjs apps/api/test-db/places.itest.mjs
git commit -m "test(api): bậc nhanh chạy được trên Postgres thật"
```

---

### Task 6: Cổng nghiệm thu trên production

Đây là bước quyết định giữ hay bỏ. **Không bật cờ trước khi hit@3 đạt.**

**Files:** không sửa mã.

- [ ] **Step 1: Merge lên main, để cờ TẮT**

Push nhánh, merge vào `main`. `.github/workflows/deploy-api.yml` chạy `on: push: branches: [main]` nên production được deploy tự động — nhưng cờ tắt nên hành vi **không đổi**.

- [ ] **Step 2: Xác nhận production chưa đổi hành vi**

Run:
```bash
node scripts/perf-autocomplete.mjs https://mapslibvn-api-production.dotienphong1993.workers.dev "$MAPSLIBVN_API_KEY" \
  --queries scripts/fixtures/fuzzy-queries.txt --count 40 --near 21.03,105.85
```
Expected: `hit@3=38/40`, độ trễ ngang baseline (p50 ~1.000 ms). Khác baseline nhiều nghĩa là có gì đó lọt vào ngoài dự tính — dừng lại, đừng bật cờ.

- [ ] **Step 3: Bật cờ trên production**

Run (PHONG chạy, cần token Cloudflare):
```bash
cd apps/api && pnpm exec wrangler deploy --env production --var AUTOCOMPLETE_FAST:1
```

- [ ] **Step 4: Đo lại, ĐỔI `--near` để không dính cache 10 phút**

Run:
```bash
node scripts/perf-autocomplete.mjs https://mapslibvn-api-production.dotienphong1993.workers.dev "$MAPSLIBVN_API_KEY" \
  --queries scripts/fixtures/fuzzy-queries.txt --count 40 --near 16.05,108.22
```

Tiêu chí ĐẠT — cả hai phải cùng đúng:
- `hit@3 ≥ 38/40` (bằng baseline; tụt là bỏ, không thương lượng)
- `p50 ≤ 600 ms` và `p95 ≤ 1.200 ms`

- [ ] **Step 5: Nếu TRƯỢT thì tắt ngay, không sửa vá**

```bash
cd apps/api && pnpm exec wrangler deploy --env production --var AUTOCOMPLETE_FAST:0
```

Ghi lại truy vấn nào trượt vào hồ sơ rồi quay về Task 2 xem xét `FAST_CANDIDATE_POOL` — 200 là con số chọn theo lý lẽ, chưa phải theo số đo. Nghi ngờ đầu tiên: `popularity` NULL/hoà nhau làm 200 dòng lấy ra gần như tuỳ ý.

- [ ] **Step 6: Ghi hồ sơ**

Thêm mục "Sau bậc nhanh" vào `docs/evidence/perf/2026-09-18-autocomplete-cold.md` với cả hai số đo và kết luận. Thêm một dòng vào `docs/DEVLOG.md` theo khuôn các mục trước.

- [ ] **Step 7: Commit**

```bash
git add docs/evidence/perf/2026-09-18-autocomplete-cold.md docs/DEVLOG.md
git commit -m "docs(perf): nghiệm thu bậc nhanh autocomplete trên production"
```

---

## Việc KHÔNG làm trong plan này

- **Không thêm chỉ số, không migration.** `poi_name_tsv_idx` đã có từ 0009.
- **Không đụng `street` và bậc 3.** Sau khi POI nhanh lại, chúng thành nhánh chậm nhất (325–432 ms) và là việc của plan sau. Đừng gộp vào đây: gộp thì không biết phần cải thiện đến từ đâu.
- **Không hạ debounce 300 ms phía client.** Nó đang giảm 51 % lượt Places; chỉ xét lại sau khi server đã nhanh.
- **Không vặn `pg_trgm.similarity_threshold`.** Đổi nó cùng lúc làm hai phép đo trước/sau mất ý nghĩa. Nếu bậc nhanh đạt thì đường trigram chỉ còn phục vụ ca gõ sai, và giá trị của việc vặn ngưỡng tụt hẳn.
- **Không sửa lệch `word_similarity_threshold` 0,5 vs 0,6 trên production.** Cùng lý do — một thay đổi một lần.
