/**
 * Thay cho `fetchMock` của `cloudflare:test`.
 *
 * `@cloudflare/vitest-pool-workers` bỏ export `fetchMock` kể từ bản đòi vitest 4 (ta đang ở
 * 0.19.1); trong package chỉ còn sót lại *kiểu* `MockAgent` chứ không còn giá trị runtime nào.
 * Miniflare 4 vẫn có option `fetchMock`, nhưng nó nằm ở cấu hình phía Node còn test thì chạy
 * trong isolate của worker, nên test KHÔNG chạm tới được MockAgent đó để thêm interceptor theo
 * từng ca. Vì vậy phải chặn thẳng `globalThis.fetch`.
 *
 * Cách này chặn được vì không chỗ nào trong `apps/api/src` bắt `fetch` lúc import: `access.ts`
 * gọi `await fetch(url)`, còn `routing/valhalla.ts` dùng `options.fetchImpl ?? fetch` — cả hai
 * đều đọc biến toàn cục tại thời điểm gọi. `SELF.fetch` không bị ảnh hưởng vì đó là method của
 * Fetcher, không phải `globalThis.fetch`.
 *
 * Bề mặt API giữ y như undici MockAgent ở những phần ba file test đang dùng
 * (`activate` / `disableNetConnect` / `get` / `intercept` / `reply` / `replyWithError` /
 * `persist`), nên các file test chỉ phải đổi dòng import.
 */

type ReplyBody = object | string;

interface InterceptOptions {
  path: string;
  /** Thiếu thì mặc định GET, giống undici. */
  method?: string;
}

interface Interceptor {
  origin: string;
  path: string;
  method: string;
  persist: boolean;
  /** Trả Response, hoặc ném — dùng cho `replyWithError`. */
  produce: () => Response;
}

/** Handle trả về từ `reply`/`replyWithError` để gọi tiếp `.persist()`. */
class ReplyHandle {
  constructor(private readonly interceptor: Interceptor) {}

  /** Không tiêu thụ sau lần khớp đầu — dùng cho JWKS bị cache nên số lần gọi không cố định. */
  persist(): this {
    this.interceptor.persist = true;
    return this;
  }
}

class Interceptable {
  constructor(
    private readonly agent: FetchMock,
    private readonly origin: string,
  ) {}

  intercept(options: InterceptOptions): {
    reply: (status: number, body?: ReplyBody) => ReplyHandle;
    replyWithError: (error: Error) => ReplyHandle;
  } {
    const base: Omit<Interceptor, 'produce'> = {
      origin: this.origin,
      path: options.path,
      method: (options.method ?? 'GET').toUpperCase(),
      persist: false,
    };
    return {
      reply: (status, body) => {
        const payload = typeof body === 'object' && body !== null ? JSON.stringify(body) : body;
        const interceptor: Interceptor = {
          ...base,
          produce: () =>
            new Response(payload === undefined ? null : payload, {
              status,
              headers: {
                'content-type':
                  typeof body === 'object' && body !== null ? 'application/json' : 'text/plain',
              },
            }),
        };
        this.agent.push(interceptor);
        return new ReplyHandle(interceptor);
      },
      replyWithError: (error) => {
        const interceptor: Interceptor = {
          ...base,
          produce: () => {
            throw error;
          },
        };
        this.agent.push(interceptor);
        return new ReplyHandle(interceptor);
      },
    };
  }
}

class FetchMock {
  #interceptors: Interceptor[] = [];
  #netConnect = true;
  #real: typeof globalThis.fetch | null = null;

  /** @internal */
  push(interceptor: Interceptor): void {
    this.#interceptors.push(interceptor);
  }

  activate(): void {
    if (this.#real) return;
    this.#real = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      this.#dispatch(input, init)) as typeof globalThis.fetch;
  }

  deactivate(): void {
    if (!this.#real) return;
    globalThis.fetch = this.#real;
    this.#real = null;
  }

  /**
   * Xoá mọi interceptor, kể cả `.persist()`. Cần khi một file test vừa có ca persist (thăm dò cache
   * hit) vừa có ca sau mong upstream chết: interceptor persist sống qua ranh giới `it()`.
   */
  reset(): void {
    this.#interceptors = [];
  }

  disableNetConnect(): void {
    this.#netConnect = false;
  }

  enableNetConnect(): void {
    this.#netConnect = true;
  }

  get(origin: string): Interceptable {
    return new Interceptable(this, origin);
  }

  async #dispatch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();

    // FIFO như undici: interceptor đăng ký trước được dùng trước.
    const index = this.#interceptors.findIndex(
      (i) => i.origin === url.origin && i.path === url.pathname && i.method === method,
    );
    if (index === -1) {
      if (this.#netConnect && this.#real) return this.#real(input as RequestInfo, init);
      throw new Error(`fetch-mock: không có interceptor cho ${method} ${url.href}`);
    }
    const interceptor = this.#interceptors[index] as Interceptor;
    if (!interceptor.persist) this.#interceptors.splice(index, 1);
    return interceptor.produce();
  }
}

export const fetchMock = new FetchMock();
