// @vitest-environment jsdom

import { DelayedActionProvider } from '@mapslibvn/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TenantsPage } from './page';

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
});
