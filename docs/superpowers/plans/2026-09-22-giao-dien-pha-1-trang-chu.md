# Giao diện mới — Pha 1: trang chủ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng trang chủ mới theo spec `2026-09-22-thiet-ke-lai-giao-dien-design.md` mục 5 và 7: hero căn giữa, bản đồ trải ngang nạp khi cuộn tới, bento sáu ô, bốn cách nhúng, giá bốn thẻ, FAQ, CTA, footer — trên nền token và thang chữ của pha 0. Các trang con chưa đụng (pha 2).

**Architecture:** Tách các khối dùng lại thành component Astro nhỏ, mỗi tệp một việc (`Nut`, `Nhan`, `The`, `SoLieu`, `Bento`/`BentoO`, `BanDoSong`); trang chủ chỉ ghép khối và truyền nội dung. Không React, không tệp JS ngoài; hai script inline nhỏ (bản đồ, tab) nằm trong component. Số liệu đọc từ `@mapslibvn/catalog` qua `src/lib/gia.ts` như hiện nay.

**Tech Stack:** Astro 7 (`astro:assets` Picture), Tailwind v4 với token pha 0, vitest, Playwright, Playwright trong `scripts/site-images.mjs` để chụp ảnh bản đồ tối.

**Tiền điều kiện:** plan pha 0 đã chạy xong trên nhánh `feat/giao-dien-moi` (token mới, lớp `t-*`, không còn `brand-*`, site tối mặc định). Lệnh chạy từ gốc repo trừ khi ghi khác.

**Khác spec, có lý do:**
- Bản đồ nạp khi **người dùng cuộn lần đầu và khối đã lộ ≥ 25 %** (không chỉ `rootMargin`): ở 1280×720 khối bản đồ đã nằm trong viewport lúc mở trang, dùng `rootMargin` thuần thì nó nạp ngay và phá đúng lý do PHONG chọn "nạp khi cuộn tới". Có thêm nút "Mở bản đồ tương tác" cho ai không cuộn.
- Ô tìm kiếm trong ảnh chỗ giữ dùng **ba gợi ý thật đọc từ production** ở Task 6 (không chép sẵn tên vào plan để không bịa).

---

## Tệp đụng tới

| Tệp | Việc |
|---|---|
| `apps/site/src/lib/chu.ts`, `chu.test.ts` | Mới: `laAscii()` |
| `apps/site/src/components/Nhan.astro`, `Nut.astro`, `The.astro`, `SoLieu.astro`, `Bento.astro`, `BentoO.astro`, `BanDoSong.astro` | Mới |
| `apps/site/src/components/Hero.astro` | Viết lại: căn giữa, không ảnh |
| `apps/site/src/components/CodeTabs.astro`, `Faq.astro`, `Header.astro`, `Footer.astro` | Đổi lớp theo token + thang chữ |
| `apps/site/src/components/Feature.astro` | Xoá (thay bằng `BentoO`) |
| `apps/site/src/pages/index.astro` | Viết lại theo 9 khối |
| `apps/site/src/lib/trang.ts` | h1 trang chủ ngắn lại |
| `apps/site/src/assets/ban-do-hero-dark.jpg` | Mới, chụp từ playground `style=dark` |
| `scripts/site-images.mjs` | `--hero` chụp cả hai theme, URL `/playground?embed=1&style=` |
| `apps/site/e2e/trang.spec.ts` | Bài bản đồ, bento, bản sáng |
| `docs/DEVLOG.md`, `docs/evidence/site-redesign/pha-1/` | Nhật ký, ảnh |

---

### Task 1: `laAscii` — chọn font cho nhãn

**Files:**
- Create: `apps/site/src/lib/chu.ts`, `apps/site/src/lib/chu.test.ts`

- [ ] **Step 1: Viết test (đỏ)**

`apps/site/src/lib/chu.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { laAscii } from './chu';

describe('laAscii', () => {
  it('chuỗi ASCII in được → true (an toàn cho JetBrains Mono)', () => {
    expect(laAscii('SDK')).toBe(true);
    expect(laAscii('$ npm i @mapslibvn/web')).toBe(true);
    expect(laAscii('37-68%')).toBe(true);
  });

  it('có dấu tiếng Việt hoặc ký hiệu ngoài ASCII → false', () => {
    expect(laAscii('TÍNH NĂNG')).toBe(false);
    // Gạch ngang dài U+2013 không có trong subset latin của font mono.
    expect(laAscii('37–68%')).toBe(false);
    expect(laAscii('Đ')).toBe(false);
  });

  it('rỗng → false', () => {
    expect(laAscii('')).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy, đỏ**

```bash
pnpm exec vitest run apps/site/src/lib/chu.test.ts
```

Expected: FAIL "Cannot find module './chu'".

- [ ] **Step 3: Viết chu.ts**

```ts
/**
 * Chuỗi chỉ gồm ký tự ASCII in được (U+0020–U+007E). Chỉ chuỗi như vậy mới được đặt trong
 * JetBrains Mono: font này thiếu dải Latin Extended Additional nên dấu tiếng Việt lệch hoặc rơi
 * font (spec 22/09 mục 4.2). Nhãn có dấu dùng Be Vietnam Pro.
 */
export const laAscii = (chu: string): boolean => /^[\x20-\x7e]+$/.test(chu);
```

- [ ] **Step 4: Chạy, xanh**

```bash
pnpm exec vitest run apps/site/src/lib/chu.test.ts
```

Expected: PASS 3.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/lib/chu.ts apps/site/src/lib/chu.test.ts
git commit -m "feat(site): laAscii quyết định nhãn nào được dùng chữ máy"
```

---

### Task 2: Bốn component nguyên tử — `Nhan`, `Nut`, `The`, `SoLieu`

**Files:**
- Create: `apps/site/src/components/Nhan.astro`, `Nut.astro`, `The.astro`, `SoLieu.astro`

- [ ] **Step 1: Nhan.astro**

```astro
---
import { laAscii } from '../lib/chu';

/**
 * Nhãn viết hoa nhỏ đặt trên tiêu đề hoặc trong ô bento. ASCII → chữ máy (t-mono-label), có dấu →
 * Be Vietnam Pro (t-nhan). `noiBat` tô màu nhấn: chỉ dùng cho nhãn mở đầu trang (spec mục 6).
 */
interface Props {
  chu: string;
  noiBat?: boolean | undefined;
  class?: string | undefined;
}

const { chu, noiBat = false, class: lop = '' } = Astro.props;
---

<span class:list={[laAscii(chu) ? 't-mono-label' : 't-nhan', noiBat && 'text-accent-text', lop]}>
  {chu}
</span>
```

- [ ] **Step 2: Nut.astro**

```astro
---
/**
 * Nút hoặc link dạng nút. Đây là NƠI DUY NHẤT trong site viết lớp màu của nút; trang và component
 * khác chỉ chọn `kieu`. `chinh` là màu nhấn — mỗi màn hình chỉ nên có một nút `chinh` (spec 4.1).
 */
interface Props {
  href?: string | undefined;
  kieu?: 'chinh' | 'phu' | 'mo' | undefined;
  co?: 'nho' | 'vua' | 'lon' | undefined;
  id?: string | undefined;
  target?: '_blank' | undefined;
  rel?: string | undefined;
  class?: string | undefined;
}

const { href, kieu = 'chinh', co = 'vua', id, target, rel, class: lop = '' } = Astro.props;

const CHUNG =
  'inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-btn)] font-semibold transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
const KIEU = {
  chinh: 'bg-accent text-accent-ink hover:brightness-95',
  phu: 'border border-border bg-transparent text-text hover:border-border-strong hover:bg-accent-soft',
  mo: 'text-muted hover:bg-accent-soft hover:text-text',
} as const;
const CO = { nho: 'px-3 text-sm sm:px-4', vua: 'px-5 text-[15px]', lon: 'min-h-12 px-6 text-base' } as const;
const lopDu = [CHUNG, KIEU[kieu], CO[co], lop];
---

{
  href ? (
    <a href={href} id={id} target={target} rel={rel} class:list={lopDu}>
      <slot />
    </a>
  ) : (
    <button type="button" id={id} class:list={lopDu}>
      <slot />
    </button>
  )
}
```

- [ ] **Step 3: The.astro**

```astro
---
/**
 * Thẻ có viền. `nen="surface-2"` cho ô bento và khối mã (nổi trên nền surface), `noiBat` viền màu
 * nhấn cho gói được chọn nhiều nhất. Không bóng đổ ở bản tối (spec 4.3): viền là cách tách khối.
 */
interface Props {
  as?: 'article' | 'div' | 'li' | 'section' | undefined;
  nen?: 'surface' | 'surface-2' | undefined;
  noiBat?: boolean | undefined;
  class?: string | undefined;
  id?: string | undefined;
}

const { as: Tag = 'div', nen = 'surface', noiBat = false, class: lop = '', id } = Astro.props;
---

<Tag
  id={id}
  class:list={[
    'rounded-[var(--radius-card)] border p-5 transition-colors duration-150 sm:p-6',
    nen === 'surface' ? 'bg-surface' : 'bg-surface-2',
    noiBat ? 'border-accent' : 'border-border hover:border-border-strong',
    lop,
  ]}
>
  <slot />
</Tag>
```

- [ ] **Step 4: SoLieu.astro**

```astro
---
import Nhan from './Nhan.astro';

/** Con số nổi bật (thang stat, màu nhấn) kèm nhãn và một dòng phụ. */
interface Props {
  so: string;
  nhan: string;
  phu?: string | undefined;
}

const { so, nhan, phu } = Astro.props;
---

<div>
  <p class="t-stat text-accent">{so}</p>
  <p class="mt-2"><Nhan chu={nhan} /></p>
  {phu && <p class="t-small mt-1 text-muted">{phu}</p>}
</div>
```

- [ ] **Step 5: astro check**

```bash
pnpm --filter @mapslibvn/site typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/site/src/components/Nhan.astro apps/site/src/components/Nut.astro apps/site/src/components/The.astro apps/site/src/components/SoLieu.astro
git commit -m "feat(site): component nguyên tử Nhan, Nut, The, SoLieu"
```

---

### Task 3: Lưới bento — `Bento`, `BentoO`

**Files:**
- Create: `apps/site/src/components/Bento.astro`, `apps/site/src/components/BentoO.astro`

- [ ] **Step 1: Bento.astro**

```astro
---
/** Lưới 12 cột, gap 16 px (spec 4.3). Ô con là BentoO. */
interface Props {
  class?: string | undefined;
}
const { class: lop = '' } = Astro.props;
---

<div class:list={['grid grid-cols-12 gap-4', lop]}>
  <slot />
</div>
```

- [ ] **Step 2: BentoO.astro**

```astro
---
import Nhan from './Nhan.astro';
import The from './The.astro';

/**
 * Một ô bento: nhãn (tuỳ chọn), tiêu đề h3, mô tả (slot mặc định), minh hoạ (slot `minh-hoa`),
 * link "→". `span` là số cột ở ≥ 1024 px; `spanNho` ở dưới đó (mặc định trọn hàng). Tên lớp viết
 * đủ trong bảng để Tailwind quét được.
 */
interface Props {
  span: 4 | 8 | 12;
  spanNho?: 6 | 12 | undefined;
  tieuDe: string;
  href: string;
  nhanLink: string;
  nhan?: string | undefined;
}

const { span, spanNho = 12, tieuDe, href, nhanLink, nhan } = Astro.props;
const SPAN = { 4: 'lg:col-span-4', 8: 'lg:col-span-8', 12: 'lg:col-span-12' } as const;
const SPAN_NHO = { 6: 'col-span-6', 12: 'col-span-12' } as const;
---

<The as="article" nen="surface-2" class:list={[SPAN_NHO[spanNho], SPAN[span], 'flex flex-col']}>
  {nhan && <p class="mb-3"><Nhan chu={nhan} /></p>}
  <h3 class="t-h3">{tieuDe}</h3>
  <div class="mt-3 text-muted"><slot /></div>
  <div class="mt-4 flex-1"><slot name="minh-hoa" /></div>
  <a
    href={href}
    class="mt-4 inline-flex min-h-11 items-center self-start font-semibold text-accent-text hover:underline"
  >
    {nhanLink} →
  </a>
</The>
```

- [ ] **Step 3: astro check + commit**

```bash
pnpm --filter @mapslibvn/site typecheck
git add apps/site/src/components/Bento.astro apps/site/src/components/BentoO.astro
git commit -m "feat(site): lưới bento 12 cột và ô BentoO"
```

Expected: 0 errors trước khi commit.

---

### Task 4: Script chụp ảnh bản đồ tối, sinh `ban-do-hero-dark.jpg`

**Files:**
- Modify: `scripts/site-images.mjs`
- Create: `apps/site/src/assets/ban-do-hero-dark.jpg` (sinh ra), cập nhật `ban-do-hero.jpg`

- [ ] **Step 1: Đổi hằng và hàm chụp**

Trong `scripts/site-images.mjs`, thay dòng khai `ANH_HERO`:

```js
// Hai ảnh chỗ giữ cho khối bản đồ trải ngang: bản tối là mặc định của site, bản sáng cho ai chọn
// sáng. Playground nhận `style=dark|light` qua URL (playground-lib.js `fromSearchParams`).
const ANH_HERO = [
  { tep: resolve(GOC, 'apps/site/src/assets/ban-do-hero.jpg'), style: 'light' },
  { tep: resolve(GOC, 'apps/site/src/assets/ban-do-hero-dark.jpg'), style: 'dark' },
];
```

Thay toàn bộ hàm `chupHero`:

```js
/** @param {Chromium} chromium */
async function chupHero(chromium) {
  const { DOCS_URL } = await import('../apps/site/site.config.mjs');
  const trinhDuyet = await chromium.launch();
  try {
    for (const { tep, style } of ANH_HERO) {
      await mkdir(dirname(tep), { recursive: true });
      // 1600×700 @1: khối trải ngang cao 520 px trong khung 1200, ảnh gốc rộng hơn một bậc là đủ.
      const trang = await trinhDuyet.newPage({ viewport: { width: 1600, height: 700 } });
      // `load` + chờ cố định chứ không `networkidle`: playground có polling nhẹ, networkidle có
      // thể không bao giờ tới.
      await trang.goto(`${DOCS_URL}/playground?embed=1&style=${style}`, {
        waitUntil: 'load',
        timeout: 60_000,
      });
      await trang.waitForTimeout(6_000);
      await trang.screenshot({ path: tep, type: 'jpeg', quality: 82 });
      const { size } = await stat(tep);
      console.log(`  ${basename(tep)} (${style}) — ${Math.round(size / 1024)} KB`);
    }
  } finally {
    await trinhDuyet.close();
  }
}
```

Trong `main`, thông báo lỗi hero đổi chữ cho khớp:

```js
      console.warn('  Website vẫn dựng được; khối bản đồ sẽ hiện nền màu thay vì ảnh.');
```

(giữ nguyên dòng đó — chỉ xác nhận vẫn còn.)

- [ ] **Step 2: Typecheck script và chạy chụp**

```bash
pnpm exec tsc -p tsconfig.scripts.json
node scripts/site-images.mjs --hero
ls -la apps/site/src/assets/
```

Expected: tsc 0 lỗi; in `ban-do-hero.jpg (light) — … KB` và `ban-do-hero-dark.jpg (dark) — … KB`; hai tệp JPEG, mỗi tệp dưới 400 KB.

- [ ] **Step 3: Nhìn ảnh tối**

Mở `apps/site/src/assets/ban-do-hero-dark.jpg` (Read tool hoặc `open`). Phải là bản đồ nền đen, nhãn đường sáng, không loang lổ ô chưa tải. Nếu còn ô trắng: tăng `waitForTimeout` lên 9000 và chụp lại.

- [ ] **Step 4: Commit**

```bash
git add scripts/site-images.mjs apps/site/src/assets/ban-do-hero.jpg apps/site/src/assets/ban-do-hero-dark.jpg
git commit -m "feat(site): chụp ảnh chỗ giữ bản đồ cả hai theme từ playground"
```

---

### Task 5: `BanDoSong` — bản đồ trải ngang, nạp khi cuộn tới

**Files:**
- Create: `apps/site/src/components/BanDoSong.astro`
- Test: `apps/site/e2e/trang.spec.ts`

- [ ] **Step 1: Sửa e2e (đỏ trước)**

Trong `apps/site/e2e/trang.spec.ts`, **thay** bài `'bản đồ hero chỉ nạp iframe sau khi bấm'` bằng:

```ts
test('bản đồ trải ngang: không iframe khi mở, nạp bản tối sau lần cuộn đầu', async ({ page }) => {
  await page.goto('/');
  // Lời hứa về tốc độ tải: mở trang không kéo một byte nào của playground.
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.locator('#khoi-ban-do img').first()).toBeVisible();

  await page.mouse.wheel(0, 400);
  await expect(page.locator('iframe')).toHaveCount(1);
  const khung = page.locator('iframe');
  await expect(khung).toHaveAttribute('src', /\/playground\?embed=1&style=dark$/);
  await expect(khung).toHaveAttribute('title', /Bản đồ MapsLibVN/);
});

test('bản sáng nạp bản đồ sáng', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('mapslibvn-site-theme', 'light'));
  await page.reload();
  await page.mouse.wheel(0, 400);
  await expect(page.locator('iframe')).toHaveAttribute('src', /style=light$/);
});

test('nút "Mở bản đồ tương tác" nạp ngay không cần cuộn', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Mở bản đồ tương tác' }).click();
  await expect(page.locator('iframe')).toHaveCount(1);
});
```

- [ ] **Step 2: Chạy, đỏ**

```bash
cd apps/site && pnpm build && pnpm exec playwright test -g "bản đồ trải ngang|bản sáng nạp|Mở bản đồ tương tác" ; cd ../..
```

Expected: FAIL (chưa có `#khoi-ban-do`).

- [ ] **Step 3: Viết BanDoSong.astro**

```astro
---
import { Picture } from 'astro:assets';
import { DOCS_URL } from '../../site.config.mjs';
import sang from '../assets/ban-do-hero.jpg';
import toi from '../assets/ban-do-hero-dark.jpg';
import Nut from './Nut.astro';

/**
 * Khối bản đồ trải ngang dưới hero (spec 5.3). Lúc mở trang chỉ có ảnh tĩnh + ô tìm kiếm vẽ bằng
 * HTML. iframe playground (1,1 MB SDK + tiles) chỉ được tạo khi người dùng cuộn lần đầu và khối đã
 * lộ ≥ 25 %, hoặc khi bấm nút. Kích thước khối cố định nên CLS = 0.
 *
 * `goiY` là ba gợi ý THẬT lấy từ autocomplete production cho truy vấn `truyVan` (Task 6 của plan),
 * để người xem hiểu đây là bản đồ có tìm kiếm chứ không phải ảnh trang trí.
 */
interface Props {
  truyVan: string;
  goiY: readonly { ten: string; phu: string }[];
}

const { truyVan, goiY } = Astro.props;
const srcToi = `${DOCS_URL}/playground?embed=1&style=dark`;
const srcSang = `${DOCS_URL}/playground?embed=1&style=light`;
const ALT =
  'Bản đồ khu vực trung tâm Thành phố Hồ Chí Minh do MapsLibVN dựng, nhãn đường và địa điểm bằng tiếng Việt';
---

<section aria-labelledby="tt-ban-do" class="py-4">
  <h2 id="tt-ban-do" class="sr-only">Bản đồ tương tác</h2>
  <div class="mx-auto max-w-[1200px] sm:px-6">
    <div
      id="khoi-ban-do"
      data-src-toi={srcToi}
      data-src-sang={srcSang}
      class="relative h-[360px] overflow-hidden border-y border-border bg-surface-2 sm:h-[520px] sm:rounded-[var(--radius-card)] sm:border"
    >
      {/* Hai ảnh, ảnh không thuộc theme hiện tại bị display:none; cả hai `loading="lazy"` nên ảnh
          bị ẩn không được tải (lazy dựa trên giao cắt viewport). */}
      <Picture
        src={toi}
        alt={ALT}
        widths={[640, 960, 1280, 1600]}
        sizes="(max-width: 1200px) 100vw, 1200px"
        formats={['avif', 'webp']}
        loading="lazy"
        decoding="async"
        class="absolute inset-0 hidden h-full w-full object-cover dark:block"
      />
      <Picture
        src={sang}
        alt={ALT}
        widths={[640, 960, 1280, 1600]}
        sizes="(max-width: 1200px) 100vw, 1200px"
        formats={['avif', 'webp']}
        loading="lazy"
        decoding="async"
        class="absolute inset-0 h-full w-full object-cover dark:hidden"
      />

      <div
        aria-hidden="true"
        class="pointer-events-none absolute left-4 top-4 w-[min(360px,calc(100%-2rem))] rounded-[10px] border border-border bg-surface p-3 shadow-[0_8px_24px_rgba(0,0,0,.25)]"
      >
        <p class="t-small flex items-center gap-2 text-muted">
          <span>🔍</span>
          <span class="text-text">{truyVan}</span>
          <span class="inline-block h-4 w-px animate-pulse bg-text"></span>
        </p>
        <ul class="mt-2 divide-y divide-border">
          {
            goiY.map((g) => (
              <li class="py-2">
                <p class="t-small font-semibold text-text">{g.ten}</p>
                <p class="text-[13px] text-muted">{g.phu}</p>
              </li>
            ))
          }
        </ul>
      </div>

      <div class="absolute bottom-4 right-4">
        <Nut id="nut-ban-do" kieu="phu" class="bg-surface">Mở bản đồ tương tác</Nut>
      </div>
    </div>
    <p class="t-small mt-3 px-4 text-center text-muted sm:px-0">
      Bản đồ thật do MapsLibVN phục vụ.
      <a class="text-accent-text underline" href={`${DOCS_URL}/playground`}>Mở trang thử đầy đủ →</a>
    </p>
  </div>
</section>

<script>
  const khoi = document.getElementById('khoi-ban-do');
  const nut = document.getElementById('nut-ban-do');

  const nap = () => {
    if (!khoi || khoi.dataset.daNap) return;
    khoi.dataset.daNap = '1';
    const toi = document.documentElement.classList.contains('dark');
    const src = toi ? khoi.dataset.srcToi : khoi.dataset.srcSang;
    if (!src) return;
    const khung = document.createElement('iframe');
    khung.src = src;
    khung.title = 'Bản đồ MapsLibVN tương tác';
    khung.loading = 'lazy';
    khung.className = 'absolute inset-0 h-full w-full border-0';
    khoi.replaceChildren(khung);
  };

  nut?.addEventListener('click', nap);

  // Điều kiện nạp: khối đã lộ ≥ 25 % VÀ người dùng đã cuộn ít nhất một lần. Chỉ giao cắt thì
  // không đủ — ở 1280×720 khối đã nằm trong viewport lúc mở trang, sẽ nạp ngay và mất lời hứa
  // "mở trang không kéo playground".
  if (khoi && 'IntersectionObserver' in window) {
    let daLo = false;
    let daCuon = false;
    const thu = () => {
      if (daLo && daCuon) nap();
    };
    const io = new IntersectionObserver(
      (muc) => {
        daLo = muc.some((m) => m.isIntersecting);
        thu();
      },
      { threshold: 0.25 },
    );
    io.observe(khoi);
    const cuon = () => {
      daCuon = true;
      window.removeEventListener('scroll', cuon);
      window.removeEventListener('wheel', cuon);
      window.removeEventListener('touchmove', cuon);
      thu();
    };
    window.addEventListener('scroll', cuon, { passive: true, once: true });
    window.addEventListener('wheel', cuon, { passive: true, once: true });
    window.addEventListener('touchmove', cuon, { passive: true, once: true });
  }
</script>
```

- [ ] **Step 4: Gắn tạm vào index.astro để chạy e2e**

Trong `apps/site/src/pages/index.astro`, thêm import và đặt ngay dưới `<Hero />` (Task 7 sẽ viết lại toàn bộ tệp này, đây chỉ để bài e2e có chỗ chạy):

```astro
import BanDoSong from '../components/BanDoSong.astro';
```

```astro
  <Hero />
  <BanDoSong
    truyVan="cho ben thanh"
    goiY={[
      { ten: 'Chợ Bến Thành', phu: 'Phường Sài Gòn, Thành phố Hồ Chí Minh' },
      { ten: 'Bến Thành Tower', phu: 'Phường Sài Gòn, Thành phố Hồ Chí Minh' },
      { ten: 'Ga Bến Thành', phu: 'Phường Sài Gòn, Thành phố Hồ Chí Minh' },
    ]}
  />
```

(Ba tên này là tạm; Task 6 thay bằng kết quả thật.)

- [ ] **Step 5: Build, chạy ba bài, xanh; kiểm ngân sách JS**

```bash
cd apps/site && pnpm build && pnpm exec playwright test -g "bản đồ trải ngang|bản sáng nạp|Mở bản đồ tương tác|ngân sách JavaScript" ; cd ../..
```

Expected: PASS 4 bài.

- [ ] **Step 6: Commit**

```bash
git add apps/site/src/components/BanDoSong.astro apps/site/src/pages/index.astro apps/site/e2e/trang.spec.ts
git commit -m "feat(site): khối bản đồ trải ngang, nạp iframe sau lần cuộn đầu hoặc khi bấm"
```

---

### Task 6: Lấy ba gợi ý thật cho ô tìm kiếm tĩnh

**Files:**
- Modify: `apps/site/src/pages/index.astro` (giá trị `goiY`)

- [ ] **Step 1: Gọi autocomplete production bằng khoá demo công khai**

```bash
DEMO=$(curl -s https://mapslibvn-docs.pages.dev/playground-lib.js | grep -oE "mlv_live_[0-9A-Za-z]{24}" | head -1)
curl -s -H "X-Api-Key: $DEMO" -H "Origin: http://localhost" \
  "https://api.ai-solutions.io.vn/v1/autocomplete?q=cho%20ben%20thanh&near=10.7725,106.6981&limit=5" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); [print(i.get('name'), '|', i.get('address') or i.get('admin') or i.get('secondary') or '') for i in (d.get('items') or d.get('results') or [])]"
```

Expected: năm dòng `tên | dòng phụ`. Lấy **ba dòng đầu** có tên khác nhau. Nếu trường dòng phụ trong JSON tên khác (`address`, `admin`, `secondary`, `subtitle`…), in cả JSON một item (`print(json.dumps(items[0], ensure_ascii=False))`) để chọn đúng trường hiển thị đơn vị hành chính.

- [ ] **Step 2: Chép vào `goiY` trong index.astro**

Thay ba mục tạm bằng đúng ba kết quả thật (tên và dòng phụ nguyên văn). Truy vấn hiển thị giữ `cho ben thanh` (không dấu, để minh hoạ "hiểu chữ không dấu").

- [ ] **Step 3: Build + commit**

```bash
pnpm --filter @mapslibvn/site build
git add apps/site/src/pages/index.astro
git commit -m "feat(site): ba gợi ý thật từ production cho ô tìm kiếm minh hoạ"
```

---

### Task 7: Hero căn giữa và h1 ngắn

**Files:**
- Modify: `apps/site/src/components/Hero.astro` (viết lại), `apps/site/src/lib/trang.ts:18`

- [ ] **Step 1: h1 trang chủ**

Trong `apps/site/src/lib/trang.ts`, khối `trangChu`, đổi:

```ts
    h1: 'Bản đồ Việt Nam cho ứng dụng của bạn',
```

(`title` và `description` giữ nguyên; `trang.test.ts` chỉ đòi h1 > 5 ký tự.)

- [ ] **Step 2: Viết lại Hero.astro**

```astro
---
import { CONSOLE_URL } from '../../site.config.mjs';
import { TRANG } from '../lib/trang';
import Nut from './Nut.astro';

/**
 * Hero căn giữa (spec 5.2). KHÔNG có ảnh: LCP là chính chữ h1, và bản đồ thật nằm ngay khối dưới
 * (BanDoSong). Chip lệnh npm nói với dev "đây là SDK" trước cả khi đọc câu đầu.
 */
---

<section class="mx-auto max-w-[1200px] px-4 pb-8 pt-14 text-center sm:px-6 lg:pt-24">
  <p class="mb-6 inline-flex items-center rounded-full border border-border bg-surface-2 px-4 py-2">
    <span class="t-code text-accent-text">$ npm i @mapslibvn/web</span>
  </p>
  <h1 class="t-display mx-auto max-w-4xl">{TRANG.trangChu.h1}</h1>
  <p class="t-lead mx-auto mt-6 max-w-2xl text-muted">
    API bản đồ, tìm kiếm địa điểm và dẫn đường dựng trên dữ liệu mở. Trả tiền bằng VND, dữ liệu và
    mã nguồn dựng lại được.
  </p>
  <div class="mt-8 flex flex-wrap justify-center gap-3">
    <Nut href={CONSOLE_URL} co="lon">Bắt đầu miễn phí</Nut>
    <Nut href={TRANG.bangGia.path} kieu="phu" co="lon">Xem bảng giá</Nut>
  </div>
  <p class="t-small mt-4 text-muted">
    Bản dùng thử 2.000 lượt Places trong 30 ngày, không cần thẻ.
  </p>
</section>
```

- [ ] **Step 3: Build, e2e SEO trang chủ (một h1), commit**

```bash
pnpm exec vitest run apps/site/src/lib/trang.test.ts
cd apps/site && pnpm build && pnpm exec playwright test -g "SEO cơ bản: /$" ; cd ../..
git add apps/site/src/components/Hero.astro apps/site/src/lib/trang.ts
git commit -m "feat(site): hero căn giữa, không ảnh, h1 hai dòng"
```

Expected: vitest PASS; e2e PASS.

---

### Task 8: Trang chủ — bento, giá, CTA (viết lại `index.astro`, xoá `Feature.astro`)

**Files:**
- Modify: `apps/site/src/pages/index.astro` (viết lại toàn bộ)
- Delete: `apps/site/src/components/Feature.astro`
- Test: `apps/site/e2e/trang.spec.ts`

- [ ] **Step 1: Thêm bài e2e bento (đỏ trước)**

Thêm vào `apps/site/e2e/trang.spec.ts`:

```ts
test('bento sáu ô đúng thứ tự và mỗi ô có link tài liệu', async ({ page }) => {
  await page.goto('/');
  const khoi = page.locator('section[aria-labelledby="tt-tinh-nang"]');
  await expect(khoi.getByRole('heading', { level: 3 })).toHaveText([
    'Tìm kiếm hiểu tiếng Việt',
    'Rẻ hơn Google',
    '164 loại địa điểm',
    'Geocode nói thật',
    'Dẫn đường',
    'Bốn SDK, một API',
  ]);
  await expect(khoi.getByRole('link', { name: /→$/ })).toHaveCount(6);
  // Con số rẻ hơn Google tính từ catalog, không gõ tay.
  await expect(khoi.getByText(/^\d+–\d+%$/)).toBeVisible();
});

test('khối giá: bốn thẻ, Professional nổi bật là nút nhấn duy nhất trong khối', async ({ page }) => {
  await page.goto('/');
  const khoi = page.locator('section[aria-labelledby="tt-gia"]');
  await expect(khoi.getByRole('heading', { level: 3 })).toHaveText([
    'Dùng thử',
    'Starter',
    'Professional',
    'Business',
  ]);
  await expect(khoi.getByText('Được chọn nhiều nhất')).toBeVisible();
  const nutNhan = khoi.locator('a.bg-accent');
  await expect(nutNhan).toHaveCount(1);
  await expect(nutNhan).toHaveText('Chọn Professional');
});
```

Đồng thời **xoá** bài `'trang chủ in đủ bốn thẻ giá, có gói dùng thử 0đ'` (bài mới bao trùm).

- [ ] **Step 2: Chạy, đỏ**

```bash
cd apps/site && pnpm exec playwright test -g "bento sáu ô|khối giá" ; cd ../..
```

Expected: FAIL.

- [ ] **Step 3: Viết lại index.astro**

```astro
---
import { CONSOLE_URL, DOCS_URL } from '../../site.config.mjs';
import BanDoSong from '../components/BanDoSong.astro';
import Bento from '../components/Bento.astro';
import BentoO from '../components/BentoO.astro';
import CodeTabs from '../components/CodeTabs.astro';
import Faq from '../components/Faq.astro';
import Hero from '../components/Hero.astro';
import Nhan from '../components/Nhan.astro';
import Nut from '../components/Nut.astro';
import SoLieu from '../components/SoLieu.astro';
import The from '../components/The.astro';
import Base from '../layouts/Base.astro';
import { GOI_NOI_BAT, soSanh, tomTatGia } from '../lib/gia';
import { faqJsonLd, softwareApplicationJsonLd } from '../lib/seo';
import { TRANG } from '../lib/trang';

/* Khoảng phần trăm TÍNH TỪ COMPARISON, không gõ tay: đổi bảng giá đối thủ là con số tự đúng theo. */
const phanTram = soSanh().map((row) => row.reHonGoogle);
const thap = Math.round(Math.min(...phanTram));
const cao = Math.round(Math.max(...phanTram));

/* Ba gợi ý thật cho ô tìm kiếm minh hoạ — Task 6 của plan pha 1 chép từ autocomplete production. */
const GOI_Y = [
  { ten: 'Chợ Bến Thành', phu: 'Phường Sài Gòn, Thành phố Hồ Chí Minh' },
  { ten: 'Bến Thành Tower', phu: 'Phường Sài Gòn, Thành phố Hồ Chí Minh' },
  { ten: 'Ga Bến Thành', phu: 'Phường Sài Gòn, Thành phố Hồ Chí Minh' },
] as const;

const SDK = ['@mapslibvn/core', '@mapslibvn/web', '@mapslibvn/react', '@mapslibvn/react-native'];

const CAU_HOI = [
  {
    hoi: 'Một lượt gọi API được tính thế nào?',
    dap: 'Chỉ request thành công mới bị trừ lượt, kể cả khi kết quả rỗng hoặc lấy từ cache. Lỗi 4xx và 5xx không bị tính tiền.',
  },
  {
    hoi: 'Cấp thêm khoá API thì có thêm hạn mức không?',
    dap: 'Không. Hạn mức tính theo thuê bao, mọi khoá của cùng một tổ chức dùng chung một hạn mức. Cấp nhiều khoá là để tách môi trường và thu hồi riêng khi lộ.',
  },
  {
    hoi: 'Có xuất hoá đơn VAT không?',
    dap: 'Giai đoạn này chỉ có biên nhận thanh toán, chưa có hoá đơn điện tử VAT. Nếu bạn cần hoá đơn để hạch toán, hãy liên hệ trước khi mua.',
  },
  {
    hoi: 'Dữ liệu bản đồ lấy từ đâu?',
    dap: 'Từ hai nguồn mở: OpenStreetMap theo giấy phép ODbL và Foursquare OS Places theo Apache-2.0. Ứng dụng của bạn phải giữ phần ghi nguồn mà SDK hiển thị sẵn.',
  },
  {
    hoi: 'Tôi tự dựng hệ thống này được không?',
    dap: 'Được. Toàn bộ pipeline dữ liệu và mã nguồn SDK là mã mở, bạn có thể tự host tiles, Places và dẫn đường trên hạ tầng của mình.',
  },
  {
    hoi: 'Hết hạn mức thì chuyện gì xảy ra?',
    dap: 'API trả lỗi có cấu trúc nói rõ nhóm nào đã hết và khi nào hồi, để ứng dụng xử lý tử tế. Bạn mua thêm lượt theo khối 1.000 hoặc nâng gói.',
  },
] as const;

const GIA = tomTatGia();

/* Ba lý do rẻ hơn, một hàng dưới khối giá (spec 5.6) thay cho mục "Vì sao rẻ hơn" dạng danh sách. */
const VI_SAO = [
  ['Dữ liệu mở', 'không có phí bản quyền dữ liệu chuyển vào giá bán'],
  ['PMTiles trên CDN', 'trình duyệt đọc thẳng, không cụm máy chủ tile phải nuôi'],
  ['Tính theo lượt gọi', 'không theo số người dùng cuối hay số lần mở ứng dụng'],
] as const;
---

<Base trang={TRANG.trangChu} jsonLd={[softwareApplicationJsonLd(), faqJsonLd(CAU_HOI)]}>
  <Hero />

  <BanDoSong truyVan="cho ben thanh" goiY={GOI_Y} />

  <section aria-labelledby="tt-tinh-nang" class="mx-auto max-w-[1200px] px-4 py-16 sm:px-6 lg:py-24">
    <p class="mb-3"><Nhan chu="Có sẵn những gì" noiBat /></p>
    <h2 id="tt-tinh-nang" class="t-h2 max-w-2xl">Sáu mảng đang chạy thật, không phải lộ trình</h2>
    <Bento class="mt-10">
      <BentoO
        span={8}
        tieuDe="Tìm kiếm hiểu tiếng Việt"
        href={`${DOCS_URL}/tim-kiem/`}
        nhanLink="Tìm kiếm và autocomplete"
        nhan="AUTOCOMPLETE"
      >
        Gõ tới đâu gợi ý tới đó, chịu được viết không dấu, viết tắt, cách viết địa phương và tên đơn
        vị hành chính cũ lẫn mới.
        <div slot="minh-hoa" aria-hidden="true" class="rounded-[10px] border border-border bg-surface p-3">
          <p class="t-small flex items-center gap-2 text-muted">
            <span>🔍</span>
            <span class="text-text">cho ben thanh</span>
          </p>
          <ul class="mt-2 divide-y divide-border">
            {
              GOI_Y.map((g) => (
                <li class="py-2">
                  <p class="t-small font-semibold text-text">{g.ten}</p>
                  <p class="text-[13px] text-muted">{g.phu}</p>
                </li>
              ))
            }
          </ul>
        </div>
      </BentoO>

      <BentoO
        span={4}
        spanNho={6}
        tieuDe="Rẻ hơn Google"
        href={TRANG.soSanhGoogle.path}
        nhanLink="Chỗ Google hơn"
      >
        Ở ba mức dùng đã đối chiếu, cùng khối lượng gọi API.
        <SoLieu slot="minh-hoa" so={`${thap}–${cao}%`} nhan="GOOGLE MAPS PLATFORM" />
      </BentoO>

      <BentoO
        span={4}
        spanNho={6}
        tieuDe="164 loại địa điểm"
        href={`${DOCS_URL}/tinh-nang/`}
        nhanLink="Danh mục địa điểm"
      >
        Gộp từ OpenStreetMap và Foursquare OS, mỗi địa điểm ghi rõ nguồn chính.
        <SoLieu slot="minh-hoa" so="164" nhan="13 nhóm · 2 nguồn mở" />
      </BentoO>

      <BentoO
        span={4}
        tieuDe="Geocode nói thật"
        href={`${DOCS_URL}/do-chinh-xac/`}
        nhanLink="Độ chính xác geocode"
        nhan="PRECISION"
      >
        Mỗi kết quả kèm mức chính xác và độ tin cậy, thay vì một toạ độ trần để ứng dụng tự đoán.
        <pre
          slot="minh-hoa"
          class="t-code overflow-x-auto rounded-[10px] border border-border bg-surface p-3 text-muted"
        ><code>{`{ "precision": "rooftop",
  "confidence": 0.94,
  "lat": 10.7725, "lng": 106.6981 }`}</code></pre>
      </BentoO>

      <BentoO
        span={8}
        tieuDe="Dẫn đường"
        href={`${DOCS_URL}/dan-duong/`}
        nhanLink="Hướng dẫn dẫn đường"
        nhan="DIRECTIONS"
      >
        Tính tuyến cho xe máy, ô tô và đi bộ, trả hướng dẫn từng chặng bằng tiếng Việt, dùng được cả
        trên web lẫn React Native.
        <div slot="minh-hoa" class="flex flex-wrap items-center gap-4">
          <ul class="flex gap-2">
            {
              ['Xe máy', 'Ô tô', 'Đi bộ'].map((c) => (
                <li class="t-small rounded-full border border-border px-3 py-1 text-text">{c}</li>
              ))
            }
          </ul>
          <svg viewBox="0 0 240 60" class="h-12 w-60" aria-hidden="true">
            <path d="M6 48 C 60 10, 110 62, 160 30 S 220 8, 234 14" fill="none" stroke="var(--border-strong)" stroke-width="6" stroke-linecap="round" />
            <path d="M6 48 C 60 10, 110 62, 160 30" fill="none" stroke="var(--accent)" stroke-width="6" stroke-linecap="round" />
            <circle cx="6" cy="48" r="5" fill="var(--accent)" />
            <circle cx="234" cy="14" r="5" fill="var(--text)" />
          </svg>
        </div>
      </BentoO>

      <BentoO
        span={4}
        tieuDe="Bốn SDK, một API"
        href={`${DOCS_URL}/cai-dat/`}
        nhanLink="Cài đặt"
        nhan="SDK"
      >
        Cùng một hợp đồng và một nguồn tiles trên trình duyệt, iOS và Android.
        <ul slot="minh-hoa" class="t-code space-y-1 text-muted">
          {SDK.map((goi) => <li>{goi}</li>)}
        </ul>
      </BentoO>
    </Bento>
  </section>

  <section aria-labelledby="tt-nhung" class="border-y border-border bg-surface py-16 lg:py-24">
    <div class="mx-auto max-w-[1200px] px-4 sm:px-6">
      <p class="mb-3"><Nhan chu="Bốn cách nhúng" noiBat /></p>
      <h2 id="tt-nhung" class="t-h2 max-w-2xl">
        Chọn cách hợp với dự án của bạn. Cả bốn dùng chung một khoá API và một hợp đồng dữ liệu.
      </h2>
      <div class="mt-10">
        <CodeTabs />
      </div>
    </div>
  </section>

  <section aria-labelledby="tt-gia" class="mx-auto max-w-[1200px] px-4 py-16 sm:px-6 lg:py-24">
    <p class="mb-3"><Nhan chu="Bảng giá" noiBat /></p>
    <h2 id="tt-gia" class="t-h2 max-w-2xl">Giá theo lượt gọi, không theo đầu người</h2>
    <p class="t-lead mt-4 max-w-2xl text-muted">
      Bắt đầu bằng bản dùng thử 2.000 lượt Places trong 30 ngày, không cần thẻ thanh toán.
    </p>
    <div class="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {
        GIA.map((goi) => {
          const noiBat = goi.tier === GOI_NOI_BAT;
          return (
            <The as="article" noiBat={noiBat} class="flex flex-col">
              {noiBat && (
                <p class="mb-3 inline-flex w-fit rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-accent-ink">
                  Được chọn nhiều nhất
                </p>
              )}
              <h3 class="t-h3">{goi.ten}</h3>
              <p class="mt-3">
                <span class="t-stat">{goi.giaHienThi}</span>
                <span class="t-small text-muted"> {goi.donVi}</span>
              </p>
              <p class="t-small text-muted">{goi.dongPhu}</p>
              <p class="t-body mt-4 flex-1">{goi.hanMuc}</p>
              <Nut href={CONSOLE_URL} kieu={noiBat ? 'chinh' : 'phu'} class="mt-5">
                {goi.tier === 'trial' ? 'Dùng thử miễn phí' : `Chọn ${goi.ten}`}
              </Nut>
            </The>
          );
        })
      }
    </div>
    <ul class="mt-8 grid gap-4 sm:grid-cols-3">
      {
        VI_SAO.map(([tieuDe, mo]) => (
          <li class="t-small border-t border-border pt-3 text-muted">
            <strong class="text-text">{tieuDe}.</strong> {mo}.
          </li>
        ))
      }
    </ul>
    <div class="mt-8">
      <Nut href={TRANG.bangGia.path} kieu="phu">Xem đủ bốn gói và bảng so sánh →</Nut>
    </div>
  </section>

  <Faq items={CAU_HOI} />

  <section aria-labelledby="tt-cta" class="mx-auto max-w-[1200px] px-4 pb-24 sm:px-6">
    <The nen="surface-2" class="text-center sm:p-12">
      <h2 id="tt-cta" class="t-h2">Thử trong năm phút</h2>
      <p class="t-lead mx-auto mt-4 max-w-xl text-muted">
        Đăng ký, tự lấy khoá API và gọi request đầu tiên mà không cần chờ ai duyệt.
      </p>
      <div class="mt-8 flex flex-wrap justify-center gap-3">
        <Nut href={CONSOLE_URL} co="lon">Bắt đầu miễn phí</Nut>
        <Nut href={`${DOCS_URL}/bat-dau/`} kieu="phu" co="lon">Đọc hướng dẫn 5 phút</Nut>
      </div>
    </The>
  </section>
</Base>
```

Lưu ý: `GOI_Y` phải là ba kết quả thật đã chép ở Task 6 (giữ nguyên giá trị đó, chỉ chuyển từ prop inline lên hằng).

- [ ] **Step 4: Xoá Feature.astro**

```bash
grep -rn "Feature" apps/site/src --include='*.astro' | grep -v "components/Feature.astro"
git rm apps/site/src/components/Feature.astro
```

Expected: grep không còn chỗ nào import `Feature`.

- [ ] **Step 5: astro check, build, e2e**

```bash
pnpm --filter @mapslibvn/site typecheck
cd apps/site && pnpm build && pnpm exec playwright test -g "bento sáu ô|khối giá|bốn tab|SEO cơ bản: /$|ngân sách JavaScript|mọi link" ; cd ../..
```

Expected: 0 lỗi; PASS toàn bộ bài chọn.

- [ ] **Step 6: Commit**

```bash
git add apps/site/src/pages/index.astro apps/site/e2e/trang.spec.ts
git commit -m "feat(site): trang chủ bento sáu ô, khối giá bốn thẻ, CTA; bỏ Feature"
```

---

### Task 9: `CodeTabs` và `Faq` theo token và thang chữ

**Files:**
- Modify: `apps/site/src/components/CodeTabs.astro` (phần markup), `apps/site/src/components/Faq.astro`

- [ ] **Step 1: CodeTabs — thêm tô sáng tên hàm và đổi lớp**

Trong frontmatter `CodeTabs.astro`, sau mảng `TABS`, thêm:

```ts
/** Thoát HTML rồi tô `--accent-text` cho tên hàm/component chính. Không tô cú pháp đầy đủ để
 *  không kéo thêm CSS/JS (spec 5.5). */
const thoat = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const toSang = (ma: string) =>
  thoat(ma).replace(
    /\b(createMap|MapsLibVNMap)\b/g,
    '<b class="font-normal text-accent-text">$1</b>',
  );
```

Thay khối tablist + panel (từ `<div class="mx-auto max-w-4xl px-4">` tới hết `</div>` trước `<script>`) bằng:

```astro
<div>
  <div role="tablist" aria-label="Bốn cách nhúng bản đồ" class="flex flex-wrap gap-1 border-b border-border">
    {
      TABS.map((tab, i) => (
        <button
          type="button"
          role="tab"
          id={`tab-${tab.id}`}
          aria-controls={`panel-${tab.id}`}
          aria-selected={i === 0 ? 'true' : 'false'}
          tabindex={i === 0 ? 0 : -1}
          class="-mb-px inline-flex min-h-11 items-center border-b-2 border-transparent px-4 text-[15px] font-semibold text-muted transition-colors duration-150 hover:text-text aria-selected:border-accent aria-selected:text-text"
        >
          {tab.nhan}
        </button>
      ))
    }
  </div>

  {
    TABS.map((tab, i) => (
      <div
        role="tabpanel"
        id={`panel-${tab.id}`}
        aria-labelledby={`tab-${tab.id}`}
        hidden={i !== 0}
        tabindex="0"
        class="mt-4 overflow-x-auto rounded-[10px] border border-border bg-surface-2 p-4 sm:p-5"
      >
        <pre class="t-code text-text"><code set:html={toSang(tab.ma)} /></pre>
        <p class="t-small mt-3 text-muted">{tab.ghiChu}</p>
      </div>
    ))
  }

  <p class="t-small mt-4 text-muted">
    Yêu cầu từng môi trường, bước worker của MapLibre cho bundler và bảng lỗi hay gặp nằm ở
    <a class="text-accent-text underline" href={`${DOCS_URL}/cai-dat/`}>trang Cài đặt</a>.
  </p>
</div>
```

(Script điều khiển tab giữ nguyên.)

- [ ] **Step 2: Faq.astro**

Ghi đè `apps/site/src/components/Faq.astro`:

```astro
---
import Nhan from './Nhan.astro';

/**
 * Câu hỏi thường gặp, không một dòng JavaScript: <details> đóng mở sẵn trong trình duyệt.
 * Trang gọi component này PHẢI truyền cùng mảng đó vào faqJsonLd() — Google phạt khi đánh dấu
 * FAQPage nói một đằng còn chữ trên trang nói một nẻo.
 */
interface Props {
  items: readonly { hoi: string; dap: string }[];
  tieuDe?: string | undefined;
}

const { items, tieuDe = 'Câu hỏi thường gặp' } = Astro.props;
const id = 'faq-tieu-de';
---

<section aria-labelledby={id} class="mx-auto max-w-[1200px] px-4 py-16 sm:px-6 lg:py-24">
  <div class="grid gap-8 lg:grid-cols-[1fr_2fr]">
    <div>
      <p class="mb-3"><Nhan chu="FAQ" noiBat /></p>
      <h2 id={id} class="t-h2">{tieuDe}</h2>
    </div>
    <div class="divide-y divide-border border-y border-border">
      {
        items.map((item) => (
          <details class="group">
            <summary class="flex min-h-14 cursor-pointer items-center justify-between gap-4 py-4 text-left font-semibold text-text">
              {item.hoi}
              <span
                aria-hidden="true"
                class="t-h3 shrink-0 text-muted transition-transform duration-150 group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p class="t-body pb-5 text-muted">{item.dap}</p>
          </details>
        ))
      }
    </div>
  </div>
</section>
```

- [ ] **Step 3: Build, e2e tab, commit**

```bash
pnpm --filter @mapslibvn/site typecheck
cd apps/site && pnpm build && pnpm exec playwright test -g "bốn tab|không còn lớp brand" ; cd ../..
git add apps/site/src/components/CodeTabs.astro apps/site/src/components/Faq.astro
git commit -m "feat(site): CodeTabs gạch chân tab, tô tên hàm; FAQ hai cột với dấu cộng"
```

Expected: PASS.

---

### Task 10: `Header` và `Footer` theo token

**Files:**
- Modify: `apps/site/src/components/Header.astro`, `apps/site/src/components/Footer.astro`

- [ ] **Step 1: Header — thay lớp từng chỗ**

Trong `Header.astro` (sau pha 0 các lớp `brand-*` đã thành token; đây là bước tinh chỉnh):

1. Thẻ `<header …>`: đổi lớp thành
   `sticky top-0 z-40 border-b border-border bg-surface/90 backdrop-blur`.
2. Logo `<a href="/" …>`: lớp `t-h3 text-text`.
3. Link nav máy tính: lớp
   `inline-flex min-h-11 items-center rounded-[var(--radius-btn)] px-3 text-[15px] font-semibold text-muted transition-colors duration-150 hover:bg-accent-soft hover:text-text aria-[current=page]:text-text`.
4. Nút theme `#nut-theme`: lớp
   `ml-auto inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-btn)] border border-border text-muted hover:border-border-strong hover:text-text md:ml-0`.
5. Nút "Bắt đầu miễn phí" trên thanh: thay cả thẻ `<a href={CONSOLE_URL} …>…</a>` bằng

```astro
    <Nut href={CONSOLE_URL} co="nho" class="shrink-0">
      {/* Nhãn ngắn ở màn rất hẹp để thanh trên không tràn ở 320px, vẫn giữ đường đăng ký luôn
          nhìn thấy thay vì giấu sau nút ☰. */}
      <span class="sm:hidden">Bắt đầu</span>
      <span class="hidden sm:inline">Bắt đầu miễn phí</span>
    </Nut>
```

   và thêm `import Nut from './Nut.astro';` vào frontmatter.
6. Nút hamburger và nút đóng: đổi `border-[var(--border)]` → `border-border`.
7. `<dialog>`: lớp
   `ngan-keo m-0 ml-auto h-full max-h-none w-72 max-w-[82vw] border-l border-border bg-surface p-0 text-text shadow-xl backdrop:bg-black/45`.
8. Link trong ngăn kéo: lớp
   `flex min-h-11 items-center rounded-[var(--radius-btn)] px-3 font-semibold text-muted hover:bg-accent-soft hover:text-text aria-[current=page]:bg-accent-soft aria-[current=page]:text-text`.
9. Hai link cuối ngăn kéo ("Bắt đầu miễn phí", "Gọi …"): thay bằng

```astro
      <Nut href={CONSOLE_URL} class="w-full">Bắt đầu miễn phí</Nut>
      <Nut href={`tel:${SUPPORT_PHONE}`} kieu="phu" class="mt-2 w-full">Gọi {SUPPORT_PHONE_HIEN_THI}</Nut>
```

Mọi `border-[var(--border)]` còn lại trong tệp → `border-border`; `bg-[var(--surface)]` → `bg-surface`; `text-[var(--text-muted)]` → `text-muted`; `text-[var(--text)]` → `text-text`.

- [ ] **Step 2: Footer — thay lớp**

Trong `Footer.astro`:

1. `<footer …>`: `mt-24 border-t border-border bg-surface`.
2. `<h2 class="mb-3 text-sm font-bold">{cot.ten}</h2>` → `<h2 class="mb-4"><Nhan chu={cot.ten} /></h2>` và thêm `import Nhan from './Nhan.astro';`. (Các tên cột có dấu → tự dùng Be Vietnam Pro.)
3. Link cột: `inline-flex min-h-11 items-center text-[15px] text-muted hover:text-text`.
4. Cột liên hệ: `<h2 class="mb-3 text-sm font-bold">Liên hệ</h2>` → `<h2 class="mb-4"><Nhan chu="Liên hệ" /></h2>`; đoạn `<p class="text-sm text-[var(--text-muted)]">` → `<p class="t-small text-muted">`.
5. Link "Cổng khách hàng": thay thẻ `<a …>` bằng `<Nut href={CONSOLE_URL} kieu="phu" class="mt-3">Cổng khách hàng</Nut>` và thêm import `Nut`.
6. Khối ghi nguồn: `mt-10 border-t border-border pt-6 t-small text-muted`; hai link giữ `class="underline"` (nghĩa vụ giấy phép, chữ và vị trí không đổi).

- [ ] **Step 3: Build, e2e liên quan, commit**

```bash
pnpm --filter @mapslibvn/site typecheck
cd apps/site && pnpm build && pnpm exec playwright test -g "điện thoại|máy tính|ghi nguồn|số điện thoại|không còn lớp brand" ; cd ../..
git add apps/site/src/components/Header.astro apps/site/src/components/Footer.astro
git commit -m "feat(site): header và footer theo token, nút dùng Nut"
```

Expected: PASS.

---

### Task 11: Cổng kiểm cuối pha 1, ảnh nghiệm thu, DEVLOG

**Files:**
- Create: `docs/evidence/site-redesign/pha-1/*.png`
- Modify: `docs/DEVLOG.md`

- [ ] **Step 1: Toàn bộ cổng**

```bash
pnpm lint
pnpm exec vitest run apps/site packages/ui
pnpm --filter @mapslibvn/site typecheck
pnpm --filter @mapslibvn/site build
pnpm --filter @mapslibvn/site e2e
grep -rn "brand-" apps/site/src ; echo "brand exit=$?"
grep -rnE "#[0-9a-fA-F]{6}\b" apps/site/src --include='*.astro' --include='*.ts' | grep -v "svg" ; echo "mã màu cứng exit=$?"
```

Expected: lint sạch; vitest PASS; astro check 0; build 11 trang; Playwright PASS toàn bộ (bài cũ + bài mới); hai grep cuối `exit=1` (không mã màu cứng ngoài SVG và tokens).

- [ ] **Step 2: Ảnh nghiệm thu trang chủ — hai theme, hai khổ**

```bash
mkdir -p docs/evidence/site-redesign/pha-1
cd apps/site && (env CLAUDECODE= pnpm exec astro preview --port 4323 & echo $! > /tmp/mlv-preview.pid; sleep 3) && node --input-type=module -e "
import { chromium } from '@playwright/test';
const b = await chromium.launch();
for (const [theme, toi] of [['toi', true], ['sang', false]]) {
  for (const [khoTen, w] of [['1280', 1280], ['390', 390]]) {
    const p = await b.newPage({ viewport: { width: w, height: 900 } });
    await p.addInitScript((t) => localStorage.setItem('mapslibvn-site-theme', t ? 'dark' : 'light'), toi);
    await p.goto('http://localhost:4323/', { waitUntil: 'networkidle' });
    await p.screenshot({ path: '../../docs/evidence/site-redesign/pha-1/trang-chu-' + theme + '-' + khoTen + '.png', fullPage: true });
    await p.close();
  }
}
await b.close();
"; kill $(cat /tmp/mlv-preview.pid); cd ../..
ls -la docs/evidence/site-redesign/pha-1/
```

Expected: 4 tệp PNG. Mở từng ảnh, kiểm bằng mắt:
- Bản tối: nền `#0a0a0a`, một nút xanh chanh ở hero, một ở khối giá (Professional), một ở CTA; bento 6 ô lệch cỡ; ảnh bản đồ tối.
- Bản sáng: không có chữ xanh chanh trên nền trắng (link phải xanh rêu đậm `#3f6212`); ảnh bản đồ sáng.
- 390 px: hero không tràn, bento xếp một cột (hai ô số liệu cạnh nhau), nút "Mở bản đồ tương tác" không che gợi ý.

Chỗ nào sai thì sửa component tương ứng, chạy lại Step 1 và chụp lại.

- [ ] **Step 3: DEVLOG**

Thêm cuối `docs/DEVLOG.md`:

```markdown
## N. Giao diện mới — pha 1: trang chủ — dd/mm/yyyy   ← N = số mục cuối + 1, ngày là ngày chạy

Plan `2026-09-22-giao-dien-pha-1-trang-chu.md`. Trang chủ theo spec mục 5: hero căn giữa không
ảnh (LCP là h1), khối bản đồ trải ngang nạp iframe playground `style=dark|light` sau **lần cuộn
đầu và khi khối lộ ≥ 25 %** (chỉ rootMargin thì ở 1280×720 khối đã trong viewport, nạp ngay — mất
lời hứa), bento 6 ô, bốn cách nhúng tô tên hàm, giá bốn thẻ với đúng một nút nhấn, FAQ hai cột, CTA.
Component mới: Nhan (chọn font theo ASCII), Nut, The, SoLieu, Bento/BentoO, BanDoSong. Ảnh chỗ giữ
hai theme chụp bằng `scripts/site-images.mjs --hero`. Ba gợi ý tìm kiếm minh hoạ đọc từ production.
Cổng: vitest, astro check, build, Playwright <số>/<số>, lint, không mã màu cứng. Ảnh nghiệm thu ở
`docs/evidence/site-redesign/pha-1/`. Chờ PHONG duyệt bằng mắt trước khi sang pha 2 (trang con).
```

- [ ] **Step 4: Commit**

```bash
git add docs/DEVLOG.md docs/evidence/site-redesign/pha-1
git commit -m "docs: DEVLOG pha 1 + ảnh nghiệm thu trang chủ"
```

- [ ] **Step 5: Đưa PHONG xem**

Không push. Báo PHONG đường dẫn 4 ảnh và cách xem thật: `cd apps/site && pnpm preview` rồi mở `http://localhost:4322/`. Chỉ khi PHONG duyệt mới viết plan pha 2 (năm trang con) và pha 3 (console, admin, docs, favicon, OG).
