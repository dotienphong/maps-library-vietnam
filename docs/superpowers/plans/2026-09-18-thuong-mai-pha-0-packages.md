# Thương mại tự phục vụ — Pha 0: `@mapslibvn/catalog` và `@mapslibvn/ui` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tách bảng giá và bộ giao diện dùng chung ra hai package nội bộ, thêm giá VND, bảng so sánh, hàm tính tiền, route `/v1/catalog` công khai và cờ `SELF_SERVE` — **không đổi hành vi** của API hay trang Admin đang chạy production.

**Architecture:** `packages/catalog` là TypeScript thuần, không phụ thuộc gì, được `apps/api` import thẳng từ source (Vite, vitest-pool-workers và esbuild của wrangler đều biên dịch `.ts` trong workspace). `packages/ui` gom `components/ui`, `states`, `data-view`, `delayed-action`, `theme`, `cn` và `tokens.css` từ `apps/admin`, tách hai chỗ đang bám vào `lib/fetcher` của admin (`AdminApiError`, `setReloadGuard`) bằng duck-typing và một prop. Admin đổi import sang `@mapslibvn/ui`; test đi theo file; bộ test admin phải xanh y nguyên.

**Tech Stack:** pnpm workspace, TypeScript 6 (`moduleResolution: Bundler`, package `exports` trỏ `.ts`), vitest 5 (gốc, jsdom theo docblock) và vitest 4 + `@cloudflare/vitest-pool-workers` (api), Tailwind v4 (`@theme`, `@source`), Hono, Biome.

Spec: `docs/superpowers/specs/2026-09-18-thuong-mai-tu-phuc-vu-design.md` mục 4.1, 8, 16 (cờ), 19 (pha 0).

---

## Bối cảnh bắt buộc đọc trước khi làm

- **Ba bẫy đã có tiền lệ trong repo:**
  1. `pnpm typecheck` chạy qua turbo và **replay cache** — muốn chắc thì `turbo run typecheck --force`.
  2. Tailwind v4 chỉ quét mã trong thư mục app, **bỏ qua node_modules**. Component của `@mapslibvn/ui` tới admin qua symlink trong node_modules nên lớp dùng trong đó sẽ **không sinh CSS** nếu thiếu `@source`. Hậu quả là nút mất kiểu mà không có lỗi nào — Task 10 có bước grep CSS build để bắt.
  3. macOS không có `timeout`; `sed -i` cần `''` (`sed -i ''`).
- `scripts/lib/npm-sdk-release.mjs` chỉ đòi phân loại package **public** (`manifest.private !== true`). Hai package mới đều `private: true` nên **không** cần thêm vào `NON_SDK_PACKAGE_DIRS`; Task 11 sửa một dòng trong spec cho khớp thực tế.
- Root `vitest.config.ts` đã `include` `packages/*/src/**/*.test.{ts,tsx,mjs}` và `setupFiles` `apps/admin/src/test-setup.ts` (tự bỏ qua ngoài jsdom). Test của `packages/ui` chạy jsdom bằng docblock `// @vitest-environment jsdom` ở đầu file, y như admin.
- Mọi commit kết thúc bằng dòng `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Không push trong plan này cho tới Task 12; push kéo theo `Deploy API` lên production.

## Cấu trúc file

**Tạo mới**

```
packages/catalog/
  package.json           private, exports "." → src/index.ts, script typecheck
  tsconfig.json
  README.md
  src/index.ts           barrel
  src/plans.ts           PLAN_CATALOG (+priceVnd), Tier, PaidTier, QuotaGroup, TIERS, PAID_TIERS,
                         QUOTA_GROUPS, USD_REFERENCE_RATE, PERIOD_MONTHS, PeriodMonths
  src/plans.test.ts
  src/months.ts          addMonths() theo lịch giờ Việt Nam
  src/months.test.ts
  src/quote.ts           quoteOrder(), OrderInput, Quote, CatalogError, MAX_PACKS
  src/quote.test.ts
  src/comparison.ts      COMPARISON, ComparisonRow, savingsPercent(), comparisonAgeDays()
  src/comparison.test.ts

packages/ui/
  package.json           private, exports "." → src/index.ts và "./tokens.css"
  tsconfig.json
  README.md
  src/index.ts           barrel
  src/test-types.d.ts    kéo kiểu matcher jest-dom cho test
  src/tokens.css         @theme + biến :root/.dark (chuyển từ apps/admin/src/index.css)
  src/cn.ts              (từ apps/admin/src/lib/utils.ts)
  src/badge.tsx  src/button.tsx  src/button.test.tsx  src/card.tsx  src/card.test.tsx
  src/states.tsx  src/states.test.tsx           ErrorState duck-typing ApiErrorLike
  src/record-view.tsx  src/record-view.test.tsx  (từ components/data-view)
  src/delayed-action.tsx  src/delayed-action.test.tsx   thêm prop reloadGuard
  src/theme.ts  src/theme.test.ts               thêm tham số storageKey

apps/api/src/routes/catalog.ts        GET /v1/catalog công khai
apps/api/test/catalog.test.ts
apps/api/src/console/flags.ts         selfServeOpen()
apps/api/test/console-flags.test.ts
docs/evidence/commerce/2026-09-18-pha-0-packages.md
```

**Sửa**

```
apps/api/package.json                 thêm @mapslibvn/catalog
apps/api/src/billing/types.ts         re-export Tier/PaidTier/QuotaGroup từ catalog
apps/api/src/billing/quota-object.ts  import PLAN_CATALOG từ catalog
apps/api/src/routes/admin-catalog.ts  import từ catalog, dùng TIERS/QUOTA_GROUPS
apps/api/test/admin-catalog.test.ts   thêm priceVnd vào kỳ vọng
apps/api/test/billing-policy.test.ts  import từ catalog
apps/api/src/index.ts                 mount catalogRoute
apps/api/src/env.ts                   SELF_SERVE
apps/api/wrangler.toml                SELF_SERVE ở [vars] và [env.production]
apps/admin/package.json               thêm @mapslibvn/ui, bỏ cva/clsx/tailwind-merge
apps/admin/vite.config.ts             resolve.dedupe react
apps/admin/src/index.css              import tokens.css, @source
apps/admin/src/lib/theme.ts           adapter giữ khoá 'mapslibvn-admin-theme'
apps/admin/src/layout/app-shell.tsx   reloadGuard={setReloadGuard}
apps/admin/src/**                     import từ @mapslibvn/ui (sed)
docs/superpowers/specs/2026-09-18-thuong-mai-tu-phuc-vu-design.md   một dòng mục 4.1
docs/DEVLOG.md                        mục 18
```

**Xoá**: `apps/api/src/billing/catalog.ts`; `apps/admin/src/components/**` (ui/badge, ui/button, ui/card, states, data-view, delayed-action và test đi kèm); `apps/admin/src/lib/utils.ts`.

---

### Task 1: Scaffold `packages/catalog` và chuyển `PLAN_CATALOG` kèm giá VND

**Files:**
- Create: `packages/catalog/package.json`, `packages/catalog/tsconfig.json`, `packages/catalog/README.md`, `packages/catalog/src/plans.ts`, `packages/catalog/src/index.ts`
- Test: `packages/catalog/src/plans.test.ts`

- [ ] **Step 1: Tạo package.json và tsconfig.json**

`packages/catalog/package.json`:

```json
{
  "name": "@mapslibvn/catalog",
  "version": "0.1.0",
  "description": "Bảng giá, hạn mức, bảng so sánh và hàm tính tiền dùng chung cho API, website, console và Admin (nội bộ, không publish)",
  "private": true,
  "license": "MIT",
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^6.0.3"
  }
}
```

`packages/catalog/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "lib": ["ES2022"], "types": [] },
  "include": ["src"]
}
```

`packages/catalog/README.md`:

```markdown
# @mapslibvn/catalog

Nguồn sự thật duy nhất về giá, hạn mức và bảng so sánh của MapsLibVN. Package nội bộ, không
publish, không build: các app import thẳng `src/index.ts`.

- `PLAN_CATALOG` — bốn bậc và hai gói mua thêm, giá USD cent lẫn VND. Giá VND là đồng tiền THU
  thật; USD chỉ để hiện tham chiếu (`USD_REFERENCE_RATE`).
- `quoteOrder()` — tính tiền một đơn từ catalog; máy chủ luôn tính lại, không tin số client gửi.
- `addMonths()` — cộng tháng theo lịch, giờ Việt Nam.
- `COMPARISON` — bảng so sánh Google/VIETMAP đã đối chiếu 14/09/2026 kèm giả định và nguồn.

Đổi giá là đổi file này, một commit, một deploy. Nguồn quyết định:
`docs/research/2026-09-14-thuong-mai-hoa-va-gia-chot.md`.
```

- [ ] **Step 2: Viết test cho plans (đỏ)**

`packages/catalog/src/plans.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  PAID_TIERS,
  PERIOD_MONTHS,
  PLAN_CATALOG,
  QUOTA_GROUPS,
  TIERS,
  USD_REFERENCE_RATE,
} from './plans';

describe('PLAN_CATALOG', () => {
  it('giữ đúng bốn bậc theo thứ tự tăng dần và hai nhóm quota', () => {
    expect(TIERS).toEqual(['trial', 'starter', 'professional', 'business']);
    expect(PAID_TIERS).toEqual(['starter', 'professional', 'business']);
    expect(QUOTA_GROUPS).toEqual(['places', 'directions']);
  });

  it('giá USD cent khớp quyết định 14/09/2026', () => {
    expect(PLAN_CATALOG.trial.priceCents).toBe(0);
    expect(PLAN_CATALOG.starter.priceCents).toBe(2_500);
    expect(PLAN_CATALOG.professional.priceCents).toBe(10_000);
    expect(PLAN_CATALOG.business.priceCents).toBe(40_000);
    expect(PLAN_CATALOG.addOns.places.priceCents).toBe(100);
    expect(PLAN_CATALOG.addOns.directions.priceCents).toBe(300);
  });

  it('giá VND là số cố định đã chốt, KHÔNG suy từ USD lúc chạy', () => {
    expect(PLAN_CATALOG.trial.priceVnd).toBe(0);
    expect(PLAN_CATALOG.starter.priceVnd).toBe(650_000);
    expect(PLAN_CATALOG.professional.priceVnd).toBe(2_600_000);
    expect(PLAN_CATALOG.business.priceVnd).toBe(10_400_000);
    expect(PLAN_CATALOG.addOns.places.priceVnd).toBe(26_000);
    expect(PLAN_CATALOG.addOns.directions.priceVnd).toBe(78_000);
  });

  it('VND và USD nhất quán theo tỷ giá tham chiếu 26.000 (khoá lại để ai đổi một bên phải đổi cả hai)', () => {
    expect(USD_REFERENCE_RATE).toBe(26_000);
    for (const tier of PAID_TIERS) {
      const plan = PLAN_CATALOG[tier];
      expect(plan.priceVnd).toBe((plan.priceCents / 100) * USD_REFERENCE_RATE);
    }
    for (const group of QUOTA_GROUPS) {
      const addOn = PLAN_CATALOG.addOns[group];
      expect(addOn.priceVnd).toBe((addOn.priceCents / 100) * USD_REFERENCE_RATE);
    }
  });

  it('hạn mức và trần ngày y như bản đang chạy production', () => {
    expect(PLAN_CATALOG.trial).toMatchObject({
      places: 2_000,
      directions: 200,
      dailyPlaces: 200,
      dailyDirections: 20,
      onlineSupport: false,
    });
    expect(PLAN_CATALOG.starter).toMatchObject({
      places: 30_000,
      directions: 3_000,
      dailyPlaces: null,
      dailyDirections: null,
      onlineSupport: false,
    });
    expect(PLAN_CATALOG.professional).toMatchObject({
      places: 100_000,
      directions: 10_000,
      onlineSupport: true,
    });
    expect(PLAN_CATALOG.business).toMatchObject({
      places: 400_000,
      directions: 40_000,
      onlineSupport: true,
    });
    expect(PLAN_CATALOG.addOns.places.units).toBe(1_000);
    expect(PLAN_CATALOG.addOns.directions.units).toBe(1_000);
  });

  it('kỳ mua là 1, 3, 6, 12 tháng', () => {
    expect([...PERIOD_MONTHS]).toEqual([1, 3, 6, 12]);
  });
});
```

- [ ] **Step 3: Chạy test, xác nhận đỏ**

Run: `cd /Users/dtphong/Desktop/software_business/mapsLibVN && pnpm install && npx vitest run packages/catalog/src/plans.test.ts`
Expected: FAIL — `Failed to resolve import "./plans"` (file chưa có). `pnpm install` là để pnpm nhận package mới vào workspace (lockfile đổi — commit kèm).

- [ ] **Step 4: Viết `plans.ts` và `index.ts`**

`packages/catalog/src/plans.ts`:

```ts
export type QuotaGroup = 'places' | 'directions';
export type Tier = 'trial' | 'starter' | 'professional' | 'business';
export type PaidTier = Exclude<Tier, 'trial'>;

export interface PlanDefinition {
  /** USD cent theo quyết định 14/09/2026 — chỉ để hiện tham chiếu và cho báo cáo. */
  priceCents: number;
  /**
   * VND — đồng tiền THU thật (PHONG chốt 18/09/2026). Là số cố định, không suy từ `priceCents`
   * lúc chạy: đổi tỷ giá là một quyết định giá, phải đi qua commit.
   */
  priceVnd: number;
  places: number;
  directions: number;
  dailyPlaces: number | null;
  dailyDirections: number | null;
  onlineSupport: boolean;
}

export interface AddOnDefinition {
  units: number;
  priceCents: number;
  priceVnd: number;
}

export const TIERS: readonly Tier[] = ['trial', 'starter', 'professional', 'business'];
export const PAID_TIERS: readonly PaidTier[] = ['starter', 'professional', 'business'];
export const QUOTA_GROUPS: readonly QuotaGroup[] = ['places', 'directions'];

/** Tỷ giá THAM CHIẾU đã chốt 14/09/2026, chỉ để hiện USD mờ cạnh giá VND. */
export const USD_REFERENCE_RATE = 26_000;

/** Kỳ mua được phép, giá nhân đơn, không chiết khấu (PHONG chốt 18/09/2026). */
export const PERIOD_MONTHS = [1, 3, 6, 12] as const;
export type PeriodMonths = (typeof PERIOD_MONTHS)[number];

export const PLAN_CATALOG: Readonly<
  Record<Tier, Readonly<PlanDefinition>> & {
    addOns: Readonly<Record<QuotaGroup, Readonly<AddOnDefinition>>>;
  }
> = {
  trial: {
    priceCents: 0,
    priceVnd: 0,
    places: 2_000,
    directions: 200,
    dailyPlaces: 200,
    dailyDirections: 20,
    onlineSupport: false,
  },
  starter: {
    priceCents: 2_500,
    priceVnd: 650_000,
    places: 30_000,
    directions: 3_000,
    dailyPlaces: null,
    dailyDirections: null,
    onlineSupport: false,
  },
  professional: {
    priceCents: 10_000,
    priceVnd: 2_600_000,
    places: 100_000,
    directions: 10_000,
    dailyPlaces: null,
    dailyDirections: null,
    onlineSupport: true,
  },
  business: {
    priceCents: 40_000,
    priceVnd: 10_400_000,
    places: 400_000,
    directions: 40_000,
    dailyPlaces: null,
    dailyDirections: null,
    onlineSupport: true,
  },
  addOns: {
    places: { units: 1_000, priceCents: 100, priceVnd: 26_000 },
    directions: { units: 1_000, priceCents: 300, priceVnd: 78_000 },
  },
};
```

`packages/catalog/src/index.ts` (tạm thời, các task sau nối thêm):

```ts
export {
  type AddOnDefinition,
  PAID_TIERS,
  type PaidTier,
  PERIOD_MONTHS,
  type PeriodMonths,
  PLAN_CATALOG,
  type PlanDefinition,
  QUOTA_GROUPS,
  type QuotaGroup,
  TIERS,
  type Tier,
  USD_REFERENCE_RATE,
} from './plans';
```

- [ ] **Step 5: Chạy test, xác nhận xanh**

Run: `npx vitest run packages/catalog/src/plans.test.ts && pnpm --filter @mapslibvn/catalog typecheck`
Expected: `6 passed`; typecheck không lỗi.

- [ ] **Step 6: Commit**

```bash
git add packages/catalog pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(catalog): package nội bộ @mapslibvn/catalog với PLAN_CATALOG kèm giá VND

Pha 0 spec thương mại tự phục vụ. Chưa app nào dùng; apps/api vẫn đọc bản cũ.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `addMonths()` theo lịch giờ Việt Nam

**Files:**
- Create: `packages/catalog/src/months.ts`
- Test: `packages/catalog/src/months.test.ts`
- Modify: `packages/catalog/src/index.ts`

- [ ] **Step 1: Viết test (đỏ)**

`packages/catalog/src/months.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { addMonths } from './months';

describe('addMonths', () => {
  it('cộng đúng một tháng và giữ nguyên giờ phút giây', () => {
    // 10:00 ngày 15/03 giờ VN = 03:00Z
    expect(addMonths(new Date('2026-03-15T03:00:00.000Z'), 1).toISOString()).toBe(
      '2026-04-15T03:00:00.000Z',
    );
  });

  it('31/01 + 1 tháng lùi về ngày cuối tháng 02 (28)', () => {
    expect(addMonths(new Date('2026-01-31T03:00:00.000Z'), 1).toISOString()).toBe(
      '2026-02-28T03:00:00.000Z',
    );
  });

  it('năm nhuận: 31/01/2024 + 1 tháng → 29/02/2024', () => {
    expect(addMonths(new Date('2024-01-31T00:00:00.000Z'), 1).toISOString()).toBe(
      '2024-02-29T00:00:00.000Z',
    );
  });

  it('tính theo ngày Việt Nam, không theo UTC: 17:30Z 30/11 là 00:30 ngày 01/12 giờ VN', () => {
    // Nếu tính theo UTC sẽ ra 28/02/2027 17:30Z (30/11 + 3 → 28/02). Theo VN: 01/12 + 3 → 01/03.
    expect(addMonths(new Date('2026-11-30T17:30:00.000Z'), 3).toISOString()).toBe(
      '2027-02-28T17:30:00.000Z',
    );
  });

  it('12 tháng là cùng ngày năm sau', () => {
    expect(addMonths(new Date('2026-09-18T05:00:00.000Z'), 12).toISOString()).toBe(
      '2027-09-18T05:00:00.000Z',
    );
  });

  it('không nhận số tháng không phải nguyên dương', () => {
    expect(() => addMonths(new Date(), 0)).toThrow(RangeError);
    expect(() => addMonths(new Date(), 1.5)).toThrow(RangeError);
    expect(() => addMonths(new Date(), -1)).toThrow(RangeError);
  });
});
```

Lưu ý ca thứ tư: 17:30Z ngày 30/11 là 00:30 ngày **01/12** giờ VN; cộng 3 tháng thành 00:30 ngày 01/03/2027 giờ VN, tức `2027-02-28T17:30:00Z`. Con số ISO trông giống "28/02" nhưng đó là do lệch múi giờ, không phải do lùi ngày cuối tháng.

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run packages/catalog/src/months.test.ts`
Expected: FAIL — không resolve được `./months`.

- [ ] **Step 3: Viết `months.ts`**

```ts
/** Việt Nam là UTC+7, không có giờ mùa hè — một hằng số là đủ. */
const VN_OFFSET_MS = 7 * 3_600_000;

/**
 * Cộng `months` tháng theo lịch, tính trên ngày giờ Việt Nam và giữ nguyên giờ phút giây.
 * Ngày vượt quá độ dài tháng đích thì lùi về ngày cuối tháng: 31/01 + 1 → 28/02 (29/02 năm nhuận).
 *
 * Kỳ thuê bao của khách bắt đầu và kết thúc theo ngày Việt Nam, nên phải dịch sang UTC+7 trước khi
 * làm toán lịch rồi dịch ngược; làm thẳng trên UTC sẽ sai một ngày cho mọi mốc từ 17:00Z trở đi.
 */
export function addMonths(startsAt: Date, months: number): Date {
  if (!Number.isInteger(months) || months <= 0) {
    throw new RangeError('months phải là số nguyên dương');
  }
  const vn = new Date(startsAt.getTime() + VN_OFFSET_MS);
  const day = vn.getUTCDate();
  const target = new Date(
    Date.UTC(
      vn.getUTCFullYear(),
      vn.getUTCMonth() + months,
      1,
      vn.getUTCHours(),
      vn.getUTCMinutes(),
      vn.getUTCSeconds(),
      vn.getUTCMilliseconds(),
    ),
  );
  // Ngày 0 của tháng kế tiếp = ngày cuối của tháng đích.
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return new Date(target.getTime() - VN_OFFSET_MS);
}
```

Thêm vào `packages/catalog/src/index.ts`:

```ts
export { addMonths } from './months';
```

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `npx vitest run packages/catalog/src/months.test.ts && pnpm --filter @mapslibvn/catalog typecheck`
Expected: `6 passed`.

- [ ] **Step 5: Commit**

```bash
git add packages/catalog
git commit -m "$(cat <<'EOF'
feat(catalog): addMonths theo lịch giờ Việt Nam, lùi về cuối tháng khi thiếu ngày

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `quoteOrder()` — máy chủ tính tiền từ catalog

**Files:**
- Create: `packages/catalog/src/quote.ts`
- Test: `packages/catalog/src/quote.test.ts`
- Modify: `packages/catalog/src/index.ts`

- [ ] **Step 1: Viết test (đỏ)**

`packages/catalog/src/quote.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CatalogError, MAX_PACKS, quoteOrder } from './quote';

describe('quoteOrder', () => {
  it('gói theo tháng: giá nhân số tháng, không chiết khấu', () => {
    expect(quoteOrder({ kind: 'plan', tier: 'starter', months: 1 })).toEqual({
      amountVnd: 650_000,
      amountUsdCents: 2_500,
    });
    expect(quoteOrder({ kind: 'plan', tier: 'starter', months: 3 })).toEqual({
      amountVnd: 1_950_000,
      amountUsdCents: 7_500,
    });
    expect(quoteOrder({ kind: 'plan', tier: 'business', months: 12 })).toEqual({
      amountVnd: 124_800_000,
      amountUsdCents: 480_000,
    });
  });

  it('mua thêm lượt: đơn giá khối nhân số khối', () => {
    expect(quoteOrder({ kind: 'addon', group: 'places', packs: 5 })).toEqual({
      amountVnd: 130_000,
      amountUsdCents: 500,
    });
    expect(quoteOrder({ kind: 'addon', group: 'directions', packs: 2 })).toEqual({
      amountVnd: 156_000,
      amountUsdCents: 600,
    });
  });

  it('từ chối kỳ ngoài 1/3/6/12 dù kiểu TypeScript bị lách qua JSON', () => {
    const input = { kind: 'plan', tier: 'starter', months: 2 } as unknown as Parameters<
      typeof quoteOrder
    >[0];
    expect(() => quoteOrder(input)).toThrow(CatalogError);
    expect(() => quoteOrder(input)).toThrow('invalid_months');
  });

  it('từ chối trial và bậc lạ ở đơn gói', () => {
    const trial = { kind: 'plan', tier: 'trial', months: 1 } as unknown as Parameters<
      typeof quoteOrder
    >[0];
    expect(() => quoteOrder(trial)).toThrow('invalid_tier');
    const la = { kind: 'plan', tier: 'enterprise', months: 1 } as unknown as Parameters<
      typeof quoteOrder
    >[0];
    expect(() => quoteOrder(la)).toThrow('invalid_tier');
  });

  it('từ chối số khối không nguyên, bằng 0 hoặc vượt trần', () => {
    expect(() => quoteOrder({ kind: 'addon', group: 'places', packs: 0 })).toThrow('invalid_packs');
    expect(() => quoteOrder({ kind: 'addon', group: 'places', packs: 1.5 })).toThrow(
      'invalid_packs',
    );
    expect(() => quoteOrder({ kind: 'addon', group: 'places', packs: MAX_PACKS + 1 })).toThrow(
      'invalid_packs',
    );
    expect(quoteOrder({ kind: 'addon', group: 'places', packs: MAX_PACKS }).amountVnd).toBe(
      26_000 * MAX_PACKS,
    );
  });

  it('từ chối nhóm quota lạ và loại đơn lạ', () => {
    const nhom = { kind: 'addon', group: 'tiles', packs: 1 } as unknown as Parameters<
      typeof quoteOrder
    >[0];
    expect(() => quoteOrder(nhom)).toThrow('invalid_group');
    const loai = { kind: 'gift' } as unknown as Parameters<typeof quoteOrder>[0];
    expect(() => quoteOrder(loai)).toThrow('invalid_kind');
  });

  it('CatalogError mang mã ở cả .code lẫn .message để route API dịch thẳng sang 400', () => {
    try {
      quoteOrder({ kind: 'addon', group: 'places', packs: 0 });
    } catch (error) {
      expect(error).toBeInstanceOf(CatalogError);
      expect((error as CatalogError).code).toBe('invalid_packs');
      expect((error as CatalogError).name).toBe('CatalogError');
    }
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run packages/catalog/src/quote.test.ts`
Expected: FAIL — không resolve được `./quote`.

- [ ] **Step 3: Viết `quote.ts`**

```ts
import {
  PAID_TIERS,
  type PaidTier,
  PERIOD_MONTHS,
  type PeriodMonths,
  PLAN_CATALOG,
  QUOTA_GROUPS,
  type QuotaGroup,
} from './plans';

export type OrderInput =
  | { kind: 'plan'; tier: PaidTier; months: PeriodMonths }
  | { kind: 'addon'; group: QuotaGroup; packs: number };

export interface Quote {
  amountVnd: number;
  amountUsdCents: number;
}

/** Trần số khối một đơn — khớp CHECK (packs <= 1000) của bảng customer_order (spec 5.2). */
export const MAX_PACKS = 1_000;

export type CatalogErrorCode =
  | 'invalid_kind'
  | 'invalid_tier'
  | 'invalid_months'
  | 'invalid_group'
  | 'invalid_packs';

/** Mã nằm ở cả `code` lẫn `message`: route API khớp theo message được ngay, không cần instanceof. */
export class CatalogError extends Error {
  constructor(readonly code: CatalogErrorCode) {
    super(code);
    this.name = 'CatalogError';
  }
}

/**
 * Tính tiền một đơn. Input tới từ JSON của client nên kiểm lại từng trường lúc chạy — kiểu
 * TypeScript không bảo vệ được biên giới mạng. Máy chủ luôn gọi hàm này và bỏ mọi số tiền client gửi.
 */
export function quoteOrder(input: OrderInput): Quote {
  if (input.kind === 'plan') {
    if (!(PAID_TIERS as readonly string[]).includes(input.tier)) {
      throw new CatalogError('invalid_tier');
    }
    if (!(PERIOD_MONTHS as readonly number[]).includes(input.months)) {
      throw new CatalogError('invalid_months');
    }
    const plan = PLAN_CATALOG[input.tier];
    return {
      amountVnd: plan.priceVnd * input.months,
      amountUsdCents: plan.priceCents * input.months,
    };
  }
  if (input.kind === 'addon') {
    if (!(QUOTA_GROUPS as readonly string[]).includes(input.group)) {
      throw new CatalogError('invalid_group');
    }
    if (!Number.isInteger(input.packs) || input.packs < 1 || input.packs > MAX_PACKS) {
      throw new CatalogError('invalid_packs');
    }
    const addOn = PLAN_CATALOG.addOns[input.group];
    return {
      amountVnd: addOn.priceVnd * input.packs,
      amountUsdCents: addOn.priceCents * input.packs,
    };
  }
  throw new CatalogError('invalid_kind');
}
```

Thêm vào `packages/catalog/src/index.ts`:

```ts
export {
  CatalogError,
  type CatalogErrorCode,
  MAX_PACKS,
  type OrderInput,
  type Quote,
  quoteOrder,
} from './quote';
```

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `npx vitest run packages/catalog/src/quote.test.ts && pnpm --filter @mapslibvn/catalog typecheck`
Expected: `7 passed`.

- [ ] **Step 5: Commit**

```bash
git add packages/catalog
git commit -m "$(cat <<'EOF'
feat(catalog): quoteOrder tính tiền VND/USD từ catalog, kiểm input lúc chạy

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `COMPARISON` — bảng so sánh Google/VIETMAP có ngày, giả định và nguồn

**Files:**
- Create: `packages/catalog/src/comparison.ts`
- Test: `packages/catalog/src/comparison.test.ts`
- Modify: `packages/catalog/src/index.ts`

- [ ] **Step 1: Viết test (đỏ)**

`packages/catalog/src/comparison.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { COMPARISON, comparisonAgeDays, savingsPercent } from './comparison';
import { PLAN_CATALOG } from './plans';

describe('COMPARISON', () => {
  it('ba dòng workload đúng thứ tự Starter → Professional → Business', () => {
    expect(COMPARISON.rows.map((row) => row.tier)).toEqual(['starter', 'professional', 'business']);
  });

  it('giá MapsLibVN trong bảng khớp PLAN_CATALOG — không có bản chép tay thứ hai', () => {
    for (const row of COMPARISON.rows) {
      const plan = PLAN_CATALOG[row.tier];
      expect(row.mapslibvnUsd).toBe(plan.priceCents / 100);
      expect(row.mapslibvnVnd).toBe(plan.priceVnd);
      expect(row.places).toBe(plan.places);
      expect(row.directions).toBe(plan.directions);
    }
  });

  it('số đối thủ đúng bản đối chiếu 14/09/2026', () => {
    expect(COMPARISON.rows[0]).toMatchObject({ googleUsd: 39.62, vietmapUsd: 63.46 });
    expect(COMPARISON.rows[1]).toMatchObject({ googleUsd: 248.1, vietmapUsd: 211.54 });
    expect(COMPARISON.rows[2]).toMatchObject({ googleUsd: 1254.1, vietmapUsd: 846.15 });
    expect(COMPARISON.rows[0]).toMatchObject({ googleVnd: 1_030_120, vietmapVnd: 1_650_000 });
    expect(COMPARISON.rows[1]).toMatchObject({ googleVnd: 6_450_600, vietmapVnd: 5_500_000 });
    expect(COMPARISON.rows[2]).toMatchObject({ googleVnd: 32_606_600, vietmapVnd: 22_000_000 });
  });

  it('có ngày đối chiếu hợp lệ, ba nguồn và lời dặn không quảng cáo cho mọi workload', () => {
    expect(COMPARISON.checkedAt).toBe('2026-09-14');
    expect(Number.isNaN(Date.parse(COMPARISON.checkedAt))).toBe(false);
    expect(COMPARISON.sources).toHaveLength(3);
    for (const url of COMPARISON.sources) expect(url).toMatch(/^https:\/\//);
    expect(COMPARISON.disclaimer).toMatch(/mọi workload/);
    expect(COMPARISON.assumptions.length).toBeGreaterThanOrEqual(3);
  });
});

describe('savingsPercent', () => {
  it('cho ra đúng sáu con số của tài liệu nghiên cứu (làm tròn hai chữ số)', () => {
    const [s, p, b] = COMPARISON.rows;
    expect(savingsPercent(s.mapslibvnUsd, s.googleUsd)).toBe(36.9);
    expect(savingsPercent(s.mapslibvnUsd, s.vietmapUsd)).toBe(60.61);
    expect(savingsPercent(p.mapslibvnUsd, p.googleUsd)).toBe(59.69);
    expect(savingsPercent(p.mapslibvnUsd, p.vietmapUsd)).toBe(52.73);
    expect(savingsPercent(b.mapslibvnUsd, b.googleUsd)).toBe(68.1);
    expect(savingsPercent(b.mapslibvnUsd, b.vietmapUsd)).toBe(52.73);
  });

  it('không chia cho 0', () => {
    expect(() => savingsPercent(1, 0)).toThrow(RangeError);
  });
});

describe('comparisonAgeDays', () => {
  it('đếm số ngày từ ngày đối chiếu tới hôm nay', () => {
    expect(comparisonAgeDays(new Date('2026-09-14T00:00:00Z'))).toBe(0);
    expect(comparisonAgeDays(new Date('2026-09-18T12:00:00Z'))).toBe(4);
    expect(comparisonAgeDays(new Date('2027-03-13T00:00:00Z'))).toBe(180);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run packages/catalog/src/comparison.test.ts`
Expected: FAIL — không resolve được `./comparison`.

- [ ] **Step 3: Viết `comparison.ts`**

```ts
import type { PaidTier } from './plans';

export interface ComparisonRow {
  tier: PaidTier;
  /** Workload tháng mà ba cột giá cùng mô tả. */
  places: number;
  directions: number;
  mapslibvnUsd: number;
  googleUsd: number;
  vietmapUsd: number;
  mapslibvnVnd: number;
  googleVnd: number;
  vietmapVnd: number;
}

/**
 * Bảng so sánh của `docs/research/2026-09-14-thuong-mai-hoa-va-gia-chot.md` mục 2, chép nguyên số.
 * Website phải in cả `checkedAt`, `assumptions` và `sources` cạnh bảng — con số không có bối cảnh
 * là quảng cáo sai. Cột MapsLibVN cố ý trùng PLAN_CATALOG và có test khoá lại.
 */
export const COMPARISON: Readonly<{
  checkedAt: string;
  sources: readonly string[];
  assumptions: readonly string[];
  disclaimer: string;
  /** Tuple ba phần tử chứ không phải mảng: `noUncheckedIndexedAccess` sẽ bắt `rows[0]` có thể undefined. */
  rows: readonly [ComparisonRow, ComparisonRow, ComparisonRow];
}> = {
  checkedAt: '2026-09-14',
  sources: [
    'https://developers.google.com/maps/billing-and-pricing/pricing',
    'https://maps.vietmap.vn/web',
    'https://maps.vietmap.vn/docs/map-api/console/request-to-transaction/',
  ],
  assumptions: [
    'Places = 80 % Autocomplete tính theo request + 20 % Geocoding; tuyến cơ bản hai điểm.',
    'Google đã trừ hạn mức miễn phí theo từng SKU và áp bậc giá; chưa tính tiles, map loads, Places Details, Matrix, navigation, thuế, ưu đãi hay hợp đồng riêng.',
    'VIETMAP 50 đ/transaction, 1 request = 1 transaction ở workload này, sau giai đoạn dùng thử.',
    'VND quy đổi tham chiếu 26.000 đ/USD, không phải tỷ giá trực tiếp hay quyết định về VAT.',
  ],
  disclaimer:
    'Không quảng cáo tỷ lệ này cho mọi workload hay cho khách còn trong hạn mức miễn phí của nhà cung cấp khác.',
  rows: [
    {
      tier: 'starter',
      places: 30_000,
      directions: 3_000,
      mapslibvnUsd: 25,
      googleUsd: 39.62,
      vietmapUsd: 63.46,
      mapslibvnVnd: 650_000,
      googleVnd: 1_030_120,
      vietmapVnd: 1_650_000,
    },
    {
      tier: 'professional',
      places: 100_000,
      directions: 10_000,
      mapslibvnUsd: 100,
      googleUsd: 248.1,
      vietmapUsd: 211.54,
      mapslibvnVnd: 2_600_000,
      googleVnd: 6_450_600,
      vietmapVnd: 5_500_000,
    },
    {
      tier: 'business',
      places: 400_000,
      directions: 40_000,
      mapslibvnUsd: 400,
      googleUsd: 1254.1,
      vietmapUsd: 846.15,
      mapslibvnVnd: 10_400_000,
      googleVnd: 32_606_600,
      vietmapVnd: 22_000_000,
    },
  ],
};

/** Phần trăm rẻ hơn, làm tròn hai chữ số: (theirs − ours) / theirs × 100. */
export function savingsPercent(ours: number, theirs: number): number {
  if (theirs <= 0) throw new RangeError('theirs phải lớn hơn 0');
  return Math.round(((theirs - ours) / theirs) * 10_000) / 100;
}

/** Số ngày trọn kể từ `checkedAt`; website dùng để cảnh báo khi bảng quá 180 ngày (spec mục 18). */
export function comparisonAgeDays(now: Date): number {
  const checked = Date.parse(`${COMPARISON.checkedAt}T00:00:00Z`);
  return Math.floor((now.getTime() - checked) / 86_400_000);
}
```

Thêm vào `packages/catalog/src/index.ts`:

```ts
export { COMPARISON, type ComparisonRow, comparisonAgeDays, savingsPercent } from './comparison';
```

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `npx vitest run packages/catalog && pnpm --filter @mapslibvn/catalog typecheck && pnpm lint`
Expected: 4 file test xanh (plans 6 + months 6 + quote 7 + comparison 7 = 26 test); lint sạch (biome sắp lại thứ tự export nếu cần — chạy `pnpm lint:fix` rồi kiểm lại).

- [ ] **Step 5: Commit**

```bash
git add packages/catalog
git commit -m "$(cat <<'EOF'
feat(catalog): bảng so sánh Google/VIETMAP 14/09 kèm giả định, nguồn và savingsPercent

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `apps/api` chuyển sang `@mapslibvn/catalog`, xoá bản cũ

**Files:**
- Modify: `apps/api/package.json`, `apps/api/src/billing/types.ts:1-3`, `apps/api/src/billing/quota-object.ts:3`, `apps/api/src/routes/admin-catalog.ts`, `apps/api/test/admin-catalog.test.ts`, `apps/api/test/billing-policy.test.ts:2`
- Delete: `apps/api/src/billing/catalog.ts`

- [ ] **Step 1: Sửa test admin-catalog cho `priceVnd` (đỏ trước khi đổi mã)**

Trong `apps/api/test/admin-catalog.test.ts` đổi interface và kỳ vọng:

```ts
interface Catalog {
  tiers: {
    tier: string;
    priceCents: number;
    priceVnd: number;
    places: number;
    directions: number;
    dailyPlaces: number | null;
    dailyDirections: number | null;
    onlineSupport: boolean;
  }[];
  addOns: { group: string; units: number; priceCents: number; priceVnd: number }[];
  legacyDefaults: { places: number; directions: number; blockAtMultiple: number };
}
```

và trong bài test đầu, thay hai kỳ vọng:

```ts
    expect(body.tiers[1]).toMatchObject({
      tier: 'starter',
      places: 30_000,
      dailyPlaces: null,
      priceCents: 2_500,
      priceVnd: 650_000,
    });
    expect(body.addOns).toEqual([
      { group: 'places', units: 1_000, priceCents: 100, priceVnd: 26_000 },
      { group: 'directions', units: 1_000, priceCents: 300, priceVnd: 78_000 },
    ]);
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `pnpm --filter @mapslibvn/api test -- admin-catalog`
Expected: FAIL — `priceVnd` undefined trong body.

- [ ] **Step 3: Thêm dependency và đổi import**

`apps/api/package.json` — thêm vào `dependencies`, giữ thứ tự bảng chữ cái:

```json
    "@mapslibvn/catalog": "workspace:*",
```

Run: `pnpm install` (cập nhật lockfile, tạo symlink).

`apps/api/src/billing/types.ts` — thay ba dòng đầu:

```ts
import type { PaidTier, QuotaGroup, Tier } from '@mapslibvn/catalog';

export type { PaidTier, QuotaGroup, Tier };
```

(Xoá `export type QuotaGroup = …`, `export type Tier = …`, `export type PaidTier = …`. Phải `import`
rồi mới `export` vì chính file này còn dùng `QuotaGroup`/`Tier` trong `ReserveResult`,
`UsageSnapshot`…; `export type { … } from` một mình chỉ chuyển tiếp, không đưa tên vào scope. Mọi
chỗ khác trong api đang `import type { Tier } from './types'` vẫn chạy.)

`apps/api/src/billing/quota-object.ts` dòng 3:

```ts
import { PLAN_CATALOG } from '@mapslibvn/catalog';
```

`apps/api/test/billing-policy.test.ts` dòng 2:

```ts
import { PLAN_CATALOG } from '@mapslibvn/catalog';
```

`apps/api/src/routes/admin-catalog.ts` — viết lại phần import và hai hằng:

```ts
import { PLAN_CATALOG, QUOTA_GROUPS, TIERS } from '@mapslibvn/catalog';
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { FREE_DIRECTIONS_PER_DAY, FREE_PLACES_PER_DAY } from '../quota';
```

xoá hai dòng `const TIERS = …` và `const GROUPS = …`, đổi `GROUPS.map` thành `QUOTA_GROUPS.map`. Phần còn lại giữ nguyên — `...PLAN_CATALOG[tier]` tự mang `priceVnd`.

- [ ] **Step 4: Xoá bản cũ**

```bash
git rm apps/api/src/billing/catalog.ts
grep -rn "billing/catalog'\|'./catalog'" apps/api/src apps/api/test
```

Expected: grep không còn kết quả nào.

- [ ] **Step 5: Chạy toàn bộ test và typecheck của api**

Run: `pnpm --filter @mapslibvn/api test && pnpm --filter @mapslibvn/api typecheck`
Expected: toàn bộ xanh (mốc 15/09: 44 file/333 test; con số có thể đã tăng). Nếu vitest-pool-workers báo không resolve được `@mapslibvn/catalog`: kiểm `ls apps/api/node_modules/@mapslibvn/` phải thấy `catalog` — thiếu thì `pnpm install` chưa chạy sau khi sửa package.json.

- [ ] **Step 6: Commit**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
refactor(api): đọc PLAN_CATALOG từ @mapslibvn/catalog, plan-catalog trả thêm priceVnd

Xoá apps/api/src/billing/catalog.ts; Tier/PaidTier/QuotaGroup re-export từ package để
chỗ import './types' không phải đổi.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `GET /v1/catalog` công khai

**Files:**
- Create: `apps/api/src/routes/catalog.ts`
- Test: `apps/api/test/catalog.test.ts`
- Modify: `apps/api/src/index.ts` (mount sau `/v1/attribution`)

- [ ] **Step 1: Viết test (đỏ)**

`apps/api/test/catalog.test.ts`:

```ts
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

interface PublicCatalog {
  currency: string;
  usdReferenceRate: number;
  periodMonths: number[];
  tiers: { tier: string; priceVnd: number; priceCents: number; places: number }[];
  addOns: { group: string; units: number; priceVnd: number; priceCents: number }[];
}

describe('GET /v1/catalog', () => {
  it('không cần khoá API lẫn Access, cache công khai một giờ', async () => {
    const response = await SELF.fetch('https://api/v1/catalog');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
  });

  it('trả đúng bảng giá VND chính, USD tham chiếu và kỳ mua', async () => {
    const body = (await (await SELF.fetch('https://api/v1/catalog')).json()) as PublicCatalog;
    expect(body.currency).toBe('VND');
    expect(body.usdReferenceRate).toBe(26_000);
    expect(body.periodMonths).toEqual([1, 3, 6, 12]);
    expect(body.tiers.map((t) => t.tier)).toEqual(['trial', 'starter', 'professional', 'business']);
    expect(body.tiers[1]).toMatchObject({ priceVnd: 650_000, priceCents: 2_500, places: 30_000 });
    expect(body.addOns).toEqual([
      { group: 'places', units: 1_000, priceCents: 100, priceVnd: 26_000 },
      { group: 'directions', units: 1_000, priceCents: 300, priceVnd: 78_000 },
    ]);
  });

  it('KHÔNG lộ legacyDefaults — chuyện nội bộ của tenant chưa vào sổ thương mại', async () => {
    const body = (await (await SELF.fetch('https://api/v1/catalog')).json()) as Record<
      string,
      unknown
    >;
    expect(body).not.toHaveProperty('legacyDefaults');
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `pnpm --filter @mapslibvn/api test -- catalog.test`
Expected: FAIL — 404 `not_found` (route chưa có). Lưu ý bộ lọc `catalog.test` cũng khớp `admin-catalog.test.ts`; bài đó vẫn xanh.

- [ ] **Step 3: Viết route và mount**

`apps/api/src/routes/catalog.ts`:

```ts
import {
  PERIOD_MONTHS,
  PLAN_CATALOG,
  QUOTA_GROUPS,
  TIERS,
  USD_REFERENCE_RATE,
} from '@mapslibvn/catalog';
import { Hono } from 'hono';
import type { AppEnv } from '../env';

/**
 * Bảng giá công khai cho console và cho ai muốn đọc bằng máy. Không cần khoá, không cần Access:
 * đây là đúng con số in trên website. Khác `/v1/admin/plan-catalog` ở hai điểm: không có
 * `legacyDefaults` (chuyện nội bộ của tenant chưa vào sổ thương mại) và cache công khai một giờ.
 */
export const catalogRoute = new Hono<AppEnv>();

catalogRoute.get('/v1/catalog', (c) =>
  c.json(
    {
      currency: 'VND',
      usdReferenceRate: USD_REFERENCE_RATE,
      periodMonths: [...PERIOD_MONTHS],
      tiers: TIERS.map((tier) => ({ tier, ...PLAN_CATALOG[tier] })),
      addOns: QUOTA_GROUPS.map((group) => ({ group, ...PLAN_CATALOG.addOns[group] })),
    },
    200,
    { 'cache-control': 'public, max-age=3600' },
  ),
);
```

`apps/api/src/index.ts` — thêm import (theo thứ tự bảng chữ cái, sau `billingAdmin`):

```ts
import { catalogRoute } from './routes/catalog';
```

và ngay sau khối `app.get('/v1/attribution', …)`:

```ts
app.route('/', catalogRoute);
```

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `pnpm --filter @mapslibvn/api test && pnpm --filter @mapslibvn/api typecheck && pnpm lint`
Expected: toàn bộ xanh, lint sạch.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/catalog.ts apps/api/test/catalog.test.ts apps/api/src/index.ts
git commit -m "$(cat <<'EOF'
feat(api): GET /v1/catalog công khai — bảng giá VND, USD tham chiếu, kỳ mua

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Cờ `SELF_SERVE`

**Files:**
- Create: `apps/api/src/console/flags.ts`
- Test: `apps/api/test/console-flags.test.ts`
- Modify: `apps/api/src/env.ts`, `apps/api/wrangler.toml`

- [ ] **Step 1: Viết test (đỏ)**

`apps/api/test/console-flags.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { selfServeOpen } from '../src/console/flags';

describe('selfServeOpen', () => {
  it("chỉ mở khi SELF_SERVE đúng bằng '1'", () => {
    expect(selfServeOpen({ SELF_SERVE: '1' })).toBe(true);
  });

  it("đóng với '0', thiếu biến, hay bất kỳ chuỗi nào khác — fail closed", () => {
    expect(selfServeOpen({ SELF_SERVE: '0' })).toBe(false);
    expect(selfServeOpen({})).toBe(false);
    expect(selfServeOpen({ SELF_SERVE: 'true' })).toBe(false);
    expect(selfServeOpen({ SELF_SERVE: ' 1' })).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `pnpm --filter @mapslibvn/api test -- console-flags`
Expected: FAIL — không resolve được `../src/console/flags`.

- [ ] **Step 3: Viết `flags.ts`, khai `env.ts`, `wrangler.toml`**

`apps/api/src/console/flags.ts`:

```ts
import type { Env } from '../env';

/**
 * Cổng tự phục vụ (spec mục 12, 16). Đóng thì mọi route `/v1/console/*` trừ `config` và `catalog`
 * trả 503 `self_serve_closed`, SPA hiện màn "Sắp mở". Chỉ nhận đúng chuỗi '1' — cùng quy ước với
 * QUOTA_ENABLED và COMMERCIAL_ADMISSION, để một lần gõ nhầm không mở cửa.
 */
export function selfServeOpen(env: Pick<Env, 'SELF_SERVE'>): boolean {
  return env.SELF_SERVE === '1';
}
```

`apps/api/src/env.ts` — thêm sau `COMMERCIAL_ADMISSION?: string;`:

```ts
  /**
   * '1' = mở cổng khách hàng tự phục vụ (`/console`, `/v1/console/*`). Mặc định đóng; bật cuối
   * pha 2 sau khi nghiệm thu (spec thương mại tự phục vụ mục 16, 19). Giá trị đặt trong
   * wrangler.toml, KHÔNG truyền --var: --var bị lần deploy sau xoá sạch.
   */
  SELF_SERVE?: string;
```

`apps/api/wrangler.toml` — trong `[vars]`, ngay dưới dòng `COMMERCIAL_ADMISSION = "0"`:

```toml
# Cổng khách hàng tự phục vụ (spec 2026-09-18-thuong-mai-tu-phuc-vu). Đóng ở cả dev lẫn production
# cho tới khi pha 2 nghiệm thu; bật bằng cách sửa dòng này (và dòng trong [env.production]).
SELF_SERVE = "0"
```

và trong bảng inline `vars = { … }` của `[env.production]`, thêm `, SELF_SERVE = "0"` ngay sau `COMMERCIAL_ADMISSION = "1"`:

```toml
vars = { TILES_BASE = "https://tiles.ai-solutions.io.vn", ENVIRONMENT = "production", QUOTA_ENABLED = "1", COMMERCIAL_ADMISSION = "1", SELF_SERVE = "0", ROUTING_BASE = "https://maps-route.ai-solutions.io.vn", ACCESS_TEAM_DOMAIN = "snowy-credit-f444.cloudflareaccess.com", ACCESS_AUD = "26088029373e358f9a24e68f66fe85ccc0c771e53cde538638a54151969cc6f5", AUTOCOMPLETE_FAST = "1", CF_ACCOUNT_ID = "90de8c1aef96991cdf2a49008f9a0122" }
```

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `pnpm --filter @mapslibvn/api test -- console-flags && pnpm --filter @mapslibvn/api typecheck && cd apps/api && npx wrangler deploy --dry-run --outdir .wrangler/dry-run --env production && cd ../..`
Expected: 2 test xanh; `wrangler deploy --dry-run` in ra bundle thành công (chứng minh esbuild bundle được `@mapslibvn/catalog` từ source) và không báo lỗi parse TOML. Chạy từ `apps/api` vì wrangler đọc `.env` ở gốc repo theo đường dẫn tương đối; `.wrangler/` đã nằm trong gitignore.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/console/flags.ts apps/api/test/console-flags.test.ts apps/api/src/env.ts apps/api/wrangler.toml
git commit -m "$(cat <<'EOF'
feat(api): cờ SELF_SERVE (đóng) và selfServeOpen() cho cổng khách hàng

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Scaffold `packages/ui` với `cn`, `Button`, `Badge`, `Card`

**Files:**
- Create: `packages/ui/package.json`, `packages/ui/tsconfig.json`, `packages/ui/README.md`, `packages/ui/src/test-types.d.ts`, `packages/ui/src/index.ts`, `packages/ui/src/cn.ts`, `packages/ui/src/badge.tsx`, `packages/ui/src/button.tsx`, `packages/ui/src/card.tsx`
- Test: `packages/ui/src/button.test.tsx`, `packages/ui/src/card.test.tsx`

Task này **chép** ba component từ admin sang (chưa xoá bản admin — Task 10 mới xoá), đổi mỗi import `@/lib/utils` thành `./cn`. Chép bằng `git mv` sẽ làm admin vỡ giữa chừng; chép rồi xoá sau cho từng bước đều xanh.

- [ ] **Step 1: package.json, tsconfig, README, test-types**

`packages/ui/package.json`:

```json
{
  "name": "@mapslibvn/ui",
  "version": "0.1.0",
  "description": "Bộ giao diện dùng chung cho trang Admin và cổng khách hàng: token màu, nút, thẻ, huy hiệu, năm trạng thái, RecordView, delayed-action, theme (nội bộ, không publish)",
  "private": true,
  "license": "MIT",
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    },
    "./tokens.css": "./src/tokens.css"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "tailwind-merge": "^3.7.0"
  },
  "peerDependencies": {
    "react": "^19.3.0",
    "react-dom": "^19.3.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^7.0.1",
    "@testing-library/react": "^16.3.3",
    "@testing-library/user-event": "^14.6.7",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "react": "^19.3.0",
    "react-dom": "^19.3.0",
    "typescript": "^6.0.3"
  }
}
```

`packages/ui/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["react", "react-dom"],
    "noEmit": true
  },
  "include": ["src"]
}
```

`packages/ui/src/test-types.d.ts`:

```ts
// Kéo kiểu matcher của jest-dom (toBeVisible, toHaveAttribute…) vào chương trình typecheck của
// package. Lúc chạy, root vitest nạp matcher qua apps/admin/src/test-setup.ts; file này chỉ lo kiểu.
import '@testing-library/jest-dom/vitest';
```

`packages/ui/README.md`:

````markdown
# @mapslibvn/ui

Bộ giao diện dùng chung cho `apps/admin` và `apps/console` (và `tokens.css` cho `apps/site`).
Package nội bộ, không publish, không build: app import thẳng `src/index.ts`, Vite biên dịch.

Hai việc app dùng package PHẢI làm trong CSS gốc, sau `@import "tailwindcss"`:

```css
@import "../../../packages/ui/src/tokens.css";  /* @theme + biến màu; đường dẫn tương đối */
@source "../../../packages/ui/src";              /* Tailwind không quét node_modules — thiếu dòng này nút mất kiểu mà không có lỗi */
```

Ranh giới: package không biết fetcher, router hay API của app nào. `ErrorState` nhận lỗi bất kỳ
và đọc `status`/`code`/`message` nếu có (`isApiErrorLike`); `DelayedActionProvider` nhận
`reloadGuard` để app nối với fetcher của mình; `theme` nhận `storageKey` để hai app không kéo
theme của nhau.
````

- [ ] **Step 2: `pnpm install` rồi chép ba component và test**

```bash
pnpm install
mkdir -p packages/ui/src
cp apps/admin/src/lib/utils.ts            packages/ui/src/cn.ts
cp apps/admin/src/components/ui/badge.tsx packages/ui/src/badge.tsx
cp apps/admin/src/components/ui/button.tsx packages/ui/src/button.tsx
cp apps/admin/src/components/ui/card.tsx  packages/ui/src/card.tsx
cp apps/admin/src/components/ui/button.test.tsx packages/ui/src/button.test.tsx
cp apps/admin/src/components/ui/card.test.tsx   packages/ui/src/card.test.tsx
sed -i '' "s#from '@/lib/utils'#from './cn'#" packages/ui/src/badge.tsx packages/ui/src/button.tsx packages/ui/src/card.tsx
grep -n "@/" packages/ui/src/*.tsx packages/ui/src/*.ts
```

Expected: grep cuối **không** còn dòng nào chứa `@/` — package không được dùng alias của admin.

- [ ] **Step 3: Barrel**

`packages/ui/src/index.ts`:

```ts
export { Badge, type BadgeProps } from './badge';
export { Button, type ButtonProps } from './button';
export { Card, CardMuted, type CardProps, CardTitle } from './card';
export { cn } from './cn';
```

- [ ] **Step 4: Chạy test và typecheck của package**

Run: `npx vitest run packages/ui && pnpm --filter @mapslibvn/ui typecheck && pnpm lint`
Expected: `button.test.tsx` 3 test + `card.test.tsx` 4 test xanh; typecheck sạch; lint sạch (nếu biome đòi sắp lại export thì `pnpm lint:fix`).

Nếu test báo `Invalid hook call` hay hai bản React: kiểm `ls -la packages/ui/node_modules/react` và `node_modules/react` phải trỏ cùng một thư mục trong `.pnpm/`. Khác nhau nghĩa là hai phiên bản React khác nhau trong lockfile — khớp lại `^19.3.0` ở cả hai chỗ.

- [ ] **Step 5: Commit**

```bash
git add packages/ui pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(ui): package nội bộ @mapslibvn/ui — cn, Button, Badge, Card (chép từ admin, chưa gỡ bản cũ)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Chuyển `states`, `RecordView`, `delayed-action`, `theme`, `tokens.css` vào `packages/ui`

**Files:**
- Create: `packages/ui/src/states.tsx`, `packages/ui/src/states.test.tsx`, `packages/ui/src/record-view.tsx`, `packages/ui/src/record-view.test.tsx`, `packages/ui/src/delayed-action.tsx`, `packages/ui/src/delayed-action.test.tsx`, `packages/ui/src/theme.ts`, `packages/ui/src/theme.test.ts`, `packages/ui/src/tokens.css`
- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: `states.tsx` — tách khỏi `AdminApiError` bằng duck-typing; viết test trước**

`packages/ui/src/states.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState, ErrorState, isApiErrorLike, LoadingSkeleton } from './states';

/** Lỗi API của một app bất kỳ: có status/code/message là đủ, không cần class của admin. */
const loiApi = (status: number, code: string, message: string) =>
  Object.assign(new Error(message), { status, code });

describe('states', () => {
  it('LoadingSkeleton dựng đúng số khối xương và báo cho trình đọc màn hình', () => {
    const { container } = render(<LoadingSkeleton rows={3} />);
    expect(container.querySelectorAll('[data-skeleton-row]')).toHaveLength(3);
    expect(screen.getByRole('status')).toHaveAccessibleName('Đang tải');
  });

  it('EmptyState nêu lý do chứ không chỉ nói "không có dữ liệu"', () => {
    render(<EmptyState title="Không có đóng góp chờ duyệt" hint="Mọi đóng góp đã được xử lý." />);
    expect(screen.getByText('Không có đóng góp chờ duyệt')).toBeVisible();
    expect(screen.getByText('Mọi đóng góp đã được xử lý.')).toBeVisible();
  });

  it('ErrorState hiện mã lỗi thật của API và nút Thử lại gọi onRetry', () => {
    const onRetry = vi.fn();
    render(<ErrorState error={loiApi(503, 'upstream_unavailable', 'DB chết')} onRetry={onRetry} />);
    expect(screen.getByText(/upstream_unavailable — DB chết/)).toBeVisible();
    screen.getByRole('button', { name: 'Thử lại' }).click();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('ErrorState với 403 nói rõ bị chặn vì quyền và không có nút Thử lại', () => {
    render(<ErrorState error={loiApi(403, 'billing_admin_forbidden', 'Không có quyền')} />);
    expect(screen.getByText(/không có quyền xem mục đó/i)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Thử lại' })).not.toBeInTheDocument();
  });

  it('ErrorState với lỗi thường (không có status/code) in chuỗi lỗi, vẫn có Thử lại', () => {
    render(<ErrorState error={new Error('mạng rớt')} onRetry={vi.fn()} />);
    expect(screen.getByText(/mạng rớt/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeVisible();
  });

  it('isApiErrorLike chỉ nhận object có status số, code chuỗi, message chuỗi', () => {
    expect(isApiErrorLike(loiApi(404, 'not_found', 'x'))).toBe(true);
    expect(isApiErrorLike(new Error('x'))).toBe(false);
    expect(isApiErrorLike({ status: '404', code: 'not_found', message: 'x' })).toBe(false);
    expect(isApiErrorLike(null)).toBe(false);
    expect(isApiErrorLike('lỗi')).toBe(false);
  });
});
```

Run: `npx vitest run packages/ui/src/states.test.tsx` → Expected: FAIL (chưa có `./states`).

`packages/ui/src/states.tsx`:

```tsx
import { Button } from './button';

/**
 * Hình dạng tối thiểu của một lỗi API để ErrorState hiện mã thật. Duck-typing thay cho
 * `instanceof AdminApiError`: package này dùng cho nhiều app, mỗi app có class lỗi riêng, và class
 * còn không sống qua ranh giới RPC — trường dữ liệu thì có.
 */
export interface ApiErrorLike {
  status: number;
  code: string;
  message: string;
}

export function isApiErrorLike(error: unknown): error is ApiErrorLike {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as Record<string, unknown>;
  return typeof e.status === 'number' && typeof e.code === 'string' && typeof e.message === 'string';
}

export function LoadingSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Đang tải" className="space-y-3">
      {Array.from({ length: rows }, (_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: khối xương không mang dữ liệu và danh sách không bao giờ bị sắp xếp lại hay chèn giữa, nên vị trí chính là danh tính duy nhất
          key={index}
          data-skeleton-row
          className="h-24 animate-pulse rounded-[var(--radius-card)] border border-[var(--border)] bg-black/5 dark:bg-white/5"
        />
      ))}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--border)] p-8 text-center">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm text-[var(--text-muted)]">{hint}</p>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const api = isApiErrorLike(error) ? error : null;
  const forbidden = api?.status === 403;
  return (
    <div className="rounded-[var(--radius-card)] border border-red-300 bg-red-50 p-5 dark:border-red-900 dark:bg-red-950">
      <p className="font-semibold text-red-800 dark:text-red-100">
        {forbidden ? 'Tài khoản này không có quyền xem mục đó' : 'Không tải được dữ liệu'}
      </p>
      <p className="mt-1 text-sm text-red-700 dark:text-red-200">
        {api ? `${api.code} — ${api.message}` : String(error)}
      </p>
      {onRetry && !forbidden && (
        <Button variant="secondary" className="mt-3" onClick={onRetry}>
          Thử lại
        </Button>
      )}
    </div>
  );
}

export function OfflineBanner() {
  return (
    <div
      role="alert"
      className="rounded-[var(--radius-btn)] bg-amber-100 px-4 py-2 text-sm text-amber-900 dark:bg-amber-900 dark:text-amber-100"
    >
      Mất kết nối mạng. Dữ liệu hiển thị có thể đã cũ.
    </div>
  );
}
```

Run: `npx vitest run packages/ui/src/states.test.tsx` → Expected: `6 passed`.

- [ ] **Step 2: `record-view.tsx` — chép nguyên, đổi tên file**

```bash
cp apps/admin/src/components/data-view.tsx      packages/ui/src/record-view.tsx
cp apps/admin/src/components/data-view.test.tsx packages/ui/src/record-view.test.tsx
sed -i '' "s#from './data-view'#from './record-view'#" packages/ui/src/record-view.test.tsx
npx vitest run packages/ui/src/record-view.test.tsx
```

Expected: `3 passed`. Nội dung file không đổi so với admin (nó vốn không import gì của admin).

- [ ] **Step 3: `delayed-action.tsx` — thêm prop `reloadGuard`; viết test trước**

Chép test cũ rồi thêm hai ca mới:

```bash
cp apps/admin/src/components/delayed-action.test.tsx packages/ui/src/delayed-action.test.tsx
```

Thêm vào cuối `describe('delayed-action', …)` trong `packages/ui/src/delayed-action.test.tsx`:

```tsx
  it('reloadGuard nhận hàm nói thật "đang có việc chờ", và nhận () => false khi gỡ', async () => {
    const guards: Array<() => boolean> = [];
    const reloadGuard = (guard: () => boolean) => {
      guards.push(guard);
    };
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const view = render(
      <DelayedActionProvider reloadGuard={reloadGuard}>
        <Harness run={vi.fn().mockResolvedValue(undefined)} />
      </DelayedActionProvider>,
    );

    // Lúc gắn: chưa có việc.
    expect(guards).toHaveLength(1);
    expect(guards[0]?.()).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Duyệt' }));
    expect(guards[0]?.()).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(guards[0]?.()).toBe(false);

    view.unmount();
    expect(guards).toHaveLength(2);
    expect(guards[1]?.()).toBe(false);
  });

  it('không truyền reloadGuard thì vẫn chạy — package không biết fetcher của app nào', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    setup(run);
    await user.click(screen.getByRole('button', { name: 'Duyệt' }));
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(run).toHaveBeenCalledOnce();
  });
```

Run: `npx vitest run packages/ui/src/delayed-action.test.tsx` → Expected: FAIL (chưa có `./delayed-action`).

`packages/ui/src/delayed-action.tsx`:

```tsx
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button } from './button';

const DELAY_MS = 5000;

interface ScheduleInput {
  label: string;
  run: () => Promise<void>;
  onCancel?: () => void;
}

interface Pending extends ScheduleInput {
  id: number;
  remaining: number;
}

interface DelayedActionValue {
  schedule: (input: ScheduleInput) => void;
}

const Context = createContext<DelayedActionValue | null>(null);

export function useDelayedAction(): DelayedActionValue {
  const value = useContext(Context);
  if (!value) throw new Error('useDelayedAction phải nằm trong DelayedActionProvider');
  return value;
}

export interface DelayedActionProviderProps {
  children: ReactNode;
  /**
   * Nhận hàm "đang có việc chờ gửi?" để phần khác của app — fetcher tự tải lại trang khi phiên hết
   * hạn — hỏi trước khi làm gì đó nuốt mất việc đang đếm ngược. Gọi lúc gắn với hàm thật, lúc gỡ
   * với `() => false`. Không truyền thì bỏ qua: package này không biết fetcher của app nào.
   * Truyền một hàm ổn định (hàm module, không phải arrow tạo mỗi lần render).
   */
  reloadGuard?: (hasPendingWork: () => boolean) => void;
}

/**
 * Hoãn gửi 5 giây thay vì hoàn tác sau khi đã gửi. Với những thao tác ghi thẳng vào dữ liệu thật
 * — duyệt đóng góp gọi apply_poi_edit rồi xoá cache — đảo ngược sạch sẽ là không làm được, nên
 * cách an toàn là chưa làm gì cho tới khi người dùng hết cơ hội đổi ý.
 */
export function DelayedActionProvider({ children, reloadGuard }: DelayedActionProviderProps) {
  const [pending, setPending] = useState<Pending | null>(null);
  const nextId = useRef(0);
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

  useEffect(() => {
    if (!reloadGuard) return;
    reloadGuard(() => pendingRef.current !== null);
    return () => reloadGuard(() => false);
  }, [reloadGuard]);

  const pendingId = pending?.id;
  useEffect(() => {
    if (pendingId === undefined) return;
    const timer = setInterval(() => {
      setPending((current) => {
        if (!current) return null;
        const remaining = current.remaining - 1000;
        if (remaining > 0) return { ...current, remaining };
        void current.run();
        return null;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [pendingId]);

  const schedule = useCallback((input: ScheduleInput) => {
    setPending((current) => {
      // Xếp việc mới khi việc cũ chưa gửi: gửi luôn việc cũ, không bỏ rơi nó.
      if (current) void current.run();
      nextId.current += 1;
      return { ...input, id: nextId.current, remaining: DELAY_MS };
    });
  }, []);

  const cancel = useCallback(() => {
    setPending((current) => {
      current?.onCancel?.();
      return null;
    });
  }, []);

  const value = useMemo(() => ({ schedule }), [schedule]);

  return (
    <Context.Provider value={value}>
      {children}
      {pending && (
        <div
          role="status"
          className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-md items-center gap-3 rounded-[var(--radius-btn)] bg-[var(--text)] px-4 py-3 text-sm text-[var(--bg)] shadow-lg"
          style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
        >
          <span className="flex-1">
            {pending.label} · gửi sau {Math.ceil(pending.remaining / 1000)} giây
          </span>
          <Button variant="ghost" className="text-[var(--bg)] underline" onClick={cancel}>
            Huỷ
          </Button>
        </div>
      )}
    </Context.Provider>
  );
}
```

Run: `npx vitest run packages/ui/src/delayed-action.test.tsx` → Expected: `5 passed`.

- [ ] **Step 4: `theme.ts` — thêm `storageKey`; viết test trước**

`packages/ui/src/theme.test.ts`:

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, readStoredTheme, resolveTheme } from './theme';

const KEY = 'test-theme';

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('chưa chọn gì → theo hệ điều hành', () => {
    expect(readStoredTheme(KEY)).toBe('system');
  });

  it('applyTheme("dark") gắn class dark và nhớ lựa chọn dưới đúng khoá', () => {
    applyTheme('dark', KEY);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(readStoredTheme(KEY)).toBe('dark');
    expect(localStorage.getItem(KEY)).toBe('dark');
  });

  it('applyTheme("light") gỡ class dark; applyTheme("system") xoá khoá', () => {
    applyTheme('dark', KEY);
    applyTheme('light', KEY);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    applyTheme('system', KEY);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('hai khoá khác nhau không kéo theme của nhau', () => {
    applyTheme('dark', 'app-a');
    expect(readStoredTheme('app-b')).toBe('system');
  });

  it('resolveTheme("system") theo prefersDark', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
  });
});
```

Run: `npx vitest run packages/ui/src/theme.test.ts` → Expected: FAIL (chưa có `./theme`).

`packages/ui/src/theme.ts`:

```ts
export type ThemeChoice = 'light' | 'dark' | 'system';

/**
 * `storageKey` do app truyền — admin và console chạy cùng origin nên chia sẻ một localStorage; dùng
 * chung khoá thì đổi theme bên này kéo bên kia theo.
 */
export function readStoredTheme(storageKey: string): ThemeChoice {
  try {
    const value = localStorage.getItem(storageKey);
    if (value === 'light' || value === 'dark') return value;
  } catch {
    // Trình duyệt chặn localStorage (chế độ riêng tư) — coi như chưa chọn.
  }
  return 'system';
}

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): 'light' | 'dark' {
  if (choice === 'system') return prefersDark ? 'dark' : 'light';
  return choice;
}

export function applyTheme(choice: ThemeChoice, storageKey: string): void {
  const prefersDark =
    typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', resolveTheme(choice, prefersDark) === 'dark');
  try {
    if (choice === 'system') localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, choice);
  } catch {
    // Không ghi nhớ được thì vẫn đổi giao diện cho phiên này.
  }
}
```

Run: `npx vitest run packages/ui/src/theme.test.ts` → Expected: `5 passed`.

- [ ] **Step 5: `tokens.css`**

`packages/ui/src/tokens.css` — chuyển nguyên khối `@theme`, `:root`, `.dark` từ `apps/admin/src/index.css`:

```css
/* Token dùng chung cho Admin, console và website: một bộ màu, một bộ bo góc.
   Import SAU `@import "tailwindcss"` trong CSS gốc của từng app, bằng đường dẫn tương đối
   (../../../packages/ui/src/tokens.css). Tailwind v4 gộp file này vào trước khi xử lý nên `@theme`
   ở đây có hiệu lực như viết tại chỗ. */

@theme {
  /* Xanh bản đồ — cùng màu style bản đồ đang dùng, xem packages/style */
  --color-brand-50: #eef3fb;
  --color-brand-100: #e8effa;
  --color-brand-500: #2f5da3;
  --color-brand-600: #24497f;
  --color-brand-700: #1b3a6b;
  --color-brand-800: #152c52;
  --color-brand-900: #0f1f3a;

  --radius-card: 12px;
  --radius-btn: 9px;
  --radius-sheet: 16px;
}

:root {
  --bg: #f7f8fa;
  --surface: #ffffff;
  --border: #e3e6ec;
  --text: #101828;
  --text-muted: #667085;
}

.dark {
  --bg: #0d1117;
  --surface: #161b22;
  --border: #2a313c;
  --text: #e6edf3;
  --text-muted: #9198a1;
}
```

- [ ] **Step 6: Barrel đầy đủ**

`packages/ui/src/index.ts`:

```ts
export { Badge, type BadgeProps } from './badge';
export { Button, type ButtonProps } from './button';
export { Card, CardMuted, type CardProps, CardTitle } from './card';
export { cn } from './cn';
export {
  DelayedActionProvider,
  type DelayedActionProviderProps,
  useDelayedAction,
} from './delayed-action';
export { type Column, RecordView, useIsWide } from './record-view';
export {
  type ApiErrorLike,
  EmptyState,
  ErrorState,
  isApiErrorLike,
  LoadingSkeleton,
  OfflineBanner,
} from './states';
export { applyTheme, readStoredTheme, resolveTheme, type ThemeChoice } from './theme';
```

- [ ] **Step 7: Toàn bộ package xanh**

Run: `npx vitest run packages/ui && pnpm --filter @mapslibvn/ui typecheck && pnpm lint`
Expected: 7 file test, 3 + 4 + 6 + 3 + 5 + 5 = 26 test xanh; typecheck và lint sạch.

- [ ] **Step 8: Commit**

```bash
git add packages/ui
git commit -m "$(cat <<'EOF'
feat(ui): states (duck-typing lỗi API), RecordView, delayed-action (reloadGuard), theme (storageKey), tokens.css

Tách hai chỗ bám vào lib/fetcher của admin để package dùng được cho console.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: `apps/admin` dùng `@mapslibvn/ui`, xoá bản cũ

**Files:**
- Modify: `apps/admin/package.json`, `apps/admin/vite.config.ts`, `apps/admin/src/index.css`, `apps/admin/src/lib/theme.ts`, `apps/admin/src/layout/app-shell.tsx`, mọi file `apps/admin/src/**` import từ bảy module cũ
- Delete: `apps/admin/src/components/ui/{badge,button,card}.tsx`, `button.test.tsx`, `card.test.tsx`, `apps/admin/src/components/{states,data-view,delayed-action}.tsx` và test, `apps/admin/src/lib/utils.ts`

- [ ] **Step 1: Dependencies**

`apps/admin/package.json`: thêm `"@mapslibvn/ui": "workspace:^"` vào `dependencies` (cạnh `@mapslibvn/web`), **xoá** `class-variance-authority`, `clsx`, `tailwind-merge` (đã xác minh 18/09: ngoài `components/ui/*` và `lib/utils.ts` không file nào trong admin import ba thư viện này). Giữ `@radix-ui/react-dialog` (command-dialog) và mọi devDependency.

```bash
pnpm install
grep -rn "class-variance-authority\|from 'clsx'\|tailwind-merge" apps/admin/src | grep -v "components/ui/\|lib/utils"
```

Expected: grep không ra gì.

- [ ] **Step 2: CSS — token và `@source`**

`apps/admin/src/index.css` — thay toàn bộ phần từ đầu file tới hết khối `.dark { … }` bằng:

```css
@import "tailwindcss";
/* Token màu và bo góc dùng chung (packages/ui). Đường dẫn tương đối chứ không phải
   "@mapslibvn/ui/tokens.css" để không phụ thuộc cách resolver @import của Tailwind đọc `exports`. */
@import "../../../packages/ui/src/tokens.css";
/* Tailwind v4 chỉ quét mã trong thư mục app và bỏ qua node_modules, mà component của @mapslibvn/ui
   tới đây qua symlink trong node_modules → lớp dùng trong đó KHÔNG được sinh CSS nếu thiếu dòng
   này. Hậu quả là nút mất kiểu mà không có lỗi nào; bước kiểm CSS build ở plan pha 0 bắt việc đó. */
@source "../../../packages/ui/src";

/* Tailwind v4 mặc định dark theo prefers-color-scheme. Trang này cho phép người dùng chọn tay,
   nên buộc biến thể `dark` bám vào class trên <html>. */
@custom-variant dark (&:where(.dark, .dark *));
```

Giữ nguyên phần `body { … }` và `@layer base { … }` phía dưới.

- [ ] **Step 3: Vite dedupe React**

`apps/admin/vite.config.ts` — trong object trả về, sửa `resolve`:

```ts
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
      // @mapslibvn/ui là source trong workspace; bảo đảm nó và admin dùng CÙNG một bản React,
      // nếu không hook trong component dùng chung sẽ ném "Invalid hook call".
      dedupe: ['react', 'react-dom'],
    },
```

- [ ] **Step 4: Đổi import bằng sed, rồi lint:fix để biome gộp import trùng nguồn**

```bash
cd apps/admin/src
grep -rl "from '@/components/ui/\|from '@/components/states'\|from '@/components/data-view'\|from '@/components/delayed-action'\|from '@/lib/utils'" . \
  | grep -v "^./components/" \
  | xargs sed -i '' \
    -e "s#from '@/components/ui/badge'#from '@mapslibvn/ui'#" \
    -e "s#from '@/components/ui/button'#from '@mapslibvn/ui'#" \
    -e "s#from '@/components/ui/card'#from '@mapslibvn/ui'#" \
    -e "s#from '@/components/states'#from '@mapslibvn/ui'#" \
    -e "s#from '@/components/data-view'#from '@mapslibvn/ui'#" \
    -e "s#from '@/components/delayed-action'#from '@mapslibvn/ui'#" \
    -e "s#from '@/lib/utils'#from '@mapslibvn/ui'#"
cd ../../..
pnpm lint:fix
grep -rc "from '@mapslibvn/ui'" apps/admin/src | grep -v ":0$" | grep -v ":1$"
```

Expected: dòng grep cuối **không ra gì** — mỗi file chỉ còn một câu import từ `@mapslibvn/ui`. Nếu còn file có 2+ câu (biome không gộp), gộp tay các `import { … } from '@mapslibvn/ui'` trong file đó thành một câu.

Kiểm riêng `apps/admin/src/features/tenants/detail.test.tsx`, `features/tenants/page.test.tsx`, `features/billing/page.test.tsx`: chúng import `DelayedActionProvider` — sau sed phải là `from '@mapslibvn/ui'`.

- [ ] **Step 5: `app-shell.tsx` nối `reloadGuard`**

`apps/admin/src/layout/app-shell.tsx` — sửa import và JSX:

```tsx
import { DelayedActionProvider } from '@mapslibvn/ui';
import { Outlet, useLocation } from 'react-router';
import { usePendingCount } from '@/features/edits/hooks';
import { setReloadGuard } from '@/lib/fetcher';
import { useMe } from '@/lib/permissions';
```

và

```tsx
    // setReloadGuard là hàm module (ổn định), đúng yêu cầu của prop.
    <DelayedActionProvider reloadGuard={setReloadGuard}>
```

- [ ] **Step 6: `lib/theme.ts` thành adapter giữ khoá cũ**

`apps/admin/src/lib/theme.ts`:

```ts
import {
  applyTheme as applyWithKey,
  readStoredTheme as readWithKey,
  type ThemeChoice,
} from '@mapslibvn/ui';

export { resolveTheme } from '@mapslibvn/ui';
export type { ThemeChoice };

/** Khoá localStorage riêng của trang Admin; console dùng khoá khác để hai trang không kéo theme của nhau. */
const KEY = 'mapslibvn-admin-theme';

export const readStoredTheme = (): ThemeChoice => readWithKey(KEY);
export const applyTheme = (choice: ThemeChoice): void => applyWithKey(choice, KEY);
```

`apps/admin/src/lib/theme.test.ts` **giữ nguyên** — nó kiểm adapter với đúng API cũ.

- [ ] **Step 7: Xoá bản cũ**

```bash
git rm apps/admin/src/components/ui/badge.tsx apps/admin/src/components/ui/button.tsx \
       apps/admin/src/components/ui/button.test.tsx apps/admin/src/components/ui/card.tsx \
       apps/admin/src/components/ui/card.test.tsx apps/admin/src/components/states.tsx \
       apps/admin/src/components/states.test.tsx apps/admin/src/components/data-view.tsx \
       apps/admin/src/components/data-view.test.tsx apps/admin/src/components/delayed-action.tsx \
       apps/admin/src/components/delayed-action.test.tsx apps/admin/src/lib/utils.ts
ls apps/admin/src/components 2>/dev/null; echo "components còn: $?"
grep -rn "@/components/\|@/lib/utils" apps/admin/src
```

Expected: thư mục `components` không còn (ls lỗi, mã 1); grep không ra gì.

- [ ] **Step 8: Test, typecheck, build, và kiểm CSS build có lớp của ui**

```bash
npx vitest run apps/admin/src packages/ui
pnpm --filter @mapslibvn/admin typecheck
pnpm --filter @mapslibvn/admin build
grep -c "min-h-11" apps/admin/dist/admin/assets/*.css
grep -c -- "--color-brand-700" apps/admin/dist/admin/assets/*.css
```

Expected: mọi test admin xanh. Số test admin phải **giảm đúng 17** so với trước Task 10 — đúng bằng năm file đã xoá khỏi admin: button 3, card 4, states 4, data-view 3, delayed-action 3 (`theme.test.ts` vẫn ở admin vì nó kiểm adapter). Cách đối chiếu: chạy `npx vitest run apps/admin/src` **trước** Step 7 và ghi con số, chạy lại sau Step 7 rồi trừ. Typecheck sạch; build xong; hai grep đều ≥ 1. **grep ra 0 nghĩa là `@source` chưa có tác dụng** — kiểm đường dẫn tương đối trong index.css.

- [ ] **Step 9: Playwright e2e của admin (cần Docker + Postgres dev đang chạy: `pnpm db:up`)**

Run: `pnpm test:admin-e2e`
Expected: mọi test e2e xanh (bộ hiện có gồm ba test gốc và các test thêm ở các pha admin). Harness tự build admin; nếu harness dùng bản build cũ (memory `harness-itest-build-admin-cu`), xoá `apps/admin/dist` rồi chạy lại.

- [ ] **Step 10: Commit**

```bash
git add apps/admin pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
refactor(admin): dùng @mapslibvn/ui thay bộ components/ui, states, data-view, delayed-action, utils

index.css import tokens.css + @source packages/ui/src; theme.ts thành adapter giữ khoá
'mapslibvn-admin-theme'; AppShell nối reloadGuard={setReloadGuard}. Không đổi hành vi.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Tài liệu — spec một dòng, DEVLOG, evidence

**Files:**
- Modify: `docs/superpowers/specs/2026-09-18-thuong-mai-tu-phuc-vu-design.md` (mục 4.1), `docs/DEVLOG.md`
- Create: `docs/evidence/commerce/2026-09-18-pha-0-packages.md`

- [ ] **Step 1: Sửa spec cho khớp thực tế release contract**

Trong mục 4.1 của spec, thay đoạn:

```
Cả hai `private: true`, không publish, không nằm trong `SDK_PACKAGE_DIRS`; thêm vào
`NON_SDK_PACKAGE_DIRS` của `scripts/lib/npm-sdk-release.mjs` để release contract test không dừng.
```

bằng:

```
Cả hai `private: true`, không publish. `scripts/lib/npm-sdk-release.mjs` chỉ đòi phân loại package
**public** (`manifest.private !== true`), nên không cần thêm vào `NON_SDK_PACKAGE_DIRS` — kiểm lại
18/09/2026 khi làm pha 0.
```

- [ ] **Step 2: DEVLOG**

Thêm cuối `docs/DEVLOG.md`:

```markdown
## 18. Thương mại tự phục vụ — pha 0: `@mapslibvn/catalog` và `@mapslibvn/ui` — 18/09/2026

Spec `docs/superpowers/specs/2026-09-18-thuong-mai-tu-phuc-vu-design.md` (PHONG duyệt 18/09).
Pha 0 **không đổi hành vi**: tách bảng giá và bộ giao diện dùng chung ra hai package nội bộ để
website (pha 1) và console (pha 2) dùng cùng một nguồn với API và Admin.

- `@mapslibvn/catalog`: `PLAN_CATALOG` có thêm `priceVnd` (650.000 / 2.600.000 / 10.400.000; mua
  thêm 26.000 / 78.000), `quoteOrder()`, `addMonths()` theo lịch giờ VN, `COMPARISON` chép số đối
  chiếu 14/09 kèm giả định và nguồn. API import từ đây; `apps/api/src/billing/catalog.ts` đã xoá.
- `@mapslibvn/ui`: chuyển `components/ui`, `states`, `data-view` (→ `RecordView`), `delayed-action`,
  `theme`, `cn` và `tokens.css` từ admin. Hai chỗ bám vào `lib/fetcher` của admin được tách:
  `ErrorState` duck-typing `ApiErrorLike`, `DelayedActionProvider` nhận prop `reloadGuard`.
  `theme` nhận `storageKey`; admin giữ khoá cũ qua adapter.
- Mới: `GET /v1/catalog` công khai (`public, max-age=3600`), cờ `SELF_SERVE = "0"` ở dev và production.
- Bẫy đã tính trước và có bước kiểm: Tailwind không quét node_modules → `@source
  "../../../packages/ui/src"` trong `apps/admin/src/index.css`, kiểm bằng grep `min-h-11` trong CSS build.
- Lệch spec: không thêm hai package vào `NON_SDK_PACKAGE_DIRS` vì contract chỉ xét package public.

Cổng đã chạy: xem `docs/evidence/commerce/2026-09-18-pha-0-packages.md`.
```

- [ ] **Step 3: Khung file chứng cứ (điền số thật ở Task 12)**

`docs/evidence/commerce/2026-09-18-pha-0-packages.md`:

```markdown
# Chứng cứ pha 0 — packages/catalog và packages/ui

Plan: `docs/superpowers/plans/2026-09-18-thuong-mai-pha-0-packages.md`
Spec: `docs/superpowers/specs/2026-09-18-thuong-mai-tu-phuc-vu-design.md` mục 4.1, 8, 16, 19.

## 1. Cổng ở máy (điền số thật)

| Lệnh | Kết quả |
|---|---|
| `pnpm lint` | |
| `turbo run typecheck --force` | … / … package, 0 cached |
| `npx vitest run packages/catalog packages/ui` | … file / … test |
| `pnpm test` (gốc, gồm build core/style/web/admin + api test) | |
| `pnpm --filter @mapslibvn/api test` | … file / … test |
| `pnpm test:admin-e2e` | |
| `grep -c "min-h-11" apps/admin/dist/admin/assets/*.css` | |
| `cd apps/api && npx wrangler deploy --dry-run --outdir /tmp/mlv-dry --env production` | bundle OK |

## 2. Không đổi hành vi

- [ ] Số test admin sau pha 0 = số trước − 17 (button 3, card 4, states 4, data-view 3, delayed-action 3), phần chênh đã chạy ở `packages/ui` (26 test).
- [ ] `/v1/admin/plan-catalog` trả thêm `priceVnd`, các trường cũ y nguyên (test admin-catalog).
- [ ] `apps/admin/dist/admin/assets/*.css` có `min-h-11` và `--color-brand-700`.

## 3. Sau deploy (PHONG push; Deploy API tự chạy)

- [ ] `curl -sI https://api.ai-solutions.io.vn/v1/catalog | grep -i cache-control` → `public, max-age=3600`
- [ ] `curl -s https://api.ai-solutions.io.vn/v1/catalog | head -c 300` thấy `"priceVnd":650000`
- [ ] Mở `https://api.ai-solutions.io.vn/admin/` trên điện thoại: nút, thẻ, huy hiệu còn đúng kiểu ở cả bản sáng và tối; toast đếm ngược 5 giây khi thu hồi một khoá thử rồi Huỷ.
- [ ] `/healthz` và `/v1/autocomplete?q=cafe` (khoá thử) vẫn 200 — bundle mới không hỏng gì cũ.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-09-18-thuong-mai-tu-phuc-vu-design.md docs/DEVLOG.md docs/evidence/commerce/2026-09-18-pha-0-packages.md
git commit -m "$(cat <<'EOF'
docs(commerce): pha 0 — DEVLOG mục 18, khung chứng cứ, sửa spec 4.1 về NON_SDK_PACKAGE_DIRS

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Bốn tầng xanh, điền chứng cứ, bàn giao push

**Files:**
- Modify: `docs/evidence/commerce/2026-09-18-pha-0-packages.md`

- [ ] **Step 1: Chạy đủ cổng, ghi số thật**

```bash
pnpm lint
npx turbo run typecheck --force
npx vitest run packages/catalog packages/ui
pnpm test
pnpm --filter @mapslibvn/api test
pnpm test:admin-e2e
grep -c "min-h-11" apps/admin/dist/admin/assets/*.css
```

Expected: tất cả xanh; `turbo … --force` in `0 cached`; điền từng con số vào mục 1 và tick mục 2 của file chứng cứ. Cổng nào đỏ thì **dừng, sửa, chạy lại**, không ghi "xanh" khi chưa thấy.

`pnpm test:api-db` không bắt buộc ở pha này (không có SQL mới), nhưng nếu Docker đang chạy thì chạy luôn cho chắc và ghi kết quả.

- [ ] **Step 2: Commit chứng cứ**

```bash
git add docs/evidence/commerce/2026-09-18-pha-0-packages.md
git commit -m "$(cat <<'EOF'
docs(commerce): pha 0 — bốn tầng xanh ở máy, số thật

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Bàn giao cho PHONG trước khi push**

Push lên `main` sẽ kích `Deploy API` (paths `apps/api/**`, `apps/admin/**`) và đưa Worker mới lên production — có `/v1/catalog` mới và bundle admin mới. Không có migration nên `check:migration` qua ngay. Báo PHONG:

- 12 commit của pha 0, không đổi hành vi, cổng xanh theo file chứng cứ.
- Sau `Deploy API` xanh, PHONG (hoặc Claude nếu được phép) làm mục 3 của file chứng cứ; đặc biệt **mở `/admin/` trên điện thoại** để chắc `@source` đã sinh CSS cho nút — đây là rủi ro duy nhất của pha này lộ ra ở production mà test không nhìn thấy hết.
- Việc kế tiếp: plan pha 1 (website `apps/site`).

---

## Self-review

**Phủ spec pha 0 (mục 19):** `@mapslibvn/catalog` với `priceVnd`, `COMPARISON`, `quoteOrder`, `addMonths` — Task 1–4; `@mapslibvn/ui` chuyển từ admin, test đi theo — Task 8–10; `SELF_SERVE` — Task 7; `/v1/catalog` — Task 6; `NON_SDK_PACKAGE_DIRS` — không cần, spec sửa ở Task 11; "admin xanh y nguyên" — Task 10 bước 8–9 và Task 12. Spec mục 8 (`/v1/admin/plan-catalog` trả thêm `priceVnd`) — Task 5. Spec mục 4.1 nói `tokens.css` "còn dùng cho site" — có, qua export `./tokens.css` và đường dẫn tương đối.

**Không placeholder:** mọi bước có mã hoặc lệnh đầy đủ; số test kỳ vọng ghi rõ từng file; các chỗ "điền số thật" là ô trong file chứng cứ, không phải bước làm.

**Nhất quán kiểu và tên:** `TIERS`/`PAID_TIERS`/`QUOTA_GROUPS`/`PERIOD_MONTHS`/`USD_REFERENCE_RATE` khai ở Task 1 và dùng đúng tên ở Task 3, 4, 5, 6. `CatalogError.code` kiểu `CatalogErrorCode` xuất ở barrel Task 3. `RecordView`/`useIsWide`/`Column` giữ tên cũ của admin nên sed ở Task 10 không đổi tên symbol nào, chỉ đổi nguồn import. `DelayedActionProviderProps.reloadGuard` khai Task 9, dùng Task 10 bước 5. `readStoredTheme(storageKey)`/`applyTheme(choice, storageKey)` khai Task 9, adapter Task 10 bước 6 gọi đúng thứ tự tham số. `selfServeOpen(env: Pick<Env,'SELF_SERVE'>)` khai và test cùng Task 7.

**Rủi ro còn lại đã có bước chặn:** Tailwind không quét ui (grep CSS build, Task 10 bước 8); hai bản React (dedupe + kiểm symlink, Task 8 bước 4 và Task 10 bước 3); vitest-pool-workers không resolve package source (Task 5 bước 5 có hướng dẫn kiểm symlink); esbuild của wrangler không bundle được `.ts` từ workspace (Task 7 bước 4 `deploy --dry-run`).
