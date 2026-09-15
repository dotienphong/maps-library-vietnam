# Đặc tả: huỷ request autocomplete cũ ở phía mạng bằng AbortController

Ngày: 15/09/2026. PHONG duyệt thiết kế trong phiên brainstorm cùng ngày, sau khi
`docs/evidence/autocomplete-debounce/2026-09-15-do-luot-autocomplete.md` cho thấy ở debounce
200 ms, 94% trong 238 lượt Places đo được là chuỗi dở dang — nhưng vẫn tốn tiền thật, vì hiện
"huỷ request cũ" chỉ là bỏ qua kết quả ở client, request vẫn bay tới máy chủ.

## 1. Mục tiêu và phạm vi

Khi một truy vấn autocomplete bị một truy vấn mới hơn thay thế (gõ tiếp, đổi map, huỷ ô tìm kiếm,
component unmount), request HTTP của truy vấn cũ phải bị huỷ thật ở tầng mạng (`fetch`
`AbortController`), không chỉ bị bỏ qua kết quả trả về. Mục tiêu là giảm số lượt máy chủ thật sự
xử lý và tính tiền, không chỉ giảm số lần UI cập nhật.

Trong phạm vi: `packages/core/src/client.ts` (`get()`, `autocomplete()`), `usePlaces()` của
`@mapslibvn/react` và `@mapslibvn/react-native`, `<mapslibvn-autocomplete>` của `@mapslibvn/web`,
test cho cả bốn, và cập nhật bảng tham số trong `apps/docs/src/content/docs/sdk.md`.

Ngoài phạm vi: `search`/`nearby`/`geocode`/`reverse`/`directions` (quyết định của PHONG khi duyệt —
chỉ `autocomplete` là nơi có bằng chứng đo được); API `cancel()` thủ công cho app developer; bump
version SDK; đổi giá trị debounce mặc định của bất kỳ gói nào (quyết định riêng, còn treo từ
`docs/evidence/autocomplete-debounce/2026-09-15-do-luot-autocomplete.md` mục 7).

## 2. Hiện trạng đã kiểm tra

- `packages/core/src/client.ts:101-113` — `get()` không nhận `signal`; mọi method (kể cả
  `autocomplete`) gọi `doFetch(url, { headers: baseHeaders() })`, không có chỗ nào truyền
  `AbortSignal` xuống.
- `packages/react/src/use-places.ts:31-59` — hiệu ứng dùng cờ `cancelled` (đóng trong closure của
  effect) để chặn `setState` từ một lần chạy đã lỗi thời; cleanup (`:56-59`) chỉ `cancelled = true`
  và `clearTimeout(timer)` — không huỷ request đã bay ra mạng.
- `packages/react-native/src/use-places.ts` — xác nhận bằng `diff`: giống hệt byte-for-byte bản
  react ở trên (đã xác nhận lại trong phiên đo debounce 15/09). Đổi phải đổi cả hai, giữ nguyên
  tính đồng nhất này.
- `packages/web/src/autocomplete-element.ts` — dùng bộ đếm `#seq` để vô hiệu hoá. 7 chỗ tăng
  `this.#seq++` để đánh dấu vô hiệu hoá: `:73` (setter `map`), `:104` (`disconnectedCallback`),
  `:117` (`attributeChangedCallback`), `:125` (`#onInput`, đầu hàm), `:128` (`#onInput`, nhánh
  query < 2 ký tự), `:138` (`#onBlur`), `:145` (`#onKeydown` Escape). Riêng `:226` là
  `const seq = ++this.#seq;` trong `#query()` — gán số hiệu cho lần chạy **hiện tại**, không phải
  vô hiệu hoá, giữ nguyên logic, không gộp vào helper. Guard đọc kết quả ở `:230` và `:234`
  (`if (seq !== this.#seq) return`).
- `packages/core/src/client.places.test.ts` — mẫu test đã có: `stubClient()` trả về
  `{ client, fetch, calledUrl, calledInit }`, `calledInit()` đọc `RequestInit` thật đã truyền cho
  `fetch`. Test `signal` mới dùng lại nguyên mẫu này.
- `tsconfig.base.json` — `exactOptionalPropertyTypes` bật: mọi chỗ gán field optional phải dùng
  spread có điều kiện, không được gán `undefined` trực tiếp.

## 3. Nguyên tắc thiết kế

Mọi nơi hiện đã "vô hiệu hoá" một truy vấn cũ (tăng `cancelled`/`#seq`) gọi thêm
`controller.abort()` **trong cùng một hàm đồng bộ**, tại đúng chỗ đó. Vì cờ vô hiệu hoá và lệnh
abort luôn được set/gọi cùng một nhịp đồng bộ, guard đang có (`if (!cancelled)` /
`if (seq !== this.#seq)`) tự động che luôn `AbortError` phát sinh từ chính request bị huỷ đó —
không cần thêm nhánh `catch` nào bắt riêng `AbortError`, và không có khả năng một request còn hợp
lệ (chưa bị đánh dấu huỷ) lại bị abort bởi nơi khác.

`client.autocomplete()` nhận thêm `signal?: AbortSignal` trong opts — cộng thêm, không phá vỡ chữ
ký cũ. App dùng thẳng `client.autocomplete()` (không qua hook/element) cũng dùng được nếu muốn,
nhưng `usePlaces()`/`<mapslibvn-autocomplete>` tự quản lý toàn bộ, không lộ API mới nào cho người
dùng hook/element.

## 4. `packages/core/src/client.ts`

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

`autocomplete` đổi thành:

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

`get()` bỏ qua `init?.signal` nếu `undefined` (spread có điều kiện) — không truyền `signal`
xuống `doFetch` khi không ai đưa vào, giữ hành vi cũ với mọi method khác không đổi.

## 5. `packages/react/src/use-places.ts` và `packages/react-native/src/use-places.ts`

Sửa **giống hệt nhau** ở cả hai tệp (giữ tính đồng nhất đã có):

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

`controller.abort()` gọi vô điều kiện trong cleanup, kể cả khi `timer` chưa kịp bắn (chưa từng gọi
`fetch`) — vô hại, `AbortController.abort()` trên một signal chưa ai lắng nghe không làm gì.

## 6. `packages/web/src/autocomplete-element.ts`

Thêm field cạnh `#seq`:

```ts
#abortController: AbortController | undefined;
```

Thêm helper cạnh `#near()`/`#debounceMs()`:

```ts
/** Vô hiệu hoá truy vấn đang chờ: tăng seq (che kết quả trễ) và huỷ request đang bay ra mạng. */
#cancelPending(): void {
  this.#seq++;
  this.#abortController?.abort();
}
```

Đổi 7 chỗ `this.#seq++` (tất cả trừ dòng gán `seq` đầu `#query()`, giữ nguyên) thành
`this.#cancelPending()`. Trong `#query()`:

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

Gom vào helper thay vì lặp `this.#abortController?.abort()` ở 7 chỗ: giảm nguy cơ quên một
trong 7 chỗ khi có người sửa thêm sau này — một cải tiến nhỏ nằm đúng trong phạm vi việc đang làm,
không phải refactor không liên quan.

## 7. Test

- **`packages/core/src/client.autocomplete-abort.test.ts`** (mới): dùng lại `stubClient()` từ
  `client.places.test.ts`. Gọi `client.autocomplete('q', { signal: myController.signal })`, assert
  `calledInit().signal === myController.signal`. Gọi không kèm `signal`, assert
  `calledInit().signal` là `undefined`.
- **`use-places.test.ts`** (thêm bài, cả hai gói): mock `client.autocomplete` trả về một promise
  **không bao giờ resolve** cho lần gọi đầu (dùng `new Promise(() => {})` — không cần resolve vì
  bài test chỉ cần request đó ở trạng thái "đang bay"), ghi lại `opts.signal` truyền vào. Đổi
  `query` (rerender) trước khi promise đó xong. Assert: `signal` của lần gọi đầu có
  `aborted === true`; lần gọi thứ hai nhận một `AbortSignal` khác, `aborted === false`.
- **`autocomplete-element.test.ts`** (thêm bài): cùng kỹ thuật — mock `autocomplete` giữ lại
  `opts.signal` của lần gọi đầu, gõ tiếp trước khi debounce+response của lần đầu xong, assert
  `aborted === true` trên signal cũ.
- Không sửa `debounce-trace.test.ts` ở cả ba gói — mock ở đó bỏ qua tham số thứ hai của
  `client.autocomplete`, vẫn chạy đúng nguyên trạng.

## 8. Docs

`apps/docs/src/content/docs/sdk.md`, bảng tham số `opts` theo phương thức (mục có dòng
`| autocomplete | near, limit, types |`): thêm `signal` vào dòng `autocomplete`, và thêm một câu
ghi chú ngay dưới bảng: `signal` là `AbortSignal` phía client để huỷ request, **không** phải tham
số gửi lên server như các trường còn lại trong bảng.

## 9. Ngoài phạm vi

`search`/`nearby`/`geocode`/`reverse`/`directions` không đổi. Không thêm API huỷ thủ công cho app
developer. Không bump version SDK — để riêng lúc `pnpm sdk:publish`. Không đổi giá trị debounce
mặc định của gói nào.
