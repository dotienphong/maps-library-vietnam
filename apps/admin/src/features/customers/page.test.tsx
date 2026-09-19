// @vitest-environment jsdom

import { DelayedActionProvider } from '@mapslibvn/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CustomersPage } from './page';

const khach = (them: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-0000000000a1',
  email: 'khach@vidu.vn',
  name: 'Khách Thử',
  googleLinked: true,
  lastLoginAt: '2026-09-19T03:00:00Z',
  disabledAt: null,
  createdAt: '2026-09-01T03:00:00Z',
  tenant: { id: 't1', name: 'Công ty Thử', quotaMode: 'commercial' },
  ...them,
});

const ME = { email: 'phong@test.invalid', permissions: ['customers.read', 'orders.read'] };

function stubFetch(items: unknown[]) {
  const m = vi.fn(async (input: RequestInfo | URL) => {
    const duongDan = new URL(String(input), 'https://admin.test').pathname;
    const than =
      duongDan === '/v1/admin/me'
        ? ME
        : duongDan === '/v1/admin/orders'
          ? { items: [], nextCursor: null }
          : duongDan.startsWith('/v1/admin/customers/')
            ? { account: items[0], sessions: [] }
            : { items, nextCursor: null };
    return new Response(JSON.stringify(than), { headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', m);
  return m;
}

afterEach(() => vi.unstubAllGlobals());

const ve = (duong = '/customers') =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DelayedActionProvider>
        <MemoryRouter initialEntries={[duong]}>
          <CustomersPage />
        </MemoryRouter>
      </DelayedActionProvider>
    </QueryClientProvider>,
  );

describe('CustomersPage', () => {
  it('danh sách: email, tenant, Google, trạng thái', async () => {
    stubFetch([
      khach(),
      khach({
        id: 'a2',
        email: 'khoa@vidu.vn',
        disabledAt: '2026-09-18T00:00:00Z',
        tenant: null,
        googleLinked: false,
      }),
    ]);
    ve();
    expect(await screen.findByText('khach@vidu.vn')).toBeVisible();
    expect(screen.getByText('Công ty Thử')).toBeVisible();
    expect(screen.getAllByText('Đang hoạt động').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Đã vô hiệu hoá').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Google').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Chưa có tổ chức').length).toBeGreaterThan(0);
  });

  it('ô tìm gửi q lên API; trống → trạng thái rỗng', async () => {
    const m = stubFetch([]);
    ve('/customers?q=vidu');
    expect(await screen.findByText('Không có tài khoản nào khớp')).toBeVisible();
    expect(screen.getByLabelText('Tìm theo email hoặc tên')).toHaveValue('vidu');
    expect(
      m.mock.calls
        .map(([u]) => String(u))
        .some((u) => u.includes('/v1/admin/customers?') && u.includes('q=vidu')),
    ).toBe(true);
  });

  it('?id= trong URL mở ngăn chi tiết', async () => {
    stubFetch([khach()]);
    ve('/customers?id=00000000-0000-4000-8000-0000000000a1');
    expect(await screen.findByRole('dialog')).toBeVisible();
  });
});
