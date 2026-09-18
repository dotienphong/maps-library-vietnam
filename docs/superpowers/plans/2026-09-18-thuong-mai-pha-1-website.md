# Thương mại tự phục vụ — Pha 1: website `apps/site` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một website quảng bá tĩnh, tối ưu SEO, có bảng giá và bảng so sánh đối thủ lấy từ `@mapslibvn/catalog`, deploy lên Cloudflare Pages `mapslibvn-site`.

**Architecture:** Astro 7 ở chế độ `output: 'static'`, **không** Starlight, **không** React. Mọi tương tác (tab mã nhúng, công tắc kỳ giá, sáng/tối, nạp bản đồ) làm bằng `<script>` vanilla nhỏ do Astro bundle — xem "Lệch spec có chủ ý" ở cuối. Toàn bộ số liệu SEO và giá nằm trong module TypeScript thuần (`src/lib/*.ts`) để vitest kiểm được; file `.astro` chỉ render.

**Tech Stack:** Astro 7.3.2, `@astrojs/sitemap` 3.7.4, `@tailwindcss/vite` 4.3.3 + Tailwind v4, `@fontsource/be-vietnam-pro` 5.3.0, `@mapslibvn/catalog` và `@mapslibvn/ui` (chỉ `tokens.css`), Playwright, vitest 5 (gốc).

Spec: `docs/superpowers/specs/2026-09-18-thuong-mai-tu-phuc-vu-design.md` mục 11 và 19.
Pha 0 đã xong và đã lên production (`08d7bc2`).

---

## Bối cảnh bắt buộc đọc trước khi làm

- **Website KHÔNG gọi API lúc render.** Giá và bảng so sánh đọc từ `@mapslibvn/catalog` lúc build.
  Không hardcode một con số nào trong `.astro`; có test khoá lại việc đó.
- **Ba bẫy của repo còn nguyên giá trị:** `pnpm typecheck` replay cache (dùng
  `turbo run typecheck --force`); macOS không có `timeout`, `sed -i` cần `''`; Tailwind v4 không
  quét `node_modules`. Website chỉ dùng `tokens.css` của `packages/ui` chứ không dùng component
  nào của nó, nên **không cần `@source`** — nhưng phải kiểm CSS build có `--color-brand-700`.
- **Tên miền:** PHONG chốt deploy `mapslibvn-site.pages.dev` trước, đổi sau. Mọi URL tuyệt đối đi
  qua đúng một hằng `SITE_URL` trong `apps/site/site.config.mjs`.
- **Không quảng cáo quá lời.** Mọi tỷ lệ "rẻ hơn X %" phải kèm workload cụ thể, ngày đối chiếu
  14/09/2026, giả định và ba nguồn — `COMPARISON` đã mang sẵn cả ba thứ đó.
- Mọi commit kết thúc bằng `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Không push cho tới Task 14.

## Cấu trúc file

**Tạo mới**

```
apps/site/
  package.json           private, scripts dev/build/preview/typecheck(astro check)/e2e
  astro.config.mjs       site: SITE_URL, output static, sitemap, vite: tailwindcss()
  tsconfig.json          extends astro/tsconfigs/strict + base repo
  site.config.mjs        SITE_URL, CONSOLE_URL, SUPPORT_EMAIL, DOCS_URL  (nguồn duy nhất)
  playwright.config.ts   preview :4322
  .gitignore             dist/ .astro/ test-results/ playwright-report/
  src/
    styles/global.css    @import tailwindcss + tokens.css + font + nền trang
    lib/
      trang.ts           TRANG: metadata SEO từng trang (title/description/ogImage/nav)
      trang.test.ts      khoá độ dài title ≤60, description 120–160, path duy nhất
      seo.ts             canonicalUrl, seoMeta, *JsonLd
      seo.test.ts
      gia.ts             dinhDangVnd/dinhDangUsd, bangGia(), tomTatGia(), soSanh()
      gia.test.ts        khoá: số trên trang = số trong @mapslibvn/catalog
    components/
      SeoHead.astro      <head> đầy đủ + JSON-LD
      Header.astro       logo chữ, nav, nút sáng/tối, CTA
      Footer.astro       liên kết, email hỗ trợ, ghi nguồn, giấy phép
      Hero.astro         tiêu đề, hai CTA, khối bản đồ (ảnh tĩnh → iframe khi bấm)
      CodeTabs.astro     ba tab mã nhúng, vanilla JS + ARIA
      PricingCards.astro bốn thẻ + công tắc 1/3/6/12, vanilla JS đổi text
      ComparisonTable.astro  bảng + chú thích + nguồn
      Faq.astro          <details>/<summary>, không JS
      Feature.astro      thẻ tính năng
      Prose.astro        bọc nội dung dài, kiểu chữ bài viết
    layouts/Base.astro   <html lang="vi"> + SeoHead + Header + main + Footer + skip-link
    content.config.ts    collection `bai-viet`
    content/bai-viet/*.md
    pages/
      index.astro  tinh-nang.astro  bang-gia.astro  lien-he.astro  404.astro
      so-sanh/google-maps-api.astro  so-sanh/vietmap.astro
      bai-viet/index.astro  bai-viet/[slug].astro
      robots.txt.ts
  public/og/*.png        sinh bằng scripts/site-images.mjs
  src/assets/ban-do-hero.png

scripts/site-images.mjs  Playwright: chụp bản đồ thật + sinh ảnh OG 1200×630
.github/workflows/deploy-site.yml
docs/evidence/commerce/2026-09-18-pha-1-website.md
```

**Sửa**: `package.json` gốc (`deploy:site`, `test:site-e2e`, thêm build site vào `test`),
`vitest.config.ts` (include `apps/site/src/**/*.test.ts`), `docs/DEVLOG.md` (mục 19).

---

### Task 1: Scaffold `apps/site`, build xanh với một trang trống

**Files:**
- Create: `apps/site/package.json`, `apps/site/site.config.mjs`, `apps/site/astro.config.mjs`, `apps/site/tsconfig.json`, `apps/site/.gitignore`, `apps/site/src/styles/global.css`, `apps/site/src/layouts/Base.astro`, `apps/site/src/pages/index.astro`
- Modify: `package.json` (gốc), `vitest.config.ts`

- [ ] **Step 1: `site.config.mjs` — nguồn duy nhất của mọi URL tuyệt đối**

```js
/**
 * Hằng dùng chung cho astro.config.mjs (không đọc được TypeScript) và mã trong src/.
 * Đổi tên miền = sửa ĐÚNG file này, rồi thêm _redirects 301 và gửi lại sitemap ở Search Console.
 */
export const SITE_URL = 'https://mapslibvn-site.pages.dev';
export const CONSOLE_URL = 'https://api.ai-solutions.io.vn/console/';
export const DOCS_URL = 'https://mapslibvn-docs.pages.dev';
export const SUPPORT_EMAIL = 'dotienphong1993@gmail.com';
export const BRAND = 'MapsLibVN';
```

- [ ] **Step 2: `package.json`**

```json
{
  "name": "@mapslibvn/site",
  "version": "0.1.0",
  "description": "Website quảng bá MapsLibVN — Astro tĩnh, tối ưu SEO",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "astro dev --port 4322",
    "build": "astro build",
    "preview": "astro preview --port 4322",
    "typecheck": "astro check",
    "e2e": "playwright test",
    "images": "node ../../scripts/site-images.mjs"
  },
  "dependencies": {
    "@astrojs/sitemap": "^3.7.4",
    "@fontsource/be-vietnam-pro": "^5.3.0",
    "@mapslibvn/catalog": "workspace:*",
    "@mapslibvn/ui": "workspace:*",
    "astro": "^7.3.2"
  },
  "devDependencies": {
    "@astrojs/check": "^0.9.10",
    "@playwright/test": "^1.63.0",
    "@tailwindcss/vite": "^4.3.3",
    "tailwindcss": "^4.3.3",
    "typescript": "^6.0.3"
  }
}
```

- [ ] **Step 3: `astro.config.mjs`**

```js
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import { SITE_URL } from './site.config.mjs';

// Tĩnh hoàn toàn: mọi trang dựng sẵn thành HTML lúc build nên bot đọc được ngay và không có
// máy chủ nào phải chạy. KHÔNG dùng @astrojs/react: mọi tương tác của site này nhỏ tới mức một
// <script> vài chục dòng làm xong, còn React + hydration thì tốn ~45 kB gzip cho mỗi trang.
export default defineConfig({
  site: SITE_URL,
  output: 'static',
  trailingSlash: 'always',
  integrations: [sitemap({ filter: (page) => !page.includes('/404') })],
  vite: { plugins: [tailwindcss()] },
  build: { inlineStylesheets: 'auto' },
});
```

- [ ] **Step 4: `tsconfig.json` và `.gitignore`**

`apps/site/tsconfig.json`:

```json
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "allowJs": true,
    "strictNullChecks": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  },
  "include": [".astro/types.d.ts", "src", "site.config.mjs", "astro.config.mjs"],
  "exclude": ["dist"]
}
```

`apps/site/.gitignore`:

```
dist/
.astro/
test-results/
playwright-report/
```

- [ ] **Step 5: `global.css`**

```css
@import "tailwindcss";
/* Token màu và bo góc dùng chung với trang Admin (packages/ui). Website chỉ dùng token, không
   dùng component nào của package, nên KHÔNG cần @source. */
@import "../../../../packages/ui/src/tokens.css";
/* Be Vietnam Pro: font Việt, dấu đặt đúng ở mọi cỡ, giấy phép OFL. Ba nét là đủ cho cả site. */
@import "@fontsource/be-vietnam-pro/400.css";
@import "@fontsource/be-vietnam-pro/600.css";
@import "@fontsource/be-vietnam-pro/700.css";

@custom-variant dark (&:where(.dark, .dark *));

@theme {
  --font-sans: "Be Vietnam Pro", ui-sans-serif, system-ui, sans-serif;
}

html {
  scroll-behavior: smooth;
}

@media (prefers-reduced-motion: reduce) {
  html {
    scroll-behavior: auto;
  }
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  /* Website là để ĐỌC nên chữ nền tối thiểu 16px, khác trang Admin (14px). */
  font-size: 16px;
  line-height: 1.6;
  margin: 0;
}

@layer base {
  a[href],
  button:not(:disabled),
  summary,
  label[for] {
    cursor: pointer;
  }
}
```

Trước khi viết, kiểm tên tệp font có thật:

```bash
pnpm install
ls node_modules/@fontsource/be-vietnam-pro/*.css | head -12
```

Expected: thấy `400.css`, `600.css`, `700.css`. Nếu thư mục có thêm `vietnamese-400.css` thì đổi ba dòng `@import` sang bản `vietnamese-*` để tải ít byte hơn, và ghi lại lựa chọn trong file chứng cứ.

- [ ] **Step 6: `Base.astro` tối thiểu và `index.astro` tạm**

`apps/site/src/layouts/Base.astro`:

```astro
---
import '../styles/global.css';
interface Props {
  title: string;
  description: string;
}
const { title, description } = Astro.props;
---

<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    <meta name="description" content={description} />
  </head>
  <body>
    <main><slot /></main>
  </body>
</html>
```

`apps/site/src/pages/index.astro`:

```astro
---
import Base from '../layouts/Base.astro';
---

<Base title="MapsLibVN" description="Đang dựng.">
  <h1>MapsLibVN</h1>
</Base>
```

- [ ] **Step 7: Script gốc và vitest include**

Trong `package.json` gốc, thêm hai script và nối build site vào `test`:

```json
    "deploy:site": "pnpm --filter @mapslibvn/site build && pnpm --filter @mapslibvn/site exec wrangler pages deploy dist --project-name mapslibvn-site",
    "test:site-e2e": "pnpm --filter @mapslibvn/site e2e",
```

và trong script `test` hiện có, chèn `&& pnpm --filter @mapslibvn/site build` ngay sau
`pnpm --filter @mapslibvn/admin build` — build hỏng phải chặn cả bộ test, đúng như admin.

Trong `vitest.config.ts`, thêm vào `include` sau dòng `'apps/docs/src/**/*.test.ts',`:

```ts
      'apps/site/src/**/*.test.ts',
```

- [ ] **Step 8: Build và typecheck**

Run:

```bash
pnpm install
pnpm --filter @mapslibvn/site build
pnpm --filter @mapslibvn/site typecheck
ls apps/site/dist
grep -c -- "--color-brand-700" apps/site/dist/_astro/*.css
```

Expected: build xong; `astro check` 0 lỗi; `dist/index.html` và `dist/sitemap-index.xml` có mặt; grep ≥ 1 (token của `packages/ui` đã vào CSS).

- [ ] **Step 9: Commit**

```bash
git add apps/site package.json vitest.config.ts pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(site): scaffold apps/site — Astro 7 tĩnh, Tailwind v4, token dùng chung, sitemap

Không dùng React: mọi tương tác của website làm bằng script vanilla nhỏ, xem plan pha 1.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `trang.ts` — bảng metadata SEO của mọi trang, có test khoá độ dài

**Files:**
- Create: `apps/site/src/lib/trang.ts`
- Test: `apps/site/src/lib/trang.test.ts`

Đây là xương sống SEO: mọi `<title>`, `description`, `canonical`, ảnh OG và mục điều hướng đọc từ một bảng duy nhất, nên không trang nào bị quên và test ép đúng độ dài ngay lúc viết.

- [ ] **Step 1: Viết test (đỏ)**

`apps/site/src/lib/trang.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { NAV, TRANG, type TrangKey, trangTheoDuongDan } from './trang';

const KEYS = Object.keys(TRANG) as TrangKey[];

describe('TRANG', () => {
  it('phủ đủ các trang của spec mục 11.2', () => {
    expect(KEYS.sort()).toEqual(
      [
        'baiViet',
        'bangGia',
        'khong404',
        'lienHe',
        'soSanhGoogle',
        'soSanhVietmap',
        'tinhNang',
        'trangChu',
      ].sort(),
    );
  });

  it('title ≤ 60 ký tự — dài hơn thì Google cắt giữa chừng', () => {
    for (const key of KEYS) {
      expect(TRANG[key].title.length, `${key}: "${TRANG[key].title}"`).toBeLessThanOrEqual(60);
      expect(TRANG[key].title.length).toBeGreaterThan(10);
    }
  });

  it('description 120–160 ký tự — ngắn hơn thì Google tự viết lại, dài hơn thì bị cắt', () => {
    for (const key of KEYS) {
      const n = TRANG[key].description.length;
      expect(n, `${key}: ${n} ký tự`).toBeGreaterThanOrEqual(120);
      expect(n, `${key}: ${n} ký tự`).toBeLessThanOrEqual(160);
    }
  });

  it('đường dẫn duy nhất, bắt đầu và kết thúc bằng /', () => {
    const paths = KEYS.map((key) => TRANG[key].path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) {
      expect(path.startsWith('/')).toBe(true);
      expect(path.endsWith('/')).toBe(true);
    }
  });

  it('mỗi trang có đúng một h1 khai trong bảng, khác title để không lặp từ khoá', () => {
    for (const key of KEYS) {
      expect(TRANG[key].h1.length).toBeGreaterThan(5);
    }
  });

  it('điều hướng chỉ trỏ tới trang có thật và không có 404', () => {
    for (const muc of NAV) {
      expect(KEYS).toContain(muc);
      expect(muc).not.toBe('khong404');
    }
  });

  it('trangTheoDuongDan tra ngược được, trả undefined cho đường lạ', () => {
    expect(trangTheoDuongDan('/bang-gia/')?.title).toBe(TRANG.bangGia.title);
    expect(trangTheoDuongDan('/khong-co-that/')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run apps/site/src/lib/trang.test.ts`
Expected: FAIL — `Cannot find module './trang'`.

- [ ] **Step 3: Viết `trang.ts`**

Điền `title`, `description`, `h1` đúng ràng buộc độ dài ở Step 1; test là thước đo, chỉnh câu chữ cho tới khi xanh.

```ts
export interface TrangMeta {
  path: string;
  /** Thẻ <title>, ≤ 60 ký tự. */
  title: string;
  /** Thẻ description, 120–160 ký tự. */
  description: string;
  /** Tiêu đề h1 trên trang — cố ý khác title để không nhồi cùng một cụm từ hai lần. */
  h1: string;
  /** Nhãn ngắn cho thanh điều hướng. */
  nhan: string;
  /** Ảnh OG riêng; thiếu thì dùng ảnh mặc định của site. */
  og?: string;
}

export const TRANG = {
  trangChu: {
    path: '/',
    title: 'MapsLibVN — API bản đồ và địa điểm Việt Nam',
    description:
      'API bản đồ, tìm kiếm địa điểm và dẫn đường cho Việt Nam trên dữ liệu mở. Nhúng bằng một dòng, gói trả phí từ 650.000đ mỗi tháng, có bản dùng thử miễn phí.',
    h1: 'Bản đồ và địa điểm Việt Nam cho ứng dụng của bạn',
    nhan: 'Trang chủ',
    og: '/og/trang-chu.png',
  },
  tinhNang: {
    path: '/tinh-nang/',
    title: 'Tính năng — MapsLibVN',
    description:
      'Bản đồ nền Việt Nam, lớp địa điểm 164 loại, tìm kiếm gõ tới đâu gợi ý tới đó, geocode nói thật độ chính xác, dẫn đường và bốn SDK cho web lẫn di động.',
    h1: 'MapsLibVN làm được gì',
    nhan: 'Tính năng',
  },
  bangGia: {
    path: '/bang-gia/',
    title: 'Bảng giá API bản đồ Việt Nam — MapsLibVN',
    description:
      'Bốn gói từ dùng thử miễn phí tới 10.400.000đ mỗi tháng, tính theo lượt gọi API chứ không theo số người dùng. Có bảng so sánh chi phí với Google và VIETMAP.',
    h1: 'Bảng giá',
    nhan: 'Bảng giá',
    og: '/og/bang-gia.png',
  },
  soSanhGoogle: {
    path: '/so-sanh/google-maps-api/',
    title: 'Thay thế Google Maps API ở Việt Nam — MapsLibVN',
    description:
      'So sánh chi phí và tính năng giữa MapsLibVN và Google Maps Platform cho ba mức dùng thật, kèm giả định, ngày đối chiếu và những chỗ Google vẫn hơn.',
    h1: 'MapsLibVN so với Google Maps Platform',
    nhan: 'So với Google',
  },
  soSanhVietmap: {
    path: '/so-sanh/vietmap/',
    title: 'So sánh MapsLibVN và VIETMAP API — MapsLibVN',
    description:
      'Đối chiếu chi phí, mô hình tính lượt và quyền với dữ liệu giữa MapsLibVN và VIETMAP cho ba mức dùng thật, kèm giả định và ngày đối chiếu cụ thể.',
    h1: 'MapsLibVN so với VIETMAP',
    nhan: 'So với VIETMAP',
  },
  baiViet: {
    path: '/bai-viet/',
    title: 'Bài viết — MapsLibVN',
    description:
      'Ghi chép về chi phí API bản đồ tại Việt Nam, cách tự dựng bản đồ từ dữ liệu mở và vì sao độ chính xác của geocode cần được nói thật với người dùng cuối.',
    h1: 'Bài viết',
    nhan: 'Bài viết',
  },
  lienHe: {
    path: '/lien-he/',
    title: 'Liên hệ và hỗ trợ — MapsLibVN',
    description:
      'Cách liên hệ MapsLibVN, giờ hỗ trợ trực tuyến cho gói Professional và Business, cùng các đường dẫn tới tài liệu kỹ thuật và trang thử nghiệm trực tiếp.',
    h1: 'Liên hệ',
    nhan: 'Liên hệ',
  },
  khong404: {
    path: '/404/',
    title: 'Không tìm thấy trang — MapsLibVN',
    description:
      'Đường dẫn này không có trên website MapsLibVN. Có thể trang đã được đổi tên hoặc gõ nhầm địa chỉ; dưới đây là các trang chính để bạn đi tiếp.',
    h1: 'Không tìm thấy trang',
    nhan: '404',
  },
} as const satisfies Record<string, TrangMeta>;

export type TrangKey = keyof typeof TRANG;

/** Thứ tự trên thanh điều hướng. Trang chủ đã ở logo nên không lặp lại. */
export const NAV: readonly TrangKey[] = [
  'tinhNang',
  'bangGia',
  'soSanhGoogle',
  'baiViet',
  'lienHe',
];

export function trangTheoDuongDan(path: string): TrangMeta | undefined {
  return (Object.values(TRANG) as TrangMeta[]).find((trang) => trang.path === path);
}
```

- [ ] **Step 4: Chạy test tới khi xanh**

Run: `npx vitest run apps/site/src/lib/trang.test.ts`
Expected: `7 passed`. Bài độ dài sẽ in đúng khoá và số ký tự lệch, chỉnh câu rồi chạy lại.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/lib
git commit -m "$(cat <<'EOF'
feat(site): bảng TRANG — metadata SEO của mọi trang, test khoá độ dài title và description

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `seo.ts` — canonical, thẻ mạng xã hội và năm loại JSON-LD

**Files:**
- Create: `apps/site/src/lib/seo.ts`
- Test: `apps/site/src/lib/seo.test.ts`

- [ ] **Step 1: Viết test (đỏ)**

`apps/site/src/lib/seo.test.ts`:

```ts
import { PLAN_CATALOG } from '@mapslibvn/catalog';
import { describe, expect, it } from 'vitest';
import {
  articleJsonLd,
  breadcrumbJsonLd,
  canonicalUrl,
  faqJsonLd,
  organizationJsonLd,
  seoMeta,
  softwareApplicationJsonLd,
} from './seo';
import { TRANG } from './trang';

describe('canonicalUrl', () => {
  it('ghép đúng gốc site, không nhân đôi dấu gạch', () => {
    expect(canonicalUrl('/')).toBe('https://mapslibvn-site.pages.dev/');
    expect(canonicalUrl('/bang-gia/')).toBe('https://mapslibvn-site.pages.dev/bang-gia/');
  });

  it('luôn có dấu gạch cuối — hai URL khác nhau cho cùng một trang là tự chia điểm SEO', () => {
    expect(canonicalUrl('/bang-gia')).toBe('https://mapslibvn-site.pages.dev/bang-gia/');
  });
});

describe('seoMeta', () => {
  it('mang đủ canonical, og và twitter cho một trang thường', () => {
    const meta = seoMeta(TRANG.bangGia);
    expect(meta.canonical).toBe('https://mapslibvn-site.pages.dev/bang-gia/');
    expect(meta.og.title).toBe(TRANG.bangGia.title);
    expect(meta.og.type).toBe('website');
    expect(meta.og.url).toBe(meta.canonical);
    expect(meta.og.image).toBe('https://mapslibvn-site.pages.dev/og/bang-gia.png');
    expect(meta.og.locale).toBe('vi_VN');
    expect(meta.twitter.card).toBe('summary_large_image');
  });

  it('trang không khai ảnh OG thì dùng ảnh mặc định', () => {
    expect(seoMeta(TRANG.tinhNang).og.image).toBe(
      'https://mapslibvn-site.pages.dev/og/mac-dinh.png',
    );
  });

  it('bài viết khai type article và ngày đăng', () => {
    const meta = seoMeta(TRANG.baiViet, { type: 'article', publishedAt: '2026-09-18' });
    expect(meta.og.type).toBe('article');
    expect(meta.og.publishedTime).toBe('2026-09-18');
  });
});

describe('JSON-LD', () => {
  it('Organization có tên, URL và email liên hệ', () => {
    const ld = organizationJsonLd();
    expect(ld['@type']).toBe('Organization');
    expect(ld.name).toBe('MapsLibVN');
    expect(ld.url).toBe('https://mapslibvn-site.pages.dev/');
    expect(JSON.stringify(ld)).toContain('dotienphong1993@gmail.com');
  });

  it('SoftwareApplication mang đúng bốn gói với giá VND lấy từ catalog', () => {
    const ld = softwareApplicationJsonLd();
    expect(ld['@type']).toBe('SoftwareApplication');
    expect(ld.offers).toHaveLength(4);
    const starter = ld.offers.find((offer) => offer.name.includes('Starter'));
    expect(starter?.price).toBe(String(PLAN_CATALOG.starter.priceVnd));
    expect(starter?.priceCurrency).toBe('VND');
    const trial = ld.offers.find((offer) => offer.name.includes('thử'));
    expect(trial?.price).toBe('0');
  });

  it('FAQPage sinh đúng số câu và giữ nguyên nội dung', () => {
    const ld = faqJsonLd([{ hoi: 'Tính lượt thế nào?', dap: 'Chỉ trừ request thành công.' }]);
    expect(ld['@type']).toBe('FAQPage');
    expect(ld.mainEntity).toHaveLength(1);
    expect(ld.mainEntity[0]?.name).toBe('Tính lượt thế nào?');
    expect(ld.mainEntity[0]?.acceptedAnswer.text).toBe('Chỉ trừ request thành công.');
  });

  it('Article và BreadcrumbList dựng đúng URL tuyệt đối', () => {
    const article = articleJsonLd({
      title: 'Chi phí Google Maps API',
      description: 'Mô tả',
      path: '/bai-viet/chi-phi-google/',
      publishedAt: '2026-09-18',
    });
    expect(article.mainEntityOfPage).toBe(
      'https://mapslibvn-site.pages.dev/bai-viet/chi-phi-google/',
    );
    expect(article.datePublished).toBe('2026-09-18');

    const bread = breadcrumbJsonLd([
      { ten: 'Trang chủ', path: '/' },
      { ten: 'Bài viết', path: '/bai-viet/' },
    ]);
    expect(bread.itemListElement).toHaveLength(2);
    expect(bread.itemListElement[1]?.position).toBe(2);
    expect(bread.itemListElement[1]?.item).toBe('https://mapslibvn-site.pages.dev/bai-viet/');
  });

  it('mọi khối JSON-LD serialize được và có @context', () => {
    for (const ld of [organizationJsonLd(), softwareApplicationJsonLd(), faqJsonLd([])]) {
      expect(ld['@context']).toBe('https://schema.org');
      expect(() => JSON.parse(JSON.stringify(ld))).not.toThrow();
    }
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run apps/site/src/lib/seo.test.ts`
Expected: FAIL — `Cannot find module './seo'`.

- [ ] **Step 3: Viết `seo.ts`**

```ts
import { PAID_TIERS, PLAN_CATALOG } from '@mapslibvn/catalog';
import { BRAND, SITE_URL, SUPPORT_EMAIL } from '../../site.config.mjs';
import type { TrangMeta } from './trang';

const OG_MAC_DINH = '/og/mac-dinh.png';

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
      type: tuyChon.type ?? 'website',
      locale: 'vi_VN',
      siteName: BRAND,
      ...(tuyChon.publishedAt ? { publishedTime: tuyChon.publishedAt } : {}),
    },
    twitter: { card: 'summary_large_image', title: trang.title, description: trang.description, image },
  };
}

export function organizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: BRAND,
    url: canonicalUrl('/'),
    logo: `${SITE_URL}${OG_MAC_DINH}`,
    description: 'Nền tảng bản đồ và địa điểm Việt Nam dựng trên dữ liệu mở.',
    contactPoint: {
      '@type': 'ContactPoint',
      email: SUPPORT_EMAIL,
      contactType: 'customer support',
      availableLanguage: ['vi', 'en'],
    },
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
    name: BRAND,
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Web, iOS, Android',
    url: canonicalUrl('/'),
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
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: input.title,
    description: input.description,
    mainEntityOfPage: canonicalUrl(input.path),
    datePublished: input.publishedAt,
    dateModified: input.updatedAt ?? input.publishedAt,
    author: { '@type': 'Organization' as const, name: BRAND, url: canonicalUrl('/') },
    publisher: { '@type': 'Organization' as const, name: BRAND, url: canonicalUrl('/') },
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

- [ ] **Step 4: Chạy test và typecheck**

Run: `npx vitest run apps/site/src/lib && pnpm --filter @mapslibvn/site typecheck`
Expected: hai file test xanh (7 + 9 = 16 test). Nếu `astro check` phàn nàn về import `site.config.mjs` không có kiểu, kiểm `allowJs: true` và `include` đã có `site.config.mjs` trong `apps/site/tsconfig.json`.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/lib
git commit -m "$(cat <<'EOF'
feat(site): seo.ts — canonical, thẻ OG/Twitter và năm khối JSON-LD lấy giá từ catalog

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `gia.ts` — định dạng tiền và mô hình hiển thị lấy thẳng từ catalog

**Files:**
- Create: `apps/site/src/lib/gia.ts`
- Test: `apps/site/src/lib/gia.test.ts`

Mọi con số trên trang bảng giá và trang so sánh đi qua đúng module này. Test khoá lại điều quan
trọng nhất: **không có bản chép tay thứ hai của giá trong website**.

- [ ] **Step 1: Viết test (đỏ)**

`apps/site/src/lib/gia.test.ts`:

```ts
import { COMPARISON, PLAN_CATALOG, savingsPercent } from '@mapslibvn/catalog';
import { describe, expect, it } from 'vitest';
import {
  bangGia,
  dinhDangSo,
  dinhDangUsd,
  dinhDangVnd,
  GOI_NOI_BAT,
  soSanh,
  tomTatGia,
} from './gia';

describe('định dạng', () => {
  it('VND dùng dấu chấm nhóm nghìn và hậu tố đ, không lẻ xu', () => {
    expect(dinhDangVnd(650_000)).toBe('650.000đ');
    expect(dinhDangVnd(10_400_000)).toBe('10.400.000đ');
    expect(dinhDangVnd(0)).toBe('0đ');
  });

  it('USD giữ hai chữ số khi lẻ, bỏ khi tròn', () => {
    expect(dinhDangUsd(2_500)).toBe('$25');
    expect(dinhDangUsd(3_962)).toBe('$39,62');
  });

  it('số lượt nhóm nghìn theo kiểu Việt', () => {
    expect(dinhDangSo(30_000)).toBe('30.000');
    expect(dinhDangSo(400_000)).toBe('400.000');
  });
});

describe('bangGia', () => {
  it('trả bốn gói theo thứ tự, mỗi gói đủ bốn kỳ giá', () => {
    const goi = bangGia();
    expect(goi.map((g) => g.tier)).toEqual(['trial', 'starter', 'professional', 'business']);
    for (const g of goi) {
      expect(Object.keys(g.theoKy).map(Number).sort((a, b) => a - b)).toEqual([1, 3, 6, 12]);
    }
  });

  it('giá từng kỳ = giá tháng nhân số tháng, không chiết khấu', () => {
    const starter = bangGia().find((g) => g.tier === 'starter');
    expect(starter?.theoKy[1]?.vnd).toBe(650_000);
    expect(starter?.theoKy[3]?.vnd).toBe(1_950_000);
    expect(starter?.theoKy[12]?.vnd).toBe(7_800_000);
    expect(starter?.theoKy[12]?.vndHienThi).toBe('7.800.000đ');
  });

  it('gói dùng thử giá 0 ở mọi kỳ và ghi rõ thời hạn 30 ngày', () => {
    const trial = bangGia().find((g) => g.tier === 'trial');
    expect(trial?.theoKy[12]?.vnd).toBe(0);
    expect(trial?.ghiChuHan).toMatch(/30 ngày/);
  });

  it('hạn mức và hỗ trợ trực tuyến chép đúng catalog, không có số lạ', () => {
    for (const g of bangGia()) {
      const goc = PLAN_CATALOG[g.tier];
      expect(g.places).toBe(goc.places);
      expect(g.directions).toBe(goc.directions);
      expect(g.hoTroOnline).toBe(goc.onlineSupport);
    }
  });

  it('gói nổi bật là Professional — gói duy nhất vừa có hỗ trợ vừa chưa phải giá cao nhất', () => {
    expect(GOI_NOI_BAT).toBe('professional');
  });
});

describe('tomTatGia', () => {
  it('cho trang chủ: ba gói trả phí, giá tháng, không có dùng thử', () => {
    const tom = tomTatGia();
    expect(tom.map((t) => t.tier)).toEqual(['starter', 'professional', 'business']);
    expect(tom[0]?.giaThang).toBe('650.000đ');
    expect(tom[0]?.usdThang).toBe('$25');
  });
});

describe('soSanh', () => {
  it('ba dòng, mỗi dòng có phần trăm rẻ hơn tính từ COMPARISON chứ không gõ tay', () => {
    const rows = soSanh();
    expect(rows).toHaveLength(3);
    const starter = rows[0];
    expect(starter?.reHonGoogle).toBe(savingsPercent(25, COMPARISON.rows[0].googleUsd));
    expect(starter?.reHonVietmap).toBe(savingsPercent(25, COMPARISON.rows[0].vietmapUsd));
    expect(starter?.googleVndHienThi).toBe('1.030.120đ');
  });

  it('khoảng phần trăm rẻ hơn Google dùng cho câu mở đầu trang chủ', () => {
    const rows = soSanh();
    const thap = Math.min(...rows.map((r) => r.reHonGoogle));
    const cao = Math.max(...rows.map((r) => r.reHonGoogle));
    expect(Math.round(thap)).toBe(37);
    expect(Math.round(cao)).toBe(68);
  });

  it('mang theo ngày đối chiếu, giả định và nguồn — số trần không được phép lên trang', () => {
    const rows = soSanh();
    expect(rows[0]?.workload).toMatch(/30\.000/);
    expect(COMPARISON.checkedAt).toBe('2026-09-14');
    expect(COMPARISON.sources).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run apps/site/src/lib/gia.test.ts`
Expected: FAIL — `Cannot find module './gia'`.

- [ ] **Step 3: Viết `gia.ts`**

```ts
import {
  COMPARISON,
  PAID_TIERS,
  PERIOD_MONTHS,
  type PeriodMonths,
  PLAN_CATALOG,
  quoteOrder,
  savingsPercent,
  type Tier,
  TIERS,
} from '@mapslibvn/catalog';

const NHOM_NGHIN = new Intl.NumberFormat('vi-VN');

export const dinhDangSo = (n: number): string => NHOM_NGHIN.format(n);
export const dinhDangVnd = (n: number): string => `${NHOM_NGHIN.format(n)}đ`;

/** USD chỉ là con số THAM CHIẾU hiện mờ cạnh giá VND, nên bỏ phần lẻ khi tròn cho đỡ rối. */
export function dinhDangUsd(cents: number): string {
  const usd = cents / 100;
  return Number.isInteger(usd)
    ? `$${NHOM_NGHIN.format(usd)}`
    : `$${usd.toFixed(2).replace('.', ',')}`;
}

export const TEN_GOI: Record<Tier, string> = {
  trial: 'Dùng thử',
  starter: 'Starter',
  professional: 'Professional',
  business: 'Business',
};

/** Gói gợi ý mặc định: có hỗ trợ trực tuyến mà chưa phải mức cao nhất. */
export const GOI_NOI_BAT: Tier = 'professional';

export interface GiaKy {
  vnd: number;
  usdCents: number;
  vndHienThi: string;
  usdHienThi: string;
  /** Giá quy về mỗi tháng, để khách so kỳ dài với kỳ ngắn mà không phải tự chia. */
  vndMoiThangHienThi: string;
}

export interface GoiHienThi {
  tier: Tier;
  ten: string;
  places: number;
  directions: number;
  placesHienThi: string;
  directionsHienThi: string;
  tranNgay: string | null;
  hoTroOnline: boolean;
  ghiChuHan: string;
  noiBat: boolean;
  theoKy: Record<PeriodMonths, GiaKy>;
}

function giaKy(tier: Tier, months: PeriodMonths): GiaKy {
  // Gói dùng thử không bán nên quoteOrder từ chối nó; giá 0 dựng thẳng.
  const { amountVnd, amountUsdCents } =
    tier === 'trial'
      ? { amountVnd: 0, amountUsdCents: 0 }
      : quoteOrder({ kind: 'plan', tier, months });
  return {
    vnd: amountVnd,
    usdCents: amountUsdCents,
    vndHienThi: dinhDangVnd(amountVnd),
    usdHienThi: dinhDangUsd(amountUsdCents),
    vndMoiThangHienThi: dinhDangVnd(Math.round(amountVnd / months)),
  };
}

export function bangGia(): GoiHienThi[] {
  return TIERS.map((tier) => {
    const goc = PLAN_CATALOG[tier];
    const theoKy = Object.fromEntries(
      PERIOD_MONTHS.map((months) => [months, giaKy(tier, months)]),
    ) as Record<PeriodMonths, GiaKy>;
    return {
      tier,
      ten: TEN_GOI[tier],
      places: goc.places,
      directions: goc.directions,
      placesHienThi: dinhDangSo(goc.places),
      directionsHienThi: dinhDangSo(goc.directions),
      tranNgay:
        goc.dailyPlaces === null
          ? null
          : `${dinhDangSo(goc.dailyPlaces)} Places + ${dinhDangSo(goc.dailyDirections ?? 0)} tuyến mỗi ngày`,
      hoTroOnline: goc.onlineSupport,
      ghiChuHan:
        tier === 'trial'
          ? 'Tổng hạn mức trong 30 ngày, không cấp lại theo ngày'
          : 'Hạn mức làm mới theo từng kỳ thuê bao',
      noiBat: tier === GOI_NOI_BAT,
      theoKy,
    };
  });
}

export interface TomTatGoi {
  tier: Tier;
  ten: string;
  giaThang: string;
  usdThang: string;
  placesHienThi: string;
}

/** Bản rút gọn cho trang chủ: chỉ ba gói trả phí, chỉ giá tháng. */
export function tomTatGia(): TomTatGoi[] {
  return PAID_TIERS.map((tier) => ({
    tier,
    ten: TEN_GOI[tier],
    giaThang: dinhDangVnd(PLAN_CATALOG[tier].priceVnd),
    usdThang: dinhDangUsd(PLAN_CATALOG[tier].priceCents),
    placesHienThi: dinhDangSo(PLAN_CATALOG[tier].places),
  }));
}

export interface DongSoSanh {
  tier: Tier;
  ten: string;
  workload: string;
  mapslibvnVndHienThi: string;
  googleVndHienThi: string;
  vietmapVndHienThi: string;
  reHonGoogle: number;
  reHonVietmap: number;
}

export function soSanh(): DongSoSanh[] {
  return COMPARISON.rows.map((row) => ({
    tier: row.tier,
    ten: TEN_GOI[row.tier],
    workload: `${dinhDangSo(row.places)} Places + ${dinhDangSo(row.directions)} tuyến mỗi tháng`,
    mapslibvnVndHienThi: dinhDangVnd(row.mapslibvnVnd),
    googleVndHienThi: dinhDangVnd(row.googleVnd),
    vietmapVndHienThi: dinhDangVnd(row.vietmapVnd),
    reHonGoogle: savingsPercent(row.mapslibvnUsd, row.googleUsd),
    reHonVietmap: savingsPercent(row.mapslibvnUsd, row.vietmapUsd),
  }));
}
```

- [ ] **Step 4: Chạy test**

Run: `npx vitest run apps/site/src/lib && pnpm --filter @mapslibvn/site typecheck`
Expected: ba file test xanh (7 + 9 + 11 = 27 test).

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/lib
git commit -m "$(cat <<'EOF'
feat(site): gia.ts — định dạng tiền Việt và mô hình hiển thị giá/so sánh lấy thẳng từ catalog

Test khoá lại: website không có bản chép tay thứ hai của giá.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Khung trang — `SeoHead`, `Header`, `Footer`, `Base`

**Files:**
- Create: `apps/site/src/components/SeoHead.astro`, `Header.astro`, `Footer.astro`
- Modify: `apps/site/src/layouts/Base.astro`

- [ ] **Step 1: `SeoHead.astro`**

```astro
---
import { organizationJsonLd, seoMeta, type SeoTuyChon } from '../lib/seo';
import type { TrangMeta } from '../lib/trang';

interface Props {
  trang: TrangMeta;
  tuyChon?: SeoTuyChon;
  /** Khối JSON-LD riêng của trang (FAQPage, Article, BreadcrumbList…). */
  jsonLd?: readonly unknown[];
}

const { trang, tuyChon = {}, jsonLd = [] } = Astro.props;
const meta = seoMeta(trang, tuyChon);
// Organization đặt ở MỌI trang: nó mô tả nhà cung cấp chứ không mô tả trang, và Google gom lại.
const khoi = [organizationJsonLd(), ...jsonLd];
---

<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{meta.title}</title>
<meta name="description" content={meta.description} />
<link rel="canonical" href={meta.canonical} />

<meta property="og:title" content={meta.og.title} />
<meta property="og:description" content={meta.og.description} />
<meta property="og:url" content={meta.og.url} />
<meta property="og:image" content={meta.og.image} />
<meta property="og:type" content={meta.og.type} />
<meta property="og:locale" content={meta.og.locale} />
<meta property="og:site_name" content={meta.og.siteName} />
{meta.og.publishedTime && <meta property="article:published_time" content={meta.og.publishedTime} />}

<meta name="twitter:card" content={meta.twitter.card} />
<meta name="twitter:title" content={meta.twitter.title} />
<meta name="twitter:description" content={meta.twitter.description} />
<meta name="twitter:image" content={meta.twitter.image} />

<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
{khoi.map((ld) => <script type="application/ld+json" set:html={JSON.stringify(ld)} />)}
```

- [ ] **Step 2: `Header.astro` — điều hướng và công tắc sáng/tối**

```astro
---
import { CONSOLE_URL } from '../../site.config.mjs';
import { NAV, TRANG } from '../lib/trang';

const { pathname } = Astro.url;
---

<header
  class="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur"
>
  <div class="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
    <a href="/" class="text-lg font-bold text-brand-700 dark:text-brand-100">MapsLibVN</a>

    <nav aria-label="Điều hướng chính" class="ml-auto hidden md:block">
      <ul class="flex items-center gap-1">
        {
          NAV.map((key) => (
            <li>
              <a
                href={TRANG[key].path}
                aria-current={pathname === TRANG[key].path ? 'page' : undefined}
                class="inline-flex min-h-11 items-center rounded-[var(--radius-btn)] px-3 text-sm font-semibold text-[var(--text-muted)] hover:bg-brand-50 hover:text-brand-700 aria-[current=page]:text-brand-700 dark:hover:bg-brand-900 dark:hover:text-brand-100 dark:aria-[current=page]:text-brand-100"
              >
                {TRANG[key].nhan}
              </a>
            </li>
          ))
        }
      </ul>
    </nav>

    <button
      type="button"
      id="nut-theme"
      aria-label="Đổi giao diện sáng tối"
      class="ml-auto inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-btn)] border border-[var(--border)] md:ml-0"
    >
      <span aria-hidden="true" data-theme-icon>◐</span>
    </button>

    <a
      href={CONSOLE_URL}
      class="inline-flex min-h-11 items-center rounded-[var(--radius-btn)] bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800"
    >
      Bắt đầu miễn phí
    </a>
  </div>

  <nav aria-label="Điều hướng chính (màn hình hẹp)" class="border-t border-[var(--border)] md:hidden">
    <ul class="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 py-1">
      {
        NAV.map((key) => (
          <li>
            <a
              href={TRANG[key].path}
              aria-current={pathname === TRANG[key].path ? 'page' : undefined}
              class="inline-flex min-h-11 items-center whitespace-nowrap px-3 text-sm font-semibold text-[var(--text-muted)] aria-[current=page]:text-brand-700 dark:aria-[current=page]:text-brand-100"
            >
              {TRANG[key].nhan}
            </a>
          </li>
        ))
      }
    </ul>
  </nav>
</header>

<script>
  // Sáng/tối bằng vanilla, cùng quy ước class `dark` với trang Admin nhưng khoá localStorage
  // riêng để hai nơi không kéo nhau. Không dùng @mapslibvn/ui ở đây: kéo cả package vào bundle
  // website chỉ để đọc ba dòng localStorage là lỗ vốn.
  const KHOA = 'mapslibvn-site-theme';
  const nut = document.getElementById('nut-theme');
  const dat = (toi: boolean) => document.documentElement.classList.toggle('dark', toi);
  nut?.addEventListener('click', () => {
    const toi = !document.documentElement.classList.contains('dark');
    dat(toi);
    try {
      localStorage.setItem(KHOA, toi ? 'dark' : 'light');
    } catch {
      // Chế độ riêng tư chặn localStorage — vẫn đổi cho phiên này.
    }
  });
</script>
```

Trong `Base.astro` thêm một `<script is:inline>` **trước** khi body render, để không nháy trắng:

```astro
<script is:inline>
  // Chạy đồng bộ trong <head>: đặt class trước lần vẽ đầu tiên, nếu không trang nháy sáng
  // rồi mới chuyển tối. Không dùng module vì module bị hoãn tới sau khi parse xong.
  try {
    const luu = localStorage.getItem('mapslibvn-site-theme');
    const toi = luu === 'dark' || (luu === null && matchMedia('(prefers-color-scheme: dark)').matches);
    if (toi) document.documentElement.classList.add('dark');
  } catch {}
</script>
```

- [ ] **Step 3: `Footer.astro`**

Bốn cột trên màn rộng, xếp dọc trên điện thoại: **Sản phẩm** (Tính năng, Bảng giá, Playground,
Tài liệu), **So sánh** (Google, VIETMAP), **Pháp lý** (Giấy phép & ghi nguồn, Điều khoản tenant —
trỏ sang `DOCS_URL`), **Liên hệ** (email hỗ trợ dạng `mailto:`, giờ hỗ trợ). Dòng cuối ghi nguồn
dữ liệu bắt buộc: `© OpenStreetMap contributors (ODbL)` và `Foursquare OS Places (Apache-2.0)` —
đây là nghĩa vụ giấy phép, không phải trang trí, nên nằm ở mọi trang.

- [ ] **Step 4: `Base.astro` đầy đủ**

```astro
---
import '../styles/global.css';
import Footer from '../components/Footer.astro';
import Header from '../components/Header.astro';
import SeoHead from '../components/SeoHead.astro';
import type { SeoTuyChon } from '../lib/seo';
import type { TrangMeta } from '../lib/trang';

interface Props {
  trang: TrangMeta;
  tuyChon?: SeoTuyChon;
  jsonLd?: readonly unknown[];
}
const { trang, tuyChon, jsonLd } = Astro.props;
---

<!doctype html>
<html lang="vi">
  <head>
    <SeoHead trang={trang} tuyChon={tuyChon} jsonLd={jsonLd} />
    <script is:inline>
      try {
        const luu = localStorage.getItem('mapslibvn-site-theme');
        const toi =
          luu === 'dark' || (luu === null && matchMedia('(prefers-color-scheme: dark)').matches);
        if (toi) document.documentElement.classList.add('dark');
      } catch {}
    </script>
  </head>
  <body>
    <a
      href="#noi-dung"
      class="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-[var(--radius-btn)] focus:bg-brand-700 focus:px-4 focus:py-2 focus:text-white"
    >
      Bỏ qua điều hướng
    </a>
    <Header />
    <main id="noi-dung"><slot /></main>
    <Footer />
  </body>
</html>
```

- [ ] **Step 5: `index.astro` dùng Base mới, build lại**

```astro
---
import Base from '../layouts/Base.astro';
import { TRANG } from '../lib/trang';
---

<Base trang={TRANG.trangChu}>
  <h1 class="mx-auto max-w-6xl px-4 py-12 text-3xl font-bold">{TRANG.trangChu.h1}</h1>
</Base>
```

Run:

```bash
pnpm --filter @mapslibvn/site build
pnpm --filter @mapslibvn/site typecheck
grep -o '<link rel="canonical"[^>]*>' apps/site/dist/index.html
grep -c 'application/ld+json' apps/site/dist/index.html
```

Expected: canonical là `https://mapslibvn-site.pages.dev/`; có ít nhất một khối JSON-LD; `astro check` sạch.

- [ ] **Step 6: Commit**

```bash
git add apps/site
git commit -m "$(cat <<'EOF'
feat(site): khung trang — SeoHead, Header có công tắc sáng/tối, Footer ghi nguồn, Base có skip-link

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `PricingCards`, `ComparisonTable`, `Faq`, `CodeTabs`

**Files:**
- Create: `apps/site/src/components/PricingCards.astro`, `ComparisonTable.astro`, `Faq.astro`, `CodeTabs.astro`, `Feature.astro`

Bốn component này là nơi duy nhất trong website đụng tới số liệu, nên chúng đọc `gia.ts` và
`@mapslibvn/catalog`, không nhận số qua props.

- [ ] **Step 1: `PricingCards.astro` — bốn thẻ, công tắc kỳ không cần JavaScript để hiện giá**

Mấu chốt: **render sẵn cả bốn kỳ vào `data-` attribute lúc build**, script chỉ đổi text. Trang
vẫn đúng giá tháng khi JavaScript tắt.

```astro
---
import { CONSOLE_URL } from '../../site.config.mjs';
import { bangGia, dinhDangVnd } from '../lib/gia';
import { PERIOD_MONTHS } from '@mapslibvn/catalog';

const goi = bangGia();
---

<div class="mx-auto max-w-6xl px-4">
  <fieldset class="mb-8 flex flex-wrap items-center gap-2">
    <legend class="mb-2 text-sm font-semibold text-[var(--text-muted)]">Kỳ thanh toán</legend>
    {
      PERIOD_MONTHS.map((months) => (
        <label class="inline-flex min-h-11 cursor-pointer items-center rounded-[var(--radius-btn)] border border-[var(--border)] px-4 text-sm font-semibold has-[:checked]:border-brand-700 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-700 dark:has-[:checked]:bg-brand-900 dark:has-[:checked]:text-brand-100">
          <input
            type="radio"
            name="ky"
            value={months}
            checked={months === 1}
            class="sr-only"
            data-ky
          />
          {months} tháng
        </label>
      ))
    }
    <p class="w-full text-sm text-[var(--text-muted)]">
      Giá nhân đơn theo số tháng, không có chiết khấu và không tự động trừ tiền định kỳ.
    </p>
  </fieldset>

  <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
    {
      goi.map((g) => (
        <article
          class:list={[
            'flex flex-col rounded-[var(--radius-card)] border bg-[var(--surface)] p-5',
            g.noiBat ? 'border-brand-700 shadow-lg' : 'border-[var(--border)]',
          ]}
        >
          {g.noiBat && (
            <p class="mb-2 inline-flex w-fit rounded-full bg-brand-700 px-2.5 py-0.5 text-xs font-semibold text-white">
              Được chọn nhiều nhất
            </p>
          )}
          <h3 class="text-lg font-bold">{g.ten}</h3>
          <p class="mt-3">
            <span
              class="text-3xl font-bold"
              data-gia
              data-gia-1={g.theoKy[1].vndHienThi}
              data-gia-3={g.theoKy[3].vndHienThi}
              data-gia-6={g.theoKy[6].vndHienThi}
              data-gia-12={g.theoKy[12].vndHienThi}
            >
              {g.theoKy[1].vndHienThi}
            </span>
            <span class="text-sm text-[var(--text-muted)]" data-ky-nhan>/ 1 tháng</span>
          </p>
          <p class="mt-1 text-sm text-[var(--text-muted)]">
            tham chiếu <span
              data-usd
              data-usd-1={g.theoKy[1].usdHienThi}
              data-usd-3={g.theoKy[3].usdHienThi}
              data-usd-6={g.theoKy[6].usdHienThi}
              data-usd-12={g.theoKy[12].usdHienThi}>{g.theoKy[1].usdHienThi}</span
            >
          </p>

          <ul class="mt-4 flex-1 space-y-2 text-sm">
            <li><strong>{g.placesHienThi}</strong> lượt Places</li>
            <li><strong>{g.directionsHienThi}</strong> lượt tính tuyến</li>
            {g.tranNgay && <li>Trần ngày: {g.tranNgay}</li>}
            <li>{g.ghiChuHan}</li>
            <li>{g.hoTroOnline ? 'Có hỗ trợ trực tuyến' : 'Hỗ trợ qua tài liệu'}</li>
          </ul>

          <a
            href={CONSOLE_URL}
            class:list={[
              'mt-5 inline-flex min-h-11 items-center justify-center rounded-[var(--radius-btn)] px-4 text-sm font-semibold',
              g.noiBat
                ? 'bg-brand-700 text-white hover:bg-brand-800'
                : 'border border-[var(--border)] hover:bg-brand-50 dark:hover:bg-brand-900',
            ]}
          >
            {g.tier === 'trial' ? 'Dùng thử miễn phí' : `Chọn ${g.ten}`}
          </a>
        </article>
      ))
    }
  </div>
</div>

<script>
  // Giá của cả bốn kỳ đã nằm sẵn trong data-*, nên script chỉ đổi chữ. JavaScript hỏng hay bị
  // chặn thì trang vẫn hiện đúng giá một tháng — số tiền không bao giờ phụ thuộc trình duyệt.
  const dat = (ky: string) => {
    for (const el of document.querySelectorAll<HTMLElement>('[data-gia]')) {
      el.textContent = el.dataset[`gia${ky}`] ?? el.textContent;
    }
    for (const el of document.querySelectorAll<HTMLElement>('[data-usd]')) {
      el.textContent = el.dataset[`usd${ky}`] ?? el.textContent;
    }
    for (const el of document.querySelectorAll<HTMLElement>('[data-ky-nhan]')) {
      el.textContent = `/ ${ky} tháng`;
    }
  };
  for (const radio of document.querySelectorAll<HTMLInputElement>('[data-ky]')) {
    radio.addEventListener('change', () => dat(radio.value));
  }
</script>
```

- [ ] **Step 2: `ComparisonTable.astro` — bảng thật kèm mọi chú thích bắt buộc**

```astro
---
import { COMPARISON } from '@mapslibvn/catalog';
import { comparisonAgeDays } from '@mapslibvn/catalog';
import { soSanh } from '../lib/gia';

const rows = soSanh();
const soNgay = comparisonAgeDays(new Date());
// Cảnh báo lúc BUILD, không phải lúc chạy: bảng giá đối thủ cũ hơn nửa năm thì phải đối chiếu lại
// trước khi tiếp tục quảng cáo bằng nó.
if (soNgay > 180) {
  console.warn(
    `[site] COMPARISON đã ${soNgay} ngày kể từ ${COMPARISON.checkedAt} — đối chiếu lại giá đối thủ trước khi phát hành.`,
  );
}
const ngayVn = COMPARISON.checkedAt.split('-').reverse().join('/');
---

<figure class="mx-auto max-w-6xl px-4">
  <div class="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)]">
    <table class="w-full border-collapse text-sm">
      <caption class="px-4 py-3 text-left font-semibold">
        Chi phí một tháng cho cùng một khối lượng gọi API, đối chiếu ngày {ngayVn}
      </caption>
      <thead>
        <tr class="bg-black/[0.03] dark:bg-white/[0.04]">
          <th scope="col" class="px-4 py-2 text-left">Khối lượng mỗi tháng</th>
          <th scope="col" class="px-4 py-2 text-right">MapsLibVN</th>
          <th scope="col" class="px-4 py-2 text-right">Google</th>
          <th scope="col" class="px-4 py-2 text-right">VIETMAP</th>
          <th scope="col" class="px-4 py-2 text-right">Thấp hơn Google</th>
        </tr>
      </thead>
      <tbody>
        {
          rows.map((row) => (
            <tr class="border-t border-[var(--border)]">
              <th scope="row" class="px-4 py-3 text-left font-normal">
                {row.workload}
                <span class="block text-xs text-[var(--text-muted)]">gói {row.ten}</span>
              </th>
              <td class="px-4 py-3 text-right font-semibold">{row.mapslibvnVndHienThi}</td>
              <td class="px-4 py-3 text-right">{row.googleVndHienThi}</td>
              <td class="px-4 py-3 text-right">{row.vietmapVndHienThi}</td>
              <td class="px-4 py-3 text-right">{row.reHonGoogle.toString().replace('.', ',')}%</td>
            </tr>
          ))
        }
      </tbody>
    </table>
  </div>

  <figcaption class="mt-4 space-y-2 text-sm text-[var(--text-muted)]">
    <p><strong>Giả định.</strong></p>
    <ul class="list-disc space-y-1 pl-5">
      {COMPARISON.assumptions.map((y) => <li>{y}</li>)}
    </ul>
    <p>{COMPARISON.disclaimer}</p>
    <p>
      Nguồn:
      {
        COMPARISON.sources.map((url, i) => (
          <>
            {i > 0 && ', '}
            <a class="underline" href={url} rel="nofollow noopener" target="_blank">
              {new URL(url).hostname}
            </a>
          </>
        ))
      }
    </p>
  </figcaption>
</figure>
```

- [ ] **Step 3: `Faq.astro` — không một dòng JavaScript**

Nhận `items: { hoi, dap }[]`, render `<details>`/`<summary>`. Trang gọi nó cũng truyền cùng mảng
đó vào `faqJsonLd()` để khối JSON-LD và nội dung nhìn thấy luôn khớp nhau — Google phạt khi lệch.

- [ ] **Step 4: `CodeTabs.astro` — ba tab ARIA, script 25 dòng**

Ba tab `Script tag`, `npm`, `React Native`; `role="tablist"`, `aria-selected`, `hidden` cho panel
không hoạt động, mũi tên trái phải đổi tab. Mã trong tab lấy nguyên từ `apps/docs` trang chủ để
hai nơi không dạy hai kiểu nhúng khác nhau. Khi JavaScript tắt, **tab đầu vẫn hiện** vì chỉ các
panel sau mới có `hidden`.

- [ ] **Step 5: `Feature.astro`** — thẻ tính năng: biểu tượng chữ, tiêu đề, một câu, một link.

- [ ] **Step 6: Build**

Run: `pnpm --filter @mapslibvn/site build && pnpm --filter @mapslibvn/site typecheck`
Expected: xanh. Chưa trang nào dùng bốn component này nên build chỉ chứng minh chúng biên dịch được.

- [ ] **Step 7: Commit**

```bash
git add apps/site/src/components
git commit -m "$(cat <<'EOF'
feat(site): PricingCards (giá 4 kỳ render sẵn), ComparisonTable, Faq, CodeTabs, Feature

Không React: công tắc kỳ và tab chạy bằng script vanilla; tắt JavaScript trang vẫn đúng giá tháng.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Trang chủ `/`

**Files:**
- Create: `apps/site/src/components/Hero.astro`
- Modify: `apps/site/src/pages/index.astro`

- [ ] **Step 1: `Hero.astro`**

Ba phần: câu mở đầu, hai nút, khối bản đồ.

Câu mở đầu **tính từ `soSanh()`**, không gõ số: lấy `Math.round(min)` và `Math.round(max)` của
`reHonGoogle` rồi ghép vào "thấp hơn Google từ 37 % đến 68 % ở ba mức dùng đã đối chiếu
14/09/2026". Ngay dưới có một dòng nhỏ dẫn tới `/bang-gia/#so-sanh` để người đọc kiểm được, vì
một tỷ lệ không có chỗ kiểm là quảng cáo suông.

Khối bản đồ: `<div>` tỉ lệ 16/9 **cao cố định** chứa ảnh `src/assets/ban-do-hero.png` (qua
`astro:assets`, `loading="eager"`, `fetchpriority="high"`) và một nút phủ lên "Bấm để tương tác".
Bấm nút thì thay bằng `<iframe src="{DOCS_URL}/playground.html?embed=1" loading="lazy">`. Chiều
cao cố định từ đầu nên không có CLS; iframe không bao giờ nằm trong đường LCP.

Ảnh chưa có ở task này — component nhận `poster` là optional, thiếu thì hiện nền
`bg-brand-50 dark:bg-brand-900` cùng kích thước. Task 11 tạo ảnh.

- [ ] **Step 2: `index.astro`**

Thứ tự khối, mỗi khối một `<section>` có `aria-labelledby`:

1. `Hero`
2. **Sáu tính năng** — `Feature` × 6, nội dung rút từ `apps/docs/src/content/docs/tinh-nang.md`:
   bản đồ nền Việt Nam, lớp POI 164 loại trong 13 nhóm, tìm kiếm và autocomplete, geocode nói
   thật độ chính xác, dẫn đường, bốn SDK. Mỗi thẻ có link sang trang tài liệu tương ứng ở `DOCS_URL`.
3. **Ba cách nhúng** — `CodeTabs`.
4. **Giá tóm tắt** — ba thẻ từ `tomTatGia()` cộng một câu về bản dùng thử, nút sang `/bang-gia/`.
5. **Vì sao rẻ hơn** — ba ý: dữ liệu mở không phải trả phí bản quyền, hạ tầng nhẹ (PMTiles đọc
   thẳng từ CDN), không bán thứ khách không dùng. Kèm một dòng trung thực: chỗ Google hơn là phủ
   toàn cầu và Street View, link sang `/so-sanh/google-maps-api/`.
6. **FAQ sáu câu** — `Faq` + `faqJsonLd` cùng mảng:
   - Tính lượt thế nào? → chỉ trừ request thành công, gồm kết quả rỗng và cache hit; lỗi 4xx/5xx không trừ.
   - Cấp thêm khoá có thêm hạn mức không? → không, hạn mức tính theo thuê bao.
   - Có hoá đơn VAT không? → giai đoạn này chỉ có biên nhận thanh toán; nói thẳng.
   - Dữ liệu từ đâu? → OpenStreetMap (ODbL) và Foursquare OS (Apache-2.0), phải giữ ghi nguồn.
   - Tự host được không? → được, link `/tu-host/` ở tài liệu.
   - Hết hạn mức thì sao? → API trả lỗi có cấu trúc, mua thêm lượt theo khối 1.000.
7. **CTA cuối** — nút sang console và nút sang tài liệu.

`jsonLd` của trang chủ: `[softwareApplicationJsonLd(), faqJsonLd(CAU_HOI)]`.

- [ ] **Step 3: Build và kiểm nhanh HTML**

```bash
pnpm --filter @mapslibvn/site build
grep -c "<h1" apps/site/dist/index.html
grep -o '"@type":"FAQPage"' apps/site/dist/index.html | head -1
grep -o '650.000đ' apps/site/dist/index.html | head -1
```

Expected: đúng **1** thẻ `<h1`; có `FAQPage`; có `650.000đ` (giá Starter đến từ catalog).

- [ ] **Step 4: Commit**

```bash
git add apps/site
git commit -m "$(cat <<'EOF'
feat(site): trang chủ — hero có bản đồ nạp trễ, 6 tính năng, 3 cách nhúng, giá tóm tắt, FAQ

Tỷ lệ "thấp hơn Google" tính từ COMPARISON lúc build, kèm link tới bảng kiểm được.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `/bang-gia/`, `/tinh-nang/`, `/lien-he/`, `404`

**Files:**
- Create: `apps/site/src/pages/bang-gia.astro`, `tinh-nang.astro`, `lien-he.astro`, `404.astro`

- [ ] **Step 1: `/bang-gia/`**

1. `h1` + một đoạn mở: tính theo lượt gọi API, không theo số người dùng.
2. `PricingCards`.
3. **Mua thêm lượt**: hai dòng từ `PLAN_CATALOG.addOns` — 1.000 lượt Places 26.000đ, 1.000 lượt
   tính tuyến 78.000đ; ghi rõ lượt mua thêm hết hạn cùng kỳ.
4. `<section id="so-sanh">` chứa `ComparisonTable`.
5. **FAQ giá** năm câu: VAT và hoá đơn; đổi gói giữa kỳ (kỳ mới bắt đầu sau kỳ hiện tại); hoàn
   tiền (xử lý ngoài hệ thống, liên hệ); quota tính thế nào; tiles và lượt mở bản đồ hiện nằm
   trong gói, chưa có trần công bố.
6. Dòng cuối dẫn `Điều khoản tenant` ở `DOCS_URL`.

`jsonLd`: `[softwareApplicationJsonLd(), faqJsonLd(...), breadcrumbJsonLd([Trang chủ, Bảng giá])]`.

- [ ] **Step 2: `/tinh-nang/`**

Sáu mục dài hơn trang chủ, mỗi mục một `<h2>`: bản đồ nền và chủ quyền Hoàng Sa – Trường Sa luôn
tiếng Việt; lớp POI 164 loại trong 13 nhóm (bảng rút gọn 13 nhóm, không chép cả 164 mã); tìm kiếm
chịu được cách viết không dấu, viết tắt và tên hành chính cũ; geocode trả `precision` và
`confidence` thay vì giả vờ chính xác; dẫn đường; bốn SDK. Mỗi mục kết bằng một link "đọc tiếp"
sang đúng trang ở `DOCS_URL`.

Cuối trang thêm mục **Chưa có gì** trung thực: chưa có Matrix, tối ưu đội xe, traffic trực tiếp,
Street View — nói trước đỡ mất thời gian đôi bên.

`jsonLd`: `[breadcrumbJsonLd(...)]`.

- [ ] **Step 3: `/lien-he/`**

Email hỗ trợ dạng `mailto:` (viết thẳng, không obfuscate — đây là email công khai của doanh
nghiệp); giờ hỗ trợ trực tuyến T2–T6 08:00–20:00, T7 và CN 08:00–17:00 giờ Việt Nam, chỉ cho
Professional và Business; ba link nhanh: tài liệu, playground, console. Một câu nói rõ chưa có
tổng đài điện thoại.

- [ ] **Step 4: `404.astro`**

`h1` từ `TRANG.khong404`, một câu giải thích, danh sách `NAV` để đi tiếp. Astro sinh
`dist/404.html`; Cloudflare Pages tự dùng nó. Sitemap đã loại `/404` ở Task 1.

- [ ] **Step 5: Build và kiểm**

```bash
pnpm --filter @mapslibvn/site build
for f in bang-gia tinh-nang lien-he; do echo "$f: h1=$(grep -c '<h1' apps/site/dist/$f/index.html)"; done
test -f apps/site/dist/404.html && echo "404.html có"
grep -o '"@type":"BreadcrumbList"' apps/site/dist/bang-gia/index.html | head -1
grep -o '26.000đ' apps/site/dist/bang-gia/index.html | head -1
```

Expected: mỗi trang đúng 1 `<h1`; có `404.html`; có `BreadcrumbList`; có `26.000đ`.

- [ ] **Step 6: Commit**

```bash
git add apps/site/src/pages
git commit -m "$(cat <<'EOF'
feat(site): trang bảng giá, tính năng, liên hệ và 404

Bảng giá có mua thêm lượt, bảng so sánh đối thủ kèm giả định/nguồn, FAQ nói thẳng về VAT.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Hai trang so sánh

**Files:**
- Create: `apps/site/src/pages/so-sanh/google-maps-api.astro`, `apps/site/src/pages/so-sanh/vietmap.astro`

Đây là hai trang mang từ khoá đắt nhất, nên chúng phải dài, cụ thể và **công bằng** — trang so
sánh nói xấu đối thủ thì mất uy tín với đúng nhóm người đọc kỹ thuật đang cân nhắc.

- [ ] **Step 1: `/so-sanh/google-maps-api/`**

Bố cục:

1. `h1` + đoạn mở nói rõ đây là so sánh của chính nhà cung cấp MapsLibVN, số liệu đối chiếu
   14/09/2026, ai cũng kiểm lại được bằng ba nguồn ở cuối bảng.
2. **Bảng chi phí** — `ComparisonTable`.
3. **Chỗ MapsLibVN hợp hơn**: chi phí ở ba mức đã đo; dữ liệu mở nên tự host được và không bị
   khoá vào một nhà cung cấp; tối ưu cho địa chỉ Việt Nam (cách viết không dấu, tên hành chính cũ
   và mới, nhãn chủ quyền luôn tiếng Việt); trả bằng VND qua chuyển khoản trong nước.
4. **Chỗ Google hơn** (bắt buộc có, viết thật): phủ toàn cầu; Street View và ảnh vệ tinh;
   traffic trực tiếp và ETA theo thời gian thực; Places Details với đánh giá và giờ mở cửa; hệ
   sinh thái công cụ và tài liệu lớn hơn nhiều; SLA doanh nghiệp.
5. **Khi nào nên chọn cái nào** — bảng hai cột dứt khoát, không lập lờ.
6. **Chuyển sang MapsLibVN mất gì** — thay SDK, đổi cách gọi `place_id`, không có Street View,
   thời gian tích hợp ước lượng.
7. FAQ ba câu + `faqJsonLd`.

`jsonLd`: `[breadcrumbJsonLd([Trang chủ, Bảng giá? không — Trang chủ, So sánh Google]), faqJsonLd(...)]`.

- [ ] **Step 2: `/so-sanh/vietmap/`**

Cùng khung, khác nội dung: VIETMAP tính theo transaction 50đ, có sản phẩm bản đồ nội địa lâu năm,
có dữ liệu giao thông và POI thương mại riêng; MapsLibVN khác ở chỗ dữ liệu mở, tự host được và
giá theo gói cố định. Nhấn rằng hai bên không hoàn toàn thay thế nhau.

- [ ] **Step 3: Build và kiểm**

```bash
pnpm --filter @mapslibvn/site build
for f in google-maps-api vietmap; do
  echo "$f: h1=$(grep -c '<h1' apps/site/dist/so-sanh/$f/index.html) ld=$(grep -o 'application/ld+json' apps/site/dist/so-sanh/$f/index.html | wc -l | tr -d ' ')"
done
grep -o 'developers.google.com' apps/site/dist/so-sanh/google-maps-api/index.html | head -1
```

Expected: mỗi trang 1 `<h1` và ≥ 3 khối JSON-LD; có link nguồn Google.

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/pages/so-sanh
git commit -m "$(cat <<'EOF'
feat(site): hai trang so sánh Google Maps Platform và VIETMAP

Mỗi trang có mục "chỗ đối thủ hơn" viết thật và bảng "khi nào nên chọn cái nào".

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Mục bài viết và ba bài đầu

**Files:**
- Create: `apps/site/src/content.config.ts`, `apps/site/src/components/Prose.astro`, `apps/site/src/pages/bai-viet/index.astro`, `apps/site/src/pages/bai-viet/[slug].astro`, ba file trong `apps/site/src/content/bai-viet/`
- Test: `apps/site/src/lib/bai-viet.test.ts`

- [ ] **Step 1: `content.config.ts`**

```ts
import { glob } from 'astro/loaders';
import { defineCollection, z } from 'astro:content';

const baiViet = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/bai-viet' }),
  schema: z.object({
    title: z.string().max(60),
    description: z.string().min(120).max(160),
    publishedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    tags: z.array(z.string()).min(1),
    /** Đặt true khi PHONG đã đọc và đồng ý đăng. Bài chưa duyệt không lên sitemap. */
    daDuyet: z.boolean().default(false),
  }),
});

export const collections = { baiViet };
```

Schema tự ép đúng ràng buộc SEO: `astro check` và `astro build` sẽ **fail** nếu một bài có
description 119 ký tự. Không cần test riêng cho việc đó.

- [ ] **Step 2: Trang danh sách và trang bài**

`bai-viet/index.astro`: lấy `getCollection('baiViet', ({ data }) => data.daDuyet)`, sắp theo
`publishedAt` giảm dần, mỗi mục là thẻ có tiêu đề, ngày kiểu Việt, mô tả, thẻ tag.

`bai-viet/[slug].astro`: `getStaticPaths` từ collection; render `<Prose>` bọc `<Content />`;
`jsonLd` là `[articleJsonLd({...}), breadcrumbJsonLd([Trang chủ, Bài viết, <tiêu đề>])]`;
`tuyChon={{ type: 'article', publishedAt }}`. Cuối bài có hộp CTA sang console.

Metadata SEO của trang bài **không** nằm trong `TRANG` (nó động), nên dựng một `TrangMeta` tại chỗ
từ frontmatter — đúng kiểu, nên `seoMeta` dùng lại được nguyên.

- [ ] **Step 3: Ba bài**

Mỗi bài 900–1.400 từ, tiếng Việt có dấu đầy đủ, `daDuyet: false` cho tới khi PHONG đọc.

**`chi-phi-google-maps-api-cho-doanh-nghiep-viet-nam-2026.md`** — từ khoá "chi phí Google Maps
API". Dàn ý: Google tính tiền theo SKU chứ không theo "một lần gọi bản đồ"; ba SKU hay làm hoá đơn
phình (Autocomplete tính theo request và theo phiên khác nhau, Geocoding, Directions); hạn mức
miễn phí theo từng SKU và vì sao nó hết nhanh hơn người ta tưởng; ba ví dụ khối lượng thật với số
lấy từ `COMPARISON`; bốn cách giảm chi phí mà **không** đổi nhà cung cấp (dùng phiên cho
Autocomplete, đệm kết quả, debounce 300 ms, chỉ gọi Geocoding khi thật cần); rồi mới nói khi nào
đổi nhà cung cấp là hợp lý. Bài phải hữu ích cả với người ở lại với Google — đó là điều làm nó
được đọc và được dẫn lại.

**`tu-host-ban-do-viet-nam-tu-du-lieu-mo.md`** — từ khoá "tự host bản đồ". Dàn ý: bốn mảnh của một
hệ bản đồ (tiles nền, lớp POI, tìm kiếm/geocode, dẫn đường); nguồn dữ liệu mở và nghĩa vụ giấy
phép ODbL với Apache-2.0; PMTiles đọc thẳng từ CDN bằng HTTP Range nên không cần máy chủ tile;
Valhalla cho dẫn đường; chi phí thật là vận hành và cập nhật dữ liệu chứ không phải máy chủ; khi
nào tự host hợp lý, khi nào nên mua. Kết bằng link `/tu-host/` ở tài liệu.

**`do-chinh-xac-geocode-dia-chi-viet-nam.md`** — từ khoá "geocoding địa chỉ Việt Nam". Dàn ý: địa
chỉ Việt Nam khó vì hẻm nhiều cấp, tên đường trùng, và đợt sắp xếp đơn vị hành chính 2025 làm tên
cũ và mới cùng lưu hành; vì sao trả một toạ độ trần là nói dối người dùng cuối; `precision` và
`confidence` nghĩa là gì và app nên vẽ khác nhau ra sao; ví dụ rơi về tâm phường; cách kiểm chất
lượng geocode của bất kỳ nhà cung cấp nào bằng một bộ địa chỉ của chính mình.

- [ ] **Step 4: Test nhỏ cho trang danh sách**

`apps/site/src/lib/bai-viet.test.ts` kiểm hàm sắp xếp và định dạng ngày tách riêng ra khỏi `.astro`:

```ts
import { describe, expect, it } from 'vitest';
import { ngayVn, sapTheoNgayMoi } from './bai-viet';

describe('bai-viet', () => {
  it('sắp bài mới nhất lên đầu', () => {
    const xs = [{ publishedAt: '2026-09-01' }, { publishedAt: '2026-09-18' }];
    expect(sapTheoNgayMoi(xs)[0]?.publishedAt).toBe('2026-09-18');
  });

  it('ngày hiển thị kiểu Việt', () => {
    expect(ngayVn('2026-09-18')).toBe('18/09/2026');
  });
});
```

Viết `apps/site/src/lib/bai-viet.ts` với đúng hai hàm đó.

- [ ] **Step 5: Build và kiểm**

```bash
npx vitest run apps/site/src/lib
pnpm --filter @mapslibvn/site build
ls apps/site/dist/bai-viet/
grep -o '"@type":"Article"' apps/site/dist/bai-viet/*/index.html | head -1
```

Expected: test xanh; ba thư mục bài; có `Article` JSON-LD. Vì `daDuyet: false`, trang danh sách
rỗng — đúng như thiết kế; đổi thành `true` sau khi PHONG duyệt (Task 14).

- [ ] **Step 6: Commit**

```bash
git add apps/site
git commit -m "$(cat <<'EOF'
feat(site): mục bài viết và ba bài đầu, chờ PHONG duyệt (daDuyet: false)

Schema Zod ép title ≤60 và description 120–160 ngay lúc build.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Ảnh — chụp bản đồ thật và sinh ảnh OG

**Files:**
- Create: `scripts/site-images.mjs`, `apps/site/src/assets/ban-do-hero.png`, `apps/site/public/og/*.png`, `apps/site/public/favicon.svg`
- Modify: `apps/site/src/components/Hero.astro` (gắn poster)

Ảnh OG tự vẽ bằng Playwright thay vì thuê dịch vụ: repo đã có Playwright, và ảnh sinh từ HTML thì
đổi tiêu đề chỉ cần chạy lại một lệnh.

- [ ] **Step 1: `scripts/site-images.mjs`**

Một script, hai việc, mỗi việc bọc try/catch riêng:

```js
#!/usr/bin/env node
// Sinh ảnh cho website: ảnh nền hero (chụp playground thật) và ảnh OG 1200×630 cho từng trang.
//   node scripts/site-images.mjs            — làm cả hai
//   node scripts/site-images.mjs --og       — chỉ ảnh OG (không cần mạng ngoài)
// Ảnh được commit vào repo: build của Pages không chạy Playwright.
```

- `--og`: với mỗi mục trong một bảng `{ ten, tieuDe, phu }`, dựng một HTML inline (nền
  `#1b3a6b`, chữ trắng Be Vietnam Pro tải từ `node_modules`, logo chữ "MapsLibVN"), `setViewportSize
  (1200, 630)`, `page.setContent(...)`, `screenshot({ path: 'apps/site/public/og/<ten>.png' })`.
  Bốn ảnh: `mac-dinh`, `trang-chu`, `bang-gia`, `so-sanh`.
- Mặc định thêm phần hero: mở `${DOCS_URL}/playground.html?embed=1`, viewport 1280×720, chờ
  `networkidle` cộng 3 giây cho tile vẽ xong, chụp vào `apps/site/src/assets/ban-do-hero.png`.
  **Không có mạng hoặc docs site chết thì in cảnh báo và thoát 0** — website vẫn dựng được, chỉ là
  hero hiện nền màu thay vì ảnh. Script không được chặn build.

Tên tệp OG phải khớp `TRANG[*].og` ở Task 2 (`/og/trang-chu.png`, `/og/bang-gia.png`,
`/og/mac-dinh.png`). Hai trang so sánh dùng `/og/so-sanh.png` — nhớ thêm `og` cho hai khoá đó
trong `trang.ts` nếu chưa có.

- [ ] **Step 2: `favicon.svg`**

Một SVG 32×32 viết tay: nền tròn `#1b3a6b`, chữ "M" trắng đậm. Nhẹ hơn mọi PNG và sắc nét ở mọi cỡ.

- [ ] **Step 3: Chạy và kiểm**

```bash
node scripts/site-images.mjs
ls -la apps/site/public/og/ apps/site/src/assets/
node -e "const s=require('fs').statSync('apps/site/public/og/trang-chu.png');console.log('OG', s.size, 'byte')"
```

Expected: bốn tệp OG, mỗi tệp dưới 200 KB; `ban-do-hero.png` có mặt (hoặc cảnh báo rõ nếu mạng
hỏng). Mở thử một ảnh OG bằng mắt xem chữ có dấu hiện đúng, không bị ô vuông.

- [ ] **Step 4: Gắn poster vào `Hero.astro`**

```astro
---
import { Image } from 'astro:assets';
import banDo from '../assets/ban-do-hero.png';
---
<Image
  src={banDo}
  alt="Bản đồ Việt Nam do MapsLibVN dựng, hiển thị khu vực trung tâm với các biểu tượng địa điểm"
  widths={[640, 960, 1280]}
  sizes="(max-width: 768px) 100vw, 960px"
  formats={['avif', 'webp']}
  loading="eager"
  fetchpriority="high"
  class="h-full w-full object-cover"
/>
```

Nếu Task 3 của script không tạo được ảnh, giữ nhánh nền màu và ghi vào file chứng cứ.

- [ ] **Step 5: Build và kiểm ảnh**

```bash
pnpm --filter @mapslibvn/site build
ls apps/site/dist/_astro/*.avif apps/site/dist/_astro/*.webp 2>/dev/null | head -4
grep -o 'fetchpriority="high"' apps/site/dist/index.html | head -1
```

Expected: có tệp avif/webp sinh ra; trang chủ có `fetchpriority="high"` trên ảnh hero.

- [ ] **Step 6: Commit**

```bash
git add scripts/site-images.mjs apps/site/public apps/site/src
git commit -m "$(cat <<'EOF'
feat(site): ảnh hero chụp từ playground thật và bốn ảnh OG 1200x630 sinh bằng Playwright

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: `robots.txt`, sitemap và ngân sách hiệu năng

**Files:**
- Create: `apps/site/src/pages/robots.txt.ts`
- Test: `apps/site/src/lib/robots.test.ts`

- [ ] **Step 1: Viết test (đỏ)**

```ts
import { describe, expect, it } from 'vitest';
import { noiDungRobots } from './robots';

describe('robots.txt', () => {
  it('cho phép mọi bot và trỏ sitemap tuyệt đối', () => {
    const txt = noiDungRobots();
    expect(txt).toContain('User-agent: *');
    expect(txt).toContain('Allow: /');
    expect(txt).toContain('Sitemap: https://mapslibvn-site.pages.dev/sitemap-index.xml');
  });

  it('không chặn gì — website này không có khu vực riêng tư', () => {
    expect(noiDungRobots()).not.toContain('Disallow: /');
  });
});
```

- [ ] **Step 2: Viết `src/lib/robots.ts` và `src/pages/robots.txt.ts`**

```ts
// src/lib/robots.ts
import { SITE_URL } from '../../site.config.mjs';

export function noiDungRobots(): string {
  return [
    'User-agent: *',
    'Allow: /',
    '',
    `Sitemap: ${SITE_URL}/sitemap-index.xml`,
    '',
  ].join('\n');
}
```

```ts
// src/pages/robots.txt.ts
import type { APIRoute } from 'astro';
import { noiDungRobots } from '../lib/robots';

export const GET: APIRoute = () =>
  new Response(noiDungRobots(), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
```

- [ ] **Step 3: Kiểm sitemap và đếm JavaScript**

```bash
npx vitest run apps/site/src/lib
pnpm --filter @mapslibvn/site build
cat apps/site/dist/robots.txt
cat apps/site/dist/sitemap-0.xml | grep -o '<loc>[^<]*</loc>' | sed 's/<[^>]*>//g'
echo "--- JS của trang chủ ---"
node -e '
const {readdirSync,statSync,readFileSync}=require("fs");
const {gzipSync}=require("zlib");
const html=readFileSync("apps/site/dist/index.html","utf8");
const tep=[...html.matchAll(/src="(\/_astro\/[^"]+\.js)"/g)].map(m=>m[1]);
let tong=0;
for(const t of tep){const b=readFileSync("apps/site/dist"+t);tong+=gzipSync(b).length;}
console.log(tep.length+" tệp JS, tổng gzip "+tong+" byte");
'
```

Expected: `robots.txt` đúng nội dung; sitemap liệt kê 7 trang (không có `/404/`, không có bài
chưa duyệt); **tổng JavaScript trang chủ dưới 15.000 byte gzip** — không có React nên con số này
phải nhỏ hơn hẳn ngân sách 60 KB của spec. Lớn hơn nghĩa là có gì đó kéo cả một thư viện vào;
tìm ra trước khi đi tiếp.

- [ ] **Step 4: Commit**

```bash
git add apps/site
git commit -m "$(cat <<'EOF'
feat(site): robots.txt trỏ sitemap tuyệt đối; kiểm ngân sách JavaScript trang chủ

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Playwright — khoá các bất biến SEO trên HTML đã build

**Files:**
- Create: `apps/site/playwright.config.ts`, `apps/site/e2e/seo.spec.ts`, `apps/site/e2e/trang.spec.ts`

Test chạy trên `astro preview` của bản build thật, nên nó kiểm đúng thứ bot sẽ thấy.

- [ ] **Step 1: `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:4322', trace: 'retain-on-failure' },
  webServer: {
    // Chạy trên bản BUILD chứ không phải dev: dev server không sinh sitemap, không inline CSS,
    // và không phải thứ bot sẽ tải về.
    command: 'pnpm build && pnpm preview',
    url: 'http://localhost:4322/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
```

- [ ] **Step 2: `e2e/seo.spec.ts`**

```ts
import { expect, test } from '@playwright/test';

const TRANG = [
  '/',
  '/tinh-nang/',
  '/bang-gia/',
  '/so-sanh/google-maps-api/',
  '/so-sanh/vietmap/',
  '/bai-viet/',
  '/lien-he/',
];

for (const path of TRANG) {
  test(`SEO cơ bản: ${path}`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);

    // Đúng MỘT h1. Hai h1 làm bot không biết trang nói về cái gì.
    await expect(page.locator('h1')).toHaveCount(1);

    const title = await page.title();
    expect(title.length).toBeGreaterThan(10);
    expect(title.length).toBeLessThanOrEqual(60);

    const desc = await page.locator('meta[name="description"]').getAttribute('content');
    expect(desc?.length ?? 0).toBeGreaterThanOrEqual(120);
    expect(desc?.length ?? 0).toBeLessThanOrEqual(160);

    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical).toBe(`https://mapslibvn-site.pages.dev${path}`);

    await expect(page.locator('meta[property="og:image"]')).toHaveCount(1);
    await expect(page.locator('html')).toHaveAttribute('lang', 'vi');

    // Mọi khối JSON-LD phải parse được; một dấu phẩy thừa là Google bỏ cả khối.
    const khoi = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(khoi.length).toBeGreaterThan(0);
    for (const ld of khoi) {
      const doc = JSON.parse(ld);
      expect(doc['@context']).toBe('https://schema.org');
      expect(typeof doc['@type']).toBe('string');
    }
  });
}

test('robots.txt và sitemap trỏ đúng nhau', async ({ request }) => {
  const robots = await request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  const txt = await robots.text();
  expect(txt).toContain('Sitemap: https://mapslibvn-site.pages.dev/sitemap-index.xml');

  const sitemap = await request.get('/sitemap-0.xml');
  expect(sitemap.status()).toBe(200);
  const xml = await sitemap.text();
  expect(xml).toContain('<loc>https://mapslibvn-site.pages.dev/bang-gia/</loc>');
  // 404 không được nằm trong sitemap — gửi bot vào trang lỗi là tự hạ chất lượng.
  expect(xml).not.toContain('/404');
});

test('trang giá: số tiền khớp catalog, và vẫn đúng khi tắt JavaScript', async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto('/bang-gia/');
  await expect(page.getByText('650.000đ').first()).toBeVisible();
  await expect(page.getByText('10.400.000đ').first()).toBeVisible();
  await ctx.close();
});

test('công tắc kỳ đổi giá đúng khi có JavaScript', async ({ page }) => {
  await page.goto('/bang-gia/');
  await expect(page.getByText('650.000đ').first()).toBeVisible();
  await page.getByRole('radio', { name: '3 tháng' }).check();
  await expect(page.getByText('1.950.000đ').first()).toBeVisible();
});
```

- [ ] **Step 3: `e2e/trang.spec.ts`**

- Mọi link nội bộ trên bảy trang trả 200 (thu link bằng `page.$$eval('a[href^="/"]')`, lọc trùng,
  `request.get` từng cái) — bắt link chết trước khi bot bắt.
- `/khong-co-that/` trả 404 và trang 404 có `h1`.
- Bấm nút "Bấm để tương tác" ở hero thì `<iframe>` xuất hiện; trước khi bấm **không có iframe nào**
  (khoá lại lời hứa "bản đồ không nằm trong đường LCP").
- Ngăn kéo không có, nhưng điều hướng ở khung hẹp 390 px vẫn bấm được: đặt
  `page.setViewportSize({ width: 390, height: 844 })` rồi bấm "Bảng giá" và kiểm URL.

- [ ] **Step 4: Chạy**

```bash
pnpm test:site-e2e
```

Expected: toàn bộ xanh. Playwright cần trình duyệt: nếu báo thiếu, chạy
`pnpm --filter @mapslibvn/site exec playwright install chromium`.

- [ ] **Step 5: Commit**

```bash
git add apps/site/playwright.config.ts apps/site/e2e
git commit -m "$(cat <<'EOF'
test(site): e2e khoá bất biến SEO — 1 h1, độ dài title/description, canonical, JSON-LD parse được

Thêm hai bài quan trọng: giá vẫn đúng khi tắt JavaScript, và hero không nạp iframe trước khi bấm.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Deploy, tài liệu, bốn tầng xanh và bàn giao

**Files:**
- Create: `.github/workflows/deploy-site.yml`, `docs/evidence/commerce/2026-09-18-pha-1-website.md`
- Modify: `docs/DEVLOG.md`, `README.md`

- [ ] **Step 1: `deploy-site.yml`**

```yaml
name: Deploy Site
on:
  push:
    branches: [main]
    paths: ['apps/site/**', 'packages/catalog/**', 'packages/ui/**', 'pnpm-lock.yaml']
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
      - run: pnpm --filter @mapslibvn/site build
      - run: pnpm --filter @mapslibvn/site exec wrangler pages deploy dist --project-name mapslibvn-site
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

`wrangler` không nằm trong `apps/site/devDependencies` mà ở gốc repo; `pnpm exec` tìm được. Nếu
CI báo thiếu, thêm `"wrangler": "^4.132.0"` vào devDependencies của site.

- [ ] **Step 2: README và DEVLOG**

`README.md` thêm một mục ngắn "Website" nói địa chỉ, lệnh `pnpm --filter @mapslibvn/site dev`, và
nhắc đổi tên miền là sửa `apps/site/site.config.mjs` rồi thêm `_redirects`.

`docs/DEVLOG.md` thêm mục 19 theo khuôn mục 18: làm gì, lệch spec chỗ nào, cổng nào đã chạy.

- [ ] **Step 3: Bốn tầng xanh**

```bash
pnpm lint
npx turbo run typecheck --force
npx vitest run apps/site/src
pnpm test
pnpm test:site-e2e
pnpm test:admin-e2e
```

Expected: tất cả xanh. `pnpm test` giờ có thêm bước build site, nên nó cũng là cổng chặn.
Cổng nào đỏ thì dừng, sửa, chạy lại — không ghi "xanh" khi chưa thấy.

- [ ] **Step 4: Ghi chứng cứ**

`docs/evidence/commerce/2026-09-18-pha-1-website.md` với: bảng cổng và số thật; số byte JavaScript
trang chủ; danh sách URL trong sitemap; ảnh OG đã sinh và kích thước; **mục chờ PHONG** gồm bốn
việc tay: tạo project Pages `mapslibvn-site`, duyệt ba bài viết (đổi `daDuyet: true`), xác thực
Search Console và Bing rồi gửi sitemap, chạy Lighthouse mobile trên bản deploy và dán số vào đây.

- [ ] **Step 5: Commit và bàn giao**

```bash
git add .github/workflows/deploy-site.yml docs README.md
git commit -m "$(cat <<'EOF'
docs(site): deploy-site.yml, DEVLOG mục 19, chứng cứ pha 1

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

Báo PHONG trước khi push:

- Push kích `Deploy Site` — nhưng workflow sẽ **đỏ cho tới khi PHONG tạo project Pages
  `mapslibvn-site`** trong tài khoản Cloudflare. Tạo trước rồi hãy push, hoặc chấp nhận một lần đỏ
  rồi bấm chạy lại.
- Ba bài viết đang `daDuyet: false` nên chưa lên sitemap; PHONG đọc xong thì đổi cờ, một commit.
- Lighthouse mobile chỉ đo được trên bản deploy thật; số ở máy không thay thế được.
- Việc kế tiếp: plan pha 2 (console, migration `0020`).

---

## Self-review

**Phủ spec mục 11:** công nghệ Astro tĩnh (Task 1) · cấu trúc thư mục (Task 1, 5, 6) · bảy trang
(Task 7, 8, 9, 10) · SEO kỹ thuật đủ bảy gạch đầu dòng của 11.3 — title/description/canonical
(Task 2, 3, 13), JSON-LD năm loại (Task 3), sitemap và robots (Task 12), HTML ngữ nghĩa và một h1
(Task 5, 13), hiệu năng và ngân sách JS (Task 12), ảnh AVIF/WebP và font swap (Task 11, Task 1
Step 5), đổi tên miền qua một biến (Task 1 Step 1, Task 14) · thiết kế 11.4 (Task 1 Step 5 cỡ chữ
16 px, Task 5 vùng chạm 44 px, bản tối) · deploy 11.5 (Task 14). Mục 16 "việc tay chặn pha 1" ghi
ở Task 14 Step 4.

**Ba chỗ lệch spec có chủ ý, đều phải ghi vào DEVLOG:**

1. **Không dùng React và `@astrojs/react`.** Spec viết "island React chỉ ở chỗ tương tác". Cả bốn
   chỗ tương tác của site (tab mã, công tắc kỳ, sáng/tối, nạp bản đồ) làm bằng script vanilla dưới
   30 dòng. React + hydration tốn khoảng 45 KB gzip mỗi trang, trong khi chính spec đặt ngân sách
   60 KB và mục tiêu LCP 2,5 giây. Bỏ React phục vụ đúng mục tiêu spec chứ không đi ngược nó, và
   bỏ luôn một dependency. Task 12 có phép đo chặn hồi quy.
2. **Ngân sách JavaScript siết từ 60 KB xuống 15 KB gzip** cho trang chủ, vì hệ quả của điểm 1.
3. **`TBT` thay `INP`** như đã sửa trong spec: Lighthouse phòng lab không đo được INP.

**Không placeholder.** Ba chỗ là văn xuôi dài (hai trang so sánh, ba bài viết) được giao bằng dàn
ý bắt buộc gồm từng mục, số liệu phải dùng và ràng buộc "phải nói cả chỗ đối thủ hơn" — đó là mức
chi tiết đúng cho văn bản, không phải chỗ trống. Mọi đoạn mã đều đầy đủ.

**Nhất quán kiểu và tên:** `TrangMeta`/`TRANG`/`NAV`/`TrangKey` khai Task 2, dùng nguyên ở Task 3,
5, 7, 8, 9, 13. `seoMeta(trang, tuyChon)` hai tham số — mọi chỗ gọi đều đúng thứ tự. `SeoTuyChon`
xuất từ `seo.ts` và import trong `SeoHead.astro` lẫn `Base.astro`. `bangGia()/tomTatGia()/soSanh()`
khai Task 4, dùng Task 6 và 7. `SITE_URL/CONSOLE_URL/DOCS_URL/SUPPORT_EMAIL/BRAND` khai Task 1
Step 1, dùng ở `seo.ts`, `Header`, `Footer`, `robots.ts`, `site-images.mjs`. Tên tệp OG trong
`TRANG` (Task 2) khớp tên script sinh ra (Task 11) — Task 11 Step 1 nhắc kiểm lại đúng chỗ này.

**Rủi ro còn lại và chỗ chặn:** tên tệp font Fontsource sai → Task 1 Step 5 có bước `ls` trước khi
viết; `astro check` không chịu import `.mjs` → Task 3 Step 4 chỉ đúng hai thứ phải kiểm
(`allowJs`, `include`); Playwright không chụp được playground → Task 11 Step 1 cho phép thoát 0 và
hero tự lùi về nền màu; project Pages chưa tồn tại → Task 14 nói trước để PHONG tạo.
