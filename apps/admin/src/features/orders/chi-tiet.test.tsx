// @vitest-environment jsdom

import { DelayedActionProvider } from '@mapslibvn/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChiTietDonPanel } from './chi-tiet';

const don = (status: string) => ({
  order: {
    id: 'd1',
    orderCode: 100001,
    noiDungChuyenKhoan: 'MLV100001',
    kind: 'plan',
    tier: 'starter',
    months: 1,
    quotaGroup: null,
    packs: null,
    moTa: 'Starter 1 tháng',
    amountVnd: 650_000,
    amountUsdCents: 2_500,
    status,
    checkoutUrl: null,
    linkExpiresAt: null,
    paidAt: null,
    paidAmountVnd: status === 'underpaid' ? 600_000 : null,
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
  events: [
    {
      id: 1,
      orderId: 'd1',
      provider: 'payos',
      reference: 'FT1',
      orderCode: 100001,
      amountVnd: 600_000,
      signatureValid: true,
      tomTat: { code: '00' },
      receivedAt: '2026-09-19T02:30:00Z',
    },
  ],
  owner: { email: 'khach@vidu.vn', billingEmail: null },
});

const stub = (body: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockImplementation(
        async () =>
          new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }),
      ),
  );

afterEach(() => vi.unstubAllGlobals());

const ve = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DelayedActionProvider>
        <ChiTietDonPanel id="d1" onClose={() => {}} />
      </DelayedActionProvider>
    </QueryClientProvider>,
  );

describe('ChiTietDonPanel', () => {
  it('underpaid: hiện sự kiện tiền vào, số đã nhận, nút xác nhận tay; KHÔNG có Thử cấp lại', async () => {
    stub(don('underpaid'));
    ve();
    expect(await screen.findByText('FT1')).toBeVisible();
    expect(screen.getByText('chữ ký hợp lệ')).toBeVisible();
    expect(screen.getAllByText(/600\.000đ/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Xác nhận đã nhận tiền/ })).toBeVisible();
    // Đơn chưa đủ tiền thì không có gì để "cấp lại" — nút đó xuất hiện ở đây là mời bấm nhầm.
    expect(screen.queryByRole('button', { name: /Thử cấp lại/ })).toBeNull();
  });

  it('paid_unfulfilled: có Thử cấp lại, không có xác nhận tay', async () => {
    stub(don('paid_unfulfilled'));
    ve();
    expect(await screen.findByRole('button', { name: /Thử cấp lại/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Xác nhận đã nhận tiền/ })).toBeNull();
  });

  it('form xác nhận tay khoá nút Gửi khi thiếu lý do hoặc mã ngân hàng', async () => {
    stub(don('pending'));
    ve();
    await userEvent.click(await screen.findByRole('button', { name: /Xác nhận đã nhận tiền/ }));
    const gui = screen.getByRole('button', { name: /Gửi xác nhận/ });
    expect(gui).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Lý do'), 'Thấy trong sao kê');
    expect(gui).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Mã tham chiếu ngân hàng'), 'FT9');
    expect(gui).toBeEnabled();
  });

  it('đơn fulfilled: không có lệnh tiền nào — không cấp lại, không xác nhận tay', async () => {
    stub(don('fulfilled'));
    ve();
    expect(await screen.findByText('FT1')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Thử cấp lại/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Xác nhận đã nhận tiền/ })).toBeNull();
  });
});
