# Tìm mờ bằng `word_similarity` — Implementation Plan (Hạng mục 2 của spec 05/09)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Autocomplete, search và bước đường của geocode chịu được lỗi gõ 1–2 ký tự, truy vấn là một phần tên và đảo thứ tự từ, đo được bằng bộ 40 truy vấn, p95 không tăng quá 50 ms.

**Architecture:** Thay điều kiện `name_norm % q` (similarity toàn chuỗi) bằng `q <% name_norm` (`word_similarity` của pg_trgm, chỉ số GIN hiện có hỗ trợ), ngưỡng đặt ở cấp **database** bằng migration để production (user `api`), dev (user `mapslibvn`) và dbtest đều cùng giá trị. SQL autocomplete tách ra module thuần `autocomplete-sql.ts` để test không cần Postgres; ba loại kết quả truy vấn song song. Bậc 2–3 (tsvector, khoá ngữ âm) **không** thuộc plan này (hạng mục 3).

**Tech Stack:** Postgres 16 + pg_trgm (đã cài), postgres.js, Hono trên Cloudflare Workers, Vitest (`@cloudflare/vitest-pool-workers` cho `apps/api`), Biome.

**Spec:** `docs/superpowers/specs/2026-09-05-tim-kiem-alias-fuzzy-dia-phuong-design.md` mục 5.1–5.3, 5.7, 11 (tiêu chí 3, 4, 7).

**Quy tắc repo phải nhớ (từ memory dự án):**
- Test trong `apps/api` **không được cần Postgres**: Hyperdrive trong `apps/api/vitest.config.ts` trỏ cổng đóng. Mọi test SQL ở đây dùng tag `sql` giả.
- `tsconfig.base.json` bật `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`; `scripts/*.mjs` bị `checkJs`. Sau khi sửa chạy `pnpm --filter @mapslibvn/api typecheck` và `pnpm exec tsc -p tsconfig.scripts.json`; `pnpm lint` không bắt lỗi kiểu.
- `pnpm test:db` trên máy dev luôn đỏ ở `pipeline-fixture.dbtest.mjs` vì thiếu `tippecanoe`; chỉ cần `schema.dbtest.mjs` xanh, CI `dbtest.yml` là cổng đầy đủ.
- Lệnh `wrangler` chạy từ `apps/api`; `.env` ở gốc repo.
- Commit message tiếng Việt kiểu `feat(api): …`, kết bằng dòng `Co-Authored-By`.

---

## Cấu trúc file

| File | Việc |
|---|---|
| `db/migrations/0007_word_similarity_threshold.sql` (+ `.down.sql`) | **Tạo.** Đặt `pg_trgm.word_similarity_threshold = 0.5` ở cấp database hiện tại |
| `db/schema.dbtest.mjs` | **Sửa.** Kiểm GUC đã đặt và phiên mới đọc được |
| `apps/api/src/index.ts:34-51` | **Sửa.** `/healthz/db` trả thêm `word_similarity_threshold` |
| `apps/api/test/healthz-db.test.ts` | Không đổi (chỉ kiểm nhánh lỗi) |
| `apps/api/src/autocomplete-sql.ts` | **Tạo.** Ba hàm dựng truy vấn ứng viên + `collectCandidates` chạy song song |
| `apps/api/test/autocomplete-sql.test.ts` | **Tạo.** Test bằng tag `sql` ghi lại chuỗi |
| `apps/api/test/helpers/fake-sql.ts` | **Tạo.** Tag `sql` giả dùng chung cho test không DB |
| `apps/api/src/routes/autocomplete.ts` | **Sửa.** Dùng `collectCandidates`, bỏ SQL inline |
| `apps/api/src/routes/search.ts:31-41` | **Sửa.** `%` → `<%`, ORDER BY `greatest(word_similarity, similarity)` |
| `apps/api/src/geocode.ts:229-264` | **Sửa.** Fallback `stepStreet` dùng `<%` |
| `apps/api/test/geocode.test.ts` | **Sửa.** Thêm test ghi lại SQL của fallback |
| `scripts/fixtures/fuzzy-queries.txt` | **Tạo.** 40 truy vấn `q|đích` |
| `scripts/perf-autocomplete.mjs` (+ `.test.mjs`) | **Sửa.** Nhận `--queries <file>`, tính `hit@3` |
| `apps/docs/src/content/docs/tim-kiem.md:114-140`, `apps/docs/src/content/docs/api.md` | **Sửa.** Một đoạn về tìm mờ |
| `docs/DEVLOG.md` | **Sửa.** Mục 2 (bước kế tiếp) + mục 4 (nhật ký) + số đo trước/sau |

---

### Task 0: Đo baseline trên production TRƯỚC khi đổi code

**Files:**
- Create: `scripts/fixtures/fuzzy-queries.txt`
- Modify: `scripts/perf-autocomplete.mjs`
- Modify: `scripts/perf-autocomplete.test.mjs`

- [ ] **Step 1: Tạo fixture 40 truy vấn**

Định dạng mỗi dòng `q|đích`: `đích` là chuỗi đã `normalizeVi` phải xuất hiện trong `name` (đã bỏ dấu, lowercase) của một trong 3 item đầu. Dòng bắt đầu `#` là chú thích. Bốn nhóm 10 dòng theo spec 5.7.

```text
# q|đích (đích là chuỗi không dấu phải nằm trong name của top-3, so sau khi bỏ dấu + lowercase)
# --- 10 đúng chính tả (đối chứng, phải đạt cả trước và sau) ---
highlands|highlands
pharmacity|pharmacity
circle k|circle k
nguyen hue|nguyen hue
ben thanh|ben thanh
cho ray|cho ray
truong tieu hoc|truong tieu hoc
coop mart|co.op
bun bo|bun bo
vincom|vincom
# --- 10 lỗi gõ 1–2 ký tự ---
higland|highlands
higlands cofee|highlands
pharmacy city|pharmacity
cirlce k|circle k
nguyne hue|nguyen hue
ben than|ben thanh
cho rya|cho ray
vincon|vincom
winmrt|winmart
phuc lonh|phuc long
# --- 10 đảo thứ tự từ ---
coffee highlands|highlands
cho ray benh vien|cho ray
k circle|circle k
hue nguyen duong|nguyen hue
mart coop|co.op
thanh ben cho|ben thanh
long phuc tra|phuc long
xanh bach hoa|bach hoa xanh
house coffee the|coffee house
nguyen tieu hoc truong|truong tieu hoc
# --- 10 truy vấn là một phần tên dài / dính từ ---
highlands nguyen|highlands
benh vien cho|cho ray
tieu hoc nguyen|tieu hoc
coopmart|co.op
winmart+|winmart
bhx|bach hoa xanh
tch|coffee house
nhathuoc long chau|long chau
sieu thi co op|co.op
phuc long coffee|phuc long
```

Ghi chú cho người thực hiện: tên thật trong DB có thể khác ("Co.opmart" hay "Co.op Mart"); sau lần đo đầu, sửa cột `đích` cho **10 dòng đối chứng** để cả 10 đạt trên production hiện tại — nhóm đối chứng phải xanh trước khi nhóm mờ có ý nghĩa. Không sửa cột `q` của 30 dòng mờ.

- [ ] **Step 2: Viết test cho tuỳ chọn `queries` và `hit@3`**

Thêm vào `scripts/perf-autocomplete.test.mjs`, sau test hiện có:

```js
describe('measureAutocomplete với bộ truy vấn có đích', () => {
  it('tính hit@3: đích khớp (không dấu, lowercase) trong 3 item đầu', async () => {
    const queries = [
      { q: 'higland', expect: 'highlands' },
      { q: 'cho rya', expect: 'cho ray' },
    ];
    const result = await measureAutocomplete('https://api.test', 'k', {
      count: 2,
      queries,
      fetchImpl: async (url) =>
        new Response(
          JSON.stringify({
            items: String(url).includes('higland')
              ? [{ name: 'Phở Hoà' }, { name: 'Highlands Coffee Nguyễn Huệ' }, { name: 'X' }]
              : [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'Bệnh viện Chợ Rẫy' }],
          }),
        ),
      now: (() => {
        let t = 0;
        return () => (t += 5);
      })(),
    });
    expect(result.hit3).toEqual({ hit: 1, total: 2, misses: ['cho rya'] });
  });

  it('đọc fixture q|đích, bỏ dòng # và dòng rỗng', () => {
    expect(parseQueryFixture('# chú thích\nhigland|highlands\n\ncoffee highlands|highlands\n')).toEqual([
      { q: 'higland', expect: 'highlands' },
      { q: 'coffee highlands', expect: 'highlands' },
    ]);
  });
});
```

Sửa dòng import đầu file thành:

```js
import { measureAutocomplete, parseQueryFixture } from './perf-autocomplete.mjs';
```

- [ ] **Step 3: Chạy test để thấy đỏ**

Run: `pnpm exec vitest run scripts/perf-autocomplete.test.mjs`
Expected: FAIL — `parseQueryFixture` không được export; `result.hit3` undefined.

- [ ] **Step 4: Sửa `scripts/perf-autocomplete.mjs`**

Thay toàn bộ file bằng:

```js
#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const QUERIES = [
  'highlands',
  'pho co',
  'cafe',
  'truong tieu hoc',
  'nguyen hue',
  'ben thanh',
  'circle k',
  'pharmacity',
  'bun bo',
  'coop mart',
];

/** Bỏ dấu + lowercase để so đích (không import @mapslibvn/core: script chạy trước khi build). */
const fold = (/** @type {string} */ s) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();

/**
 * Đọc fixture "q|đích" (dòng # và rỗng bị bỏ).
 * @param {string} text
 * @returns {{ q: string, expect: string }[]}
 */
export function parseQueryFixture(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const [q, expect = ''] = line.split('|').map((part) => part.trim());
      if (!q) throw new Error(`Dòng fixture thiếu q: "${line}"`);
      return { q, expect };
    });
}

/**
 * Đo autocomplete từ máy hiện tại; fetch/clock có thể thay bằng test double.
 * @param {string} base
 * @param {string} key
 * @param {{ count?: number, fetchImpl?: typeof fetch, now?: () => number,
 *   queries?: { q: string, expect: string }[], near?: string }} [options]
 */
export async function measureAutocomplete(
  base,
  key,
  {
    count = 100,
    fetchImpl = fetch,
    now = () => performance.now(),
    queries = QUERIES.map((q) => ({ q, expect: '' })),
    near = '10.776,106.700',
  } = {},
) {
  if (!Number.isInteger(count) || count < 1) throw new Error('count phải là số nguyên dương');
  if (queries.length === 0) throw new Error('Không có query để đo');
  const normalizedBase = base.replace(/\/+$/, '');
  const samples = [];
  let hit = 0;
  let judged = 0;
  /** @type {string[]} */
  const misses = [];
  for (let i = 0; i < count; i++) {
    const entry = queries[i % queries.length];
    if (entry === undefined) throw new Error('Không có query để đo');
    const t0 = now();
    const res = await fetchImpl(
      `${normalizedBase}/v1/autocomplete?q=${encodeURIComponent(entry.q)}&near=${near}`,
      { headers: { 'X-Api-Key': key } },
    );
    const body = await res.text();
    const elapsed = now() - t0;
    if (!res.ok) throw new Error(`lần ${i + 1}: HTTP ${res.status}`);
    if (entry.expect && i < queries.length) {
      judged++;
      /** @type {{ items?: { name: string }[] }} */
      const json = JSON.parse(body);
      const top3 = (json.items ?? []).slice(0, 3).map((item) => fold(item.name));
      if (top3.some((name) => name.includes(fold(entry.expect)))) hit++;
      else misses.push(entry.q);
    }
    samples.push({
      index: i + 1,
      query: entry.q,
      ms: elapsed,
      cache: res.headers.get('x-mlv-cache') ?? 'miss',
      colo: res.headers.get('cf-ray')?.split('-').at(-1) ?? '',
    });
  }
  const times = samples.map(({ ms }) => ms);
  times.sort((a, b) => a - b);
  /** @param {number} p */
  const pct = (p) => {
    const value = times[Math.ceil((p / 100) * times.length) - 1];
    if (value === undefined) throw new Error('Không có sample để tính percentile');
    return Math.round(value);
  };
  const slowest = samples
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 5)
    .map(({ index, query, ms, cache, colo }) => ({
      index,
      query,
      ms: Math.round(ms),
      cache,
      colo,
    }));
  return {
    n: times.length,
    p50: pct(50),
    p95: pct(95),
    p99: pct(99),
    slowest,
    ...(judged ? { hit3: { hit, total: judged, misses } } : {}),
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2);
  const queriesIndex = args.indexOf('--queries');
  const queriesFile = queriesIndex >= 0 ? args[queriesIndex + 1] : undefined;
  const positional = args.filter((_, i) => i !== queriesIndex && i !== queriesIndex + 1);
  const [base, key] = positional;
  if (!base || !key) {
    console.error(
      'Cách dùng: node scripts/perf-autocomplete.mjs <base-url> <api-key> [--queries scripts/fixtures/fuzzy-queries.txt]',
    );
    process.exitCode = 1;
  } else {
    try {
      const queries = queriesFile ? parseQueryFixture(readFileSync(queriesFile, 'utf8')) : undefined;
      const result = await measureAutocomplete(base, key, {
        ...(queries ? { queries, count: queries.length * 2 } : {}),
      });
      console.log(`n=${result.n} p50=${result.p50}ms p95=${result.p95}ms p99=${result.p99}ms`);
      if (result.hit3) {
        console.log(
          `hit@3=${result.hit3.hit}/${result.hit3.total}${result.hit3.misses.length ? ` miss: ${result.hit3.misses.join(', ')}` : ''}`,
        );
      }
      console.log(
        `slowest=${result.slowest
          .map(
            ({ index, query, ms, cache, colo }) =>
              `#${index} ${query}:${ms}ms cache=${cache}${colo ? ` colo=${colo}` : ''}`,
          )
          .join(', ')}`,
      );
      console.log(
        'Lưu ý: từ vòng lặp thứ 2 các query trùng sẽ hit cache 10 phút — giống hành vi client thật.',
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }
}
```

Lưu ý test cũ: kết quả không có `hit3` khi không có đích (`toEqual` cũ vẫn đúng vì spread rỗng). `res.text()` thay `arrayBuffer()` để đọc JSON; test cũ dùng `new Response('{}')` vẫn chạy.

- [ ] **Step 5: Chạy test và typecheck script**

Run: `pnpm exec vitest run scripts/perf-autocomplete.test.mjs && pnpm exec tsc -p tsconfig.scripts.json`
Expected: 4 test PASS; tsc không lỗi. Nếu tsc báo `json.items` kiểu `any`, giữ JSDoc `@type` như trên (đã có).

- [ ] **Step 6: Đo baseline trên production (code hiện tại)**

Run (dùng khoá `server` của tenant nội bộ, không ghi khoá vào file nào):

```bash
node scripts/perf-autocomplete.mjs https://api.ai-solutions.io.vn '<khoá mlv_live_ nội bộ>' --queries scripts/fixtures/fuzzy-queries.txt
```

Expected: in `n=80 p50=… p95=… p99=…` và `hit@3=…/40 miss: …`. Chạy **hai lần**: lần 1 là cache lạnh (miss), lần 2 gần như toàn `hit`. Ghi cả hai vào `docs/DEVLOG.md` mục 2 dưới tiêu đề "05/09/2026 — Tìm mờ: baseline" (số p95 lần 1, hit@3 lần 1). Kỳ vọng baseline hit@3 < 20/40; nếu 10 dòng đối chứng không đạt đủ 10, sửa cột `đích` của chúng theo tên thật rồi đo lại.

- [ ] **Step 7: Commit**

```bash
git add scripts/fixtures/fuzzy-queries.txt scripts/perf-autocomplete.mjs scripts/perf-autocomplete.test.mjs docs/DEVLOG.md
git commit -m "chore(perf): bộ 40 truy vấn mờ và hit@3 cho perf-autocomplete

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 1: Migration ngưỡng `word_similarity` cấp database

**Files:**
- Create: `db/migrations/0007_word_similarity_threshold.sql`
- Create: `db/migrations/0007_word_similarity_threshold.down.sql`
- Modify: `db/schema.dbtest.mjs`

Lý do đặt ở cấp database (không phải role `api`): production nối bằng user `api`, dev bằng `mapslibvn`, dbtest tạo DB cô lập — `ALTER DATABASE current_database() SET` phủ cả ba. `ALTER DATABASE … SET` chạy được trong transaction của `db-migrate.mjs` (chỉ `SET TABLESPACE` bị cấm). Giá trị chỉ áp cho **phiên mới**, nên test phải mở kết nối mới để đọc.

- [ ] **Step 1: Viết test dbtest**

Thêm vào `db/schema.dbtest.mjs`, trong `describe('lược đồ spec 5.2', …)` sau test quyền:

```js
  it('0007: pg_trgm.word_similarity_threshold = 0.5 ở cấp database, phiên mới đọc được', async () => {
    const [setting] = await sql`SELECT setconfig FROM pg_db_role_setting
      WHERE setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND setrole = 0`;
    expect(setting?.setconfig).toContain('pg_trgm.word_similarity_threshold=0.5');
    // Phiên hiện tại mở trước migration nên còn giá trị cũ; mở phiên mới để kiểm giá trị hiệu lực.
    const fresh = postgres(url, { max: 1, onnotice: () => {} });
    try {
      const [row] = await fresh`SELECT current_setting('pg_trgm.word_similarity_threshold') AS v,
        current_setting('pg_trgm.similarity_threshold') AS s`;
      expect(row?.v).toBe('0.5');
      expect(row?.s).toBe('0.3');
    } finally {
      await fresh.end();
    }
  });
```

- [ ] **Step 2: Chạy để thấy đỏ**

Run: `pnpm db:up && pnpm test:db`
Expected: test mới FAIL (`setconfig` undefined). `pipeline-fixture.dbtest.mjs` đỏ vì thiếu `tippecanoe` là **đã biết**, bỏ qua.

- [ ] **Step 3: Viết migration**

`db/migrations/0007_word_similarity_threshold.sql`:

```sql
-- Spec 05/09 mục 5.2: toán tử q <% name_norm (word_similarity) dùng GUC này làm ngưỡng.
-- Đặt ở cấp database để user api (production), mapslibvn (dev) và DB dbtest cô lập đều cùng giá trị.
-- pg_trgm.similarity_threshold giữ mặc định 0.3 (toán tử % vẫn dùng ở conflation pipeline).
SELECT show_trgm('mapslibvn');   -- nạp thư viện pg_trgm để GUC được nhận diện/kiểm tra giá trị
DO $$ BEGIN
  EXECUTE format('ALTER DATABASE %I SET pg_trgm.word_similarity_threshold = 0.5', current_database());
END $$;
```

`db/migrations/0007_word_similarity_threshold.down.sql`:

```sql
DO $$ BEGIN
  EXECUTE format('ALTER DATABASE %I RESET pg_trgm.word_similarity_threshold', current_database());
END $$;
```

- [ ] **Step 4: Chạy dbtest**

Run: `pnpm test:db`
Expected: `schema.dbtest.mjs` PASS toàn bộ (kể cả test mới); chỉ `pipeline-fixture` đỏ vì tippecanoe.

- [ ] **Step 5: Kiểm revert rồi áp lại trên DB dev**

Run:
```bash
pnpm db:migrate && node scripts/db-migrate.mjs --down && pnpm db:migrate
```
Expected: `[db:migrate] Revert 0007_word_similarity_threshold.sql …`, rồi `Áp dụng 0007_… — 1 migration`.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/0007_word_similarity_threshold.sql db/migrations/0007_word_similarity_threshold.down.sql db/schema.dbtest.mjs
git commit -m "feat(db): ngưỡng pg_trgm.word_similarity_threshold 0.5 cấp database

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `/healthz/db` báo ngưỡng đang hiệu lực

**Files:**
- Modify: `apps/api/src/index.ts:34-51`

Không có test happy-path (cần DB); test lỗi hiện có ở `healthz-db.test.ts` giữ nguyên. Đây là cách xác nhận migration đã lên production mà không cần vào máy chủ.

- [ ] **Step 1: Sửa truy vấn**

Trong `apps/api/src/index.ts`, thay khối `app.get('/healthz/db', …)` bằng:

```ts
app.get('/healthz/db', async (c) => {
  const sql = getSql(c.env);
  try {
    const [row] = await sql<
      { ok: number; user: string; version: string; wst: string }[]
    >`SELECT 1 AS ok, current_user AS "user", version() AS version,
        current_setting('pg_trgm.word_similarity_threshold') AS wst`;
    return c.json({
      ok: row?.ok === 1,
      user: row?.user,
      version: row?.version.split(' ').slice(0, 2).join(' '),
      word_similarity_threshold: row?.wst === undefined ? undefined : Number(row.wst),
    });
  } catch (err) {
    console.error('healthz/db', err);
    throw new ApiError(503, 'upstream_unavailable', 'Không nối được DB');
  } finally {
    c.executionCtx.waitUntil(sql.end({ timeout: 1 }));
  }
});
```

- [ ] **Step 2: Typecheck + test API**

Run: `pnpm --filter @mapslibvn/api typecheck && pnpm --filter @mapslibvn/api test`
Expected: typecheck OK; 95 test PASS (không đổi số).

- [ ] **Step 3: Kiểm trên DB dev qua wrangler**

Run (terminal 1, từ `apps/api`): `pnpm --filter @mapslibvn/api dev`
Run (terminal 2): `curl -s http://localhost:8787/healthz/db`
Expected: `{"ok":true,"user":"mapslibvn","version":"PostgreSQL 16.x","word_similarity_threshold":0.5}`. Dừng wrangler.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat(api): healthz/db báo pg_trgm.word_similarity_threshold

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Tag `sql` giả dùng chung cho test không DB

**Files:**
- Create: `apps/api/test/helpers/fake-sql.ts`

`postgres.js` gọi `sql` như template tag (`sql\`…${x}…\``), lồng fragment (`sql\`AND …\``) và `sql.unsafe(text)`. Tag giả dựng lại chuỗi SQL, thay tham số bằng `$n`, để test so chuỗi.

- [ ] **Step 1: Viết helper**

```ts
import type { getSql } from '../../src/db';

export interface RecordedQuery {
  text: string;
  params: unknown[];
}

const isFragment = (value: unknown): value is RecordedQuery =>
  typeof value === 'object' && value !== null && 'text' in value && 'params' in value;

/**
 * Tag `sql` giả: trả về {text, params} thay vì chạy. Fragment lồng nhau được nối phẳng;
 * tham số thường thành `$n`. `rows` là kết quả trả cho mỗi lần `await`.
 */
export function fakeSql(rows: unknown[] = [], calls: RecordedQuery[] = []) {
  const build = (strings: TemplateStringsArray, values: unknown[]): RecordedQuery => {
    let text = '';
    const params: unknown[] = [];
    strings.forEach((part, i) => {
      text += part;
      if (i >= values.length) return;
      const value = values[i];
      if (isFragment(value)) {
        text += value.text;
        params.push(...value.params);
      } else {
        params.push(value);
        text += `$${params.length}`;
      }
    });
    return { text: text.replace(/\s+/g, ' ').trim(), params };
  };
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = build(strings, values);
    calls.push(query);
    const thenable = Object.assign(Promise.resolve(rows), query);
    return thenable;
  };
  tag.unsafe = (text: string): RecordedQuery => ({ text, params: [] });
  return { sql: tag as unknown as ReturnType<typeof getSql>, calls };
}
```

Ghi chú: fragment lồng cũng bị đẩy vào `calls` (vì cùng đi qua `tag`); test lọc bằng `calls.filter((c) => c.text.startsWith('SELECT'))` khi cần.

- [ ] **Step 2: Kiểm biên dịch**

Run: `pnpm --filter @mapslibvn/api typecheck`
Expected: OK (file test nằm trong `include` của `apps/api/tsconfig.json`; nếu không, thêm `"test/**/*.ts"` vào `include`).

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/helpers/fake-sql.ts
git commit -m "test(api): tag sql giả ghi lại chuỗi cho test không DB

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Module `autocomplete-sql.ts` với `<%` và `word_similarity`

**Files:**
- Create: `apps/api/src/autocomplete-sql.ts`
- Create: `apps/api/test/autocomplete-sql.test.ts`

- [ ] **Step 1: Viết test đỏ**

`apps/api/test/autocomplete-sql.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  type CandidateQueryInput,
  collectCandidates,
  poiCandidates,
  streetCandidates,
} from '../src/autocomplete-sql';
import { fakeSql } from './helpers/fake-sql';

const input: CandidateQueryInput = {
  queryNorm: 'coffee highlands',
  queryCore: 'coffee highlands',
  prefixPattern: 'coffee highlands%',
  near: null,
  parsed: { alleyChain: [], confidence: 0 },
};

describe('autocomplete-sql — bậc 1 dùng word_similarity (spec 05/09 mục 5.3)', () => {
  it('poi: lọc bằng q <% name_norm (cả norm và core) + LIKE tiền tố, không còn toán tử %', async () => {
    const { sql, calls } = fakeSql([]);
    await poiCandidates(sql, input);
    const [query] = calls.filter((call) => call.text.startsWith('SELECT'));
    // Tham số đầu ($1) nằm trong word_similarity() của SELECT; WHERE dùng $n sau đó.
    expect(query?.text).toMatch(/\$\d+ <% name_norm OR \$\d+ <% name_norm OR name_norm LIKE \$\d+/);
    expect(query?.text).not.toMatch(/name_norm % /);
    expect(query?.text).toContain('word_similarity(');
    expect(query?.text).toContain('similarity(name_norm,');
    expect(query?.text).toContain('ORDER BY sim DESC, pop DESC');
    expect(query?.params).toEqual(
      expect.arrayContaining(['coffee highlands', 'coffee highlands%']),
    );
  });

  it('street: cùng điều kiện <% + LIKE', async () => {
    const { sql, calls } = fakeSql([]);
    await streetCandidates(sql, input);
    const [query] = calls.filter((call) => call.text.startsWith('SELECT'));
    expect(query?.text).toContain('<% name_norm OR name_norm LIKE');
    expect(query?.text).not.toMatch(/name_norm % /);
  });

  it('collectCandidates: chạy song song các loại được chọn, bỏ address khi không có số nhà', async () => {
    const rows = [{ type: 'poi', name: 'x' }];
    const { sql, calls } = fakeSql(rows);
    const result = await collectCandidates(sql, input, new Set(['poi', 'street', 'address']));
    const selects = calls.filter((call) => call.text.startsWith('SELECT'));
    expect(selects).toHaveLength(2); // poi + street; address bị bỏ vì parsed không có housenumber
    expect(result).toHaveLength(2); // mỗi truy vấn trả 1 dòng giả
  });

  it('collectCandidates: có số nhà + đường thì thêm truy vấn address', async () => {
    const { sql, calls } = fakeSql([]);
    await collectCandidates(
      sql,
      {
        ...input,
        parsed: {
          alleyChain: [],
          confidence: 0.6,
          housenumber: '88',
          street: 'Nguyễn Lâm',
          streetNorm: 'nguyen lam',
        },
      },
      new Set(['address']),
    );
    const selects = calls.filter((call) => call.text.startsWith('SELECT'));
    expect(selects).toHaveLength(1);
    expect(selects[0]?.text).toContain('FROM address_anchor');
    expect(selects[0]?.text).toContain('<% street_norm');
  });
});
```

- [ ] **Step 2: Chạy để thấy đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/autocomplete-sql.test.ts`
Expected: FAIL — module `../src/autocomplete-sql` không tồn tại.

- [ ] **Step 3: Viết module**

`apps/api/src/autocomplete-sql.ts`:

```ts
import type { ParsedAddress } from '@mapslibvn/core';
import type { getSql } from './db';
import type { LatLng } from './params';
import type { ItemType } from './ranking';

type Sql = ReturnType<typeof getSql>;

export interface CandidateRow {
  type: ItemType;
  id: string | null;
  name: string;
  secondary: string | null;
  lat: number;
  lng: number;
  precision: string | null;
  sim: number;
  prefix: boolean;
  pop: number;
  d: number | null;
}

export interface CandidateQueryInput {
  queryNorm: string;
  queryCore: string;
  /** `queryNorm` đã escape `\ % _`, kèm `%` cuối — dùng cho LIKE tiền tố. */
  prefixPattern: string;
  near: LatLng | null;
  parsed: ParsedAddress;
}

const nearPoint = (sql: Sql, near: LatLng | null) =>
  near ? sql`ST_SetSRID(ST_MakePoint(${near.lng}, ${near.lat}), 4326)` : null;

const distance = (sql: Sql, near: LatLng | null, geometry: string) => {
  const point = nearPoint(sql, near);
  return point ? sql`ST_DistanceSphere(${sql.unsafe(geometry)}, ${point})` : sql`NULL::float8`;
};

/**
 * Spec 05/09 mục 5.3: `q <% name_norm` (word_similarity, GIN trgm hỗ trợ) thay `name_norm % q`.
 * word_similarity đo trên đoạn từ liên tục của tên nên truy vấn ngắn hơn tên, đảo từ và lỗi gõ
 * 1–2 ký tự vẫn qua ngưỡng (GUC pg_trgm.word_similarity_threshold, migration 0007).
 * ORDER BY thêm pop để 20 ứng viên đầu không ngẫu nhiên khi sim hoà (truy vấn 2–3 ký tự).
 */
export function poiCandidates(sql: Sql, input: CandidateQueryInput) {
  const { queryNorm, queryCore, prefixPattern, near } = input;
  return sql<CandidateRow[]>`
    SELECT 'poi' AS type, id, name,
      concat_ws(', ', street, ward, province) AS secondary,
      ST_Y(geom) AS lat, ST_X(geom) AS lng, NULL AS precision,
      greatest(
        word_similarity(${queryNorm}, name_norm),
        word_similarity(${queryCore}, name_norm),
        similarity(name_norm, ${queryNorm})
      ) AS sim,
      starts_with(name_norm, ${queryNorm}) AS prefix,
      coalesce(popularity, 0) AS pop,
      ${distance(sql, near, 'geom')} AS d
    FROM poi
    WHERE status = 'active'
      AND (
        ${queryNorm} <% name_norm
        OR ${queryCore} <% name_norm
        OR name_norm LIKE ${prefixPattern}
      )
    ORDER BY sim DESC, pop DESC
    LIMIT 20`;
}

export function streetCandidates(sql: Sql, input: CandidateQueryInput) {
  const { queryNorm, prefixPattern, near } = input;
  return sql<CandidateRow[]>`
    SELECT 'street' AS type, NULL AS id, name,
      coalesce(province_norm, '') AS secondary,
      ST_Y(ST_PointOnSurface(geom)) AS lat,
      ST_X(ST_PointOnSurface(geom)) AS lng,
      NULL AS precision,
      greatest(word_similarity(${queryNorm}, name_norm), similarity(name_norm, ${queryNorm})) AS sim,
      starts_with(name_norm, ${queryNorm}) AS prefix,
      0 AS pop,
      ${distance(sql, near, 'geom')} AS d
    FROM street
    WHERE ${queryNorm} <% name_norm OR name_norm LIKE ${prefixPattern}
    ORDER BY sim DESC
    LIMIT 20`;
}

/** Chỉ gọi khi `parsed.housenumber` và `parsed.streetNorm` có giá trị. */
export function addressCandidates(
  sql: Sql,
  input: CandidateQueryInput,
  housenumber: string,
  streetNorm: string,
) {
  const { parsed, near } = input;
  return sql<CandidateRow[]>`
    SELECT 'address' AS type, NULL AS id,
      ${`${housenumber} ${parsed.street ?? ''}`.trim()} AS name,
      concat_ws(', ', ward_norm, province_norm) AS secondary,
      ST_Y(geom) AS lat, ST_X(geom) AS lng, 'rooftop' AS precision,
      greatest(word_similarity(${streetNorm}, street_norm), similarity(street_norm, ${streetNorm})) AS sim,
      false AS prefix, 0 AS pop,
      ${distance(sql, near, 'geom')} AS d
    FROM address_anchor
    WHERE housenumber = ${housenumber} AND ${streetNorm} <% street_norm
    ORDER BY sim DESC
    LIMIT 10`;
}

/** Chạy song song mọi loại được chọn (spec 5.7); trước đây tuần tự là phần lớn độ trễ khi cache lạnh. */
export async function collectCandidates(
  sql: Sql,
  input: CandidateQueryInput,
  types: Set<ItemType>,
): Promise<CandidateRow[]> {
  const queries: Promise<CandidateRow[]>[] = [];
  if (types.has('poi')) queries.push(poiCandidates(sql, input));
  if (types.has('street')) queries.push(streetCandidates(sql, input));
  const { housenumber, streetNorm } = input.parsed;
  if (types.has('address') && housenumber && streetNorm) {
    queries.push(addressCandidates(sql, input, housenumber, streetNorm));
  }
  const results = await Promise.all(queries);
  return results.flat();
}
```

Ghi chú: `distance()` tạo `nearPoint` riêng cho mỗi truy vấn — an toàn vì mỗi truy vấn chạy trên kết nối riêng khi song song.

- [ ] **Step 4: Chạy test**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/autocomplete-sql.test.ts`
Expected: 4 PASS. Nếu test `collectCandidates` đếm `selects` sai vì fragment `ST_SetSRID`/`NULL::float8` cũng bắt đầu bằng chữ khác → chỉ lọc `startsWith('SELECT')` đã đủ vì fragment không bắt đầu bằng `SELECT`.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @mapslibvn/api typecheck`
Expected: OK. Nếu báo `Type 'PendingQuery<…>' is not assignable to 'Promise<CandidateRow[]>'`, đổi mảng `queries` thành `Promise<CandidateRow[]>[]` và bọc `Promise.resolve(poiCandidates(sql, input))` — nhưng `PendingQuery` là thenable nên `Promise.all` chấp nhận; giữ kiểu `Promise<CandidateRow[]>[]` với `as Promise<CandidateRow[]>` nếu cần.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/autocomplete-sql.ts apps/api/test/autocomplete-sql.test.ts
git commit -m "feat(api): truy vấn ứng viên autocomplete dùng word_similarity, chạy song song

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Route autocomplete dùng module mới

**Files:**
- Modify: `apps/api/src/routes/autocomplete.ts`

- [ ] **Step 1: Thay SQL inline bằng `collectCandidates`**

Thay toàn bộ file `apps/api/src/routes/autocomplete.ts` bằng:

```ts
import { nameCore, normalizeVi, parseAddress } from '@mapslibvn/core';
import { Hono } from 'hono';
import { collectCandidates } from '../autocomplete-sql';
import { requireAuth } from '../auth';
import { cachedJson } from '../cache';
import { getSql } from '../db';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { clampInt, parseLatLngPair, parseTypes } from '../params';
import { quotaMiddleware } from '../quota';
import { gridKey, rankScore } from '../ranking';

export const autocomplete = new Hono<AppEnv>();

autocomplete.get('/v1/autocomplete', requireAuth(), quotaMiddleware('places'), async (c) => {
  const query = (c.req.query('q') ?? '').trim();
  if (query.length < 2) {
    throw new ApiError(400, 'invalid_request', 'q phải có ít nhất 2 ký tự');
  }
  const near = parseLatLngPair(c.req.query('near'), 'near');
  const limit = clampInt(c.req.query('limit'), 1, 10, 10, 'limit');
  const types = parseTypes(c.req.query('types'));
  const queryNorm = normalizeVi(query);
  const queryCore = nameCore(query) || queryNorm;
  const queryStartsWithDigit = /^\d/.test(queryNorm);
  if (!queryNorm) {
    throw new ApiError(400, 'invalid_request', 'q không có ký tự tra cứu được');
  }
  // LIKE tận dụng gin_trgm_ops; escape wildcard để giữ đúng nghĩa tiền tố.
  const prefixPattern = `${queryNorm.replace(/[\\%_]/g, '\\$&')}%`;

  // Cache 10 phút theo (q_norm, lưới near, types, limit); stale-if-error 1 giờ.
  const grid = near ? gridKey(near.lat, near.lng) : '-';
  const typeKey = [...types].sort().join('_');
  const cacheUrl = `https://cache.mapslibvn/autocomplete?qn=${encodeURIComponent(queryNorm)}&g=${grid}&t=${typeKey}&l=${limit}`;

  const response = await cachedJson(c.executionCtx, cacheUrl, 600, 3600, async () => {
    const sql = getSql(c.env);
    try {
      const rows = await collectCandidates(
        sql,
        { queryNorm, queryCore, prefixPattern, near, parsed: parseAddress(query) },
        types,
      );
      const items = rows
        .map((row) => ({
          type: row.type,
          ...(row.id ? { id: row.id } : {}),
          name: row.name,
          secondary: row.secondary ?? '',
          lat: row.lat,
          lng: row.lng,
          ...(row.precision ? { precision: row.precision } : {}),
          score:
            Math.round(
              rankScore({
                sim: Number(row.sim),
                prefix: row.prefix,
                dMeters: row.d === null ? null : Number(row.d),
                pop: Number(row.pop),
                type: row.type,
                qStartsWithDigit: queryStartsWithDigit,
              }) * 1000,
            ) / 1000,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
      return { items };
    } catch (error) {
      console.error('autocomplete', error);
      throw new ApiError(503, 'upstream_unavailable', 'Không truy vấn được DB');
    } finally {
      c.executionCtx.waitUntil(sql.end({ timeout: 1 }));
    }
  });
  return response;
});
```

- [ ] **Step 2: Lint, typecheck, test API**

Run: `pnpm lint && pnpm --filter @mapslibvn/api typecheck && pnpm --filter @mapslibvn/api test`
Expected: lint sạch (Biome sắp import theo bảng chữ cái — `../autocomplete-sql` đứng trước `../auth`); 99 test PASS (95 cũ + 4 mới).

- [ ] **Step 3: Chạy thật trên DB dev có fixture**

Chuẩn bị (một lần): `pnpm db:up && pnpm db:migrate && pnpm db:fixture` (fixture Quận 1). Rồi từ `apps/api`: `pnpm --filter @mapslibvn/api dev`. Khoá dev: xem `db/seed/tenant_internal.sql` hoặc `pnpm key:issue`.

```bash
curl -s "http://localhost:8787/v1/autocomplete?q=higland&near=10.776,106.700" -H "X-Api-Key: <khoá dev>" | head -c 600
curl -s "http://localhost:8787/v1/autocomplete?q=coffee%20highlands&near=10.776,106.700" -H "X-Api-Key: <khoá dev>" | head -c 600
```

Expected: cả hai trả `items` có Highlands trong 3 dòng đầu. Nếu `higland` rỗng: kiểm `curl localhost:8787/healthz/db` có `word_similarity_threshold: 0.5` (nếu 0.6 là migration chưa áp lên DB dev).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/autocomplete.ts
git commit -m "feat(api): autocomplete dùng module truy vấn mờ, ba loại chạy song song

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `/v1/search` và fallback `stepStreet` của geocode dùng `<%`

**Files:**
- Modify: `apps/api/src/routes/search.ts:31-41`
- Modify: `apps/api/src/geocode.ts:229-264`
- Modify: `apps/api/test/geocode.test.ts`

- [ ] **Step 1: Test đỏ cho geocode fallback**

Thêm vào `apps/api/test/geocode.test.ts` (import `fakeSql` từ `./helpers/fake-sql`):

```ts
  it('stepStreet: khớp đúng tên trước, thiếu thì fallback bằng q <% name_norm (không dùng %)', async () => {
    const { sql, calls } = fakeSql([]);
    await geocode(sql, 'Nguyen Lam', null, 5);
    const streetQueries = calls.filter((call) => call.text.includes('FROM street'));
    expect(streetQueries).toHaveLength(2);
    expect(streetQueries[0]?.text).toContain('name_norm = $1');
    expect(streetQueries[1]?.text).toContain('$1 <% name_norm');
    expect(streetQueries[1]?.text).not.toMatch(/name_norm % /);
  });
```

Sửa dòng import đầu file thêm: `import { fakeSql } from './helpers/fake-sql';`

- [ ] **Step 2: Chạy để thấy đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/geocode.test.ts`
Expected: FAIL ở assertion `<% name_norm` (chuỗi hiện là `name_norm % $1`).

- [ ] **Step 3: Sửa `geocode.ts`**

Trong `stepStreet`, dòng WHERE hiện là:

```ts
        WHERE ${exact ? sql`name_norm = ${parsed.streetNorm as string}` : sql`name_norm % ${parsed.streetNorm as string}`}
```

đổi thành:

```ts
        WHERE ${exact ? sql`name_norm = ${parsed.streetNorm as string}` : sql`${parsed.streetNorm as string} <% name_norm`}
```

và sửa chú thích hàm thành `/** Bước 4 — khớp đường (đúng tên, rồi word_similarity spec 05/09), ưu tiên hành chính trong câu rồi khoảng cách near: 0.4. */`.

- [ ] **Step 4: Sửa `search.ts`**

Thay hai dòng trong truy vấn:

```ts
        ${queryNorm ? sql`AND (p.name_norm % ${queryNorm} OR starts_with(p.name_norm, ${queryNorm}))` : sql``}
```
→
```ts
        ${queryNorm ? sql`AND (${queryNorm} <% p.name_norm OR p.name_norm LIKE ${prefixPattern})` : sql``}
```

và

```ts
      ORDER BY ${queryNorm ? sql`similarity(p.name_norm, ${queryNorm}) DESC` : nearPoint ? sql`d ASC` : sql`p.updated_at DESC`}
```
→
```ts
      ORDER BY ${
        queryNorm
          ? sql`greatest(word_similarity(${queryNorm}, p.name_norm), similarity(p.name_norm, ${queryNorm})) DESC, p.popularity DESC NULLS LAST`
          : nearPoint
            ? sql`d ASC`
            : sql`p.updated_at DESC`
      }
```

Thêm sau dòng `const queryNorm = …`:

```ts
  const prefixPattern = `${queryNorm.replace(/[\\%_]/g, '\\$&')}%`;
```

(`starts_with` bỏ vì trong OR nó buộc quét bảng — cùng lý do đã sửa ở autocomplete `72f78a2`.)

- [ ] **Step 5: Test, lint, typecheck**

Run: `pnpm lint && pnpm --filter @mapslibvn/api typecheck && pnpm --filter @mapslibvn/api test`
Expected: 100 test PASS. Biome có thể đòi định dạng lại ternary lồng — chạy `pnpm lint:fix` rồi kiểm lại.

- [ ] **Step 6: Kiểm search trên DB dev**

Run (wrangler dev đang chạy):
```bash
curl -s "http://localhost:8787/v1/search?q=higlands&near=10.776,106.700&limit=3" -H "X-Api-Key: <khoá dev>" | head -c 500
curl -s "http://localhost:8787/v1/geocode?q=Nguyen%20Hue%20Quan%201" -H "X-Api-Key: <khoá dev>" | head -c 500
```
Expected: search trả Highlands; geocode trả `precision: "street"` cho Nguyễn Huệ.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/search.ts apps/api/src/geocode.ts apps/api/test/geocode.test.ts
git commit -m "feat(api): search và fallback đường của geocode dùng word_similarity

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Docs

**Files:**
- Modify: `apps/docs/src/content/docs/tim-kiem.md:136-138`
- Modify: `apps/docs/src/content/docs/api.md` (mục `GET /v1/autocomplete`, sau đoạn mô tả tham số)

- [ ] **Step 1: `tim-kiem.md`**

Sau đoạn kết thúc bằng "…dùng chung kết quả." (dòng ~138) thêm:

```markdown
Khớp tên **chịu lỗi gõ nhẹ và đảo từ**: `higland`, `coffee highlands` hay `cho ray benh vien` vẫn
trả đúng địa điểm, vì API so truy vấn với **từng đoạn từ** của tên (word similarity trên trigram),
không so cả chuỗi. Truy vấn 2–3 ký tự khớp mọi tên có từ bắt đầu bằng chuỗi đó, nên kết quả khi
gõ ít ký tự chủ yếu do khoảng cách tới `near` và độ phổ biến quyết định.
```

- [ ] **Step 2: `api.md`**

Trong mục `### GET /v1/autocomplete`, sau bảng tham số, thêm một đoạn:

```markdown
Cách khớp tên (từ 05/09/2026): tiền tố (`name_norm LIKE 'q%'`) **hoặc** `word_similarity(q, name_norm)`
vượt ngưỡng 0,5 của pg_trgm. Nhờ đó lỗi gõ 1–2 ký tự, truy vấn ngắn hơn tên và đảo thứ tự từ vẫn
khớp. `search` và bước đường của `geocode` dùng cùng cách khớp.
```

- [ ] **Step 3: Build docs + link check**

Run: `pnpm --filter @mapslibvn/docs build`
Expected: build 20 trang thành công. (E2E docs chạy trong cổng cuối Task 8.)

- [ ] **Step 4: Commit**

```bash
git add apps/docs/src/content/docs/tim-kiem.md apps/docs/src/content/docs/api.md
git commit -m "docs: mô tả khớp tên chịu lỗi gõ và đảo từ

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Cổng CI đầy đủ, push, phát hành, đo sau

**Files:**
- Modify: `docs/DEVLOG.md` (mục 2 và mục 4)

- [ ] **Step 1: Cổng local**

Run:
```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @mapslibvn/docs build
```
Expected: lint sạch; typecheck 14 task; vitest root ≥ 622 test + 2 mới ở `perf-autocomplete.test.mjs`; API 100 test; build docs OK. Ghi số thật vào DEVLOG.

- [ ] **Step 2: Push và theo dõi CI**

```bash
git push
gh run list --limit 6
```
Expected: `CI`, `Deploy API`, `Deploy Docs`, `API tests (Places, real DB)` xanh; `DB tests` cũng chạy (chạm `db/`) — phải xanh vì runner có tippecanoe.

- [ ] **Step 3: Áp migration lên production**

Trên máy chủ nội bộ (PHONG chạy, không tự động): `pnpm server:update` — script này áp migration mới (`0007`) rồi khởi động lại container. Kiểm:

```bash
curl -s https://api.ai-solutions.io.vn/healthz/db
```
Expected: `"user":"api"`, `"word_similarity_threshold":0.5`. Nếu vẫn `0.6`: migration chưa áp; **API vẫn chạy đúng** với ngưỡng mặc định 0,6 (chặt hơn), không phải sự cố.

- [ ] **Step 4: Đo sau**

```bash
node scripts/perf-autocomplete.mjs https://api.ai-solutions.io.vn '<khoá nội bộ>' --queries scripts/fixtures/fuzzy-queries.txt
```
Chạy hai lần như Task 0. Tiêu chí (spec mục 11): `hit@3 ≥ 36/40`; p95 lần 1 (cache lạnh) ≤ baseline + 50 ms. Nếu `hit@3` thiếu: xem `miss:`; lỗi thường gặp là cột `đích` không đúng tên thật (sửa fixture) hoặc ngưỡng 0,5 quá chặt cho lỗi gõ 2 ký tự trên từ ngắn (ghi lại, **không** đổi ngưỡng trong plan này — quyết định ở plan hạng mục 3 khi có `stage_hit`).

- [ ] **Step 5: DEVLOG**

Mục 2 "Bước kế tiếp": thêm mục "05/09/2026 — Tìm mờ bằng `word_similarity` (hạng mục 2 spec 05/09)" ghi: commit phát hành, số test cổng local, run ID CI, baseline vs sau (`p95`, `hit@3` cả hai lần), kết luận tiêu chí 3–4 đạt/không. Mục 4 "Nhật ký": một dòng `2026-09-05 · Tìm mờ T0–T8 · word_similarity + song song · <sha>`.

- [ ] **Step 6: Commit + push**

```bash
git add docs/DEVLOG.md
git commit -m "docs: nghiệm thu tìm mờ word_similarity — số đo trước/sau

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push
```

---

## Tự rà theo spec

- 5.1 lớp lỗi "thiếu dấu, gõ sai, một phần tên, đảo từ": Task 4–6. "Đang gõ dở nhiều từ", "dính/tách từ", "telex": **cố ý để plan hạng mục 3** (bậc 2–3, 3b) — spec mục 13 xếp vậy.
- 5.2 GUC cấp role → plan đổi thành **cấp database** (lý do ở Task 1); cần sửa một câu trong spec khi plan này xong: mục 5.2 và mục 8 "ALTER ROLE api SET" → "ALTER DATABASE … SET".
- 5.3: `name_alt_norm` chưa có cột — nhánh `<% name_alt_norm` thuộc hạng mục 3 (6.3). Bậc 1 ở plan này chưa có nhánh đó.
- 5.7: song song hoá (Task 4), bộ 40 truy vấn + `perf-autocomplete` (Task 0), `STAGE_PENALTY` và `stage_hit` **chưa** — chỉ có ý nghĩa khi có ≥ 2 bậc, để hạng mục 3.
- 11 tiêu chí 3, 4, 7: Task 8. Tiêu chí 7 phần "test apps/api không cần Postgres": Task 3–6 dùng `fakeSql`.
- Kiểu/tên nhất quán: `CandidateQueryInput`, `collectCandidates`, `poiCandidates`, `streetCandidates`, `addressCandidates`, `fakeSql` → `{ sql, calls }`, `parseQueryFixture`, `result.hit3` dùng đúng ở mọi task.
