// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OverviewPage } from './page';

const ME = {
  email: 'phong@test.invalid',
  permissions: ['edits.read', 'billing.read', 'health.read', 'audit.read'],
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

function mo(override: (url: string) => Response | null = () => null) {
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
      };
      return new Response(JSON.stringify(than[duongDan] ?? {}));
    }),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
});
