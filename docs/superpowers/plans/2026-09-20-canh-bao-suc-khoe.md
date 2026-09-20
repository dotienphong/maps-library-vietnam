# Cảnh báo sức khoẻ qua email — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khi một trong ba thành phần (Cơ sở dữ liệu, Định tuyến, Dữ liệu) hỏng, dotienphong1993@gmail.com nhận thư nói rõ cái nào hỏng trong vòng 5 phút; khi phục hồi nhận thư nói hỏng bao lâu; nhấp nháy không sinh thư; thêm cảnh báo Tunnel Health của Cloudflare làm lớp độc lập.

**Architecture:** Tách ba phép đo của `routes/admin-health.ts` ra `health/phep-do.ts` để route và cron dùng chung. Module mới `health/canh-bao.ts` chạy trong `scheduled()` mỗi 5 phút: đo, đo lại phép hỏng sau 15 s, so với trạng thái trong KV `META` khoá `health:canh-bao`, gửi **một** thư gộp qua `chonEmailPort` khi có chuyển trạng thái, ghi KV có chọn lọc (chuyển trạng thái hoặc nhịp 30 phút). `/v1/admin/health` trả thêm `watcher` và trang Sức khoẻ hiện một dòng để thấy cron còn sống. Lớp A là một chính sách Notification `tunnel_health_event` tạo bằng API.

**Tech Stack:** Hono trên Workers, KV, Resend qua `email/port.ts`, Vitest pool Workers (KV thật của miniflare, Hyperdrive trỏ cổng đóng), React 19 + TanStack Query + jsdom, Cloudflare API v4.

Spec: `docs/superpowers/specs/2026-09-20-canh-bao-suc-khoe-design.md`.

---

## Bối cảnh bắt buộc đọc trước khi làm

- **Không đụng Postgres trong đường gửi thư cảnh báo.** `guiThuGiaoDich` đếm ngân sách và ghi audit trong DB — DB có thể chính là thứ đang chết. Dùng `chonEmailPort(env).send()` thẳng. Trần thư/ngày đếm trong KV.
- **Tầng test `apps/api` KHÔNG có Postgres**: binding Hyperdrive trỏ cổng đóng, nên phép đo `db` luôn hỏng trong test. Test của module cảnh báo **tiêm** `phepDo` giả, không đo thật.
- **`getManifest` đọc KV với `cacheTtl: 60`**: trong `admin-health.test.ts`, test "chưa publish manifest" phải đứng TRƯỚC mọi `META.put('release:current')`. Đừng đổi thứ tự các bài cũ.
- **Ghi KV tốn hạn mức** (Workers Free 1.000 ghi/ngày). Chỉ `put` khi có chuyển trạng thái hoặc `ghiLuc` cũ hơn 30 phút.
- **`exactOptionalPropertyTypes` bật**: không gán `undefined` vào prop tuỳ chọn; dùng spread có điều kiện `{...(x ? { k: x } : {})}`.
- **`fetch` trong test admin bị stub trả cùng thân cho mọi URL**; test mới so khớp theo đường dẫn.
- **`--var` bị lần deploy sau xoá**: `ALERT_EMAIL` đặt trong `wrangler.toml` khối `[env.production]`.
- Chạy `pnpm --filter @mapslibvn/api test -- <file>` để chạy một file; `pnpm test` toàn bộ trước khi merge; `pnpm typecheck` và `pnpm lint` (biome) đều là cổng CI.
- Commit theo quy ước repo: tiếng Việt, tiền tố `feat:`/`test:`/`docs:`/`refactor:`, kèm dòng `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: Tách ba phép đo ra `health/phep-do.ts`

**Files:**
- Create: `apps/api/src/health/phep-do.ts`
- Modify: `apps/api/src/routes/admin-health.ts`
- Test (đã có, phải giữ xanh): `apps/api/test/admin-health.test.ts`

- [ ] **Step 1: Chạy bài test hiện có để có mốc xanh**

Run: `pnpm --filter @mapslibvn/api test -- test/admin-health.test.ts`
Expected: 5 passed.

- [ ] **Step 2: Tạo `apps/api/src/health/phep-do.ts`**

```ts
import { type DbHealth, dbHealth } from '../db-health';
import type { Env } from '../env';
import { getManifest } from '../manifest';
import type { DirectionsParams } from '../routing/params';
import { callValhalla, valhallaBody } from '../routing/valhalla';

/** Đúng kiểu `dbHealth` nhận: `c.executionCtx` của Hono không khớp ExecutionContext toàn cục. */
export type WaitUntil = { waitUntil(promise: Promise<unknown>): void };

/**
 * Ba thành phần mà trang Sức khoẻ và cron cảnh báo cùng đo. Thứ tự là thứ tự hiện trên trang và
 * trong tiêu đề thư.
 */
export const THANH_PHAN = ['db', 'routing', 'data'] as const;
export type TenThanhPhan = (typeof THANH_PHAN)[number];
export const TEN_THANH_PHAN: Readonly<Record<TenThanhPhan, string>> = {
  db: 'Cơ sở dữ liệu',
  routing: 'Định tuyến',
  data: 'Dữ liệu',
};

/**
 * Tuyến thử cố định ở Hà Nội (Hồ Gươm → Văn Miếu), khoảng 2 km đường lớn. Cố định để so sánh được
 * giữa các lần đo, và nằm ở nơi graph VN nào cũng phải phủ.
 */
const TUYEN_THU: DirectionsParams = {
  locations: [
    { lat: 21.0287, lng: 105.8524 },
    { lat: 21.0293, lng: 105.8355 },
  ],
  mode: 'car',
  lang: 'vi',
  alternatives: false,
};

/** Ngắn hơn ROUTE_TIMEOUT_MS (10 s) của route thật: đây là màn hình có người đang ngồi đợi. */
const PROBE_TIMEOUT_MS = 6_000;

export type KetQua<T> = ({ ok: true; ms: number } & T) | { ok: false; ms: number; error: string };

export interface SoLieu {
  db: DbHealth;
  routing: { distance_km: number; phut: number };
  data: { tiles: string | null; poi: string | null; updated_at: string | null };
}

export type BaPhepDo = { [K in TenThanhPhan]: KetQua<SoLieu[K]> };

/** Mỗi phép đo tự bọc lỗi: máy chủ định tuyến ngủ KHÔNG được làm mất luôn trạng thái DB. */
async function doThu<T extends object>(fn: () => Promise<T>): Promise<KetQua<T>> {
  const t0 = Date.now();
  try {
    return { ok: true, ms: Date.now() - t0, ...(await fn()) };
  } catch (error) {
    return {
      ok: false,
      ms: Date.now() - t0,
      error: error instanceof Error ? error.message : 'Lỗi không xác định',
    };
  }
}

/**
 * Định tuyến đo bằng một `/route` THẬT, không phải `/status`: Valhalla trả 200 cho `/status` kể cả
 * khi graph rỗng — đã có tiền lệ, một lần nghiệm thu xanh giả. Tuyến không ra mét nào thì coi là hỏng.
 */
async function doDinhTuyen(env: Env): Promise<SoLieu['routing']> {
  const json = await callValhalla(env, valhallaBody(TUYEN_THU, crypto.randomUUID()), {
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  const km = json.trip?.summary?.length ?? 0;
  if (!(km > 0)) throw new Error('Tuyến thử ra 0 km — graph nhiều khả năng rỗng');
  return {
    distance_km: Math.round(km * 100) / 100,
    phut: Math.round((json.trip.summary.time ?? 0) / 60),
  };
}

const PHEP_DO: { [K in TenThanhPhan]: (env: Env, ctx: WaitUntil) => Promise<SoLieu[K]> } = {
  db: (env, ctx) => dbHealth(env, ctx),
  routing: (env) => doDinhTuyen(env),
  data: async (env) => {
    const m = await getManifest(env);
    return { tiles: m.vn, poi: m.poi, updated_at: m.updatedAt ?? null };
  },
};

/** Một phép đo theo tên — cron dùng để đo lại đúng thành phần vừa hỏng. */
export function doPhepDo<K extends TenThanhPhan>(
  ten: K,
  env: Env,
  ctx: WaitUntil,
): Promise<BaPhepDo[K]> {
  return doThu(() => PHEP_DO[ten](env, ctx)) as Promise<BaPhepDo[K]>;
}

/**
 * Cả ba phép đo, song song. Route `/v1/admin/health` và cron cảnh báo dùng CHUNG hàm này: hai nơi
 * đo "có sống không" mà trả lời khác nhau là cách để một sự cố trông như hai sự cố.
 */
export async function doBaPhepDo(env: Env, ctx: WaitUntil): Promise<BaPhepDo> {
  const [db, routing, data] = await Promise.all([
    doPhepDo('db', env, ctx),
    doPhepDo('routing', env, ctx),
    doPhepDo('data', env, ctx),
  ]);
  return { db, routing, data };
}
```

- [ ] **Step 3: Kiểm `db-health.ts` đã export kiểu `DbHealth`**

Run: `grep -n "export interface DbHealth" apps/api/src/db-health.ts`
Expected: một dòng khớp. (Đã có sẵn — không cần sửa.)

- [ ] **Step 4: Rút gọn `apps/api/src/routes/admin-health.ts` dùng hàm chung**

Thay toàn bộ file bằng:

```ts
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { doBaPhepDo } from '../health/phep-do';

export const adminHealth = new Hono<AppEnv>();

adminHealth.get('/v1/admin/health', async (c) => {
  const phepDo = await doBaPhepDo(c.env, c.executionCtx);

  // Luôn 200 khi qua được Access: đây là BÁO CÁO về sức khoẻ, không phải sức khoẻ của chính nó.
  // Trả 503 khi Valhalla chết thì màn hình mất luôn trạng thái DB và không nói được gì đã hỏng.
  return c.json({ checked_at: new Date().toISOString(), ...phepDo }, 200, {
    'cache-control': 'private, no-store',
  });
});
```

- [ ] **Step 5: Chạy lại test + typecheck**

Run: `pnpm --filter @mapslibvn/api test -- test/admin-health.test.ts && pnpm --filter @mapslibvn/api typecheck`
Expected: 5 passed; typecheck không lỗi.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/health/phep-do.ts apps/api/src/routes/admin-health.ts
git commit -m "refactor(api): tách ba phép đo sức khoẻ ra health/phep-do.ts để route và cron dùng chung

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Mẫu thư cảnh báo

**Files:**
- Create: `apps/api/src/email/mau-canh-bao.ts`
- Test: `apps/api/test/email-mau-canh-bao.test.ts`

- [ ] **Step 1: Viết test đỏ**

```ts
import { describe, expect, it } from 'vitest';
import { mauCanhBaoSucKhoe } from '../src/email/mau-canh-bao';

const LUC = '2026-09-20T03:05:12.000Z'; // 10:05 giờ Việt Nam
const ADMIN = 'https://api.test/admin/health';

describe('mauCanhBaoSucKhoe', () => {
  it('một thành phần hỏng: tiêu đề nói tên, thân nói lỗi nguyên văn, có cả html và text', () => {
    const thu = mauCanhBaoSucKhoe({
      hong: [{ ten: 'Định tuyến', loi: 'Dịch vụ chỉ đường không phản hồi' }],
      phucHoi: [],
      luc: LUC,
      adminUrl: ADMIN,
    });
    expect(thu.subject).toBe('[MapsLibVN] HỎNG: Định tuyến');
    expect(thu.text).toContain('Dịch vụ chỉ đường không phản hồi');
    expect(thu.text).toContain('10:05 20/09/2026');
    expect(thu.text).toContain(ADMIN);
    expect(thu.html).toContain('Dịch vụ chỉ đường không phản hồi');
    expect(thu.html).toContain(`href="${ADMIN}"`);
  });

  it('phục hồi một thành phần: tiêu đề có thời gian hỏng', () => {
    const thu = mauCanhBaoSucKhoe({
      hong: [],
      phucHoi: [{ ten: 'Định tuyến', hongPhut: 23 }],
      luc: LUC,
      adminUrl: ADMIN,
    });
    expect(thu.subject).toBe('[MapsLibVN] PHỤC HỒI: Định tuyến (hỏng 23 phút)');
    expect(thu.text).toContain('phục hồi sau 23 phút hỏng');
  });

  it('gộp nhiều thay đổi trong một thư, tiêu đề liệt kê hết', () => {
    const thu = mauCanhBaoSucKhoe({
      hong: [
        { ten: 'Cơ sở dữ liệu', loi: 'Không nối được DB' },
        { ten: 'Định tuyến', loi: 'Dịch vụ chỉ đường không phản hồi' },
      ],
      phucHoi: [{ ten: 'Dữ liệu', hongPhut: 5 }],
      luc: LUC,
      adminUrl: null,
    });
    expect(thu.subject).toBe('[MapsLibVN] HỎNG: Cơ sở dữ liệu, Định tuyến · PHỤC HỒI: Dữ liệu');
    expect(thu.text).not.toContain('http');
  });

  it('thông điệp lỗi có ký tự HTML thì được escape trong bản html', () => {
    const thu = mauCanhBaoSucKhoe({
      hong: [{ ten: 'Dữ liệu', loi: 'Thiếu <vn> & poi' }],
      phucHoi: [],
      luc: LUC,
      adminUrl: null,
    });
    expect(thu.html).toContain('Thiếu &lt;vn&gt; &amp; poi');
    expect(thu.text).toContain('Thiếu <vn> & poi');
  });
});
```

- [ ] **Step 2: Chạy để thấy đỏ**

Run: `pnpm --filter @mapslibvn/api test -- test/email-mau-canh-bao.test.ts`
Expected: FAIL — `Failed to resolve import "../src/email/mau-canh-bao"`.

- [ ] **Step 3: Viết `apps/api/src/email/mau-canh-bao.ts`**

```ts
import { KHUNG_HTML, type MauThu } from './mau';

/**
 * Thư cảnh báo sức khoẻ, gửi từ cron mỗi 5 phút khi một thành phần đổi trạng thái. Hàm thuần.
 *
 * Tiêu đề phải đọc một dòng là biết chuyện gì — nó hiện trên màn hình khoá điện thoại lúc 3 giờ
 * sáng. Thân thư giữ thông điệp lỗi NGUYÊN VĂN từ phép đo: đó là thứ người trực cần để biết nên
 * mở máy chủ hay mở Cloudflare.
 */

export interface DongHong {
  ten: string;
  loi: string;
}

export interface DongPhucHoi {
  ten: string;
  hongPhut: number;
}

/** Giờ Việt Nam dạng `HH:MM DD/MM/YYYY`. Cron chạy theo UTC; in UTC là bắt người đọc trừ 7. */
export const gioVn = (iso: string): string => {
  const d = new Date(new Date(iso).getTime() + 7 * 3_600_000);
  const hai = (n: number) => String(n).padStart(2, '0');
  return `${hai(d.getUTCHours())}:${hai(d.getUTCMinutes())} ${hai(d.getUTCDate())}/${hai(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
};

const escapeHtml = (s: string): string =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

export function mauCanhBaoSucKhoe(d: {
  hong: DongHong[];
  phucHoi: DongPhucHoi[];
  luc: string;
  adminUrl: string | null;
}): MauThu {
  const phan: string[] = [];
  if (d.hong.length > 0) phan.push(`HỎNG: ${d.hong.map((h) => h.ten).join(', ')}`);
  if (d.phucHoi.length > 0) {
    const ten = d.phucHoi.map((p) => p.ten).join(', ');
    const chiMotPhucHoi = d.hong.length === 0 && d.phucHoi.length === 1;
    phan.push(
      chiMotPhucHoi ? `PHỤC HỒI: ${ten} (hỏng ${d.phucHoi[0]?.hongPhut} phút)` : `PHỤC HỒI: ${ten}`,
    );
  }
  const subject = `[MapsLibVN] ${phan.join(' · ')}`;
  const luc = gioVn(d.luc);

  const dongText = [
    ...d.hong.map((h) => `- ${h.ten}: HỎNG — ${h.loi}`),
    ...d.phucHoi.map((p) => `- ${p.ten}: phục hồi sau ${p.hongPhut} phút hỏng`),
  ];
  const text = [
    `Trạng thái hệ thống MapsLibVN đổi lúc ${luc} (giờ Việt Nam):`,
    '',
    ...dongText,
    '',
    ...(d.adminUrl ? [`Xem chi tiết: ${d.adminUrl}`, ''] : []),
    'Thư tự động từ cron 5 phút của MapsLibVN. Thư kế tiếp chỉ đến khi trạng thái đổi lần nữa.',
  ].join('\n');

  const dongHtml = [
    ...d.hong.map(
      (h) =>
        `<li style="margin:0 0 6px"><strong>${escapeHtml(h.ten)}</strong>: <span style="color:#b42318">HỎNG</span> — ${escapeHtml(h.loi)}</li>`,
    ),
    ...d.phucHoi.map(
      (p) =>
        `<li style="margin:0 0 6px"><strong>${escapeHtml(p.ten)}</strong>: <span style="color:#027a48">phục hồi</span> sau ${p.hongPhut} phút hỏng</li>`,
    ),
  ].join('');
  const html = KHUNG_HTML(
    `<p style="margin:0 0 12px">Trạng thái hệ thống đổi lúc <strong>${luc}</strong> (giờ Việt Nam):</p>
<ul style="margin:0 0 16px;padding-left:20px">${dongHtml}</ul>
${d.adminUrl ? `<p style="margin:0 0 16px"><a href="${escapeHtml(d.adminUrl)}" style="color:#1b3a6b">Mở trang Sức khoẻ</a></p>` : ''}
<p style="margin:0;color:#667085;font-size:13px">Thư tự động từ cron 5 phút của MapsLibVN. Thư kế tiếp chỉ đến khi trạng thái đổi lần nữa.</p>`,
  );

  return { subject, html, text };
}
```

- [ ] **Step 4: Chạy để thấy xanh**

Run: `pnpm --filter @mapslibvn/api test -- test/email-mau-canh-bao.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/email/mau-canh-bao.ts apps/api/test/email-mau-canh-bao.test.ts
git commit -m "feat(api): mẫu thư cảnh báo sức khoẻ — tiêu đề nói tên thành phần, thân giữ lỗi nguyên văn

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Module `health/canh-bao.ts` — đo, so, gửi, lưu

**Files:**
- Create: `apps/api/src/health/canh-bao.ts`
- Modify: `apps/api/src/env.ts` (thêm `ALERT_EMAIL`)
- Test: `apps/api/test/health-canh-bao.test.ts`

- [ ] **Step 1: Thêm biến môi trường vào `apps/api/src/env.ts`**

Chèn ngay sau khai báo `SUPPORT_EMAIL?: string;`:

```ts
  /**
   * Địa chỉ nhận thư cảnh báo sức khoẻ từ cron (spec 2026-09-20-canh-bao-suc-khoe). Vắng → cron
   * KHÔNG đo, báo cáo `thieu-cau-hinh`; dev không đặt để không gọi Valhalla mỗi 5 phút ở máy.
   * Không dùng lại SUPPORT_EMAIL dù hôm nay cùng địa chỉ: một cái là nơi khách trả lời, một cái là
   * nơi máy gọi người trực.
   */
  ALERT_EMAIL?: string;
```

- [ ] **Step 2: Viết test đỏ `apps/api/test/health-canh-bao.test.ts`**

```ts
import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import type { EmailPort, ThuGui } from '../src/email/port';
import type { Env } from '../src/env';
import {
  CHO_DO_LAI_MS,
  KHOA_KV,
  NHIP_GHI_MS,
  TRAN_THU_NGAY,
  type TrangThaiCanhBao,
  theoDoiSucKhoe,
} from '../src/health/canh-bao';
import type { KetQua, TenThanhPhan } from '../src/health/phep-do';

const NOW = new Date('2026-09-20T03:05:00Z');
const ISO = NOW.toISOString();
const ctx = { waitUntil: (p: Promise<unknown>) => void p.catch(() => {}) };

const OK: KetQua<object> = { ok: true, ms: 10 };
const HONG = (error: string): KetQua<object> => ({ ok: false, ms: 6001, error });

/**
 * Phép đo giả theo kịch bản: `kichBan[ten]` là danh sách kết quả trả lần lượt cho mỗi lần gọi
 * thành phần đó; hết danh sách thì trả phần tử cuối. Nhờ vậy kiểm được "lần 1 hỏng, đo lại tốt".
 */
function phepDoGia(kichBan: Partial<Record<TenThanhPhan, KetQua<object>[]>>) {
  const soLan: Record<string, number> = {};
  const fn = vi.fn((ten: TenThanhPhan) => {
    const ds = kichBan[ten] ?? [OK];
    const i = Math.min(soLan[ten] ?? 0, ds.length - 1);
    soLan[ten] = (soLan[ten] ?? 0) + 1;
    return Promise.resolve(ds[i] as KetQua<object>);
  });
  return fn as unknown as typeof fn & ((ten: TenThanhPhan) => Promise<KetQua<object>>);
}

function emailGia(loi?: Error) {
  const daGui: ThuGui[] = [];
  const port: EmailPort = {
    ten: 'debug',
    send(thu) {
      if (loi) return Promise.reject(loi);
      daGui.push(thu);
      return Promise.resolve({ id: `t${daGui.length}` });
    },
  };
  return { port, daGui };
}

/** Bọc KV thật để đếm số lần `put`. */
function kvDem() {
  let soPut = 0;
  const kv = {
    get: (k: string, o?: unknown) => env.META.get(k, o as never),
    put: (k: string, v: string) => {
      soPut += 1;
      return env.META.put(k, v);
    },
  } as unknown as KVNamespace;
  return { kv, soPut: () => soPut };
}

const moiTruong = (kv: KVNamespace, them: Partial<Env> = {}): Env =>
  ({
    ...env,
    META: kv,
    ALERT_EMAIL: 'phong@vidu.vn',
    CONSOLE_ORIGIN: 'https://api.test',
    ...them,
  }) as Env;

const docKv = () => env.META.get<TrangThaiCanhBao>(KHOA_KV, 'json');

const ghiKv = (tt: Partial<TrangThaiCanhBao>) =>
  env.META.put(
    KHOA_KV,
    JSON.stringify({
      v: 1,
      kiemLuc: '2026-09-20T03:00:00.000Z',
      ghiLuc: '2026-09-20T03:00:00.000Z',
      thanhPhan: {
        db: { ok: true, tuLuc: '2026-09-19T20:00:00.000Z' },
        routing: { ok: true, tuLuc: '2026-09-19T20:00:00.000Z' },
        data: { ok: true, tuLuc: '2026-09-19T20:00:00.000Z' },
      },
      guiTrongNgay: { ngay: '2026-09-20', so: 0 },
      ...tt,
    } satisfies TrangThaiCanhBao),
  );

function chay(
  kv: KVNamespace,
  tuyChon: {
    kichBan?: Partial<Record<TenThanhPhan, KetQua<object>[]>>;
    email?: ReturnType<typeof emailGia>;
    now?: Date;
    envThem?: Partial<Env>;
  } = {},
) {
  const cho = vi.fn(() => Promise.resolve());
  const phepDo = phepDoGia(tuyChon.kichBan ?? {});
  const email = tuyChon.email ?? emailGia();
  const baoCao = theoDoiSucKhoe(moiTruong(kv, tuyChon.envThem), ctx, {
    phepDo,
    emailPort: () => email.port,
    cho,
    now: () => tuyChon.now ?? NOW,
  });
  return { baoCao, cho, phepDo, email };
}

describe('theoDoiSucKhoe', () => {
  it('thiếu ALERT_EMAIL → không đo, báo cáo thieu-cau-hinh', async () => {
    const { kv } = kvDem();
    const { baoCao, phepDo } = chay(kv, { envThem: { ALERT_EMAIL: undefined } as Partial<Env> });
    expect((await baoCao).trangThai).toBe('thieu-cau-hinh');
    expect(phepDo).not.toHaveBeenCalled();
  });

  it('lần đầu: ghi trạng thái, không gửi thư', async () => {
    const { kv, soPut } = kvDem();
    const { baoCao, email } = chay(kv);
    const bc = await baoCao;
    expect(bc.trangThai).toBe('lan-dau');
    expect(email.daGui).toHaveLength(0);
    expect(soPut()).toBe(1);
    const tt = await docKv();
    expect(tt?.thanhPhan.routing).toEqual({ ok: true, tuLuc: ISO });
    expect(tt?.kiemLuc).toBe(ISO);
  });

  it('ok → hỏng: một thư có tên thành phần và lỗi; trạng thái ok=false', async () => {
    await ghiKv({});
    const { kv } = kvDem();
    const { baoCao, email } = chay(kv, {
      kichBan: { routing: [HONG('Dịch vụ chỉ đường không phản hồi')] },
    });
    const bc = await baoCao;
    expect(bc.trangThai).toBe('da-gui');
    expect(bc.hong).toEqual(['routing']);
    expect(email.daGui).toHaveLength(1);
    expect(email.daGui[0]?.to).toBe('phong@vidu.vn');
    expect(email.daGui[0]?.subject).toBe('[MapsLibVN] HỎNG: Định tuyến');
    expect(email.daGui[0]?.text).toContain('Dịch vụ chỉ đường không phản hồi');
    expect(email.daGui[0]?.text).toContain('https://api.test/admin/health');
    const tt = await docKv();
    expect(tt?.thanhPhan.routing).toEqual({
      ok: false,
      tuLuc: ISO,
      loi: 'Dịch vụ chỉ đường không phản hồi',
    });
    expect(tt?.guiTrongNgay).toEqual({ ngay: '2026-09-20', so: 1 });
  });

  it('hỏng → hỏng: không gửi, giữ tuLuc cũ', async () => {
    await ghiKv({
      thanhPhan: {
        db: { ok: true, tuLuc: '2026-09-19T20:00:00.000Z' },
        routing: { ok: false, tuLuc: '2026-09-20T02:00:00.000Z', loi: 'x' },
        data: { ok: true, tuLuc: '2026-09-19T20:00:00.000Z' },
      },
    });
    const { kv } = kvDem();
    const { baoCao, email } = chay(kv, { kichBan: { routing: [HONG('x')] } });
    expect((await baoCao).trangThai).toBe('khong-doi');
    expect(email.daGui).toHaveLength(0);
    expect((await docKv())?.thanhPhan.routing.tuLuc).toBe('2026-09-20T02:00:00.000Z');
  });

  it('hỏng → ok: thư phục hồi nói hỏng bao nhiêu phút', async () => {
    await ghiKv({
      thanhPhan: {
        db: { ok: true, tuLuc: '2026-09-19T20:00:00.000Z' },
        routing: { ok: false, tuLuc: '2026-09-20T02:42:00.000Z', loi: 'x' },
        data: { ok: true, tuLuc: '2026-09-19T20:00:00.000Z' },
      },
    });
    const { kv } = kvDem();
    const { baoCao, email } = chay(kv);
    const bc = await baoCao;
    expect(bc.phucHoi).toEqual(['routing']);
    expect(email.daGui[0]?.subject).toBe('[MapsLibVN] PHỤC HỒI: Định tuyến (hỏng 23 phút)');
    expect((await docKv())?.thanhPhan.routing).toEqual({ ok: true, tuLuc: ISO });
  });

  it('hai thành phần chết cùng lượt → đúng một thư, cả hai tên trong tiêu đề', async () => {
    await ghiKv({});
    const { kv } = kvDem();
    const { baoCao, email } = chay(kv, {
      kichBan: { db: [HONG('Không nối được DB')], routing: [HONG('Dịch vụ chỉ đường không phản hồi')] },
    });
    expect((await baoCao).hong).toEqual(['db', 'routing']);
    expect(email.daGui).toHaveLength(1);
    expect(email.daGui[0]?.subject).toBe('[MapsLibVN] HỎNG: Cơ sở dữ liệu, Định tuyến');
  });

  it('nhấp nháy: lần 1 hỏng, đo lại tốt → không gửi, không đổi trạng thái, chờ đúng một lần', async () => {
    await ghiKv({});
    const { kv, soPut } = kvDem();
    const { baoCao, email, cho, phepDo } = chay(kv, { kichBan: { routing: [HONG('quá hạn'), OK] } });
    expect((await baoCao).trangThai).toBe('khong-doi');
    expect(email.daGui).toHaveLength(0);
    expect(cho).toHaveBeenCalledTimes(1);
    expect(cho).toHaveBeenCalledWith(CHO_DO_LAI_MS);
    // 3 phép đo lần một + đúng 1 phép đo lại (routing), không đo lại db/data đang tốt.
    expect(phepDo).toHaveBeenCalledTimes(4);
    expect((await docKv())?.thanhPhan.routing.ok).toBe(true);
    // Không chuyển trạng thái và ghiLuc mới 5 phút → không tốn một lượt ghi KV.
    expect(soPut()).toBe(0);
  });

  it('không đo lại khi cả ba đều tốt', async () => {
    await ghiKv({});
    const { kv } = kvDem();
    const { baoCao, cho, phepDo } = chay(kv);
    await baoCao;
    expect(cho).not.toHaveBeenCalled();
    expect(phepDo).toHaveBeenCalledTimes(3);
  });

  it('gửi thư lỗi: thành phần vừa chuyển giữ trạng thái CŨ để lượt sau thử lại', async () => {
    await ghiKv({});
    const { kv } = kvDem();
    const email = emailGia(new Error('email_send_failed_500'));
    const { baoCao } = chay(kv, { kichBan: { routing: [HONG('x')] }, email });
    const bc = await baoCao;
    expect(bc.trangThai).toBe('gui-loi');
    expect(bc.ok).toBe(false);
    expect(bc.loi).toContain('email_send_failed_500');
    const tt = await docKv();
    expect(tt?.thanhPhan.routing.ok).toBe(true);
    expect(tt?.guiTrongNgay.so).toBe(0);
    // Nhịp vẫn cập nhật: cron có chạy, chỉ thư là không đi.
    expect(tt?.kiemLuc).toBe(ISO);
  });

  it('trần thư/ngày: vượt trần thì lưu trạng thái mới nhưng không gửi; sang ngày UTC mới đếm lại', async () => {
    await ghiKv({ guiTrongNgay: { ngay: '2026-09-20', so: TRAN_THU_NGAY } });
    const { kv } = kvDem();
    const a = chay(kv, { kichBan: { routing: [HONG('x')] } });
    expect((await a.baoCao).trangThai).toBe('qua-tran');
    expect(a.email.daGui).toHaveLength(0);
    expect((await docKv())?.thanhPhan.routing.ok).toBe(false);

    // Ngày hôm sau: routing phục hồi → đếm lại từ 0 và gửi được.
    const b = chay(kv, { now: new Date('2026-09-21T00:10:00Z') });
    expect((await b.baoCao).trangThai).toBe('da-gui');
    expect((await docKv())?.guiTrongNgay).toEqual({ ngay: '2026-09-21', so: 1 });
  });

  it('nhịp tim: không đổi trạng thái nhưng ghiLuc cũ hơn 30 phút → có ghi KV', async () => {
    await ghiKv({ ghiLuc: new Date(NOW.getTime() - NHIP_GHI_MS - 1).toISOString() });
    const { kv, soPut } = kvDem();
    await chay(kv).baoCao;
    expect(soPut()).toBe(1);
    expect((await docKv())?.ghiLuc).toBe(ISO);
  });

  it('KV có rác (không phải trạng thái hợp lệ) → coi như lần đầu, không ném', async () => {
    await env.META.put(KHOA_KV, '{"v":99}');
    const { kv } = kvDem();
    const { baoCao, email } = chay(kv, { kichBan: { db: [HONG('x')] } });
    expect((await baoCao).trangThai).toBe('lan-dau');
    expect(email.daGui).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Chạy để thấy đỏ**

Run: `pnpm --filter @mapslibvn/api test -- test/health-canh-bao.test.ts`
Expected: FAIL — `Failed to resolve import "../src/health/canh-bao"`.

- [ ] **Step 4: Viết `apps/api/src/health/canh-bao.ts`**

```ts
import { mauCanhBaoSucKhoe } from '../email/mau-canh-bao';
import { chonEmailPort, type EmailPort } from '../email/port';
import type { Env } from '../env';
import { moTaLoi } from '../errors';
import {
  doPhepDo,
  type KetQua,
  TEN_THANH_PHAN,
  type TenThanhPhan,
  THANH_PHAN,
  type WaitUntil,
} from './phep-do';

/**
 * Cron 5 phút đo ba thành phần và gửi thư khi trạng thái ĐỔI (spec 2026-09-20-canh-bao-suc-khoe
 * mục 5). Không phải "gửi khi hỏng": một sự cố kéo dài cả đêm là một thư hỏng và một thư phục hồi,
 * không phải 96 thư.
 *
 * Đường gửi thư KHÔNG chạm Postgres — Postgres có thể chính là thứ đang chết. Vì vậy trần thư/ngày
 * đếm trong KV, và gửi bằng `chonEmailPort` thẳng chứ không qua `guiThuGiaoDich`.
 */

export const KHOA_KV = 'health:canh-bao';
/** Resend miễn phí 100 thư/ngày cho cả tài khoản; 10 là đủ cho một hệ nhấp nháy tệ. */
export const TRAN_THU_NGAY = 10;
/** Nhịp ghi KV khi không có gì đổi — Workers Free chỉ cho 1.000 ghi/ngày, cron chạy 288 lượt. */
export const NHIP_GHI_MS = 30 * 60_000;
/** Phép đo hỏng được đo lại sau khoảng này; hỏng cả hai lần mới tính. */
export const CHO_DO_LAI_MS = 15_000;

export interface TrangThaiThanhPhan {
  ok: boolean;
  /** Thời điểm chuyển sang trạng thái hiện tại — để thư phục hồi nói "hỏng N phút". */
  tuLuc: string;
  loi?: string;
}

export interface TrangThaiCanhBao {
  v: 1;
  /** Lần cron đo gần nhất (có thể mới hơn `ghiLuc` tới 30 phút vì ghi có chọn lọc). */
  kiemLuc: string;
  ghiLuc: string;
  thanhPhan: Record<TenThanhPhan, TrangThaiThanhPhan>;
  /** Đếm theo ngày UTC, cùng cách Resend tính. */
  guiTrongNgay: { ngay: string; so: number };
}

export interface CanhBaoDeps {
  phepDo?: (ten: TenThanhPhan, env: Env, ctx: WaitUntil) => Promise<KetQua<object>>;
  emailPort?: (env: Env) => EmailPort;
  cho?: (ms: number) => Promise<void>;
  now?: () => Date;
}

export type TrangThaiLuot =
  | 'thieu-cau-hinh'
  | 'lan-dau'
  | 'khong-doi'
  | 'da-gui'
  | 'gui-loi'
  | 'qua-tran'
  | 'loi';

export interface BaoCaoCanhBao {
  ten: 'canhBaoSucKhoe';
  ok: boolean;
  trangThai: TrangThaiLuot;
  hong: TenThanhPhan[];
  phucHoi: TenThanhPhan[];
  daGhiKv: boolean;
  loi?: string;
}

const ngayUtc = (d: Date): string => d.toISOString().slice(0, 10);

const laTrangThai = (x: unknown): x is TrangThaiCanhBao => {
  if (!x || typeof x !== 'object') return false;
  const t = x as Partial<TrangThaiCanhBao>;
  return (
    t.v === 1 &&
    typeof t.kiemLuc === 'string' &&
    typeof t.ghiLuc === 'string' &&
    !!t.thanhPhan &&
    THANH_PHAN.every((k) => typeof t.thanhPhan?.[k]?.ok === 'boolean') &&
    typeof t.guiTrongNgay?.so === 'number'
  );
};

/** Đọc KHÔNG `cacheTtl`: trạng thái này đổi mỗi 5 phút và đọc cũ là cảnh báo đúp hoặc lỡ. */
export async function docTrangThai(kv: KVNamespace): Promise<TrangThaiCanhBao | null> {
  const raw = await kv.get(KHOA_KV, 'json');
  return laTrangThai(raw) ? raw : null;
}

/** Phần trang Sức khoẻ cần biết về cron: còn chạy không, và hôm nay đã gửi mấy thư. */
export function tomTatWatcher(
  tt: TrangThaiCanhBao | null,
  now: Date = new Date(),
): { kiem_luc: string; gui_trong_ngay: number } | null {
  if (!tt) return null;
  return {
    kiem_luc: tt.kiemLuc,
    gui_trong_ngay: tt.guiTrongNgay.ngay === ngayUtc(now) ? tt.guiTrongNgay.so : 0,
  };
}

const baoCao = (
  trangThai: TrangThaiLuot,
  them: Partial<BaoCaoCanhBao> = {},
): BaoCaoCanhBao => ({
  ten: 'canhBaoSucKhoe',
  ok: trangThai !== 'gui-loi' && trangThai !== 'loi',
  trangThai,
  hong: [],
  phucHoi: [],
  daGhiKv: false,
  ...them,
});

export async function theoDoiSucKhoe(
  env: Env,
  ctx: WaitUntil,
  deps: CanhBaoDeps = {},
): Promise<BaoCaoCanhBao> {
  const den = env.ALERT_EMAIL?.trim();
  if (!den) return baoCao('thieu-cau-hinh');

  const now = deps.now ?? (() => new Date());
  const phepDo = deps.phepDo ?? doPhepDo;
  const cho = deps.cho ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  try {
    const doNhieu = async (ds: readonly TenThanhPhan[]) => {
      const kq = await Promise.all(ds.map((t) => phepDo(t, env, ctx)));
      return Object.fromEntries(ds.map((t, i) => [t, kq[i]])) as Record<
        TenThanhPhan,
        KetQua<object>
      >;
    };

    // Đo lần một; phép nào hỏng thì chờ rồi đo lại ĐÚNG phép đó. Một `/route` quá hạn vì máy chủ
    // đang bận build graph không phải sự cố, và một thư lúc 3 giờ sáng vì việc đó là cách nhanh
    // nhất để người trực tắt cảnh báo.
    let ketQua = await doNhieu(THANH_PHAN);
    const hongLan1 = THANH_PHAN.filter((t) => !ketQua[t].ok);
    if (hongLan1.length > 0) {
      await cho(CHO_DO_LAI_MS);
      ketQua = { ...ketQua, ...(await doNhieu(hongLan1)) };
    }

    const luc = now();
    const iso = luc.toISOString();
    const cu = await docTrangThai(env.META);

    const thanhPhan = {} as Record<TenThanhPhan, TrangThaiThanhPhan>;
    const hong: TenThanhPhan[] = [];
    const phucHoi: TenThanhPhan[] = [];
    for (const t of THANH_PHAN) {
      const kq = ketQua[t];
      const truoc = cu?.thanhPhan[t];
      if (truoc && truoc.ok === kq.ok) {
        thanhPhan[t] = truoc;
        continue;
      }
      thanhPhan[t] = { ok: kq.ok, tuLuc: iso, ...(kq.ok ? {} : { loi: kq.error }) };
      if (truoc) (kq.ok ? phucHoi : hong).push(t);
    }

    const ngay = ngayUtc(luc);
    const guiTrongNgay =
      cu?.guiTrongNgay.ngay === ngay ? { ...cu.guiTrongNgay } : { ngay, so: 0 };
    const coThayDoi = hong.length + phucHoi.length > 0;
    let trangThai: TrangThaiLuot = cu ? (coThayDoi ? 'da-gui' : 'khong-doi') : 'lan-dau';
    let loi: string | undefined;

    if (cu && coThayDoi) {
      if (guiTrongNgay.so >= TRAN_THU_NGAY) {
        trangThai = 'qua-tran';
        console.warn(
          `[health] không gửi cảnh báo (${hong.join(',')}|${phucHoi.join(',')}): đã ${guiTrongNgay.so} thư hôm nay`,
        );
      } else {
        const origin = (env.CONSOLE_ORIGIN ?? '').replace(/\/+$/, '');
        const thu = mauCanhBaoSucKhoe({
          hong: hong.map((t) => ({
            ten: TEN_THANH_PHAN[t],
            loi: thanhPhan[t].loi ?? 'Lỗi không xác định',
          })),
          phucHoi: phucHoi.map((t) => ({
            ten: TEN_THANH_PHAN[t],
            hongPhut: Math.max(
              1,
              Math.round((luc.getTime() - Date.parse(cu.thanhPhan[t].tuLuc)) / 60_000),
            ),
          })),
          luc: iso,
          adminUrl: origin ? `${origin}/admin/health` : null,
        });
        const port = (deps.emailPort ?? chonEmailPort)(env);
        try {
          await port.send({ to: den, subject: thu.subject, html: thu.html, text: thu.text });
          guiTrongNgay.so += 1;
        } catch (error) {
          // Giữ trạng thái CŨ cho thành phần vừa chuyển: lượt sau thấy lại cùng chuyển trạng thái
          // và thử gửi lại. In cả message — Observability chỉ giữ stack.
          trangThai = 'gui-loi';
          loi = moTaLoi(error);
          console.error(`[health] gửi cảnh báo lỗi: ${loi}`, error);
          for (const t of [...hong, ...phucHoi]) thanhPhan[t] = cu.thanhPhan[t];
        }
      }
    }

    const canGhi =
      !cu || coThayDoi || luc.getTime() - Date.parse(cu.ghiLuc) >= NHIP_GHI_MS;
    if (canGhi) {
      const moi: TrangThaiCanhBao = { v: 1, kiemLuc: iso, ghiLuc: iso, thanhPhan, guiTrongNgay };
      await env.META.put(KHOA_KV, JSON.stringify(moi));
    }

    return baoCao(trangThai, { hong, phucHoi, daGhiKv: canGhi, ...(loi ? { loi } : {}) });
  } catch (error) {
    const moTa = moTaLoi(error);
    console.error(`[health] cron cảnh báo lỗi: ${moTa}`, error);
    return baoCao('loi', { loi: moTa });
  }
}
```

- [ ] **Step 5: Chạy để thấy xanh**

Run: `pnpm --filter @mapslibvn/api test -- test/health-canh-bao.test.ts`
Expected: 12 passed.

- [ ] **Step 6: Typecheck + lint**

Run: `pnpm --filter @mapslibvn/api typecheck && pnpm lint`
Expected: không lỗi. Nếu biome phàn nàn về `as never` hay format, chạy `pnpm lint:fix` rồi xem lại diff.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/health/canh-bao.ts apps/api/src/env.ts apps/api/test/health-canh-bao.test.ts
git commit -m "feat(api): cron cảnh báo sức khoẻ — đo lại sau 15 s, gửi một thư gộp khi đổi trạng thái, KV ghi chọn lọc

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Nối vào `scheduled()` và cấu hình production

**Files:**
- Modify: `apps/api/src/index.ts` (import + `scheduled`)
- Modify: `apps/api/wrangler.toml` (`[env.production]` vars, chú thích `[triggers]`)
- Modify: `apps/api/test/scheduled.test.ts`

- [ ] **Step 1: Sửa test `apps/api/test/scheduled.test.ts` — thêm hai bài, đổi kỳ vọng số việc nền**

Thay bài đầu bằng:

```ts
  it('cron 5 phút: hai việc nền (đơn hàng + sức khoẻ), DB không nối được vẫn KHÔNG ném', async () => {
    const viecNen: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>) => viecNen.push(p),
      passThroughOnException: () => {},
    };
    expect(() =>
      worker.scheduled(
        { cron: '*/5 * * * *', scheduledTime: Date.now(), noRetry: () => {} } as never,
        { ...env, PAYOS_CLIENT_ID: 'x', PAYOS_API_KEY: 'x', PAYOS_CHECKSUM_KEY: 'x' } as never,
        ctx as never,
      ),
    ).not.toThrow();
    // Việc sức khoẻ được xếp nhưng kết thúc `thieu-cau-hinh`: tầng test không có ALERT_EMAIL, nên
    // không có lượt đo nào chạy (và không phải chờ 15 s đo lại).
    expect(viecNen).toHaveLength(2);
    await expect(Promise.all(viecNen)).resolves.toBeDefined();
  });

  it('cron hằng ngày: chỉ việc đơn hàng, không đo sức khoẻ', () => {
    const viecNen: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>) => void viecNen.push(p.catch(() => {})),
      passThroughOnException: () => {},
    };
    worker.scheduled(
      { cron: '0 2 * * *', scheduledTime: Date.now(), noRetry: () => {} } as never,
      { ...env, PAYOS_CLIENT_ID: 'x', PAYOS_API_KEY: 'x', PAYOS_CHECKSUM_KEY: 'x' } as never,
      ctx as never,
    );
    expect(viecNen).toHaveLength(1);
  });
```

Giữ nguyên bài `'vẫn phục vụ HTTP như trước khi có scheduled'`.

- [ ] **Step 2: Chạy để thấy đỏ**

Run: `pnpm --filter @mapslibvn/api test -- test/scheduled.test.ts`
Expected: FAIL — `expected [ …1 item… ] to have a length of 2`.

- [ ] **Step 3: Sửa `apps/api/src/index.ts`**

Đổi dòng import cron:

```ts
import { CRON_MOI_5_PHUT, chayCron } from './commerce/cron';
```

Thêm import (theo thứ tự chữ cái, sau `./errors`):

```ts
import { theoDoiSucKhoe } from './health/canh-bao';
```

Thay `scheduled` ở cuối file bằng:

```ts
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      chayCron(env, ctx, controller.cron).then((baoCao) => {
        console.log(`[cron] ${controller.cron}: ${JSON.stringify(baoCao)}`);
      }),
    );
    // Cảnh báo sức khoẻ đi RIÊNG một waitUntil, không nằm trong chayCron: đó là mã nghiệp vụ đơn
    // hàng, còn đây là vận hành. Chỉ theo nhịp 5 phút — lịch 09:00 là thư nhắc hạn.
    if (controller.cron === CRON_MOI_5_PHUT) {
      ctx.waitUntil(
        theoDoiSucKhoe(env, ctx).then((baoCao) => {
          console.log(`[health] ${JSON.stringify(baoCao)}`);
        }),
      );
    }
  },
```

- [ ] **Step 4: Chạy để thấy xanh**

Run: `pnpm --filter @mapslibvn/api test -- test/scheduled.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Cấu hình `apps/api/wrangler.toml`**

Trong khối `[env.production]`, thêm vào object `vars` (ngay sau `SUPPORT_EMAIL = "dotienphong1993@gmail.com",`):

```toml
ALERT_EMAIL = "dotienphong1993@gmail.com",
```

Sửa chú thích trên `[triggers]` thành:

```toml
# Cron (spec 9.4 thương mại + spec 2026-09-20 cảnh báo sức khoẻ): mỗi 5 phút cấp lại đơn treo, đối
# soát PayOS phòng webhook rơi, đóng đơn quá hạn, dọn phiên, VÀ đo ba phép đo sức khoẻ rồi gửi thư
# tới ALERT_EMAIL khi trạng thái đổi (chỉ production có ALERT_EMAIL; dev không đo). 02:00 UTC
# (09:00 giờ VN) gửi thư nhắc hạn. `triggers` là khoá KẾ THỪA nên áp cho cả [env.production].
# Ở máy, `wrangler dev --test-scheduled` mở đường `/__scheduled?cron=…` để gọi tay.
```

Trong `[vars]` (dev), thêm sau `SUPPORT_EMAIL`:

```toml
# Người nhận thư cảnh báo sức khoẻ từ cron. CHỈ đặt trong [env.production]: có giá trị là cron đo
# Valhalla + DB mỗi 5 phút, và ở máy dev điều đó chỉ tốn công. Không đặt = không đo.
# ALERT_EMAIL = ""
```

- [ ] **Step 6: Kiểm wrangler đọc được cấu hình**

Run: `cd apps/api && pnpm exec wrangler deploy --env production --dry-run --outdir /tmp/wr-dry 2>&1 | tail -5; cd ../..`
Expected: có dòng `--dry-run: exiting now.` và không có lỗi parse TOML. (Lệnh không deploy gì.)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/index.ts apps/api/wrangler.toml apps/api/test/scheduled.test.ts
git commit -m "feat(api): scheduled() chạy cảnh báo sức khoẻ mỗi 5 phút; ALERT_EMAIL trên production

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `/v1/admin/health` trả `watcher`

**Files:**
- Modify: `apps/api/src/routes/admin-health.ts`
- Modify: `apps/api/test/admin-health.test.ts` (thêm 2 bài ở CUỐI describe)

- [ ] **Step 1: Thêm test đỏ vào cuối `describe('GET /v1/admin/health')` trong `apps/api/test/admin-health.test.ts`**

Mở rộng interface `Body` (thêm dòng):

```ts
  watcher: { kiem_luc: string; gui_trong_ngay: number } | null;
```

Thêm hai bài (đặt SAU các bài đã có, vì các bài có `META.put('release:current')` đã chạy rồi):

```ts
  it('chưa có trạng thái cron → watcher là null, không phải lỗi', async () => {
    mockRoute(200, TUYEN_OK);
    const body = (await (await goi()).json()) as Body;
    expect(body.watcher).toBeNull();
  });

  it('có trạng thái cron trong KV → watcher nói lần đo cuối và số thư hôm nay', async () => {
    mockRoute(200, TUYEN_OK);
    const homNay = new Date().toISOString();
    await env.META.put(
      'health:canh-bao',
      JSON.stringify({
        v: 1,
        kiemLuc: homNay,
        ghiLuc: homNay,
        thanhPhan: {
          db: { ok: true, tuLuc: homNay },
          routing: { ok: true, tuLuc: homNay },
          data: { ok: true, tuLuc: homNay },
        },
        guiTrongNgay: { ngay: homNay.slice(0, 10), so: 2 },
      }),
    );
    const body = (await (await goi()).json()) as Body;
    expect(body.watcher).toEqual({ kiem_luc: homNay, gui_trong_ngay: 2 });
  });
```

- [ ] **Step 2: Chạy để thấy đỏ**

Run: `pnpm --filter @mapslibvn/api test -- test/admin-health.test.ts`
Expected: 2 failed (`expected undefined to be null`, `expected undefined to deeply equal …`), 5 passed.

- [ ] **Step 3: Sửa `apps/api/src/routes/admin-health.ts`**

```ts
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { docTrangThai, tomTatWatcher } from '../health/canh-bao';
import { doBaPhepDo } from '../health/phep-do';

export const adminHealth = new Hono<AppEnv>();

adminHealth.get('/v1/admin/health', async (c) => {
  // `watcher` đọc song song với ba phép đo: cron chết thì im lặng, và im lặng trông giống hệt
  // "mọi thứ tốt" — trang phải cho thấy lần cron đo gần nhất.
  const [phepDo, trangThaiCron] = await Promise.all([
    doBaPhepDo(c.env, c.executionCtx),
    docTrangThai(c.env.META),
  ]);

  // Luôn 200 khi qua được Access: đây là BÁO CÁO về sức khoẻ, không phải sức khoẻ của chính nó.
  // Trả 503 khi Valhalla chết thì màn hình mất luôn trạng thái DB và không nói được gì đã hỏng.
  return c.json(
    { checked_at: new Date().toISOString(), ...phepDo, watcher: tomTatWatcher(trangThaiCron) },
    200,
    { 'cache-control': 'private, no-store' },
  );
});
```

- [ ] **Step 4: Chạy để thấy xanh**

Run: `pnpm --filter @mapslibvn/api test -- test/admin-health.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin-health.ts apps/api/test/admin-health.test.ts
git commit -m "feat(api): /v1/admin/health trả watcher — lần cron đo cuối và số thư cảnh báo hôm nay

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Trang Sức khoẻ hiện dòng giám sát

**Files:**
- Modify: `apps/admin/src/features/health/api.ts`
- Modify: `apps/admin/src/features/health/page.tsx`
- Modify: `apps/admin/src/features/health/page.test.tsx`

- [ ] **Step 1: Thêm kiểu vào `api.ts`** — trong `interface Health`, sau `data: …;`:

```ts
  /** Cron cảnh báo: `null` khi chưa chạy lần nào. `gui_trong_ngay` đếm theo ngày UTC. */
  watcher: { kiem_luc: string; gui_trong_ngay: number } | null;
```

- [ ] **Step 2: Sửa test `page.test.tsx` — cho `mo()` nhận health tuỳ biến, thêm 3 bài**

Thêm `watcher: null` vào hằng `HEALTH` (sau `data: …`). Đổi chữ ký `mo`:

```ts
function mo(health: object = HEALTH) {
  duocGoi = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      duocGoi.push(url);
      return new Response(JSON.stringify(url.includes('/v1/admin/health') ? health : METRICS));
    }),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <HealthPage />
    </QueryClientProvider>,
  );
}
```

Thêm vào cuối `describe('HealthPage')`:

```ts
  it('cron chưa chạy lần nào → nói thẳng, không giả vờ đang giám sát', async () => {
    mo();
    expect(await screen.findByText(/Giám sát tự động chưa chạy lần nào/)).toBeVisible();
  });

  it('cron vừa đo → hiện giờ đo cuối và số thư hôm nay', async () => {
    const vuaRoi = new Date(Date.now() - 4 * 60_000).toISOString();
    mo({ ...HEALTH, watcher: { kiem_luc: vuaRoi, gui_trong_ngay: 1 } });
    const dong = await screen.findByText(/Giám sát tự động: đo lần cuối/);
    expect(dong).toBeVisible();
    expect(dong.textContent).toContain('1 cảnh báo hôm nay');
    expect(screen.queryByText(/cron có thể đang không chạy/)).toBeNull();
  });

  it('lần đo cuối cũ hơn 60 phút → cảnh báo cron có thể đang không chạy', async () => {
    // Nhịp ghi KV là 30 phút, nên 29 phút cũ vẫn bình thường; 3 giờ thì không còn cách giải thích
    // nào khác ngoài cron không chạy.
    const baGioTruoc = new Date(Date.now() - 3 * 3_600_000).toISOString();
    mo({ ...HEALTH, watcher: { kiem_luc: baGioTruoc, gui_trong_ngay: 0 } });
    expect(await screen.findByText(/cron có thể đang không chạy/)).toBeVisible();
  });
```

- [ ] **Step 3: Chạy để thấy đỏ**

Run: `pnpm vitest run apps/admin/src/features/health/page.test.tsx`
Expected: 3 failed (`Unable to find an element with the text: /Giám sát tự động…/`), 5 passed.

- [ ] **Step 4: Sửa `page.tsx` — thêm component và gắn dưới ba thẻ**

Thêm hằng và component sau `function Dong(...)`:

```tsx
/** Quá ngưỡng này mà cron chưa ghi gì thì không còn cách giải thích nào khác ngoài cron không chạy. */
const CRON_IM_LANG_PHUT = 60;

/**
 * Cron chết thì im lặng, và im lặng trông giống hệt "mọi thứ tốt". Dòng này là chỗ duy nhất trên
 * giao diện cho biết lớp cảnh báo email còn sống.
 */
function GiamSat({ watcher }: { watcher: Health['watcher'] }) {
  if (!watcher) {
    return (
      <p className="text-xs text-[var(--text-muted)]">
        Giám sát tự động chưa chạy lần nào — sau deploy, đợi tối đa 5 phút rồi tải lại.
      </p>
    );
  }
  const phut = Math.round((Date.now() - new Date(watcher.kiem_luc).getTime()) / 60_000);
  const imLang = phut > CRON_IM_LANG_PHUT;
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
      <span>
        Giám sát tự động: đo lần cuối {gio(watcher.kiem_luc)} · đã gửi {watcher.gui_trong_ngay}{' '}
        cảnh báo hôm nay
      </span>
      {imLang && <Badge tone="danger">Im lặng {phut} phút — cron có thể đang không chạy</Badge>}
    </p>
  );
}
```

Trong `HealthPage`, đổi dòng render `TrangThai`:

```tsx
      {health.data && (
        <>
          <TrangThai health={health.data} />
          <GiamSat watcher={health.data.watcher} />
        </>
      )}
```

- [ ] **Step 5: Chạy để thấy xanh + typecheck admin**

Run: `pnpm vitest run apps/admin/src/features/health/page.test.tsx && pnpm --filter @mapslibvn/admin typecheck`
Expected: 8 passed; typecheck không lỗi. (Nếu `Health` chưa được import trong `page.tsx`, kiểm: nó đã nằm trong import từ `./api` — có sẵn `type Health`.)

- [ ] **Step 6: Build admin để chắc bundle vẫn ra**

Run: `pnpm --filter @mapslibvn/admin build 2>&1 | tail -3`
Expected: `✓ built in …`.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/features/health/api.ts apps/admin/src/features/health/page.tsx apps/admin/src/features/health/page.test.tsx
git commit -m "feat(admin): trang Sức khoẻ hiện dòng giám sát tự động — lần cron đo cuối, cảnh báo khi im lặng quá 60 phút

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Lớp A — chính sách Tunnel Health Alert trên Cloudflare

**Files:** không sửa mã. Kết quả ghi vào evidence ở Task 8.

- [ ] **Step 1: Tạo chính sách bằng API (token máy dev, đọc từ `.env` gốc repo)**

```bash
cd /Users/dtphong/Desktop/software_business/mapsLibVN
set -a; source .env; set +a
ACC="${CF_ACCOUNT_ID:-90de8c1aef96991cdf2a49008f9a0122}"
curl -s "https://api.cloudflare.com/client/v4/accounts/$ACC/alerting/v3/policies" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'content-type: application/json' \
  --data '{
    "name": "MapsLibVN — Tunnel mapslibvn-db down",
    "description": "Tunnel mang cả Postgres (maps-db) và Valhalla (maps-route). Down = máy chủ ngủ/mất mạng/cloudflared tắt. Spec docs/superpowers/specs/2026-09-20-canh-bao-suc-khoe-design.md mục 4.",
    "alert_type": "tunnel_health_event",
    "enabled": true,
    "filters": { "new_status": ["down"] },
    "mechanisms": { "email": [ { "id": "dotienphong1993@gmail.com" } ] }
  }' | python3 -c 'import sys,json; d=json.load(sys.stdin); print("success:",d.get("success")); print("id:",(d.get("result") or {}).get("id")); print("errors:",d.get("errors"))'
```

Expected: `success: True`, một `id` UUID.
Nếu `success: False` với lỗi 10000/quyền: token thiếu `Notifications Write`. Khi đó ghi vào evidence là "PHONG tạo tay" và đưa PHONG bước: Dashboard → Notifications → Add → Product **Cloudflare Tunnel** → **Tunnel Health Alert** → email dotienphong1993@gmail.com → tunnel status chỉ chọn **Down** → Create.

- [ ] **Step 2: Đọc lại để xác nhận**

```bash
curl -s "https://api.cloudflare.com/client/v4/accounts/$ACC/alerting/v3/policies" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | python3 -c 'import sys,json; d=json.load(sys.stdin); [print(p["id"],"|",p["name"],"|",p["alert_type"],"| enabled:",p["enabled"],"| filters:",p.get("filters"),"| email:",[m["id"] for m in p["mechanisms"].get("email",[])]) for p in d["result"] if p["alert_type"]=="tunnel_health_event"]'
```

Expected: đúng một dòng `tunnel_health_event`, `enabled: True`, `filters: {'new_status': ['down']}`, email đúng.

- [ ] **Step 3: Ghi chú điểm chưa kiểm được**

Schema OpenAPI khai `new_status` là mảng chuỗi **không liệt kê giá trị**; tài liệu chỉ nêu bốn trạng thái `Healthy/Inactive/Down/Degraded`. Giá trị `down` chữ thường khớp trường `status` của API tunnel. Chưa có cách kiểm không phá hoại (máy chủ production không ở máy này). Ghi vào evidence; lớp B bắt cùng ca này nên rủi ro là mất một lớp dự phòng, không mất cảnh báo.

Việc PHONG phải làm: mở hộp thư, bấm **xác nhận** trong thư "Verify your email" của Cloudflare Notifications nếu có. Chưa xác nhận thì chính sách không gửi.

---

### Task 8: Tài liệu

**Files:**
- Modify: `apps/docs/src/content/docs/tu-host.md` (mục 6)
- Modify: `infra/server/README.md` (bước 5)
- Modify: `docs/DEVLOG.md` (mục 27)
- Create: `docs/evidence/health/2026-09-20-canh-bao-suc-khoe.md`
- Modify: `docs/superpowers/specs/2026-09-20-canh-bao-suc-khoe-design.md` (mục 7 dòng `scheduled.test.ts`, khớp Task 4)

- [ ] **Step 1: `tu-host.md` mục 6** — thay đoạn văn duy nhất dưới `## 6. Giám sát` bằng:

```markdown
Hai lớp cảnh báo email, mỗi lớp bắt một nhóm lỗi khác nhau (spec `2026-09-20-canh-bao-suc-khoe`):

- **Cloudflare Tunnel Health Alert** — chính sách Notification `tunnel_health_event`, lọc trạng thái
  `down`, gửi tới email vận hành. Bắt máy chủ ngủ, mất mạng, `cloudflared` tắt. Sống độc lập với
  Worker. Email nhận phải bấm xác nhận trong thư của Cloudflare một lần.
- **Cron Worker mỗi 5 phút** đo ba phép đo của trang `/admin/health` (DB `SELECT 1`, một `/route`
  Valhalla thật, manifest KV), đo lại phép hỏng sau 15 s, và gửi **một** thư gộp tới `ALERT_EMAIL`
  khi trạng thái **đổi** (hỏng → thư "HỎNG: …", phục hồi → thư "PHỤC HỒI: … (hỏng N phút)"). Trạng
  thái nằm ở KV `META` khoá `health:canh-bao`; trần 10 thư/ngày. Trang Sức khoẻ hiện dòng "Giám sát
  tự động: đo lần cuối …" và tô đỏ nếu cron im lặng quá 60 phút.

Ngoài hai lớp trên: số liệu 5xx và p95 của Worker ở `/admin/health`, và báo cáo sử dụng hằng tuần
tự động gửi email từ Analytics Engine do container `pipeline` chạy vào thứ Hai lúc 08:00 giờ Việt Nam.
```

- [ ] **Step 2: `infra/server/README.md` bước 5** — thay dòng bắt đầu `5. Tuỳ chọn cảnh báo:` bằng:

```markdown
5. **Cảnh báo tunnel down (bắt buộc, spec 2026-09-20-canh-bao-suc-khoe mục 4)**: chính sách Notification `tunnel_health_event` lọc `new_status = down`, email tới địa chỉ vận hành — đã tạo bằng API ngày 20/09/2026 (id trong `docs/evidence/health/2026-09-20-canh-bao-suc-khoe.md`). Tạo lại nếu đổi tài khoản: Dashboard → Notifications → Add → Cloudflare Tunnel → Tunnel Health Alert → chỉ chọn trạng thái **Down**. Email mới phải bấm xác nhận trong thư của Cloudflare.
```

- [ ] **Step 3: Spec mục 7** — thay dòng bắt đầu `` `test/scheduled.test.ts` — `` bằng:

```markdown
`test/scheduled.test.ts` — cron `*/5` xếp **hai** việc nền (đơn hàng + sức khoẻ) và không ném khi DB
không nối được; cron `0 2` chỉ một việc. Tầng test không có `ALERT_EMAIL` nên việc sức khoẻ kết
thúc `thieu-cau-hinh` — cố ý: có nó thì ba phép đo đều hỏng và bài test phải chờ 15 s đo lại.
```

- [ ] **Step 4: Evidence `docs/evidence/health/2026-09-20-canh-bao-suc-khoe.md`** — viết theo khung, điền số thật từ Task 7 và Task 9:

```markdown
# Nghiệm thu — cảnh báo sức khoẻ qua email (20/09/2026)

Spec: `docs/superpowers/specs/2026-09-20-canh-bao-suc-khoe-design.md`. Plan: `docs/superpowers/plans/2026-09-20-canh-bao-suc-khoe.md`.

## 1. Cổng chất lượng

| Cổng | Kết quả |
|---|---|
| `pnpm test` | <điền: N tests pass, thời gian> |
| `pnpm typecheck` | <điền> |
| `pnpm lint` | <điền> |

## 2. Lớp A — Tunnel Health Alert

- Policy id: `<điền>`; `alert_type=tunnel_health_event`; `filters.new_status=["down"]`; email `dotienphong1993@gmail.com`.
- Tạo bằng: <API với CLOUDFLARE_API_TOKEN | PHONG tạo tay>.
- Chưa kiểm được: giá trị `down` có đúng chữ thường mà Cloudflare so khớp không — schema không liệt kê. Cách kiểm thật duy nhất là một lần tunnel down thật; khi có, ghi lại ở đây.
- Việc PHONG: bấm xác nhận email trong thư của Cloudflare Notifications (nếu có).

## 3. Lớp B — cron Worker trên production

- Deploy: commit `<sha>` trên `main`, workflow Deploy API xanh lúc `<giờ>`.
- KV `health:canh-bao` sau ≤ 5 phút: `<dán JSON>`.
- Diễn tập đường thư (spec mục 9.4): ghi tay `routing.ok=false, tuLuc=<10 phút trước>` lúc `<giờ>`; lượt cron `<giờ>` → thư `[MapsLibVN] PHỤC HỒI: Định tuyến (hỏng ~10 phút)` tới hộp thư lúc `<giờ>`. KV sau đó: `guiTrongNgay.so=1`.
- Trang `/admin/health` hiện "Giám sát tự động: đo lần cuối HH:MM · đã gửi 1 cảnh báo hôm nay".

## 4. Điểm mù còn lại

Xem spec mục 8. Không có gì mới phát sinh trong lúc làm / <điền nếu có>.
```

- [ ] **Step 5: DEVLOG mục 27** — thêm cuối file, theo văn phong các mục trước (đoạn văn, không gạch đầu dòng khô), gồm: vì sao hai lớp; quyết định đo lại sau 15 s; vì sao thư gộp và vì sao gửi khi *đổi* trạng thái; vì sao đường thư không chạm Postgres; ghi KV chọn lọc vì hạn mức; `watcher` cho câu hỏi "ai canh người canh"; điểm chưa kiểm được ở lớp A; kết quả diễn tập. Tiêu đề:

```markdown
## 27. 20/09/2026 — Cảnh báo sức khoẻ: ba thẻ ở /admin/health giờ biết gọi người
```

- [ ] **Step 6: Commit**

```bash
git add apps/docs/src/content/docs/tu-host.md infra/server/README.md docs/DEVLOG.md docs/evidence/health/2026-09-20-canh-bao-suc-khoe.md docs/superpowers/specs/2026-09-20-canh-bao-suc-khoe-design.md
git commit -m "docs: cảnh báo sức khoẻ — tu-host mục 6, README máy chủ bước 5, DEVLOG 27, evidence

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Cổng chất lượng, merge, deploy, nghiệm thu production

- [ ] **Step 1: Toàn bộ cổng**

Run: `pnpm typecheck && pnpm lint && pnpm test 2>&1 | tail -30`
Expected: typecheck sạch; biome không lỗi; vitest gốc và `apps/api` đều pass (số test tăng ~17 so với HEAD `fdbfc5a`).

- [ ] **Step 2: Merge vào main và push**

```bash
git checkout main && git merge --no-ff feat/canh-bao-suc-khoe -m "merge: cảnh báo sức khoẻ qua email — Tunnel Health Alert + cron Worker

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" && git push origin main
```

- [ ] **Step 3: Theo dõi CI**

Run: `gh run list --limit 6` rồi `gh run watch <id của Deploy API>`.
Expected: Deploy API, CI, Deploy Docs xanh. DB tests chạy ~20 phút, không chặn bước sau.

- [ ] **Step 4: Đợi cron chạy lần đầu và đọc KV**

```bash
sleep 330
cd apps/api && pnpm exec wrangler kv key get --namespace-id a50e778ff63a4ad7956f783eba456ed5 --remote "health:canh-bao"; cd ../..
```

Expected: JSON có `v:1`, `kiemLuc` trong 5 phút gần nhất, cả ba `ok: true` (nếu production khoẻ). Nếu rỗng sau 10 phút: `pnpm exec wrangler tail --env production --format pretty` lọc `[health]` để xem báo cáo.

- [ ] **Step 5: Diễn tập đường thư (spec 9.4) — không làm hỏng gì**

Lấy JSON ở bước 4, đổi `routing` thành `{ "ok": false, "tuLuc": "<ISO 10 phút trước>", "loi": "diễn tập" }`, giữ nguyên phần còn lại, ghi lại:

```bash
cd apps/api && pnpm exec wrangler kv key put --namespace-id a50e778ff63a4ad7956f783eba456ed5 --remote "health:canh-bao" '<JSON đã sửa>'; cd ../..
sleep 330
cd apps/api && pnpm exec wrangler kv key get --namespace-id a50e778ff63a4ad7956f783eba456ed5 --remote "health:canh-bao"; cd ../..
```

Expected: `routing.ok` trở lại `true`, `guiTrongNgay.so` = 1, và **PHONG thấy thư** `[MapsLibVN] PHỤC HỒI: Định tuyến (hỏng ~10 phút)` trong Gmail. Ghi giờ vào evidence mục 3.

- [ ] **Step 6: Điền evidence, commit, push**

```bash
git add docs/evidence/health/2026-09-20-canh-bao-suc-khoe.md
git commit -m "docs: bằng chứng nghiệm thu cảnh báo sức khoẻ trên production — KV sau cron, diễn tập thư phục hồi

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin main
```
