# M1b — Core, style, pipeline tiles, `data:update --tiles`: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Có file `vn-YYYYMMDD.pmtiles` cho Việt Nam đã qua QA chủ quyền nằm trên R2, style light/dark dạng template, manifest phiên bản trong KV, và lệnh `pnpm data:update --tiles` chạy trọn vòng. (Worker, Web SDK, docs ở plan `2026-08-26-m1c-worker-web-sdk-docs.md`.)

**Architecture:** `@mapslibvn/core` giữ chuỗi attribution + client khung; `@mapslibvn/style` biến style OSM Liberty/Dark Matter thành template có placeholder `{TILES_BASE}`/`{VN_FILE}` với nhãn `coalesce(name:vi, name)` và lớp chủ quyền; `pipelines/tiles` là các script Node/Python chạy trong image Docker (download → patch pyosmium → Planetiler → QA → rclone lên R2 → manifest KV); `scripts/data-update.mjs` điều phối và tự dò phiên bản Geofabrik.

**Tech Stack:** TypeScript/Node 22, tsup, Vitest, `@maplibre/maplibre-gl-style-spec`, `pmtiles`, `@mapbox/vector-tile`, `pbf`, pyosmium + pytest, Planetiler, osmium-tool, rclone, Wrangler 4 (KV).

**Spec:** mục 4 (P1), 5.9 (lệnh `data:update`), 7.1 (core), 12.3 (attribution).

---

## Cấu trúc file tạo trong plan này

```
packages/core/{package.json,tsconfig.json}
packages/core/src/{index.ts,attribution.ts,attribution.test.ts,errors.ts,client.ts,client.test.ts}
packages/style/{package.json,tsconfig.json}
packages/style/src/base/{osm-liberty.json,dark-matter.json,SOURCES.md,LICENSE.osm-liberty,LICENSE.dark-matter}
packages/style/src/sovereignty.geojson
packages/style/scripts/{vendor.mjs,build.mjs}
packages/style/src/{transform.mjs,transform.test.ts}
packages/style/assets/sprites/osm-liberty{.json,.png,@2x.json,@2x.png}      (commit)
packages/style/assets/fonts/…                                                (gitignore, tải bằng vendor)
pipelines/tiles/{package.json}
pipelines/tiles/src/{download.mjs,build.mjs,make-fixture.mjs,inspect.mjs,qa.mjs,upload.mjs,smoke.mjs,manifest.mjs}
pipelines/tiles/src/lib/{env.mjs,node-source.mjs,qa-rules.mjs,qa-rules.test.mjs,dates.mjs,dates.test.mjs}
pipelines/tiles/python/{patch_sovereignty.py,test_patch_sovereignty.py}
pipelines/tiles/qa.config.json
pipelines/tiles/fixtures/q1.pmtiles                                          (commit, ≤ 15 MB)
scripts/{data-update.mjs,data-rollback.mjs}
scripts/lib/{update-plan.mjs,update-plan.test.mjs}
```

---

### Task 1: `@mapslibvn/core` — attribution và client khung

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`, `packages/core/src/attribution.ts`, `packages/core/src/attribution.test.ts`, `packages/core/src/errors.ts`, `packages/core/src/client.ts`, `packages/core/src/client.test.ts`
- Modify: `vitest.config.ts` (thêm `.mjs` cho pipelines)

- [x] **Step 1: Tạo package**

`packages/core/package.json`:
```json
{
  "name": "@mapslibvn/core",
  "version": "0.1.0",
  "description": "Client, kiểu dữ liệu và chuỗi ghi nguồn dùng chung cho MapsLibVN",
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist"],
  "sideEffects": false,
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts --clean --target es2022",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "tsup": "^8.3.0",
    "typescript": "^5.6.0"
  }
}
```

`packages/core/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "lib": ["ES2022", "DOM"], "noEmit": true, "rootDir": "src" },
  "include": ["src"]
}
```

Sửa `vitest.config.ts` (gốc) để nhận cả `.mjs` trong pipelines:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'scripts/**/*.test.mjs',
      'packages/*/src/**/*.test.{ts,mjs}',
      'pipelines/*/src/**/*.test.{ts,mjs}',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', 'apps/**'],
  },
});
```

Run: `pnpm install`
Expected: cài `tsup`; lockfile cập nhật.

- [x] **Step 2: Test attribution (thất bại)**

`packages/core/src/attribution.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ATTRIBUTION_LINKS, attributionHtml, attributionText } from './attribution';

describe('attribution', () => {
  it('văn bản đúng chuỗi bắt buộc trong spec 12.3', () => {
    expect(attributionText()).toBe(
      '© MapsLibVN · © OpenStreetMap contributors (ODbL) · © OpenMapTiles · Places: Overture Maps Foundation (CDLA-Permissive 2.0), Foursquare OS Places (Apache-2.0)',
    );
  });

  it('HTML có đủ 5 liên kết mở tab mới', () => {
    const html = attributionHtml();
    expect(html.match(/<a /g)).toHaveLength(5);
    expect(html).toContain('href="https://www.openstreetmap.org/copyright"');
    expect(html).toContain('rel="noopener"');
  });

  it('danh sách liên kết có 5 mục với href https', () => {
    expect(ATTRIBUTION_LINKS).toHaveLength(5);
    for (const l of ATTRIBUTION_LINKS) expect(l.href).toMatch(/^https:\/\//);
  });
});
```

Run: `pnpm test`
Expected: FAIL — không tìm thấy `./attribution`.

- [x] **Step 3: Viết `attribution.ts`**

```ts
export interface AttributionLink {
  text: string;
  href: string;
  license?: string;
}

export const ATTRIBUTION_LINKS: readonly AttributionLink[] = [
  { text: '© MapsLibVN', href: 'https://github.com/dotienphong/maps-library-vietnam' },
  { text: '© OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright', license: 'ODbL' },
  { text: '© OpenMapTiles', href: 'https://openmaptiles.org/' },
  { text: 'Places: Overture Maps Foundation', href: 'https://overturemaps.org/', license: 'CDLA-Permissive 2.0' },
  { text: 'Foursquare OS Places', href: 'https://opensource.foursquare.com/os-places/', license: 'Apache-2.0' },
];

const withLicense = (l: AttributionLink, text: string) => (l.license ? `${text} (${l.license})` : text);

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Ghép: 3 mục đầu bằng " · ", hai nguồn Places ngăn bằng ", " (đúng chuỗi spec 12.3). */
function join(parts: string[]): string {
  const [a, b, c, d, e] = parts as [string, string, string, string, string];
  return `${a} · ${b} · ${c} · ${d}, ${e}`;
}

export function attributionText(): string {
  return join(ATTRIBUTION_LINKS.map((l) => withLicense(l, l.text)));
}

export function attributionHtml(): string {
  return join(
    ATTRIBUTION_LINKS.map((l) =>
      withLicense(l, `<a href="${l.href}" target="_blank" rel="noopener">${escapeHtml(l.text)}</a>`),
    ),
  );
}
```

Run: `pnpm test`
Expected: 3 test attribution xanh.

- [x] **Step 4: Test client khung (thất bại)**

`packages/core/src/client.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { createClient } from './client';
import { MapsLibVNError } from './errors';

const okFetch = (body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));

describe('createClient', () => {
  it('gọi /v1/attribution với header X-Api-Key và baseUrl không có dấu / cuối', async () => {
    const fetch = okFetch({ text: 't', html: 'h', links: [] });
    const c = createClient({ apiKey: 'mlv_live_abc', baseUrl: 'https://api.example.test/', fetch });
    const r = await c.attribution();
    expect(r.text).toBe('t');
    const [url, init] = fetch.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe('https://api.example.test/v1/attribution');
    expect((init.headers as Record<string, string>)['X-Api-Key']).toBe('mlv_live_abc');
  });

  it('styleUrl mang theme và key', () => {
    const c = createClient({ apiKey: 'k 1', baseUrl: 'https://api.example.test', fetch: okFetch({}) });
    expect(c.styleUrl('dark')).toBe('https://api.example.test/v1/styles/dark.json?key=k%201');
  });

  it('ném MapsLibVNError với code/request_id từ body lỗi', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: 'missing_key', message: 'Thiếu key', request_id: 'r1' } }), {
          status: 401,
        }),
    );
    const c = createClient({ apiKey: '', baseUrl: 'https://api.example.test', fetch });
    await expect(c.attribution()).rejects.toMatchObject<Partial<MapsLibVNError>>({
      status: 401,
      code: 'missing_key',
      requestId: 'r1',
    });
  });
});
```

Run: `pnpm test`
Expected: FAIL — không tìm thấy `./client`, `./errors`.

- [x] **Step 5: Viết `errors.ts`, `client.ts`, `index.ts`**

`packages/core/src/errors.ts`:
```ts
export class MapsLibVNError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;

  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message);
    this.name = 'MapsLibVNError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}
```

`packages/core/src/client.ts`:
```ts
import { MapsLibVNError } from './errors';

export type Theme = 'light' | 'dark';

export interface ClientOptions {
  /** Khoá API dạng mlv_live_… */
  apiKey: string;
  /** Gốc API, ví dụ https://maps-api.example.com */
  baseUrl: string;
  /** Cho phép tiêm fetch (test, môi trường không có global fetch) */
  fetch?: typeof globalThis.fetch;
}

export interface AttributionResponse {
  text: string;
  html: string;
  links: { text: string; href: string; license?: string }[];
}

interface ErrorBody {
  error?: { code?: string; message?: string; request_id?: string };
}

export function createClient(opts: ClientOptions) {
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);

  async function get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const url = new URL(baseUrl + path);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
    const res = await doFetch(url, { headers: { 'X-Api-Key': opts.apiKey } });
    if (!res.ok) {
      let body: ErrorBody = {};
      try {
        body = (await res.json()) as ErrorBody;
      } catch {
        /* body không phải JSON */
      }
      throw new MapsLibVNError(
        res.status,
        body.error?.code ?? 'http_error',
        body.error?.message ?? `HTTP ${res.status}`,
        body.error?.request_id,
      );
    }
    return (await res.json()) as T;
  }

  return {
    baseUrl,
    attribution: () => get<AttributionResponse>('/v1/attribution'),
    styleUrl: (theme: Theme) => `${baseUrl}/v1/styles/${theme}.json?key=${encodeURIComponent(opts.apiKey)}`,
  };
}

export type MapsLibVNClient = ReturnType<typeof createClient>;
```

`packages/core/src/index.ts`:
```ts
export * from './attribution';
export * from './client';
export * from './errors';
```

Run: `pnpm test`
Expected: 6 test core xanh (tổng 22).

- [x] **Step 6: Build, typecheck, commit**

Run: `pnpm --filter @mapslibvn/core build && pnpm typecheck && pnpm lint`
Expected: `dist/index.js`, `dist/index.d.ts` sinh ra; không lỗi.

Sửa `docs/DEVLOG.md`: "Task đang làm: M1b Task 2"; mục 4 thêm dòng M1b T1.

```bash
git add -A
git commit -m "feat(core): attribution theo spec 12.3 + client khung (attribution, styleUrl)"
git push
```

---

### Task 2: `@mapslibvn/style` — vendor base, transform thành template, lớp chủ quyền

**Files:**
- Create: `packages/style/package.json`, `packages/style/tsconfig.json`, `packages/style/scripts/vendor.mjs`, `packages/style/scripts/build.mjs`, `packages/style/src/transform.mjs`, `packages/style/src/transform.test.ts`, `packages/style/src/sovereignty.geojson`, `packages/style/src/base/SOURCES.md`, `packages/style/.gitignore`

- [x] **Step 1: Tạo package và vendor base style + sprite**

`packages/style/package.json`:
```json
{
  "name": "@mapslibvn/style",
  "version": "0.1.0",
  "description": "Style MapLibre (light/dark) dạng template + lớp chủ quyền cho MapsLibVN",
  "license": "MIT",
  "type": "module",
  "main": "./src/transform.mjs",
  "exports": {
    ".": "./src/transform.mjs",
    "./templates/light": "./dist/mapslibvn-light.template.json",
    "./templates/dark": "./dist/mapslibvn-dark.template.json"
  },
  "scripts": {
    "vendor": "node scripts/vendor.mjs",
    "build": "node scripts/build.mjs",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@maplibre/maplibre-gl-style-spec": "^23.0.0",
    "typescript": "^5.6.0"
  }
}
```

`packages/style/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "allowJs": true, "checkJs": true, "noEmit": true, "types": ["node"], "module": "NodeNext", "moduleResolution": "NodeNext" },
  "include": ["src/**/*.mjs", "scripts/**/*.mjs"]
}
```

`packages/style/.gitignore`:
```
assets/fonts/
dist/
```

`packages/style/scripts/vendor.mjs` (tải base style, sprite, font; ghi nguồn):
```js
#!/usr/bin/env node
// Tải các tài nguyên mở về đúng chỗ. Base style + sprite được commit; fonts để trong assets/fonts (gitignore).
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OSM_LIBERTY = 'https://raw.githubusercontent.com/maputnik/osm-liberty/gh-pages';
const DARK_MATTER = 'https://raw.githubusercontent.com/openmaptiles/dark-matter-gl-style/master';
const FONTS_ZIP = 'https://github.com/openmaptiles/fonts/releases/download/v2.0/noto-sans.zip';
const FONT_STACKS = ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic'];

async function download(url, dest, { optional = false } = {}) {
  mkdirSync(dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) {
    if (optional) {
      console.warn('⚠ bỏ qua', url, `HTTP ${res.status}`);
      return;
    }
    throw new Error(`${url} → HTTP ${res.status}`);
  }
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log('✓', dest.replace(root + '/', ''));
}

const only = process.argv[2]; // 'styles' | 'fonts' | undefined (tất cả)

if (!only || only === 'styles') {
  await download(`${OSM_LIBERTY}/style.json`, resolve(root, 'src/base/osm-liberty.json'));
  await download(`${OSM_LIBERTY}/LICENSE.md`, resolve(root, 'src/base/LICENSE.osm-liberty'), { optional: true });
  await download(`${DARK_MATTER}/style.json`, resolve(root, 'src/base/dark-matter.json'));
  await download(`${DARK_MATTER}/LICENSE.md`, resolve(root, 'src/base/LICENSE.dark-matter'), { optional: true });
  for (const f of ['osm-liberty.json', 'osm-liberty.png', 'osm-liberty@2x.json', 'osm-liberty@2x.png']) {
    await download(`${OSM_LIBERTY}/sprites/${f}`, resolve(root, 'assets/sprites', f));
  }
  writeFileSync(
    resolve(root, 'src/base/SOURCES.md'),
    `# Nguồn base style (vendor ngày ${new Date().toISOString().slice(0, 10)})\n\n` +
      `- osm-liberty.json + sprites: ${OSM_LIBERTY} (BSD-3-Clause, xem LICENSE.osm-liberty)\n` +
      `- dark-matter.json: ${DARK_MATTER} (code BSD-3-Clause, thiết kế CC-BY 4.0, xem LICENSE.dark-matter)\n` +
      `- fonts: ${FONTS_ZIP} — Noto Sans (SIL OFL 1.1), chỉ lấy 3 stack: ${FONT_STACKS.join(', ')}\n\n` +
      `Cập nhật lại: pnpm --filter @mapslibvn/style vendor\n`,
  );
}

if (!only || only === 'fonts') {
  const fontsDir = resolve(root, 'assets/fonts');
  if (FONT_STACKS.every((s) => existsSync(resolve(fontsDir, s, '0-255.pbf')))) {
    console.log('✓ fonts đã có');
  } else {
    const zip = resolve(root, 'assets/fonts.zip');
    await download(FONTS_ZIP, zip);
    mkdirSync(fontsDir, { recursive: true });
    // Chỉ giải nén 3 stack cần dùng
    const r = spawnSync('unzip', ['-q', '-o', zip, ...FONT_STACKS.map((s) => `*/${s}/*`), '-d', resolve(root, 'assets/fonts-tmp')], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('unzip thất bại');
    for (const s of FONT_STACKS) {
      const found = spawnSync('sh', ['-c', `find "${resolve(root, 'assets/fonts-tmp')}" -type d -name "${s}" | head -1`], { encoding: 'utf8' }).stdout.trim();
      if (!found) throw new Error(`Không thấy stack "${s}" trong zip`);
      spawnSync('rm', ['-rf', resolve(fontsDir, s)]);
      spawnSync('mv', [found, resolve(fontsDir, s)]);
    }
    spawnSync('rm', ['-rf', resolve(root, 'assets/fonts-tmp'), zip]);
    console.log('✓ fonts:', FONT_STACKS.join(', '));
  }
}
```

Run: `pnpm install && pnpm --filter @mapslibvn/style vendor`
Expected: các dòng `✓ src/base/osm-liberty.json` … `✓ fonts: Noto Sans Regular, Noto Sans Bold, Noto Sans Italic`.

Kết quả thực tế 2026-08-27: `v2.0.zip` chỉ chứa Roboto; release v2.0 có asset
`noto-sans.zip` riêng và asset này đã cung cấp đủ ba stack, tổng 101 MB sau giải nén.

Nếu URL fonts trả 404 (tên asset release khác): mở `https://github.com/openmaptiles/fonts/releases`, lấy URL zip đúng, sửa `FONTS_ZIP`, ghi "Quyết định phát sinh" trong DEVLOG. Nếu zip không có 3 stack Noto Sans: dùng phương án sinh glyph trong container — `docker run --rm -v "$PWD/packages/style/assets:/out" mapslibvn/pipeline:local sh -c "npm i -g fontnik && build-glyphs /path/NotoSans-Regular.ttf '/out/fonts/Noto Sans Regular'"` với TTF từ `https://github.com/notofonts/latin-greek-cyrillic/releases` (OFL) — ghi lại cách đã dùng.

Kiểm tra: `ls packages/style/assets/fonts/"Noto Sans Regular" | head -3` → `0-255.pbf 1024-1279.pbf …`.

- [x] **Step 2: Tạo `sovereignty.geojson`**

`packages/style/src/sovereignty.geojson`:
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": { "name": "Quần đảo Hoàng Sa (Việt Nam)", "id": "hoang-sa" },
      "geometry": { "type": "Point", "coordinates": [112.0, 16.5] }
    },
    {
      "type": "Feature",
      "properties": { "name": "Quần đảo Trường Sa (Việt Nam)", "id": "truong-sa" },
      "geometry": { "type": "Point", "coordinates": [114.0, 10.0] }
    }
  ]
}
```

- [x] **Step 3: Test transform (thất bại)**

`packages/style/src/transform.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { ALLOWED_FONTS, fillTemplate, mapFont, transformStyle } from './transform.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const sovereignty = JSON.parse(readFileSync(resolve(here, 'sovereignty.geojson'), 'utf8'));

const tinyBase = {
  version: 8,
  name: 'Tiny',
  sources: {
    openmaptiles: { type: 'vector', url: 'https://example.com/tiles.json' },
    relief: { type: 'raster', tiles: ['https://example.com/{z}/{x}/{y}.png'] },
  },
  glyphs: 'https://example.com/{fontstack}/{range}.pbf',
  sprite: 'https://example.com/sprite',
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#fff' } },
    { id: 'relief', type: 'raster', source: 'relief' },
    {
      id: 'place_city',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      layout: { 'text-field': '{name:latin} {name:nonlatin}', 'text-font': ['Roboto Medium'], 'text-size': 12 },
    },
    {
      id: 'housenumber',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'housenumber',
      layout: { 'text-field': '{housenumber}', 'text-font': ['Roboto Condensed Italic'] },
    },
  ],
};

const filled = (tpl: unknown) =>
  JSON.parse(fillTemplate(JSON.stringify(tpl), { TILES_BASE: 'https://tiles.test', VN_FILE: 'vn-20260826' }));

describe('mapFont', () => {
  it('ánh xạ mọi font về 3 stack Noto Sans', () => {
    expect(mapFont('Roboto Medium')).toBe('Noto Sans Bold');
    expect(mapFont('Metropolis Semi Bold')).toBe('Noto Sans Bold');
    expect(mapFont('Roboto Condensed Italic')).toBe('Noto Sans Italic');
    expect(mapFont('Roboto Regular')).toBe('Noto Sans Regular');
  });
});

describe('transformStyle (tiny base)', () => {
  const out = transformStyle(tinyBase, { theme: 'light', sovereignty });

  it('chỉ còn nguồn openmaptiles (pmtiles template) và sovereignty', () => {
    expect(Object.keys(out.sources).sort()).toEqual(['openmaptiles', 'sovereignty']);
    expect(out.sources.openmaptiles.url).toBe('pmtiles://{TILES_BASE}/tiles/{VN_FILE}.pmtiles');
    expect(out.glyphs).toBe('{TILES_BASE}/assets/fonts/{fontstack}/{range}.pbf');
    expect(out.sprite).toBe('{TILES_BASE}/assets/sprites/osm-liberty');
  });

  it('bỏ layer raster; nhãn tên dùng coalesce name:vi; housenumber giữ nguyên', () => {
    const ids = out.layers.map((l: { id: string }) => l.id);
    expect(ids).not.toContain('relief');
    const city = out.layers.find((l: { id: string }) => l.id === 'place_city');
    expect(city.layout['text-field']).toEqual(['coalesce', ['get', 'name:vi'], ['get', 'name']]);
    const hn = out.layers.find((l: { id: string }) => l.id === 'housenumber');
    expect(hn.layout['text-field']).toBe('{housenumber}');
  });

  it('mọi text-font thuộc ALLOWED_FONTS', () => {
    for (const l of out.layers) {
      const f = l.layout?.['text-font'];
      if (f) for (const name of f) expect(ALLOWED_FONTS).toContain(name);
    }
  });

  it('có lớp chủ quyền minzoom 4, sort-key 0, cho phép overlap, đứng cuối', () => {
    const sov = out.layers.at(-1);
    expect(sov.id).toBe('sovereignty-label');
    expect(sov.minzoom).toBe(4);
    expect(sov.layout['symbol-sort-key']).toBe(0);
    expect(sov.layout['text-allow-overlap']).toBe(true);
    expect(out.sources.sovereignty.data.features).toHaveLength(2);
  });

  it('template điền xong là style hợp lệ theo maplibre-gl-style-spec', () => {
    expect(validateStyleMin(filled(out))).toEqual([]);
  });
});

describe('transformStyle (base thật đã vendor)', () => {
  for (const [file, theme] of [
    ['base/osm-liberty.json', 'light'],
    ['base/dark-matter.json', 'dark'],
  ] as const) {
    it(`${file} → template hợp lệ, nhãn tiếng Việt, font Noto`, () => {
      const base = JSON.parse(readFileSync(resolve(here, file), 'utf8'));
      const out = transformStyle(base, { theme, sovereignty });
      expect(validateStyleMin(filled(out))).toEqual([]);
      for (const l of out.layers) {
        if (l.type !== 'symbol' || l.source !== 'openmaptiles' || !l.layout) continue;
        const tf = l.layout['text-field'];
        if (tf && JSON.stringify(tf).includes('name')) {
          expect(tf).toEqual(['coalesce', ['get', 'name:vi'], ['get', 'name']]);
        }
        for (const name of l.layout['text-font'] ?? []) expect(ALLOWED_FONTS).toContain(name);
      }
      expect(out.layers.at(-1).id).toBe('sovereignty-label');
    });
  }
});
```

Run: `pnpm test`
Expected: FAIL — không tìm thấy `./transform.mjs`.

- [x] **Step 4: Viết `transform.mjs`**

```js
// Biến style MapLibre nền (OSM Liberty / Dark Matter) thành template MapsLibVN.
// Placeholder: {TILES_BASE} {VN_FILE} — Worker điền khi phục vụ /v1/styles/*.json

export const ALLOWED_FONTS = ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic'];
export const NAME_EXPRESSION = ['coalesce', ['get', 'name:vi'], ['get', 'name']];

/** @param {string} font */
export function mapFont(font) {
  if (/italic/i.test(font)) return 'Noto Sans Italic';
  if (/bold|medium|semi|black|heavy/i.test(font)) return 'Noto Sans Bold';
  return 'Noto Sans Regular';
}

/** @param {unknown} textFont */
function mapTextFont(textFont) {
  if (Array.isArray(textFont) && textFont.every((f) => typeof f === 'string')) {
    return [...new Set(textFont.map((f) => mapFont(String(f))))];
  }
  if (Array.isArray(textFont) && textFont[0] === 'literal' && Array.isArray(textFont[1])) {
    return [...new Set(textFont[1].map((f) => mapFont(String(f))))];
  }
  return ['Noto Sans Regular']; // biểu thức phức tạp → dùng font mặc định
}

/**
 * @param {Record<string, any>} base style nền
 * @param {{ theme: 'light' | 'dark', sovereignty: Record<string, any> }} opts
 */
export function transformStyle(base, opts) {
  const layers = base.layers
    .filter((l) => !l.source || l.source === 'openmaptiles')
    .map((l) => {
      if (l.type !== 'symbol' || !l.layout) return l;
      const layout = { ...l.layout };
      const tf = layout['text-field'];
      if (tf !== undefined && JSON.stringify(tf).includes('name')) layout['text-field'] = NAME_EXPRESSION;
      if (layout['text-font'] !== undefined) layout['text-font'] = mapTextFont(layout['text-font']);
      return { ...l, layout };
    });

  layers.push({
    id: 'sovereignty-label',
    type: 'symbol',
    source: 'sovereignty',
    minzoom: 4,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 8, 16],
      'text-allow-overlap': true,
      'text-ignore-placement': true,
      'symbol-sort-key': 0,
    },
    paint: {
      'text-color': opts.theme === 'dark' ? '#f4f4f4' : '#1b3a6b',
      'text-halo-color': opts.theme === 'dark' ? '#111111' : '#ffffff',
      'text-halo-width': 1.5,
    },
  });

  return {
    version: 8,
    name: opts.theme === 'dark' ? 'MapsLibVN Dark' : 'MapsLibVN Light',
    metadata: { 'mapslibvn:theme': opts.theme, 'mapslibvn:base': base.name ?? 'unknown' },
    sources: {
      openmaptiles: {
        type: 'vector',
        url: 'pmtiles://{TILES_BASE}/tiles/{VN_FILE}.pmtiles',
        attribution: '© OpenStreetMap contributors · © OpenMapTiles',
      },
      sovereignty: { type: 'geojson', data: opts.sovereignty },
    },
    glyphs: '{TILES_BASE}/assets/fonts/{fontstack}/{range}.pbf',
    sprite: '{TILES_BASE}/assets/sprites/osm-liberty',
    layers,
  };
}

/**
 * Điền placeholder vào template (chuỗi JSON).
 * @param {string} templateJson @param {Record<string, string>} values
 */
export function fillTemplate(templateJson, values) {
  return templateJson.replace(/\{(TILES_BASE|VN_FILE|POI_FILE)\}/g, (m, key) => values[key] ?? m);
}
```

Run: `pnpm test`
Expected: tất cả test style xanh (kể cả với 2 base thật). Nếu `validateStyleMin` báo lỗi ở base thật (ví dụ thuộc tính lạ), in lỗi, sửa transform (thường là layer có `source` khác tên) và ghi vào DEVLOG.

- [x] **Step 5: Script build template**

`packages/style/scripts/build.mjs`:
```js
#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformStyle } from '../src/transform.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(resolve(root, p), 'utf8'));
const sovereignty = read('src/sovereignty.geojson');
mkdirSync(resolve(root, 'dist'), { recursive: true });

for (const [base, theme] of [
  ['src/base/osm-liberty.json', 'light'],
  ['src/base/dark-matter.json', 'dark'],
]) {
  const out = transformStyle(read(base), { theme, sovereignty });
  const file = resolve(root, `dist/mapslibvn-${theme}.template.json`);
  writeFileSync(file, JSON.stringify(out));
  console.log('✓', file.replace(root + '/', ''), `${out.layers.length} layers`);
}
copyFileSync(resolve(root, 'src/sovereignty.geojson'), resolve(root, 'dist/sovereignty.geojson'));
```

Run: `pnpm --filter @mapslibvn/style build`
Expected: `✓ dist/mapslibvn-light.template.json N layers`, `✓ dist/mapslibvn-dark.template.json N layers`.

- [x] **Step 6: Lint, typecheck, DEVLOG, commit (kèm base + sprite đã vendor)**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: xanh.

Sửa `docs/DEVLOG.md`: "Task đang làm: M1b Task 3"; mục 3 thêm "Template style chỉ dùng placeholder TILES_BASE/VN_FILE ở M1 (API_BASE/KEY thêm khi có POI details ở M2/M3)"; mục 4 dòng T2.

```bash
git add -A
git commit -m "feat(style): template light/dark từ OSM Liberty/Dark Matter, nhãn name:vi, lớp chủ quyền, font Noto"
git push
```

---

### Task 3: Pipeline tiles — tải nguồn và patch chủ quyền (pyosmium)

**Files:**
- Create: `pipelines/tiles/package.json`, `pipelines/tiles/src/lib/env.mjs`, `pipelines/tiles/src/lib/dates.mjs`, `pipelines/tiles/src/lib/dates.test.mjs`, `pipelines/tiles/src/download.mjs`, `pipelines/tiles/python/patch_sovereignty.py`, `pipelines/tiles/python/test_patch_sovereignty.py`
- Modify: `pipelines/Dockerfile` (cài deps của pipelines), `.dockerignore`

- [x] **Step 1: Package và helper**

`pipelines/tiles/package.json`:
```json
{
  "name": "@mapslibvn/pipeline-tiles",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Pipeline tiles nền Việt Nam: download → patch → Planetiler → QA → upload → manifest",
  "scripts": { "typecheck": "tsc -p tsconfig.json" },
  "dependencies": {
    "@mapbox/vector-tile": "^2.0.3",
    "pbf": "^4.0.1",
    "pmtiles": "^4.3.0"
  },
  "devDependencies": { "typescript": "^5.6.0" }
}
```

`pipelines/tiles/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "allowJs": true, "checkJs": true, "noEmit": true, "types": ["node"], "module": "NodeNext", "moduleResolution": "NodeNext" },
  "include": ["src/**/*.mjs"]
}
```

`pipelines/tiles/src/lib/env.mjs`:
```js
import { resolve } from 'node:path';

/** Thư mục làm việc: trong container là /app/work, ngoài container là ./work */
export const WORK = process.env.MAPSLIBVN_WORK ?? resolve('work');
export const OUT = process.env.MAPSLIBVN_OUT ?? resolve('out');
export const GEOFABRIK_PBF = 'https://download.geofabrik.de/asia/vietnam-latest.osm.pbf';
export const OSM_PBF = resolve(WORK, 'data/sources/vietnam.osm.pbf');
export const PATCHED_PBF = resolve(WORK, 'vietnam-patched.osm.pbf');

/** @param {string} name */
export function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Thiếu biến môi trường ${name} (xem .env.example)`);
  return v;
}
```

`pipelines/tiles/src/lib/dates.test.mjs`:
```js
import { describe, expect, it } from 'vitest';
import { releaseName, stampVN } from './dates.mjs';

describe('stampVN', () => {
  it('đổi thời điểm UTC sang ngày giờ VN (UTC+7) dạng YYYYMMDD', () => {
    expect(stampVN(new Date('2026-08-26T18:30:00Z'))).toBe('20260827');
    expect(stampVN(new Date('2026-08-26T10:00:00Z'))).toBe('20260826');
  });
});

describe('releaseName', () => {
  it('ghép tiền tố và ngày', () => {
    expect(releaseName('vn', new Date('2026-08-26T10:00:00Z'))).toBe('vn-20260826');
  });
});
```

`pipelines/tiles/src/lib/dates.mjs`:
```js
/** @param {Date} d */
export function stampVN(d) {
  const vn = new Date(d.getTime() + 7 * 3600 * 1000);
  return vn.toISOString().slice(0, 10).replace(/-/g, '');
}

/** @param {'vn' | 'poi'} prefix @param {Date} [d] */
export function releaseName(prefix, d = new Date()) {
  return `${prefix}-${stampVN(d)}`;
}
```

Run: `pnpm install && pnpm test`
Expected: test dates xanh.

- [x] **Step 2: `download.mjs`**

```js
#!/usr/bin/env node
// Tải OSM Việt Nam + Natural Earth + water polygons bằng Planetiler (--only-download), kiểm md5.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { run } from '../../../scripts/lib/run.mjs';
import { GEOFABRIK_PBF, OSM_PBF, WORK } from './lib/env.mjs';

mkdirSync(WORK, { recursive: true });
run('planetiler', ['--area=vietnam', '--only-download'], { cwd: WORK }); // Planetiler lưu vào <cwd>/data/sources/

if (!existsSync(OSM_PBF)) throw new Error(`Không thấy ${OSM_PBF} sau khi tải`);

const expected = (await (await fetch(`${GEOFABRIK_PBF}.md5`)).text()).split(/\s+/)[0];
const hash = createHash('md5');
for await (const chunk of createReadStream(OSM_PBF)) hash.update(chunk);
const actual = hash.digest('hex');
if (actual !== expected) throw new Error(`md5 lệch: file=${actual} geofabrik=${expected} (Geofabrik có thể vừa cập nhật — chạy lại)`);
console.log(`✓ ${OSM_PBF} md5 ${actual}`);
```

Ghi chú: Planetiler lưu file dưới `<download-dir>/sources/vietnam.osm.pbf`. Nếu tên file khác (`--help` cho biết), sửa `OSM_PBF` trong `env.mjs` và ghi DEVLOG.

- [x] **Step 3: Test patch (pytest, thất bại)**

`pipelines/tiles/python/test_patch_sovereignty.py`:
```python
import subprocess, sys, pathlib
import osmium
from osmium.osm import mutable

HERE = pathlib.Path(__file__).parent
SCRIPT = HERE / "patch_sovereignty.py"


def write_fixture(path):
    w = osmium.SimpleWriter(str(path))
    # 1: trong bbox Hoàng Sa, có name:vi → name := name:vi, bỏ name:zh/name:en
    w.add_node(mutable.Node(id=1, location=(112.0, 16.5), tags={
        "place": "archipelago", "name": "Paracel Islands", "name:vi": "Quần đảo Hoàng Sa",
        "name:zh": "西沙群岛", "name:en": "Paracel Islands"}))
    # 2: trong bbox Trường Sa, không có name:vi → xoá name
    w.add_node(mutable.Node(id=2, location=(114.36, 10.38), tags={"place": "island", "name": "Itu Aba Island"}))
    # 3: ngoài bbox → giữ nguyên (kể cả name:zh)
    w.add_node(mutable.Node(id=3, location=(106.7, 10.77), tags={"place": "city", "name": "Thành phố Hồ Chí Minh", "name:zh": "胡志明市"}))
    # 4: way qua node 2 → cũng bị patch
    w.add_way(mutable.Way(id=10, nodes=[2, 3], tags={"natural": "coastline", "name": "Itu Aba coast"}))
    w.close()


class Collect(osmium.SimpleHandler):
    def __init__(self):
        super().__init__(); self.tags = {}
    def node(self, n): self.tags[("n", n.id)] = {t.k: t.v for t in n.tags}
    def way(self, w): self.tags[("w", w.id)] = {t.k: t.v for t in w.tags}


def test_patch(tmp_path):
    src, dst = tmp_path / "in.osm.pbf", tmp_path / "out.osm.pbf"
    write_fixture(src)
    r = subprocess.run([sys.executable, str(SCRIPT), str(src), str(dst)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    c = Collect(); c.apply_file(str(dst))
    assert c.tags[("n", 1)] == {"place": "archipelago", "name": "Quần đảo Hoàng Sa", "name:vi": "Quần đảo Hoàng Sa"}
    assert c.tags[("n", 2)] == {"place": "island"}
    assert c.tags[("n", 3)] == {"place": "city", "name": "Thành phố Hồ Chí Minh", "name:zh": "胡志明市"}
    assert c.tags[("w", 10)] == {"natural": "coastline"}
    assert "patched objects: 3" in r.stdout
```

Run (trong image, bind-mount thư mục pipelines):
`docker run --rm -v "$PWD/pipelines:/app/pipelines" mapslibvn/pipeline:local pytest -q /app/pipelines/tiles/python`
Expected: FAIL — `patch_sovereignty.py` không tồn tại.

- [x] **Step 4: Viết `patch_sovereignty.py`**

```python
#!/usr/bin/env python3
"""Patch dữ liệu OSM trong hai bbox Hoàng Sa / Trường Sa trước khi build tiles (spec 4.3 tầng 1).

- Có name:vi  → name := name:vi
- Không có name:vi → xoá name (không hiển thị tên nước ngoài)
- Luôn xoá name:zh, name:zh-Hans, name:zh-Hant, name:en trong bbox
Áp dụng cho node trong bbox, way có node trong bbox, relation có member là node/way đó.
"""
import argparse
import osmium

BBOXES = [
    ("Hoàng Sa", 111.0, 15.7, 113.0, 17.2),
    ("Trường Sa", 111.5, 6.5, 117.8, 12.0),
]
DROP_KEYS = {"name:zh", "name:zh-Hans", "name:zh-Hant", "name:en"}


def in_bboxes(lon, lat):
    return any(w <= lon <= e and s <= lat <= n for (_, w, s, e, n) in BBOXES)


def patched_tags(tags):
    """Trả về dict tag mới, hoặc None nếu không có gì để đổi."""
    t = {tag.k: tag.v for tag in tags}
    if "name" not in t and not (DROP_KEYS & t.keys()):
        return None
    if "name:vi" in t:
        t["name"] = t["name:vi"]
    else:
        t.pop("name", None)
    for k in DROP_KEYS:
        t.pop(k, None)
    return t


class Collector(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.nodes, self.ways = set(), set()

    def node(self, n):
        if n.location.valid() and in_bboxes(n.location.lon, n.location.lat):
            self.nodes.add(n.id)

    def way(self, w):
        if any(nd.ref in self.nodes for nd in w.nodes):
            self.ways.add(w.id)


class Patcher(osmium.SimpleHandler):
    def __init__(self, writer, nodes, ways):
        super().__init__()
        self.w, self.nodes, self.ways, self.changed = writer, nodes, ways, 0

    def _emit(self, obj, add, hit):
        if hit:
            new = patched_tags(obj.tags)
            if new is not None:
                self.changed += 1
                add(obj.replace(tags=new))
                return
        add(obj)

    def node(self, n):
        self._emit(n, self.w.add_node, n.id in self.nodes)

    def way(self, w):
        self._emit(w, self.w.add_way, w.id in self.ways)

    def relation(self, r):
        hit = any((m.type == "n" and m.ref in self.nodes) or (m.type == "w" and m.ref in self.ways) for m in r.members)
        self._emit(r, self.w.add_relation, hit)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("src")
    ap.add_argument("dst")
    a = ap.parse_args()
    c = Collector()
    c.apply_file(a.src)
    writer = osmium.SimpleWriter(a.dst)
    try:
        p = Patcher(writer, c.nodes, c.ways)
        p.apply_file(a.src)
    finally:
        writer.close()
    print(f"patched objects: {p.changed}; nodes in bbox: {len(c.nodes)}; ways in bbox: {len(c.ways)}")


if __name__ == "__main__":
    main()
```

Run: `docker run --rm -v "$PWD/pipelines:/app/pipelines" mapslibvn/pipeline:local pytest -q /app/pipelines/tiles/python`
Expected: `1 passed`.

Nếu pyosmium báo `replace()` không nhận `tags=dict`: đổi thành `tags=[(k, v) for k, v in new.items()]` — ghi DEVLOG.

- [x] **Step 5: Cập nhật Dockerfile + `.dockerignore` để image có deps pipeline và style**

Sửa `.dockerignore` (copy toàn repo trừ thứ nặng/bí mật — pnpm cần mọi `package.json` của workspace để kiểm lockfile):
```
node_modules
**/node_modules
.git
.turbo
**/dist
**/.astro
work
out
.env
.wrangler
packages/style/assets/fonts
pipelines/tiles/fixtures
```

Sửa `pipelines/Dockerfile` stage `app` (cài deps chỉ cho root + pipelines + style; apps/web không cài):
```dockerfile
FROM tools AS app
WORKDIR /app
ENV MAPSLIBVN_IN_CONTAINER=1 MAPSLIBVN_WORK=/app/work MAPSLIBVN_OUT=/app/out
COPY . .
RUN pnpm install --frozen-lockfile --filter . --filter "./pipelines/*" --filter "@mapslibvn/style" \
    && node packages/style/scripts/build.mjs
CMD ["node", "--version"]
```

Run: `pnpm image:build && docker run --rm mapslibvn/pipeline:local sh -c "ls packages/style/dist && cd pipelines/tiles && node -e \"import('pmtiles').then(()=>console.log('pmtiles ok'))\""`
Expected: 2 file template + `sovereignty.geojson`, `pmtiles ok`.

- [x] **Step 6: Chạy download thật (một lần, ~350 MB + Natural Earth)**

Run: `docker compose --env-file .env -f infra/dev/compose.yml --profile pipeline run --rm pipeline node pipelines/tiles/src/download.mjs`
Expected: log tải của Planetiler, rồi `✓ /app/work/data/sources/vietnam.osm.pbf md5 …` (5–15 phút tuỳ mạng). Dữ liệu nằm trong volume `mapslibvn-dev_pipeline-work`, không tải lại ở lần sau.

Run: `docker compose --env-file .env -f infra/dev/compose.yml --profile pipeline run --rm pipeline python pipelines/tiles/python/patch_sovereignty.py /app/work/data/sources/vietnam.osm.pbf /app/work/vietnam-patched.osm.pbf`
Expected: `patched objects: N; nodes in bbox: …; ways in bbox: …` với N > 0 (vài chục đến vài trăm), ~5–10 phút.

Kết quả thực tế 2026-08-27: download hoàn tất trong 4 phút 4 giây; PBF 327 MB
khớp MD5 `620d0258ffecd450363e24560d0a7b8b`. Patch đổi 108 object, với
10.351 node và 486 way nằm trong hai bbox.

- [x] **Step 7: Lint, DEVLOG, commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: xanh.

Sửa `docs/DEVLOG.md`: "Task đang làm: M1b Task 4"; mục 4 dòng T3 kèm số `patched objects`.

```bash
git add -A
git commit -m "feat(pipeline-tiles): download Geofabrik + patch chủ quyền bằng pyosmium (có test)"
git push
```

---

### Task 4: Build Planetiler và fixture Quận 1

**Files:**
- Create: `pipelines/tiles/src/build.mjs`, `pipelines/tiles/src/make-fixture.mjs`, `pipelines/tiles/src/inspect.mjs`, `pipelines/tiles/src/lib/node-source.mjs`, `pipelines/tiles/fixtures/q1.pmtiles`

- [x] **Step 1: `node-source.mjs` và `inspect.mjs`**

`pipelines/tiles/src/lib/node-source.mjs`:
```js
import { open } from 'node:fs/promises';
import { PMTiles } from 'pmtiles';

/** Nguồn PMTiles đọc từ file cục bộ (range-read qua FileHandle). */
export class NodeFileSource {
  /** @param {import('node:fs/promises').FileHandle} fh @param {string} key */
  constructor(fh, key) {
    this.fh = fh;
    this.key = key;
  }
  getKey() {
    return this.key;
  }
  /** @param {number} offset @param {number} length */
  async getBytes(offset, length) {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await this.fh.read(buf, 0, length, offset);
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + bytesRead) };
  }
}

/** @param {string} path */
export async function openPmtiles(path) {
  const fh = await open(path, 'r');
  return { pmtiles: new PMTiles(new NodeFileSource(fh, path)), close: () => fh.close() };
}
```

`pipelines/tiles/src/inspect.mjs`:
```js
#!/usr/bin/env node
import { openPmtiles } from './lib/node-source.mjs';

const path = process.argv[2];
if (!path) throw new Error('Dùng: node inspect.mjs <file.pmtiles>');
const { pmtiles, close } = await openPmtiles(path);
const h = await pmtiles.getHeader();
const meta = await pmtiles.getMetadata();
console.log(JSON.stringify({
  zoom: [h.minZoom, h.maxZoom],
  bounds: [h.minLon, h.minLat, h.maxLon, h.maxLat],
  tiles: h.numTileEntries,
  layers: (meta.vector_layers ?? []).map((l) => l.id),
}, null, 2));
await close();
```

- [x] **Step 2: `build.mjs`**

```js
#!/usr/bin/env node
// Build tiles VN bằng Planetiler (spec 4.2). Dùng: node build.mjs [--release vn-YYYYMMDD]
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from '../../../scripts/lib/run.mjs';
import { releaseName } from './lib/dates.mjs';
import { OUT, PATCHED_PBF, WORK } from './lib/env.mjs';

const argv = process.argv.slice(2);
const i = argv.indexOf('--release');
const release = i >= 0 ? argv[i + 1] : releaseName('vn');
if (!existsSync(PATCHED_PBF)) throw new Error(`Thiếu ${PATCHED_PBF} — chạy download.mjs và patch_sovereignty.py trước`);
mkdirSync(OUT, { recursive: true });
const output = resolve(OUT, `${release}.pmtiles`);

run('planetiler', [
  `--osm-path=${PATCHED_PBF}`,
  '--download', '--area=vietnam',
  '--bounds=-180,-85.0511,180,85.0511',
  '--languages=vi,en',
  '--maxzoom=14',
  '--nodemap-type=sparsearray', '--storage=mmap',
  '--force',
  `--output=${output}`,
], { cwd: WORK, env: { ...process.env, JAVA_OPTS: process.env.JAVA_OPTS ?? '-Xmx4g' } });

console.log(`✓ ${output}`);
```

- [x] **Step 3: `make-fixture.mjs`**

```js
#!/usr/bin/env node
// Tạo fixture PMTiles nhỏ (Quận 1 cũ, TP.HCM) cho test và E2E. Chạy trong image.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from '../../../scripts/lib/run.mjs';
import { OSM_PBF, WORK } from './lib/env.mjs';

const BBOX = '106.68,10.76,106.72,10.80';
const extract = resolve(WORK, 'q1.osm.pbf');
const outDir = resolve('pipelines/tiles/fixtures');
mkdirSync(outDir, { recursive: true });

run('osmium', ['extract', '-b', BBOX, OSM_PBF, '-o', extract, '--overwrite']);
run('planetiler', [
  `--osm-path=${extract}`, '--download', '--area=vietnam',
  `--bounds=${BBOX}`, '--languages=vi,en', '--maxzoom=14', '--force',
  `--output=${resolve(outDir, 'q1.pmtiles')}`,
], { cwd: WORK, env: { ...process.env, JAVA_OPTS: '-Xmx2g' } });
console.log('✓ pipelines/tiles/fixtures/q1.pmtiles');
```

Run:
```bash
docker run --rm --env-file .env -v mapslibvn-dev_pipeline-work:/app/work \
  -v "$PWD/pipelines/tiles/fixtures:/app/pipelines/tiles/fixtures" mapslibvn/pipeline:local \
  node pipelines/tiles/src/make-fixture.mjs
```
Expected: `✓ pipelines/tiles/fixtures/q1.pmtiles` (1–3 phút).

Run: `ls -la pipelines/tiles/fixtures/q1.pmtiles && node pipelines/tiles/src/inspect.mjs pipelines/tiles/fixtures/q1.pmtiles`
Expected: kích cỡ ≤ 15 MB; JSON có `zoom: [0, 14]`, `layers` gồm `water`, `transportation`, `place`, `poi`… Nếu > 15 MB, thu bbox còn `106.69,10.77,106.71,10.79` và chạy lại.

Kết quả thật 27/08/2026: fixture 1,0 MB, 25 tile, zoom `[0, 14]`, đủ các
layer chính (`water`, `transportation`, `place`, `poi`...).

- [x] **Step 4: Build thật lần đầu (20–40 phút)**

Run: `docker compose --env-file .env -f infra/dev/compose.yml --profile pipeline run --rm pipeline node pipelines/tiles/src/build.mjs`
Expected: Planetiler chạy hết, `✓ /app/out/vn-YYYYMMDD.pmtiles`.

Run: `docker compose --env-file .env -f infra/dev/compose.yml --profile pipeline run --rm pipeline sh -c "ls -la /app/out && node pipelines/tiles/src/inspect.mjs /app/out/vn-*.pmtiles"`
Expected: file ~0,7–1,5 GB; `bounds` ≈ `[-180, -85, 180, 85]`, `zoom [0, 14]`.

Kết quả thật 27/08/2026: bật `--compress-temp` vì lần chạy đầu làm Docker
volume tăng 7,9 GB và đẩy host xuống còn 131 MiB. Lần chạy lại hoàn tất trong
3 phút 24 giây; file 952 MiB (Planetiler báo archive 997 MB), zoom `[0, 14]`,
bounds `[-180, -85.0511, 180, 85.0511]`, 6.291.183 tile entry và đủ 16 layer.

Quyết định spec 4.2 (lớp thế giới z0–6): xem nhanh bằng `pmtiles` sau khi có Worker (M1c). Nếu ngoài VN chỉ có biển, ghi DEVLOG "dùng dự phòng Protomaps extract" và tạo task bổ sung ở M1c.

- [x] **Step 5: Lint, DEVLOG, commit (kèm fixture)**

Run: `pnpm lint && pnpm typecheck && pnpm test`

Sửa `docs/DEVLOG.md`: "Task đang làm: M1b Task 5"; mục 4 dòng T4 kèm kích cỡ file build và thời gian.

```bash
git add -A
git commit -m "feat(pipeline-tiles): build Planetiler theo spec 4.2 + fixture Quận 1"
git push
```

---

### Task 5: QA chủ quyền và cấu trúc tiles

**Files:**
- Create: `pipelines/tiles/qa.config.json`, `pipelines/tiles/src/lib/qa-rules.mjs`, `pipelines/tiles/src/lib/qa-rules.test.mjs`, `pipelines/tiles/src/qa.mjs`

- [x] **Step 1: Cấu hình QA**

`pipelines/tiles/qa.config.json`:
```json
{
  "bboxes": [
    { "name": "Hoàng Sa", "bbox": [111.0, 15.7, 113.0, 17.2] },
    { "name": "Trường Sa", "bbox": [111.5, 6.5, 117.8, 12.0] }
  ],
  "fullScanZooms": [4, 10],
  "pointScanZooms": [11, 14],
  "islandPoints": [
    [112.336, 16.834], [111.2, 15.78], [111.61, 16.53], [112.27, 16.98], [112.73, 16.67],
    [114.33, 11.43], [111.92, 8.64], [114.32, 9.88], [114.37, 10.18], [114.48, 10.37],
    [112.92, 7.87], [114.36, 10.38], [114.28, 11.05]
  ],
  "forbiddenWords": ["Paracel", "Spratly", "Xisha", "Nansha", "Huangyan", "Zhongsha"],
  "islandClasses": ["island", "islet", "archipelago"]
}
```

- [x] **Step 2: Test luật QA (thất bại)**

`pipelines/tiles/src/lib/qa-rules.test.mjs`:
```js
import { describe, expect, it } from 'vitest';
import { hasIslandFeature, lonLatToTile, nameViolations, tileRange } from './qa-rules.mjs';

const words = ['Paracel', 'Spratly', 'Xisha'];

describe('nameViolations', () => {
  it('bắt CJK và từ cấm trong mọi thuộc tính name*', () => {
    expect(nameViolations({ name: '西沙群岛' }, words)).toEqual(['name=西沙群岛']);
    expect(nameViolations({ 'name:en': 'Paracel Islands', class: 'island' }, words)).toEqual(['name:en=Paracel Islands']);
  });
  it('bỏ qua tên tiếng Việt và thuộc tính không phải name', () => {
    expect(nameViolations({ name: 'Quần đảo Hoàng Sa', ref: 'Xisha' }, words)).toEqual([]);
  });
});

describe('lonLatToTile / tileRange', () => {
  it('toạ độ HCM ở z10 → tile (815, 483)', () => {
    expect(lonLatToTile(106.7, 10.77, 10)).toEqual({ x: 815, y: 483 });
  });
  it('bbox Hoàng Sa ở z4 nằm trong 1 tile', () => {
    const r = tileRange([111.0, 15.7, 113.0, 17.2], 4);
    expect(r).toEqual({ xMin: 12, xMax: 13, yMin: 7, yMax: 7 });
  });
});

describe('hasIslandFeature', () => {
  it('true khi place có class island và có name', () => {
    expect(hasIslandFeature([{ layer: 'place', props: { class: 'island', name: 'Đảo Phú Lâm' } }], ['island'])).toBe(true);
  });
  it('false khi không có name hoặc sai lớp', () => {
    expect(hasIslandFeature([{ layer: 'place', props: { class: 'island' } }], ['island'])).toBe(false);
    expect(hasIslandFeature([{ layer: 'water', props: { class: 'island', name: 'x' } }], ['island'])).toBe(false);
  });
});
```

Run: `pnpm test`
Expected: FAIL — không tìm thấy `./qa-rules.mjs`.

- [x] **Step 3: Viết `qa-rules.mjs`**

```js
const CJK = /[㐀-鿿぀-ヿ가-힯]/;

/**
 * @param {Record<string, unknown>} props @param {string[]} forbiddenWords
 * @returns {string[]} danh sách "key=value" vi phạm
 */
export function nameViolations(props, forbiddenWords) {
  const bad = new RegExp(forbiddenWords.join('|'), 'i');
  const out = [];
  for (const [k, v] of Object.entries(props)) {
    if (!k.startsWith('name')) continue;
    const s = String(v);
    if (CJK.test(s) || bad.test(s)) out.push(`${k}=${s}`);
  }
  return out;
}

/** @param {number} lon @param {number} lat @param {number} z */
export function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) };
}

/** @param {[number, number, number, number]} bbox [w,s,e,n] @param {number} z */
export function tileRange(bbox, z) {
  const a = lonLatToTile(bbox[0], bbox[3], z); // góc tây-bắc
  const b = lonLatToTile(bbox[2], bbox[1], z); // góc đông-nam
  return { xMin: a.x, xMax: b.x, yMin: a.y, yMax: b.y };
}

/**
 * @param {{ layer: string, props: Record<string, unknown> }[]} features
 * @param {string[]} islandClasses
 */
export function hasIslandFeature(features, islandClasses) {
  return features.some(
    (f) => f.layer === 'place' && islandClasses.includes(String(f.props.class)) && typeof f.props.name === 'string' && f.props.name.length > 0,
  );
}
```

Run: `pnpm test`
Expected: xanh.

- [x] **Step 4: Viết `qa.mjs`**

```js
#!/usr/bin/env node
// QA tiles (spec 4.3 tầng 3). Dùng: node qa.mjs <file.pmtiles> [--skip-islands]
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { openPmtiles } from './lib/node-source.mjs';
import { hasIslandFeature, lonLatToTile, nameViolations, tileRange } from './lib/qa-rules.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(resolve(here, '../qa.config.json'), 'utf8'));
const [file, ...flags] = process.argv.slice(2);
if (!file) throw new Error('Dùng: node qa.mjs <file.pmtiles> [--skip-islands]');
const skipIslands = flags.includes('--skip-islands');

const { pmtiles, close } = await openPmtiles(file);
const violations = [];
let decoded = 0;

/** @param {number} z @param {number} x @param {number} y */
async function features(z, x, y) {
  const t = await pmtiles.getZxy(z, x, y);
  if (!t?.data) return [];
  decoded++;
  const vt = new VectorTile(new Pbf(new Uint8Array(t.data)));
  const out = [];
  for (const [layer, l] of Object.entries(vt.layers)) {
    for (let i = 0; i < l.length; i++) out.push({ layer, props: l.feature(i).properties });
  }
  return out;
}

for (const { name, bbox } of cfg.bboxes) {
  const [zFrom, zTo] = cfg.fullScanZooms;
  let islandSeen = false;
  const check = async (z, x, y) => {
    const fs = await features(z, x, y);
    for (const f of fs) for (const v of nameViolations(f.props, cfg.forbiddenWords)) violations.push(`${name} z${z}/${x}/${y} ${f.layer}: ${v}`);
    if (z >= 8 && z <= 10 && hasIslandFeature(fs, cfg.islandClasses)) islandSeen = true;
  };
  for (let z = zFrom; z <= zTo; z++) {
    const r = tileRange(bbox, z);
    for (let x = r.xMin; x <= r.xMax; x++) for (let y = r.yMin; y <= r.yMax; y++) await check(z, x, y);
  }
  const [pFrom, pTo] = cfg.pointScanZooms;
  for (const [lon, lat] of cfg.islandPoints) {
    if (lon < bbox[0] || lon > bbox[2] || lat < bbox[1] || lat > bbox[3]) continue;
    for (let z = pFrom; z <= pTo; z++) {
      const { x, y } = lonLatToTile(lon, lat, z);
      await check(z, x, y);
    }
  }
  if (!skipIslands && !islandSeen) violations.push(`${name}: không thấy đảo có tên tiếng Việt trong lớp place ở z8–10`);
}
await close();

// Kiểm style template có lớp chủ quyền
for (const theme of ['light', 'dark']) {
  const tpl = JSON.parse(readFileSync(resolve(here, `../../../packages/style/dist/mapslibvn-${theme}.template.json`), 'utf8'));
  const sov = tpl.layers.find((l) => l.id === 'sovereignty-label');
  if (!sov || sov.minzoom !== 4) violations.push(`style ${theme}: thiếu lớp sovereignty-label minzoom 4`);
  if (tpl.sources?.sovereignty?.data?.features?.length !== 2) violations.push(`style ${theme}: nguồn sovereignty phải có 2 nhãn`);
}

console.log(`QA: giải mã ${decoded} tile`);
if (violations.length) {
  console.error(`QA THẤT BẠI — ${violations.length} vi phạm:`);
  for (const v of violations) console.error(' -', v);
  process.exit(1);
}
console.log('✓ QA chủ quyền và style đạt');
```

- [x] **Step 5: Chạy QA trên fixture và trên bản build thật**

Run: `pnpm --filter @mapslibvn/style build && node pipelines/tiles/src/qa.mjs pipelines/tiles/fixtures/q1.pmtiles --skip-islands`
Expected: `QA: giải mã N tile` (N có thể là 0 vì fixture không phủ bbox) rồi `✓ QA chủ quyền và style đạt`.

Run (bản thật, trong container để đọc `/app/out`): `docker compose --env-file .env -f infra/dev/compose.yml --profile pipeline run --rm pipeline sh -c "node pipelines/tiles/src/qa.mjs /app/out/vn-*.pmtiles"`
Expected: `✓ QA chủ quyền và style đạt`. Nếu báo thiếu đảo có tên: kiểm tra OSM có `name:vi` cho đảo trong bbox (Overpass dev) — nếu dữ liệu thực sự thiếu, thêm nhãn vào `sovereignty.geojson` và ghi DEVLOG; nếu báo vi phạm tên: sửa patch (Task 3) và build lại.

- [x] **Step 6: Lint, DEVLOG, commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`

Sửa `docs/DEVLOG.md`: "Task đang làm: M1b Task 6"; mục 4 dòng T5 kèm kết quả QA thật.

```bash
git add -A
git commit -m "feat(pipeline-tiles): QA chủ quyền (CJK/từ cấm, đảo có tên VI, style có lớp sovereignty)"
git push
```

---

### Task 6: Upload R2, manifest KV, `pnpm data:update --tiles`, `pnpm data:rollback`

**Files:**
- Create: `pipelines/tiles/src/upload.mjs`, `pipelines/tiles/src/smoke.mjs`, `pipelines/tiles/src/manifest.mjs`, `scripts/lib/update-plan.mjs`, `scripts/lib/update-plan.test.mjs`, `scripts/data-update.mjs`, `scripts/data-rollback.mjs`
- Modify: `package.json` (thêm `wrangler`, script `data:update`, `data:rollback`), `.env.example` (thêm `CLOUDFLARE_API_TOKEN`)

- [x] **Step 1: Việc tay của PHONG trên Cloudflare (làm trước)**

> Hoàn tất 27/08/2026: bucket `mapslibvn-tiles` (APAC), custom domain
> `tiles.ai-solutions.io.vn` (SSL active), CORS, KV `mapslibvn-META`, Cache Rule
> và hai token đã tạo/kiểm tra. Secret chỉ lưu trong `.env` bị ignore.

1. R2 → Create bucket `mapslibvn-tiles` (location hint: Asia-Pacific). Settings → Custom Domains → thêm `tiles.<domain>` (zone hiện có). CORS policy:
```json
[{ "AllowedOrigins": ["*"], "AllowedMethods": ["GET", "HEAD"], "AllowedHeaders": ["Range", "If-Match", "If-None-Match"], "ExposeHeaders": ["ETag", "Content-Length", "Content-Range"], "MaxAgeSeconds": 86400 }]
```
2. R2 → Manage R2 API Tokens → token quyền Object Read & Write cho bucket này → lấy Access Key ID, Secret, endpoint `https://<account_id>.r2.cloudflarestorage.com`.
3. Workers & Pages → KV → Create namespace `mapslibvn-META` → copy ID.
4. My Profile → API Tokens → tạo token "Edit Cloudflare Workers" template (đủ quyền KV + Workers) → copy.
5. Điền vào `.env`: `TILES_BASE=https://tiles.<domain>`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `KV_NAMESPACE_ID_META`, `RCLONE_CONFIG_R2_ACCESS_KEY_ID`, `RCLONE_CONFIG_R2_SECRET_ACCESS_KEY`, `RCLONE_CONFIG_R2_ENDPOINT`.
6. Cache Rule cho hostname `tiles.<domain>`: Cache eligibility "Eligible for cache", Edge TTL 1 năm, Browser TTL 1 ngày.

Thêm vào `.env.example` dưới `KV_NAMESPACE_ID_META=`:
```
CLOUDFLARE_API_TOKEN=
```

- [x] **Step 2: Test kế hoạch cập nhật (thất bại)**

`scripts/lib/update-plan.test.mjs`:
```js
import { describe, expect, it } from 'vitest';
import { decideWork, nextState } from './update-plan.mjs';

const state = { osm: { lastModified: 'Mon, 18 Aug 2026 20:00:00 GMT', md5: 'aaa' }, releases: { vn: 'vn-20260819', poi: null } };
const same = { osm: { lastModified: 'Mon, 18 Aug 2026 20:00:00 GMT', md5: 'aaa' } };
const newer = { osm: { lastModified: 'Mon, 25 Aug 2026 20:00:00 GMT', md5: 'bbb' } };

describe('decideWork', () => {
  it('không có gì mới → không làm gì', () => {
    expect(decideWork(state, same, {})).toEqual({ tiles: false, poi: false, reasons: [] });
  });
  it('OSM mới → tiles và poi', () => {
    expect(decideWork(state, newer, {})).toEqual({ tiles: true, poi: true, reasons: ['OSM đổi (md5 aaa → bbb)'] });
  });
  it('--force → làm tất cả kể cả khi không mới', () => {
    expect(decideWork(state, same, { force: true }).tiles).toBe(true);
  });
  it('--tiles chỉ giữ tiles', () => {
    expect(decideWork(state, newer, { onlyTiles: true })).toEqual({ tiles: true, poi: false, reasons: ['OSM đổi (md5 aaa → bbb)'] });
  });
  it('state rỗng (lần đầu) → làm tất cả', () => {
    expect(decideWork({}, same, {}).tiles).toBe(true);
  });
});

describe('nextState', () => {
  it('ghi phiên bản nguồn và tên release mới, giữ poi cũ', () => {
    expect(nextState(state, newer, { vn: 'vn-20260826' })).toEqual({
      osm: newer.osm,
      releases: { vn: 'vn-20260826', poi: null },
    });
  });
});
```

Run: `pnpm test`
Expected: FAIL — không tìm thấy `./update-plan.mjs`.

- [x] **Step 3: Viết `update-plan.mjs`**

```js
/**
 * @typedef {{ osm?: { lastModified: string, md5: string }, releases?: { vn: string | null, poi: string | null } }} State
 * @typedef {{ osm: { lastModified: string, md5: string } }} Versions
 * @typedef {{ force?: boolean, onlyTiles?: boolean, onlyPoi?: boolean }} Flags
 */

/** @param {State} state @param {Versions} versions @param {Flags} flags */
export function decideWork(state, versions, flags) {
  const reasons = [];
  const osmChanged = !state.osm || state.osm.md5 !== versions.osm.md5;
  if (osmChanged) reasons.push(`OSM đổi (md5 ${state.osm?.md5 ?? '∅'} → ${versions.osm.md5})`);
  if (flags.force) reasons.push('--force');
  let tiles = osmChanged || Boolean(flags.force);
  let poi = osmChanged || Boolean(flags.force); // Overture/FSQ thêm ở M2
  if (flags.onlyTiles) poi = false;
  if (flags.onlyPoi) tiles = false;
  return { tiles, poi, reasons };
}

/** @param {State} state @param {Versions} versions @param {{ vn?: string, poi?: string }} built */
export function nextState(state, versions, built) {
  return {
    osm: versions.osm,
    releases: { vn: built.vn ?? state.releases?.vn ?? null, poi: built.poi ?? state.releases?.poi ?? null },
  };
}
```

Run: `pnpm test`
Expected: xanh.

- [x] **Step 4: `upload.mjs`, `smoke.mjs`, `manifest.mjs`**

`pipelines/tiles/src/upload.mjs`:
```js
#!/usr/bin/env node
// Dùng: node upload.mjs <release>  — đẩy out/<release>.pmtiles và assets (fonts/sprites) lên R2
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from '../../../scripts/lib/run.mjs';
import { OUT, requireEnv } from './lib/env.mjs';

const release = process.argv[2];
if (!release) throw new Error('Dùng: node upload.mjs <release>');
const bucket = requireEnv('R2_BUCKET');
requireEnv('RCLONE_CONFIG_R2_ACCESS_KEY_ID');
const file = resolve(OUT, `${release}.pmtiles`);
if (!existsSync(file)) throw new Error(`Không thấy ${file}`);

run('rclone', ['copyto', file, `r2:${bucket}/tiles/${release}.pmtiles`, '--s3-chunk-size', '64M', '--s3-upload-concurrency', '8', '--progress']);
const assets = resolve('packages/style/assets');
if (!existsSync(resolve(assets, 'fonts/Noto Sans Regular/0-255.pbf'))) run('node', ['packages/style/scripts/vendor.mjs', 'fonts']);
run('rclone', ['copy', assets, `r2:${bucket}/assets`, '--checksum', '--header-upload', 'Cache-Control: public, max-age=31536000, immutable']);
console.log(`✓ upload ${release} + assets`);
```

`pipelines/tiles/src/smoke.mjs`:
```js
#!/usr/bin/env node
// Dùng: node smoke.mjs <release> — đọc 20 tile qua HTTP từ TILES_BASE (đúng đường client sẽ đi)
import { FetchSource, PMTiles } from 'pmtiles';
import { lonLatToTile } from './lib/qa-rules.mjs';
import { requireEnv } from './lib/env.mjs';

const release = process.argv[2];
const url = `${requireEnv('TILES_BASE')}/tiles/${release}.pmtiles`;
const p = new PMTiles(new FetchSource(url));
const h = await p.getHeader();
if (h.maxZoom !== 14) throw new Error(`maxZoom lạ: ${h.maxZoom}`);
const centers = [[106.7, 10.77], [105.85, 21.03], [108.2, 16.05], [106.35, 9.99], [109.19, 12.24]];
let ok = 0;
for (const [lon, lat] of centers) {
  for (const z of [10, 12, 13, 14]) {
    const { x, y } = lonLatToTile(lon, lat, z);
    const t = await p.getZxy(z, x, y);
    if (!t?.data?.byteLength) throw new Error(`tile trống z${z}/${x}/${y} tại ${lon},${lat}`);
    ok++;
  }
}
console.log(`✓ smoke ${ok} tile từ ${url}`);
```

`pipelines/tiles/src/manifest.mjs`:
```js
#!/usr/bin/env node
// Dùng: node manifest.mjs set --vn <release> | node manifest.mjs get | node manifest.mjs rollback
import { execFileSync } from 'node:child_process';
import { requireEnv } from './lib/env.mjs';

const ns = requireEnv('KV_NAMESPACE_ID_META');
requireEnv('CLOUDFLARE_API_TOKEN');
const kv = (args, input) =>
  execFileSync('pnpm', ['exec', 'wrangler', 'kv', 'key', ...args, `--namespace-id=${ns}`, '--remote'], { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'inherit'] }).trim();
const get = (key) => { try { return JSON.parse(kv(['get', key])); } catch { return null; } };
const put = (key, value) => kv(['put', key, JSON.stringify(value)]);

const [cmd, ...rest] = process.argv.slice(2);
const current = get('release:current') ?? { vn: null, poi: null };
const history = get('release:history') ?? [];

if (cmd === 'get') {
  console.log(JSON.stringify({ current, history }, null, 2));
} else if (cmd === 'set') {
  const i = rest.indexOf('--vn'); const j = rest.indexOf('--poi');
  const next = { vn: i >= 0 ? rest[i + 1] : current.vn, poi: j >= 0 ? rest[j + 1] : current.poi, updatedAt: new Date().toISOString() };
  put('release:history', [current, ...history].slice(0, 3));
  put('release:current', next);
  console.log('✓ manifest', JSON.stringify(next));
} else if (cmd === 'rollback') {
  const [prev, ...older] = history;
  if (!prev) throw new Error('Không có bản trước để rollback');
  put('release:current', { ...prev, updatedAt: new Date().toISOString() });
  put('release:history', older);
  console.log('✓ rollback về', JSON.stringify(prev));
} else {
  throw new Error('Dùng: manifest.mjs get | set --vn <release> [--poi <release>] | rollback');
}
```

Thêm `wrangler` vào root `package.json` devDependencies: `"wrangler": "^4.0.0"`, và scripts:
```json
"data:update": "node scripts/data-update.mjs",
"data:rollback": "node scripts/data-rollback.mjs"
```
Run: `pnpm install`.

- [x] **Step 5: `scripts/data-update.mjs` và `scripts/data-rollback.mjs`**

`scripts/data-update.mjs`:
```js
#!/usr/bin/env node
// Một lệnh cập nhật dữ liệu (spec 5.9). Ngoài container: tự chạy lại chính nó trong image pipeline.
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { releaseName } from '../pipelines/tiles/src/lib/dates.mjs';
import { decideWork, nextState } from './lib/update-plan.mjs';
import { capture, run } from './lib/run.mjs';

const argv = process.argv.slice(2);
const flags = { force: argv.includes('--force'), onlyTiles: argv.includes('--tiles'), onlyPoi: argv.includes('--poi'), dryRun: argv.includes('--dry-run') };
const compose = ['compose', '--env-file', '.env', '-f', 'infra/dev/compose.yml', '--profile', 'pipeline'];

if (process.env.MAPSLIBVN_IN_CONTAINER !== '1') {
  run('docker', [...compose, 'build', 'pipeline']);
  run('docker', [...compose, 'run', '--rm', 'pipeline', 'node', 'scripts/data-update.mjs', ...argv]);
  process.exit(0);
}

const bucket = process.env.R2_BUCKET ?? 'mapslibvn-tiles';
const stateKey = `r2:${bucket}/state/releases.json`;
const readState = () => { try { return JSON.parse(capture('rclone', ['cat', stateKey]) || '{}'); } catch { return {}; } };
const writeState = (s) => execFileSync('rclone', ['rcat', stateKey], { input: JSON.stringify(s, null, 2) });

const head = await fetch('https://download.geofabrik.de/asia/vietnam-latest.osm.pbf', { method: 'HEAD' });
const md5 = (await (await fetch('https://download.geofabrik.de/asia/vietnam-latest.osm.pbf.md5')).text()).split(/\s+/)[0];
const versions = { osm: { lastModified: head.headers.get('last-modified') ?? '', md5 } };
const state = readState();
const work = decideWork(state, versions, flags);
console.log('Kế hoạch:', JSON.stringify(work));
if (flags.dryRun || (!work.tiles && !work.poi)) { console.log(flags.dryRun ? '(dry-run) dừng.' : 'Không có gì mới. Dừng.'); process.exit(0); }

const built = {};
if (work.tiles) {
  run('node', ['pipelines/tiles/src/download.mjs']);
  run('python', ['pipelines/tiles/python/patch_sovereignty.py', '/app/work/data/sources/vietnam.osm.pbf', '/app/work/vietnam-patched.osm.pbf']);
  const release = releaseName('vn');
  run('node', ['pipelines/tiles/src/build.mjs', '--release', release]);
  run('node', ['pipelines/tiles/src/qa.mjs', `/app/out/${release}.pmtiles`]);
  run('node', ['pipelines/tiles/src/upload.mjs', release]);
  run('node', ['pipelines/tiles/src/smoke.mjs', release]);
  run('node', ['pipelines/tiles/src/manifest.mjs', 'set', '--vn', release]);
  built.vn = release;
}
if (work.poi) console.log('POI: chưa có pipeline ở M1 — bỏ qua (thêm ở M2).');
writeState(nextState(state, versions, built));
console.log('✓ data:update xong', JSON.stringify(built));
```

`scripts/data-rollback.mjs`:
```js
#!/usr/bin/env node
import 'dotenv/config';
import { run } from './lib/run.mjs';
run('node', ['pipelines/tiles/src/manifest.mjs', 'rollback']);
```

- [x] **Step 6: Chạy dry-run rồi chạy thật**

Run: `pnpm data:update --dry-run`
Expected: image build (cache), rồi `Kế hoạch: {"tiles":true,"poi":true,"reasons":["OSM đổi (md5 ∅ → …)"]}` và `(dry-run) dừng.`

Run: `pnpm data:update --tiles`
Expected (60–90 phút lần đầu): download (bỏ qua nếu md5 khớp) → patch → build → `✓ QA` → rclone progress → `✓ smoke 20 tile từ https://tiles.<domain>/tiles/vn-YYYYMMDD.pmtiles` → `✓ manifest {"vn":"vn-YYYYMMDD",…}` → `✓ data:update xong`.

Run: `pnpm data:update --dry-run`
Expected: `Kế hoạch: {"tiles":false,"poi":false,"reasons":[]}` — idempotent.

Run: `node pipelines/tiles/src/manifest.mjs get` (cần `.env` đã nạp: `set -a; . ./.env; set +a` trước, hoặc `pnpm exec dotenv -- node …`)
Expected: `current.vn = "vn-YYYYMMDD"`.

- [x] **Step 7: Lint, DEVLOG, commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`

Sửa `docs/DEVLOG.md`: mục 1 "Môi trường đã dựng: … R2 bucket + custom domain tiles.<domain>, KV META, bản tiles vn-YYYYMMDD đã lên R2"; "Mốc: M1c — Worker, Web SDK, docs"; "Plan: 2026-08-26-m1c-worker-web-sdk-docs.md"; "Task đang làm: Task 1". Mục 4 dòng T6 kèm thời gian chạy thật.

```bash
git add -A
git commit -m "feat(data): pnpm data:update --tiles — dò Geofabrik, build, QA, upload R2, manifest KV, rollback"
git push
```
