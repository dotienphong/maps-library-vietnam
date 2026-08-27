# M1c — Worker styles/tiles, Web SDK, docs + playground, deploy: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nhúng được bản đồ Việt Nam bằng một `<script>` hoặc `import { createMap } from '@mapslibvn/web'`: Worker phục vụ style (alias phiên bản từ KV) + attribution + tiles fallback; Web SDK ép attribution, hỗ trợ `pmtiles://`; docs/playground chạy thật; deploy tự động; nghiệm thu M1.

**Architecture:** Worker Hono (`apps/api`) đọc manifest `release:current` trong KV và điền template style của `@mapslibvn/style`; client tải PMTiles thẳng từ `TILES_BASE` (R2 custom domain; trong dev/E2E là route `/r2/*` của Worker đọc R2 local). `@mapslibvn/web` bọc maplibre-gl với dependency injection để test không cần WebGL; UMD bundle maplibre + pmtiles để nhúng một dòng. Playwright chạy E2E offline bằng fixture Quận 1.

**Tech Stack:** Hono 4, Wrangler 4, `@cloudflare/vitest-pool-workers`, pmtiles 4, maplibre-gl 5, tsup, Vite (UMD), size-limit, Astro 5 + Starlight, Playwright, GitHub Actions.

**Spec:** mục 4.5, 6.1 (styles/attribution), 6.6 (lỗi), 7.1–7.4, 11.2, 13/M1.

---

## Cấu trúc file tạo trong plan này

```
apps/api/{package.json,tsconfig.json,wrangler.toml,vitest.config.ts}
apps/api/src/{index.ts,env.ts,manifest.ts,style.ts,r2-source.ts,errors.ts}
apps/api/src/routes/{styles.ts,tiles.ts,r2.ts}
apps/api/test/{styles.test.ts,tiles.test.ts,r2-source.test.ts}
apps/api/scripts/seed-local.mjs
packages/style/src/transform.d.mts
packages/web/{package.json,tsconfig.json,vite.umd.config.ts,.size-limit.json}
packages/web/src/{index.ts,map.ts,map.test.ts,protocol.ts,language.ts,language.test.ts,umd.ts}
apps/docs/{package.json,astro.config.mjs,tsconfig.json,playwright.config.ts}
apps/docs/src/content.config.ts · apps/docs/src/content/docs/{index.mdx,bat-dau.md}
apps/docs/public/playground.html · apps/docs/scripts/copy-sdk.mjs · apps/docs/e2e/playground.spec.ts
.github/workflows/{deploy-api.yml,deploy-docs.yml,data-update.yml}
```

---

### Task 1: Worker `apps/api` — styles, attribution, tiles fallback, `/r2/*` cho dev

**Files:**
- Create: toàn bộ `apps/api/*` liệt kê trên, `packages/style/src/transform.d.mts`
- Modify: root `package.json` (`test` chạy thêm api), `turbo.json` không đổi

- [x] **Step 1: Khai báo kiểu cho `@mapslibvn/style`**

`packages/style/src/transform.d.mts`:
```ts
export const ALLOWED_FONTS: string[];
export const NAME_EXPRESSION: unknown[];
export function mapFont(font: string): string;
export function transformStyle(
  base: Record<string, unknown>,
  opts: { theme: 'light' | 'dark'; sovereignty: Record<string, unknown> },
): Record<string, unknown> & { layers: Record<string, unknown>[] };
export function fillTemplate(templateJson: string, values: Record<string, string>): string;
```
Thêm vào `packages/style/package.json` → `"types": "./src/transform.d.mts"` và trong `exports["."]`: `{ "types": "./src/transform.d.mts", "default": "./src/transform.mjs" }`.

- [x] **Step 2: Tạo package Worker**

`apps/api/package.json`:
```json
{
  "name": "@mapslibvn/api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev --port 8787",
    "dev:e2e": "node scripts/seed-local.mjs && wrangler dev --port 8787 --var TILES_BASE:http://localhost:8787/r2 --var ENVIRONMENT:test",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "build": "echo 'wrangler bundles at deploy'"
  },
  "dependencies": {
    "@mapslibvn/core": "workspace:*",
    "@mapslibvn/style": "workspace:*",
    "hono": "^4.6.0",
    "pmtiles": "^4.3.0"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.6.0",
    "@cloudflare/workers-types": "^4.20250801.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "wrangler": "^4.0.0"
  }
}
```

`apps/api/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "types": ["@cloudflare/workers-types/2023-07-01", "@cloudflare/vitest-pool-workers"], "lib": ["ES2022"] },
  "include": ["src", "test"]
}
```

`apps/api/wrangler.toml` (điền `id` KV từ `.env` → `KV_NAMESPACE_ID_META`; ID không phải bí mật, commit được):
```toml
name = "mapslibvn-api"
main = "src/index.ts"
compatibility_date = "2025-08-01"
compatibility_flags = ["nodejs_compat"]

[vars]
TILES_BASE = "https://tiles.example.com"
ENVIRONMENT = "dev"

[[kv_namespaces]]
binding = "META"
id = "DIEN_KV_NAMESPACE_ID_META"

[[r2_buckets]]
binding = "TILES"
bucket_name = "mapslibvn-tiles"

[observability]
enabled = true

[env.production]
vars = { TILES_BASE = "https://tiles.example.com", ENVIRONMENT = "production" }
kv_namespaces = [{ binding = "META", id = "DIEN_KV_NAMESPACE_ID_META" }]
r2_buckets = [{ binding = "TILES", bucket_name = "mapslibvn-tiles" }]
```
Thay `DIEN_KV_NAMESPACE_ID_META` (2 chỗ) bằng ID thật và `https://tiles.example.com` (2 chỗ) bằng `TILES_BASE` thật trước khi deploy.

`apps/api/vitest.config.ts`:
```ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    include: ['test/**/*.test.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: { bindings: { TILES_BASE: 'https://tiles.test', ENVIRONMENT: 'test' } },
      },
    },
  },
});
```

Root `package.json` — test cần `@mapslibvn/core` đã build (web và api import qua `dist`):
```json
"test": "pnpm --filter @mapslibvn/core build && vitest run && pnpm --filter @mapslibvn/api test"
```

Run: `pnpm install`

- [x] **Step 3: Test styles/attribution (thất bại)**

`apps/api/test/styles.test.ts`:
```ts
import { SELF, env } from 'cloudflare:test';
import { attributionText } from '@mapslibvn/core';
import { beforeEach, describe, expect, it } from 'vitest';

beforeEach(async () => {
  await env.META.put('release:current', JSON.stringify({ vn: 'vn-20260826', poi: null }));
});

describe('GET /v1/styles/:theme.json', () => {
  it('điền TILES_BASE và phiên bản từ manifest, cache 1 giờ', async () => {
    const res = await SELF.fetch('https://api/v1/styles/light.json?key=mlv_live_x');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
    const style = (await res.json()) as { sources: Record<string, { url?: string }>; glyphs: string; layers: { id: string }[] };
    expect(style.sources.openmaptiles.url).toBe('pmtiles://https://tiles.test/tiles/vn-20260826.pmtiles');
    expect(style.glyphs).toBe('https://tiles.test/assets/fonts/{fontstack}/{range}.pbf');
    expect(style.layers.at(-1)?.id).toBe('sovereignty-label');
  });

  it('theme lạ → 404 đúng định dạng lỗi', async () => {
    const res = await SELF.fetch('https://api/v1/styles/neon.json');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; request_id: string } };
    expect(body.error.code).toBe('not_found');
    expect(body.error.request_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('chưa có manifest → 503 upstream_unavailable', async () => {
    await env.META.delete('release:current');
    const res = await SELF.fetch('https://api/v1/styles/dark.json');
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('30');
  });
});

describe('GET /v1/attribution', () => {
  it('trả text đúng spec và 5 link', async () => {
    const res = await SELF.fetch('https://api/v1/attribution');
    const body = (await res.json()) as { text: string; html: string; links: unknown[] };
    expect(body.text).toBe(attributionText());
    expect(body.links).toHaveLength(5);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('GET /healthz', () => {
  it('ok', async () => {
    const res = await SELF.fetch('https://api/healthz');
    expect(await res.json()).toEqual({ ok: true, environment: 'test' });
  });
});
```

Run: `pnpm --filter @mapslibvn/api test`
Expected: FAIL — `src/index.ts` chưa tồn tại.

- [x] **Step 4: Viết Worker**

`apps/api/src/env.ts`:
```ts
export interface Env {
  META: KVNamespace;
  TILES: R2Bucket;
  TILES_BASE: string;
  ENVIRONMENT: string;
}
```

`apps/api/src/errors.ts`:
```ts
import type { Context } from 'hono';

export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 429 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function errorResponse(c: Context, err: unknown) {
  const requestId = crypto.randomUUID();
  const e = err instanceof ApiError ? err : new ApiError(503, 'upstream_unavailable', 'Lỗi không xác định');
  if (!(err instanceof ApiError)) console.error(requestId, err);
  const headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8' };
  if (e.status === 503) headers['retry-after'] = '30';
  return c.body(JSON.stringify({ error: { code: e.code, message: e.message, request_id: requestId } }), e.status, headers);
}
```

`apps/api/src/manifest.ts`:
```ts
import type { Env } from './env';
import { ApiError } from './errors';

export interface Manifest {
  vn: string | null;
  poi: string | null;
  updatedAt?: string;
}

export async function getManifest(env: Env): Promise<Manifest> {
  const m = await env.META.get<Manifest>('release:current', { type: 'json', cacheTtl: 60 });
  if (!m?.vn) throw new ApiError(503, 'upstream_unavailable', 'Chưa có phiên bản tiles (release:current)');
  return m;
}
```

`apps/api/src/style.ts`:
```ts
import { fillTemplate } from '@mapslibvn/style';
import dark from '@mapslibvn/style/templates/dark';
import light from '@mapslibvn/style/templates/light';
import type { Manifest } from './manifest';

export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];
const TEMPLATES: Record<Theme, string> = { light: JSON.stringify(light), dark: JSON.stringify(dark) };

export function isTheme(s: string): s is Theme {
  return (THEMES as readonly string[]).includes(s);
}

export function renderStyle(theme: Theme, manifest: Manifest, tilesBase: string): string {
  return fillTemplate(TEMPLATES[theme], {
    TILES_BASE: tilesBase.replace(/\/+$/, ''),
    VN_FILE: manifest.vn ?? '',
    POI_FILE: manifest.poi ?? '',
  });
}
```

`apps/api/src/r2-source.ts`:
```ts
import type { RangeResponse, Source } from 'pmtiles';

/** Nguồn PMTiles đọc range từ R2 (dùng cho route fallback). */
export class R2Source implements Source {
  constructor(
    private readonly bucket: Pick<R2Bucket, 'get'>,
    private readonly key: string,
  ) {}

  getKey(): string {
    return this.key;
  }

  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const obj = await this.bucket.get(this.key, { range: { offset, length } });
    if (!obj) throw new Error(`R2: không có ${this.key}`);
    return { data: await obj.arrayBuffer(), etag: obj.httpEtag };
  }
}
```

`apps/api/src/routes/styles.ts`:
```ts
import { Hono } from 'hono';
import type { Env } from '../env';
import { ApiError } from '../errors';
import { getManifest } from '../manifest';
import { isTheme, renderStyle } from '../style';

export const styles = new Hono<{ Bindings: Env }>();

styles.get('/v1/styles/:file', async (c) => {
  const theme = c.req.param('file').replace(/\.json$/, '');
  if (!isTheme(theme)) throw new ApiError(404, 'not_found', `Không có theme "${theme}"`);
  const manifest = await getManifest(c.env);
  return c.body(renderStyle(theme, manifest, c.env.TILES_BASE), 200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=3600',
  });
});
```

`apps/api/src/routes/tiles.ts` (fallback z/x/y + TileJSON):
```ts
import { Hono } from 'hono';
import { Compression, PMTiles } from 'pmtiles';
import type { Env } from '../env';
import { ApiError } from '../errors';
import { getManifest } from '../manifest';
import { R2Source } from '../r2-source';

export const tiles = new Hono<{ Bindings: Env }>();
const SETS = ['vn', 'poi'] as const;

function releaseFor(set: string, m: { vn: string | null; poi: string | null }): string {
  if (!(SETS as readonly string[]).includes(set)) throw new ApiError(404, 'not_found', `Không có bộ tiles "${set}"`);
  const r = set === 'vn' ? m.vn : m.poi;
  if (!r) throw new ApiError(404, 'not_found', `Bộ tiles "${set}" chưa phát hành`);
  return r;
}

tiles.get('/v1/tiles/:file{[a-z]+\\.json}', async (c) => {
  const set = c.req.param('file').replace(/\.json$/, '');
  const release = releaseFor(set, await getManifest(c.env));
  const p = new PMTiles(new R2Source(c.env.TILES, `tiles/${release}.pmtiles`));
  const h = await p.getHeader();
  const meta = (await p.getMetadata()) as Record<string, unknown>;
  const origin = new URL(c.req.url).origin;
  return c.json(
    { tilejson: '3.0.0', tiles: [`${origin}/v1/tiles/${set}/{z}/{x}/{y}.pbf`], minzoom: h.minZoom, maxzoom: h.maxZoom,
      bounds: [h.minLon, h.minLat, h.maxLon, h.maxLat], vector_layers: meta.vector_layers, attribution: '© OpenStreetMap contributors · © OpenMapTiles' },
    200, { 'cache-control': 'public, max-age=3600' },
  );
});

tiles.get('/v1/tiles/:set/:z{[0-9]+}/:x{[0-9]+}/:file{[0-9]+\\.pbf}', async (c) => {
  const set = c.req.param('set');
  const z = Number(c.req.param('z'));
  const x = Number(c.req.param('x'));
  const y = Number(c.req.param('file').replace(/\.pbf$/, ''));
  const release = releaseFor(set, await getManifest(c.env));
  const cache = caches.default;
  const cached = await cache.match(c.req.raw);
  if (cached) return cached;
  // decompress = identity: trả nguyên byte gzip trong archive kèm content-encoding, không tốn CPU giải nén
  const p = new PMTiles(new R2Source(c.env.TILES, `tiles/${release}.pmtiles`), undefined, async (buf) => buf);
  const h = await p.getHeader();
  if (z < h.minZoom || z > h.maxZoom) return c.body(null, 204);
  const t = await p.getZxy(z, x, y);
  if (!t?.data) return c.body(null, 204);
  const res = new Response(t.data, {
    headers: {
      'content-type': 'application/x-protobuf',
      'cache-control': 'public, max-age=86400, stale-while-revalidate=604800',
      etag: `"${release}"`,
      ...(h.tileCompression === Compression.Gzip ? { 'content-encoding': 'gzip' } : {}),
    },
  });
  c.executionCtx.waitUntil(cache.put(c.req.raw, res.clone()));
  return res;
});
```
Lưu ý: ở route TileJSON dùng `PMTiles` mặc định (chỉ đọc header/metadata, không cần dữ liệu tile); ở route pbf dùng bộ giải nén identity như trên và chỉ thêm `content-encoding: gzip` khi `h.tileCompression === Compression.Gzip`.

`apps/api/src/routes/r2.ts` (chỉ dev/test/E2E — phục vụ archive PMTiles và assets từ R2 local với Range):
```ts
import { Hono } from 'hono';
import type { Env } from '../env';
import { ApiError } from '../errors';

export const r2 = new Hono<{ Bindings: Env }>();

r2.get('/r2/*', async (c) => {
  if (c.env.ENVIRONMENT === 'production') throw new ApiError(404, 'not_found', 'Không có');
  const key = decodeURIComponent(new URL(c.req.url).pathname.replace(/^\/r2\//, ''));
  const head = await c.env.TILES.head(key);
  if (!head) throw new ApiError(404, 'not_found', `R2 local không có ${key}`);
  const headers = new Headers({
    'accept-ranges': 'bytes',
    'content-type': key.endsWith('.pbf') ? 'application/x-protobuf' : 'application/octet-stream',
  });
  const m = /^bytes=(\d+)-(\d*)$/.exec(c.req.header('range') ?? '');
  if (!m) {
    const obj = await c.env.TILES.get(key);
    headers.set('content-length', String(head.size));
    return new Response(obj?.body ?? null, { status: 200, headers });
  }
  const start = Number(m[1]);
  const end = m[2] ? Math.min(Number(m[2]), head.size - 1) : head.size - 1;
  const obj = await c.env.TILES.get(key, { range: { offset: start, length: end - start + 1 } });
  headers.set('content-range', `bytes ${start}-${end}/${head.size}`);
  headers.set('content-length', String(end - start + 1));
  return new Response(obj?.body ?? null, { status: 206, headers });
});
```

`apps/api/src/index.ts`:
```ts
import { ATTRIBUTION_LINKS, attributionHtml, attributionText } from '@mapslibvn/core';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env';
import { ApiError, errorResponse } from './errors';
import { r2 } from './routes/r2';
import { styles } from './routes/styles';
import { tiles } from './routes/tiles';

const app = new Hono<{ Bindings: Env }>();
app.use('*', cors({ origin: '*', allowMethods: ['GET', 'HEAD', 'POST', 'OPTIONS'], allowHeaders: ['X-Api-Key', 'Range', 'Content-Type'] }));
app.onError((err, c) => errorResponse(c, err));
app.notFound((c) => errorResponse(c, new ApiError(404, 'not_found', 'Không có route này')));

app.get('/healthz', (c) => c.json({ ok: true, environment: c.env.ENVIRONMENT }));
app.get('/v1/attribution', (c) =>
  c.json({ text: attributionText(), html: attributionHtml(), links: ATTRIBUTION_LINKS }, 200, { 'cache-control': 'public, max-age=86400' }),
);
app.route('/', styles);
app.route('/', tiles);
app.route('/', r2);

export default app;
```

Run: `pnpm --filter @mapslibvn/core build && pnpm --filter @mapslibvn/style build && pnpm --filter @mapslibvn/api test`
Expected: 5 test xanh. Nếu import JSON template báo kiểu: thêm `"resolveJsonModule": true` đã có trong base; nếu Wrangler không tìm `@mapslibvn/style/templates/light`, kiểm `exports` trong `packages/style/package.json`.

- [x] **Step 5: Test R2Source và tiles fallback**

`apps/api/test/r2-source.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { R2Source } from '../src/r2-source';

const fakeBucket = (bytes: Uint8Array) => ({
  async get(_key: string, opts?: { range?: { offset: number; length: number } }) {
    const { offset, length } = opts?.range ?? { offset: 0, length: bytes.length };
    const slice = bytes.slice(offset, offset + length);
    return { arrayBuffer: async () => slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength), httpEtag: '"e"' } as unknown as R2ObjectBody;
  },
});

describe('R2Source', () => {
  it('đọc đúng đoạn byte theo offset/length', async () => {
    const src = new R2Source(fakeBucket(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])), 'k');
    const r = await src.getBytes(2, 3);
    expect([...new Uint8Array(r.data)]).toEqual([2, 3, 4]);
    expect(r.etag).toBe('"e"');
  });
  it('ném lỗi khi object không tồn tại', async () => {
    const src = new R2Source({ get: async () => null } as unknown as R2Bucket, 'missing');
    await expect(src.getBytes(0, 1)).rejects.toThrow(/không có missing/);
  });
});
```

`apps/api/test/tiles.test.ts`:
```ts
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('tiles fallback khi chưa có dữ liệu', () => {
  it('bộ tiles lạ → 404', async () => {
    await env.META.put('release:current', JSON.stringify({ vn: 'vn-20260826', poi: null }));
    const res = await SELF.fetch('https://api/v1/tiles/xyz.json');
    expect(res.status).toBe(404);
  });
  it('poi chưa phát hành → 404 với thông điệp rõ', async () => {
    await env.META.put('release:current', JSON.stringify({ vn: 'vn-20260826', poi: null }));
    const res = await SELF.fetch('https://api/v1/tiles/poi/10/815/483.pbf');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/chưa phát hành/);
  });
  it('/r2/* trả 404 đúng định dạng khi R2 local trống', async () => {
    const res = await SELF.fetch('https://api/r2/tiles/none.pmtiles');
    expect(res.status).toBe(404);
  });
});
```

Run: `pnpm --filter @mapslibvn/api test`
Expected: 10 test xanh.

- [x] **Step 6: Seed R2/KV local và chạy `wrangler dev` với fixture**

`apps/api/scripts/seed-local.mjs`:
```js
#!/usr/bin/env node
// Nạp fixture Quận 1 vào R2 local + manifest vào KV local cho wrangler dev / E2E
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const fixture = resolve('../../pipelines/tiles/fixtures/q1.pmtiles');
const release = 'q1-fixture';
const w = (args) => execFileSync('pnpm', ['exec', 'wrangler', ...args], { stdio: 'inherit' });
w(['r2', 'object', 'put', `mapslibvn-tiles/tiles/${release}.pmtiles`, '--file', fixture, '--local']);
w(['kv', 'key', 'put', 'release:current', JSON.stringify({ vn: release, poi: null }), '--binding', 'META', '--local']);
console.log('✓ seed local: R2 + KV');
```

Run (từ `apps/api`): `cd apps/api && pnpm dev:e2e`
Expected: `✓ seed local`, wrangler dev lắng nghe `http://localhost:8787`.

Trong terminal khác:
Run: `curl -s localhost:8787/healthz && curl -s 'localhost:8787/v1/styles/light.json' | head -c 300`
Expected: `{"ok":true,"environment":"test"}` và style có `"url":"pmtiles://http://localhost:8787/r2/tiles/q1-fixture.pmtiles"`.

Run: `curl -s -o /dev/null -w '%{http_code} %{size_download}\n' -H 'Range: bytes=0-16383' localhost:8787/r2/tiles/q1-fixture.pmtiles`
Expected: `206 16384`.

Run: `curl -s -o /dev/null -w '%{http_code}\n' localhost:8787/v1/tiles/vn/14/13048/7698.pbf`
Expected: `200` (tile trong Quận 1; toạ độ đúng theo Web Mercator cho 106,700°E 10,776°N).

Dừng wrangler (Ctrl+C).

- [ ] **Step 7: Deploy lần đầu lên workers.dev** — CHỜ QUYỀN (bị bộ lọc chặn, cần PHONG cho phép)

Điền `wrangler.toml` (KV id, TILES_BASE thật). Run: `cd apps/api && pnpm exec wrangler login` (PHONG đăng nhập Cloudflare) rồi `pnpm exec wrangler deploy --env production`.
Expected: `Deployed mapslibvn-api-production … https://mapslibvn-api-production.<account>.workers.dev`.

Run: `curl -s https://mapslibvn-api-production.<account>.workers.dev/v1/styles/light.json | head -c 400`
Expected: style có `pmtiles://https://tiles.<domain>/tiles/vn-YYYYMMDD.pmtiles` (manifest thật từ M1b Task 6).

- [x] **Step 8: Lint, typecheck, DEVLOG, commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`

Sửa `docs/DEVLOG.md`: "Task đang làm: M1c Task 2"; mục 1 ghi URL Worker production; mục 4 dòng T1.

```bash
git add -A
git commit -m "feat(api): Worker Hono — styles từ manifest KV, attribution, tiles fallback, /r2 cho dev"
git push
```

---

### Task 2: `@mapslibvn/web` — `createMap`, pmtiles protocol, attribution ép bật, UMD

**Files:**
- Create: `packages/web/package.json`, `packages/web/tsconfig.json`, `packages/web/vite.umd.config.ts`, `packages/web/.size-limit.json`, `packages/web/src/{index.ts,map.ts,map.test.ts,protocol.ts,language.ts,language.test.ts,umd.ts}`

- [ ] **Step 1: Tạo package**

`packages/web/package.json`:
```json
{
  "name": "@mapslibvn/web",
  "version": "0.1.0",
  "description": "SDK web MapsLibVN: bọc maplibre-gl, pmtiles, attribution bắt buộc",
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./umd": "./dist/mapslibvn.umd.js",
    "./style.css": "./dist/mapslibvn.css"
  },
  "files": ["dist"],
  "sideEffects": false,
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts --clean --target es2022 --external maplibre-gl --external pmtiles && vite build -c vite.umd.config.ts && size-limit",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": { "maplibre-gl": "^5.0.0" },
  "dependencies": { "@mapslibvn/core": "workspace:*", "pmtiles": "^4.3.0" },
  "devDependencies": {
    "@size-limit/file": "^11.1.0",
    "maplibre-gl": "^5.0.0",
    "size-limit": "^11.1.0",
    "tsup": "^8.3.0",
    "typescript": "^5.6.0",
    "vite": "^6.0.0"
  }
}
```

`packages/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "lib": ["ES2022", "DOM"], "noEmit": true },
  "include": ["src"]
}
```

`packages/web/.size-limit.json`:
```json
[
  { "path": "dist/index.js", "limit": "15 kB", "gzip": true },
  { "path": "dist/mapslibvn.umd.js", "limit": "350 kB", "gzip": true }
]
```

`packages/web/vite.umd.config.ts`:
```ts
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: { entry: 'src/umd.ts', name: 'MapsLibVN', formats: ['umd'], fileName: () => 'mapslibvn.umd.js' },
    outDir: 'dist',
    emptyOutDir: false,
    cssCodeSplit: false,
    sourcemap: true,
    rollupOptions: { output: { assetFileNames: 'mapslibvn[extname]' } },
  },
});
```

Run: `pnpm install`

- [ ] **Step 2: Test đổi ngôn ngữ nhãn (thất bại)**

`packages/web/src/language.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { applyLanguage, nameExpression } from './language';

describe('nameExpression', () => {
  it('vi → coalesce name:vi, name; en → coalesce name:en, name', () => {
    expect(nameExpression('vi')).toEqual(['coalesce', ['get', 'name:vi'], ['get', 'name']]);
    expect(nameExpression('en')).toEqual(['coalesce', ['get', 'name:en'], ['get', 'name']]);
  });
});

describe('applyLanguage', () => {
  it('chỉ đổi symbol layer có text-field tham chiếu name', () => {
    const setLayoutProperty = vi.fn();
    const gl = {
      getStyle: () => ({
        layers: [
          { id: 'city', type: 'symbol', layout: { 'text-field': ['coalesce', ['get', 'name:vi'], ['get', 'name']] } },
          { id: 'hn', type: 'symbol', layout: { 'text-field': '{housenumber}' } },
          { id: 'sovereignty-label', type: 'symbol', layout: { 'text-field': ['get', 'name'] } },
          { id: 'water', type: 'fill' },
        ],
      }),
      setLayoutProperty,
    };
    applyLanguage(gl, 'en');
    expect(setLayoutProperty).toHaveBeenCalledTimes(1);
    expect(setLayoutProperty).toHaveBeenCalledWith('city', 'text-field', nameExpression('en'));
  });
});
```

Run: `pnpm test`
Expected: FAIL — không tìm thấy `./language`.

- [ ] **Step 3: Viết `language.ts` và `protocol.ts`**

`packages/web/src/language.ts`:
```ts
export type Lang = 'vi' | 'en';

export function nameExpression(lang: Lang): unknown[] {
  return ['coalesce', ['get', `name:${lang}`], ['get', 'name']];
}

interface StyleLike {
  getStyle(): { layers?: { id: string; type: string; layout?: Record<string, unknown> }[] } | undefined;
  setLayoutProperty(layerId: string, name: string, value: unknown): unknown;
}

/** Đổi nhãn sang ngôn ngữ khác. Bỏ qua lớp chủ quyền (luôn tiếng Việt) và nhãn không phải tên. */
export function applyLanguage(gl: StyleLike, lang: Lang): void {
  for (const l of gl.getStyle()?.layers ?? []) {
    if (l.type !== 'symbol' || l.id === 'sovereignty-label') continue;
    const tf = l.layout?.['text-field'];
    if (tf === undefined || !JSON.stringify(tf).includes('name')) continue;
    gl.setLayoutProperty(l.id, 'text-field', nameExpression(lang));
  }
}
```

`packages/web/src/protocol.ts`:
```ts
import { Protocol } from 'pmtiles';

let registered = false;

export interface ProtocolHost {
  addProtocol(name: string, loadFn: Protocol['tile']): void;
}

/** Đăng ký giao thức pmtiles:// đúng một lần cho toàn trang. */
export function ensurePmtilesProtocol(host: ProtocolHost): void {
  if (registered) return;
  host.addProtocol('pmtiles', new Protocol().tile);
  registered = true;
}

export function resetProtocolForTests(): void {
  registered = false;
}
```

Run: `pnpm test`
Expected: test language xanh.

- [ ] **Step 4: Test `createMap` với maplibre giả (thất bại)**

`packages/web/src/map.test.ts`:
```ts
import { attributionHtml } from '@mapslibvn/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMap } from './map';
import { resetProtocolForTests } from './protocol';

function fakeMaplibre() {
  const handlers: Record<string, ((e: unknown) => void)[]> = {};
  class Map {
    options: Record<string, unknown>;
    addControl = vi.fn();
    fitBounds = vi.fn();
    flyTo = vi.fn();
    remove = vi.fn();
    getLayer = vi.fn(() => ({ id: 'poi' }));
    getStyle = vi.fn(() => ({ layers: [] }));
    setLayoutProperty = vi.fn();
    queryRenderedFeatures = vi.fn(() => [
      { properties: { id: 'p1', name: 'Cafe Cây Bồ Đề', cat: 'cafe', grp: 'food_drink' }, geometry: { type: 'Point', coordinates: [106.6631, 10.7652] } },
    ]);
    constructor(options: Record<string, unknown>) {
      this.options = options;
    }
    on(ev: string, fn: (e: unknown) => void) {
      (handlers[ev] ??= []).push(fn);
      return this;
    }
    once(ev: string, fn: (e: unknown) => void) {
      return this.on(ev, fn);
    }
  }
  class Marker {
    setLngLat = vi.fn(() => this);
    setPopup = vi.fn(() => this);
    addTo = vi.fn(() => this);
    remove = vi.fn();
  }
  class Popup {
    setHTML = vi.fn(() => this);
  }
  class AttributionControl {
    options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      this.options = options;
    }
  }
  return { ml: { Map, Marker, Popup, AttributionControl, addProtocol: vi.fn() }, fire: (ev: string, e?: unknown) => handlers[ev]?.forEach((fn) => fn(e)) };
}

const base = { container: {} as HTMLElement, apiKey: 'mlv_live_t', apiBase: 'https://api.test' };

beforeEach(() => resetProtocolForTests());

describe('createMap', () => {
  it('đăng ký pmtiles một lần, dùng style URL từ core, tắt attribution mặc định rồi ép bật control riêng', () => {
    const { ml } = fakeMaplibre();
    const m1 = createMap(base, { maplibre: ml as never });
    createMap({ ...base, style: 'dark' }, { maplibre: ml as never });
    expect(ml.addProtocol).toHaveBeenCalledTimes(1);
    expect(ml.addProtocol.mock.calls[0]?.[0]).toBe('pmtiles');
    const opts = (m1.gl as unknown as { options: Record<string, unknown> }).options;
    expect(opts.style).toBe('https://api.test/v1/styles/light.json?key=mlv_live_t');
    expect(opts.attributionControl).toBe(false);
    const ctl = (m1.gl.addControl as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { options: { customAttribution: string } };
    expect(ctl.options.customAttribution).toBe(attributionHtml());
  });

  it('style là URL tuỳ biến thì giữ nguyên', () => {
    const { ml } = fakeMaplibre();
    const m = createMap({ ...base, style: 'https://x/style.json' }, { maplibre: ml as never });
    expect((m.gl as unknown as { options: Record<string, unknown> }).options.style).toBe('https://x/style.json');
  });

  it('addMarker đặt toạ độ, popup và thêm vào map', () => {
    const { ml } = fakeMaplibre();
    const m = createMap(base, { maplibre: ml as never });
    const marker = m.addMarker({ lng: 106.7, lat: 10.77, popupHtml: '<b>Hi</b>' }) as unknown as { setLngLat: ReturnType<typeof vi.fn>; setPopup: ReturnType<typeof vi.fn>; addTo: ReturnType<typeof vi.fn> };
    expect(marker.setLngLat).toHaveBeenCalledWith([106.7, 10.77]);
    expect(marker.setPopup).toHaveBeenCalled();
    expect(marker.addTo).toHaveBeenCalledWith(m.gl);
  });

  it('poiClick nhận feature từ lớp poi khi click', () => {
    const { ml, fire } = fakeMaplibre();
    const m = createMap(base, { maplibre: ml as never });
    const handler = vi.fn();
    m.on('poiClick', handler);
    fire('click', { point: { x: 1, y: 2 } });
    expect(handler).toHaveBeenCalledWith({ id: 'p1', name: 'Cafe Cây Bồ Đề', category: 'cafe', group: 'food_drink', lngLat: [106.6631, 10.7652] });
  });

  it('lang=en áp dụng sau khi style load', () => {
    const { ml, fire } = fakeMaplibre();
    const m = createMap({ ...base, lang: 'en' }, { maplibre: ml as never });
    (m.gl.getStyle as ReturnType<typeof vi.fn>).mockReturnValue({ layers: [{ id: 'city', type: 'symbol', layout: { 'text-field': ['get', 'name'] } }] });
    fire('load');
    expect(m.gl.setLayoutProperty).toHaveBeenCalledWith('city', 'text-field', ['coalesce', ['get', 'name:en'], ['get', 'name']]);
  });

  it('places là client core với cùng key', () => {
    const { ml } = fakeMaplibre();
    const m = createMap(base, { maplibre: ml as never });
    expect(m.places.styleUrl('light')).toContain('key=mlv_live_t');
  });
});
```

Run: `pnpm test`
Expected: FAIL — không tìm thấy `./map`.

- [ ] **Step 5: Viết `map.ts`, `index.ts`, `umd.ts`**

`packages/web/src/map.ts`:
```ts
import { type MapsLibVNClient, type Theme, attributionHtml, createClient } from '@mapslibvn/core';
import type maplibregl from 'maplibre-gl';
import { type Lang, applyLanguage } from './language';
import { type ProtocolHost, ensurePmtilesProtocol } from './protocol';

export interface CreateMapOptions {
  container: string | HTMLElement;
  apiKey: string;
  /** Gốc API MapsLibVN, ví dụ https://maps-api.example.com */
  apiBase: string;
  /** 'light' | 'dark' hoặc URL style tuỳ biến */
  style?: Theme | string;
  center?: [number, number];
  zoom?: number;
  lang?: Lang;
  /** Hiển thị lớp POI (khi đã phát hành) — mặc định true */
  poiLayer?: boolean;
  /** Attribution gọn (không có tuỳ chọn tắt) */
  compactAttribution?: boolean;
}

export interface PoiFeature {
  id: string;
  name: string;
  category: string;
  group: string;
  lngLat: [number, number];
}

export interface MarkerOptions {
  lng: number;
  lat: number;
  popupHtml?: string;
  color?: string;
}

export interface MapEvents {
  poiClick: PoiFeature;
  load: undefined;
}

export interface Deps {
  maplibre: typeof maplibregl & ProtocolHost;
}

export interface MapsLibVNMap {
  gl: maplibregl.Map;
  places: MapsLibVNClient;
  addMarker(o: MarkerOptions): maplibregl.Marker;
  fitBounds(bbox: [number, number, number, number], padding?: number): void;
  flyTo(center: [number, number], zoom?: number): void;
  on<K extends keyof MapEvents>(event: K, handler: (e: MapEvents[K]) => void): void;
  off<K extends keyof MapEvents>(event: K, handler: (e: MapEvents[K]) => void): void;
  remove(): void;
}

const isTheme = (s: string): s is Theme => s === 'light' || s === 'dark';

export function createMap(opts: CreateMapOptions, deps?: Deps): MapsLibVNMap {
  const ml = deps?.maplibre ?? (globalThis as unknown as { maplibregl: Deps['maplibre'] }).maplibregl;
  if (!ml) throw new Error('Cần maplibre-gl: import maplibre-gl hoặc dùng bản UMD @mapslibvn/web/umd');
  ensurePmtilesProtocol(ml);

  const places = createClient({ apiKey: opts.apiKey, baseUrl: opts.apiBase });
  const styleOpt = opts.style ?? 'light';
  const style = isTheme(styleOpt) ? places.styleUrl(styleOpt) : styleOpt;

  const gl = new ml.Map({
    container: opts.container,
    style,
    center: opts.center ?? [106.7, 10.776],
    zoom: opts.zoom ?? 12,
    attributionControl: false,
  });
  gl.addControl(new ml.AttributionControl({ compact: opts.compactAttribution ?? false, customAttribution: attributionHtml() }));

  const listeners: { [K in keyof MapEvents]: Set<(e: MapEvents[K]) => void> } = { poiClick: new Set(), load: new Set() };
  const emit = <K extends keyof MapEvents>(k: K, e: MapEvents[K]) => {
    for (const fn of listeners[k]) fn(e);
  };

  gl.on('load', () => {
    if (opts.lang && opts.lang !== 'vi') applyLanguage(gl, opts.lang);
    if (opts.poiLayer === false && gl.getLayer('poi')) gl.setLayoutProperty('poi', 'visibility', 'none');
    emit('load', undefined);
  });

  gl.on('click', (e: maplibregl.MapMouseEvent) => {
    if (listeners.poiClick.size === 0 || !gl.getLayer('poi')) return;
    const f = gl.queryRenderedFeatures(e.point, { layers: ['poi'] })[0];
    if (!f || f.geometry.type !== 'Point') return;
    const p = f.properties as Record<string, unknown>;
    emit('poiClick', {
      id: String(p.id), name: String(p.name ?? ''), category: String(p.cat ?? ''), group: String(p.grp ?? ''),
      lngLat: f.geometry.coordinates as [number, number],
    });
  });

  return {
    gl,
    places,
    addMarker(o) {
      const marker = new ml.Marker(o.color ? { color: o.color } : undefined).setLngLat([o.lng, o.lat]);
      if (o.popupHtml) marker.setPopup(new ml.Popup({ offset: 24 }).setHTML(o.popupHtml));
      return marker.addTo(gl);
    },
    fitBounds(bbox, padding = 40) {
      gl.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding });
    },
    flyTo(center, zoom) {
      gl.flyTo(zoom === undefined ? { center } : { center, zoom });
    },
    on(event, handler) {
      (listeners[event] as Set<unknown>).add(handler);
    },
    off(event, handler) {
      (listeners[event] as Set<unknown>).delete(handler);
    },
    remove() {
      gl.remove();
    },
  };
}
```

`packages/web/src/index.ts`:
```ts
export { createMap } from './map';
export type { CreateMapOptions, MapEvents, MapsLibVNMap, MarkerOptions, PoiFeature } from './map';
export { applyLanguage, nameExpression } from './language';
export type { Lang } from './language';
export { attributionHtml, attributionText, createClient, MapsLibVNError } from '@mapslibvn/core';
export type { AttributionResponse, ClientOptions, MapsLibVNClient, Theme } from '@mapslibvn/core';
```

`packages/web/src/umd.ts` (bản một `<script>`: gói kèm maplibre + css):
```ts
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl from 'maplibre-gl';
import { type CreateMapOptions, createMap as createMapWithDeps } from './map';

// Liệt kê tường minh (không dùng export * để tránh trùng tên createMap)
export { applyLanguage, nameExpression, attributionHtml, attributionText, createClient, MapsLibVNError } from './index';
export type { CreateMapOptions, MapEvents, MapsLibVNMap, MarkerOptions, PoiFeature } from './map';

/** Bản UMD: maplibre đã đóng gói sẵn, không cần truyền deps. */
export function createMap(opts: CreateMapOptions) {
  return createMapWithDeps(opts, { maplibre: maplibregl });
}
export { maplibregl };
```

Run: `pnpm test`
Expected: 6 test map + 2 language xanh.

- [ ] **Step 6: Build ESM + UMD, size-limit**

Run: `pnpm --filter @mapslibvn/core build && pnpm --filter @mapslibvn/web build`
Expected: `dist/index.js`, `dist/index.d.ts`, `dist/mapslibvn.umd.js`, `dist/mapslibvn.css`; size-limit báo `dist/index.js` < 15 kB và UMD < 350 kB gzip (maplibre-gl 5 ≈ 250–300 kB gzip). Nếu UMD vượt: nâng giới hạn lên đúng số đo + 10% và ghi DEVLOG.

Run: `pnpm typecheck && pnpm lint`

- [ ] **Step 7: DEVLOG, commit**

Sửa `docs/DEVLOG.md`: "Task đang làm: M1c Task 3"; mục 4 dòng T2 kèm kích cỡ bundle.

```bash
git add -A
git commit -m "feat(web): createMap bọc maplibre + pmtiles, attribution bắt buộc, poiClick, lang, bản UMD"
git push
```

---

### Task 3: Docs (Astro Starlight) + playground + E2E Playwright

**Files:**
- Create: `apps/docs/package.json`, `apps/docs/astro.config.mjs`, `apps/docs/tsconfig.json`, `apps/docs/src/content.config.ts`, `apps/docs/src/content/docs/index.mdx`, `apps/docs/src/content/docs/bat-dau.md`, `apps/docs/public/playground.html`, `apps/docs/scripts/copy-sdk.mjs`, `apps/docs/playwright.config.ts`, `apps/docs/e2e/playground.spec.ts`

- [ ] **Step 1: Tạo site**

`apps/docs/package.json`:
```json
{
  "name": "@mapslibvn/docs",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "prebuild": "node scripts/copy-sdk.mjs",
    "predev": "node scripts/copy-sdk.mjs",
    "dev": "astro dev --port 4321",
    "build": "astro build",
    "preview": "astro preview --port 4321",
    "e2e": "playwright test",
    "typecheck": "astro check"
  },
  "dependencies": {
    "@astrojs/check": "^0.9.4",
    "@astrojs/starlight": "^0.30.0",
    "@mapslibvn/web": "workspace:*",
    "astro": "^5.0.0",
    "sharp": "^0.33.5",
    "typescript": "^5.6.0"
  },
  "devDependencies": { "@playwright/test": "^1.49.0" }
}
```

`apps/docs/astro.config.mjs`:
```js
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://maps-docs.example.com',
  integrations: [
    starlight({
      title: 'MapsLibVN',
      defaultLocale: 'root',
      locales: { root: { label: 'Tiếng Việt', lang: 'vi' } },
      sidebar: [
        { label: 'Bắt đầu 5 phút', slug: 'bat-dau' },
        { label: 'Playground', link: '/playground.html' },
      ],
    }),
  ],
});
```

`apps/docs/tsconfig.json`:
```json
{ "extends": "astro/tsconfigs/strict", "include": [".astro/types.d.ts", "**/*"], "exclude": ["dist"] }
```

`apps/docs/src/content.config.ts`:
```ts
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { defineCollection } from 'astro:content';

export const collections = { docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }) };
```

`apps/docs/src/content/docs/index.mdx`:
```mdx
---
title: MapsLibVN
description: Bản đồ nhúng cho web và mobile, dữ liệu mở, Việt Nam trước.
template: splash
hero:
  tagline: Nhúng bản đồ Việt Nam bằng một dòng. Không Google, không phí, không khoá.
  actions:
    - text: Bắt đầu 5 phút
      link: /bat-dau/
      icon: right-arrow
    - text: Mở playground
      link: /playground.html
      variant: minimal
---

import { Card, CardGrid } from '@astrojs/starlight/components';

<CardGrid>
  <Card title="Mã nguồn mở" icon="open-book">MapLibre GL + OpenStreetMap + Overture + Foursquare OS. Ghi nguồn đầy đủ.</Card>
  <Card title="Tiếng Việt trước" icon="star">Nhãn tiếng Việt, địa chỉ kiểu hẻm, phường/xã sau sáp nhập 2025.</Card>
  <Card title="Chi phí 0 đ" icon="rocket">Tiles tĩnh trên CDN, đọc thẳng, không tính theo lượt.</Card>
</CardGrid>
```

`apps/docs/src/content/docs/bat-dau.md`:
````md
---
title: Bắt đầu 5 phút
description: Nhúng bản đồ MapsLibVN bằng script tag, npm hoặc React.
---

## 1. Một dòng `<script>`

```html
<link rel="stylesheet" href="https://maps-docs.example.com/sdk/mapslibvn.css" />
<script src="https://maps-docs.example.com/sdk/mapslibvn.umd.js"></script>
<div id="map" style="height:400px"></div>
<script>
  MapsLibVN.createMap({
    container: 'map',
    apiKey: 'mlv_live_…',
    apiBase: 'https://maps-api.example.com',
    center: [106.70, 10.776],
    zoom: 13,
  });
</script>
```

## 2. npm

```bash
pnpm add @mapslibvn/web maplibre-gl
```

```ts
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl from 'maplibre-gl';
import { createMap } from '@mapslibvn/web';

const map = createMap(
  { container: 'map', apiKey: 'mlv_live_…', apiBase: 'https://maps-api.example.com' },
  { maplibre: maplibregl },
);
map.addMarker({ lng: 106.7, lat: 10.776, popupHtml: '<b>Chợ Bến Thành</b>' });
map.on('poiClick', (poi) => console.log(poi.name));
```

`map.gl` là đối tượng `maplibregl.Map` — mọi API của MapLibre đều dùng được.

## 3. Tuỳ chọn

| Tuỳ chọn | Mặc định | Ý nghĩa |
|---|---|---|
| `style` | `'light'` | `'light'`, `'dark'` hoặc URL style riêng |
| `lang` | `'vi'` | `'en'` đổi nhãn sang tiếng Anh (nhãn chủ quyền luôn tiếng Việt) |
| `poiLayer` | `true` | ẩn lớp POI nếu `false` |
| `compactAttribution` | `false` | attribution gọn. Không có tuỳ chọn tắt — đây là nghĩa vụ giấy phép |

Thay `maps-api.example.com` / `maps-docs.example.com` bằng tên miền thật của bạn.
````

`apps/docs/scripts/copy-sdk.mjs`:
```js
#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const src = resolve('../../packages/web/dist');
const dst = resolve('public/sdk');
mkdirSync(dst, { recursive: true });
for (const f of ['mapslibvn.umd.js', 'mapslibvn.umd.js.map', 'mapslibvn.css']) {
  if (!existsSync(resolve(src, f))) throw new Error(`Thiếu ${f} — chạy pnpm --filter @mapslibvn/web build trước`);
  copyFileSync(resolve(src, f), resolve(dst, f));
}
console.log('✓ copy SDK vào public/sdk');
```

Thêm `public/sdk/` vào `apps/docs/.gitignore` (tạo file với dòng `public/sdk/` và `dist/`).

- [ ] **Step 2: Playground**

`apps/docs/public/playground.html`:
```html
<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>MapsLibVN Playground</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="/sdk/mapslibvn.css" />
  <style>
    html, body, #map { height: 100%; margin: 0; }
    #status { position: fixed; top: 8px; left: 8px; background: #fff; padding: 6px 10px; font: 13px system-ui; border-radius: 6px; z-index: 10; }
  </style>
</head>
<body>
  <div id="status" data-state="loading">Đang tải…</div>
  <div id="map"></div>
  <script src="/sdk/mapslibvn.umd.js"></script>
  <script>
    const params = new URLSearchParams(location.search);
    const apiBase = params.get('api') || 'http://localhost:8787';
    const status = document.getElementById('status');
    try {
      const map = MapsLibVN.createMap({
        container: 'map',
        apiKey: params.get('key') || 'mlv_live_demo',
        apiBase,
        style: params.get('style') || 'light',
        center: [106.700, 10.776],
        zoom: 14,
      });
      map.on('load', () => { status.textContent = 'Bản đồ đã tải'; status.dataset.state = 'loaded'; });
      map.gl.on('error', (e) => { console.warn('maplibre', e.error && e.error.message); });
      map.addMarker({ lng: 106.6981, lat: 10.7725, popupHtml: '<b>Chợ Bến Thành</b>' });
      window.__map = map;
    } catch (e) {
      status.textContent = 'Lỗi: ' + e.message; status.dataset.state = 'error';
    }
  </script>
</body>
</html>
```

- [ ] **Step 3: Playwright**

`apps/docs/playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:4321', trace: 'retain-on-failure' },
  webServer: [
    { command: 'pnpm --filter @mapslibvn/api dev:e2e', url: 'http://localhost:8787/healthz', reuseExistingServer: !process.env.CI, timeout: 120_000 },
    { command: 'pnpm preview', url: 'http://localhost:4321/', reuseExistingServer: !process.env.CI, timeout: 120_000 },
  ],
});
```

`apps/docs/e2e/playground.spec.ts`:
```ts
import { expect, test } from '@playwright/test';

test('playground tải bản đồ từ fixture, tiles 206/200, attribution hiện', async ({ page }) => {
  const tileResponses: number[] = [];
  page.on('response', (r) => {
    if (r.url().includes('/r2/tiles/')) tileResponses.push(r.status());
  });
  await page.goto('/playground.html?api=http://localhost:8787');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'loaded', { timeout: 30_000 });
  expect(tileResponses.length).toBeGreaterThan(0);
  expect(tileResponses.every((s) => s === 206 || s === 200)).toBe(true);
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap');
  await expect(page.locator('.maplibregl-marker')).toHaveCount(1);
});

test('style dark cũng tải', async ({ page }) => {
  await page.goto('/playground.html?api=http://localhost:8787&style=dark');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'loaded', { timeout: 30_000 });
});
```

Run: `pnpm install && pnpm --filter @mapslibvn/docs exec playwright install chromium`

Run: `pnpm --filter @mapslibvn/web build && pnpm --filter @mapslibvn/docs build`
Expected: `✓ copy SDK vào public/sdk`, Astro build xong `dist/`.

Run: `pnpm --filter @mapslibvn/docs e2e`
Expected: `2 passed`. (Glyph/sprite 404 trong dev là bình thường — nhãn không hiện nhưng bản đồ tải; test không kiểm nhãn.)

- [ ] **Step 4: Deploy docs lên Cloudflare Pages**

Run: `cd apps/docs && pnpm exec wrangler pages project create mapslibvn-docs --production-branch main` (một lần) rồi `pnpm exec wrangler pages deploy dist --project-name mapslibvn-docs`
Expected: URL `https://mapslibvn-docs.pages.dev`.

Mở `https://mapslibvn-docs.pages.dev/playground.html?api=https://mapslibvn-api-production.<account>.workers.dev` → bản đồ Việt Nam thật với nhãn tiếng Việt, tiles từ `tiles.<domain>`. Zoom ra z4: thấy 2 nhãn "Quần đảo Hoàng Sa (Việt Nam)", "Quần đảo Trường Sa (Việt Nam)". Ghi kết quả (kể cả quyết định spec 4.2 về lớp thế giới ngoài VN) vào DEVLOG.

- [ ] **Step 5: Lint, DEVLOG, commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`

Sửa `docs/DEVLOG.md`: "Task đang làm: M1c Task 4"; mục 1 ghi URL docs; mục 4 dòng T3.

```bash
git add -A
git commit -m "feat(docs): Starlight + playground + E2E Playwright offline bằng fixture"
git push
```

---

### Task 4: Deploy workflows và `data-update` trên GitHub Actions

**Files:**
- Create: `.github/workflows/deploy-api.yml`, `.github/workflows/deploy-docs.yml`, `.github/workflows/data-update.yml`

- [ ] **Step 1: Secrets trên repo GitHub (account dotienphong)**

Settings → Secrets and variables → Actions → thêm: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `KV_NAMESPACE_ID_META`, `R2_BUCKET`, `TILES_BASE`, `RCLONE_CONFIG_R2_ACCESS_KEY_ID`, `RCLONE_CONFIG_R2_SECRET_ACCESS_KEY`, `RCLONE_CONFIG_R2_ENDPOINT`.

- [ ] **Step 2: `deploy-api.yml`**

```yaml
name: Deploy API
on:
  push:
    branches: [main]
    paths: ['apps/api/**', 'packages/core/**', 'packages/style/**', 'pnpm-lock.yaml']
  workflow_dispatch:
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9.15.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @mapslibvn/core build && pnpm --filter @mapslibvn/style build
      - run: pnpm --filter @mapslibvn/api test
      - run: pnpm --filter @mapslibvn/api exec wrangler deploy --env production
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```
(Base style đã commit trong `packages/style/src/base/` nên không cần `vendor` ở CI.)

- [ ] **Step 3: `deploy-docs.yml`**

```yaml
name: Deploy Docs
on:
  push:
    branches: [main]
    paths: ['apps/docs/**', 'packages/web/**', 'packages/core/**', 'pnpm-lock.yaml']
  workflow_dispatch:
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9.15.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @mapslibvn/core build && pnpm --filter @mapslibvn/web build && pnpm --filter @mapslibvn/docs build
      - run: pnpm --filter @mapslibvn/docs exec wrangler pages deploy dist --project-name mapslibvn-docs
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

- [ ] **Step 4: `data-update.yml` (dự phòng cho máy nội bộ; chạy trong image GHCR)**

```yaml
name: Data update
on:
  workflow_dispatch:
    inputs:
      args:
        description: "Tham số: --tiles | --poi | --force | --dry-run"
        default: "--dry-run"
  schedule:
    - cron: "0 19 * * 0"   # 02:00 thứ Hai giờ VN — chỉ chạy khi máy nội bộ không đảm nhận (tắt bằng cách xoá schedule)
jobs:
  update:
    runs-on: ubuntu-latest
    timeout-minutes: 180
    container:
      image: ghcr.io/dotienphong/mapslibvn-pipeline:latest
      credentials:
        username: ${{ github.actor }}
        password: ${{ secrets.GITHUB_TOKEN }}
      options: --memory 6g
    env:
      MAPSLIBVN_IN_CONTAINER: "1"
      MAPSLIBVN_WORK: /app/work
      MAPSLIBVN_OUT: /app/out
      TILES_BASE: ${{ secrets.TILES_BASE }}
      R2_BUCKET: ${{ secrets.R2_BUCKET }}
      KV_NAMESPACE_ID_META: ${{ secrets.KV_NAMESPACE_ID_META }}
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      RCLONE_CONFIG_R2_TYPE: s3
      RCLONE_CONFIG_R2_PROVIDER: Cloudflare
      RCLONE_CONFIG_R2_ACL: private
      RCLONE_CONFIG_R2_ACCESS_KEY_ID: ${{ secrets.RCLONE_CONFIG_R2_ACCESS_KEY_ID }}
      RCLONE_CONFIG_R2_SECRET_ACCESS_KEY: ${{ secrets.RCLONE_CONFIG_R2_SECRET_ACCESS_KEY }}
      RCLONE_CONFIG_R2_ENDPOINT: ${{ secrets.RCLONE_CONFIG_R2_ENDPOINT }}
    steps:
      - name: data:update
        working-directory: /app
        run: node scripts/data-update.mjs ${{ github.event.inputs.args || '' }}
```

- [ ] **Step 5: Commit, kiểm tra 3 workflow**

```bash
git add .github/workflows
git commit -m "ci: deploy API/docs, data-update dự phòng trên Actions"
git push
```

Run: `GH_TOKEN="$(cat ~/.config/gh-dotienphong.token)" gh workflow run "Data update" -R dotienphong/maps-library-vietnam -f args="--dry-run"` rồi `… gh run list -R dotienphong/maps-library-vietnam --limit 5`
Expected: Deploy API, Deploy Docs `success` (do push chạm paths); Data update `success` với log `Kế hoạch: {"tiles":false,"poi":false…}` hoặc `(dry-run) dừng.`

- [ ] **Step 6: DEVLOG, commit**

Sửa `docs/DEVLOG.md`: "Task đang làm: M1c Task 5"; mục 4 dòng T4.

```bash
git add docs/DEVLOG.md && git commit -m "docs(devlog): workflows deploy xanh" && git push
```

---

### Task 5: Nghiệm thu M1 (spec mục 13, hàng M1)

**Files:**
- Modify: `docs/DEVLOG.md`, tick checkbox trong 3 plan M1a/M1b/M1c

- [ ] **Step 1: Chạy checklist và ghi kết quả thật vào DEVLOG mục 4**

1. `pnpm run setup` trên máy mới (macOS): … giây. Windows: ghi "PENDING" nếu chưa có máy.
2. Playground production (`mapslibvn-docs.pages.dev/playground.html?api=<worker>`): bản đồ VN nhãn tiếng Việt; đổi `&style=dark` OK; tiles đọc từ `tiles.<domain>` (tab Network: request Range 206 tới `tiles.<domain>`, không có request tới Worker cho tile).
3. Zoom z4: 2 nhãn chủ quyền hiện; QA lần build gần nhất xanh (log `data:update`).
4. Trang HTML trắng nhúng bằng `<script src="https://mapslibvn-docs.pages.dev/sdk/mapslibvn.umd.js">` + `MapsLibVN.createMap({...})` → chạy.
5. `pnpm data:update --dry-run` báo không có gì mới; `pnpm data:update --tiles --force` chạy trọn vòng (ghi thời gian).
6. Quyết định spec 4.2 (lớp thế giới ngoài VN ở z0–6): ghi "đạt" hoặc "dùng dự phòng Protomaps — tạo task ở M2".
7. `pnpm test` (root + api) và E2E xanh; CI xanh.

- [ ] **Step 2: Chuyển mốc**

`docs/DEVLOG.md` mục 1: "Mốc: M2 — Kho POI + máy chủ nội bộ"; "Plan: (viết plan cấp bước bằng skill writing-plans theo roadmap mục 3 — chưa có file)"; "Task đang làm: viết plan M2". Mục 2: "Viết `docs/superpowers/plans/YYYY-MM-DD-m2-kho-poi-may-chu.md` từ roadmap mục 3, sau đó M2 Task 1 (máy chủ nội bộ — cần PHONG chuẩn bị máy 24/7)".

```bash
git add -A
git commit -m "docs: nghiệm thu M1 (M1a+M1b+M1c), chuyển sang M2"
git push
```
