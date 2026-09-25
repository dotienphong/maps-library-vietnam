# SEO và AI search cho website và tài liệu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Website `mapslibvn.pages.dev` và tài liệu `mapslibvn-docs.pages.dev` được công cụ tìm kiếm lẫn AI đọc đúng, hiểu là một thương hiệu, và được báo ngay khi trang đổi — theo spec `docs/superpowers/specs/2026-09-25-seo-ai-search-design.md`.

**Architecture:** Mọi tệp cho bot sinh lúc build từ dữ liệu đã có (`TRANG`, catalog giá, frontmatter, git), có test khoá. Chính sách bot nằm một chỗ ở `@mapslibvn/catalog`. Docs chèn OG/JSON-LD qua route middleware của Starlight, `llms*.txt` qua plugin `starlight-llms-txt`. IndexNow là một script Node chạy trong CI quanh bước `wrangler pages deploy`. Không thêm runtime nào.

**Tech Stack:** Astro 7.3, Starlight 0.42, `@astrojs/sitemap` 3.7, `starlight-llms-txt` 0.12, vitest 5 (chạy ở gốc repo), Playwright, Node 22 (`fetch`, `AbortSignal.timeout`), Biome 2.5, GitHub Actions.

**Nhánh:** làm trên `seo-ai-search` (đã có commit spec `c552ac9`). Không push, không merge khi PHONG chưa đồng ý (Task 18).

**Khoá IndexNow dùng trong plan:** `c1da44e6cf8707383215e23e4fc36e9e` — sinh ngày 25/09/2026, công khai theo thiết kế của IndexNow (spec mục 7).

---

## Bản đồ tệp

| Tệp | Tạo/Sửa | Trách nhiệm |
|---|---|---|
| `packages/catalog/src/bot.ts` (+ test) | Tạo | `CONTENT_SIGNAL`, `robotsTxt(siteUrl)` — chính sách bot duy nhất |
| `packages/catalog/src/lien-ket.ts`, `index.ts` | Sửa | `SITE_URL`, `API_BASE`, `DOCS_LLMS`, `DOCS.api` |
| `apps/site/site.config.mjs` | Sửa | `SAME_AS`, `GOOGLE_SITE_VERIFICATION` |
| `apps/site/src/lib/robots.ts` (+ test) | Sửa | gọi `robotsTxt(SITE_URL)` |
| `apps/site/src/lib/seo.ts` (+ test) | Sửa | `@id`, logo, `WebSite`, tham chiếu `@id`, kích thước ảnh OG |
| `apps/site/src/components/SeoHead.astro` | Sửa | `robots max-image-preview`, `og:image:*`, thẻ xác thực |
| `apps/site/src/pages/index.astro` | Sửa | thêm `websiteJsonLd()` |
| `apps/site/src/lib/llms.ts` (+ test), `src/pages/llms.txt.ts` | Tạo | `/llms.txt` của site |
| `apps/site/src/lib/lastmod.mjs` (+ test), `astro.config.mjs` | Tạo/Sửa | `lastmod` cho bài viết |
| `apps/site/e2e/seo.spec.ts` | Sửa | e2e robots, llms, lastmod, logo |
| `scripts/site-images.mjs` | Sửa | thêm ảnh OG docs, logo 512, cờ `--og=<tên>`, `--logo` |
| `apps/docs/docs.config.mjs` (+ `src/lib/docs-config.test.ts`) | Tạo | hằng cho `astro.config.mjs` |
| `apps/docs/scripts/ngay-git.mjs` (+ test) | Tạo | ngày commit đầu/cuối của một tệp |
| `apps/docs/scripts/copy-legal.mjs` (+ test) | Sửa | title/description mới, `lastUpdated`, không chạy khi bị import |
| `apps/docs/src/content/docs/*.md(x)` | Sửa | title/description theo spec 6.1 |
| `apps/docs/src/content.config.ts` | Sửa | ép description 120–160 |
| `apps/docs/src/lib/seo-docs.ts` (+ test), `src/route-data.ts` | Tạo | OG, JSON-LD, noindex cho mọi trang Starlight |
| `apps/docs/scripts/lastmod.mjs` (+ test) | Tạo | URL → tệp nguồn → `lastmod` |
| `apps/docs/src/pages/robots.txt.ts` | Tạo | robots của docs |
| `apps/docs/src/components/Footer.astro` | Tạo | hàng link về site |
| `apps/docs/public/playground.html`, `src/pages/react-demo.astro` | Sửa | meta playground; noindex react-demo |
| `apps/docs/astro.config.mjs` | Sửa | delimiter, middleware, sitemap, lastUpdated, Footer, llms plugin, thẻ xác thực |
| `apps/docs/playwright.seo.config.ts`, `e2e/seo.spec.ts` | Tạo | e2e SEO docs không cần API |
| `scripts/indexnow.mjs` (+ test) | Tạo | IndexNow `truoc`/`gui` |
| `apps/{site,docs}/public/c1da44e6cf8707383215e23e4fc36e9e.txt` | Tạo | tệp khoá IndexNow |
| `.github/workflows/deploy-site.yml`, `deploy-docs.yml`, `package.json`, `Pnpm_Scripts_Guide.md` | Sửa | gắn IndexNow, `fetch-depth: 0`, paths; mô tả lệnh deploy |
| `packages/{core,web,react,react-native}/package.json`, `README.md` | Sửa | `homepage`, `keywords`, mô tả, dòng link |
| `scripts/lib/package-release.test.mjs` | Sửa | khoá metadata npm |
| `README.md`, `docs/DEVLOG.md`, `docs/evidence/seo-ai/2026-09-25-seo-ai-search.md` | Sửa/Tạo | tài liệu vận hành, nhật ký, chứng cứ |

Lệnh dùng xuyên suốt (chạy từ gốc repo `/Users/dtphong/Desktop/software_business/mapsLibVN`):

- Test một tệp: `pnpm exec vitest run <đường dẫn>`
- Định dạng + lint tệp vừa sửa: `pnpm exec biome check --write <tệp…>`
- Typecheck script gốc: `pnpm exec tsc -p tsconfig.scripts.json`
- Build docs lần đầu (cần SDK đã build): `pnpm --filter @mapslibvn/core build && pnpm --filter @mapslibvn/web build && pnpm --filter @mapslibvn/react build && pnpm --filter @mapslibvn/docs build`

---

### Task 1: Chính sách bot và hằng đường dẫn trong `@mapslibvn/catalog`

**Files:**
- Create: `packages/catalog/src/bot.ts`, `packages/catalog/src/bot.test.ts`
- Modify: `packages/catalog/src/lien-ket.ts`, `packages/catalog/src/index.ts`, `apps/site/src/lib/robots.ts`, `apps/site/src/lib/robots.test.ts`, `apps/site/src/lib/lien-ket-docs.test.ts`

- [x] **Step 1: Viết test đỏ cho `robotsTxt`**

`packages/catalog/src/bot.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CONTENT_SIGNAL, robotsTxt } from './bot';

describe('robotsTxt', () => {
  it('cho mọi bot, khai Content-Signal và trỏ sitemap tuyệt đối — đúng từng dòng', () => {
    expect(robotsTxt('https://mapslibvn.pages.dev')).toBe(
      [
        'User-agent: *',
        'Content-Signal: search=yes, ai-input=yes, ai-train=yes',
        'Allow: /',
        '',
        'Sitemap: https://mapslibvn.pages.dev/sitemap-index.xml',
        '',
      ].join('\n'),
    );
  });

  it('PHONG chốt 25/09/2026: cho cả tìm kiếm, trả lời AI lẫn huấn luyện', () => {
    expect(CONTENT_SIGNAL).toBe('search=yes, ai-input=yes, ai-train=yes');
  });

  it('không nhân đôi gạch chéo khi gốc lỡ có gạch cuối', () => {
    expect(robotsTxt('https://mapslibvn-docs.pages.dev/')).toContain(
      'Sitemap: https://mapslibvn-docs.pages.dev/sitemap-index.xml',
    );
  });

  it('không chặn đường dẫn nào', () => {
    expect(robotsTxt('https://mapslibvn.pages.dev')).not.toContain('Disallow');
  });
});
```

- [x] **Step 2: Chạy, thấy đỏ**

Run: `pnpm exec vitest run packages/catalog/src/bot.test.ts`
Expected: FAIL — `Failed to resolve import "./bot"`.

- [x] **Step 3: Viết `bot.ts`**

`packages/catalog/src/bot.ts`:

```ts
/**
 * Chính sách bot dùng chung cho website và tài liệu — một chỗ duy nhất để hai trang không bao giờ
 * lệch nhau (spec SEO-AI 25/09/2026 mục 4).
 *
 * `Content-Signal` là đề xuất của Cloudflare, chưa phải chuẩn: bot không hiểu dòng này sẽ bỏ qua
 * theo RFC 9309, nên khai thêm không hại ai. PHONG chốt 25/09/2026 cho cả ba mục đích, kể cả huấn
 * luyện: model biết SDK thì viết đúng code `@mapslibvn` cho khách.
 */
export const CONTENT_SIGNAL = 'search=yes, ai-input=yes, ai-train=yes';

/** Nội dung `robots.txt` của một site. `siteUrl` là gốc tuyệt đối, có hay không gạch cuối đều được. */
export function robotsTxt(siteUrl: string): string {
  const goc = siteUrl.replace(/\/+$/, '');
  return [
    'User-agent: *',
    `Content-Signal: ${CONTENT_SIGNAL}`,
    'Allow: /',
    '',
    `Sitemap: ${goc}/sitemap-index.xml`,
    '',
  ].join('\n');
}
```

- [x] **Step 4: Thêm hằng vào `lien-ket.ts`**

Trong `packages/catalog/src/lien-ket.ts`, ngay sau dòng `export const DOCS_URL = 'https://mapslibvn-docs.pages.dev';` thêm:

```ts

/** Gốc website quảng bá. `apps/site/site.config.mjs` và `apps/docs/docs.config.mjs` giữ bản sao cho
 *  `astro.config.mjs`; bài kiểm của từng app khẳng định các bản khớp nhau. */
export const SITE_URL = 'https://mapslibvn.pages.dev';

/** Gốc API công khai. */
export const API_BASE = 'https://api.ai-solutions.io.vn';

/** Mục lục tài liệu cho LLM do plugin starlight-llms-txt sinh. Cố ý KHÔNG nằm trong `DOCS`: đây
 *  là một tệp nên không có gạch cuối, còn bài kiểm của `DOCS` đòi gạch cuối cho mọi URL. */
export const DOCS_LLMS = `${DOCS_URL}/llms.txt`;
```

và trong object `DOCS` thêm một dòng sau `timKiem`:

```ts
  api: `${DOCS_URL}/api/`,
```

- [x] **Step 5: Export từ `index.ts`**

Trong `packages/catalog/src/index.ts`: thêm dòng đầu tiên

```ts
export { CONTENT_SIGNAL, robotsTxt } from './bot';
```

và thay dòng `export { DOCS, DOCS_URL } from './lien-ket';` bằng:

```ts
export { API_BASE, DOCS, DOCS_LLMS, DOCS_URL, SITE_URL } from './lien-ket';
```

- [x] **Step 6: Chạy test catalog, thấy xanh**

Run: `pnpm exec vitest run packages/catalog/src/bot.test.ts`
Expected: PASS 4/4.

- [x] **Step 7: Viết test đỏ cho robots của site và cho hằng `SITE_URL`**

Trong `apps/site/src/lib/robots.test.ts`, thêm vào trong `describe('robots.txt', …)`:

```ts
  it('khai Content-Signal cho bot AI: tìm kiếm, trả lời và huấn luyện đều được', () => {
    expect(noiDungRobots()).toContain('Content-Signal: search=yes, ai-input=yes, ai-train=yes');
  });
```

Trong `apps/site/src/lib/lien-ket-docs.test.ts`, đổi hai dòng import thành:

```ts
import { DOCS, DOCS_URL, SITE_URL } from '@mapslibvn/catalog';
import { describe, expect, it } from 'vitest';
import { DOCS_URL as DOCS_URL_SITE, SITE_URL as SITE_URL_SITE } from '../../site.config.mjs';
```

và thêm vào cuối `describe('địa chỉ tài liệu', …)`:

```ts
  it('website và gói dùng chung ghi CÙNG một gốc website', () => {
    expect(SITE_URL_SITE).toBe(SITE_URL);
  });
```

Run: `pnpm exec vitest run apps/site/src/lib/robots.test.ts apps/site/src/lib/lien-ket-docs.test.ts`
Expected: FAIL đúng một bài — "khai Content-Signal…". Bài `SITE_URL` xanh ngay (hai giá trị đã khớp).

- [x] **Step 8: Cho `robots.ts` gọi catalog**

Thay toàn bộ `apps/site/src/lib/robots.ts`:

```ts
import { robotsTxt } from '@mapslibvn/catalog';
import { SITE_URL } from '../../site.config.mjs';

/**
 * Website không có khu vực riêng tư nào: `/console` và `/admin` nằm ở tên miền khác và đã được
 * Cloudflare Access che, nên ở đây không cần Disallow. Nội dung — kể cả `Content-Signal` cho bot AI
 * — nằm ở `@mapslibvn/catalog` để website và tài liệu không bao giờ lệch chính sách.
 */
export function noiDungRobots(): string {
  return robotsTxt(SITE_URL);
}
```

- [x] **Step 9: Chạy lại, thấy xanh; lint**

Run: `pnpm exec vitest run packages/catalog apps/site/src/lib/robots.test.ts apps/site/src/lib/lien-ket-docs.test.ts`
Expected: PASS toàn bộ.

Run: `pnpm exec biome check --write packages/catalog/src apps/site/src/lib/robots.ts apps/site/src/lib/robots.test.ts apps/site/src/lib/lien-ket-docs.test.ts`
Expected: không còn lỗi.

- [x] **Step 10: Commit**

```bash
git add packages/catalog/src apps/site/src/lib/robots.ts apps/site/src/lib/robots.test.ts apps/site/src/lib/lien-ket-docs.test.ts
git commit -m "feat(catalog): chính sách bot dùng chung — robots có Content-Signal cho cả site và docs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Ảnh OG của docs và logo vuông 512×512

**Files:**
- Modify: `scripts/site-images.mjs`
- Create (sinh ra): `apps/docs/public/og/tai-lieu-v1.png`, `apps/site/public/logo-512.png`

- [x] **Step 1: Cho mỗi ảnh OG khai được đích riêng**

Trong `scripts/site-images.mjs`:

1. Sau dòng `const THU_MUC_OG = resolve(GOC, 'apps/site/public/og');` thêm:

```js
const THU_MUC_OG_DOCS = resolve(GOC, 'apps/docs/public/og');
const FAVICON = resolve(GOC, 'apps/site/public/favicon.svg');
const LOGO = resolve(GOC, 'apps/site/public/logo-512.png');
```

2. Trong khối typedef JSDoc, đổi dòng `@typedef {{ path: string, type?: 'png' | 'jpeg', quality?: number }} TuyChonChup` thành:

```js
 * @typedef {{ path: string, type?: 'png' | 'jpeg', quality?: number, omitBackground?: boolean }} TuyChonChup
```

và thêm một dòng typedef mới ngay trước `*/` của khối đó:

```js
 * @typedef {{ ten: string, tieuDe: string, phu: string, tep?: string }} AnhOg
```

3. Thay khối `const ANH_OG = [ … ];` (cùng chú thích ngay trên nó) bằng:

```js
/**
 * Ảnh OG. Ảnh của site: `ten` + `-v3` phải KHỚP trường `og` trong apps/site/src/lib/trang.ts. Ảnh
 * có `tep` thì ghi thẳng vào đó — ảnh của tài liệu đọc từ apps/docs/src/lib/seo-docs.ts.
 * @type {AnhOg[]}
 */
const ANH_OG = [
  { ten: 'mac-dinh', tieuDe: 'MapsLibVN', phu: 'API bản đồ và địa điểm Việt Nam' },
  {
    ten: 'trang-chu',
    tieuDe: 'Bản đồ Việt Nam cho ứng dụng của bạn',
    phu: 'Dữ liệu mở · Bốn SDK · Thanh toán bằng VND',
  },
  {
    ten: 'bang-gia',
    tieuDe: 'Giá theo lượt gọi, không theo đầu người',
    phu: 'Dùng thử miễn phí 30 ngày · Gói từ 650.000đ mỗi tháng',
  },
  {
    ten: 'so-sanh',
    tieuDe: 'So sánh chi phí API bản đồ',
    phu: 'MapsLibVN · Google · VIETMAP — kèm giả định và nguồn',
  },
  {
    ten: 'tai-lieu',
    tieuDe: 'Tài liệu MapsLibVN',
    phu: 'API bản đồ Việt Nam · Web, React, React Native',
    tep: resolve(THU_MUC_OG_DOCS, 'tai-lieu-v1.png'),
  },
];
```

4. Thay hàm `sinhAnhOg` bằng bản nhận bộ lọc tên:

```js
/**
 * @param {Chromium} chromium
 * @param {string | undefined} chi chỉ sinh ảnh có `ten` này; undefined = sinh tất cả
 */
async function sinhAnhOg(chromium, chi) {
  const fontBase64 = await Promise.all(
    FONT_NET.flatMap((net) =>
      FONT_DAI.map(async (dai) => ({
        net,
        b64: (
          await readFile(resolve(THU_MUC_FONT, `be-vietnam-pro-${dai}-${net}-normal.woff2`))
        ).toString('base64'),
      })),
    ),
  );
  const danhSach = ANH_OG.filter((anh) => chi === undefined || anh.ten === chi);
  if (danhSach.length === 0) throw new Error(`Không có ảnh OG tên "${chi}"`);
  const trinhDuyet = await chromium.launch();
  try {
    const trang = await trinhDuyet.newPage({ viewport: { width: 1200, height: 630 } });
    for (const anh of danhSach) {
      await trang.setContent(trangOg(anh, fontBase64), { waitUntil: 'load' });
      // Chờ font nạp xong, nếu không chữ có dấu bị vẽ bằng font dự phòng rồi mới đổi.
      await trang.evaluate(() => document.fonts.ready);
      // Tên có hậu tố phiên bản: mạng xã hội cache ảnh OG theo URL, giữ tên cũ thì bản cũ còn
      // sống trong bộ nhớ đệm của Facebook/Zalo rất lâu sau khi đã đổi.
      const duong = anh.tep ?? resolve(THU_MUC_OG, `${anh.ten}-v3.png`);
      await mkdir(dirname(duong), { recursive: true });
      await trang.screenshot({ path: duong });
      const { size } = await stat(duong);
      console.log(`  ${duong.slice(GOC.length + 1)} — ${Math.round(size / 1024)} KB`);
    }
  } finally {
    await trinhDuyet.close();
  }
}

/**
 * Logo vuông cho `Organization.logo` trong JSON-LD: vẽ lại favicon.svg ở 512×512, nền trong suốt.
 * Google cắt logo về khung vuông, nên ảnh OG 1200×630 không dùng làm logo được.
 * @param {Chromium} chromium
 */
async function sinhLogo(chromium) {
  const svg = (await readFile(FAVICON)).toString('base64');
  const trinhDuyet = await chromium.launch();
  try {
    const trang = await trinhDuyet.newPage({ viewport: { width: 512, height: 512 } });
    await trang.setContent(
      `<html><body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${svg}" width="512" height="512" style="display:block" /></body></html>`,
      { waitUntil: 'load' },
    );
    await trang.screenshot({ path: LOGO, omitBackground: true });
    const { size } = await stat(LOGO);
    console.log(`  apps/site/public/logo-512.png — ${Math.round(size / 1024)} KB`);
  } finally {
    await trinhDuyet.close();
  }
}
```

5. Trong `main(argv)`, thay hai dòng `const chiOg = …` / `const chiHero = …` bằng:

```js
  // --og: mọi ảnh OG · --og=<tên>: một ảnh OG · --logo: chỉ logo · --hero: chỉ ảnh hero.
  // Không cờ nào: làm hết. Cờ --og=<tên> để thêm ảnh mới mà không vẽ lại (và làm đổi byte) ảnh cũ.
  const ogMot = argv.find((thamSo) => thamSo.startsWith('--og='))?.slice('--og='.length);
  const chiOg = argv.includes('--og') || ogMot !== undefined;
  const chiHero = argv.includes('--hero');
  const chiLogo = argv.includes('--logo');
  const tatCa = !chiOg && !chiHero && !chiLogo;
```

và thay đoạn từ `if (!chiHero) {` tới hết khối `if (!chiOg) { … }` bằng:

```js
  if (tatCa || chiOg) {
    console.log('Sinh ảnh OG…');
    await sinhAnhOg(chromium, ogMot);
  }

  if (tatCa || chiLogo) {
    console.log('Sinh logo…');
    await sinhLogo(chromium);
  }

  if (tatCa || chiHero) {
    console.log('Chụp bản đồ cho hero…');
    try {
      await chupHero(chromium);
    } catch (loi) {
      // KHÔNG chặn: website dựng được mà không có ảnh hero, lúc đó hero hiện nền màu.
      // Chặn ở đây nghĩa là mất mạng thì không build được website, đổi lấy một tấm ảnh.
      console.warn(`  BỎ QUA ảnh hero: ${loi instanceof Error ? loi.message : loi}`);
      console.warn('  Website vẫn dựng được; khối bản đồ sẽ hiện nền màu thay vì ảnh.');
    }
  }
```

6. Sửa hai dòng chú thích đầu tệp cho khớp:

```js
// Sinh ảnh cho website và tài liệu: ảnh nền hero (chụp playground thật), ảnh OG 1200×630 và logo
// vuông 512×512.
//   node scripts/site-images.mjs              — làm hết
//   node scripts/site-images.mjs --og         — mọi ảnh OG (không cần mạng ngoài)
//   node scripts/site-images.mjs --og=<tên>   — một ảnh OG, ví dụ --og=tai-lieu
//   node scripts/site-images.mjs --logo       — chỉ logo
//   node scripts/site-images.mjs --hero       — chỉ ảnh hero
```

(Giữ nguyên dòng `// Ảnh được COMMIT vào repo: …`.) Bản `sinhAnhOg` mới không còn `mkdir(THU_MUC_OG)` ở đầu hàm: `mkdir(dirname(duong))` trong vòng lặp tạo đúng thư mục của từng ảnh, kể cả `apps/docs/public/og`.

- [x] **Step 2: Typecheck script**

Run: `pnpm exec tsc -p tsconfig.scripts.json`
Expected: không lỗi.

- [x] **Step 3: Sinh hai ảnh mới — không vẽ lại ảnh cũ**

Run: `node scripts/site-images.mjs --og=tai-lieu && node scripts/site-images.mjs --logo`
Expected: in `apps/docs/public/og/tai-lieu-v1.png — … KB` và `apps/site/public/logo-512.png — … KB`.

Run: `file apps/docs/public/og/tai-lieu-v1.png apps/site/public/logo-512.png && git status --short apps/site/public/og`
Expected: `PNG image data, 1200 x 630` và `PNG image data, 512 x 512, 8-bit/color RGBA`; `git status` KHÔNG liệt kê ảnh OG cũ nào của site.

Mở hai ảnh bằng Read tool để nhìn: chữ tiếng Việt đủ dấu, logo tròn nền trong suốt.

- [x] **Step 4: Lint và commit**

Run: `pnpm exec biome check --write scripts/site-images.mjs`

```bash
git add scripts/site-images.mjs apps/docs/public/og/tai-lieu-v1.png apps/site/public/logo-512.png
git commit -m "feat(site,docs): ảnh OG cho tài liệu và logo vuông 512×512 sinh từ favicon

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: JSON-LD một thực thể và thẻ meta trên website

**Files:**
- Modify: `apps/site/site.config.mjs`, `apps/site/src/lib/seo.ts`, `apps/site/src/lib/seo.test.ts`, `apps/site/src/components/SeoHead.astro`, `apps/site/src/pages/index.astro`

- [x] **Step 1: Thêm hằng vào `site.config.mjs`**

Cuối `apps/site/site.config.mjs` thêm:

```js
/**
 * Hồ sơ chính thức của MapsLibVN ở nơi khác, cho `sameAs` của Organization. Thêm trang Facebook,
 * LinkedIn… khi lập. KHÔNG thêm repo GitHub: PHONG không công bố hướng dẫn tự host (23/09/2026).
 */
export const SAME_AS = ['https://www.npmjs.com/org/mapslibvn'];
/**
 * Mã xác thực Google Search Console (phương thức thẻ HTML) cho property URL prefix
 * https://mapslibvn.pages.dev/. Rỗng thì không in thẻ. Mã nằm công khai trong HTML nên commit được.
 */
export const GOOGLE_SITE_VERIFICATION = '';
```

- [x] **Step 2: Viết test đỏ**

Trong `apps/site/src/lib/seo.test.ts`:

1. Đổi khối import `./seo` thành:

```ts
import {
  articleJsonLd,
  breadcrumbJsonLd,
  canonicalUrl,
  faqJsonLd,
  LOGO,
  ORG_ID,
  organizationJsonLd,
  SOFTWARE_ID,
  seoMeta,
  softwareApplicationJsonLd,
  WEBSITE_ID,
  websiteJsonLd,
} from './seo';
```

2. Trong `describe('seoMeta', …)` thêm:

```ts
  it('ảnh OG khai kích thước và alt để Zalo/Facebook vẽ thẻ ngay lần đầu', () => {
    const meta = seoMeta(TRANG.bangGia);
    expect(meta.og.imageWidth).toBe(1200);
    expect(meta.og.imageHeight).toBe(630);
    expect(meta.og.imageAlt).toBe(TRANG.bangGia.title);
  });
```

3. Trong `describe('JSON-LD', …)` thêm:

```ts
  it('Organization có @id cố định, logo vuông và sameAs không dẫn về repo', () => {
    const ld = organizationJsonLd();
    expect(ld['@id']).toBe('https://mapslibvn.pages.dev/#organization');
    expect(ORG_ID).toBe(ld['@id']);
    expect(ld.logo).toEqual({
      '@type': 'ImageObject',
      url: 'https://mapslibvn.pages.dev/logo-512.png',
      width: 512,
      height: 512,
    });
    expect(LOGO.width).toBe(LOGO.height);
    expect(ld.sameAs).toContain('https://www.npmjs.com/org/mapslibvn');
    expect(JSON.stringify(ld.sameAs)).not.toContain('github.com');
  });

  it('WebSite tham chiếu tổ chức bằng @id', () => {
    const ld = websiteJsonLd();
    expect(ld['@type']).toBe('WebSite');
    expect(ld['@id']).toBe(WEBSITE_ID);
    expect(ld.url).toBe('https://mapslibvn.pages.dev/');
    expect(ld.inLanguage).toBe('vi');
    expect(ld.publisher).toEqual({ '@id': ORG_ID });
  });

  it('SoftwareApplication có @id, mô tả trang chủ, publisher và link tài liệu', () => {
    const ld = softwareApplicationJsonLd();
    expect(ld['@id']).toBe(SOFTWARE_ID);
    expect(ld.description).toBe(TRANG.trangChu.description);
    expect(ld.publisher).toEqual({ '@id': ORG_ID });
    expect(ld.softwareHelp).toEqual({
      '@type': 'CreativeWork',
      url: 'https://mapslibvn-docs.pages.dev/',
    });
  });

  it('Article tham chiếu tổ chức bằng @id, có ảnh và ngôn ngữ', () => {
    const ld = articleJsonLd({
      title: 'T',
      description: 'D',
      path: '/bai-viet/x/',
      publishedAt: '2026-09-18',
    });
    expect(ld.author).toEqual({ '@id': ORG_ID });
    expect(ld.publisher).toEqual({ '@id': ORG_ID });
    expect(ld.image).toBe('https://mapslibvn.pages.dev/og/mac-dinh-v3.png');
    expect(ld.inLanguage).toBe('vi');
  });
```

4. Trong bài `mọi khối JSON-LD serialize được và có @context`, đổi mảng thành:

```ts
    for (const ld of [
      organizationJsonLd(),
      websiteJsonLd(),
      softwareApplicationJsonLd(),
      faqJsonLd([]),
      articleJsonLd({ title: 'T', description: 'D', path: '/x/', publishedAt: '2026-09-18' }),
    ]) {
```

- [x] **Step 3: Chạy, thấy đỏ**

Run: `pnpm exec vitest run apps/site/src/lib/seo.test.ts`
Expected: FAIL — `LOGO`, `ORG_ID`, `websiteJsonLd`… không được export.

- [x] **Step 4: Viết lại `seo.ts`**

Thay toàn bộ `apps/site/src/lib/seo.ts`:

```ts
import { PAID_TIERS, PLAN_CATALOG } from '@mapslibvn/catalog';
import {
  BRAND,
  DOCS_URL,
  SAME_AS,
  SITE_URL,
  SUPPORT_EMAIL,
  SUPPORT_PHONE,
} from '../../site.config.mjs';
import { TRANG, type TrangMeta } from './trang';

const OG_MAC_DINH = '/og/mac-dinh-v3.png';
/** Mọi ảnh OG do scripts/site-images.mjs sinh đều 1200×630. */
const OG_RONG = 1200;
const OG_CAO = 630;

/**
 * `@id` cố định của các thực thể trong JSON-LD. Tài liệu (`apps/docs/src/lib/seo-docs.ts`) dùng
 * lại ĐÚNG `ORG_ID`, nên máy hiểu website và tài liệu — hai tên miền — là cùng một chủ.
 */
export const ORG_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;
export const SOFTWARE_ID = `${SITE_URL}/#software`;

/** Logo vuông sinh từ favicon.svg (`node scripts/site-images.mjs --logo`). Không dùng ảnh OG
 *  1200×630: Google cắt logo về khung vuông. */
export const LOGO = { url: `${SITE_URL}/logo-512.png`, width: 512, height: 512 } as const;

/** URL tuyệt đối, luôn có dấu gạch cuối. Hai URL cho cùng một trang là tự chia điểm SEO. */
export function canonicalUrl(path: string): string {
  const sach = path.startsWith('/') ? path : `/${path}`;
  const duoi = sach.endsWith('/') ? sach : `${sach}/`;
  return `${SITE_URL}${duoi}`;
}

export interface SeoTuyChon {
  type?: 'website' | 'article';
  publishedAt?: string;
}

export function seoMeta(trang: TrangMeta, tuyChon: SeoTuyChon = {}) {
  const canonical = canonicalUrl(trang.path);
  const image = `${SITE_URL}${trang.og ?? OG_MAC_DINH}`;
  return {
    title: trang.title,
    description: trang.description,
    canonical,
    og: {
      title: trang.title,
      description: trang.description,
      url: canonical,
      image,
      imageWidth: OG_RONG,
      imageHeight: OG_CAO,
      imageAlt: trang.title,
      type: tuyChon.type ?? 'website',
      locale: 'vi_VN',
      siteName: BRAND,
      ...(tuyChon.publishedAt ? { publishedTime: tuyChon.publishedAt } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: trang.title,
      description: trang.description,
      image,
    },
  };
}

export function organizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': ORG_ID,
    name: BRAND,
    url: canonicalUrl('/'),
    logo: { '@type': 'ImageObject', ...LOGO },
    description: 'Nền tảng bản đồ và địa điểm Việt Nam dựng trên dữ liệu mở.',
    sameAs: [...SAME_AS],
    contactPoint: {
      '@type': 'ContactPoint',
      email: SUPPORT_EMAIL,
      telephone: SUPPORT_PHONE,
      contactType: 'customer support',
      availableLanguage: ['vi', 'en'],
    },
  } as const;
}

/** Chỉ đặt ở trang chủ. Không có `SearchAction`: website không có ô tìm kiếm. */
export function websiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': WEBSITE_ID,
    name: BRAND,
    url: canonicalUrl('/'),
    inLanguage: 'vi',
    publisher: { '@id': ORG_ID },
  } as const;
}

const TEN_GOI: Record<string, string> = {
  trial: 'Bản dùng thử',
  starter: 'Starter',
  professional: 'Professional',
  business: 'Business',
};

export function softwareApplicationJsonLd() {
  const offers = (['trial', ...PAID_TIERS] as const).map((tier) => ({
    '@type': 'Offer' as const,
    name: `${BRAND} ${TEN_GOI[tier]}`,
    price: String(PLAN_CATALOG[tier].priceVnd),
    priceCurrency: 'VND',
    url: canonicalUrl('/bang-gia/'),
  }));
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    '@id': SOFTWARE_ID,
    name: BRAND,
    description: TRANG.trangChu.description,
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Web, iOS, Android',
    url: canonicalUrl('/'),
    publisher: { '@id': ORG_ID },
    softwareHelp: { '@type': 'CreativeWork', url: `${DOCS_URL}/` },
    offers,
  } as const;
}

export function faqJsonLd(items: readonly { hoi: string; dap: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question' as const,
      name: item.hoi,
      acceptedAnswer: { '@type': 'Answer' as const, text: item.dap },
    })),
  } as const;
}

export function articleJsonLd(input: {
  title: string;
  description: string;
  path: string;
  publishedAt: string;
  updatedAt?: string;
  /** URL tuyệt đối ảnh của bài; thiếu thì ảnh OG mặc định của site. */
  image?: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: input.title,
    description: input.description,
    mainEntityOfPage: canonicalUrl(input.path),
    image: input.image ?? `${SITE_URL}${OG_MAC_DINH}`,
    inLanguage: 'vi',
    datePublished: input.publishedAt,
    dateModified: input.updatedAt ?? input.publishedAt,
    author: { '@id': ORG_ID },
    publisher: { '@id': ORG_ID },
  } as const;
}

export function breadcrumbJsonLd(items: readonly { ten: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem' as const,
      position: index + 1,
      name: item.ten,
      item: canonicalUrl(item.path),
    })),
  } as const;
}
```

- [x] **Step 5: Chạy, thấy xanh**

Run: `pnpm exec vitest run apps/site/src/lib/seo.test.ts apps/site/src/lib/trang.test.ts`
Expected: PASS toàn bộ (bài Organization cũ vẫn xanh: `contactPoint` giữ nguyên).

- [x] **Step 6: Thẻ meta trong `SeoHead.astro`**

Trong `apps/site/src/components/SeoHead.astro`:

1. Thêm import (sau hai dòng import font):

```ts
import { GOOGLE_SITE_VERIFICATION } from '../../site.config.mjs';
```

2. Thay hai dòng

```astro
<meta name="description" content={meta.description} />
<link rel="canonical" href={meta.canonical} />
```

bằng:

```astro
<meta name="description" content={meta.description} />
{/* Cho Google hiện ảnh xem trước cỡ lớn (Discover, kết quả có ảnh); mặc định chỉ là cỡ chuẩn. */}
<meta name="robots" content="max-image-preview:large" />
<link rel="canonical" href={meta.canonical} />
{
  GOOGLE_SITE_VERIFICATION && (
    <meta name="google-site-verification" content={GOOGLE_SITE_VERIFICATION} />
  )
}
```

3. Ngay sau dòng `<meta property="og:image" content={meta.og.image} />` thêm:

```astro
<meta property="og:image:width" content={String(meta.og.imageWidth)} />
<meta property="og:image:height" content={String(meta.og.imageHeight)} />
<meta property="og:image:alt" content={meta.og.imageAlt} />
```

- [x] **Step 7: Trang chủ mang `WebSite`**

Trong `apps/site/src/pages/index.astro`: đổi `import { faqJsonLd, softwareApplicationJsonLd } from '../lib/seo';` thành

```ts
import { faqJsonLd, softwareApplicationJsonLd, websiteJsonLd } from '../lib/seo';
```

và dòng `<Base trang={TRANG.trangChu} jsonLd={[softwareApplicationJsonLd(), faqJsonLd(CAU_HOI)]}>` thành

```astro
<Base
  trang={TRANG.trangChu}
  jsonLd={[websiteJsonLd(), softwareApplicationJsonLd(), faqJsonLd(CAU_HOI)]}
>
```

- [x] **Step 8: Build và nhìn HTML thật**

Run: `pnpm --filter @mapslibvn/site typecheck && pnpm --filter @mapslibvn/site build`
Expected: `astro check` 0 lỗi; build xong.

Run: `grep -o '<meta name="robots"[^>]*>\|<meta property="og:image:[a-z]*"[^>]*>' apps/site/dist/index.html; grep -c '"@type":"WebSite"' apps/site/dist/index.html; grep -c 'google-site-verification' apps/site/dist/index.html`
Expected: đủ thẻ `robots` + ba thẻ `og:image:*`; `1`; `0` (hằng xác thực đang rỗng).

- [x] **Step 9: Lint và commit**

Run: `pnpm exec biome check --write apps/site/site.config.mjs apps/site/src/lib/seo.ts apps/site/src/lib/seo.test.ts apps/site/src/components/SeoHead.astro apps/site/src/pages/index.astro`

```bash
git add apps/site/site.config.mjs apps/site/src/lib/seo.ts apps/site/src/lib/seo.test.ts apps/site/src/components/SeoHead.astro apps/site/src/pages/index.astro
git commit -m "feat(site): JSON-LD một thực thể — @id, logo vuông, WebSite, sameAs; kích thước ảnh OG

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `/llms.txt` của website

**Files:**
- Create: `apps/site/src/lib/llms.ts`, `apps/site/src/lib/llms.test.ts`, `apps/site/src/pages/llms.txt.ts`

- [x] **Step 1: Viết test đỏ**

`apps/site/src/lib/llms.test.ts`:

```ts
import { DOCS, DOCS_LLMS, PLAN_CATALOG } from '@mapslibvn/catalog';
import { describe, expect, it } from 'vitest';
import { CONSOLE_URL, SUPPORT_EMAIL } from '../../site.config.mjs';
import { dinhDangSo, dinhDangVnd } from './gia';
import { noiDungLlms } from './llms';
import { canonicalUrl } from './seo';
import { TRANG } from './trang';

const BAI = [
  { slug: 'bai-cu', title: 'Bài cũ', description: 'Mô tả bài cũ', publishedAt: '2026-09-01' },
  { slug: 'bai-moi', title: 'Bài mới', description: 'Mô tả bài mới', publishedAt: '2026-09-20' },
];

describe('noiDungLlms', () => {
  const txt = noiDungLlms(BAI);

  it('mở đầu đúng khuôn llmstxt.org: H1 rồi blockquote là nguyên văn mô tả trang chủ', () => {
    const [dau, trong, tomTat] = txt.split('\n');
    expect(dau).toBe('# MapsLibVN');
    expect(trong).toBe('');
    expect(tomTat).toBe(`> ${TRANG.trangChu.description}`);
  });

  it('liệt kê mọi trang chính kèm mô tả, trừ trang chủ và 404', () => {
    for (const trang of Object.values(TRANG)) {
      if (trang.path === TRANG.trangChu.path || trang.path === TRANG.khong404.path) continue;
      expect(txt).toContain(`- [${trang.h1}](${canonicalUrl(trang.path)}): ${trang.description}`);
    }
    expect(txt).not.toContain(canonicalUrl(TRANG.khong404.path));
  });

  it('giá và hạn mức từng gói lấy thẳng từ catalog', () => {
    for (const tier of ['starter', 'professional', 'business'] as const) {
      const goi = PLAN_CATALOG[tier];
      expect(txt).toContain(
        `${dinhDangVnd(goi.priceVnd)} mỗi tháng, ${dinhDangSo(goi.places)} lượt Places, ${dinhDangSo(goi.directions)} lượt tính tuyến`,
      );
    }
    expect(txt).toContain(
      `Dùng thử: miễn phí 30 ngày, ${dinhDangSo(PLAN_CATALOG.trial.places)} lượt Places`,
    );
  });

  it('bài viết mới nhất đứng trước, link tuyệt đối có gạch cuối', () => {
    expect(txt.indexOf('[Bài mới]')).toBeLessThan(txt.indexOf('[Bài cũ]'));
    expect(txt).toContain(`- [Bài mới](${canonicalUrl('/bai-viet/bai-moi/')}): Mô tả bài mới`);
  });

  it('không có bài nào thì bỏ hẳn mục Bài viết', () => {
    expect(noiDungLlms([])).not.toContain('## Bài viết');
  });

  it('trỏ sang mục lục tài liệu cho LLM, trang đăng ký và liên hệ', () => {
    expect(txt).toContain(DOCS_LLMS);
    expect(txt).toContain(DOCS.batDau);
    expect(txt).toContain(DOCS.khoaApi);
    expect(txt).toContain(DOCS.api);
    expect(txt).toContain(CONSOLE_URL);
    expect(txt).toContain(SUPPORT_EMAIL);
  });

  it('không lộ khoá, không mời tự host, không dẫn về repo', () => {
    expect(txt).not.toMatch(/mlv_live_[0-9A-Za-z]{24}/);
    expect(txt).not.toMatch(/tự host|self-host/i);
    expect(txt).not.toContain('github.com');
  });

  it('kết thúc bằng đúng một dấu xuống dòng', () => {
    expect(txt.endsWith('\n')).toBe(true);
    expect(txt.endsWith('\n\n')).toBe(false);
  });
});
```

- [x] **Step 2: Chạy, thấy đỏ**

Run: `pnpm exec vitest run apps/site/src/lib/llms.test.ts`
Expected: FAIL — `Failed to resolve import "./llms"`.

- [x] **Step 3: Viết `llms.ts`**

`apps/site/src/lib/llms.ts`:

```ts
import { API_BASE, DOCS, DOCS_LLMS } from '@mapslibvn/catalog';
import {
  BRAND,
  CONSOLE_URL,
  SUPPORT_EMAIL,
  SUPPORT_PHONE_HIEN_THI,
} from '../../site.config.mjs';
import { sapTheoNgayMoi } from './bai-viet';
import { bangGia } from './gia';
import { canonicalUrl } from './seo';
import { TRANG, type TrangMeta } from './trang';

export interface BaiLlms {
  slug: string;
  title: string;
  description: string;
  publishedAt: string;
}

const SDK = ['@mapslibvn/web', '@mapslibvn/react', '@mapslibvn/react-native', '@mapslibvn/core'];

/** Một dòng link đúng khuôn llmstxt.org: `- [tên](url)` rồi `: ghi chú` nếu có. */
const dong = (ten: string, url: string, ghiChu?: string) =>
  `- [${ten}](${url})${ghiChu ? `: ${ghiChu}` : ''}`;

/**
 * `/llms.txt` của website theo llmstxt.org (spec SEO-AI mục 5.2). Sinh từ TRANG, catalog giá và
 * bài đã duyệt: đổi giá hay đổi mô tả trang là tệp tự đúng theo, không có con số nào gõ tay.
 */
export function noiDungLlms(baiViet: readonly BaiLlms[]): string {
  const gia = bangGia().map((goi) =>
    goi.tier === 'trial'
      ? `  - ${goi.ten}: miễn phí 30 ngày, ${goi.placesHienThi} lượt Places, ${goi.directionsHienThi} lượt tính tuyến`
      : `  - ${goi.ten}: ${goi.theoKy[1].vndHienThi} mỗi tháng, ${goi.placesHienThi} lượt Places, ${goi.directionsHienThi} lượt tính tuyến`,
  );
  const trangChinh = (Object.values(TRANG) as TrangMeta[])
    .filter((trang) => trang.path !== TRANG.trangChu.path && trang.path !== TRANG.khong404.path)
    .map((trang) => dong(trang.h1, canonicalUrl(trang.path), trang.description));
  const bai = sapTheoNgayMoi(baiViet).map((item) =>
    dong(item.title, canonicalUrl(`/bai-viet/${item.slug}/`), item.description),
  );

  return [
    `# ${BRAND}`,
    '',
    `> ${TRANG.trangChu.description}`,
    '',
    'Cần biết:',
    '',
    `- API: ${API_BASE} — mọi endpoint /v1/* cần khoá API gửi qua header X-Api-Key.`,
    `- SDK trên npm: ${SDK.join(', ')}.`,
    '- Giá tính theo lượt gọi API, không theo số người dùng:',
    ...gia,
    `- Đăng ký và lấy khoá: ${CONSOLE_URL}`,
    `- Liên hệ: ${SUPPORT_EMAIL}, ${SUPPORT_PHONE_HIEN_THI}`,
    '',
    '## Trang chính',
    '',
    ...trangChinh,
    ...(bai.length > 0 ? ['', '## Bài viết', '', ...bai] : []),
    '',
    '## Tài liệu',
    '',
    dong('Mục lục tài liệu cho LLM', DOCS_LLMS, 'toàn bộ tài liệu kỹ thuật dạng văn bản'),
    dong('Bắt đầu 5 phút', DOCS.batDau),
    dong('Khoá API', DOCS.khoaApi),
    dong('REST API', DOCS.api),
    '',
  ].join('\n');
}
```

- [x] **Step 4: Chạy, thấy xanh**

Run: `pnpm exec vitest run apps/site/src/lib/llms.test.ts`
Expected: PASS 8/8.

- [x] **Step 5: Endpoint `/llms.txt`**

`apps/site/src/pages/llms.txt.ts`:

```ts
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { noiDungLlms } from '../lib/llms';

// Chỉ bài đã duyệt, giống sitemap và trang /bai-viet/: bản nháp không được lọt ra cho máy đọc.
export const GET: APIRoute = async () => {
  const bai = await getCollection('baiViet', ({ data }) => data.daDuyet);
  const txt = noiDungLlms(
    bai.map((item) => ({
      slug: item.id,
      title: item.data.title,
      description: item.data.description,
      publishedAt: item.data.publishedAt,
    })),
  );
  return new Response(txt, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};
```

- [x] **Step 6: Build và đọc tệp thật**

Run: `pnpm --filter @mapslibvn/site build && sed -n 1,20p apps/site/dist/llms.txt && grep -c 'llms' apps/site/dist/sitemap-0.xml`
Expected: tệp mở đầu `# MapsLibVN`, có dòng giá `Starter: 650.000đ mỗi tháng, …`; số cuối là `0` (sitemap không chứa `llms.txt` — endpoint không phải trang).

- [x] **Step 7: Lint, typecheck, commit**

Run: `pnpm exec biome check --write apps/site/src/lib/llms.ts apps/site/src/lib/llms.test.ts apps/site/src/pages/llms.txt.ts && pnpm --filter @mapslibvn/site typecheck`
Expected: sạch.

```bash
git add apps/site/src/lib/llms.ts apps/site/src/lib/llms.test.ts apps/site/src/pages/llms.txt.ts
git commit -m "feat(site): /llms.txt sinh từ TRANG, catalog giá và bài đã duyệt

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `lastmod` cho bài viết trong sitemap website

**Files:**
- Create: `apps/site/src/lib/lastmod.mjs`, `apps/site/src/lib/lastmod.test.ts`
- Modify: `apps/site/astro.config.mjs`

- [x] **Step 1: Viết test đỏ**

`apps/site/src/lib/lastmod.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { lastmodChoUrl, ngayCuaBai } from './lastmod.mjs';

const SITE = 'https://mapslibvn.pages.dev';

describe('ngayCuaBai', () => {
  it('updatedAt thắng publishedAt', () => {
    expect(
      ngayCuaBai("---\ntitle: X\npublishedAt: '2026-09-18'\nupdatedAt: '2026-09-24'\n---\nThân"),
    ).toBe('2026-09-24');
  });

  it('không có updatedAt thì lấy publishedAt; có nháy hay không đều đọc được', () => {
    expect(ngayCuaBai("---\npublishedAt: '2026-09-18'\n---\n")).toBe('2026-09-18');
    expect(ngayCuaBai('---\npublishedAt: 2026-09-18\n---\n')).toBe('2026-09-18');
  });

  it('không có frontmatter hay không có ngày thì trả undefined', () => {
    expect(ngayCuaBai('Không có frontmatter')).toBeUndefined();
    expect(ngayCuaBai('---\ntitle: X\n---\n')).toBeUndefined();
  });

  it('không đọc nhầm ngày nằm trong thân bài', () => {
    expect(ngayCuaBai("---\ntitle: X\n---\npublishedAt: '2026-01-01'\n")).toBeUndefined();
  });
});

describe('lastmodChoUrl', () => {
  const thuMuc = mkdtempSync(join(tmpdir(), 'mlv-bai-'));
  writeFileSync(join(thuMuc, 'bai-a.md'), "---\npublishedAt: '2026-09-18'\n---\n");
  const thuMucUrl = pathToFileURL(`${thuMuc}/`);

  it('bài viết có lastmod theo frontmatter', () => {
    expect(lastmodChoUrl(`${SITE}/bai-viet/bai-a/`, thuMucUrl)).toBe('2026-09-18');
  });

  it('trang marketing và trang danh sách bài không có lastmod (spec SEO-AI quyết định 5)', () => {
    expect(lastmodChoUrl(`${SITE}/`, thuMucUrl)).toBeUndefined();
    expect(lastmodChoUrl(`${SITE}/bang-gia/`, thuMucUrl)).toBeUndefined();
    expect(lastmodChoUrl(`${SITE}/bai-viet/`, thuMucUrl)).toBeUndefined();
  });

  it('bài không có tệp nguồn thì không bịa ngày', () => {
    expect(lastmodChoUrl(`${SITE}/bai-viet/khong-co/`, thuMucUrl)).toBeUndefined();
  });
});
```

- [x] **Step 2: Chạy, thấy đỏ**

Run: `pnpm exec vitest run apps/site/src/lib/lastmod.test.ts`
Expected: FAIL — `Failed to resolve import "./lastmod.mjs"`.

- [x] **Step 3: Viết `lastmod.mjs`**

`apps/site/src/lib/lastmod.mjs` (JS thuần để `astro.config.mjs` import được — tệp cấu hình Astro không đọc TypeScript):

```js
import { existsSync, readFileSync } from 'node:fs';

/**
 * Ngày sửa cuối của một bài theo frontmatter: `updatedAt` nếu có, không thì `publishedAt`.
 * Chỉ đọc khối frontmatter ở đầu tệp, không đọc thân bài.
 * @param {string} noiDung toàn văn tệp .md
 * @returns {string | undefined} YYYY-MM-DD
 */
export function ngayCuaBai(noiDung) {
  const khoi = /^---\n([\s\S]*?)\n---/.exec(noiDung)?.[1];
  if (!khoi) return undefined;
  /** @param {string} truong */
  const doc = (truong) =>
    new RegExp(`^${truong}:\\s*['"]?(\\d{4}-\\d{2}-\\d{2})['"]?\\s*$`, 'm').exec(khoi)?.[1];
  return doc('updatedAt') ?? doc('publishedAt');
}

/**
 * `lastmod` cho một URL của sitemap website. Chỉ bài viết có ngày thật; mọi trang khác trả
 * undefined — trang marketing phụ thuộc catalog và component nên không có ngày nào đúng (spec
 * SEO-AI mục 5.4), và Google bỏ qua lastmod của cả site khi thấy nó không đáng tin.
 * @param {string} url URL tuyệt đối trong sitemap
 * @param {URL} thuMucBai thư mục src/content/bai-viet/ (có gạch cuối)
 * @returns {string | undefined}
 */
export function lastmodChoUrl(url, thuMucBai) {
  const slug = /^\/bai-viet\/([^/]+)\/$/.exec(new URL(url).pathname)?.[1];
  if (!slug) return undefined;
  const tep = new URL(`${slug}.md`, thuMucBai);
  return existsSync(tep) ? ngayCuaBai(readFileSync(tep, 'utf8')) : undefined;
}
```

- [x] **Step 4: Chạy, thấy xanh**

Run: `pnpm exec vitest run apps/site/src/lib/lastmod.test.ts`
Expected: PASS 7/7.

- [x] **Step 5: Gắn vào sitemap**

Trong `apps/site/astro.config.mjs`:

1. Thêm import sau `import { SITE_URL } from './site.config.mjs';`:

```js
import { lastmodChoUrl } from './src/lib/lastmod.mjs';

const THU_MUC_BAI = new URL('./src/content/bai-viet/', import.meta.url);
```

2. Thay `integrations: [sitemap({ filter: (page) => !page.includes('/404') })],` bằng:

```js
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/404'),
      // `lastmod` chỉ cho bài viết, lấy từ frontmatter (spec SEO-AI mục 5.4). Ghi ngày sai còn tệ
      // hơn không ghi: Google bỏ qua lastmod của cả site khi thấy nó không khớp nội dung.
      serialize(item) {
        const lastmod = lastmodChoUrl(item.url, THU_MUC_BAI);
        return lastmod ? { ...item, lastmod } : item;
      },
    }),
  ],
```

- [x] **Step 6: Build và đọc sitemap thật**

Run: `pnpm --filter @mapslibvn/site build && grep -o '<url><loc>[^<]*</loc>\(<lastmod>[^<]*</lastmod>\)\?' apps/site/dist/sitemap-0.xml`
Expected: hai URL `/bai-viet/<slug>/` có `<lastmod>2026-09-18…</lastmod>`; bảy URL còn lại không có `lastmod`.

- [x] **Step 7: Lint, typecheck, commit**

Run: `pnpm exec biome check --write apps/site/astro.config.mjs apps/site/src/lib/lastmod.mjs apps/site/src/lib/lastmod.test.ts && pnpm --filter @mapslibvn/site typecheck`

```bash
git add apps/site/astro.config.mjs apps/site/src/lib/lastmod.mjs apps/site/src/lib/lastmod.test.ts
git commit -m "feat(site): lastmod thật cho bài viết trong sitemap, trang marketing để trống có chủ đích

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: e2e SEO của website

**Files:**
- Modify: `apps/site/e2e/seo.spec.ts`

- [x] **Step 1: Thêm bài e2e**

Thêm vào cuối `apps/site/e2e/seo.spec.ts`:

```ts
test('robots.txt khai Content-Signal cho bot AI', async ({ request }) => {
  const txt = await (await request.get('/robots.txt')).text();
  expect(txt).toContain('Content-Signal: search=yes, ai-input=yes, ai-train=yes');
});

test('llms.txt có mọi trang chính và giá lấy từ catalog', async ({ request }) => {
  const res = await request.get('/llms.txt');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/plain');
  const txt = await res.text();
  expect(txt.startsWith('# MapsLibVN\n')).toBe(true);
  for (const path of TRANG.filter((p) => p !== '/')) {
    expect(txt, path).toContain(`(https://mapslibvn.pages.dev${path})`);
  }
  expect(txt).toContain('650.000đ');
  expect(txt).not.toMatch(/mlv_live_[0-9A-Za-z]{24}/);
});

test('sitemap: bài viết có lastmod, trang marketing thì không', async ({ request }) => {
  const xml = await (await request.get('/sitemap-0.xml')).text();
  expect(xml).toMatch(/<loc>https:\/\/mapslibvn\.pages\.dev\/bai-viet\/[^<]+\/<\/loc><lastmod>/);
  expect(xml).toContain('<loc>https://mapslibvn.pages.dev/bang-gia/</loc></url>');
});

test('logo vuông mà Organization.logo trỏ tới tồn tại thật', async ({ request }) => {
  const logo = await request.get('/logo-512.png');
  expect(logo.status()).toBe(200);
  expect(logo.headers()['content-type']).toContain('image/png');
});
```

- [x] **Step 2: Chạy toàn bộ e2e site**

Run: `pnpm test:site-e2e`
Expected: mọi bài xanh (các bài cũ + 4 bài mới). Nếu bài `content-type` của llms đỏ vì preview trả `text/plain` không kèm charset thì vẫn đạt — bài chỉ đòi chứa `text/plain`.

- [x] **Step 3: Lint và commit**

Run: `pnpm exec biome check --write apps/site/e2e/seo.spec.ts`

```bash
git add apps/site/e2e/seo.spec.ts
git commit -m "test(site): e2e robots Content-Signal, llms.txt, lastmod và logo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Nền của docs — phụ thuộc catalog, `docs.config.mjs`, ngày git, `copy-legal.mjs`

**Files:**
- Modify: `apps/docs/package.json` (qua `pnpm add`), `pnpm-lock.yaml`, `apps/docs/scripts/copy-legal.mjs`
- Create: `apps/docs/docs.config.mjs`, `apps/docs/src/lib/docs-config.test.ts`, `apps/docs/scripts/ngay-git.mjs`, `apps/docs/scripts/ngay-git.test.mjs`, `apps/docs/scripts/copy-legal.test.mjs`

- [x] **Step 1: Thêm phụ thuộc catalog**

Run: `pnpm --filter @mapslibvn/docs add @mapslibvn/catalog@workspace:*`
Expected: `apps/docs/package.json` có `"@mapslibvn/catalog": "workspace:*"` trong `dependencies`; lockfile đổi.

- [x] **Step 2: Viết test đỏ cho `docs.config.mjs`**

`apps/docs/src/lib/docs-config.test.ts`:

```ts
import { API_BASE, DOCS_URL, SITE_URL } from '@mapslibvn/catalog';
import { describe, expect, it } from 'vitest';
import * as cauHinh from '../../docs.config.mjs';

describe('docs.config.mjs', () => {
  it('ghi CÙNG các gốc URL với @mapslibvn/catalog', () => {
    expect(cauHinh.DOCS_URL).toBe(DOCS_URL);
    expect(cauHinh.SITE_URL).toBe(SITE_URL);
    expect(cauHinh.API_BASE).toBe(API_BASE);
  });

  it('mã xác thực Search Console là chuỗi (rỗng = chưa xác thực, không in thẻ)', () => {
    expect(typeof cauHinh.GOOGLE_SITE_VERIFICATION).toBe('string');
  });
});
```

Run: `pnpm exec vitest run apps/docs/src/lib/docs-config.test.ts`
Expected: FAIL — không tìm thấy `../../docs.config.mjs`.

- [x] **Step 3: Viết `docs.config.mjs`**

`apps/docs/docs.config.mjs`:

```js
/**
 * Hằng cho astro.config.mjs (tệp cấu hình Astro không import TypeScript). Bản gốc của các URL nằm
 * ở `@mapslibvn/catalog`; `src/lib/docs-config.test.ts` khẳng định hai nơi khớp nhau, giống cách
 * `apps/site/site.config.mjs` đang làm.
 */
export const DOCS_URL = 'https://mapslibvn-docs.pages.dev';
export const SITE_URL = 'https://mapslibvn.pages.dev';
export const API_BASE = 'https://api.ai-solutions.io.vn';
/**
 * Mã xác thực Google Search Console (phương thức thẻ HTML) cho property URL prefix
 * https://mapslibvn-docs.pages.dev/. Rỗng thì không in thẻ. Mã nằm công khai trong HTML nên commit
 * được.
 */
export const GOOGLE_SITE_VERIFICATION = '';
```

Run: `pnpm exec vitest run apps/docs/src/lib/docs-config.test.ts`
Expected: PASS 2/2.

- [x] **Step 4: Viết test đỏ cho `ngayGit`**

`apps/docs/scripts/ngay-git.test.mjs`:

```js
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ngayGit } from './ngay-git.mjs';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/;

describe('ngayGit', () => {
  it('tệp có lịch sử: hai ngày ISO 8601, ngày tạo không sau ngày sửa', () => {
    const ngay = ngayGit(resolve('apps/docs/src/content/docs/api.md'));
    expect(ngay?.taoLuc).toMatch(ISO);
    expect(ngay?.suaLuc).toMatch(ISO);
    expect(Date.parse(ngay?.taoLuc ?? '')).toBeLessThanOrEqual(Date.parse(ngay?.suaLuc ?? ''));
  });

  it('tệp không có lịch sử git trả undefined, không ném lỗi', () => {
    const tep = join(mkdtempSync(join(tmpdir(), 'mlv-git-')), 'moi.md');
    writeFileSync(tep, 'x');
    expect(ngayGit(tep)).toBeUndefined();
  });
});
```

Run: `pnpm exec vitest run apps/docs/scripts/ngay-git.test.mjs`
Expected: FAIL — không tìm thấy `./ngay-git.mjs`.

- [x] **Step 5: Viết `ngay-git.mjs`**

`apps/docs/scripts/ngay-git.mjs`:

```js
import { spawnSync } from 'node:child_process';

/** @typedef {{ taoLuc: string, suaLuc: string }} NgayGit */

/** @type {Map<string, NgayGit | undefined>} */
const DA_DOC = new Map();

/**
 * Ngày commit đầu và cuối của một tệp — ngày COMMITTER (`%cI`), cùng loại ngày Starlight dùng cho
 * `lastUpdated`, nên sitemap, JSON-LD và dòng "Cập nhật lần cuối" không bao giờ lệch nhau.
 *
 * Tệp không có lịch sử (hai trang pháp lý sinh lúc build nằm trong .gitignore, tệp ngoài repo, máy
 * không có git) trả undefined — không ném lỗi. Clone nông cho ngày SAI chứ không lỗi, nên
 * deploy-docs.yml phải kéo đủ lịch sử (`fetch-depth: 0`).
 * @param {string} tep đường dẫn tuyệt đối, hoặc tương đối với cwd
 * @returns {NgayGit | undefined}
 */
export function ngayGit(tep) {
  if (DA_DOC.has(tep)) return DA_DOC.get(tep);
  const kq = spawnSync('git', ['log', '--follow', '--format=%cI', '--', tep], {
    encoding: 'utf8',
  });
  const dong = kq.status === 0 ? kq.stdout.split('\n').filter(Boolean) : [];
  const moiNhat = dong[0];
  const cuNhat = dong[dong.length - 1];
  const ngay = moiNhat && cuNhat ? { taoLuc: cuNhat, suaLuc: moiNhat } : undefined;
  DA_DOC.set(tep, ngay);
  return ngay;
}
```

Run: `pnpm exec vitest run apps/docs/scripts/ngay-git.test.mjs`
Expected: PASS 2/2.

- [x] **Step 6: Viết test đỏ cho `copy-legal.mjs`**

`apps/docs/scripts/copy-legal.test.mjs`:

```js
import { describe, expect, it } from 'vitest';
import { PAGES, withFrontmatter } from './copy-legal.mjs';

describe('withFrontmatter', () => {
  it('ghi lastUpdated KHÔNG nháy để YAML đọc thành Date — schema Starlight đòi z.date()', () => {
    const md = withFrontmatter(
      { title: 'T', description: 'D' },
      '# H1 gốc\n\nThân',
      '2026-09-21T10:38:08+07:00',
    );
    expect(md.startsWith('---\ntitle: "T"\ndescription: "D"\n')).toBe(true);
    expect(md).toContain('\nlastUpdated: 2026-09-21T10:38:08+07:00\n---\n');
    expect(md).not.toContain('# H1 gốc');
    expect(md.endsWith('Thân')).toBe(true);
  });

  it('không có ngày git thì bỏ hẳn dòng lastUpdated', () => {
    expect(withFrontmatter({ title: 'T', description: 'D' }, 'Thân', undefined)).not.toContain(
      'lastUpdated',
    );
  });
});

describe('PAGES', () => {
  it('title ≤ 48 ký tự (còn chỗ cho " — MapsLibVN"), description 120–160 ký tự', () => {
    for (const trang of PAGES) {
      expect(trang.title.length, trang.dst).toBeLessThanOrEqual(48);
      expect(trang.description.length, trang.dst).toBeGreaterThanOrEqual(120);
      expect(trang.description.length, trang.dst).toBeLessThanOrEqual(160);
    }
  });
});
```

Run: `pnpm exec vitest run apps/docs/scripts/copy-legal.test.mjs`
Expected: FAIL — `PAGES` không được export, và import tệp chạy luôn vòng ghi tệp (đó là lý do phải tách `main`).

- [x] **Step 7: Viết lại `copy-legal.mjs`**

Thay toàn bộ `apps/docs/scripts/copy-legal.mjs`:

```js
#!/usr/bin/env node
// Sinh 2 trang docs từ file canonical ở gốc repo (một nguồn sự thật, không copy tay):
//   docs/legal/dieu-khoan-tenant.md → src/content/docs/dieu-khoan.md
//   THIRD_PARTY_NOTICES.md          → src/content/docs/thong-bao-ben-thu-ba.md
// Starlight tự vẽ H1 từ frontmatter nên bỏ dòng H1 đầu của file gốc. Hai file sinh nằm trong
// .gitignore, nên ngày "Cập nhật lần cuối" lấy từ git của file GỐC và ghi vào frontmatter.
// Chỉ chạy khi gọi thẳng bằng `node`; import (test, scripts/lastmod.mjs) thì không ghi tệp nào.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ngayGit } from './ngay-git.mjs';

/** Thư mục apps/docs — mọi đường dẫn trong PAGES tính từ đây. */
export const GOC_DOCS = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** @type {{ src: string, dst: string, title: string, description: string }[]} */
export const PAGES = [
  {
    src: '../../docs/legal/dieu-khoan-tenant.md',
    dst: 'src/content/docs/dieu-khoan.md',
    title: 'Điều khoản sử dụng API cho tenant',
    description:
      'Điều khoản sử dụng MapsLibVN cho ứng dụng nhúng: khoá API, chuỗi ghi nguồn bắt buộc, hành vi bị cấm như cào dữ liệu, dữ liệu cá nhân theo Nghị định 13/2023.',
  },
  {
    src: '../../THIRD_PARTY_NOTICES.md',
    dst: 'src/content/docs/thong-bao-ben-thu-ba.md',
    title: 'Thông báo bên thứ ba',
    description:
      'Giấy phép của thư viện, phông chữ, icon, style nền và dữ liệu mà SDK và API MapsLibVN đóng gói hoặc phục vụ tới client, kèm ghi chú về nhãn hiệu MapLibre.',
  },
];

/**
 * @param {{ title: string, description: string }} meta
 * @param {string} body
 * @param {string | undefined} lastUpdated ISO 8601 — ngày commit cuối của file gốc
 */
export function withFrontmatter(meta, body, lastUpdated) {
  const withoutH1 = body.replace(/^# .*\n+/, '');
  const dong = [
    `title: ${JSON.stringify(meta.title)}`,
    `description: ${JSON.stringify(meta.description)}`,
    // KHÔNG nháy: YAML đọc timestamp trần thành Date, đúng kiểu `z.date()` của Starlight; có nháy
    // là chuỗi và `astro build` đỏ.
    ...(lastUpdated ? [`lastUpdated: ${lastUpdated}`] : []),
  ];
  return `---\n${dong.join('\n')}\n---\n\n${withoutH1}`;
}

function main() {
  for (const page of PAGES) {
    const src = resolve(GOC_DOCS, page.src);
    if (!existsSync(src)) throw new Error(`Thiếu ${page.src}`);
    writeFileSync(
      resolve(GOC_DOCS, page.dst),
      withFrontmatter(page, readFileSync(src, 'utf8'), ngayGit(src)?.suaLuc),
    );
  }
  console.log(`✓ sinh ${PAGES.length} trang pháp lý vào src/content/docs`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
```

- [x] **Step 8: Chạy test, rồi chạy thật**

Run: `pnpm exec vitest run apps/docs/scripts/copy-legal.test.mjs`
Expected: PASS 3/3.

Run: `node apps/docs/scripts/copy-legal.mjs && sed -n 1,5p apps/docs/src/content/docs/dieu-khoan.md`
Expected: in `✓ sinh 2 trang pháp lý…` (đường dẫn tính từ `GOC_DOCS` nên chạy từ gốc repo được); frontmatter có `title: "Điều khoản sử dụng API cho tenant"` và `lastUpdated: 2026-09-21T10:38:08+07:00` (không nháy; ngày là commit cuối của `docs/legal/dieu-khoan-tenant.md`).

- [x] **Step 9: Lint và commit**

Run: `pnpm exec biome check --write apps/docs/docs.config.mjs apps/docs/src/lib/docs-config.test.ts apps/docs/scripts/ngay-git.mjs apps/docs/scripts/ngay-git.test.mjs apps/docs/scripts/copy-legal.mjs apps/docs/scripts/copy-legal.test.mjs`

```bash
git add apps/docs/package.json pnpm-lock.yaml apps/docs/docs.config.mjs apps/docs/src/lib/docs-config.test.ts apps/docs/scripts/ngay-git.mjs apps/docs/scripts/ngay-git.test.mjs apps/docs/scripts/copy-legal.mjs apps/docs/scripts/copy-legal.test.mjs
git commit -m "feat(docs): hằng dùng chung, ngày git của tệp, trang pháp lý mang ngày cập nhật của file gốc

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Title và description docs, ép độ dài bằng schema

**Files:**
- Modify: 18 tệp trong `apps/docs/src/content/docs/`, `apps/docs/src/content.config.ts`, `apps/docs/astro.config.mjs`

- [x] **Step 1: Sửa frontmatter**

Mọi giá trị mới đặt trong nháy kép: nhiều chuỗi chứa `: ` mà YAML hiểu là khoá lồng nếu để trần. Chỉ thay đúng dòng ghi dưới đây, giữ nguyên các dòng khác.

| Tệp | Dòng `title:` mới | Dòng `description:` mới (trống = giữ nguyên) |
|---|---|---|
| `api.md` | `title: "REST API bản đồ, geocode và dẫn đường"` | |
| `ban-do-web.md` | `title: "Bản đồ web: tuỳ chọn, marker, sự kiện"` | |
| `bat-dau.md` | `title: "Nhúng bản đồ Việt Nam trong 5 phút"` | `description: "Đường nhanh nhất để chạy bản đồ MapsLibVN: một thẻ script không cần build, hoặc cài từ npm cho web, React và React Native, kèm marker và sự kiện bấm POI."` |
| `cai-dat.mdx` | `title: "Cài đặt SDK bản đồ cho web và mobile"` | |
| `dan-duong-react-native.md` | `title: "Dẫn đường trên React Native có giọng Việt"` | `description: "Dẫn đường trên iOS và Android bằng @mapslibvn/react-native: phiên chạy độc lập với màn hình bản đồ, định vị cả khi khoá máy, đọc chỉ dẫn tiếng Việt bằng TTS."` |
| `dan-duong.md` | `title: "Dẫn đường từng bước trên web"` | `description: "Dẫn đường từng bước trên web với MapsLibVN: vẽ tuyến từ /v1/directions, bám GPS, đọc câu rẽ bằng giọng tiếng Việt và tự tính lại tuyến khi người dùng đi lệch."` |
| `do-chinh-xac.md` | `title: "Độ chính xác geocode địa chỉ Việt Nam"` | `description: "Ý nghĩa của precision và confidence trong kết quả geocode và reverse của MapsLibVN, thang phân giải từ mái nhà tới phường, địa chỉ theo đơn vị hành chính cũ."` |
| `doi-xe.md` | `title: "Tối ưu tuyến giao hàng và đội xe"` | |
| `dong-gop.md` | `title: "Đóng góp và sửa địa điểm (POI)"` | `description: "Cho người dùng cuối sửa giờ mở cửa, vị trí, liên hệ hoặc thêm địa điểm mới qua POST /v1/edits và suggestEdit của SDK, kèm scope cần có và luật tự duyệt."` |
| `giay-phep.md` | `title: "Giấy phép dữ liệu và chuỗi ghi nguồn"` | `description: "SDK MapsLibVN theo giấy phép MIT, dữ liệu mở từ OpenStreetMap (ODbL) và Foursquare OS Places (Apache-2.0), chuỗi ghi nguồn bắt buộc và cách áp dụng ODbL."` |
| `index.mdx` | `title: "Tài liệu API bản đồ Việt Nam"` | `description: "Tài liệu MapsLibVN: nhúng bản đồ Việt Nam vào web, React và React Native, tìm địa điểm, geocode địa chỉ, dẫn đường, kèm playground chạy thử bằng khoá demo."` |
| `khoa-api.md` | `title: "Khoá API: web, mobile và server"` | `description: "Lấy khoá API MapsLibVN trong năm phút, phân biệt ba loại khoá web, mobile và server, cách kiểm origin, scope, quota, khoá demo và cách truyền khoá qua header."` |
| `nhung-thu.md` | `title: "Nhúng thử bản đồ vào trang HTML của bạn"` | `description: "Chạy một trang HTML có bản đồ MapsLibVN trên máy trong hai phút bằng khoá demo và một máy chủ tĩnh, vì sao file:// không chạy, rồi chuyển sang origin thật."` |
| `react-native.md` | `title: "Bản đồ Việt Nam cho React Native"` | `description: "Nhúng bản đồ MapsLibVN vào app iOS và Android bằng @mapslibvn/react-native: yêu cầu New Architecture, cài bằng Expo hoặc bare, MapsLibVNMap, Marker, useMap."` |
| `react.md` | `title: "SDK React cho bản đồ Việt Nam"` | |
| `sdk.md` | `title: "Tham chiếu SDK JavaScript @mapslibvn"` | |
| `tim-kiem.md` | `title: "Tìm kiếm và autocomplete địa chỉ Việt Nam"` | |
| `tinh-nang.md` | `title: "Tính năng kỹ thuật và 164 mã POI"` | `description: "Tham chiếu kỹ thuật của MapsLibVN: tiles PMTiles, style sáng và tối, 164 mã POI trong 13 nhóm, Places API, geocode có precision, cùng những gì chưa có."` |

Riêng `index.mdx`: trong khối `hero:` thêm dòng `  title: MapsLibVN` làm dòng đầu tiên (trên `  tagline:`), để phần hero vẫn hiện tên thương hiệu.

- [x] **Step 2: Ép description bằng schema**

Thay toàn bộ `apps/docs/src/content.config.ts`:

```ts
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { z } from 'astro/zod';
import { defineCollection } from 'astro:content';

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      // Ép SEO ngay lúc build, giống bài viết của website: description ngoài 120–160 ký tự thì
      // Google tự viết lại hoặc cắt, và `astro build` đỏ ở đây trước khi lên production.
      extend: z.object({ description: z.string().min(120).max(160) }),
    }),
  }),
};
```

- [x] **Step 3: Dấu nối tiêu đề giống website**

Trong `apps/docs/astro.config.mjs`, trong `starlight({ … })` thêm ngay dưới `title: 'MapsLibVN',`:

```js
      // "Trang — MapsLibVN" giống website, thay cho "Trang | MapsLibVN" mặc định của Starlight.
      titleDelimiter: '—',
```

- [x] **Step 4: Build — phải xanh**

Run: `pnpm --filter @mapslibvn/core build && pnpm --filter @mapslibvn/web build && pnpm --filter @mapslibvn/react build && pnpm --filter @mapslibvn/docs build`
Expected: build xong, không lỗi schema.

Run: `grep -oh '<title>[^<]*' apps/docs/dist/index.html apps/docs/dist/*/index.html | sort | uniq -c | sort -rn | head -30`
Expected: mỗi title xuất hiện đúng 1 lần; có `<title>Tài liệu API bản đồ Việt Nam — MapsLibVN`; không dòng nào chứa `| MapsLibVN`.

- [x] **Step 5: Kiểm schema thật sự chặn**

Tạm đổi dòng `description:` của `bat-dau.md` thành `description: "Ngắn."`, chạy `pnpm --filter @mapslibvn/docs build`.
Expected: build ĐỎ, lỗi nhắc `description` ở `bat-dau`. Sau đó đổi dòng đó lại ĐÚNG giá trị trong bảng Step 1 (KHÔNG dùng `git checkout` — thay đổi của Step 1 chưa commit, checkout sẽ xoá luôn). Nếu build KHÔNG đỏ: `extend` không siết được description — chuyển sang phương án dự phòng ở spec mục 12: thêm bài vitest `apps/docs/src/lib/frontmatter.test.ts` đọc frontmatter mọi tệp `.md`/`.mdx` trong `apps/docs/src/content/docs` và khẳng định 120 ≤ độ dài description ≤ 160, rồi ghi việc này vào mục "Lệch spec có chủ ý".

- [x] **Step 6: Lint và commit**

Run: `pnpm exec biome check --write apps/docs/src/content.config.ts apps/docs/astro.config.mjs && pnpm --filter @mapslibvn/docs typecheck`

```bash
git add apps/docs/src/content apps/docs/src/content.config.ts apps/docs/astro.config.mjs
git commit -m "feat(docs): title và description theo cụm người ta gõ, ép 120–160 ký tự lúc build

Trang chủ docs không còn là \"MapsLibVN | MapsLibVN\"; /tinh-nang/ của docs thành tham chiếu kỹ
thuật để không tranh từ khoá với /tinh-nang/ của website.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Route middleware — OG, JSON-LD, noindex cho mọi trang docs

**Files:**
- Create: `apps/docs/src/lib/seo-docs.ts`, `apps/docs/src/lib/seo-docs.test.ts`, `apps/docs/src/route-data.ts`
- Modify: `apps/docs/astro.config.mjs`

- [x] **Step 1: Viết test đỏ**

`apps/docs/src/lib/seo-docs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  DOCS_WEBSITE_ID,
  type JsonLdDocs,
  jsonLdDocs,
  KHONG_INDEX,
  OG_DOCS,
  ORG_ID,
  theHeadDocs,
} from './seo-docs';

const TRANG = {
  id: 'api',
  title: 'REST API bản đồ, geocode và dẫn đường',
  description: 'Mô tả trang',
  url: 'https://mapslibvn-docs.pages.dev/api/',
  dateModified: '2026-09-24T14:24:50.000Z',
  datePublished: '2026-09-04T09:57:10+07:00',
};

const nut = (ld: JsonLdDocs, loai: string) => ld['@graph'].filter((n) => n['@type'] === loai);
const loaiNut = (ld: JsonLdDocs) => ld['@graph'].map((n) => n['@type']).sort();

describe('jsonLdDocs', () => {
  it('trang thường có đủ Organization, WebSite, TechArticle, BreadcrumbList', () => {
    const ld = jsonLdDocs(TRANG);
    expect(ld['@context']).toBe('https://schema.org');
    expect(loaiNut(ld)).toEqual(['BreadcrumbList', 'Organization', 'TechArticle', 'WebSite']);
  });

  it('Organization dùng ĐÚNG @id của website để hai tên miền là một chủ', () => {
    const [org] = nut(jsonLdDocs(TRANG), 'Organization');
    expect(ORG_ID).toBe('https://mapslibvn.pages.dev/#organization');
    expect(org?.['@id']).toBe(ORG_ID);
    expect(org?.logo).toBe('https://mapslibvn.pages.dev/logo-512.png');
  });

  it('TechArticle mang ngày, ảnh, ngôn ngữ và trỏ về tổ chức', () => {
    const [bai] = nut(jsonLdDocs(TRANG), 'TechArticle');
    expect(bai?.headline).toBe(TRANG.title);
    expect(bai?.url).toBe(TRANG.url);
    expect(bai?.dateModified).toBe(TRANG.dateModified);
    expect(bai?.datePublished).toBe(TRANG.datePublished);
    expect(bai?.image).toBe(OG_DOCS);
    expect(bai?.inLanguage).toBe('vi');
    expect(bai?.author).toEqual({ '@id': ORG_ID });
    expect(bai?.publisher).toEqual({ '@id': ORG_ID });
    expect(bai?.isPartOf).toEqual({ '@id': DOCS_WEBSITE_ID });
  });

  it('thiếu ngày thì bỏ hẳn trường, không ghi undefined hay chuỗi rỗng', () => {
    const [bai] = nut(
      jsonLdDocs({ ...TRANG, dateModified: undefined, datePublished: undefined }),
      'TechArticle',
    );
    expect(bai).not.toHaveProperty('dateModified');
    expect(bai).not.toHaveProperty('datePublished');
  });

  it('trang chủ docs chỉ có Organization và WebSite', () => {
    const ld = jsonLdDocs({ ...TRANG, id: '', url: 'https://mapslibvn-docs.pages.dev/' });
    expect(loaiNut(ld)).toEqual(['Organization', 'WebSite']);
  });

  it('BreadcrumbList hai bậc: Tài liệu → trang', () => {
    const [bc] = nut(jsonLdDocs(TRANG), 'BreadcrumbList');
    expect(bc?.itemListElement).toEqual([
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Tài liệu',
        item: 'https://mapslibvn-docs.pages.dev/',
      },
      { '@type': 'ListItem', position: 2, name: TRANG.title, item: TRANG.url },
    ]);
  });
});

describe('theHeadDocs', () => {
  const the = theHeadDocs(TRANG);
  const meta = (khoa: string, giaTri: string) =>
    the.find((t) => t.tag === 'meta' && t.attrs[khoa] === giaTri)?.attrs.content;

  it('thêm og:image tuyệt đối kèm kích thước, alt và twitter:image', () => {
    expect(meta('property', 'og:image')).toBe(
      'https://mapslibvn-docs.pages.dev/og/tai-lieu-v1.png',
    );
    expect(meta('property', 'og:image:width')).toBe('1200');
    expect(meta('property', 'og:image:height')).toBe('630');
    expect(meta('property', 'og:image:alt')).toBe(TRANG.title);
    expect(meta('name', 'twitter:image')).toBe(OG_DOCS);
  });

  it('JSON-LD nằm trong một thẻ script, parse được, không có "<" trần', () => {
    const coNgoac = theHeadDocs({ ...TRANG, description: 'Web component <mapslibvn-autocomplete>' });
    const script = coNgoac.find((t) => t.tag === 'script');
    expect(script?.attrs.type).toBe('application/ld+json');
    expect(script?.content).not.toContain('<');
    expect(JSON.parse(script?.content ?? '{}')['@context']).toBe('https://schema.org');
  });

  it('noindex đúng các trang trong KHONG_INDEX, trang khác không có thẻ robots', () => {
    expect(KHONG_INDEX).toEqual(['thong-bao-ben-thu-ba']);
    const robots = (id: string) =>
      theHeadDocs({ ...TRANG, id }).find((t) => t.attrs.name === 'robots');
    expect(robots('thong-bao-ben-thu-ba')?.attrs.content).toBe('noindex');
    expect(robots('api')).toBeUndefined();
  });
});
```

- [x] **Step 2: Chạy, thấy đỏ**

Run: `pnpm exec vitest run apps/docs/src/lib/seo-docs.test.ts`
Expected: FAIL — `Failed to resolve import "./seo-docs"`.

- [x] **Step 3: Viết `seo-docs.ts`**

`apps/docs/src/lib/seo-docs.ts`:

```ts
import { DOCS_URL, SITE_URL } from '@mapslibvn/catalog';

/** Cùng `@id` với `ORG_ID` của website (apps/site/src/lib/seo.ts): máy gộp hai tên miền làm một
 *  chủ. Google không sang tên miền khác để tra `@id`, nên docs lặp lại nút Organization rút gọn. */
export const ORG_ID = `${SITE_URL}/#organization`;
export const DOCS_WEBSITE_ID = `${DOCS_URL}/#website`;
/** Ảnh OG của mọi trang docs, sinh bằng `node scripts/site-images.mjs --og=tai-lieu`. */
export const OG_DOCS = `${DOCS_URL}/og/tai-lieu-v1.png`;
const LOGO = `${SITE_URL}/logo-512.png`;
/** Trang không cho lập chỉ mục: phần lớn là văn bản giấy phép MIT/Apache có ở khắp nơi. */
export const KHONG_INDEX: readonly string[] = ['thong-bao-ben-thu-ba'];

export interface TrangDocs {
  /** Slug Starlight; trang chủ là chuỗi rỗng. */
  id: string;
  title: string;
  description: string;
  /** URL tuyệt đối của trang, trùng canonical. */
  url: string;
  dateModified?: string | undefined;
  datePublished?: string | undefined;
}

export type NutJsonLd = Record<string, unknown> & { '@type': string };

export interface JsonLdDocs {
  '@context': 'https://schema.org';
  '@graph': NutJsonLd[];
}

export interface TheHead {
  tag: 'meta' | 'script';
  attrs: Record<string, string>;
  content?: string;
}

export function jsonLdDocs(trang: TrangDocs): JsonLdDocs {
  const graph: NutJsonLd[] = [
    { '@type': 'Organization', '@id': ORG_ID, name: 'MapsLibVN', url: `${SITE_URL}/`, logo: LOGO },
    {
      '@type': 'WebSite',
      '@id': DOCS_WEBSITE_ID,
      name: 'Tài liệu MapsLibVN',
      url: `${DOCS_URL}/`,
      inLanguage: 'vi',
      publisher: { '@id': ORG_ID },
    },
  ];
  if (trang.id !== '') {
    graph.push(
      {
        '@type': 'TechArticle',
        headline: trang.title,
        description: trang.description,
        url: trang.url,
        inLanguage: 'vi',
        image: OG_DOCS,
        ...(trang.datePublished ? { datePublished: trang.datePublished } : {}),
        ...(trang.dateModified ? { dateModified: trang.dateModified } : {}),
        isPartOf: { '@id': DOCS_WEBSITE_ID },
        author: { '@id': ORG_ID },
        publisher: { '@id': ORG_ID },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Tài liệu', item: `${DOCS_URL}/` },
          { '@type': 'ListItem', position: 2, name: trang.title, item: trang.url },
        ],
      },
    );
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}

/** Các thẻ middleware đẩy vào `<head>` của một trang docs (spec SEO-AI mục 6.2). */
export function theHeadDocs(trang: TrangDocs): TheHead[] {
  const the: TheHead[] = [
    { tag: 'meta', attrs: { property: 'og:image', content: OG_DOCS } },
    { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
    { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
    { tag: 'meta', attrs: { property: 'og:image:alt', content: trang.title } },
    { tag: 'meta', attrs: { name: 'twitter:image', content: OG_DOCS } },
  ];
  if (KHONG_INDEX.includes(trang.id)) {
    the.push({ tag: 'meta', attrs: { name: 'robots', content: 'noindex' } });
  }
  // `<` thoát thành <: description có chữ như `<mapslibvn-autocomplete>`, và một chuỗi
  // `</script>` lọt vào là cắt đứt khối JSON-LD giữa chừng.
  the.push({
    tag: 'script',
    attrs: { type: 'application/ld+json' },
    content: JSON.stringify(jsonLdDocs(trang)).replace(/</g, '\\u003c'),
  });
  return the;
}
```

- [x] **Step 4: Chạy, thấy xanh**

Run: `pnpm exec vitest run apps/docs/src/lib/seo-docs.test.ts`
Expected: PASS 9/9.

- [x] **Step 5: Middleware**

`apps/docs/src/route-data.ts`:

```ts
import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import { DOCS_URL } from '@mapslibvn/catalog';
import { ngayGit } from '../scripts/ngay-git.mjs';
import { theHeadDocs } from './lib/seo-docs';

/**
 * Chèn ảnh OG, JSON-LD và noindex vào `<head>` của mọi trang Starlight (spec SEO-AI mục 6.2). Logic
 * nằm ở `lib/seo-docs.ts` để test được bằng vitest; ở đây chỉ gom dữ liệu của route.
 */
export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute;
  // Trang 404 dựng sẵn của Starlight không có mô tả và không phải bài để mang TechArticle.
  if (route.id === '404') return;
  const { data, filePath } = route.entry;
  route.head.push(
    ...theHeadDocs({
      id: route.id,
      title: data.title,
      description: data.description ?? '',
      url: new URL(context.url.pathname, DOCS_URL).href,
      // Cùng ngày với dòng "Cập nhật lần cuối" Starlight in ở cuối trang.
      dateModified: route.lastUpdated?.toISOString(),
      // Hai trang pháp lý sinh không có lịch sử git → undefined → bỏ trường.
      datePublished: filePath ? ngayGit(filePath)?.taoLuc : undefined,
    }),
  );
});
```

Trong `apps/docs/astro.config.mjs`, trong `starlight({ … })` thêm dưới dòng `titleDelimiter`:

```js
      // OG, JSON-LD, noindex cho từng trang (spec SEO-AI mục 6.2).
      routeMiddleware: './src/route-data.ts',
```

- [x] **Step 6: Build và đọc `<head>` thật**

Run: `pnpm --filter @mapslibvn/docs build && grep -o '<meta property="og:image"[^>]*>' apps/docs/dist/api/index.html && grep -o '<script type="application/ld+json">.\{0,160\}' apps/docs/dist/api/index.html && grep -c 'content="noindex"' apps/docs/dist/thong-bao-ben-thu-ba/index.html apps/docs/dist/api/index.html`
Expected: thẻ `og:image` trỏ `…/og/tai-lieu-v1.png`; khối JSON-LD mở đầu `{"@context":"https://schema.org","@graph":[{"@type":"Organization"…`; `thong-bao-ben-thu-ba` = 1, `api` = 0.

Run: `grep -o '"datePublished":"[^"]*"\|"dateModified":"[^"]*"' apps/docs/dist/api/index.html`
Expected: hai ngày, `datePublished` sớm hơn `dateModified`. (`dateModified` chỉ có khi Task 10 bật `lastUpdated` — lúc này có thể chỉ thấy `datePublished`; đó là đúng.)

- [x] **Step 7: Lint, typecheck, commit**

Run: `pnpm exec biome check --write apps/docs/src/lib/seo-docs.ts apps/docs/src/lib/seo-docs.test.ts apps/docs/src/route-data.ts apps/docs/astro.config.mjs && pnpm --filter @mapslibvn/docs typecheck`

```bash
git add apps/docs/src/lib/seo-docs.ts apps/docs/src/lib/seo-docs.test.ts apps/docs/src/route-data.ts apps/docs/astro.config.mjs
git commit -m "feat(docs): route middleware chèn ảnh OG, JSON-LD TechArticle và noindex

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Sitemap có `lastmod`, robots, "Cập nhật lần cuối", đủ lịch sử git trên CI

**Files:**
- Create: `apps/docs/scripts/lastmod.mjs`, `apps/docs/scripts/lastmod.test.mjs`, `apps/docs/src/pages/robots.txt.ts`
- Modify: `apps/docs/package.json` (qua `pnpm add`), `pnpm-lock.yaml`, `apps/docs/astro.config.mjs`, `.github/workflows/deploy-docs.yml`

- [x] **Step 1: Thêm phụ thuộc sitemap**

Run: `pnpm --filter @mapslibvn/docs add @astrojs/sitemap@^3.7.4`
Expected: `apps/docs/package.json` có `"@astrojs/sitemap": "^3.7.4"`.

- [x] **Step 2: Viết test đỏ**

`apps/docs/scripts/lastmod.test.mjs`:

```js
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lastmodChoUrl, tepNguonCuaUrl } from './lastmod.mjs';

const GOC = resolve('apps/docs');
const DOCS = 'https://mapslibvn-docs.pages.dev';

describe('tepNguonCuaUrl', () => {
  it('trang chủ → index.mdx; trang thường → .md hoặc .mdx cùng slug', () => {
    expect(tepNguonCuaUrl(`${DOCS}/`, GOC)).toEqual([resolve(GOC, 'src/content/docs/index.mdx')]);
    expect(tepNguonCuaUrl(`${DOCS}/api/`, GOC)).toEqual([resolve(GOC, 'src/content/docs/api.md')]);
    expect(tepNguonCuaUrl(`${DOCS}/cai-dat/`, GOC)).toEqual([
      resolve(GOC, 'src/content/docs/cai-dat.mdx'),
    ]);
  });

  it('trang pháp lý sinh → file gốc ngoài apps/docs, vì file sinh không có lịch sử git', () => {
    expect(tepNguonCuaUrl(`${DOCS}/dieu-khoan/`, GOC)).toEqual([
      resolve('docs/legal/dieu-khoan-tenant.md'),
    ]);
  });

  it('/playground → mọi tệp playground* trong public', () => {
    const tep = tepNguonCuaUrl(`${DOCS}/playground`, GOC);
    expect(tep).toContain(resolve(GOC, 'public/playground.html'));
    expect(tep.length).toBeGreaterThan(1);
  });

  it('slug không có tệp → danh sách rỗng', () => {
    expect(tepNguonCuaUrl(`${DOCS}/khong-co-trang-nay/`, GOC)).toEqual([]);
  });
});

describe('lastmodChoUrl', () => {
  it('ra ngày ISO 8601 cho trang có lịch sử', () => {
    expect(lastmodChoUrl(`${DOCS}/api/`, GOC)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('không có tệp nguồn thì không bịa ngày', () => {
    expect(lastmodChoUrl(`${DOCS}/khong-co-trang-nay/`, GOC)).toBeUndefined();
  });
});
```

Run: `pnpm exec vitest run apps/docs/scripts/lastmod.test.mjs`
Expected: FAIL — không tìm thấy `./lastmod.mjs`.

- [x] **Step 3: Viết `lastmod.mjs`**

`apps/docs/scripts/lastmod.mjs`:

```js
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PAGES } from './copy-legal.mjs';
import { ngayGit } from './ngay-git.mjs';

/**
 * Tệp nguồn quyết định ngày sửa của một URL trong sitemap docs (spec SEO-AI mục 6.4).
 * @param {string} url URL tuyệt đối
 * @param {string} gocDocs đường dẫn tuyệt đối tới apps/docs
 * @returns {string[]} đường dẫn tuyệt đối, chỉ tệp có thật
 */
export function tepNguonCuaUrl(url, gocDocs) {
  const duong = new URL(url).pathname;
  if (duong === '/playground') {
    const thuMuc = join(gocDocs, 'public');
    return readdirSync(thuMuc)
      .filter((ten) => ten.startsWith('playground'))
      .map((ten) => join(thuMuc, ten));
  }
  const slug = duong.replace(/^\/+|\/+$/g, '');
  if (slug === '') return [join(gocDocs, 'src/content/docs/index.mdx')];
  const sinh = PAGES.find((trang) => trang.dst === `src/content/docs/${slug}.md`);
  if (sinh) return [resolve(gocDocs, sinh.src)];
  return [`${slug}.md`, `${slug}.mdx`]
    .map((ten) => join(gocDocs, 'src/content/docs', ten))
    .filter((tep) => existsSync(tep));
}

/**
 * `lastmod` = ngày commit cuối mới nhất trong các tệp nguồn của URL. So bằng Date.parse chứ không
 * so chuỗi: hai commit từ hai máy có thể mang hai múi giờ khác nhau.
 * @param {string} url
 * @param {string} gocDocs
 * @returns {string | undefined}
 */
export function lastmodChoUrl(url, gocDocs) {
  /** @type {string | undefined} */
  let moiNhat;
  for (const tep of tepNguonCuaUrl(url, gocDocs)) {
    const sua = ngayGit(tep)?.suaLuc;
    if (sua && (moiNhat === undefined || Date.parse(sua) > Date.parse(moiNhat))) moiNhat = sua;
  }
  return moiNhat;
}
```

Run: `pnpm exec vitest run apps/docs/scripts/lastmod.test.mjs`
Expected: PASS 6/6.

- [x] **Step 4: robots.txt của docs**

`apps/docs/src/pages/robots.txt.ts`:

```ts
import { DOCS_URL, robotsTxt } from '@mapslibvn/catalog';
import type { APIRoute } from 'astro';

// Thay cho đoạn chú thích mặc định Cloudflare trả khi site không có robots.txt — bản đó không có
// `Sitemap:`, nên bot phải tự đoán đường tới sitemap (spec SEO-AI mục 1).
export const GET: APIRoute = () =>
  new Response(robotsTxt(DOCS_URL), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
```

- [x] **Step 5: Gắn sitemap và `lastUpdated` vào cấu hình**

Trong `apps/docs/astro.config.mjs`:

1. Thêm ba import (tệp đã có sẵn `import { fileURLToPath } from 'node:url';`; Biome tự sắp thứ tự ở Step 8):

```js
import sitemap from '@astrojs/sitemap';
import { DOCS_URL } from './docs.config.mjs';
import { lastmodChoUrl } from './scripts/lastmod.mjs';
```

2. Ngay trên `export default defineConfig({` thêm:

```js
const GOC_DOCS = fileURLToPath(new URL('.', import.meta.url));
/** Trang không lên sitemap: bản chép giấy phép (noindex), demo mỏng (noindex) và trang lỗi. */
const KHONG_LEN_SITEMAP = ['/thong-bao-ben-thu-ba/', '/react-demo/', '/404/'];
```

3. Đổi `site: 'https://mapslibvn-docs.pages.dev',` thành `site: DOCS_URL,`.

4. Trong mảng `integrations`, thêm làm phần tử ĐẦU TIÊN (trước `starlight({`):

```js
    // Tự khai sitemap để có `lastmod` thật từ git (Starlight thấy có sẵn thì bỏ bản của nó).
    sitemap({
      filter: (page) => !KHONG_LEN_SITEMAP.some((duong) => page.endsWith(duong)),
      customPages: [`${DOCS_URL}/playground`],
      serialize(item) {
        const lastmod = lastmodChoUrl(item.url, GOC_DOCS);
        return lastmod ? { ...item, lastmod } : item;
      },
    }),
```

5. Trong `starlight({ … })` thêm dưới `routeMiddleware`:

```js
      // "Cập nhật lần cuối: …" cuối mỗi trang — tín hiệu độ mới mà AI dựa vào khi chọn nguồn.
      // Đọc từ git, nên deploy-docs.yml phải checkout đủ lịch sử.
      lastUpdated: true,
```

- [x] **Step 6: Build và đọc thật**

Run: `pnpm --filter @mapslibvn/docs build && grep -o '<url><loc>[^<]*</loc><lastmod>[^<]*' apps/docs/dist/sitemap-0.xml | head -30 && grep -c '<loc>' apps/docs/dist/sitemap-0.xml && cat apps/docs/dist/robots.txt && grep -o 'Cập nhật lần cuối:[^<]*<[^>]*>[^<]*' apps/docs/dist/api/index.html`
Expected:
- mỗi `<loc>` có `<lastmod>`, và các ngày KHÁC nhau giữa các trang;
- số `<loc>` = 20 (19 trang Starlight trừ `thong-bao-ben-thu-ba`, thêm `/playground`; `react-demo` đã bị bỏ);
- `robots.txt` đúng nguyên văn Task 1 với gốc `https://mapslibvn-docs.pages.dev`;
- trang `api` có dòng "Cập nhật lần cuối:" kèm ngày.

Nếu số `<loc>` khác 20, liệt kê bằng `grep -o '<loc>[^<]*' apps/docs/dist/sitemap-0.xml` và đối chiếu với `apps/docs/e2e/docs.spec.ts` (`PAGES`) trước khi sửa `KHONG_LEN_SITEMAP`.

- [x] **Step 7: CI kéo đủ lịch sử, deploy lại khi catalog đổi**

Trong `.github/workflows/deploy-docs.yml`:

1. Trong `paths` thêm `'packages/catalog/**'` (sau `'packages/react/**'`).
2. Thay `- uses: actions/checkout@v4` bằng:

```yaml
      - uses: actions/checkout@v4
        with:
          # Đủ lịch sử git: "Cập nhật lần cuối", lastmod của sitemap và dateModified trong JSON-LD
          # đều đọc ngày commit của từng tệp. Clone nông làm mọi trang mang cùng một ngày — sai mà
          # không ai thấy (spec SEO-AI mục 6.3).
          fetch-depth: 0
```

- [x] **Step 8: Lint, typecheck, commit**

Run: `pnpm exec biome check --write apps/docs/astro.config.mjs apps/docs/scripts/lastmod.mjs apps/docs/scripts/lastmod.test.mjs apps/docs/src/pages/robots.txt.ts && pnpm --filter @mapslibvn/docs typecheck`

```bash
git add apps/docs/package.json pnpm-lock.yaml apps/docs/astro.config.mjs apps/docs/scripts/lastmod.mjs apps/docs/scripts/lastmod.test.mjs apps/docs/src/pages/robots.txt.ts .github/workflows/deploy-docs.yml
git commit -m "feat(docs): sitemap có lastmod từ git, robots.txt riêng, hiện ngày cập nhật; CI kéo đủ lịch sử

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Footer nối về website, playground, react-demo

**Files:**
- Create: `apps/docs/src/components/Footer.astro`
- Modify: `apps/docs/astro.config.mjs`, `apps/docs/public/playground.html`, `apps/docs/src/pages/react-demo.astro`

- [x] **Step 1: Footer**

`apps/docs/src/components/Footer.astro`:

```astro
---
// Footer gốc của Starlight (cập nhật lần cuối, trang trước/sau) cộng một hàng link về website.
// Trước 25/09/2026 docs link về site đúng 4 lần, toàn trong nội dung, nên máy khó thấy hai tên
// miền là một (spec SEO-AI mục 6.5).
import Default from '@astrojs/starlight/components/Footer.astro';
import { SITE_URL } from '@mapslibvn/catalog';

const LINK = [
  { nhan: 'Website MapsLibVN', href: `${SITE_URL}/` },
  { nhan: 'Bảng giá', href: `${SITE_URL}/bang-gia/` },
  { nhan: 'So với Google Maps', href: `${SITE_URL}/so-sanh/google-maps-api/` },
  { nhan: 'Liên hệ', href: `${SITE_URL}/lien-he/` },
];
---

<Default />
<nav class="lien-ket-site" aria-label="Website MapsLibVN">
  {LINK.map(({ nhan, href }) => <a href={href}>{nhan}</a>)}
</nav>

<style>
  .lien-ket-site {
    display: flex;
    flex-wrap: wrap;
    gap: 0 1.5rem;
    margin-top: 2rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--sl-color-hairline);
    font-size: var(--sl-text-sm);
  }
  /* Vùng chạm ≥ 44 px như quy định của website. */
  .lien-ket-site a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    color: var(--sl-color-gray-3);
    text-decoration: none;
  }
  .lien-ket-site a:hover {
    color: var(--sl-color-white);
  }
</style>
```

Trong `apps/docs/astro.config.mjs`, trong `starlight({ … })` thêm dưới `lastUpdated: true,`:

```js
      components: { Footer: './src/components/Footer.astro' },
```

- [x] **Step 2: Playground**

Trong `apps/docs/public/playground.html`, thay ba dòng

```html
  <title>MapsLibVN Playground</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="Chạy thử bản đồ và Places API của MapsLibVN bằng khoá demo hoặc khoá riêng." />
```

bằng:

```html
  <title>Playground bản đồ Việt Nam — MapsLibVN</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="Chạy thử bản đồ Việt Nam, tìm kiếm địa điểm, geocode và dẫn đường của MapsLibVN ngay trên trình duyệt bằng khoá demo, không cần cài đặt hay đăng ký tài khoản." />
  <!-- Canonical không có query: bản nhúng ?embed=1 trên trang chủ docs cũng trỏ về đây. -->
  <link rel="canonical" href="https://mapslibvn-docs.pages.dev/playground" />
  <meta property="og:title" content="Playground bản đồ Việt Nam — MapsLibVN" />
  <meta property="og:description" content="Chạy thử bản đồ Việt Nam, tìm kiếm địa điểm, geocode và dẫn đường của MapsLibVN ngay trên trình duyệt bằng khoá demo, không cần cài đặt hay đăng ký tài khoản." />
  <meta property="og:url" content="https://mapslibvn-docs.pages.dev/playground" />
  <meta property="og:type" content="website" />
  <meta property="og:locale" content="vi_VN" />
  <meta property="og:site_name" content="MapsLibVN" />
  <meta property="og:image" content="https://mapslibvn-docs.pages.dev/og/tai-lieu-v1.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
```

- [x] **Step 3: React demo không lập chỉ mục**

Trong `apps/docs/src/pages/react-demo.astro`, ngay sau dòng `<meta name="description" content="Demo React SDK của MapsLibVN" />` thêm:

```html
    <!-- Trang mỏng: nội dung thật nằm ở /react/. Đã bỏ khỏi sitemap (spec SEO-AI mục 6.6). -->
    <meta name="robots" content="noindex" />
```

- [x] **Step 4: Build và đọc thật**

Run: `pnpm --filter @mapslibvn/docs build && grep -c 'class="lien-ket-site"' apps/docs/dist/api/index.html apps/docs/dist/index.html && grep -o '<link rel="canonical"[^>]*>' apps/docs/dist/playground.html && grep -c 'content="noindex"' apps/docs/dist/react-demo/index.html`
Expected: `1` và `1` (footer có ở trang thường lẫn trang chủ splash); canonical `…/playground`; `1`.

- [x] **Step 5: e2e cũ của docs vẫn xanh**

Run: `pnpm --filter @mapslibvn/docs e2e`
Expected: xanh như trước (bài `docs.spec.ts` chỉ kiểm link nội bộ `a[href^="/"]`; link footer là tuyệt đối nên không bị kiểm). Bài này cần API chạy ở máy (`pnpm --filter @mapslibvn/api dev:e2e` do Playwright tự dựng). Nếu API không dựng được vì thiếu Postgres/khoá, ghi rõ lý do vào báo cáo task và dựa vào Task 13 cho phần SEO — không bỏ qua im lặng.

- [x] **Step 6: Lint và commit**

Run: `pnpm exec biome check --write apps/docs/src/components/Footer.astro apps/docs/astro.config.mjs apps/docs/public/playground.html apps/docs/src/pages/react-demo.astro && pnpm --filter @mapslibvn/docs typecheck`

```bash
git add apps/docs/src/components/Footer.astro apps/docs/astro.config.mjs apps/docs/public/playground.html apps/docs/src/pages/react-demo.astro
git commit -m "feat(docs): footer link về website, meta đầy đủ cho playground, noindex react-demo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: `llms.txt`, `llms-full.txt`, `llms-small.txt` cho tài liệu

**Files:**
- Modify: `apps/docs/package.json` (qua `pnpm add`), `pnpm-lock.yaml`, `apps/docs/astro.config.mjs`

- [x] **Step 1: Thêm plugin**

Run: `pnpm --filter @mapslibvn/docs add starlight-llms-txt@^0.12.0`
Expected: `apps/docs/package.json` có `"starlight-llms-txt": "^0.12.0"`.

- [x] **Step 2: Cấu hình plugin**

Trong `apps/docs/astro.config.mjs`:

1. Thêm import:

```js
import starlightLlmsTxt from 'starlight-llms-txt';
```

và đổi import hằng thành `import { API_BASE, DOCS_URL, GOOGLE_SITE_VERIFICATION, SITE_URL } from './docs.config.mjs';` (`GOOGLE_SITE_VERIFICATION` dùng ở Task 14; khai luôn ở đây để chỉ sửa dòng import một lần).

2. Trong `starlight({ … })` thêm dưới `components`:

```js
      // llms.txt / llms-full.txt / llms-small.txt cho AI và trợ lý lập trình (spec SEO-AI mục 6.7).
      // Nhãn nhóm bằng tiếng Anh để URL /_llms-txt/<nhóm>.txt là ASCII sạch; mô tả vẫn tiếng Việt.
      // KHÔNG ghi số tiền: docs cố ý không chép cứng giá (xem khoa-api.md), giá đọc ở /v1/catalog.
      plugins: [
        starlightLlmsTxt({
          projectName: 'MapsLibVN',
          description:
            'Tài liệu kỹ thuật của MapsLibVN — API bản đồ, tìm kiếm địa điểm, geocode và dẫn đường cho Việt Nam, kèm SDK cho web, React và React Native.',
          details: [
            `- API base: \`${API_BASE}\`; mọi endpoint \`/v1/*\` cần khoá API gửi qua header \`X-Api-Key\`.`,
            '- Ba loại khoá: `web` (kiểm origin của trình duyệt), `mobile`, `server`. Khoá demo chỉ để thử trên playground và `localhost`; ứng dụng thật cần khoá riêng.',
            '- Bốn gói npm: `@mapslibvn/web` (bản đồ web), `@mapslibvn/react` (React), `@mapslibvn/react-native` (iOS, Android), `@mapslibvn/core` (client API, không giao diện).',
            '- Ghi nguồn là bắt buộc: SDK luôn hiện attribution và không có tuỳ chọn tắt.',
            `- Giá và hạn mức: đọc bằng máy ở \`GET /v1/catalog\`, hoặc xem ${SITE_URL}/bang-gia/.`,
          ].join('\n'),
          customSets: [
            {
              label: 'Getting started',
              description: 'Cài đặt, khoá API, bản đồ đầu tiên trong 5 phút, React Native',
              paths: ['cai-dat', 'khoa-api', 'bat-dau', 'react-native'],
            },
            {
              label: 'Guides',
              description:
                'Bản đồ web, tìm kiếm, dẫn đường trên web và React Native, đội xe, React, độ chính xác geocode, đóng góp POI',
              paths: [
                'ban-do-web',
                'tim-kiem',
                'dan-duong',
                'dan-duong-react-native',
                'doi-xe',
                'react',
                'do-chinh-xac',
                'dong-gop',
              ],
            },
            {
              label: 'Reference',
              description: 'Tham chiếu REST API và SDK JavaScript',
              paths: ['api', 'sdk'],
            },
          ],
          optionalLinks: [
            { label: 'Website MapsLibVN', url: `${SITE_URL}/`, description: 'giới thiệu sản phẩm' },
            {
              label: 'Bảng giá',
              url: `${SITE_URL}/bang-gia/`,
              description: 'bốn gói, giá VND, hạn mức',
            },
            { label: 'So với Google Maps Platform', url: `${SITE_URL}/so-sanh/google-maps-api/` },
            { label: 'So với VIETMAP', url: `${SITE_URL}/so-sanh/vietmap/` },
          ],
          demote: ['dieu-khoan', 'giay-phep', 'thong-bao-ben-thu-ba'],
          exclude: ['thong-bao-ben-thu-ba'],
        }),
      ],
```

- [x] **Step 3: Build và đọc thật**

Run: `pnpm --filter @mapslibvn/docs build && ls -la apps/docs/dist/llms*.txt apps/docs/dist/_llms-txt/ && sed -n 1,30p apps/docs/dist/llms.txt`
Expected: có `llms.txt`, `llms-full.txt`, `llms-small.txt`, `_llms-txt/getting-started.txt`, `guides.txt`, `reference.txt`; `llms.txt` mở đầu `# MapsLibVN`, có blockquote mô tả, mục details, "Documentation Sets" và "Optional".

Run: `grep -cE 'mlv_live_[0-9A-Za-z]{24}' apps/docs/dist/llms*.txt apps/docs/dist/_llms-txt/*.txt; grep -ciE 'tự host|self-host' apps/docs/dist/llms-full.txt; grep -c '## ' apps/docs/dist/llms-full.txt`
Expected: mọi số đếm khoá là `0`; "tự host" `0`; số tiêu đề `##` > 50 (tài liệu đủ).

Nếu build đỏ vì một trang MDX (`cai-dat.mdx`, `index.mdx`) không chuyển được: bật `rawContent: true` trong cấu hình plugin, build lại, ghi vào "Lệch spec có chủ ý".

- [x] **Step 4: Lint, typecheck (có đổi dependency — không tin cache), commit**

Run: `pnpm exec biome check --write apps/docs/astro.config.mjs && pnpm exec turbo run typecheck --filter=@mapslibvn/docs --force`
Expected: sạch; dòng tổng kết có `Cached: 0 cached` (memory: turbo từng replay kết quả cũ sau khi đổi dependency).

```bash
git add apps/docs/package.json pnpm-lock.yaml apps/docs/astro.config.mjs
git commit -m "feat(docs): llms.txt, llms-full.txt, llms-small.txt và ba nhóm cho agent qua starlight-llms-txt

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: e2e SEO cho tài liệu

**Files:**
- Create: `apps/docs/playwright.seo.config.ts`, `apps/docs/e2e/seo.spec.ts`
- Modify: `apps/docs/package.json` (thêm script `e2e:seo`)

- [x] **Step 1: Cấu hình Playwright riêng, không cần API**

`apps/docs/playwright.seo.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

// Chỉ bài SEO. Khác `playwright.config.ts`: không dựng API ở máy (wrangler dev + seed) vì bài này
// chỉ đọc HTML tĩnh, và chạy trên bản BUILD mới dựng — giống e2e của website.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'seo.spec.ts',
  timeout: 180_000,
  use: { baseURL: 'http://localhost:4324', trace: 'retain-on-failure' },
  webServer: {
    // Cổng 4324 riêng: `reuseExistingServer` chỉ nhìn cổng, dùng chung 4321 với `pnpm dev` là kiểm
    // nhầm dev server.
    command: 'pnpm build && pnpm exec astro preview --port 4324',
    url: 'http://localhost:4324/',
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      // Astro 7 tự chạy nền khi nhận diện agent; Playwright cần server ở tiền cảnh.
      ASTRO_PREVIEW_BACKGROUND: '0',
      CLAUDECODE: '',
    },
  },
});
```

Trong `apps/docs/package.json`, thêm vào `scripts` ngay sau `"e2e": "playwright test",`:

```json
    "e2e:seo": "playwright test -c playwright.seo.config.ts",
```

- [x] **Step 2: Viết bài e2e**

`apps/docs/e2e/seo.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

const DOCS = 'https://mapslibvn-docs.pages.dev';

test('mọi trang trong sitemap đạt chuẩn SEO', async ({ page, request }) => {
  const xml = await (await request.get('/sitemap-0.xml')).text();
  const paths = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1] ?? '').pathname);
  expect(paths.length).toBeGreaterThanOrEqual(19);

  const daThay = new Map<string, string>();
  for (const path of paths) {
    // Astro preview không đổi /playground thành playground.html như Cloudflare Pages.
    const res = await page.goto(path === '/playground' ? '/playground.html' : path);
    expect(res?.status(), path).toBe(200);
    await expect(page.locator('h1'), path).toHaveCount(1);

    const title = await page.title();
    expect(title.length, `${path}: "${title}"`).toBeGreaterThanOrEqual(20);
    expect(title.length, `${path}: "${title}"`).toBeLessThanOrEqual(60);
    expect(title, path).not.toContain('| MapsLibVN');
    expect(daThay.get(title), `${path} trùng title với ${daThay.get(title)}`).toBeUndefined();
    daThay.set(title, path);

    const desc = await page.locator('meta[name="description"]').getAttribute('content');
    expect(desc?.length ?? 0, `${path}: "${desc}"`).toBeGreaterThanOrEqual(120);
    expect(desc?.length ?? 0, `${path}: "${desc}"`).toBeLessThanOrEqual(160);

    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical, path).toBe(`${DOCS}${path}`);

    const og = await page.locator('meta[property="og:image"]').getAttribute('content');
    expect(og, path).toBeTruthy();
    const anh = await request.get(new URL(og ?? '').pathname);
    expect(anh.status(), `${path}: og:image`).toBe(200);

    const khoi = await page.locator('script[type="application/ld+json"]').allTextContents();
    if (path !== '/playground') expect(khoi.length, path).toBeGreaterThan(0);
    for (const ld of khoi) {
      expect((JSON.parse(ld) as Record<string, unknown>)['@context'], path).toBe(
        'https://schema.org',
      );
    }
  }
});

test('robots, llms và các trang noindex', async ({ page, request }) => {
  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toContain('Content-Signal: search=yes, ai-input=yes, ai-train=yes');
  expect(robots).toContain(`Sitemap: ${DOCS}/sitemap-index.xml`);

  for (const tep of [
    '/llms.txt',
    '/llms-full.txt',
    '/llms-small.txt',
    '/_llms-txt/getting-started.txt',
  ]) {
    const res = await request.get(tep);
    expect(res.status(), tep).toBe(200);
    const noiDung = await res.text();
    expect(noiDung, tep).not.toMatch(/mlv_live_[0-9A-Za-z]{24}/);
    expect(noiDung, tep).not.toMatch(/tự host|self-host/i);
  }
  const muc = await (await request.get('/llms.txt')).text();
  expect(muc.startsWith('# MapsLibVN')).toBe(true);
  expect(muc).toContain(`${DOCS}/llms-full.txt`);

  for (const path of ['/thong-bao-ben-thu-ba/', '/react-demo/']) {
    await page.goto(path);
    await expect(page.locator('meta[name="robots"]'), path).toHaveAttribute('content', 'noindex');
  }
});

test('footer mọi trang có link về website', async ({ page }) => {
  for (const path of ['/', '/api/']) {
    await page.goto(path);
    await expect(
      page.locator('.lien-ket-site a[href="https://mapslibvn.pages.dev/bang-gia/"]'),
      path,
    ).toHaveCount(1);
  }
});
```

- [x] **Step 3: Chạy**

Run: `pnpm --filter @mapslibvn/docs e2e:seo`
Expected: 3/3 xanh. Bài đầu đỏ ở trang nào thì sửa đúng trang đó (thường là description hay title), không nới ngưỡng.

- [x] **Step 4: Lint, typecheck, commit**

Run: `pnpm exec biome check --write apps/docs/playwright.seo.config.ts apps/docs/e2e/seo.spec.ts && pnpm --filter @mapslibvn/docs typecheck`

```bash
git add apps/docs/playwright.seo.config.ts apps/docs/e2e/seo.spec.ts apps/docs/package.json
git commit -m "test(docs): e2e SEO trên bản build — mọi trang trong sitemap, robots, llms, noindex, footer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Mã xác thực Search Console cho docs

**Files:**
- Modify: `apps/docs/astro.config.mjs`

- [x] **Step 1: In thẻ khi hằng có giá trị**

Trong `apps/docs/astro.config.mjs`, trong mảng `head` của `starlight({ … })`, thêm sau phần tử `{ tag: 'script', content: … }` hiện có:

```js
        // Xác thực Google Search Console (spec SEO-AI mục 8). Hằng rỗng thì không in thẻ nào.
        ...(GOOGLE_SITE_VERIFICATION
          ? [
              {
                tag: 'meta',
                attrs: { name: 'google-site-verification', content: GOOGLE_SITE_VERIFICATION },
              },
            ]
          : []),
```

- [x] **Step 2: Kiểm cả hai nhánh**

Run: `pnpm --filter @mapslibvn/docs build && grep -c 'google-site-verification' apps/docs/dist/index.html`
Expected: `0`.

Tạm đặt `GOOGLE_SITE_VERIFICATION = 'thu-nghiem'` trong `apps/docs/docs.config.mjs`, build lại, `grep -o '<meta name="google-site-verification"[^>]*>' apps/docs/dist/index.html` phải ra `content="thu-nghiem"`. Hoàn tác về `''` bằng `git checkout -- apps/docs/docs.config.mjs`.

Làm tương tự cho site: tạm đặt hằng trong `apps/site/site.config.mjs`, `pnpm --filter @mapslibvn/site build`, grep `apps/site/dist/index.html`, rồi `git checkout -- apps/site/site.config.mjs`.

- [x] **Step 3: Lint và commit**

Run: `pnpm exec biome check --write apps/docs/astro.config.mjs && pnpm --filter @mapslibvn/docs typecheck`

```bash
git add apps/docs/astro.config.mjs
git commit -m "feat(docs): chỗ cắm mã xác thực Google Search Console

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Script IndexNow và tệp khoá

**Files:**
- Create: `scripts/indexnow.mjs`, `scripts/indexnow.test.mjs`, `apps/site/public/c1da44e6cf8707383215e23e4fc36e9e.txt`, `apps/docs/public/c1da44e6cf8707383215e23e4fc36e9e.txt`

- [x] **Step 1: Tệp khoá (không có dấu xuống dòng cuối)**

Run:

```bash
printf '%s' c1da44e6cf8707383215e23e4fc36e9e > apps/site/public/c1da44e6cf8707383215e23e4fc36e9e.txt
printf '%s' c1da44e6cf8707383215e23e4fc36e9e > apps/docs/public/c1da44e6cf8707383215e23e4fc36e9e.txt
```

- [x] **Step 2: Viết test đỏ**

`scripts/indexnow.test.mjs`:

```js
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  chuTrongMain,
  lapPayload,
  main,
  tepChoUrl,
  timKhoa,
  urlTrongSitemap,
} from './indexnow.mjs';

const SITE = 'https://vi-du.test';
const KHOA = '0123456789abcdef0123456789abcdef';

/** @typedef {(url: string, init?: RequestInit) => Promise<Response>} HamFetch */

/**
 * fetch giả: tra URL trong bảng; thiếu thì 404.
 * @param {Record<string, string>} bang
 * @returns {HamFetch}
 */
const fetchGia = (bang) => async (url) => {
  const noiDung = bang[url];
  return noiDung === undefined
    ? new Response('', { status: 404 })
    : new Response(noiDung, { status: 200 });
};

/** @type {HamFetch} */
const matMang = async () => {
  throw new TypeError('fetch failed');
};

/** HTML có tên asset ngẫu nhiên như sau mỗi lần build. @param {string} chu */
const html = (chu) =>
  `<!doctype html><html><head><link rel="stylesheet" href="/_astro/a.${Math.random()}.css"></head><body><nav>Menu</nav><main><h1>${chu}</h1><script src="/_astro/x.${Math.random()}.js"></script></main></body></html>`;

/** @param {string[]} duong */
const sitemap = (duong) =>
  `<?xml version="1.0"?><urlset>${duong.map((d) => `<url><loc>${SITE}${d}</loc></url>`).join('')}</urlset>`;

const indexSong = `<sitemapindex><sitemap><loc>${SITE}/sitemap-0.xml</loc></sitemap></sitemapindex>`;

/**
 * Dựng dist tạm: tệp khoá, sitemap-0.xml và HTML cho từng đường dẫn.
 * @param {Record<string, string>} trang đường dẫn → chữ của h1
 */
function distTam(trang) {
  const dist = mkdtempSync(join(tmpdir(), 'mlv-indexnow-'));
  writeFileSync(join(dist, `${KHOA}.txt`), KHOA);
  writeFileSync(join(dist, 'sitemap-index.xml'), '<sitemapindex></sitemapindex>');
  writeFileSync(join(dist, 'sitemap-0.xml'), sitemap(Object.keys(trang)));
  for (const [duong, chu] of Object.entries(trang)) {
    const tep = tepChoUrl(dist, `${SITE}${duong}`);
    mkdirSync(dirname(tep), { recursive: true });
    writeFileSync(tep, html(chu));
  }
  return dist;
}

const tepTam = () => join(mkdtempSync(join(tmpdir(), 'mlv-out-')), 'payload.json');

describe('chuTrongMain', () => {
  it('chỉ lấy chữ trong <main>, bỏ script và thẻ — đổi tên asset không tính là trang đổi', () => {
    expect(chuTrongMain(html('Xin chào'))).toBe('Xin chào');
    expect(chuTrongMain(html('Xin chào'))).toBe(chuTrongMain(html('Xin chào')));
  });

  it('trang không có <main> thì lấy <body>', () => {
    expect(chuTrongMain('<html><body><h1>Playground</h1>\n  <p>Thử</p></body></html>')).toBe(
      'Playground Thử',
    );
  });
});

describe('tepChoUrl', () => {
  it('URL có gạch cuối là index.html trong thư mục; không gạch cuối là tệp .html', () => {
    expect(tepChoUrl('/d', `${SITE}/`)).toBe(join('/d', 'index.html'));
    expect(tepChoUrl('/d', `${SITE}/bang-gia/`)).toBe(join('/d', 'bang-gia', 'index.html'));
    expect(tepChoUrl('/d', `${SITE}/playground`)).toBe(join('/d', 'playground.html'));
  });
});

describe('urlTrongSitemap', () => {
  it('đọc mọi <loc>', () => {
    expect(urlTrongSitemap(sitemap(['/', '/a/']))).toEqual([`${SITE}/`, `${SITE}/a/`]);
  });
});

describe('timKhoa', () => {
  it('khoá là tệp 32 hex có nội dung trùng tên', () => {
    expect(timKhoa(distTam({}))).toBe(KHOA);
  });
});

describe('lapPayload', () => {
  it('chỉ gồm URL mới, URL đổi chữ và URL bị bỏ khỏi sitemap', async () => {
    const dist = distTam({ '/': 'Trang chủ', '/doi/': 'Bản mới', '/moi/': 'Trang mới' });
    const payload = await lapPayload({
      dist,
      site: SITE,
      fetchFn: fetchGia({
        [`${SITE}/sitemap-index.xml`]: indexSong,
        [`${SITE}/sitemap-0.xml`]: sitemap(['/', '/doi/', '/bo/']),
        [`${SITE}/`]: html('Trang chủ'),
        [`${SITE}/doi/`]: html('Bản cũ'),
      }),
    });
    expect(payload).toEqual({
      host: 'vi-du.test',
      key: KHOA,
      keyLocation: `${SITE}/${KHOA}.txt`,
      urlList: [`${SITE}/doi/`, `${SITE}/moi/`, `${SITE}/bo/`],
    });
  });

  it('mất mạng thì coi mọi URL là đổi — báo thừa còn hơn bỏ sót', async () => {
    const payload = await lapPayload({
      dist: distTam({ '/': 'A', '/b/': 'B' }),
      site: SITE,
      fetchFn: matMang,
    });
    expect(payload.urlList).toEqual([`${SITE}/`, `${SITE}/b/`]);
  });
});

describe('main', () => {
  it('truoc rồi gui: POST đúng payload lên api.indexnow.org, thoát 0', async () => {
    const dist = distTam({ '/': 'Mới' });
    const out = tepTam();
    /** @type {{ url: string, body: string }[]} */
    const daGui = [];
    /** @type {HamFetch} */
    const fetchFn = async (url, init) => {
      if (init?.method === 'POST') {
        daGui.push({ url, body: String(init.body) });
        return new Response('', { status: 202 });
      }
      return new Response('', { status: 404 });
    };
    expect(await main(['truoc', '--dist', dist, '--site', SITE, '--out', out], fetchFn)).toBe(0);
    expect(await main(['gui', '--site', SITE, '--list', out], fetchFn)).toBe(0);
    expect(daGui).toHaveLength(1);
    expect(daGui[0]?.url).toBe('https://api.indexnow.org/indexnow');
    expect(JSON.parse(daGui[0]?.body ?? '{}').urlList).toEqual([`${SITE}/`]);
  });

  it('dist hỏng hay IndexNow trả 403 vẫn thoát 0 — không bao giờ làm đỏ deploy', async () => {
    const out = tepTam();
    expect(
      await main(['truoc', '--dist', '/khong/co/thu/muc', '--site', SITE, '--out', out], matMang),
    ).toBe(0);
    expect(await main(['gui', '--site', SITE, '--list', out], matMang)).toBe(0);

    const out2 = tepTam();
    await main(['truoc', '--dist', distTam({ '/': 'X' }), '--site', SITE, '--out', out2], matMang);
    expect(
      await main(
        ['gui', '--site', SITE, '--list', out2],
        async () => new Response('', { status: 403 }),
      ),
    ).toBe(0);
  });

  it('không URL nào đổi thì không gửi gì', async () => {
    const dist = distTam({ '/': 'Giống' });
    const out = tepTam();
    let soLanPost = 0;
    /** @type {HamFetch} */
    const fetchFn = async (url, init) => {
      if (init?.method === 'POST') {
        soLanPost += 1;
        return new Response('', { status: 200 });
      }
      if (url === `${SITE}/sitemap-index.xml`) return new Response(indexSong);
      if (url === `${SITE}/sitemap-0.xml`) return new Response(sitemap(['/']));
      return new Response(html('Giống'));
    };
    await main(['truoc', '--dist', dist, '--site', SITE, '--out', out], fetchFn);
    await main(['gui', '--site', SITE, '--list', out], fetchFn);
    expect(soLanPost).toBe(0);
  });
});

describe('tệp khoá IndexNow trong hai site', () => {
  it('mỗi site đúng một tệp khoá, nội dung trùng tên, hai site cùng khoá', () => {
    const khoa = ['apps/site/public', 'apps/docs/public'].map((thuMuc) => {
      const tep = readdirSync(thuMuc).filter((ten) => /^[0-9a-f]{32}\.txt$/.test(ten));
      expect(tep, thuMuc).toHaveLength(1);
      const ten = String(tep[0]).slice(0, 32);
      expect(readFileSync(join(thuMuc, `${ten}.txt`), 'utf8').trim(), thuMuc).toBe(ten);
      return ten;
    });
    expect(khoa[0]).toBe(khoa[1]);
  });
});
```

Run: `pnpm exec vitest run scripts/indexnow.test.mjs`
Expected: FAIL — không tìm thấy `./indexnow.mjs` (bài tệp khoá đã xanh sau Step 1).

- [x] **Step 3: Viết `indexnow.mjs`**

`scripts/indexnow.mjs`:

```js
#!/usr/bin/env node
// Báo IndexNow (Bing, Yandex, Naver, Seznam) những URL vừa đổi, quanh mỗi lần deploy:
//   node scripts/indexnow.mjs truoc --dist apps/site/dist --site https://mapslibvn.pages.dev
//   node scripts/indexnow.mjs gui --site https://mapslibvn.pages.dev
// `truoc` chạy SAU build, TRƯỚC deploy: so chữ trong <main> của bản mới với bản ĐANG chạy, ghi
// payload ra tệp tạm (--out, mặc định trong thư mục tạm của máy). `gui` chạy SAU deploy: POST payload
// đó (--list). Google không nhận IndexNow — với Google là sitemap và Search Console (spec SEO-AI
// mục 7–8). KHÔNG BAO GIỜ thoát khác 0: IndexNow hỏng thì deploy vẫn phải xanh, lỗi chỉ in
// ::warning:: để thấy trong log GitHub Actions.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const API = 'https://api.indexnow.org/indexnow';
const SONG_SONG = 4;
const CHO_MS = 10_000;

/**
 * @typedef {{ host: string, key: string, keyLocation: string, urlList: string[] }} Payload
 * @typedef {(url: string, init?: RequestInit) => Promise<Response>} HamFetch
 */

/**
 * Chữ nhìn thấy trong <main> (thiếu thì <body>), bỏ script/style/thẻ, gộp khoảng trắng. So chữ
 * chứ không so HTML thô: tên tệp asset đổi sau mỗi lần build không được tính là trang đổi.
 * @param {string} html
 * @returns {string}
 */
export function chuTrongMain(html) {
  const khoi =
    /<main[\s>][\s\S]*<\/main>/i.exec(html)?.[0] ??
    /<body[\s>][\s\S]*<\/body>/i.exec(html)?.[0] ??
    html;
  return khoi
    .replace(/<(script|style)[\s>][\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} xml
 * @returns {string[]}
 */
export function urlTrongSitemap(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].flatMap((m) => (m[1] ? [m[1].trim()] : []));
}

/**
 * URL → tệp HTML trong dist: `/x/` là `x/index.html`; `/playground` là tệp tĩnh `playground.html`.
 * @param {string} dist
 * @param {string} url
 * @returns {string}
 */
export function tepChoUrl(dist, url) {
  const duong = decodeURIComponent(new URL(url).pathname);
  return duong.endsWith('/') ? join(dist, duong, 'index.html') : join(dist, `${duong}.html`);
}

/**
 * Khoá IndexNow là TÊN và NỘI DUNG của một tệp `<32 hex>.txt` ở gốc dist — tệp là nguồn sự thật
 * duy nhất, không có hằng nào phải giữ khớp.
 * @param {string} dist
 * @returns {string | undefined}
 */
export function timKhoa(dist) {
  for (const ten of readdirSync(dist)) {
    const khop = /^([0-9a-f]{32})\.txt$/.exec(ten);
    if (khop?.[1] && readFileSync(join(dist, ten), 'utf8').trim() === khop[1]) return khop[1];
  }
  return undefined;
}

/**
 * @param {string} dist
 * @returns {string[]}
 */
function urlTrongDist(dist) {
  return readdirSync(dist)
    .filter((ten) => /^sitemap-\d+\.xml$/.test(ten))
    .flatMap((ten) => urlTrongSitemap(readFileSync(join(dist, ten), 'utf8')));
}

/**
 * @param {HamFetch} fetchFn
 * @param {string} url
 * @returns {Promise<string | undefined>} undefined = lỗi mạng hoặc không phải 200
 */
async function taiChu(fetchFn, url) {
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(CHO_MS) });
    return res.status === 200 ? await res.text() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * URL trong sitemap đang chạy. Lỗi mạng → [] (coi như mọi URL đều mới).
 * @param {HamFetch} fetchFn
 * @param {string} site
 * @returns {Promise<string[]>}
 */
async function urlDangChay(fetchFn, site) {
  const index = await taiChu(fetchFn, `${site}/sitemap-index.xml`);
  if (!index) return [];
  const con = await Promise.all(urlTrongSitemap(index).map((url) => taiChu(fetchFn, url)));
  return con.flatMap((xml) => (xml ? urlTrongSitemap(xml) : []));
}

/**
 * Chạy `viec` cho từng phần tử, tối đa `n` việc cùng lúc; kết quả giữ đúng thứ tự đầu vào.
 * @template T, R
 * @param {readonly T[]} ds
 * @param {number} n
 * @param {(x: T) => Promise<R>} viec
 * @returns {Promise<R[]>}
 */
async function chayGioiHan(ds, n, viec) {
  /** @type {R[]} */
  const kq = new Array(ds.length);
  let tiep = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, ds.length) }, async () => {
      while (tiep < ds.length) {
        const i = tiep++;
        kq[i] = await viec(/** @type {T} */ (ds[i]));
      }
    }),
  );
  return kq;
}

/**
 * Danh sách cần báo = URL mới + URL chữ đổi + URL bị bỏ khỏi sitemap. Không so được (mất mạng,
 * bản đang chạy không phải 200) thì coi là đổi: báo thừa còn hơn bỏ sót.
 * @param {{ dist: string, site: string, fetchFn: HamFetch }} vao
 * @returns {Promise<Payload>}
 */
export async function lapPayload({ dist, site, fetchFn }) {
  const key = timKhoa(dist);
  if (!key) throw new Error(`không thấy tệp khoá <32 hex>.txt trong ${dist}`);
  const moi = urlTrongDist(dist);
  const cu = await urlDangChay(fetchFn, site);
  const doi = await chayGioiHan(moi, SONG_SONG, async (url) => {
    const dang = await taiChu(fetchFn, url);
    const tep = tepChoUrl(dist, url);
    if (dang === undefined || !existsSync(tep)) return url;
    return chuTrongMain(dang) === chuTrongMain(readFileSync(tep, 'utf8')) ? undefined : url;
  });
  const boDi = cu.filter((url) => !moi.includes(url));
  const urlList = [...new Set([...doi.filter((url) => url !== undefined), ...boDi])];
  return { host: new URL(site).host, key, keyLocation: `${site}/${key}.txt`, urlList };
}

/**
 * @param {Payload} payload
 * @param {HamFetch} fetchFn
 * @returns {Promise<number>} mã HTTP; 0 nếu lỗi mạng
 */
async function guiPayload(payload, fetchFn) {
  try {
    const res = await fetchFn(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(CHO_MS),
    });
    return res.status;
  } catch {
    return 0;
  }
}

/**
 * @param {string[]} argv
 * @param {string} ten
 * @returns {string | undefined}
 */
function thamSo(argv, ten) {
  const i = argv.indexOf(ten);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** @param {string} tin */
const canhBao = (tin) => console.log(`::warning::IndexNow: ${tin}`);

/**
 * @param {string[]} argv
 * @param {HamFetch} [fetchFn]
 * @returns {Promise<number>} luôn 0
 */
export async function main(argv, fetchFn = fetch) {
  const [lenh] = argv;
  const site = thamSo(argv, '--site')?.replace(/\/+$/, '');
  if (!site || (lenh !== 'truoc' && lenh !== 'gui')) {
    canhBao('dùng: truoc --dist <thư mục> --site <URL> | gui --site <URL>');
    return 0;
  }
  const macDinh = join(tmpdir(), `indexnow-${new URL(site).host}.json`);

  if (lenh === 'truoc') {
    const out = thamSo(argv, '--out') ?? macDinh;
    try {
      const dist = thamSo(argv, '--dist');
      if (!dist) throw new Error('thiếu --dist');
      const payload = await lapPayload({ dist, site, fetchFn });
      writeFileSync(out, JSON.stringify(payload));
      console.log(`IndexNow: ${payload.urlList.length} URL sẽ báo sau deploy`);
      for (const url of payload.urlList) console.log(`  ${url}`);
    } catch (loi) {
      canhBao(`không lập được danh sách (${loi instanceof Error ? loi.message : loi}) — bỏ lần này`);
      // Ghi đè bằng null để `gui` không gửi nhầm danh sách cũ còn sót trong thư mục tạm.
      writeFileSync(out, 'null');
    }
    return 0;
  }

  const list = thamSo(argv, '--list') ?? macDinh;
  if (!existsSync(list)) {
    canhBao(`không có ${list} — bước truoc chưa chạy?`);
    return 0;
  }
  const payload = /** @type {Payload | null} */ (JSON.parse(readFileSync(list, 'utf8')));
  if (!payload || payload.urlList.length === 0) {
    console.log('IndexNow: không có URL đổi, không gửi.');
    return 0;
  }
  const ma = await guiPayload(payload, fetchFn);
  if (ma === 200 || ma === 202) {
    console.log(`IndexNow: đã báo ${payload.urlList.length} URL (HTTP ${ma}).`);
  } else {
    canhBao(`HTTP ${ma || 'lỗi mạng'} khi gửi ${payload.urlList.length} URL`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)));
}
```

- [x] **Step 4: Chạy test, typecheck**

Run: `pnpm exec vitest run scripts/indexnow.test.mjs`
Expected: PASS 11/11.

Run: `pnpm exec tsc -p tsconfig.scripts.json`
Expected: không lỗi (script và test đều nằm trong `checkJs`).

- [x] **Step 5: Chạy `truoc` thật với bản build hiện có (không gửi)**

Run: `pnpm --filter @mapslibvn/site build && node scripts/indexnow.mjs truoc --dist apps/site/dist --site https://mapslibvn.pages.dev --out "${TMPDIR:-/tmp}/indexnow-thu.json" && cat "${TMPDIR:-/tmp}/indexnow-thu.json"`
Expected: in số URL đổi so với production hiện tại (các trang có chữ `<main>` khác, ví dụ không trang nào nếu chỉ `<head>` đổi); payload có `"key":"c1da44e6cf8707383215e23e4fc36e9e"`. KHÔNG chạy `gui` ở bước này — tệp khoá chưa có trên production nên IndexNow sẽ trả 403.

- [x] **Step 6: Lint và commit**

Run: `pnpm exec biome check --write scripts/indexnow.mjs scripts/indexnow.test.mjs`

```bash
git add scripts/indexnow.mjs scripts/indexnow.test.mjs apps/site/public/c1da44e6cf8707383215e23e4fc36e9e.txt apps/docs/public/c1da44e6cf8707383215e23e4fc36e9e.txt
git commit -m "feat(scripts): IndexNow báo URL có chữ đổi quanh mỗi lần deploy, không bao giờ làm đỏ deploy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Gắn IndexNow vào CI và lệnh deploy tay

**Files:**
- Modify: `.github/workflows/deploy-site.yml`, `.github/workflows/deploy-docs.yml`, `package.json`, `scripts/indexnow.test.mjs`

- [x] **Step 1: Viết test đỏ khoá thứ tự bước**

Thêm vào cuối `scripts/indexnow.test.mjs`:

```js
describe('IndexNow nằm đúng chỗ trong quy trình deploy', () => {
  it.each([
    ['.github/workflows/deploy-site.yml', 'https://mapslibvn.pages.dev', 'apps/site/dist'],
    ['.github/workflows/deploy-docs.yml', 'https://mapslibvn-docs.pages.dev', 'apps/docs/dist'],
  ])('%s: truoc giữa build và deploy, gui sau deploy', (tep, site, dist) => {
    const yml = readFileSync(tep, 'utf8');
    const truoc = yml.indexOf(`node scripts/indexnow.mjs truoc --dist ${dist} --site ${site}`);
    const deploy = yml.indexOf('wrangler pages deploy');
    const gui = yml.indexOf(`node scripts/indexnow.mjs gui --site ${site}`);
    expect(truoc, 'thiếu bước truoc').toBeGreaterThan(0);
    expect(truoc).toBeLessThan(deploy);
    expect(gui).toBeGreaterThan(deploy);
  });

  it('deploy-docs kéo đủ lịch sử git — thiếu thì mọi trang mang cùng một ngày', () => {
    expect(readFileSync('.github/workflows/deploy-docs.yml', 'utf8')).toContain('fetch-depth: 0');
  });

  it('lệnh deploy tay cũng báo IndexNow', () => {
    const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
    for (const lenh of ['deploy:site', 'deploy:docs']) {
      expect(scripts[lenh], lenh).toMatch(/indexnow\.mjs truoc .*wrangler pages deploy.*indexnow\.mjs gui/);
    }
  });
});
```

Run: `pnpm exec vitest run scripts/indexnow.test.mjs`
Expected: FAIL ba bài (workflow và `package.json` chưa gắn); bài `fetch-depth` đã xanh từ Task 10.

- [x] **Step 2: `deploy-site.yml`**

Trong `.github/workflows/deploy-site.yml`, thay khối từ `- run: pnpm --filter @mapslibvn/site build` tới hết bước deploy bằng:

```yaml
      - run: pnpm --filter @mapslibvn/site build
      # IndexNow (spec SEO-AI mục 7): so chữ bản vừa build với bản ĐANG chạy, nên phải chạy trước khi
      # deploy đè lên. Bước này và bước gui không bao giờ thoát khác 0.
      - run: node scripts/indexnow.mjs truoc --dist apps/site/dist --site https://mapslibvn.pages.dev
      # Project Pages `mapslibvn` đã được tạo với production branch `main`.
      - run: pnpm --filter @mapslibvn/site exec wrangler pages deploy dist --project-name mapslibvn
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      - run: node scripts/indexnow.mjs gui --site https://mapslibvn.pages.dev
```

- [x] **Step 3: `deploy-docs.yml`**

Trong `.github/workflows/deploy-docs.yml`, ngay trước bước `- run: pnpm --filter @mapslibvn/docs exec wrangler pages deploy dist --project-name mapslibvn-docs` thêm:

```yaml
      # IndexNow (spec SEO-AI mục 7): so với bản ĐANG chạy trước khi deploy đè lên; không bao giờ đỏ.
      - run: node scripts/indexnow.mjs truoc --dist apps/docs/dist --site https://mapslibvn-docs.pages.dev
```

và cuối job (sau bước deploy) thêm:

```yaml
      - run: node scripts/indexnow.mjs gui --site https://mapslibvn-docs.pages.dev
```

- [x] **Step 4: Lệnh deploy tay**

Trong `package.json` gốc, thay hai dòng `deploy:docs` và `deploy:site` bằng:

```json
    "deploy:docs": "pnpm build && node scripts/indexnow.mjs truoc --dist apps/docs/dist --site https://mapslibvn-docs.pages.dev && pnpm --filter @mapslibvn/docs exec wrangler pages deploy dist --project-name mapslibvn-docs && node scripts/indexnow.mjs gui --site https://mapslibvn-docs.pages.dev",
    "deploy:site": "pnpm --filter @mapslibvn/site build && node scripts/indexnow.mjs truoc --dist apps/site/dist --site https://mapslibvn.pages.dev && pnpm --filter @mapslibvn/site exec wrangler pages deploy dist --project-name mapslibvn && node scripts/indexnow.mjs gui --site https://mapslibvn.pages.dev",
```

Cập nhật luôn bảng lệnh trong `Pnpm_Scripts_Guide.md` (PHONG thêm ngày 25/09, commit `7b349c2`) — thay hai dòng `deploy:docs` và `deploy:site` bằng:

```md
| `pnpm deploy:docs` | 🔴 | Build rồi đẩy `apps/docs` lên Cloudflare Pages `mapslibvn-docs`, rồi báo IndexNow những URL có chữ đổi. (CI đã tự deploy từ `main`.) |
| `pnpm deploy:site` | 🔴 | Build rồi đẩy website `apps/site` lên Cloudflare Pages `mapslibvn`, rồi báo IndexNow những URL có chữ đổi. |
```

- [x] **Step 5: Chạy lại, thấy xanh**

Run: `pnpm exec vitest run scripts/indexnow.test.mjs`
Expected: PASS toàn bộ.

- [x] **Step 6: Lint và commit**

Run: `pnpm exec biome check --write scripts/indexnow.test.mjs`

```bash
git add .github/workflows/deploy-site.yml .github/workflows/deploy-docs.yml package.json scripts/indexnow.test.mjs Pnpm_Scripts_Guide.md
git commit -m "ci: báo IndexNow quanh bước deploy site và docs, cả khi deploy tay

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Metadata npm và dòng link trong README gói

**Files:**
- Modify: `packages/{core,web,react,react-native}/package.json`, `packages/{core,web,react,react-native}/README.md`, `scripts/lib/package-release.test.mjs`

- [x] **Step 1: Viết test đỏ**

Trong `scripts/lib/package-release.test.mjs`, thêm vào trong `describe('npm release contract', …)`, trước dấu `});` cuối cùng:

```js
  it('metadata npm dẫn về website và tìm được bằng từ khoá (spec SEO-AI 25/09/2026 mục 9)', () => {
    const CHUNG = [
      'mapslibvn',
      'vietnam',
      'viet-nam',
      'vietnam-map',
      'ban-do',
      'bản đồ',
      'map',
      'maps',
      'geocoding',
      'autocomplete',
      'places',
      'poi',
      'directions',
      'routing',
      'openstreetmap',
    ];
    for (const dir of SDK_PACKAGE_DIRS) {
      const manifest = readJson(`${dir}/package.json`);
      expect(manifest.homepage, dir).toBe('https://mapslibvn.pages.dev/');
      for (const tu of CHUNG) expect(manifest.keywords, `${dir} thiếu "${tu}"`).toContain(tu);
      // Không dẫn khách về repo GitHub: PHONG không công bố hướng dẫn tự host (23/09/2026).
      expect(manifest.repository, dir).toBeUndefined();
      expect(manifest.bugs, dir).toBeUndefined();
      expect(readFileSync(`${dir}/README.md`, 'utf8'), dir).toContain(
        '[Website](https://mapslibvn.pages.dev/)',
      );
    }
  });
```

Run: `pnpm exec vitest run scripts/lib/package-release.test.mjs`
Expected: FAIL — `homepage` là undefined.

- [x] **Step 2: Sửa bốn `package.json` bằng script (giữ nguyên định dạng)**

Bốn tệp hiện đúng định dạng `JSON.stringify(…, null, 2)` + xuống dòng cuối (đã kiểm 25/09), nên ghi lại bằng Node chỉ làm diff chứa phần thêm. Chạy từ gốc repo — script đổi `description` và chèn `keywords`, `homepage` ngay sau nó, không đụng khoá nào khác:

```bash
node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
const CHUNG = ["mapslibvn", "vietnam", "viet-nam", "vietnam-map", "ban-do", "bản đồ", "map", "maps", "geocoding", "autocomplete", "places", "poi", "directions", "routing", "openstreetmap"];
const GOI = {
  core: {
    moTa: "Client TypeScript cho API bản đồ Việt Nam MapsLibVN: autocomplete, tìm kiếm địa điểm, geocode, dẫn đường, ma trận khoảng cách và chuỗi ghi nguồn (Vietnam maps API client)",
    rieng: ["api-client", "typescript", "reverse-geocoding", "distance-matrix"],
  },
  web: {
    moTa: "Bản đồ Việt Nam cho web: nhúng bản đồ MapLibre với tiles PMTiles, marker, ô tìm kiếm địa điểm và dẫn đường từng bước (Vietnam map SDK for web)",
    rieng: ["maplibre", "maplibre-gl", "pmtiles", "web-map"],
  },
  react: {
    moTa: "Bản đồ Việt Nam cho React: <MapsLibVNMap>, <Marker>, useMap, usePlaces (Vietnam map for React)",
    rieng: ["react", "react-map", "maplibre"],
  },
  "react-native": {
    moTa: "Bản đồ Việt Nam cho React Native (iOS, Android): <MapsLibVNMap>, <Marker>, useMap, usePlaces, dẫn đường giọng Việt, la bàn — bọc @maplibre/maplibre-react-native (Vietnam map for React Native)",
    rieng: ["react-native", "expo", "ios", "android", "navigation", "turn-by-turn", "maplibre"],
  },
};
for (const [ten, { moTa, rieng }] of Object.entries(GOI)) {
  const tep = `packages/${ten}/package.json`;
  const cu = JSON.parse(readFileSync(tep, "utf8"));
  const moi = {};
  for (const [khoa, giaTri] of Object.entries(cu)) {
    if (khoa === "keywords" || khoa === "homepage") continue;
    moi[khoa] = khoa === "description" ? moTa : giaTri;
    if (khoa === "description") {
      moi.keywords = [...CHUNG, ...rieng];
      moi.homepage = "https://mapslibvn.pages.dev/";
    }
  }
  writeFileSync(tep, `${JSON.stringify(moi, null, 2)}\n`);
  console.log(`✓ ${tep}`);
}
'
```

Run: `git diff --stat packages/*/package.json && git diff packages/web/package.json`
Expected: mỗi tệp chỉ đổi dòng `description` và thêm khối `keywords` + dòng `homepage`; không dòng nào khác đổi.

- [x] **Step 3: Dòng link trong README (tiếng Anh, khớp ngôn ngữ README)**

Trong mỗi README, chèn một dòng trống rồi dòng dưới đây NGAY SAU dòng badge cuối cùng (trước đoạn chữ đậm giới thiệu):

- `packages/core/README.md`: `**[Website](https://mapslibvn.pages.dev/) · [Pricing](https://mapslibvn.pages.dev/bang-gia/) · [Docs](https://mapslibvn-docs.pages.dev/sdk/)**`
- `packages/web/README.md`: `**[Website](https://mapslibvn.pages.dev/) · [Pricing](https://mapslibvn.pages.dev/bang-gia/) · [Docs](https://mapslibvn-docs.pages.dev/ban-do-web/)**`
- `packages/react/README.md`: `**[Website](https://mapslibvn.pages.dev/) · [Pricing](https://mapslibvn.pages.dev/bang-gia/) · [Docs](https://mapslibvn-docs.pages.dev/react/)**`
- `packages/react-native/README.md`: `**[Website](https://mapslibvn.pages.dev/) · [Pricing](https://mapslibvn.pages.dev/bang-gia/) · [Docs](https://mapslibvn-docs.pages.dev/react-native/)**`

Không ghi số phiên bản ở đâu cả (memory: badge npm đã tự động).

- [x] **Step 4: Chạy lại, thấy xanh; kiểm tarball**

Run: `pnpm exec vitest run scripts/lib/package-release.test.mjs`
Expected: PASS.

Run: `for p in core web react react-native; do (cd packages/$p && npm pack --dry-run --json 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s)[0];console.log(j.name, j.files.some(f=>f.path==='README.md'))})"); done`
Expected: bốn dòng `@mapslibvn/<gói> true`.

- [x] **Step 5: Commit**

```bash
git add packages/core/package.json packages/web/package.json packages/react/package.json packages/react-native/package.json packages/core/README.md packages/web/README.md packages/react/README.md packages/react-native/README.md scripts/lib/package-release.test.mjs
git commit -m "chore(sdk): homepage, keywords và mô tả dễ tìm cho bốn gói npm; README link về website

Có hiệu lực ở lần pnpm sdk:publish tới. Cố ý không thêm repository/bugs.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Tài liệu vận hành, cổng kiểm cuối, bàn giao

**Files:**
- Modify: `README.md`, `docs/DEVLOG.md`
- Create: `docs/evidence/seo-ai/2026-09-25-seo-ai-search.md`

- [x] **Step 1: README**

Trong `README.md`, mục "## Website quảng bá":

1. Thay đoạn

```md
Ảnh hero và bốn ảnh OG sinh bằng `node scripts/site-images.mjs` rồi commit vào repo, vì máy dựng
của Pages không chạy Playwright.
```

bằng:

```md
Ảnh hero, bốn ảnh OG của site, ảnh OG của tài liệu và logo 512×512 sinh bằng
`node scripts/site-images.mjs` (`--og`, `--og=<tên>`, `--logo`, `--hero`) rồi commit vào repo, vì
máy dựng của Pages không chạy Playwright.
```

2. Thêm ngay trước "## Phát hành toàn bộ SDK lên npm":

```md
### SEO và AI search

- `robots.txt` của site và docs cùng sinh từ `robotsTxt()` trong `@mapslibvn/catalog`, kèm
  `Content-Signal: search=yes, ai-input=yes, ai-train=yes` (PHONG cho mọi bot AI, 25/09/2026).
- `/llms.txt` của site sinh từ `TRANG`, catalog giá và bài đã duyệt. Docs có `/llms.txt`,
  `/llms-full.txt`, `/llms-small.txt` do plugin `starlight-llms-txt` sinh.
- Mỗi lần deploy (CI, hoặc `pnpm deploy:site` / `pnpm deploy:docs`), `scripts/indexnow.mjs` báo
  Bing và các máy tìm kiếm dùng IndexNow những URL có chữ đổi. Khoá là tệp `<32 hex>.txt` trong
  `public/` của hai app; IndexNow lỗi chỉ in cảnh báo, không làm đỏ deploy.
- Xác thực Google Search Console: dán mã thẻ HTML vào `GOOGLE_SITE_VERIFICATION` (site:
  `apps/site/site.config.mjs`, docs: `apps/docs/docs.config.mjs`), deploy, bấm Verify. Bing
  Webmaster dùng "Import from Google Search Console".
- e2e SEO của docs chạy riêng, không cần API ở máy: `pnpm --filter @mapslibvn/docs e2e:seo`.
```

- [x] **Step 2: Tệp chứng cứ (khung, điền sau deploy)**

`docs/evidence/seo-ai/2026-09-25-seo-ai-search.md`:

````md
# Nghiệm thu SEO và AI search — 25/09/2026

Spec `docs/superpowers/specs/2026-09-25-seo-ai-search-design.md` mục 11, plan
`docs/superpowers/plans/2026-09-25-seo-ai-search.md`. Mọi số đo trên production sau lần deploy đầu
của nhánh `seo-ai-search`.

## Máy tự đo

| # | Tiêu chí | Lệnh | Kết quả |
|---|---|---|---|
| 1 | robots hai host đúng nguyên văn | `curl -s https://mapslibvn.pages.dev/robots.txt; curl -s https://mapslibvn-docs.pages.dev/robots.txt` | |
| 2 | llms 200 + `text/plain; charset=utf-8` | `for u in https://mapslibvn.pages.dev/llms.txt https://mapslibvn-docs.pages.dev/llms.txt https://mapslibvn-docs.pages.dev/llms-full.txt https://mapslibvn-docs.pages.dev/llms-small.txt; do curl -s -o /dev/null -w "%{http_code} %{content_type} $u\n" $u; done` | |
| 3 | không còn title "X \| MapsLibVN" | `curl -s https://mapslibvn-docs.pages.dev/ \| grep -o '<title>[^<]*'` | |
| 4 | lastmod khác nhau giữa các trang docs; bài viết site có lastmod | `curl -s https://mapslibvn-docs.pages.dev/sitemap-0.xml \| grep -o '<lastmod>[^<]*' \| sort \| uniq -c`; `curl -s https://mapslibvn.pages.dev/sitemap-0.xml \| grep -o '<lastmod>[^<]*'` | |
| 5 | IndexNow 200/202, chỉ URL đổi | `gh run list --workflow "Deploy Docs" --limit 1` rồi `gh run view <id> --log \| grep IndexNow` (và Deploy Site) | |
| 5b | tệp khoá sống | `curl -s https://mapslibvn.pages.dev/c1da44e6cf8707383215e23e4fc36e9e.txt; curl -s https://mapslibvn-docs.pages.dev/c1da44e6cf8707383215e23e4fc36e9e.txt` | |
| 7 | Lighthouse SEO = 100 (trang chủ docs, `/api/`, `/tim-kiem/`) | xem Step 5 của Task 18 trong plan | |

## Việc của PHONG

| # | Việc | Ngày làm | Kết quả |
|---|---|---|---|
| 6 | Rich Results Test: `/`, `/bang-gia/`, một bài viết, `/api/` của docs | | |
| 8a | Search Console: xác thực `https://mapslibvn.pages.dev/`, gửi sitemap, Request indexing trang chủ | | |
| 8b | Search Console: xác thực `https://mapslibvn-docs.pages.dev/`, gửi sitemap | | |
| 8c | Bing Webmaster: Import from Google Search Console | | |
| 8d | Kiểm lại: trang chủ đã được lập chỉ mục (hạn 14 ngày sau 8a) | | |
````

- [x] **Step 3: DEVLOG**

Thêm vào cuối `docs/DEVLOG.md`:

```md
## 35. SEO và AI search cho website và tài liệu — 25/09/2026

Spec `2026-09-25-seo-ai-search-design.md`, plan `2026-09-25-seo-ai-search.md`, evidence
`docs/evidence/seo-ai/2026-09-25-seo-ai-search.md`. Nền SEO của site đã chắc từ 18/09; việc lần này
là lấp chỗ hổng đo được trên production: docs có title "MapsLibVN | MapsLibVN", 11/20 description
dưới 120 ký tự, không `og:image`, không JSON-LD, robots chỉ là chú thích mặc định của Cloudflare
không có `Sitemap:`; cả hai site không `lastmod`, không `llms.txt`, chưa xác thực Search Console.

**Quyết định PHONG 25/09:** giữ `pages.dev`; cho mọi bot AI kể cả huấn luyện
(`Content-Signal: search=yes, ai-input=yes, ai-train=yes`); sinh lúc build, không thêm runtime; nội
dung mới và tên miền riêng tách spec sau; npm không thêm `repository`/`bugs`.

**Cách làm:** chính sách bot một chỗ ở `@mapslibvn/catalog`; site sinh `llms.txt` từ `TRANG` +
catalog; docs chèn OG/JSON-LD qua route middleware của Starlight, `llms*.txt` qua
`starlight-llms-txt`; JSON-LD hai tên miền cùng `@id` tổ chức `https://mapslibvn.pages.dev/#organization`;
`lastmod`, `dateModified` và "Cập nhật lần cuối" cùng đọc ngày committer từ git (CI docs đổi sang
`fetch-depth: 0`); IndexNow so chữ `<main>` với bản đang chạy rồi chỉ báo URL đổi.

**Còn nợ:** việc tay của PHONG ở evidence mục "Việc của PHONG"; metadata npm chỉ lên npm ở lần
`pnpm sdk:publish` tới.
```

Nếu trong lúc làm có chỗ lệch spec thật (mục "Lệch spec có chủ ý" dưới đây hoặc phát sinh mới), thêm một mục `### Chỗ lệch spec` liệt kê đúng những gì đã xảy ra.

- [x] **Step 4: Cổng kiểm đầy đủ**

Run lần lượt, đọc kết quả thật của từng lệnh:

```bash
pnpm lint
node scripts/notices-sync.mjs --check
pnpm typecheck
pnpm exec turbo run typecheck --force --continue
pnpm test
pnpm test:site-e2e
pnpm --filter @mapslibvn/docs e2e:seo
pnpm --filter @mapslibvn/docs e2e
```

Expected: tất cả xanh; dòng tổng kết của lệnh `turbo … --force` có `Cached: 0 cached`. Lệnh docs `e2e` cuối cần API ở máy — nếu không dựng được, ghi lý do thật vào evidence, không coi là xanh.

- [x] **Step 5: Commit**

```bash
git add README.md docs/DEVLOG.md docs/evidence/seo-ai/2026-09-25-seo-ai-search.md
git commit -m "docs: DEVLOG mục 35, README vận hành SEO/AI search, khung nghiệm thu

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [x] **Step 6: Bàn giao — hỏi PHONG trước khi đụng `main`**

Dùng skill `superpowers:finishing-a-development-branch`. Hỏi PHONG: merge `seo-ai-search` vào `main` và push (CI tự deploy site + docs). Nhắc hai điều: (1) nhánh không merge thì production không có gì (memory: nhánh cache 20/09 từng mất bản sửa vì CI deploy từ `main`); (2) lần deploy đầu IndexNow sẽ báo gần như mọi trang docs vì title đổi — đúng như mong đợi.

- [x] **Step 7: Sau khi PHONG merge và CI deploy xong — nghiệm thu production**

1. Chờ `Deploy Site` và `Deploy Docs` xanh: `gh run list --limit 5`.
2. Chạy từng lệnh ở bảng "Máy tự đo" của tệp chứng cứ, dán kết quả thật vào cột "Kết quả".
3. Lighthouse SEO (tiêu chí 7), dùng Chromium của Playwright:

```bash
LH="${TMPDIR:-/tmp}/lh-docs.json"
CHROME_PATH=$(cd apps/site && node -e "console.log(require('@playwright/test').chromium.executablePath())") \
  npx -y lighthouse@12 https://mapslibvn-docs.pages.dev/ --only-categories=seo --quiet \
  --chrome-flags="--headless=new" --output=json --output-path="$LH" \
  && node -e "console.log(require(process.argv[1]).categories.seo.score)" "$LH"
```

Làm lại với `/api/` và `/tim-kiem/`. Expected: `1` (= 100). Không chạy được Lighthouse thì ghi rõ lý do và nhờ PHONG chạy PageSpeed Insights.
4. Commit tệp chứng cứ đã điền: `git commit -m "docs(evidence): nghiệm thu SEO và AI search trên production"` (kèm dòng Co-Authored-By).
5. Gửi PHONG danh sách "Việc của PHONG" (tệp chứng cứ) kèm các bước spec mục 8.

---

## Lệch spec có chủ ý

1. **e2e SEO của docs dùng cấu hình Playwright riêng** (`playwright.seo.config.ts`, cổng 4324): cấu hình cũ luôn dựng API ở máy (wrangler dev + seed) mà bài SEO không cần. Bài vẫn chạy trên bản build.
2. **Dòng link trong README các gói viết tiếng Anh** ("Website · Pricing · Docs") vì README đang viết tiếng Anh; spec ghi "Website · Bảng giá · Tài liệu".
3. **Nhãn `customSets` của plugin llms bằng tiếng Anh** ("Getting started", "Guides", "Reference") để URL `/_llms-txt/<nhóm>.txt` là ASCII; spec ghi nhãn tiếng Việt. Mô tả của từng nhóm vẫn tiếng Việt.
4. **`copy-legal.mjs` chỉ chạy khi gọi thẳng bằng `node`**: cần để test và `scripts/lastmod.mjs` import được `PAGES` mà không ghi đè tệp.
5. **Bước `truoc` của IndexNow cũng không bao giờ thoát khác 0** (spec chỉ nói bước `gui`): lỗi lập danh sách không được chặn deploy.
6. **Link tài liệu trong `llms.txt` của site là mỗi link một dòng** thay vì nối bằng " · " như khung ở spec 5.2 — đúng khuôn danh sách của llmstxt.org.
