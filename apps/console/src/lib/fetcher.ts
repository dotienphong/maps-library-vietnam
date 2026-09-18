export class ConsoleApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ConsoleApiError';
  }
}

/**
 * Nơi đưa người dùng về màn đăng nhập khi phiên hết hạn. `main.tsx` tiêm hàm thật vào, để file
 * này không phải biết gì về router — tầng gọi mạng không nên phụ thuộc tầng giao diện.
 */
let veManDangNhap: (duongDangXem: string) => void = () => {};
export function datVeManDangNhap(fn: (duongDangXem: string) => void): void {
  veManDangNhap = fn;
}

/**
 * Khác trang Admin ở cách xử lý 401. Ở đó 401 nghĩa là phiên Cloudflare Access hết hạn và cách
 * sửa là tải lại trang để Access đưa về màn đăng nhập của nó. Ở đây 401 là phiên khách hết hạn,
 * và tải lại trang chỉ cho ra đúng màn hình đó lần nữa — phải chuyển sang màn đăng nhập của chính
 * console, giữ đường dẫn đang xem trong `?next=` để quay lại sau khi vào được.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    // Cookie phiên là HttpOnly cùng origin; không có token nào trong localStorage để lộ qua XSS.
    credentials: 'same-origin',
    headers: { accept: 'application/json', ...(init.headers ?? {}) },
  });

  if (response.ok) {
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  let code = `http_${response.status}`;
  let message = `HTTP ${response.status}`;
  let details: Record<string, unknown> | undefined;
  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string; details?: Record<string, unknown> };
    };
    if (body.error?.code) code = body.error.code;
    if (body.error?.message) message = body.error.message;
    if (body.error?.details) details = body.error.details;
  } catch {
    // Thân lỗi không phải JSON — giữ thông điệp mặc định.
  }

  if (response.status === 401 && code === 'not_signed_in') {
    veManDangNhap(`${location.pathname}${location.search}`);
  }

  throw new ConsoleApiError(response.status, code, message, details);
}

export const postJson = <T>(path: string, body: unknown): Promise<T> =>
  apiFetch<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

export const patchJson = <T>(path: string, body: unknown): Promise<T> =>
  apiFetch<T>(path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
