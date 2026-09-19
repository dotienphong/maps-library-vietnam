// @vitest-environment jsdom

import { DelayedActionProvider } from '@mapslibvn/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChiTietKhachPanel } from './chi-tiet';

const ID = '00000000-0000-4000-8000-0000000000a1';
const chiTiet = (them: Record<string, unknown> = {}) => ({
  account: {
    id: ID,
    email: 'khach@vidu.vn',
    name: 'Khách Thử',
    googleLinked: false,
    lastLoginAt: '2026-09-19T03:00:00Z',
    disabledAt: null,
    createdAt: '2026-09-01T03:00:00Z',
    tenant: { id: 't1', name: 'Công ty Thử', quotaMode: 'commercial' },
    ...them,
  },
  sessions: [
    {
      createdAt: '2026-09-19T02:00:00Z',
      lastSeenAt: '2026-09-19T03:00:00Z',
      expiresAt: '2026-10-19T03:00:00Z',
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Version/17.5 Mobile/15E148 Safari/604.1',
    },
    {
      createdAt: '2026-09-10T02:00:00Z',
      lastSeenAt: '2026-09-18T03:00:00Z',
      expiresAt: '2026-10-18T03:00:00Z',
      userAgent: null,
    },
  ],
});
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
      accountId: ID,
      paymentLinkId: null,
      entitlementReceipt: null,
      note: null,
    },
  ],
  nextCursor: null,
};

function stub(body: unknown, quyen: string[] = ['customers.read', 'orders.read']) {
  const m = vi.fn(async (input: RequestInfo | URL) => {
    const duongDan = new URL(String(input), 'https://admin.test').pathname;
    const than =
      duongDan === '/v1/admin/me'
        ? { email: 'p@t', permissions: quyen }
        : duongDan === '/v1/admin/orders'
          ? DON
          : body;
    return new Response(JSON.stringify(than), { headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', m);
  return m;
}

afterEach(() => vi.unstubAllGlobals());

const ve = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DelayedActionProvider>
        <MemoryRouter>
          <ChiTietKhachPanel id={ID} onClose={() => {}} />
        </MemoryRouter>
      </DelayedActionProvider>
    </QueryClientProvider>,
  );

describe('ChiTietKhachPanel', () => {
  it('đang hoạt động: huy hiệu, phiên rút gọn, link tenant và đơn, nút Vô hiệu hoá; KHÔNG có Kích hoạt lại', async () => {
    stub(chiTiet());
    ve();
    expect(await screen.findByText('khach@vidu.vn')).toBeVisible();
    expect(screen.getByText('Đang hoạt động')).toBeVisible();
    expect(screen.getByText(/Phiên đang mở \(2\)/)).toBeVisible();
    expect(screen.getByText('Safari · iPhone')).toBeVisible();
    expect(screen.getByText('không rõ')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Công ty Thử' })).toHaveAttribute(
      'href',
      '/tenants?id=t1',
    );
    expect(screen.getByRole('link', { name: /Xem tất cả đơn/ })).toHaveAttribute(
      'href',
      '/orders?tenant=t1',
    );
    expect(await screen.findByText('Starter 1 tháng')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Vô hiệu hoá' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Kích hoạt lại' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/token_hash|ip_hash/);
  });

  it('đã vô hiệu hoá: huy hiệu đỏ và nút Kích hoạt lại', async () => {
    stub(chiTiet({ disabledAt: '2026-09-19T05:00:00Z' }));
    ve();
    expect(await screen.findByText('Đã vô hiệu hoá')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Kích hoạt lại' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Vô hiệu hoá' })).toBeNull();
  });

  it('không có quyền orders.read → không gọi /v1/admin/orders, không có mục Đơn gần nhất', async () => {
    const m = stub(chiTiet(), ['customers.read']);
    ve();
    expect(await screen.findByText('khach@vidu.vn')).toBeVisible();
    expect(screen.queryByText(/Đơn gần nhất/)).toBeNull();
    expect(m.mock.calls.map(([u]) => String(u)).some((u) => u.includes('/v1/admin/orders'))).toBe(
      false,
    );
  });

  it('chưa có tổ chức → nói rõ, không link tenant', async () => {
    stub(chiTiet({ tenant: null }));
    ve();
    expect(await screen.findByText('Chưa tạo tổ chức')).toBeVisible();
    expect(screen.queryByRole('link', { name: /Xem tất cả đơn/ })).toBeNull();
  });

  it('bấm Vô hiệu hoá mở form lý do; nút gửi nói rõ hệ quả xoá phiên', async () => {
    stub(chiTiet());
    ve();
    await userEvent.click(await screen.findByRole('button', { name: 'Vô hiệu hoá' }));
    expect(screen.getByRole('form', { name: /Vô hiệu hoá khach@vidu.vn/ })).toBeVisible();
    expect(screen.getByText(/xoá mọi phiên/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Vô hiệu hoá tài khoản' })).toBeDisabled();
  });
});
