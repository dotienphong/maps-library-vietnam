// @vitest-environment jsdom

import { DelayedActionProvider } from '@mapslibvn/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
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

const donChiTietPending = {
  order: {
    id: 'd1',
    orderCode: 100005,
    noiDungChuyenKhoan: 'MLV100005',
    kind: 'plan',
    tier: 'starter',
    months: 1,
    quotaGroup: null,
    packs: null,
    moTa: 'Starter 1 tháng',
    amountVnd: 650_000,
    amountUsdCents: 2_500,
    status: 'pending',
    checkoutUrl: null,
    linkExpiresAt: null,
    paidAt: null,
    paidAmountVnd: null,
    fulfilledAt: null,
    fulfilError: null,
    fulfilAttempts: 0,
    createdAt: '2026-09-19T02:00:00Z',
    updatedAt: '2026-09-19T02:00:00Z',
    tenantId: 't',
    tenantName: 'Công ty Thử',
    accountId: 'a',
    paymentLinkId: 'l',
    entitlementReceipt: null,
    note: null,
  },
  events: [],
  owner: { email: 'khach@vidu.vn', billingEmail: null },
};

/** Huỷ đơn d1 luôn thất bại (409 order_not_cancellable) — dùng để kiểm lỗi hiện ở cấp trang. */
const stubLenhThatBai = () => {
  const m = vi.fn().mockImplementation(async (url: string) => {
    const { pathname } = new URL(url, 'http://localhost');
    if (pathname === '/v1/admin/orders/d1/cancel') {
      return new Response(
        JSON.stringify({ error: { code: 'order_not_cancellable', message: 'không huỷ được' } }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      );
    }
    if (pathname === '/v1/admin/orders/d1') {
      return new Response(JSON.stringify(donChiTietPending), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname === '/v1/admin/orders/summary') {
      return new Response(
        JSON.stringify({ choXuLy: 0, doanhThu30Ngay: 0, pendingQua1Gio: 0, khongKhop: 0 }),
        { headers: { 'content-type': 'application/json' } },
      );
    }
    if (pathname === '/v1/admin/payment-events/unmatched') {
      return new Response(JSON.stringify({ items: [] }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ items: [], nextCursor: null }), {
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', m);
  return m;
};

describe('OrdersPage — lỗi lệnh hiện ở cấp trang', () => {
  afterEach(() => vi.useRealTimers());

  it('Huỷ đơn thất bại: panel đã đóng lúc lệnh chạy, lỗi hiện thành dải ở trang kèm mã đơn', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubLenhThatBai();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    ve('/orders?id=d1');

    await user.click(await screen.findByRole('button', { name: 'Huỷ đơn' }));
    await user.type(screen.getByLabelText('Lý do'), 'Khách đổi ý');
    await user.click(screen.getByRole('button', { name: 'Huỷ đơn' }));

    // onClose() chạy ngay sau schedule — panel đã đóng, không còn gì để hiện lỗi bên trong nó.
    expect(screen.queryByRole('dialog')).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(await screen.findByText(/Chỉ huỷ được đơn đang chờ thanh toán/)).toBeVisible();
    expect(screen.getByText(/100005/)).toBeVisible();
  });
});
