// @vitest-environment jsdom

import { DelayedActionProvider } from '@mapslibvn/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TenantsPage } from './page';

/** Đọc URL hiện tại của MemoryRouter — để kiểm URL là nguồn sự thật của ngăn chi tiết, không
 * phải state cục bộ đã lệch khỏi nó. */
function HienThiUrl() {
  const loc = useLocation();
  return <span data-testid="url">{loc.pathname + loc.search}</span>;
}

const tenant = (extra: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-0000000000cc',
  name: 'Công ty Thử Nghiệm',
  plan: 'free',
  quota_mode: 'legacy',
  created_at: new Date('2026-09-01T00:00:00.000Z').toISOString(),
  active_keys: 2,
  ...extra,
});

const stubFetch = (body: unknown, status = 200) =>
  vi.stubGlobal(
    'fetch',
    // Response chỉ đọc được MỘT lần: chia sẻ một instance cho mọi lần fetch làm lần sau ném
    // "Body is unusable". Dựng mới mỗi lần gọi.
    vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );

const renderPage = (duong = '/tenants') =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {/* AppShell bọc provider này quanh cả trang; ngăn chi tiết gọi useDelayedAction ngay cả khi
          đang đóng, nên test cũng phải dựng đúng khung đó. */}
      <MemoryRouter initialEntries={[duong]}>
        <DelayedActionProvider>
          <HienThiUrl />
          <TenantsPage />
        </DelayedActionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

afterEach(() => vi.unstubAllGlobals());

describe('TenantsPage', () => {
  it('hiện tên, gói và số khoá đang hoạt động', async () => {
    stubFetch({ items: [tenant()], nextCursor: null });
    renderPage();
    expect(await screen.findByText('Công ty Thử Nghiệm')).toBeVisible();
    expect(screen.getByText('free')).toBeVisible();
    expect(screen.getByText('2 khoá')).toBeVisible();
  });

  it('không có tenant nào → trạng thái rỗng, không phải bảng trống', async () => {
    stubFetch({ items: [], nextCursor: null });
    renderPage();
    expect(await screen.findByText(/Không có tenant nào/)).toBeVisible();
  });

  it('403 → nói rõ là thiếu quyền chứ không phải lỗi mạng', async () => {
    stubFetch({ error: { code: 'billing_admin_forbidden', message: 'không có quyền' } }, 403);
    renderPage();
    expect(await screen.findByText('Tài khoản này không có quyền xem mục đó')).toBeVisible();
    expect(screen.getByText(/billing_admin_forbidden/)).toBeVisible();
  });

  it('còn trang sau → có nút tải thêm', async () => {
    stubFetch({ items: [tenant()], nextCursor: '2026-09-01T00:00:00.000Z|abc' });
    renderPage();
    expect(await screen.findByRole('button', { name: 'Tải thêm' })).toBeVisible();
  });

  it('gõ vào ô tìm thì gửi tham số q', async () => {
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify({ items: [], nextCursor: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await userEvent.type(screen.getByLabelText('Tìm theo tên tenant'), 'thử');
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.some(([path]) => String(path).includes('q=th'))).toBe(true),
    );
  });

  it('?id= trong URL mở ngăn chi tiết ngay', async () => {
    stubFetch({ items: [tenant()], nextCursor: null, tenant: tenant(), keys: [], owner: null });
    renderPage('/tenants?id=00000000-0000-4000-8000-0000000000cc');
    expect(await screen.findByRole('dialog')).toBeVisible();
  });

  it('URL là nguồn sự thật duy nhất: mở tenant khác ghi đè ?id=, đóng ngăn thì ?id= biến mất', async () => {
    // Trước bản sửa này, ngăn chi tiết giữ id trong state cục bộ chỉ đọc URL MỘT lần lúc dựng:
    // mở/đóng ngăn đổi được cái đang hiện nhưng không viết lại URL — gửi link đi là sai tenant,
    // và nút Back của trình duyệt không đóng được ngăn.
    const tenantA = tenant({ id: 'aaaaaaaa-0000-4000-8000-0000000000aa', name: 'Tenant A' });
    const tenantB = tenant({ id: 'bbbbbbbb-0000-4000-8000-0000000000bb', name: 'Tenant B' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const duongDan = new URL(String(input), 'https://admin.test').pathname;
        const than =
          duongDan === '/v1/admin/tenants'
            ? { items: [tenantA, tenantB], nextCursor: null }
            : { tenant: tenantA, keys: [], owner: null };
        return new Response(JSON.stringify(than), {
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    renderPage();
    const dsNut = await screen.findAllByRole('button', { name: 'Xem khoá' });
    expect(dsNut).toHaveLength(2);
    const [nutA] = dsNut;
    if (!nutA) throw new Error('cần ít nhất 1 nút Xem khoá');

    await userEvent.click(nutA);
    expect(await screen.findByRole('dialog')).toBeVisible();
    await vi.waitFor(() =>
      expect(screen.getByTestId('url').textContent).toBe(`/tenants?id=${tenantA.id}`),
    );

    // Modal của ngăn chi tiết chặn mọi thứ khác trên trang (aria-hidden + pointer-events: none),
    // nên phải đóng trước khi mở tenant khác — giống hệt khuôn `detail.test.tsx`.
    await userEvent.click(screen.getByRole('button', { name: 'Đóng chi tiết tenant' }));
    await vi.waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/tenants'));

    const [, nutB] = screen.getAllByRole('button', { name: 'Xem khoá' });
    if (!nutB) throw new Error('cần đúng 2 nút Xem khoá sau khi đóng ngăn');
    await userEvent.click(nutB);
    expect(await screen.findByRole('dialog')).toBeVisible();
    await vi.waitFor(() =>
      expect(screen.getByTestId('url').textContent).toBe(`/tenants?id=${tenantB.id}`),
    );
  });
});
