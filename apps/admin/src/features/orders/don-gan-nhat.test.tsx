// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DanhSachDonGanNhat } from './don-gan-nhat';

const DON = {
  items: [
    {
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
      status: 'fulfilled',
      checkoutUrl: null,
      linkExpiresAt: null,
      paidAt: null,
      paidAmountVnd: 650_000,
      fulfilledAt: null,
      fulfilError: null,
      fulfilAttempts: 0,
      createdAt: '2026-09-19T02:00:00Z',
      updatedAt: '2026-09-19T02:00:00Z',
      tenantId: 't1',
      tenantName: 'Công ty Thử',
      accountId: 'a1',
      paymentLinkId: null,
      entitlementReceipt: null,
      note: null,
    },
  ],
  nextCursor: null,
};

afterEach(() => vi.unstubAllGlobals());

const ve = (props: { tenantId: string; enabled: boolean }) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <DanhSachDonGanNhat {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('DanhSachDonGanNhat', () => {
  it('có đơn: hiện mã đơn, mô tả, tiền, huy hiệu trạng thái và link Xem tất cả đơn', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(DON), { headers: { 'content-type': 'application/json' } }),
      ),
    );
    ve({ tenantId: 't1', enabled: true });
    expect(await screen.findByText('100001')).toBeVisible();
    expect(screen.getByText('Starter 1 tháng')).toBeVisible();
    expect(screen.getByText(/650\.000đ/)).toBeVisible();
    expect(screen.getByRole('link', { name: /Xem tất cả đơn/ })).toHaveAttribute(
      'href',
      '/orders?tenant=t1',
    );
  });

  it('rỗng: không có đơn nào thì nói rõ "Chưa có đơn nào"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ items: [], nextCursor: null }), {
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    ve({ tenantId: 't1', enabled: true });
    expect(await screen.findByText('Chưa có đơn nào.')).toBeVisible();
  });

  it('lỗi mạng: nói rõ không đọc được đơn', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('lỗi', { status: 500 })),
    );
    ve({ tenantId: 't1', enabled: true });
    expect(await screen.findByText('Không đọc được đơn của tenant này.')).toBeVisible();
  });

  it('enabled sai: không gọi mạng, không hiện mục Đơn gần nhất', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(DON), { headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { container } = ve({ tenantId: 't1', enabled: false });
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/Đơn gần nhất/)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
