// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { orderKeys } from '@/features/orders/hooks';
import { OverviewPage } from './page';

const ME = {
  email: 'phong@test.invalid',
  permissions: ['edits.read', 'billing.read', 'health.read', 'audit.read', 'orders.read'],
};
const HEALTH = {
  checked_at: '2026-09-18T10:00:00.000Z',
  db: {
    ok: true,
    ms: 120,
    user: 'api',
    version: 'PostgreSQL 16.4',
    word_similarity_threshold: 0.6,
    schema_migration: '0019_x',
  },
  routing: { ok: false, ms: 6001, error: 'Dịch vụ chỉ đường không phản hồi' },
  data: { ok: true, ms: 12, tiles: 'vn-1', poi: 'poi-1', updated_at: null },
};
const METRICS = {
  computed_at: '2026-09-18T09:58:00.000Z',
  routes: [],
  tenants: [
    {
      tenant_id: 't1',
      ten: 'Phong_Admin',
      requests: 1267,
      errors_5xx: 0,
      quota_429: 43,
      p95_ms: 900,
    },
  ],
};
const QUOTA = {
  computed_at: '2026-09-18T09:59:00.000Z',
  truncated: false,
  above: 0,
  tenants: [
    {
      tenant_id: 't1',
      name: 'Phong_Admin',
      quota_mode: 'legacy',
      places: { used: 62, limit: 100 },
      directions: { used: 0, limit: 100 },
      pct: 62,
    },
  ],
};
const AUDIT = {
  items: [
    {
      id: '10',
      actor: 'phong@test.invalid',
      action: 'edit.approve',
      target: '7',
      detail: null,
      created_at: '2026-09-18T09:00:00.000Z',
    },
  ],
  nextCursor: null,
};

function mo(
  override: (url: string) => Response | null = () => null,
  seed?: (qc: QueryClient) => void,
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const rieng = override(url);
      if (rieng) return rieng;
      // So khớp theo ĐƯỜNG DẪN, không phải `includes`: '/v1/admin/metrics'.includes('/v1/admin/me')
      // là TRUE vì "metrics" bắt đầu bằng "me", nên mock kiểu cũ trả hồ sơ người dùng cho lời gọi
      // số liệu và trang nổ ở chỗ hoàn toàn khác.
      const duongDan = new URL(url, 'https://admin.test').pathname;
      const than: Record<string, unknown> = {
        '/v1/admin/me': ME,
        '/v1/admin/edits/count': { pending: 7 },
        '/v1/admin/health': HEALTH,
        '/v1/admin/metrics': METRICS,
        '/v1/admin/quota-summary': QUOTA,
        '/v1/admin/audit': AUDIT,
        '/v1/admin/orders/summary': {
          choXuLy: 3,
          doanhThu30Ngay: 4_550_000,
          pendingQua1Gio: 0,
          khongKhop: 1,
        },
      };
      return new Response(JSON.stringify(than[duongDan] ?? {}));
    }),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // `seed` ghi thẳng vào cache TRƯỚC khi dựng trang — dùng để kiểm hai ô tiền đọc ĐÚNG khoá mà
  // đầu trang Đơn hàng dùng (`orderKeys.summary()`), chứ không phải chỉ đọc số máy chủ trả về
  // cho URL nào cũng qua được dù khoá cache có bị đổi thành thứ riêng.
  seed?.(qc);
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OverviewPage', () => {
  beforeEach(() => vi.stubGlobal('matchMedia', undefined));
  afterEach(() => vi.unstubAllGlobals());

  it('bốn ô và năm việc gần nhất', async () => {
    mo();
    expect(await screen.findByText('7')).toBeVisible();
    expect(screen.getByRole('link', { name: /Đóng góp chờ duyệt/ })).toHaveAttribute(
      'href',
      '/edits',
    );
    expect(await screen.findByText('43')).toBeVisible();
    expect(await screen.findByText(/Phong_Admin 62%/)).toBeVisible();
    expect(await screen.findByText('edit.approve')).toBeVisible();
  });

  it('định tuyến hỏng hiện ngay trên trang đích, không phải chờ vào màn Sức khoẻ', async () => {
    mo();
    expect(await screen.findByText('Hỏng')).toBeVisible();
  });

  it('403 ở ô hạn mức chỉ làm hỏng ô đó, ba ô kia vẫn có số', async () => {
    // Email ngoài BILLING_ADMIN_EMAILS nhận 403 ở quota-summary. Trang đích không được trắng vì
    // một người không có quyền xem số của khách hàng.
    mo((url) =>
      url.includes('/v1/admin/quota-summary')
        ? new Response(JSON.stringify({ error: { code: 'forbidden', message: 'x' } }), {
            status: 403,
            headers: { 'content-type': 'application/json' },
          })
        : null,
    );
    expect(await screen.findByText('7')).toBeVisible();
    expect(await screen.findByText(/không đọc được/i)).toBeVisible();
    expect(await screen.findByText('edit.approve')).toBeVisible();
  });

  it('gọi audit với limit=5, không phải 25', async () => {
    mo();
    await screen.findByText('edit.approve');
    const goi = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(
      (c) => String(c[0]),
    );
    expect(goi.some((u) => u.includes('/v1/admin/audit') && u.includes('limit=5'))).toBe(true);
  });

  it('có orders.read → hai ô Đơn chờ xử lý và Doanh thu 30 ngày, trỏ về màn Đơn hàng', async () => {
    mo();
    expect(await screen.findByRole('link', { name: /Đơn chờ xử lý/ })).toHaveAttribute(
      'href',
      '/orders?status=paid_unfulfilled',
    );
    expect(await screen.findByText('3')).toBeVisible();
    expect(await screen.findByText('4.550.000đ')).toBeVisible();
    expect(screen.getByRole('link', { name: /Doanh thu 30 ngày/ })).toHaveAttribute(
      'href',
      '/orders?status=fulfilled',
    );
  });

  it('hai ô tiền dùng CHUNG khoá cache với đầu trang Đơn hàng — dữ liệu đã có sẵn thì không gọi lại', async () => {
    // Nếu ai đó lỡ đổi hai ô này sang một khoá cache riêng (vd ['overview','orders-summary']),
    // trang vẫn tự fetch và hiện đúng số — mọi khẳng định của bài test phía trên vẫn xanh. Bài
    // này khoá đúng điều Task 9 hứa: seed sẵn dữ liệu vào ĐÚNG khoá `orderKeys.summary()` (khoá
    // mà đầu trang Đơn hàng dùng) rồi kiểm trang đọc thẳng từ đó, không có lời gọi mạng nào tới
    // `/orders/summary`. `staleTime: 30_000` của `useOrderSummary` coi dữ liệu vừa seed là còn tươi.
    mo(undefined, (qc) =>
      qc.setQueryData(orderKeys.summary(), {
        choXuLy: 9,
        doanhThu30Ngay: 1_000_000,
        pendingQua1Gio: 0,
        khongKhop: 0,
      }),
    );
    expect(await screen.findByText('9')).toBeVisible();
    expect(await screen.findByText('1.000.000đ')).toBeVisible();
    const goi = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(
      (c) => String(c[0]),
    );
    expect(goi.some((u) => u.includes('/orders/summary'))).toBe(false);
  });

  it('không có orders.read → không gọi summary, không có hai ô đó', async () => {
    // So khớp theo ĐƯỜNG DẪN chứ không `includes`: '/v1/admin/metrics'.includes('/v1/admin/me')
    // cũng là TRUE (vì "metrics" bắt đầu bằng "me"), sẽ làm hỏng luôn dữ liệu metrics.
    mo((url) =>
      new URL(url, 'https://admin.test').pathname === '/v1/admin/me'
        ? new Response(JSON.stringify({ ...ME, permissions: ['edits.read'] }))
        : null,
    );
    expect(await screen.findByRole('link', { name: /Đóng góp chờ duyệt/ })).toBeVisible();
    expect(screen.queryByRole('link', { name: /Đơn chờ xử lý/ })).toBeNull();
    const goi = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(
      (c) => String(c[0]),
    );
    expect(goi.some((u) => u.includes('/orders/summary'))).toBe(false);
  });
});
