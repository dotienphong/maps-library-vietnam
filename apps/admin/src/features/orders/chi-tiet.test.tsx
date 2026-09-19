// @vitest-environment jsdom

import { DelayedActionProvider } from '@mapslibvn/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act, useState } from 'react';
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
    // Đơn pending chưa có tiền vào sổ — không có gì để hoàn.
    expect(screen.queryByRole('button', { name: 'Đánh dấu hoàn tiền' })).toBeNull();
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

/**
 * Cha thật giữ `id` trong state, đóng ngăn bằng cách đặt lại `null`, và `key={id ?? 'dong'}` y hệt
 * cách `page.tsx` gắn panel — thiếu `key` thì instance React sống sót qua các lần mở khác nhau và
 * state `lenhMo` (lệnh Huỷ/Hoàn tiền đang mở) rò từ đơn cũ sang đơn mới.
 */
function HarnessDoiDon() {
  const [id, setId] = useState<string | null>(null);
  return (
    <>
      <button type="button" onClick={() => setId('d1')}>
        Mở đơn A
      </button>
      <button type="button" onClick={() => setId('d2')}>
        Mở đơn B
      </button>
      <ChiTietDonPanel key={id ?? 'dong'} id={id} onClose={() => setId(null)} />
    </>
  );
}

const renderHarnessDoiDon = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DelayedActionProvider>
        <MemoryRouter>
          <HarnessDoiDon />
        </MemoryRouter>
      </DelayedActionProvider>
    </QueryClientProvider>,
  );

describe('ChiTietDonPanel — không rò lệnh đang mở giữa hai đơn', () => {
  it('mở Huỷ đơn ở đơn A (pending), đóng, mở đơn B (refunded) — không còn form/lệnh nào của đơn A', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      const { pathname } = new URL(String(url), 'http://localhost');
      const body = pathname === '/v1/admin/orders/d2' ? don('refunded') : don('pending');
      return new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderHarnessDoiDon();

    await userEvent.click(screen.getByRole('button', { name: 'Mở đơn A' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Huỷ đơn' }));
    expect(screen.getByRole('form', { name: /Huỷ đơn/ })).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    await userEvent.click(screen.getByRole('button', { name: 'Mở đơn B' }));

    expect(await screen.findByText('Đã hoàn tiền')).toBeVisible();
    expect(screen.queryByRole('form', { name: /Huỷ đơn/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Huỷ đơn' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Đánh dấu hoàn tiền' })).toBeNull();
  });
});

/**
 * `shouldAdvanceTime: true` bắt buộc, y như `tenants/detail.test.tsx`: thiếu nó thì `findBy…` chờ
 * trên timer đã đóng băng và test treo tới khi hết hạn, chứ không phải hỏng logic.
 */
function HarnessDon() {
  const [id, setId] = useState<string | null>('d1');
  return <ChiTietDonPanel key={id ?? 'dong'} id={id} onClose={() => setId(null)} />;
}

const renderHarnessDon = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DelayedActionProvider>
        <MemoryRouter>
          <HarnessDon />
        </MemoryRouter>
      </DelayedActionProvider>
    </QueryClientProvider>,
  );

const stubHuyThanhCong = () => {
  const fetchMock = vi.fn().mockImplementation(async (url: string) => {
    const { pathname } = new URL(String(url), 'http://localhost');
    if (pathname === '/v1/admin/orders/d1/cancel') {
      return new Response(
        JSON.stringify({ order: { ...don('pending').order, status: 'cancelled' }, moi: true }),
        { headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify(don('pending')), {
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const goiHuy = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(
    (call) =>
      new URL(String(call[0]), 'http://localhost').pathname === '/v1/admin/orders/d1/cancel',
  );

const goiChiTiet = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(
    (call) => new URL(String(call[0]), 'http://localhost').pathname === '/v1/admin/orders/d1',
  ).length;

describe('ChiTietDonPanel — huỷ đơn đi qua đếm ngược 5 giây', () => {
  afterEach(() => vi.useRealTimers());

  it('chưa gửi gì trong 5 giây; sau đó đúng một POST /cancel mang operationId + reason; đơn được tải lại', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = stubHuyThanhCong();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    // `onClose` rỗng: bài này chỉ theo dõi việc gửi lệnh và tải lại đơn, không kiểm việc đóng ngăn
    // (đã có bài "không rò lệnh" và bài "bấm Huỷ trên toast" riêng cho việc đó).
    ve();

    await user.click(await screen.findByRole('button', { name: 'Huỷ đơn' }));
    await user.type(screen.getByLabelText('Lý do'), 'Khách đổi ý');
    const soLanChiTietTruoc = goiChiTiet(fetchMock);
    await user.click(screen.getByRole('button', { name: 'Huỷ đơn' }));

    // Trước 5 giây: chưa có request nào rời trình duyệt.
    expect(goiHuy(fetchMock)).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    const cacLanGoi = goiHuy(fetchMock);
    expect(cacLanGoi).toHaveLength(1);
    const than = JSON.parse(String(cacLanGoi[0]?.[1]?.body));
    expect(than.reason).toBe('Khách đổi ý');
    expect(than.operationId).toMatch(/^[0-9a-f]{32}$/);

    // onSettled: invalidate — thiếu dòng đó thì đơn không được tải lại sau khi lệnh chạy xong.
    await waitFor(() => {
      expect(goiChiTiet(fetchMock)).toBeGreaterThan(soLanChiTietTruoc);
    });
  });

  it('bấm Huỷ trên toast trong lúc đếm ngược thì không có request nào rời trình duyệt', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = stubHuyThanhCong();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderHarnessDon();

    await user.click(await screen.findByRole('button', { name: 'Huỷ đơn' }));
    await user.type(screen.getByLabelText('Lý do'), 'Khách đổi ý');
    await user.click(screen.getByRole('button', { name: 'Huỷ đơn' }));
    // Bấm được nút này là điều kiện sống của cả cơ chế hoãn: panel đã đóng (onClose gọi ngay sau
    // schedule), nếu không toast bị Radix đặt aria-hidden/pointer-events: none và cú bấm không tới.
    await user.click(screen.getByRole('button', { name: 'Huỷ' }));
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(goiHuy(fetchMock)).toHaveLength(0);
  });
});
