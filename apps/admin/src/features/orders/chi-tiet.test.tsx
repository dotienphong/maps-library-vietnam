// @vitest-environment jsdom

import { DelayedActionProvider } from '@mapslibvn/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChiTietDonPanel } from './chi-tiet';

const don = (status: string, note: string | null = null) => ({
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
    note,
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
        <MemoryRouter>
          <ChiTietDonPanel id="d1" onClose={() => {}} />
        </MemoryRouter>
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

  it('fulfilled: không cấp lại, không xác nhận tay; CÓ Đánh dấu hoàn tiền, KHÔNG có Huỷ đơn', async () => {
    stub(don('fulfilled'));
    ve();
    expect(await screen.findByText('FT1')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Thử cấp lại/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Xác nhận đã nhận tiền/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Đánh dấu hoàn tiền' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Huỷ đơn' })).toBeNull();
  });

  it('pending: có Huỷ đơn và Xác nhận tay; mở lệnh này thì lệnh kia đóng — chỉ MỘT ô Lý do', async () => {
    stub(don('pending'));
    ve();
    await userEvent.click(await screen.findByRole('button', { name: /Xác nhận đã nhận tiền/ }));
    expect(screen.getAllByLabelText('Lý do')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Huỷ đơn' }));
    expect(screen.getAllByLabelText('Lý do')).toHaveLength(1);
    expect(screen.getByRole('form', { name: /Huỷ đơn 100001/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Gửi xác nhận/ })).toBeNull();
  });

  it('paid_unfulfilled cũng có Đánh dấu hoàn tiền (cạnh Thử cấp lại), và form KHÔNG gợi ý Tạm dừng', async () => {
    stub(don('paid_unfulfilled'));
    ve();
    expect(await screen.findByRole('button', { name: /Thử cấp lại/ })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Đánh dấu hoàn tiền' }));
    expect(screen.queryByRole('link', { name: /Gói cước/ })).toBeNull();
  });

  it('form hoàn tiền nói rõ: không đụng sổ quota, thu hồi quyền dùng là lệnh Tạm dừng ở Gói cước', async () => {
    stub(don('fulfilled'));
    ve();
    await userEvent.click(await screen.findByRole('button', { name: 'Đánh dấu hoàn tiền' }));
    expect(screen.getByText(/không đụng sổ quota/i)).toBeVisible();
    expect(screen.getByRole('link', { name: /Gói cước/ })).toHaveAttribute(
      'href',
      '/billing?tenant=t',
    );
  });

  it('refunded: không lệnh nào; hiện ghi chú admin', async () => {
    stub(don('refunded', 'Khách không dùng, đã chuyển trả'));
    ve();
    expect(await screen.findByText('Khách không dùng, đã chuyển trả')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Đánh dấu hoàn tiền' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Huỷ đơn' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Thử cấp lại/ })).toBeNull();
  });
});
