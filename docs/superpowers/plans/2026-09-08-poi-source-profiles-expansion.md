# Mở rộng profile POI Overture và Foursquare — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bổ sung và phát hành nguyên tử ba profile `overture-fsq`, `overture`, `fsq` xuyên suốt archive, manifest, API, SDK, playground và production.

**Architecture:** `POI_SOURCE_PROFILES` là registry duy nhất; pipeline sinh release và các bước export/QA/upload/smoke từ registry thay vì hard-code `all`/`osm`. Bootstrap ba profile mới dùng một snapshot bất biến và chỉ cập nhật manifest một lần sau mọi gate; các lần `data:update --poi` sau đó dựng đủ năm profile.

**Tech Stack:** TypeScript, Node ESM, Vitest, Hono/Cloudflare Workers, PostgreSQL, PMTiles/tippecanoe, R2/KV/Wrangler, MapLibre, Astro/Playwright.

**Spec:** `docs/superpowers/specs/2026-09-08-poi-source-profiles-expansion-design.md`

## Global Constraints

- `all` vẫn là mặc định; không đổi release `all`/`osm` đang phục vụ trong bootstrap.
- Profile mới dùng key/prefix chính xác: `overture-fsq`/`poi-overture-fsq`, `overture`/`poi-overture`, `fsq`/`poi-fsq`.
- Mọi profile luôn giữ `created_by='user'`; không đổi schema, conflate, taxonomy, attribution hoặc `/v1/places/{id}`.
- Một batch dùng đúng một `buildId` và snapshot SHA-256; manifest là commit point cuối cùng.
- Mỗi archive POI phải không vượt `300 * 2 ** 20` byte và có companion `.sha256` hợp lệ.
- Giữ tương thích manifest cũ, `--poi-osm`, `poiReleasePair()` và state R2 có `poiOsm`.
- Không publish npm khi cổng pháp lý hiện hữu chưa được duyệt.
- Với thay đổi hành vi: chạy RED trước GREEN; trước mỗi commit chạy test mục tiêu, `pnpm lint` và `pnpm typecheck` phù hợp.

---

### Task 1: Mở rộng registry profile trong core

**Files:**
- Modify: `packages/core/src/poi-sources.test.ts`
- Modify: `packages/core/src/poi-sources.ts`

**Interfaces:**
- Consumes: `PoiSource = 'osm' | 'overture' | 'fsq'` và thứ tự chuẩn `POI_SOURCES`.
- Produces: `PoiSourceProfile = keyof typeof POI_SOURCE_PROFILES`; `profileForSources()` nhận đủ năm tập archive.

- [x] **Step 1: Viết test đỏ cho ba profile mới và thứ tự chuẩn**

```ts
it('có đủ năm profile archive và suy ra đúng tập nguồn', () => {
  expect(POI_SOURCE_PROFILES).toEqual({
    all: ['osm', 'overture', 'fsq'],
    osm: ['osm'],
    'overture-fsq': ['overture', 'fsq'],
    overture: ['overture'],
    fsq: ['fsq'],
  });
  expect(profileForSources(['fsq', 'overture'])).toBe('overture-fsq');
  expect(profileForSources(['overture'])).toBe('overture');
  expect(profileForSources(['fsq'])).toBe('fsq');
  expect(profileForSources(['osm', 'overture'])).toBeNull();
});
```

- [x] **Step 2: Chạy RED**

Run: `pnpm vitest run packages/core/src/poi-sources.test.ts`

Expected: FAIL vì registry chưa có `overture-fsq`, `overture`, `fsq`.

- [x] **Step 3: Sửa registry và type**

```ts
export const POI_SOURCE_PROFILES = {
  all: ['osm', 'overture', 'fsq'],
  osm: ['osm'],
  'overture-fsq': ['overture', 'fsq'],
  overture: ['overture'],
  fsq: ['fsq'],
} as const satisfies Readonly<Record<string, readonly PoiSource[]>>;

export type PoiSourceProfile = keyof typeof POI_SOURCE_PROFILES;
```

Giữ nguyên `DEFAULT_POI_SOURCES`, parsing và SQL clause.

- [x] **Step 4: Chạy GREEN và build core**

Run: `pnpm vitest run packages/core/src/poi-sources.test.ts && pnpm --filter @mapslibvn/core build`

Expected: toàn bộ test file PASS; build/size-limit exit 0.

- [x] **Step 5: Commit lát core**

```bash
git add packages/core/src/poi-sources.ts packages/core/src/poi-sources.test.ts
git commit -m "feat(core): bổ sung profile POI Overture và Foursquare"
```

---

### Task 2: Tổng quát hoá release ID, manifest, tiles và rollback

**Files:**
- Modify: `pipelines/tiles/src/lib/dates.test.mjs`
- Modify: `pipelines/tiles/src/lib/dates.mjs`
- Modify: `pipelines/tiles/src/lib/manifest-state.test.mjs`
- Modify: `pipelines/tiles/src/lib/manifest-state.mjs`
- Modify: `pipelines/tiles/src/manifest.mjs`
- Modify: `apps/api/src/manifest.ts`
- Modify: `apps/api/src/routes/tiles.ts`
- Modify: `apps/api/test/tiles.test.ts`
- Modify: `pipelines/tiles/src/smoke.mjs`
- Modify: `scripts/data-rollback.test.mjs`
- Modify: `scripts/data-rollback.mjs`

**Interfaces:**
- Consumes: năm key từ `POI_SOURCE_PROFILES` và `poiReleasePrefix(profile)`.
- Produces: `poiReleaseSet(profiles, date?, nonce?) -> { buildId, releases }`; manifest flag lặp `--poi-profile profile=release`; rollback kiểm mọi giá trị trong `poiProfiles`.

- [x] **Step 1: Viết test đỏ cho release set và giữ wrapper cũ**

```js
expect(
  poiReleaseSet(['overture-fsq', 'overture', 'fsq'], new Date('2026-09-08T10:00:00Z'), 'a1b2c3d4'),
).toEqual({
  buildId: '20260908-170000-a1b2c3d4',
  releases: {
    'overture-fsq': 'poi-overture-fsq-20260908-170000-a1b2c3d4',
    overture: 'poi-overture-20260908-170000-a1b2c3d4',
    fsq: 'poi-fsq-20260908-170000-a1b2c3d4',
  },
});
expect(poiReleasePair(new Date('2026-09-08T10:00:00Z'), 'a1b2c3d4').poiOsm)
  .toBe('poi-osm-20260908-170000-a1b2c3d4');
```

- [x] **Step 2: Viết test đỏ cho manifest động và tương thích CLI cũ**

```js
expect(
  nextManifest(current, [
    '--poi-profile', 'overture-fsq=poi-overture-fsq-2',
    '--poi-profile', 'overture=poi-overture-2',
    '--poi-profile', 'fsq=poi-fsq-2',
  ], at),
).toMatchObject({
  poiProfiles: {
    osm: 'poi-osm-1',
    'overture-fsq': 'poi-overture-fsq-2',
    overture: 'poi-overture-2',
    fsq: 'poi-fsq-2',
  },
});
expect(nextManifest(current, ['--poi-osm', 'poi-osm-2'], at).poiProfiles.osm)
  .toBe('poi-osm-2');
expect(() => nextManifest(current, ['--poi-profile', 'banana=poi-banana-2'], at))
  .toThrow(/profile/i);
```

- [x] **Step 3: Viết test đỏ cho tile set và rollback nhiều profile**

```ts
for (const set of ['poi-overture-fsq', 'poi-overture', 'poi-fsq']) {
  const res = await SELF.fetch(`https://api/tiles/${set}.json`);
  expect(res.status).toBe(200);
}
```

```js
expect(verifyRollbackArchives({
  poi: 'poi-old',
  poiProfiles: { osm: 'poi-osm-old', overture: 'poi-overture-old', fsq: 'poi-fsq-old' },
}, listed, readChecksum).map(({ release }) => release)).toEqual([
  'poi-old', 'poi-osm-old', 'poi-overture-old', 'poi-fsq-old',
]);
```

- [x] **Step 4: Chạy RED**

Run: `pnpm vitest run pipelines/tiles/src/lib/dates.test.mjs pipelines/tiles/src/lib/manifest-state.test.mjs apps/api/test/tiles.test.ts scripts/data-rollback.test.mjs`

Expected: FAIL vì release/manifest/tiles/rollback còn hard-code `osm`.

- [x] **Step 5: Implement release map và parser manifest động**

```js
export function poiReleaseSet(profiles, date = new Date(), nonce = randomBytes(4).toString('hex')) {
  if (!/^[a-z0-9]+$/i.test(nonce)) throw new Error('POI build nonce không hợp lệ');
  const buildId = `${stampVNTime(date)}-${nonce}`;
  const releases = Object.fromEntries(
    profiles.map((profile) => [profile, `${profile === 'all' ? 'poi' : `poi-${profile}`}-${buildId}`]),
  );
  return { buildId, releases };
}
```

Trong `nextManifest`, gom mọi lần xuất hiện của `--poi-profile`, tách đúng một dấu `=`, xác thực
profile qua registry và merge vào `current.poiProfiles`. Chuyển `--poi-osm value` thành entry
`osm=value` trước khi merge; `--poi` vẫn cập nhật field top-level.

- [x] **Step 6: Tổng quát tile/smoke/rollback**

```ts
export interface Manifest {
  vn: string | null;
  poi: string | null;
  poiProfiles?: Partial<Record<Exclude<PoiSourceProfile, 'all'>, string | null>>;
  updatedAt?: string;
}
```

Trong tile resolver, tập set hợp lệ là `vn`, `poi` và `poi-${profile}` cho mọi profile khác `all`.
Trong smoke, `const isPoi = set === 'poi' || set.startsWith('poi-')`. Trong rollback:

```js
const releases = [target.poi, ...Object.values(target.poiProfiles ?? {})].filter(
  (release) => typeof release === 'string' && release.length > 0,
);
```

- [x] **Step 7: Chạy GREEN và static gates**

Run: `pnpm vitest run pipelines/tiles/src/lib/dates.test.mjs pipelines/tiles/src/lib/manifest-state.test.mjs apps/api/test/tiles.test.ts scripts/data-rollback.test.mjs && pnpm lint && pnpm typecheck`

Expected: test PASS; lint/typecheck exit 0.

- [x] **Step 8: Commit lát release/manifest**

```bash
git add pipelines/tiles/src/lib/dates.mjs pipelines/tiles/src/lib/dates.test.mjs pipelines/tiles/src/lib/manifest-state.mjs pipelines/tiles/src/lib/manifest-state.test.mjs pipelines/tiles/src/manifest.mjs pipelines/tiles/src/smoke.mjs apps/api/src/manifest.ts apps/api/src/routes/tiles.ts apps/api/test/tiles.test.ts scripts/data-rollback.mjs scripts/data-rollback.test.mjs
git commit -m "refactor(pipeline): tổng quát release và manifest profile POI"
```

---

### Task 3: Batch bootstrap ba archive từ một snapshot

**Files:**
- Modify: `scripts/lib/poi-profile.test.mjs`
- Modify: `scripts/lib/poi-profile.mjs`
- Modify: `scripts/poi-profile-publish.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `poiReleaseSet()`, `sourcesForProfile()`, `poiReleasePrefix()`.
- Produces: `profileBatchSteps({ profiles, releases, buildId, snapshot, out })`; CLI `pnpm poi:profile --profiles overture-fsq,overture,fsq`.

- [x] **Step 1: Viết test đỏ cho thứ tự batch và manifest-last**

```js
const steps = profileBatchSteps({
  profiles: ['overture-fsq', 'overture', 'fsq'],
  releases: {
    'overture-fsq': 'poi-overture-fsq-run',
    overture: 'poi-overture-run',
    fsq: 'poi-fsq-run',
  },
  buildId: 'run',
  snapshot: '/app/work/poi/snapshot-run.jsonl',
  out: '/app/out',
});
expect(steps.filter(({ id }) => id.startsWith('export-'))).toHaveLength(3);
expect(steps.at(-1)).toEqual({
  id: 'manifest',
  command: 'node',
  args: [
    'pipelines/tiles/src/manifest.mjs', 'set',
    '--poi-profile', 'overture-fsq=poi-overture-fsq-run',
    '--poi-profile', 'overture=poi-overture-run',
    '--poi-profile', 'fsq=poi-fsq-run',
  ],
});
```

Thêm test fault injection: ném tại `export-fsq`, `upload-overture`, `smoke-overture-fsq`; trong từng
ca, executor chưa bao giờ nhận step `manifest`.

- [x] **Step 2: Chạy RED**

Run: `pnpm vitest run scripts/lib/poi-profile.test.mjs`

Expected: FAIL vì chưa có `profileBatchSteps`.

- [x] **Step 3: Implement step generator thuần**

Với mỗi profile sinh `export-${profile}` và `qa-${profile}`; sau khi toàn bộ export/QA xong mới sinh
toàn bộ upload, toàn bộ smoke, cuối cùng đúng một step manifest. Export args luôn có:

```js
[
  'pipelines/poi/src/export-tiles.mjs',
  '--release', releases[profile],
  '--sources', profile,
  '--snapshot', snapshot,
  '--build-id', buildId,
]
```

- [x] **Step 4: Sửa CLI thành batch an toàn**

CLI parse `--profiles` thành danh sách bỏ trùng, từ chối `all`, `osm`, profile lạ hoặc danh sách
rỗng trong bootstrap này. Ở trong container: mở tunnel, tạo release set, chạy
`export-snapshot.mjs --build-id`, rồi chạy tuần tự `profileBatchSteps`. `--dry-run` chỉ in JSON kế
hoạch và không mở tunnel/ghi remote. Giữ `--profile osm` làm đường tương thích một-profile cũ.

- [x] **Step 5: Chạy GREEN và dry-run**

Run: `pnpm vitest run scripts/lib/poi-profile.test.mjs && pnpm poi:profile --profiles overture-fsq,overture,fsq --dry-run`

Expected: test PASS; JSON dry-run có một snapshot, 3 export, 3 QA, 3 upload, 3 smoke, 1 manifest.

- [x] **Step 6: Commit batch bootstrap**

```bash
git add package.json scripts/lib/poi-profile.mjs scripts/lib/poi-profile.test.mjs scripts/poi-profile-publish.mjs
git commit -m "feat(pipeline): phát hành nguyên tử batch profile POI"
```

---

### Task 4: Dựng đủ năm profile trong data update và DB fixture

**Files:**
- Modify: `scripts/lib/update-plan.test.mjs`
- Modify: `scripts/lib/update-plan.mjs`
- Modify: `scripts/data-update.mjs`
- Modify: `pipelines/poi/tests/pipeline-fixture.dbtest.mjs`

**Interfaces:**
- Consumes: `poiReleaseSet(Object.keys(POI_SOURCE_PROFILES))` và batch step contract Task 3.
- Produces: mọi `data:update --poi` sau này publish năm profile từ một snapshot; state mới có `releases.poiProfiles` và vẫn đọc `poiOsm` cũ.

- [ ] **Step 1: Viết test đỏ cho năm profile và manifest-last**

```js
const steps = poiReleaseSteps({
  releases: {
    all: 'poi-run', osm: 'poi-osm-run',
    'overture-fsq': 'poi-overture-fsq-run', overture: 'poi-overture-run', fsq: 'poi-fsq-run',
  },
  buildId: 'run', snapshot: '/app/work/poi/snapshot-run.jsonl', out: '/app/out',
});
expect(steps.filter(({ id }) => id.startsWith('export-'))).toHaveLength(5);
expect(steps.at(-1)?.id).toBe('manifest');
```

Thêm test `nextState` chuyển `poiOsm` lịch sử thành `poiProfiles.osm` mà không mất release.

- [ ] **Step 2: Mở rộng DB fixture trước implementation**

Tạo archive fixture cho `overture-fsq`, `overture`, `fsq` từ cùng snapshot hiện hữu. Assert theo ID:
POI primary tương ứng có mặt, primary khác vắng, POI user không cạnh tranh có mặt trong cả năm;
không assert archive này là tập con archive kia vì thinning chạy độc lập.

- [ ] **Step 3: Chạy RED unit và DB**

Run: `pnpm vitest run scripts/lib/update-plan.test.mjs`

Run: `docker compose --env-file .env -f infra/dev/compose.yml --profile pipeline run --rm pipeline pnpm test:db`

Expected: unit và fixture mới FAIL vì orchestration chỉ dựng `all`/`osm`.

- [ ] **Step 4: Implement orchestration registry-driven**

Trong `data-update.mjs`, tạo một release set cho `Object.keys(POI_SOURCE_PROFILES)`, chụp một
snapshot, truyền release map vào `poiReleaseSteps`, rồi ghi state:

```js
built.poi = poiReleases.releases.all;
built.poiProfiles = Object.fromEntries(
  Object.entries(poiReleases.releases).filter(([profile]) => profile !== 'all'),
);
```

`nextState` merge map mới và vẫn expose/read `poiOsm` trong state cũ khi cần tương thích.

- [ ] **Step 5: Chạy GREEN**

Run: `pnpm vitest run scripts/lib/update-plan.test.mjs scripts/lib/poi-profile.test.mjs`

Run: `docker compose --env-file .env -f infra/dev/compose.yml --profile pipeline run --rm pipeline pnpm test:db`

Expected: unit PASS; DB gate 0 failure và đủ năm archive fixture.

- [ ] **Step 6: Commit data-update**

```bash
git add scripts/data-update.mjs scripts/lib/update-plan.mjs scripts/lib/update-plan.test.mjs pipelines/poi/tests/pipeline-fixture.dbtest.mjs
git commit -m "feat(pipeline): dựng năm profile POI từ cùng snapshot"
```

---

### Task 5: Mở profile mới trên API và khóa ngữ nghĩa PostgreSQL

**Files:**
- Modify: `apps/api/test/styles.test.ts`
- Modify: `apps/api/test-db/places.itest.mjs`
- Modify only if tests expose a gap: `apps/api/src/routes/styles.ts`
- Modify only if tests expose a gap: `apps/api/src/manifest.ts`

**Interfaces:**
- Consumes: registry/profile mapping Task 1 và manifest generic Task 2.
- Produces: style headers/archive đúng cho ba profile; Places API partition đúng và cache không lẫn.

- [ ] **Step 1: Viết test style đỏ dạng table**

```ts
it.each([
  ['overture,fsq', 'overture-fsq', 'poi-overture-fsq-2'],
  ['overture', 'overture', 'poi-overture-2'],
  ['fsq', 'fsq', 'poi-fsq-2'],
])('sources=%s dùng profile %s', async (sources, profile, release) => {
  const res = await SELF.fetch(`https://api/v1/styles/light.json?sources=${sources}`);
  expect(res.status).toBe(200);
  expect(res.headers.get('x-poi-profile')).toBe(profile);
  expect(JSON.stringify(await res.json())).toContain(`/tiles/${release}.pmtiles`);
});
```

Manifest fixture chứa đủ ba key. Thêm một test thiếu key `fsq` trả `all;fallback`.

- [ ] **Step 2: Mở rộng DB matrix**

Với fixture ID cố định hiện hữu, assert search/nearby/autocomplete cho `overture,fsq` bằng hợp của
hai nguồn cộng POI user; `overture` và `fsq` chỉ có nguồn tương ứng cộng user. Reverse phải chọn lại
POI gần nhất trong từng profile. Chạy cache theo `overture -> fsq` và `fsq -> overture-fsq` để khóa
namespace.

- [ ] **Step 3: Chạy RED**

Run: `pnpm --filter @mapslibvn/core build && pnpm vitest run apps/api/test/styles.test.ts`

Run: `pnpm test:api-db`

Expected: style test FAIL trước registry/manifest implementation; DB assertions ghi nhận baseline và
phải PASS nếu filter generic hiện tại đúng. Nếu DB test PASS ngay, giữ test làm acceptance evidence.

- [ ] **Step 4: Implement tối thiểu nếu test còn đỏ**

Không thêm switch profile. `styles.ts` tiếp tục dùng `profileForSources`; `poiReleaseFor` index trực
tiếp `m.poiProfiles?.[profile]`. Chỉ sửa code nếu lỗi test chứng minh có nhánh hard-code.

- [ ] **Step 5: Chạy GREEN**

Run: `pnpm --filter @mapslibvn/api test && pnpm test:api-db`

Expected: API unit và API PostgreSQL thật đều 0 failure.

- [ ] **Step 6: Commit API contract**

```bash
git add apps/api/test/styles.test.ts apps/api/test-db/places.itest.mjs apps/api/src/routes/styles.ts apps/api/src/manifest.ts
git commit -m "test(api): khóa ba profile POI mới"
```

Chỉ stage các file source trong danh sách nếu chúng thực sự thay đổi.

---

### Task 6: Khóa contract SDK Web, React và React Native

**Files:**
- Modify: `packages/core/src/client.test.ts`
- Modify: `packages/web/src/map.test.ts`
- Create: `packages/react/src/map.test.tsx`
- Modify: `packages/react/src/use-places.test.ts`
- Modify: `packages/react-native/src/map.test.tsx`
- Modify source SDK only if a failing test exposes hard-coding.

**Interfaces:**
- Consumes: `ClientOptions.poiSources?: PoiSource[]` hiện hữu.
- Produces: URL/API/style và wrapper map nhận ba cấu hình mới, không đổi option hay default.

- [ ] **Step 1: Viết test table cho client URL**

```ts
it.each([
  [['fsq', 'overture'], 'overture,fsq'],
  [['overture'], 'overture'],
  [['fsq'], 'fsq'],
] as const)('chuẩn hoá poiSources %j', async (poiSources, expected) => {
  const fetch = okFetch({ items: [] });
  const client = createClient({ apiKey: 'k', baseUrl: 'https://api.test', fetch, poiSources });
  await client.search('cafe');
  expect((fetch.mock.calls[0] as unknown as [URL])[0].searchParams.get('sources')).toBe(expected);
  expect(new URL(client.styleUrl('light')).searchParams.get('sources')).toBe(expected);
});
```

- [ ] **Step 2: Mở rộng wrapper tests**

Web assert `createMap({ poiSources: ['overture', 'fsq'] })` không ném và style URL có
`overture,fsq`; tổ hợp `['osm','overture']` vẫn ném. React/React Native assert prop `['fsq']` đi vào
client/style và đổi prop tạo lại đúng như behavior hiện hữu.

- [ ] **Step 3: Chạy tests**

Run: `pnpm vitest run packages/core/src/client.test.ts packages/web/src/map.test.ts packages/react/src/map.test.tsx packages/react/src/use-places.test.ts packages/react-native/src/map.test.tsx`

Expected: PASS sau Task 1 nếu SDK đã hoàn toàn generic; bất kỳ FAIL nào chỉ được sửa tại nhánh
hard-code được test chỉ ra.

- [ ] **Step 4: Build bốn package SDK**

Run: `pnpm --filter @mapslibvn/core build && pnpm --filter @mapslibvn/web build && pnpm --filter @mapslibvn/react build && pnpm --filter @mapslibvn/react-native build`

Expected: build và size-limit exit 0; không bump version, không publish npm.

- [ ] **Step 5: Commit SDK tests/source cần thiết**

```bash
git add packages/core/src/client.test.ts packages/web/src/map.test.ts packages/react/src/map.test.tsx packages/react/src/use-places.test.ts packages/react-native/src/map.test.tsx packages/core/src/client.ts packages/web/src/map.ts packages/react/src/map.tsx packages/react-native/src/map.tsx
git commit -m "test(sdk): khóa profile Overture và Foursquare"
```

Chỉ stage source thực sự thay đổi; không stage `dist`.

---

### Task 7: Mở đủ năm lựa chọn trong playground

**Files:**
- Modify: `apps/docs/scripts/playground-lib.test.mjs`
- Modify: `apps/docs/public/playground-lib.js`
- Modify: `apps/docs/public/playground.html`
- Modify: `apps/docs/public/playground.js`
- Modify: `apps/docs/e2e/playground.spec.ts`

**Interfaces:**
- Consumes: URL `sources` dạng CSV và SDK `poiSources`.
- Produces: selector, share URL, client/map options và snippet đồng bộ cho năm profile.

- [ ] **Step 1: Viết unit tests đỏ cho parse/serialize/snippet**

```js
it.each([
  ['?sources=overture,fsq', 'overture-fsq', "poiSources: ['overture', 'fsq']"],
  ['?sources=overture', 'overture', "poiSources: ['overture']"],
  ['?sources=fsq', 'fsq', "poiSources: ['fsq']"],
])('đọc %s', (search, profile, snippet) => {
  const state = parseState(search, API);
  expect(state.sources).toBe(profile);
  expect(toSearchParams(state, API).get('sources')).toBe(
    profile === 'overture-fsq' ? 'overture,fsq' : profile,
  );
  expect(buildSnippet(state, 'script')).toContain(snippet);
});
```

- [ ] **Step 2: Chạy RED**

Run: `pnpm vitest run apps/docs/scripts/playground-lib.test.mjs`

Expected: FAIL vì parser hiện chỉ nhận `all`/`osm`.

- [ ] **Step 3: Implement mapping tập trung**

```js
export const POI_PROFILE_SOURCES = {
  all: ['osm', 'overture', 'fsq'],
  osm: ['osm'],
  'overture-fsq': ['overture', 'fsq'],
  overture: ['overture'],
  fsq: ['fsq'],
};
```

`parseState` đổi CSV chuẩn thành key; `toSearchParams` đổi key thành CSV; `optionLines`, `makeClient`
và `buildMap` dùng một helper trả `poiSources` và bỏ option khi profile là `all`.

- [ ] **Step 4: Thêm option UI và E2E**

```html
<option value="overture-fsq">Overture + Foursquare</option>
<option value="overture">Chỉ Overture</option>
<option value="fsq">Chỉ Foursquare</option>
```

E2E chọn từng option, bấm Áp dụng, assert query string, snippet và request style có `sources` tương
ứng; thu `page.on('console')` và assert không có error.

- [ ] **Step 5: Chạy GREEN và docs E2E**

Run: `pnpm vitest run apps/docs/scripts/playground-lib.test.mjs`

Run: `pnpm --filter @mapslibvn/docs e2e -- --grep "Nguồn POI"`

Expected: unit và E2E PASS.

- [ ] **Step 6: Commit playground**

```bash
git add apps/docs/scripts/playground-lib.test.mjs apps/docs/public/playground-lib.js apps/docs/public/playground.html apps/docs/public/playground.js apps/docs/e2e/playground.spec.ts
git commit -m "feat(docs): mở ba profile POI mới trong playground"
```

---

### Task 8: Tổng quát benchmark paired-sources

**Files:**
- Modify: `scripts/perf-autocomplete.test.mjs`
- Modify: `scripts/perf-autocomplete.mjs`

**Interfaces:**
- Consumes: source CSV chuẩn của API.
- Produces: CLI `--paired-sources <csv>` so target với `all`; cờ không có giá trị vẫn mặc định `osm`
  để tương thích runbook cũ.

- [ ] **Step 1: Viết test đỏ cho CLI target động**

```js
expect(parseCliArgs([
  'https://api.test', 'mlv_live_test', '--paired-sources', 'overture,fsq', '--rounds', '5',
])).toMatchObject({
  base: 'https://api.test',
  key: 'mlv_live_test',
  pairedSources: 'overture,fsq',
  rounds: 5,
});
expect(parseCliArgs(['https://api.test', 'k', '--paired-sources']).pairedSources).toBe('osm');
```

- [ ] **Step 2: Chạy RED**

Run: `pnpm vitest run scripts/perf-autocomplete.test.mjs`

Expected: FAIL vì parser hiện chỉ trả boolean.

- [ ] **Step 3: Implement optional flag value và cohort động**

Parser tiêu thụ token sau `--paired-sources` khi token đó tồn tại và không bắt đầu bằng `--`; nếu
không có thì dùng `osm`. Validate CSV chỉ nhận `osm`, `overture`, `fsq`, bỏ trùng và serialize theo
thứ tự chuẩn. CLI tạo cohorts:

```js
[
  { label: pairedSources, sources: pairedSources },
  { label: 'all', sources: 'all' },
]
```

Cập nhật help thành:

```text
--paired-sources [osm|overture,fsq|overture|fsq] [--rounds N]
```

- [ ] **Step 4: Chạy GREEN và typecheck script**

Run: `pnpm vitest run scripts/perf-autocomplete.test.mjs && pnpm typecheck`

Expected: test PASS; typecheck exit 0.

- [ ] **Step 5: Commit benchmark harness**

```bash
git add scripts/perf-autocomplete.mjs scripts/perf-autocomplete.test.mjs
git commit -m "test(perf): đo paired cho mọi profile POI"
```

---

### Task 9: Đồng bộ tài liệu và chạy toàn bộ gate local

**Files:**
- Modify: `apps/docs/src/content/docs/api.md`
- Modify: `apps/docs/src/content/docs/ban-do-web.md`
- Modify: `apps/docs/src/content/docs/react.md`
- Modify: `apps/docs/src/content/docs/react-native.md`
- Modify: `apps/docs/src/content/docs/tim-kiem.md`
- Modify: `apps/docs/src/content/docs/tinh-nang.md`
- Modify: `apps/docs/src/content/docs/sdk.md`
- Modify: `docs/DEVLOG.md`

**Interfaces:**
- Consumes: behavior đã kiểm ở Tasks 1–8.
- Produces: tài liệu công khai và checkpoint không tuyên bố production trước evidence.

- [ ] **Step 1: Cập nhật tài liệu đúng contract**

Mỗi trang liên quan phải nêu đủ năm profile, `all` mặc định, ba snippet SDK mới, fallback style,
POI user luôn được giữ và `/places/{id}` không lọc. Thay mọi câu “chỉ có bộ tiles cho osm và all”
bằng bảng profile của spec. Giữ cảnh báo package source `0.4.0` chưa publish npm.

- [ ] **Step 2: Cập nhật DEVLOG checkpoint pre-production**

Ghi commit code, số test thực tế và câu rõ ràng: archive/manifest/production **chưa** phát hành tại
checkpoint này. Hành động tiếp theo chính xác là chạy batch bootstrap ba profile.

- [ ] **Step 3: Chạy full gates mới**

Run: `pnpm lint`

Run: `pnpm typecheck`

Run: `pnpm test`

Run: `pnpm test:api-db`

Run: `docker compose --env-file .env -f infra/dev/compose.yml --profile pipeline run --rm pipeline pnpm test:db`

Run: `pnpm build`

Expected: mọi lệnh exit 0. Ghi số file/test từ output vào DEVLOG, không dùng số lịch sử.

- [ ] **Step 4: Commit docs và checkpoint**

```bash
git add apps/docs/src/content/docs/api.md apps/docs/src/content/docs/ban-do-web.md apps/docs/src/content/docs/react.md apps/docs/src/content/docs/react-native.md apps/docs/src/content/docs/tim-kiem.md apps/docs/src/content/docs/tinh-nang.md apps/docs/src/content/docs/sdk.md docs/DEVLOG.md
git commit -m "docs(poi): hướng dẫn năm profile nguồn"
```

---

### Task 10: Deploy code, build/publish archive và nghiệm thu production

**Files:**
- Create: `docs/evidence/poi-sources/nghiem-thu-overture-fsq-production.md`
- Modify: `docs/DEVLOG.md`

**Interfaces:**
- Consumes: code/gates Tasks 1–9 và credentials chỉ đọc từ `.env`.
- Produces: manifest production có ba key mới, evidence production, commit/push cuối và resume point.

- [ ] **Step 1: Preflight local/remote không ghi**

Run: `git status --short --branch`

Run: `pnpm poi:profile --profiles overture-fsq,overture,fsq --dry-run`

Run: `pnpm exec wrangler --version`

Run: `gh auth status`

Expected: worktree sạch; dry-run đúng 13 bước sau snapshot; Wrangler v4; GitHub auth hợp lệ. Không
in nội dung `.env` hoặc secret.

- [ ] **Step 2: Push code và quan sát deploy**

Run: `git push origin main`

Run: `gh run list --commit "$(git rev-parse HEAD)" --limit 10`

Nếu CI chạy, chờ từng workflow bằng `gh run watch`; nếu báo billing/spending limit, ghi nguyên trạng
thái blocker và deploy trực tiếp đúng các bước của workflow hiện hành trước khi publish manifest:

```bash
pnpm --filter @mapslibvn/core build
pnpm --filter @mapslibvn/style build
pnpm --filter @mapslibvn/admin build
pnpm --filter @mapslibvn/api test
pnpm --filter @mapslibvn/api exec wrangler deploy --env production
pnpm --filter @mapslibvn/web build
pnpm --filter @mapslibvn/react build
pnpm --filter @mapslibvn/docs build
pnpm --filter @mapslibvn/docs exec wrangler pages deploy dist --project-name mapslibvn-docs
```

Không gọi CI green khi không truy vấn được hoặc không có job chạy.

- [ ] **Step 3: Xác nhận code fallback đã lên production trước dữ liệu**

Run: `curl -sS -D /tmp/poi-fsq-before.headers 'https://api.ai-solutions.io.vn/v1/styles/light.json?sources=fsq' -o /tmp/poi-fsq-before.json`

Expected: HTTP 200 và `x-poi-profile: all;fallback`. Nếu production chưa nhận profile, dừng trước
build/publish manifest và sửa deploy.

- [ ] **Step 4: Build và publish batch thật**

Run: `pnpm poi:profile --profiles overture-fsq,overture,fsq`

Expected: một snapshot/checksum; từng profile export, QA, upload, smoke thành công; manifest chỉ set
một lần cuối. Lưu stdout đầy đủ vào evidence bằng cách sao chép số liệu sau khi lệnh kết thúc, không
redirect log có thể chứa thông tin nhạy cảm.

- [ ] **Step 5: Xác minh manifest, checksum và archive**

Run: `docker compose --env-file .env -f infra/dev/compose.yml --profile pipeline run --rm pipeline node pipelines/tiles/src/manifest.mjs get`

Run: `docker compose --env-file .env -f infra/dev/compose.yml --profile pipeline run --rm pipeline sh -c 'rclone lsf "r2:$R2_BUCKET/tiles" --files-only'`

Đối chiếu đúng ba release từ manifest, mỗi release có `.pmtiles` và `.pmtiles.sha256`; dùng
`rclone cat` đọc checksum và xác thực regex 64 hex, dùng `rclone size` ghi byte size. Không in access
key/token.

- [ ] **Step 6: Smoke API/style và partition production**

Run style light/dark với `sources=overture%2Cfsq`, `sources=overture`, `sources=fsq`. Mỗi response
phải HTTP 200, header đúng profile và body trỏ đúng release manifest.

Run search/nearby/reverse/autocomplete bằng API demo cho từng profile; với mỗi POI response, kiểm
`primary_source` thuộc tập được chọn hoặc record là POI user. Kiểm một ID qua `/v1/places/{id}` vẫn
mở được bất kể profile.

- [ ] **Step 7: Nghiệm thu browser 5 thành phố**

Mở public playground không dùng `?api=` dev override. Với từng profile mới, kiểm Hà Nội, Hải Phòng,
Đà Nẵng, TP.HCM, Cần Thơ tại z12/14/16; lưu screenshot vào
`docs/evidence/poi-sources/screenshots/`; tên file theo mẫu đã khóa bằng ví dụ
`2026-09-09-overture-hcm-z12.png` (đổi ba phần profile, thành phố và zoom tương ứng). Ghi request style/tile,
header profile và console; không chấp nhận console error.

- [ ] **Step 8: Đo autocomplete cold/warm riêng**

Run ba lệnh, dùng API key từ biến shell đã nạp an toàn từ `.env` mà không in giá trị:

```bash
node scripts/perf-autocomplete.mjs https://api.ai-solutions.io.vn "$MAPSLIBVN_API_KEY" --paired-sources overture,fsq --rounds 5
node scripts/perf-autocomplete.mjs https://api.ai-solutions.io.vn "$MAPSLIBVN_API_KEY" --paired-sources overture --rounds 5
node scripts/perf-autocomplete.mjs https://api.ai-solutions.io.vn "$MAPSLIBVN_API_KEY" --paired-sources fsq --rounds 5
```

Lưu raw JSON; báo riêng cold và warm. Mỗi warm p95 profile mới phải không chậm hơn `all` quá 50 ms;
nếu vượt, chưa đóng acceptance.

- [ ] **Step 9: Kiểm rollback target read-only**

Dùng output `manifest.mjs get` lấy history đầu, chạy helper `verifyRollbackArchives` hoặc lệnh
read-only tương đương để xác minh mọi target có archive/checksum. Không gọi `data:rollback` khi
production đang đúng.

- [ ] **Step 10: Ghi evidence và DEVLOG**

Evidence phải có commit SHA, CI/deploy state, release IDs, checksum, byte size, selected/thinned,
smoke count, style/API results, browser matrix, cold/warm benchmark, rollback verification và mọi
ngoại lệ. DEVLOG chỉ ghi “đã nghiệm thu production” khi toàn bộ cổng trên đạt; nếu còn blocker, ghi
đúng cổng mở và resume action.

- [ ] **Step 11: Chạy verification cuối, commit và push evidence**

Run: `pnpm lint && pnpm typecheck && pnpm --filter @mapslibvn/docs build`

```bash
git add docs/evidence/poi-sources/nghiem-thu-overture-fsq-production.md docs/evidence/poi-sources/screenshots docs/DEVLOG.md
git commit -m "docs(evidence): nghiệm thu production profile Overture và Foursquare"
git push origin main
```

Sau push, query CI/deploy theo SHA evidence và smoke lại ba style trên public URL. Chỉ đóng plan khi
Git, CI/deploy, manifest, runtime và tài liệu khớp nhau; nếu GitHub billing vẫn chặn, ghi rõ CI chưa
green dù production đã được nghiệm thu trực tiếp.
