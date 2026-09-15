# Huỷ request autocomplete cũ ở phía mạng — Kế hoạch thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khi một truy vấn autocomplete bị truy vấn mới hơn thay thế, huỷ request HTTP thật ở tầng
mạng bằng `AbortController`, không chỉ bỏ qua kết quả ở client như hiện tại.

**Architecture:** `get()`/`autocomplete()` trong core nhận thêm `signal?: AbortSignal` (cộng thêm,
không phá vỡ chữ ký cũ). `usePlaces()` (react + react-native) và `<mapslibvn-autocomplete>` tự tạo
`AbortController` mỗi lần bắt đầu một truy vấn, và gọi `controller.abort()` đúng tại mọi chỗ đã có
sẵn logic "vô hiệu hoá truy vấn cũ" (`cancelled = true` / `this.#seq++`) — cùng một nhịp đồng bộ,
nên guard đang có tự che `AbortError` mà không cần thêm nhánh bắt lỗi riêng.

**Tech Stack:** TypeScript, vitest (fake timers, jsdom), `@testing-library/react`, `AbortController`/
`AbortSignal` (global có sẵn trong jsdom 25 và Node runtime hiện dùng).

**Spec:** `docs/superpowers/specs/2026-09-15-abort-autocomplete-design.md`

---

## Bố cục tệp

| Tệp | Việc |
|---|---|
| `packages/core/src/client.ts` | *Sửa* — `get()` nhận `init?.signal`, `autocomplete()` nhận `signal` trong opts |
| `packages/core/src/client.autocomplete-abort.test.ts` | *Tạo* — `signal` được forward tới `fetch` |
| `packages/react/src/use-places.ts` | *Sửa* — tạo `AbortController`, abort trong cleanup |
| `packages/react/src/use-places.test.ts` | *Sửa* — cập nhật 2 assertion cũ, thêm 2 test mới |
| `packages/react-native/src/use-places.ts` | *Sửa* — giống hệt bản react |
| `packages/react-native/src/use-places.test.ts` | *Sửa* — giống ý bản react (nội dung tệp khác đôi chỗ) |
| `packages/web/src/autocomplete-element.ts` | *Sửa* — field `#abortController`, helper `#cancelPending()`, 7 chỗ gọi, `#query()` |
| `packages/web/src/autocomplete-element.test.ts` | *Sửa* — thêm describe block mới |
| `apps/docs/src/content/docs/sdk.md` | *Sửa* — thêm `signal` vào bảng opts |
| `docs/DEVLOG.md` | *Sửa* — một mục mới |

Hai gói `react`/`react-native` sửa **giống hệt nhau về mã** (giữ tính đồng nhất đã xác nhận trước
đó), nhưng tệp test của chúng vốn **không** giống hệt nhau (react-native thiếu bài "giữ profile
nguồn của client" dùng `createClient` thật) — vị trí chèn khác nhau, Task 3 ghi rõ theo đúng tệp
thật của react-native, không suy từ Task 2.

---

### Task 1: Core — `signal` huỷ request

**Files:**
- Modify: `packages/core/src/client.ts:101-140`
- Create: `packages/core/src/client.autocomplete-abort.test.ts`

- [ ] **Step 1: Viết test đỏ**

```ts
import { describe, expect, it } from 'vitest';
import { createClient } from './client';

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

function stubClient(body: unknown) {
  const fetch = vi.fn(async () => jsonResponse(body));
  const client = createClient({
    apiKey: 'mlv_live_test00000000000000000000',
    baseUrl: 'https://api.test',
    fetch: fetch as unknown as typeof globalThis.fetch,
  });
  const calledInit = () => (fetch.mock.calls[0] as unknown[])[1] as RequestInit;
  return { client, calledInit };
}

describe('client autocomplete — signal huỷ request', () => {
  it('truyền signal xuống RequestInit khi có', async () => {
    const controller = new AbortController();
    const { client, calledInit } = stubClient({ items: [] });
    await client.autocomplete('highlands', { signal: controller.signal });
    expect(calledInit().signal).toBe(controller.signal);
  });

  it('không truyền signal thì RequestInit không có signal', async () => {
    const { client, calledInit } = stubClient({ items: [] });
    await client.autocomplete('highlands');
    expect(calledInit().signal).toBeUndefined();
  });
});
```

Tệp thiếu `import { vi } from 'vitest'` — sửa dòng import thành:
`import { describe, expect, it, vi } from 'vitest';`

- [ ] **Step 2: Chạy để xác nhận đỏ đúng chỗ**

Chạy: `pnpm vitest run packages/core/src/client.autocomplete-abort.test.ts`
Kỳ vọng: bài 1 ("truyền signal...") FAIL vì `calledInit().signal` là `undefined`, không phải
`controller.signal`. Bài 2 ("không truyền signal...") PASS ngay — đây là hành vi đã đúng từ trước,
không phải lỗi của bài test.

- [ ] **Step 3: Sửa `client.ts`**

Thay `get()`:

```ts
  async function get<T>(
    path: string,
    params: Record<string, string | number | undefined> = {},
    init?: { signal?: AbortSignal },
  ): Promise<T> {
    const url = new URL(baseUrl + path);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const response = await doFetch(url, {
      headers: baseHeaders(),
      ...(init?.signal ? { signal: init.signal } : {}),
    });
    return parseOrThrow<T>(response);
  }
```

Thay `autocomplete` trong object trả về:

```ts
    autocomplete: (
      q: string,
      opts: {
        near?: [number, number];
        limit?: number;
        types?: AutocompleteType[];
        signal?: AbortSignal;
      } = {},
    ) =>
      get<{ items: AutocompleteItem[] }>(
        '/v1/autocomplete',
        { q, near: opts.near?.join(','), limit: opts.limit, types: opts.types?.join(','), sources },
        { signal: opts.signal },
      ),
```

Không đổi `search`/`nearby`/`geocode`/`reverse`/`directions`/`getPlace`/`attribution` — chúng vẫn
gọi `get()` với 2 tham số như cũ, `init` là optional nên không vỡ.

- [ ] **Step 4: Chạy lại, kỳ vọng xanh**

Chạy: `pnpm vitest run packages/core/src/client.autocomplete-abort.test.ts`
Kỳ vọng: PASS cả 2 bài.

- [ ] **Step 5: Chạy toàn bộ test của gói core, không chỉ tệp mới**

Chạy: `pnpm vitest run packages/core/src`
Kỳ vọng: PASS toàn bộ — đặc biệt `client.test.ts`, `client.places.test.ts`,
`client.directions.test.ts`, `client.edits.test.ts` không đổi hành vi vì `init` là optional.

- [ ] **Step 6: Typecheck gói core**

Chạy: `pnpm --filter @mapslibvn/core build && pnpm --filter @mapslibvn/core typecheck`
Kỳ vọng: xanh. (`build` trước vì các gói khác import kiểu từ `dist` của core — xem
`tsconfig.scripts.json`/turbo pipeline; Task 2–4 phụ thuộc bản build mới này.)

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/client.ts packages/core/src/client.autocomplete-abort.test.ts
git commit -m "feat(core): autocomplete() nhận signal để huỷ request ở tầng mạng"
```

---

### Task 2: `@mapslibvn/react` — `usePlaces()` tự huỷ request cũ

**Files:**
- Modify: `packages/react/src/use-places.ts` (toàn bộ thân hàm `usePlaces`)
- Modify: `packages/react/src/use-places.test.ts`

- [ ] **Step 1: Cập nhật 2 assertion cũ và thêm 2 test mới**

Trong `packages/react/src/use-places.test.ts`, thay dòng:

```ts
    expect(client.autocomplete).toHaveBeenCalledWith('highlands', { near: [10.776, 106.7] });
```

thành:

```ts
    expect(client.autocomplete).toHaveBeenCalledWith(
      'highlands',
      expect.objectContaining({ near: [10.776, 106.7], signal: expect.any(AbortSignal) }),
    );
```

Thay dòng:

```ts
    expect(client.autocomplete).toHaveBeenCalledWith('highlands', {});
```

thành:

```ts
    expect(client.autocomplete).toHaveBeenCalledWith(
      'highlands',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
```

Thêm hai bài mới vào cuối describe (trước dấu `});` đóng `describe('usePlaces', ...)`):

```ts
  it('request cũ bị huỷ ở mạng khi query đổi trước khi nó xong', async () => {
    const signals: AbortSignal[] = [];
    const client = {
      autocomplete: vi.fn((_query: string, opts: { signal?: AbortSignal }) => {
        if (opts.signal) signals.push(opts.signal);
        return new Promise<{ items: AutocompleteItem[] }>(() => {});
      }),
    } as unknown as MapsLibVNClient;
    const { rerender } = renderHook(({ query }) => usePlaces(query, { client }), {
      initialProps: { query: 'high' },
    });
    await advance(200);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);

    rerender({ query: 'highlands' });
    await advance(200);
    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });

  it('unmount huỷ request đang chờ ở mạng', async () => {
    const signals: AbortSignal[] = [];
    const client = {
      autocomplete: vi.fn((_query: string, opts: { signal?: AbortSignal }) => {
        if (opts.signal) signals.push(opts.signal);
        return new Promise<{ items: AutocompleteItem[] }>(() => {});
      }),
    } as unknown as MapsLibVNClient;
    const { unmount } = renderHook(() => usePlaces('highlands', { client }));
    await advance(200);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);
    unmount();
    expect(signals[0]?.aborted).toBe(true);
  });
```

- [ ] **Step 2: Chạy để xác nhận đỏ**

Chạy: `pnpm vitest run packages/react/src/use-places.test.ts`
Kỳ vọng: FAIL ở 4 bài — 2 assertion vừa sửa (vì call thật chưa có field `signal`) và 2 bài mới
(vì `signals` rỗng, hook chưa tạo `AbortController`). Các bài còn lại (không liên quan `signal`)
vẫn PASS.

- [ ] **Step 3: Sửa `use-places.ts`**

Thay toàn bộ thân `useEffect`:

```ts
  useEffect(() => {
    const normalizedQuery = query.trim();
    if (!client || normalizedQuery.length < 2) {
      setItems([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const timer = setTimeout(async () => {
      try {
        const requestOptions: {
          near?: [number, number];
          limit?: number;
          signal: AbortSignal;
        } = { signal: controller.signal };
        if (nearKey) requestOptions.near = nearKey.split(',').map(Number) as [number, number];
        if (options.limit !== undefined) requestOptions.limit = options.limit;
        const response = await client.autocomplete(normalizedQuery, requestOptions);
        if (!cancelled) setItems(response.items);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause : new Error('Không thể tải gợi ý'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, options.debounceMs ?? 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [client, query, nearKey, options.limit, options.debounceMs]);
```

- [ ] **Step 4: Chạy lại toàn bộ tệp, kỳ vọng xanh**

Chạy: `pnpm vitest run packages/react/src/use-places.test.ts`
Kỳ vọng: PASS toàn bộ (9 bài — 7 cũ + 2 mới).

- [ ] **Step 5: Typecheck gói react**

Chạy: `pnpm --filter @mapslibvn/react typecheck`
Kỳ vọng: xanh.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/use-places.ts packages/react/src/use-places.test.ts
git commit -m "feat(react): usePlaces() huỷ request autocomplete cũ ở tầng mạng"
```

---

### Task 3: `@mapslibvn/react-native` — mirror của Task 2

**Files:**
- Modify: `packages/react-native/src/use-places.ts` (giống hệt Task 2 Step 3)
- Modify: `packages/react-native/src/use-places.test.ts`

- [ ] **Step 1: Cập nhật 2 assertion cũ và thêm 2 test mới**

Tệp test của react-native **không giống hệt** bản react (thiếu bài "giữ profile nguồn của client"
dùng `createClient` thật) nên áp đúng theo nội dung thật của tệp này, không suy từ Task 2.

Thay dòng:

```ts
    expect(client.autocomplete).toHaveBeenCalledWith('highlands', { near: [10.776, 106.7] });
```

thành:

```ts
    expect(client.autocomplete).toHaveBeenCalledWith(
      'highlands',
      expect.objectContaining({ near: [10.776, 106.7], signal: expect.any(AbortSignal) }),
    );
```

Thay dòng:

```ts
    expect(client.autocomplete).toHaveBeenCalledWith('highlands', {});
```

thành:

```ts
    expect(client.autocomplete).toHaveBeenCalledWith(
      'highlands',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
```

Thêm hai bài mới vào cuối describe (trước dấu `});` đóng `describe('usePlaces', ...)`) — **y hệt**
hai bài đã thêm ở Task 2 Step 1 (không có gì khác biệt giữa hai gói ở phần test mới này):

```ts
  it('request cũ bị huỷ ở mạng khi query đổi trước khi nó xong', async () => {
    const signals: AbortSignal[] = [];
    const client = {
      autocomplete: vi.fn((_query: string, opts: { signal?: AbortSignal }) => {
        if (opts.signal) signals.push(opts.signal);
        return new Promise<{ items: AutocompleteItem[] }>(() => {});
      }),
    } as unknown as MapsLibVNClient;
    const { rerender } = renderHook(({ query }) => usePlaces(query, { client }), {
      initialProps: { query: 'high' },
    });
    await advance(200);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);

    rerender({ query: 'highlands' });
    await advance(200);
    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });

  it('unmount huỷ request đang chờ ở mạng', async () => {
    const signals: AbortSignal[] = [];
    const client = {
      autocomplete: vi.fn((_query: string, opts: { signal?: AbortSignal }) => {
        if (opts.signal) signals.push(opts.signal);
        return new Promise<{ items: AutocompleteItem[] }>(() => {});
      }),
    } as unknown as MapsLibVNClient;
    const { unmount } = renderHook(() => usePlaces('highlands', { client }));
    await advance(200);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);
    unmount();
    expect(signals[0]?.aborted).toBe(true);
  });
```

- [ ] **Step 2: Chạy để xác nhận đỏ**

Chạy: `pnpm vitest run packages/react-native/src/use-places.test.ts`
Kỳ vọng: FAIL ở 4 bài, cùng lý do như Task 2 Step 2.

- [ ] **Step 3: Sửa `use-places.ts`**

Thay toàn bộ thân `useEffect` — **y hệt** đoạn mã ở Task 2 Step 3 (tệp này hiện giống hệt bản react
byte-for-byte, giữ nguyên tính chất đó):

```ts
  useEffect(() => {
    const normalizedQuery = query.trim();
    if (!client || normalizedQuery.length < 2) {
      setItems([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const timer = setTimeout(async () => {
      try {
        const requestOptions: {
          near?: [number, number];
          limit?: number;
          signal: AbortSignal;
        } = { signal: controller.signal };
        if (nearKey) requestOptions.near = nearKey.split(',').map(Number) as [number, number];
        if (options.limit !== undefined) requestOptions.limit = options.limit;
        const response = await client.autocomplete(normalizedQuery, requestOptions);
        if (!cancelled) setItems(response.items);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause : new Error('Không thể tải gợi ý'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, options.debounceMs ?? 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [client, query, nearKey, options.limit, options.debounceMs]);
```

- [ ] **Step 4: Xác nhận hai tệp `use-places.ts` vẫn giống hệt nhau**

Chạy: `diff packages/react/src/use-places.ts packages/react-native/src/use-places.ts`
Kỳ vọng: không in gì ra (exit code 0) — đúng tính chất đã có từ trước khi bắt đầu việc này.

- [ ] **Step 5: Chạy lại toàn bộ tệp, kỳ vọng xanh**

Chạy: `pnpm vitest run packages/react-native/src/use-places.test.ts`
Kỳ vọng: PASS toàn bộ.

- [ ] **Step 6: Typecheck gói react-native**

Chạy: `pnpm --filter @mapslibvn/react-native typecheck`
Kỳ vọng: xanh.

- [ ] **Step 7: Commit**

```bash
git add packages/react-native/src/use-places.ts packages/react-native/src/use-places.test.ts
git commit -m "feat(react-native): usePlaces() huỷ request autocomplete cũ ở tầng mạng"
```

---

### Task 4: `@mapslibvn/web` — `<mapslibvn-autocomplete>` tự huỷ request cũ

**Files:**
- Modify: `packages/web/src/autocomplete-element.ts`
- Modify: `packages/web/src/autocomplete-element.test.ts`

- [ ] **Step 1: Viết describe block mới, đỏ**

Thêm vào cuối `packages/web/src/autocomplete-element.test.ts`:

```ts
describe('MapsLibVNAutocomplete — huỷ request cũ ở mạng', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    autocomplete.mockReset();
    document.body.replaceChildren();
  });

  function mount() {
    const element = new MapsLibVNAutocomplete();
    element.setAttribute('api-key', 'mlv_test');
    element.setAttribute('api-base', 'https://api.test');
    document.body.append(element);
    const input = element.shadowRoot?.querySelector('input');
    if (!input) throw new Error('không dựng được input');
    return input;
  }

  function typeInto(input: HTMLInputElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  it('request cũ bị huỷ ở mạng khi gõ tiếp trước khi nó xong', async () => {
    const signals: AbortSignal[] = [];
    autocomplete.mockImplementation((_q: string, opts: { signal?: AbortSignal }) => {
      if (opts?.signal) signals.push(opts.signal);
      return new Promise(() => {});
    });
    const input = mount();
    typeInto(input, 'ben thanh');
    await vi.advanceTimersByTimeAsync(200);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);

    typeInto(input, 'ben thanh q1');
    await vi.advanceTimersByTimeAsync(200);
    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });

  it('Escape huỷ request đang chờ ở mạng', async () => {
    const signals: AbortSignal[] = [];
    autocomplete.mockImplementation((_q: string, opts: { signal?: AbortSignal }) => {
      if (opts?.signal) signals.push(opts.signal);
      return new Promise(() => {});
    });
    const input = mount();
    typeInto(input, 'ben thanh');
    await vi.advanceTimersByTimeAsync(200);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(signals[0]?.aborted).toBe(true);
  });
});
```

- [ ] **Step 2: Chạy để xác nhận đỏ**

Chạy: `pnpm vitest run packages/web/src/autocomplete-element.test.ts -t "huỷ request cũ ở mạng"`
Kỳ vọng: FAIL cả 2 bài — `signals` rỗng vì `#query()` chưa truyền `signal`.

- [ ] **Step 3: Sửa `autocomplete-element.ts`**

Thêm field, ngay sau `#seq = 0;`:

```ts
  #seq = 0;
  #abortController: AbortController | undefined;
```

Thêm helper, ngay trước `#near()`:

```ts
  /** Vô hiệu hoá truy vấn đang chờ: tăng seq (che kết quả trễ) và huỷ request đang bay ra mạng. */
  #cancelPending(): void {
    this.#seq++;
    this.#abortController?.abort();
  }
```

Đổi 7 chỗ `this.#seq++` thành `this.#cancelPending()` — **không đổi** dòng `const seq = ++this.#seq;`
trong `#query()` (đó là gán số hiệu cho lần chạy hiện tại, không phải vô hiệu hoá):

1. Trong setter `map`:
```ts
  set map(value: NearSource | null) {
    if (value === this.#map) return;
    this.#map = value;
    clearTimeout(this.#timer);
    this.#cancelPending();
    this.#render([]);
  }
```

2. Trong `disconnectedCallback`:
```ts
  disconnectedCallback() {
    clearTimeout(this.#timer);
    this.#cancelPending();
    this.#input?.removeEventListener('input', this.#onInput);
    this.#input?.removeEventListener('keydown', this.#onKeydown);
    this.#input?.removeEventListener('blur', this.#onBlur);
    this.#list?.removeEventListener('pointerdown', this.#onPointerDown);
    this.#input = null;
    this.#list = null;
    this.#status = null;
  }
```

3. Trong `attributeChangedCallback`:
```ts
  attributeChangedCallback(name: string) {
    if (name === 'api-key' || name === 'api-base' || name === 'sources') {
      this.#client = null;
      this.#cancelPending();
    }
    if (name === 'placeholder' && this.#input)
      this.#input.placeholder = this.getAttribute('placeholder') ?? 'Tìm địa điểm…';
  }
```

4. Trong `#onInput` (hai chỗ):
```ts
  #onInput = () => {
    clearTimeout(this.#timer);
    this.#cancelPending();
    const value = this.#input?.value ?? '';
    if (value.trim().length < 2) {
      this.#cancelPending();
      this.#render([]);
      this.#announce('');
      return;
    }
    this.#announce('Đang tìm…');
    this.#timer = setTimeout(() => void this.#query(value), this.#debounceMs());
  };
```

5. Trong `#onBlur`:
```ts
  #onBlur = () => {
    this.#cancelPending();
    this.#timer = setTimeout(() => this.#render([]), 150);
  };
```

6. Trong `#onKeydown` (nhánh Escape):
```ts
  #onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      clearTimeout(this.#timer);
      this.#cancelPending();
      this.#render([]);
      return;
    }
    if (this.#items.length === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
```

(giữ nguyên toàn bộ phần còn lại của `#onKeydown` sau dòng này, không đổi)

7. Trong `#query()` — tạo controller mới, gán vào field, thêm `signal` khi gọi client:

```ts
  async #query(raw: string) {
    const query = raw.trim();
    const client = this.#getClient();
    if (!client || query.length < 2) {
      this.#render([]);
      this.#announce(client ? '' : 'Thiếu cấu hình API.');
      return;
    }
    const seq = ++this.#seq;
    const controller = new AbortController();
    this.#abortController = controller;
    try {
      const near = this.#near();
      const { items } = await client.autocomplete(query, {
        ...(near ? { near } : {}),
        signal: controller.signal,
      });
      if (seq !== this.#seq) return;
      this.#render(items);
      this.#announce(items.length > 0 ? `Có ${items.length} kết quả.` : 'Không tìm thấy kết quả.');
    } catch {
      if (seq !== this.#seq) return;
      this.#render([]);
      this.#announce('Không thể tải gợi ý. Vui lòng thử lại.');
    }
  }
```

- [ ] **Step 4: Chạy lại toàn bộ tệp, kỳ vọng xanh**

Chạy: `pnpm vitest run packages/web/src/autocomplete-element.test.ts`
Kỳ vọng: PASS toàn bộ (17 bài — 15 cũ từ trước, kể cả describe "attribute debounce" của việc
trước, cộng 2 bài mới).

- [ ] **Step 5: Typecheck và lint gói web**

Chạy: `pnpm --filter @mapslibvn/web typecheck && npx biome check packages/web/src`
Kỳ vọng: xanh cả hai.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/autocomplete-element.ts packages/web/src/autocomplete-element.test.ts
git commit -m "feat(web): mapslibvn-autocomplete huỷ request autocomplete cũ ở tầng mạng"
```

---

### Task 5: Docs, kiểm tra toàn repo, DEVLOG

**Files:**
- Modify: `apps/docs/src/content/docs/sdk.md`
- Modify: `docs/DEVLOG.md`

- [ ] **Step 1: Cập nhật bảng opts trong `sdk.md`**

Tìm dòng:

```
| `autocomplete` | `near`, `limit`, `types` |
```

Đổi thành:

```
| `autocomplete` | `near`, `limit`, `types`, `signal` |
```

Ngay dưới bảng đó (trước câu "Lưu ý về thứ tự toạ độ..."), thêm một đoạn:

```
`signal` là `AbortSignal` phía client để huỷ request đang bay — không giống các trường còn lại
trong bảng, nó không phải tham số gửi lên server và không xuất hiện trong query string.
```

- [ ] **Step 2: Typecheck và lint toàn repo**

Chạy: `pnpm typecheck && pnpm lint`
Kỳ vọng: `pnpm typecheck` xanh tuyệt đối. `pnpm lint` có thể báo lỗi đã có sẵn từ trước ở
`docs/evidence/capacity/2026-09-15-probe.mjs` (script scratch của việc khác, không thuộc phạm vi
việc này) — xác nhận bằng cách chạy riêng
`npx biome check packages/core/src packages/react/src packages/react-native/src packages/web/src`
và kỳ vọng lệnh đó sạch tuyệt đối (0 lỗi), vì đó là toàn bộ phạm vi tệp `.ts` mà kế hoạch này đụng
tới.

- [ ] **Step 3: Chạy toàn bộ test**

Chạy: `pnpm test`
Kỳ vọng: xanh toàn bộ. Tổng số bài test tăng thêm đúng **8** so với trước khi bắt đầu Task 1: 2 ở
`client.autocomplete-abort.test.ts` (mới), 2 ở `use-places.test.ts` của react (mới — không tính 2
assertion cũ được sửa, số bài giữ nguyên ở đó), 2 ở `use-places.test.ts` của react-native (mới,
cùng lý do), 2 ở `autocomplete-element.test.ts` (mới).

- [ ] **Step 4: Thêm mục DEVLOG**

Trước khi sửa, kiểm tra xem `docs/DEVLOG.md` có đang dở dang việc khác không (từng gặp việc quota
song song khi làm plan đo debounce trước đó):

```bash
git status --short docs/DEVLOG.md
```

Nếu có thay đổi chưa commit (dở dang của việc khác), cất tạm trước khi sửa:

```bash
git stash push -m "devlog dở dang - tạm cất trước khi thêm mục abort autocomplete" -- docs/DEVLOG.md
```

Thêm vào đầu mục `## 1. Trạng thái hiện tại` trong `docs/DEVLOG.md`:

```
- **15/09/2026 — Huỷ request autocomplete cũ ở tầng mạng bằng AbortController.** Theo
  [kết luận đo debounce](evidence/autocomplete-debounce/2026-09-15-do-luot-autocomplete.md)
  (94% lượt ở 200ms là dở dang nhưng vẫn tốn tiền thật vì "huỷ" cũ chỉ bỏ qua kết quả ở client).
  `client.autocomplete()` nhận thêm `signal?: AbortSignal` (cộng thêm, không đổi chữ ký cũ);
  `usePlaces()` (react + react-native) và `<mapslibvn-autocomplete>` tự tạo và huỷ
  `AbortController` tại mọi chỗ đã có sẵn logic vô hiệu hoá truy vấn cũ. Không đổi
  `search`/`nearby`/`geocode`/`reverse`/`directions`, không đổi giá trị debounce mặc định.
```

Nếu bước cất tạm ở trên có chạy: sau khi commit xong (Step 5), phục hồi bằng
`git stash pop`, xử lý conflict (nếu có) bằng cách giữ **cả hai** khối nội dung — xoá marker
`<<<<<<<`/`=======`/`>>>>>>>`, không xoá nội dung của bên nào — rồi
`git restore --staged docs/DEVLOG.md` để trả về đúng trạng thái "đang sửa dở, chưa commit" như
trước khi cất tạm.

- [ ] **Step 5: Commit**

```bash
git add apps/docs/src/content/docs/sdk.md docs/DEVLOG.md
git commit -m "docs: signal huỷ request cho autocomplete() và ghi DEVLOG"
```

---

## Sau khi xong

Ba việc đã tách khỏi phạm vi kế hoạch này (theo mục 9 của spec):

1. `search`/`nearby`/`geocode`/`reverse`/`directions` không nhận `signal` — chỉ mở rộng nếu có nhu
   cầu cụ thể sau này.
2. Đổi giá trị debounce mặc định của cả ba gói — quyết định riêng của PHONG, còn treo từ
   `docs/evidence/autocomplete-debounce/2026-09-15-do-luot-autocomplete.md` mục 7.
3. Xử lý sự kiện khi IME đang ghép chữ — thiếu dữ liệu thật để thiết kế, xem cùng tài liệu mục 7.
