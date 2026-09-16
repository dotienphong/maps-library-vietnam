export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

/**
 * Cho phép phần khác của ứng dụng chặn việc tự tải lại trang. `delayed-action` bật cờ này trong
 * lúc đếm ngược: tải lại giữa chừng sẽ nuốt mất một thao tác người dùng tưởng đã làm.
 */
let hasPendingWork: () => boolean = () => false;
export function setReloadGuard(guard: () => boolean): void {
  hasPendingWork = guard;
}

/**
 * Cùng origin với Worker nên dùng đường dẫn tương đối — Access đã đứng trước cả /admin và
 * /v1/admin. Không gửi kèm khoá API: route admin xác thực bằng JWT do Access chèn.
 */
export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  reload: () => void = () => location.reload(),
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { accept: 'application/json', ...(init.headers ?? {}) },
  });

  if (response.ok) return (await response.json()) as T;

  const contentType = response.headers.get('content-type') ?? '';
  // Phiên Access hết hạn: origin trả trang đăng nhập HTML thay vì JSON.
  if (response.status === 401 && !contentType.includes('application/json')) {
    if (!hasPendingWork()) reload();
    throw new AdminApiError(401, 'session_expired', 'Phiên đăng nhập đã hết hạn');
  }

  let code = `http_${response.status}`;
  let message = `HTTP ${response.status}`;
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    if (body.error?.code) code = body.error.code;
    if (body.error?.message) message = body.error.message;
  } catch {
    // Thân lỗi không phải JSON — giữ thông điệp mặc định.
  }
  throw new AdminApiError(response.status, code, message);
}
