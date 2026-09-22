# Giao diện mới — Pha 2: năm trang con — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho mỗi trang con một **dạng nội dung chủ đạo riêng** theo spec `2026-09-22-thiet-ke-lai-giao-dien-design.md` mục 6, để hết cảnh "trang nào cũng là một cột chữ". Nội dung chữ giữ nguyên, chỉ đổi cách trình bày và thêm ba thứ mới có giá trị tra cứu: thanh ước tính giá, bảng đối đầu, mục lục dính.

**Architecture:** Dùng lại bộ component pha 1 (`Nhan`, `Nut`, `The`, `SoLieu`, `Bento`, `BentoO`). Thêm ba component (`MucLucDinh`, `ThanhUocTinh`, `BangDoiDau`) và hai module dữ liệu thuần có test (`goiPhuHop` trong `gia.ts`, `doi-dau.ts`). Mọi con số vẫn lấy từ `@mapslibvn/catalog`.

**Tech Stack:** Astro 7, Tailwind v4 với token pha 0, vitest, Playwright.

**Tiền điều kiện:** pha 0 và pha 1 đã chạy xong trên nhánh `feat/giao-dien-moi`.

**Plan này gọn hơn pha 0/1 có chủ ý:** bộ component đã tồn tại và đã được e2e khoá, nên mỗi task ghi quyết định, tệp đụng tới và bài kiểm bắt buộc, thay vì chép lại toàn bộ mã. Mọi task vẫn giữ vòng đỏ → xanh → commit.

---

## Tệp đụng tới

| Tệp | Việc |
|---|---|
| `src/components/MucLucDinh.astro` | Mới: mục lục dính, tô mục đang xem |
| `src/components/ThanhUocTinh.astro` | Mới: nhập số lượt → gợi ý gói |
| `src/components/BangDoiDau.astro` | Mới: bảng hai cột, tô bên thắng |
| `src/lib/gia.ts`, `gia.test.ts` | Thêm `goiPhuHop` |
| `src/lib/doi-dau.ts`, `doi-dau.test.ts` | Mới: dữ liệu bảng đối đầu |
| `src/pages/tinh-nang.astro` | Hàng xen kẽ + mục lục dính |
| `src/pages/bang-gia.astro` | Thanh ước tính + bảng đối chiếu hạn mức |
| `src/pages/so-sanh/google-maps-api.astro`, `vietmap.astro` | Bảng đối đầu thay hai danh sách |
| `src/pages/bai-viet/index.astro`, `[slug].astro` | Bài dẫn + hàng gọn; mục lục bài |
| `src/pages/lien-he.astro`, `404.astro` | Hai cột; thang chữ mới |
| `src/components/ComparisonTable.astro`, `PricingCards.astro`, `Prose.astro` | Token + thang chữ |
| `e2e/trang.spec.ts` | Bài cho từng dạng bố cục |

---

### Task 1: `goiPhuHop` — chọn gói nhỏ nhất đủ dùng

**Files:** `src/lib/gia.ts`, `src/lib/gia.test.ts`

- [ ] **Step 1: Viết test (đỏ)** — thêm vào `gia.test.ts`:

```ts
describe('goiPhuHop', () => {
  it('không dùng gì → gói dùng thử', () => {
    expect(goiPhuHop(0, 0)?.tier).toBe('trial');
  });

  it('vừa đúng hạn mức Starter → Starter', () => {
    expect(goiPhuHop(30_000, 3_000)?.tier).toBe('starter');
  });

  it('vượt MỘT nhóm là phải lên gói, kể cả nhóm kia còn thừa', () => {
    expect(goiPhuHop(30_001, 0)?.tier).toBe('professional');
    expect(goiPhuHop(0, 3_001)?.tier).toBe('professional');
  });

  it('đúng trần Business → Business', () => {
    expect(goiPhuHop(400_000, 40_000)?.tier).toBe('business');
  });

  it('vượt Business → null, giao diện phải mời liên hệ', () => {
    expect(goiPhuHop(400_001, 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Chạy `pnpm exec vitest run apps/site/src/lib/gia.test.ts`** — FAIL "goiPhuHop is not defined".

- [ ] **Step 3: Thêm vào `gia.ts`**

```ts
/**
 * Gói NHỎ NHẤT có cả hai nhóm hạn mức ≥ mức dùng ước tính. Hai nhóm độc lập nên vượt một nhóm là
 * phải lên gói dù nhóm kia còn thừa — đúng luật quota của máy chủ. Vượt cả Business trả `null`;
 * giao diện khi đó mời liên hệ chứ không bịa ra một gói.
 */
export function goiPhuHop(places: number, directions: number): GoiHienThi | null {
  return bangGia().find((g) => g.places >= places && g.directions >= directions) ?? null;
}
```

- [ ] **Step 4: Chạy lại — PASS.**
- [ ] **Step 5: Commit** `feat(site): goiPhuHop chọn gói nhỏ nhất đủ dùng`.

---

### Task 2: `doi-dau.ts` — dữ liệu bảng đối đầu

**Files:** `src/lib/doi-dau.ts`, `src/lib/doi-dau.test.ts`

Kiểu:

```ts
export type Thang = 'ta' | 'ho' | 'hoa';
export interface HangDoiDau {
  tieuChi: string;
  ta: string;
  ho: string;
  thang: Thang;
}
```

Ba hàng chi phí đầu của mỗi bảng **sinh từ `COMPARISON.rows`**, không chép tay. Các hàng còn lại chuyển từ nội dung `HOP_HON` / `GOOGLE_HON` (Google) và `KHAC_BIET` (VIETMAP) hiện có trong hai trang.

- [ ] **Step 1: Viết test (đỏ)** — `src/lib/doi-dau.test.ts`:

```ts
import { COMPARISON } from '@mapslibvn/catalog';
import { describe, expect, it } from 'vitest';
import { CHUA_CO, doiDauGoogle, doiDauVietmap } from './doi-dau';

describe('bảng đối đầu', () => {
  for (const [ten, bang] of [
    ['Google', doiDauGoogle()],
    ['VIETMAP', doiDauVietmap()],
  ] as const) {
    describe(ten, () => {
      it('ba hàng đầu là chi phí, lấy thẳng từ COMPARISON', () => {
        for (const [i, row] of COMPARISON.rows.entries()) {
          const hang = bang[i];
          expect(hang?.tieuChi).toContain(new Intl.NumberFormat('vi-VN').format(row.places));
          expect(hang?.thang).toBe('ta');
        }
      });

      it('mọi hàng có đủ ba cột và một giá trị thắng hợp lệ', () => {
        for (const h of bang) {
          expect(h.tieuChi.length).toBeGreaterThan(2);
          expect(h.ta.length).toBeGreaterThan(0);
          expect(h.ho.length).toBeGreaterThan(0);
          expect(['ta', 'ho', 'hoa']).toContain(h.thang);
        }
      });

      it('có ít nhất hai hàng ĐỐI THỦ thắng — trang này không được giấu', () => {
        expect(bang.filter((h) => h.thang === 'ho').length).toBeGreaterThanOrEqual(2);
      });

      it('không hàng nào nhận "ta thắng" ở thứ MapsLibVN chưa làm', () => {
        for (const h of bang.filter((x) => x.thang === 'ta')) {
          for (const chua of CHUA_CO) {
            expect(h.tieuChi.toLowerCase()).not.toContain(chua.toLowerCase());
          }
        }
      });
    });
  }
});
```

`CHUA_CO` xuất từ `doi-dau.ts` và là **một nguồn duy nhất** cho cả bảng đối đầu lẫn mục "Những thứ chưa có" ở trang Tính năng: `['ma trận khoảng cách', 'tối ưu lộ trình đội xe', 'giao thông thời gian thực', 'Street View', 'ảnh vệ tinh']`.

- [ ] **Step 2: Chạy — FAIL (không có module).**
- [ ] **Step 3: Viết `doi-dau.ts`.** Hàng chi phí dựng bằng `soSanh()` đã có. Hàng tính năng lấy nguyên câu từ hai trang hiện tại, rút còn ≤ 90 ký tự mỗi ô.
- [ ] **Step 4: Chạy — PASS.**
- [ ] **Step 5: Commit** `feat(site): dữ liệu bảng đối đầu, khoá bằng test không giấu chỗ thua`.

---

### Task 3: Ba component mới

**Files:** `src/components/MucLucDinh.astro`, `ThanhUocTinh.astro`, `BangDoiDau.astro`

- [ ] **Step 1: `MucLucDinh.astro`** — nhận `muc: readonly {id: string; nhan: string}[]`. Render `<nav>` sticky `top-24`, danh sách link neo. Script ≤ 20 dòng: `IntersectionObserver` trên các `section[id]`, thêm `aria-current="true"` cho link của mục đang xem. Không JS thì vẫn là danh sách link chạy được.
- [ ] **Step 2: `ThanhUocTinh.astro`** — hai `<input type="number">` (Places bước 1.000 mặc định 50.000; tuyến bước 100 mặc định 5.000) và một vùng kết quả. Render sẵn `data-*` cho **cả bốn gói** (tên + giá) để không có JS thì vẫn hiện gói mặc định; script ≤ 30 dòng đọc `goiPhuHop` **đã tính sẵn thành bảng ngưỡng trong `data-`**, không gọi lại logic trong trình duyệt. Vượt Business thì hiện câu mời liên hệ.
- [ ] **Step 3: `BangDoiDau.astro`** — nhận `hang: readonly HangDoiDau[]`, `tenHo: string`. `<table>` ba cột; ô thắng thêm `✓` và `text-accent-text`, ô thua `text-faint`. Có `<caption>` ghi ngày đối chiếu `COMPARISON.checkedAt`.
- [ ] **Step 4: `pnpm --filter @mapslibvn/site typecheck` — 0 lỗi. Commit.**

---

### Task 4: Trang Tính năng — hàng xen kẽ + mục lục dính

**Files:** `src/pages/tinh-nang.astro`

- [ ] **Step 1: Thêm bài e2e (đỏ)**

```ts
test('trang Tính năng: mục lục dính và sáu hàng xen kẽ có bằng chứng', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/tinh-nang/');
  const mucLuc = page.getByRole('navigation', { name: 'Mục lục' });
  await expect(mucLuc.getByRole('link')).toHaveCount(6);
  // Mỗi hàng phải có bằng chứng nhìn được, không phải chỉ chữ.
  await expect(page.locator('section[id] img, section[id] pre, section[id] table')).toHaveCount(6);
});
```

- [ ] **Step 2: Chạy — FAIL.**
- [ ] **Step 3: Viết lại trang.** Lưới `lg:grid-cols-[220px_1fr]`. Sáu `<section id>` theo `MUC` hiện có, mỗi section lưới hai cột, hàng chẵn đảo bên bằng `lg:[&>*:first-child]:order-2`. Bằng chứng từng mục: bản đồ = `<Picture>` ảnh hero (đã có), địa điểm = bảng 13 nhóm trong khung cuộn `max-h-80`, tìm kiếm = ô gợi ý tĩnh dùng lại `GOI_Y` (tách sang `src/lib/goi-y.ts` để trang chủ và trang này cùng một nguồn), geocode = khối `<pre>` JSON, dẫn đường = SVG tuyến + ba chip, SDK = danh sách tên gói. Mục "Những thứ chưa có" dựng từ `CHUA_CO` của Task 2.
- [ ] **Step 4: Chạy — PASS. Commit.**

---

### Task 5: Trang Bảng giá — thanh ước tính + bảng đối chiếu hạn mức

**Files:** `src/pages/bang-gia.astro`, `src/components/PricingCards.astro`

- [ ] **Step 1: Thêm bài e2e (đỏ)**

```ts
test('bảng giá: thanh ước tính chỉ đúng gói theo số nhập', async ({ page }) => {
  await page.goto('/bang-gia/');
  const places = page.getByLabel('Lượt Places mỗi tháng');
  await places.fill('120000');
  await expect(page.getByTestId('goi-goi-y')).toContainText('Business');
  await places.fill('20000');
  await expect(page.getByTestId('goi-goi-y')).toContainText('Starter');
  await places.fill('500000');
  await expect(page.getByTestId('goi-goi-y')).toContainText('liên hệ');
});

test('bảng giá: bảng đối chiếu hạn mức có đủ bốn cột gói', async ({ page }) => {
  await page.goto('/bang-gia/');
  const bang = page.getByRole('table', { name: /hạn mức/i });
  await expect(bang.getByRole('columnheader')).toHaveCount(5);
});
```

- [ ] **Step 2: Chạy — FAIL.**
- [ ] **Step 3: Dựng `ThanhUocTinh` vào đầu trang; thêm bảng đối chiếu bảy hàng (Places, tuyến, trần ngày, hỗ trợ, mua thêm, kỳ mua, giá tháng) dưới bốn thẻ.** `PricingCards` đổi sang `The` + `Nut` + thang chữ.
- [ ] **Step 4: Chạy — PASS. Giữ nguyên các bài giá cũ trong `seo.spec.ts`. Commit.**

---

### Task 6: Hai trang so sánh — bảng đối đầu

**Files:** `src/pages/so-sanh/google-maps-api.astro`, `vietmap.astro`, `src/components/ComparisonTable.astro`

- [ ] **Step 1: Thêm bài e2e (đỏ)**

```ts
test('so sánh Google: bảng đối đầu tô đúng bên thắng, không giấu chỗ thua', async ({ page }) => {
  await page.goto('/so-sanh/google-maps-api/');
  const bang = page.getByRole('table', { name: /đối đầu/i });
  const hangSv = bang.getByRole('row').filter({ hasText: 'Street View' });
  await expect(hangSv.getByRole('cell').nth(2)).toContainText('✓');
  await expect(hangSv.getByRole('cell').nth(1)).not.toContainText('✓');
});
```

- [ ] **Step 2: Chạy — FAIL.**
- [ ] **Step 3: Thay hai danh sách `HOP_HON`/`GOOGLE_HON` (và `KHAC_BIET` ở VIETMAP) bằng `BangDoiDau`.** Giữ nguyên: câu mở đầu thừa nhận đây là bảng của người bán, "Khi nào nên chọn cái nào", "Chuyển sang thì mất gì", FAQ, CTA, và `ComparisonTable` với đầy đủ giả định/nguồn/ngày.
- [ ] **Step 4: Chạy — PASS. Commit.**

---

### Task 7: Bài viết, Liên hệ, 404

**Files:** `src/pages/bai-viet/index.astro`, `[slug].astro`, `src/pages/lien-he.astro`, `404.astro`, `src/components/Prose.astro`

- [ ] **Step 1: Thêm bài e2e (đỏ)**

```ts
test('bài viết: một bài dẫn lớn, các bài còn lại là hàng gọn', async ({ page }) => {
  await page.goto('/bai-viet/');
  await expect(page.getByTestId('bai-dan')).toHaveCount(1);
  await expect(page.getByTestId('bai-hang')).toHaveCount(2);
});

test('trang bài dài có mục lục bên phải ở màn rộng', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/bai-viet/chi-phi-google-maps-api-cho-doanh-nghiep-viet-nam-2026/');
  await expect(page.getByRole('navigation', { name: 'Mục lục bài' })).toBeVisible();
});
```

- [ ] **Step 2: Chạy — FAIL.**
- [ ] **Step 3:**
  - `bai-viet/index.astro`: bài mới nhất thành khối dẫn hai cột (`data-testid="bai-dan"`), còn lại là hàng một dòng (`data-testid="bai-hang"`).
  - `[slug].astro`: lấy `headings` từ `render()`, lọc `depth === 2`, dựng `MucLucDinh` bên phải từ `xl:`.
  - `lien-he.astro`: lưới hai cột; thẻ "Gọi" `noiBat`.
  - `404.astro`: số 404 thang `t-display` màu `--accent-text`.
  - `Prose.astro`: cột 720 px, thang chữ mới, link `text-accent-text`.
- [ ] **Step 4: Chạy — PASS. Commit.**

---

### Task 8: Cổng kiểm cuối pha 2

- [ ] **Step 1:**

```bash
pnpm lint
pnpm exec vitest run apps/site packages/ui
pnpm --filter @mapslibvn/site typecheck
pnpm --filter @mapslibvn/site build
pnpm --filter @mapslibvn/site e2e
grep -rnE "#[0-9a-fA-F]{6}" apps/site/src --include='*.astro' --include='*.ts' | grep -v "0a0a0a\|fafafa"
```

Expected: lint xanh; vitest PASS; 0 lỗi; 11 trang; Playwright PASS toàn bộ; grep trống.

- [ ] **Step 2: Ảnh nghiệm thu** — 7 trang × 2 theme ở 1280, và 5 trang ở 390, lưu `docs/evidence/site-redesign/pha-2/`. Xem từng ảnh: mỗi trang phải nhìn khác nhau ở dạng nội dung chủ đạo; bản sáng không có chữ xanh chanh trên nền trắng; ở 390 không trang nào cuộn ngang.
- [ ] **Step 3: DEVLOG + commit. Không push.**
