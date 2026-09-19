// @vitest-environment jsdom

import { DelayedActionProvider } from '@mapslibvn/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrdersPage } from './page';

const don = {
  id: '00000000-0000-4000-8000-0000000000d1',
  orderCode: 100001,
  noiDungChuyenKhoan: 'MLV100001',
  kind: 'plan',
  tier: 'starter',
  months: 3,
  quotaGroup: null,
  packs: null,
  moTa: 'Starter 3 tháng',
  amountVnd: 1_950_000,
  amountUsdCents: 7_500,
  status: 'paid_unfulfilled',
  checkoutUrl: null,
  linkExpiresAt: null,
  paidAt: '2026-09-19T03:00:00Z',
  paidAmountVnd: 1_950_000,
  fulfilledAt: null,
  fulfilError: 'revision_conflict',
  fulfilAttempts: 3,
  createdAt: '2026-09-19T02:00:00Z',
  updatedAt: '2026-09-19T03:00:00Z',
  tenantId: 't',
  tenantName: 'Công ty Thử',
  accountId: 'a',
  paymentLinkId: 'l',
  entitlementReceipt: null,
  note: null,
};

const stubFetch = () => {
  const m = vi.fn().mockImplementation(async (url: string) => {
    const { pathname } = new URL(url, 'http://localhost');
    const body =
      pathname === '/v1/admin/orders/summary'
        ? { choXuLy: 2, doanhThu30Ngay: 3_250_000, pendingQua1Gio: 1, khongKhop: 4 }
        : pathname === '/v1/admin/payment-events/unmatched'
          ? { items: [] }
          : { items: [don], nextCursor: null };
    return new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', m);
  return m;
};

afterEach(() => vi.unstubAllGlobals());

const ve = (duong = '/orders') =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DelayedActionProvider>
        <MemoryRouter initialEntries={[duong]}>
          <OrdersPage />
        </MemoryRouter>
      </DelayedActionProvider>
    </QueryClientProvider>,
  );

describe('OrdersPage', () => {
  it('bốn ô đầu trang và danh sách có tenant, số tiền, trạng thái', async () => {
    stubFetch();
    ve();
    expect(await screen.findByText('3.250.000đ')).toBeVisible();
    expect(screen.getByText('Đơn chờ xử lý')).toBeVisible();
    // Hai chỗ cùng chữ là cố ý: một ô số liệu ở đầu trang trỏ xuống đúng khối bên dưới.
    expect(screen.getAllByText('Giao dịch không khớp đơn')).toHaveLength(2);
    expect(await screen.findByText('Công ty Thử')).toBeVisible();
    expect(screen.getByText('1.950.000đ')).toBeVisible();
    // Tiền vào mà gói chưa vào là việc phải xử lý; nhãn phải nói đúng điều đó.
    expect(screen.getAllByText('Tiền vào, gói chưa vào').length).toBeGreaterThan(0);
  });

  it('bộ lọc ngày và tenant đi từ URL vào lời gọi API; chip tenant có nút bỏ lọc', async () => {
    const fetchMock = stubFetch();
    ve('/orders?tenant=t&from=2026-09-01&to=2026-09-19');
    expect(await screen.findByText('Công ty Thử')).toBeVisible();
    expect(screen.getByLabelText('Từ ngày')).toHaveValue('2026-09-01');
    expect(screen.getByLabelText('Đến ngày')).toHaveValue('2026-09-19');
    expect(screen.getByRole('button', { name: /Bỏ lọc tenant/ })).toBeVisible();
    const goiDanhSach = fetchMock.mock.calls
      .map(([u]) => String(u))
      .find((u) => u.includes('/v1/admin/orders?'));
    expect(goiDanhSach).toContain('tenant=t');
    expect(goiDanhSach).toContain('from=2026-09-01');
    expect(goiDanhSach).toContain('to=2026-09-19');
  });
});
