// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminApiError, apiFetch, setReloadGuard } from './fetcher';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setReloadGuard(() => false);
});

describe('apiFetch', () => {
  it('trả về thân JSON khi thành công', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ items: [1] })));
    await expect(apiFetch<{ items: number[] }>('/v1/admin/edits')).resolves.toEqual({ items: [1] });
  });

  it('lỗi JSON → AdminApiError mang đúng mã và status', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: { code: 'not_found', message: 'Không có' } }, 404),
        ),
    );
    await expect(apiFetch('/v1/admin/edits/9')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
    await expect(apiFetch('/v1/admin/edits/9')).rejects.toBeInstanceOf(AdminApiError);
  });

  it('401 trả HTML (trang đăng nhập Access) → tải lại trang', async () => {
    const reload = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html>đăng nhập</html>', {
          status: 401,
          headers: { 'content-type': 'text/html' },
        }),
      ),
    );
    await expect(apiFetch('/v1/admin/edits', {}, reload)).rejects.toMatchObject({ status: 401 });
    expect(reload).toHaveBeenCalledOnce();
  });

  it('đang có việc chờ gửi thì KHÔNG tải lại, tránh mất việc', async () => {
    const reload = vi.fn();
    setReloadGuard(() => true);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('<html/>', { status: 401, headers: { 'content-type': 'text/html' } }),
        ),
    );
    await expect(apiFetch('/v1/admin/edits', {}, reload)).rejects.toMatchObject({ status: 401 });
    expect(reload).not.toHaveBeenCalled();
  });
});
