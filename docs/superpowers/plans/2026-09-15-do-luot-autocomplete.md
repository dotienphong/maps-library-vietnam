# Kế hoạch đo số lượt Places của autocomplete

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đo bằng số thật xem một phiên gõ tìm kiếm tiếng Việt tốn bao nhiêu lượt Places ở debounce 200/300/500/800 ms, trên cả ba gói SDK.

**Architecture:** Ghi trace gõ phím từ điện thoại thật qua một trang Artifact (không gọi API), chốt trace thành tệp cố định trong repo, rồi phát lại trace bằng đồng hồ giả của vitest qua **mã thật** của ba gói, đếm số lời gọi `client.autocomplete`. Mỗi gói có một tệp phát lại riêng nằm trong `src` của chính nó, vì `tsconfig.scripts.json` không cho tệp `.mjs` ở `scripts/` import mã `.ts` của gói.

**Tech Stack:** vitest (fake timers, jsdom), @testing-library/react, web component thuần, Artifact có kho dữ liệu.

**Spec:** `docs/superpowers/specs/2026-09-15-do-luot-autocomplete-design.md`

---

## Bố cục tệp

| Tệp | Trách nhiệm |
|---|---|
| `packages/web/src/autocomplete-element.ts` | *Sửa* — mở attribute `debounce`, mặc định 200 ms |
| `packages/web/src/autocomplete-element.test.ts` | *Sửa* — test cho attribute mới |
| `docs/evidence/autocomplete-debounce/2026-09-15-traces.json` | *Tạo* — trace thô đã ghi, kèm thiết bị/bàn phím/người gõ |
| `scripts/debounce-traces.test.mjs` | *Tạo* — canh hình dạng tệp trace (JSON thuần, không import `.ts`) |
| `packages/react/src/debounce-trace.test.ts` | *Tạo* — phát lại qua `usePlaces` của react |
| `packages/react-native/src/debounce-trace.test.ts` | *Tạo* — phát lại qua `usePlaces` của react-native |
| `packages/web/src/debounce-trace.test.ts` | *Tạo* — phát lại qua web component |
| `scripts/debounce-report.mjs` | *Tạo* — gộp ba tệp số thành bảng markdown |
| `docs/evidence/autocomplete-debounce/2026-09-15-do-luot-autocomplete.md` | *Tạo* — kết luận và giới hạn |

Ba tệp phát lại cố tình lặp nhau khoảng 30 dòng. Không gom vào một helper dùng chung vì mỗi
`tsconfig.json` của gói chỉ `include: ["src"]` của chính nó; gom lại sẽ phải dựng một gói dùng chung
chỉ để phục vụ test. Repo đã có tiền lệ: `use-places.test.ts` của react và react-native vốn gần y hệt.

**Hai cái bẫy typecheck phải nhớ suốt kế hoạch** (`tsconfig.base.json`):
- `noUncheckedIndexedAccess` — `mảng[i]` và `.at(-1)` có kiểu `T | undefined`, phải xử lý.
- `exactOptionalPropertyTypes` — không được gán `undefined` vào thuộc tính `?:`; phải dùng spread có điều kiện.

---

### Task 1: Mở attribute `debounce` cho web component

**Files:**
- Modify: `packages/web/src/autocomplete-element.ts` (`observedAttributes` ở dòng 57, `#onInput` ở dòng 121-132)
- Test: `packages/web/src/autocomplete-element.test.ts`

- [ ] **Step 1: Viết test đỏ**

Thêm vào cuối `packages/web/src/autocomplete-element.test.ts` một khối describe mới.
`typeQuery` sẵn có luôn chờ đúng 200 ms nên không dùng lại được; dựng element trực tiếp:

```ts
describe('MapsLibVNAutocomplete — attribute debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    autocomplete.mockReset();
    document.body.replaceChildren();
  });

  /** Dựng element, gõ `query`, trả về input để test tự tua đồng hồ. */
  function mount(attrs: Record<string, string> = {}) {
    autocomplete.mockResolvedValue({ items: [] });
    const element = new MapsLibVNAutocomplete();
    element.setAttribute('api-key', 'mlv_test');
    element.setAttribute('api-base', 'https://api.test');
    for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
    document.body.append(element);
    const input = element.shadowRoot?.querySelector('input');
    if (!input) throw new Error('không dựng được input');
    input.value = 'ben thanh';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return input;
  }

  it('mặc định vẫn là 200 ms khi không đặt thuộc tính', async () => {
    mount();
    await vi.advanceTimersByTimeAsync(199);
    expect(autocomplete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(autocomplete).toHaveBeenCalledTimes(1);
  });

  it('debounce="500" thì chờ đủ 500 ms mới gọi', async () => {
    mount({ debounce: '500' });
    await vi.advanceTimersByTimeAsync(499);
    expect(autocomplete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(autocomplete).toHaveBeenCalledTimes(1);
  });

  it('giá trị rác rơi về 200 ms và cảnh báo, không làm chết ô tìm kiếm', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mount({ debounce: 'nhanh lên' });
    await vi.advanceTimersByTimeAsync(200);
    expect(autocomplete).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('số âm cũng rơi về mặc định', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mount({ debounce: '-1' });
    await vi.advanceTimersByTimeAsync(199);
    expect(autocomplete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(autocomplete).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('đổi thuộc tính lúc đang chạy thì lần gõ sau dùng giá trị mới', async () => {
    const input = mount({ debounce: '500' });
    await vi.advanceTimersByTimeAsync(500);
    expect(autocomplete).toHaveBeenCalledTimes(1);
    const element = input.getRootNode() as ShadowRoot;
    (element.host as HTMLElement).setAttribute('debounce', '200');
    input.value = 'ben thanh q1';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(200);
    expect(autocomplete).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Chạy để chắc chắn nó đỏ**

Chạy: `pnpm vitest run packages/web/src/autocomplete-element.test.ts -t "attribute debounce"`
Kỳ vọng: FAIL — bài `debounce="500"` gọi ngay ở mốc 200 ms nên `expect(autocomplete).not.toHaveBeenCalled()` vỡ.

- [ ] **Step 3: Sửa mã cho test xanh**

Thêm hằng số cạnh `let instanceId = 0;` (khoảng dòng 33):

```ts
/** Debounce mặc định của ô tìm kiếm, tính bằng mili giây. */
export const DEFAULT_DEBOUNCE_MS = 200;
```

Thêm `'debounce'` vào `observedAttributes`:

```ts
  static observedAttributes = ['api-key', 'api-base', 'placeholder', 'near', 'sources', 'debounce'];
```

(`attributeChangedCallback` không cần nhánh mới — giá trị được đọc lúc gõ. Đây đúng cách `near`
đang làm: có trong `observedAttributes`, đọc lười trong `#near()`.)

Thêm method cạnh `#near()`:

```ts
  /**
   * Thuộc tính vắng hoặc sai → dùng mặc định, giống cách `sources` xử lý: một thuộc tính gõ sai
   * không được làm ô tìm kiếm chết hẳn.
   */
  #debounceMs(): number {
    const raw = this.getAttribute('debounce');
    if (raw === null) return DEFAULT_DEBOUNCE_MS;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      console.warn(
        `<mapslibvn-autocomplete debounce="${raw}"> không hợp lệ — dùng ${DEFAULT_DEBOUNCE_MS} ms`,
      );
      return DEFAULT_DEBOUNCE_MS;
    }
    return value;
  }
```

Sửa dòng cuối của `#onInput` (dòng 131):

```ts
    this.#timer = setTimeout(() => void this.#query(value), this.#debounceMs());
```

- [ ] **Step 4: Chạy lại cả tệp**

Chạy: `pnpm vitest run packages/web/src/autocomplete-element.test.ts`
Kỳ vọng: PASS toàn bộ, kể cả các bài cũ vẫn chờ 200 ms.

- [ ] **Step 5: Ghi vào tài liệu**

Trong `apps/docs/src/content/docs/sdk.md`, phần web component, thêm `debounce` vào bảng thuộc tính
với mặc định `200`. Không ghi số phiên bản vào tiêu đề hay README — badge npm đã tự lo.

- [ ] **Step 6: Typecheck và lint**

Chạy: `pnpm typecheck && pnpm lint`
Kỳ vọng: cả hai xanh.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/autocomplete-element.ts packages/web/src/autocomplete-element.test.ts apps/docs/src/content/docs/sdk.md
git commit -m "feat(web): mở attribute debounce cho mapslibvn-autocomplete"
```

---

### Task 2: Dựng trang ghi trace và ghi 14 kịch bản

Task này cần PHONG gõ trên điện thoại — máy không tự làm xong được.

**Files:** không đụng repo ở task này.

- [ ] **Step 1: Nạp hai skill bắt buộc trước khi viết trang**

Gọi skill `artifact-capabilities` (vì trang cần kho lưu trace) rồi `artifact-design`.
Không viết một dòng HTML nào trước khi nạp xong cả hai.

- [ ] **Step 2: Viết trang ghi**

Một trang, các phần:
- Ô nhập `<input type="search">` với `autocomplete="off"`, chữ đủ to để gõ trên điện thoại.
- Danh sách 14 kịch bản, kịch bản đang ghi được làm nổi; nút **Xong, sang kịch bản sau** và nút **Gõ lại kịch bản này**.
- Phần khai báo một lần: thiết bị (ví dụ `iPhone 14`), bàn phím (ví dụ `Gboard tiếng Việt`), tên người gõ.
- Đếm số kịch bản đã ghi / 14.

Ràng buộc bắt buộc:
- **Trang tuyệt đối không gọi API Places nào.** Không `fetch` ra ngoài. Độ trễ mạng sẽ làm lệch nhịp gõ, và tốn quota vô nghĩa.
- Mốc thời gian lấy bằng `performance.now()`, làm tròn về số nguyên mili giây, gốc `0` là sự kiện đầu tiên của kịch bản.
- Nghe `input`, `compositionstart`, `compositionend`. Ghi cả ba loại.
- Bấm **Gõ lại** thì xoá sạch mốc của kịch bản đó rồi ghi lại từ đầu.

Mỗi kịch bản lưu thành một tài liệu trong collection `traces`, `doc_id` là `id` của kịch bản:

```json
{
  "id": "poi-ben-thanh",
  "group": "poi",
  "target": "Chợ Bến Thành",
  "device": "iPhone 14",
  "keyboard": "Bàn phím tiếng Việt của iOS",
  "typist": "PHONG",
  "recordedAt": "2026-09-15T...",
  "events": [
    { "t": 0, "type": "input", "value": "c" },
    { "t": 210, "type": "input", "value": "ch" }
  ]
}
```

14 kịch bản, đúng bảng trong mục 4 của spec:

| id | group | target |
|---|---|---|
| `poi-ben-thanh` | poi | Chợ Bến Thành |
| `poi-highlands` | poi | Highlands Coffee |
| `poi-cho-ray` | poi | Bệnh viện Chợ Rẫy |
| `addr-nguyen-hue` | address | 123 Nguyễn Huệ |
| `addr-le-loi` | address | 45 Lê Lợi Quận 1 |
| `cat-ca-phe` | category | quán cà phê |
| `cat-cay-xang` | category | cây xăng gần đây |
| `route-from-bach-khoa` | route | Đại học Bách Khoa (ô điểm đi) |
| `route-to-tan-son-nhat` | route | Sân bay Tân Sơn Nhất (ô điểm đến) |
| `fix-ben-thanh` | fix | Chợ Bến Thành — gõ sai giữa chừng rồi xoá lùi sửa |
| `fix-highlands` | fix | Highlands Coffee — gõ sai giữa chừng rồi xoá lùi sửa |
| `fix-nguyen-hue` | fix | 123 Nguyễn Huệ — gõ sai giữa chừng rồi xoá lùi sửa |
| `fix-ca-phe` | fix | quán cà phê — gõ sai giữa chừng rồi xoá lùi sửa |
| `fix-tan-son-nhat` | fix | Sân bay Tân Sơn Nhất — gõ sai giữa chừng rồi xoá lùi sửa |

Hai kịch bản `route-*` phải gõ liền nhau trong cùng một lượt mở trang, vì đó là một phiên tính tuyến thật.

- [ ] **Step 3: Xuất bản và đưa link cho PHONG**

Xuất bản trang, đưa link kèm hướng dẫn ngắn: mở trên điện thoại, khai báo thiết bị/bàn phím một lần,
gõ từng kịch bản **như gõ thật** (không cố gõ chậm hay nhanh bất thường), gõ sai thật thì cứ sửa thật.

- [ ] **Step 4: Chờ PHONG báo đã ghi xong 14 kịch bản**

Không tự đoán là xong. Chờ PHONG nói.

---

### Task 3: Chốt trace thành tệp cố định trong repo

**Files:**
- Create: `docs/evidence/autocomplete-debounce/2026-09-15-traces.json`
- Create: `scripts/debounce-traces.test.mjs`

- [ ] **Step 1: Đọc trace về từ kho của trang**

Đọc collection `traces` của artifact, ghi ra
`docs/evidence/autocomplete-debounce/2026-09-15-traces.json` theo hình dạng:

```json
{
  "recordedAt": "2026-09-15T...",
  "device": "iPhone 14",
  "keyboard": "Bàn phím tiếng Việt của iOS",
  "typist": "PHONG",
  "note": "Ghi từ trình duyệt trên điện thoại, không phải TextInput của React Native.",
  "traces": [ { "id": "...", "group": "...", "target": "...", "events": [ ... ] } ]
}
```

Sắp `traces` theo đúng thứ tự bảng ở Task 2 để bảng kết quả về sau đọc được.

- [ ] **Step 2: Viết test canh hình dạng tệp**

Tạo `scripts/debounce-traces.test.mjs`. Tệp `.mjs` chỉ đọc JSON, không import mã `.ts` nào,
nên không vướng `moduleResolution: NodeNext` của `tsconfig.scripts.json`:

```js
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** @typedef {{t:number, type:string, value:string}} TraceEvent */
/** @typedef {{id:string, group:string, target:string, events:TraceEvent[]}} Trace */

const IDS = [
  'poi-ben-thanh', 'poi-highlands', 'poi-cho-ray',
  'addr-nguyen-hue', 'addr-le-loi',
  'cat-ca-phe', 'cat-cay-xang',
  'route-from-bach-khoa', 'route-to-tan-son-nhat',
  'fix-ben-thanh', 'fix-highlands', 'fix-nguyen-hue', 'fix-ca-phe', 'fix-tan-son-nhat',
];

const file = JSON.parse(
  readFileSync('docs/evidence/autocomplete-debounce/2026-09-15-traces.json', 'utf8'),
);

describe('trace gõ phím autocomplete', () => {
  it('ghi rõ ghi ở đâu, bằng bàn phím gì, ai gõ', () => {
    expect(file.device).toBeTruthy();
    expect(file.keyboard).toBeTruthy();
    expect(file.typist).toBeTruthy();
    expect(file.recordedAt).toMatch(/^2026-/);
  });

  it('đủ 14 kịch bản, đúng thứ tự', () => {
    expect(file.traces.map((/** @type {Trace} */ t) => t.id)).toEqual(IDS);
  });

  it('mốc thời gian không lùi, gốc là 0', () => {
    for (const trace of file.traces) {
      const inputs = trace.events.filter((/** @type {TraceEvent} */ e) => e.type === 'input');
      expect(inputs.length, trace.id).toBeGreaterThan(1);
      expect(trace.events[0].t, trace.id).toBe(0);
      for (let i = 1; i < trace.events.length; i++) {
        expect(trace.events[i].t, `${trace.id} mốc ${i}`).toBeGreaterThanOrEqual(
          trace.events[i - 1].t,
        );
      }
    }
  });

  it('kịch bản sửa lỗi có ít nhất một lần chuỗi ngắn lại', () => {
    for (const trace of file.traces.filter((/** @type {Trace} */ t) => t.group === 'fix')) {
      const inputs = trace.events.filter((/** @type {TraceEvent} */ e) => e.type === 'input');
      const shrank = inputs.some((e, i) => i > 0 && e.value.length < inputs[i - 1].value.length);
      expect(shrank, `${trace.id} phải có xoá lùi`).toBe(true);
    }
  });
});
```

- [ ] **Step 3: Chạy test**

Chạy: `pnpm vitest run scripts/debounce-traces.test.mjs`
Kỳ vọng: PASS. Nếu đỏ ở bài "xoá lùi" nghĩa là kịch bản `fix-*` ghi chưa đúng ý — phải ghi lại, không được sửa test cho vừa.

- [ ] **Step 4: Typecheck**

Chạy: `pnpm typecheck`
Kỳ vọng: xanh. Nếu đỏ ở `scripts/debounce-traces.test.mjs` thì bổ sung JSDoc `@type` cho biến đỏ — đừng tắt `checkJs`.

- [ ] **Step 5: Commit**

```bash
git add docs/evidence/autocomplete-debounce/2026-09-15-traces.json scripts/debounce-traces.test.mjs
git commit -m "test(evidence): chốt 14 trace gõ phím ghi từ điện thoại thật"
```

---

### Task 4: Phát lại qua `@mapslibvn/react`

**Files:**
- Create: `packages/react/src/debounce-trace.test.ts`

- [ ] **Step 1: Viết tệp phát lại**

```ts
// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { MapsLibVNClient } from '@mapslibvn/core';
import { act, renderHook } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaces } from './use-places';

const DIR = 'docs/evidence/autocomplete-debounce';
const LEVELS = [200, 300, 500, 800];

interface TraceEvent {
  t: number;
  type: string;
  value: string;
}
interface Trace {
  id: string;
  group: string;
  target: string;
  events: TraceEvent[];
}
interface Row {
  trace: string;
  group: string;
  debounceMs: number;
  total: number;
  final: number;
  partial: number;
}

const file = JSON.parse(readFileSync(`${DIR}/2026-09-15-traces.json`, 'utf8')) as {
  traces: Trace[];
};

/**
 * Chỉ phát lại sự kiện `input`. Mốc composition được ghi để dành cho việc sửa IME sau này;
 * hook hiện chỉ thấy giá trị ô đổi, nên đưa chúng vào sẽ đếm sai.
 */
const inputsOf = (trace: Trace) => trace.events.filter((event) => event.type === 'input');

/**
 * Client giả trả về ngay. Không cần mô phỏng độ trễ mạng: bộ đếm giờ debounce khởi động lại theo
 * phím gõ chứ không chờ response, nên response nhanh hay chậm không đổi số lượt.
 */
async function replay(trace: Trace, debounceMs: number): Promise<Row> {
  const calls: string[] = [];
  const client = {
    autocomplete: async (q: string) => {
      calls.push(q);
      return { items: [] };
    },
  } as unknown as MapsLibVNClient;

  const { rerender, unmount } = renderHook(
    ({ q }: { q: string }) => usePlaces(q, { client, debounceMs }),
    { initialProps: { q: '' } },
  );

  let previous = 0;
  for (const event of inputsOf(trace)) {
    await act(async () => {
      vi.advanceTimersByTime(event.t - previous);
      await Promise.resolve();
    });
    previous = event.t;
    rerender({ q: event.value });
  }
  // Tua thêm một nhịp debounce để lượt cuối cùng kịp bắn.
  await act(async () => {
    vi.advanceTimersByTime(debounceMs + 1);
    await Promise.resolve();
  });
  unmount();

  const last = inputsOf(trace).at(-1);
  const target = last ? last.value.trim() : '';
  const final = calls.filter((q) => q === target).length;
  return {
    trace: trace.id,
    group: trace.group,
    debounceMs,
    total: calls.length,
    final,
    partial: calls.length - final,
  };
}

const rows: Row[] = [];

describe('@mapslibvn/react — số lượt Places cho một phiên gõ thật', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  afterAll(() => {
    if (!process.env.MEASURE_WRITE) return;
    mkdirSync(DIR, { recursive: true });
    writeFileSync(
      `${DIR}/2026-09-15-counts-react.json`,
      `${JSON.stringify({ package: '@mapslibvn/react', rows }, null, 2)}\n`,
    );
  });

  for (const trace of file.traces) {
    it(`${trace.id}: số lượt không tăng khi debounce tăng`, async () => {
      const measured: Row[] = [];
      for (const debounceMs of LEVELS) measured.push(await replay(trace, debounceMs));
      rows.push(...measured);
      console.log(
        `${trace.id.padEnd(22)} ${measured.map((r) => `${r.debounceMs}ms=${r.total}`).join('  ')}`,
      );

      // Bất biến đúng bất kể con số cụ thể: chờ lâu hơn không thể sinh thêm lượt.
      for (let i = 1; i < measured.length; i++) {
        const before = measured[i - 1];
        const after = measured[i];
        if (!before || !after) throw new Error('thiếu mức đo');
        expect(after.total, `${trace.id} ${after.debounceMs}ms`).toBeLessThanOrEqual(before.total);
      }
      // Chuỗi cuối cùng luôn phải được gửi đi đúng một lần, nếu không người dùng không thấy gợi ý.
      // Ngưỡng của hook là 2 ký tự sau khi trim, nên chuỗi ngắn hơn thì không lượt nào bắn cả.
      const last = inputsOf(trace).at(-1);
      if (last && last.value.trim().length >= 2) {
        for (const row of measured) {
          expect(row.final, `${row.trace} ${row.debounceMs}ms`).toBe(1);
        }
      }
    });
  }
});
```

- [ ] **Step 2: Chạy ở chế độ ghi để lấy số**

Chạy: `MEASURE_WRITE=1 pnpm vitest run packages/react/src/debounce-trace.test.ts`
Kỳ vọng: PASS, và in ra 14 dòng dạng `poi-ben-thanh  200ms=7  300ms=5  500ms=3  800ms=2`.
Tệp `docs/evidence/autocomplete-debounce/2026-09-15-counts-react.json` được tạo.

Nếu bài "chuỗi cuối phải gửi đúng một lần" đỏ: đọc kỹ trace trước khi đổi test — nhiều khả năng là
trace có sự kiện `input` cuối trùng giá trị với sự kiện trước, chứ không phải test sai.

- [ ] **Step 3: Chốt số đo vào chính tệp test**

Thêm vào cuối khối describe một bài so với bảng số vừa đo, điền **số thật** từ Step 2
(ví dụ dưới đây là số giả, phải thay bằng số thật):

```ts
  it('số lượt khớp bảng đã chốt trong docs/evidence', () => {
    const total = (id: string, ms: number) =>
      rows.find((r) => r.trace === id && r.debounceMs === ms)?.total;
    expect(total('poi-ben-thanh', 200)).toBe(7);
    expect(total('poi-ben-thanh', 500)).toBe(3);
    // … một dòng 200 ms và một dòng 500 ms cho cả 14 kịch bản
  });
```

Bài này chạy sau các bài trên trong cùng tệp nên `rows` đã đủ dữ liệu.

- [ ] **Step 4: Chạy lại không có cờ ghi**

Chạy: `pnpm vitest run packages/react/src/debounce-trace.test.ts`
Kỳ vọng: PASS, và tệp `counts-react.json` **không** bị ghi đè.

- [ ] **Step 5: Typecheck và lint**

Chạy: `pnpm typecheck && pnpm lint`
Kỳ vọng: xanh. `measured[i - 1]` có kiểu `Row | undefined` vì `noUncheckedIndexedAccess`; đoạn mã
trên đã chặn bằng `if (!before || !after) throw`.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/debounce-trace.test.ts docs/evidence/autocomplete-debounce/2026-09-15-counts-react.json
git commit -m "test(react): đếm lượt Places khi phát lại trace gõ thật ở 200/300/500/800 ms"
```

---

### Task 5: Phát lại qua `@mapslibvn/react-native`

**Files:**
- Create: `packages/react-native/src/debounce-trace.test.ts`

- [ ] **Step 1: Chép tệp của Task 4 và đổi ba chỗ**

Chép nguyên `packages/react/src/debounce-trace.test.ts` sang
`packages/react-native/src/debounce-trace.test.ts`, đổi đúng ba chỗ:
- tên describe → `'@mapslibvn/react-native — số lượt Places cho một phiên gõ thật'`
- tên tệp ghi ra → `2026-09-15-counts-react-native.json`
- trường `package` → `'@mapslibvn/react-native'`

Dòng `import { usePlaces } from './use-places';` giữ nguyên — nó trỏ sang bản react-native.
`./context` của gói này chỉ `import type` từ `@maplibre/maplibre-react-native` nên bị xoá lúc biên dịch,
chạy được trong jsdom. `use-places.test.ts` sẵn có của gói đã chứng minh điều đó.

Bảng số chốt ở Step 3 phải **đo lại**, không được chép số của react sang. Hai bản hiện giống nhau
từng dòng, nhưng phép đo này tồn tại chính là để bắt lúc chúng thôi giống nhau.

- [ ] **Step 2: Chạy ở chế độ ghi**

Chạy: `MEASURE_WRITE=1 pnpm vitest run packages/react-native/src/debounce-trace.test.ts`
Kỳ vọng: PASS, tạo `2026-09-15-counts-react-native.json`.

- [ ] **Step 3: Chốt số đo vào tệp test**

Thêm vào cuối khối describe, điền **số thật** vừa đo được **của gói này** ở Step 2
(số dưới đây là số giả, phải thay):

```ts
  it('số lượt khớp bảng đã chốt trong docs/evidence', () => {
    const total = (id: string, ms: number) =>
      rows.find((r) => r.trace === id && r.debounceMs === ms)?.total;
    expect(total('poi-ben-thanh', 200)).toBe(7);
    expect(total('poi-ben-thanh', 500)).toBe(3);
    // … một dòng 200 ms và một dòng 500 ms cho cả 14 kịch bản
  });
```

- [ ] **Step 4: Chạy lại không cờ, typecheck, lint**

Chạy: `pnpm vitest run packages/react-native/src/debounce-trace.test.ts && pnpm typecheck && pnpm lint`
Kỳ vọng: xanh cả ba.

- [ ] **Step 5: Commit**

```bash
git add packages/react-native/src/debounce-trace.test.ts docs/evidence/autocomplete-debounce/2026-09-15-counts-react-native.json
git commit -m "test(react-native): đếm lượt Places khi phát lại trace gõ thật ở 200/300/500/800 ms"
```

---

### Task 6: Phát lại qua web component

**Files:**
- Create: `packages/web/src/debounce-trace.test.ts`

Phụ thuộc Task 1 — không có attribute `debounce` thì chỉ đo được mức 200 ms.

- [ ] **Step 1: Viết tệp phát lại**

```ts
// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapsLibVNAutocomplete, defineAutocomplete } from './autocomplete-element';

const DIR = 'docs/evidence/autocomplete-debounce';
const LEVELS = [200, 300, 500, 800];

const autocomplete = vi.fn();
vi.mock('@mapslibvn/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@mapslibvn/core')>()),
  createClient: () => ({ autocomplete }),
}));

interface TraceEvent {
  t: number;
  type: string;
  value: string;
}
interface Trace {
  id: string;
  group: string;
  target: string;
  events: TraceEvent[];
}
interface Row {
  trace: string;
  group: string;
  debounceMs: number;
  total: number;
  final: number;
  partial: number;
}

const file = JSON.parse(readFileSync(`${DIR}/2026-09-15-traces.json`, 'utf8')) as {
  traces: Trace[];
};
const inputsOf = (trace: Trace) => trace.events.filter((event) => event.type === 'input');

defineAutocomplete();

async function replay(trace: Trace, debounceMs: number): Promise<Row> {
  autocomplete.mockReset();
  autocomplete.mockResolvedValue({ items: [] });
  const element = new MapsLibVNAutocomplete();
  element.setAttribute('api-key', 'mlv_test');
  element.setAttribute('api-base', 'https://api.test');
  element.setAttribute('debounce', String(debounceMs));
  document.body.append(element);
  const input = element.shadowRoot?.querySelector('input');
  if (!input) throw new Error('không dựng được input');

  let previous = 0;
  for (const event of inputsOf(trace)) {
    await vi.advanceTimersByTimeAsync(event.t - previous);
    previous = event.t;
    input.value = event.value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  await vi.advanceTimersByTimeAsync(debounceMs + 1);
  element.remove();

  const calls = autocomplete.mock.calls.map((args) => String(args[0]));
  const last = inputsOf(trace).at(-1);
  const target = last ? last.value.trim() : '';
  const final = calls.filter((q) => q === target).length;
  return {
    trace: trace.id,
    group: trace.group,
    debounceMs,
    total: calls.length,
    final,
    partial: calls.length - final,
  };
}

const rows: Row[] = [];

describe('@mapslibvn/web — số lượt Places cho một phiên gõ thật', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  afterAll(() => {
    if (!process.env.MEASURE_WRITE) return;
    mkdirSync(DIR, { recursive: true });
    writeFileSync(
      `${DIR}/2026-09-15-counts-web.json`,
      `${JSON.stringify({ package: '@mapslibvn/web', rows }, null, 2)}\n`,
    );
  });

  for (const trace of file.traces) {
    it(`${trace.id}: số lượt không tăng khi debounce tăng`, async () => {
      const measured: Row[] = [];
      for (const debounceMs of LEVELS) measured.push(await replay(trace, debounceMs));
      rows.push(...measured);
      console.log(
        `${trace.id.padEnd(22)} ${measured.map((r) => `${r.debounceMs}ms=${r.total}`).join('  ')}`,
      );
      for (let i = 1; i < measured.length; i++) {
        const before = measured[i - 1];
        const after = measured[i];
        if (!before || !after) throw new Error('thiếu mức đo');
        expect(after.total, `${trace.id} ${after.debounceMs}ms`).toBeLessThanOrEqual(before.total);
      }
    });
  }
});
```

- [ ] **Step 2: Chạy ở chế độ ghi**

Chạy: `MEASURE_WRITE=1 pnpm vitest run packages/web/src/debounce-trace.test.ts`
Kỳ vọng: PASS, tạo `2026-09-15-counts-web.json`.

- [ ] **Step 3: Thêm bài chứng minh ba bản khớp nhau ở 200 ms**

Đây là bài quan trọng nhất của task: nó cho phép suy kết luận của `react` sang web ở các mức
`react` đo được mà web không. Thêm vào cuối describe:

```ts
  it('ở 200 ms, web ra đúng cùng số lượt với react và react-native', () => {
    const reactRows = JSON.parse(
      readFileSync(`${DIR}/2026-09-15-counts-react.json`, 'utf8'),
    ) as { rows: Row[] };
    const nativeRows = JSON.parse(
      readFileSync(`${DIR}/2026-09-15-counts-react-native.json`, 'utf8'),
    ) as { rows: Row[] };
    const at = (source: Row[], id: string) =>
      source.find((r) => r.trace === id && r.debounceMs === 200)?.total;

    for (const trace of file.traces) {
      const web = at(rows, trace.id);
      expect(web, `${trace.id} web`).toBeDefined();
      expect(at(reactRows.rows, trace.id), `${trace.id} react`).toBe(web);
      expect(at(nativeRows.rows, trace.id), `${trace.id} react-native`).toBe(web);
    }
  });
```

Nếu bài này đỏ: **không được sửa cho nó xanh.** Ba bản lệch nhau ở cùng một trace là một phát hiện
thật, phải ghi vào kết luận và tìm nguyên nhân trước khi đi tiếp.

- [ ] **Step 4: Chạy lại không cờ, typecheck, lint**

Chạy: `pnpm vitest run packages/web/src/debounce-trace.test.ts && pnpm typecheck && pnpm lint`
Kỳ vọng: xanh cả ba.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/debounce-trace.test.ts docs/evidence/autocomplete-debounce/2026-09-15-counts-web.json
git commit -m "test(web): đếm lượt Places khi phát lại trace gõ thật, đối chiếu ba gói ở 200 ms"
```

---

### Task 7: Gộp báo cáo và viết kết luận

**Files:**
- Create: `scripts/debounce-report.mjs`
- Create: `docs/evidence/autocomplete-debounce/2026-09-15-do-luot-autocomplete.md`
- Modify: `package.json` (thêm script)

- [ ] **Step 1: Viết bộ gộp**

`scripts/debounce-report.mjs` — chỉ đọc JSON và in markdown, không import mã `.ts` nào:

```js
import { readFileSync } from 'node:fs';

/** @typedef {{trace:string, group:string, debounceMs:number, total:number, final:number, partial:number}} Row */

const DIR = 'docs/evidence/autocomplete-debounce';
const LEVELS = [200, 300, 500, 800];
const PACKAGES = [
  ['@mapslibvn/react', `${DIR}/2026-09-15-counts-react.json`],
  ['@mapslibvn/react-native', `${DIR}/2026-09-15-counts-react-native.json`],
  ['@mapslibvn/web', `${DIR}/2026-09-15-counts-web.json`],
];

/** @param {string} path */
const load = (path) => /** @type {{rows:Row[]}} */ (JSON.parse(readFileSync(path, 'utf8'))).rows;
/** @param {number[]} values */
const sum = (values) => values.reduce((a, b) => a + b, 0);

for (const [name, path] of PACKAGES) {
  const rows = load(path);
  const traceIds = [...new Set(rows.map((r) => r.trace))];
  console.log(`\n### ${name}\n`);
  console.log(`| Kịch bản | ${LEVELS.map((ms) => `${ms} ms`).join(' | ')} |`);
  console.log(`|---|${LEVELS.map(() => '---:').join('|')}|`);
  for (const id of traceIds) {
    const cells = LEVELS.map((ms) => {
      const row = rows.find((r) => r.trace === id && r.debounceMs === ms);
      return row ? `${row.total} (${row.partial} dở dang)` : '—';
    });
    console.log(`| \`${id}\` | ${cells.join(' | ')} |`);
  }
  const totals = LEVELS.map((ms) => sum(rows.filter((r) => r.debounceMs === ms).map((r) => r.total)));
  console.log(`| **Tổng 14 kịch bản** | ${totals.map((n) => `**${n}**`).join(' | ')} |`);
  const first = totals[0];
  if (first !== undefined && first > 0) {
    const saved = LEVELS.map((ms, i) => {
      const value = totals[i];
      return value === undefined ? '—' : `${ms} ms: ${Math.round((1 - value / first) * 100)}%`;
    });
    console.log(`\nGiảm so với 200 ms — ${saved.join(', ')}.`);
  }
}
```

- [ ] **Step 2: Thêm script vào `package.json`**

Cạnh `"perf:size"`, thêm:

```json
    "debounce:report": "node scripts/debounce-report.mjs",
```

- [ ] **Step 3: Chạy và kiểm tra đầu ra**

Chạy: `pnpm debounce:report`
Kỳ vọng: in ba bảng markdown, mỗi bảng 14 dòng cộng một dòng tổng, không có ô `—` nào.
Ô `—` nghĩa là thiếu mức đo — quay lại task tương ứng, đừng viết kết luận trên dữ liệu thủng.

- [ ] **Step 4: Viết kết luận**

Tạo `docs/evidence/autocomplete-debounce/2026-09-15-do-luot-autocomplete.md` gồm:

1. **Câu trả lời**, ba dòng: hiện tốn bao nhiêu lượt ở 200 ms, còn bao nhiêu ở 500 ms, bao nhiêu phần trăm là chuỗi dở dang.
2. **Cách đo**: trỏ tới spec, nói rõ một lượt = một lời gọi `client.autocomplete`, và vì `get()` của core chưa nhận `signal` nên mỗi lời gọi là một lượt máy chủ tính tiền thật.
3. **Ba bảng** dán từ `pnpm debounce:report`.
4. **Ba bản có khớp nhau ở 200 ms không** — dẫn bài test ở Task 6 Step 3.
5. **Giới hạn** — chép đủ bốn mục ở mục 8 của spec, không bớt mục nào.
6. **Chưa kết luận điều gì**: chưa chốt đổi debounce mặc định; đó là quyết định riêng, cần cân với độ trễ thêm vào (đúng bằng chênh lệch debounce) và phải do PHONG chốt.

Chỉ viết những con số đọc được từ ba tệp `counts-*.json`. Không làm tròn theo hướng có lợi,
không suy ra con số cho tình huống chưa đo.

- [ ] **Step 5: Chạy toàn bộ test**

Chạy: `pnpm test`
Kỳ vọng: xanh. Đây là lần chạy đầu tiên có cả bốn tệp test mới cùng lúc — nếu tệp
`counts-*.json` bị ghi đè ngoài ý muốn thì `git status` sẽ lộ ra, kiểm tra luôn.

- [ ] **Step 6: Cập nhật DEVLOG**

Thêm một mục vào `docs/DEVLOG.md` theo đúng văn phong các mục sẵn có: ngày, việc đã đo, kết luận
một câu, và trỏ tới tệp kết luận.

- [ ] **Step 7: Commit**

```bash
git add scripts/debounce-report.mjs package.json docs/evidence/autocomplete-debounce/2026-09-15-do-luot-autocomplete.md docs/DEVLOG.md
git commit -m "docs(evidence): kết luận phép đo số lượt Places của autocomplete"
```

---

## Sau khi xong

Ba việc đã tách ra khỏi phạm vi kế hoạch này, mỗi việc một vòng spec/plan riêng, và chỉ quyết sau
khi PHONG đọc kết luận:

1. Thêm `signal` vào `get()` của core rồi nối `AbortController` vào ba nơi gọi — đây mới là thứ thật
   sự cắt lượt tính tiền, vì hiện tại "huỷ request cũ" không huỷ gì ở phía máy chủ.
2. Bỏ qua sự kiện khi bàn phím đang ghép chữ. Trace đã ghi sẵn mốc composition ở Task 2 nên không
   phải bắt ai gõ lại.
3. Đổi giá trị debounce mặc định của cả ba gói.
