// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { router } from '@/routes';

const ME = {
  email: 'phong@test.invalid',
  permissions: [
    'edits.read',
    'edits.write',
    'tenants.read',
    'billing.read',
    'health.read',
    'audit.read',
  ],
};

const HEALTH = {
  checked_at: '2026-09-18T10:00:00.000Z',
  db: { ok: true, ms: 1, user: 'api', version: 'PostgreSQL 16.4', word_similarity_threshold: 0.6, schema_migration: '0019_x' },
  routing: { ok: true, ms: 2, distance_km: 2.13, phut: 7 },
  data: { ok: true, ms: 3, tiles: 'vn-1', poi: 'poi-1', updated_at: null },
};
const METRICS = { computed_at: '2026-09-18T10:00:00.000Z', routes: [], tenants: [] };
const QUOTA = { computed_at: '2026-09-18T10:00:00.000Z', truncated: false, above: 0, tenants: [] };

function mo(duongDan: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider
        router={createMemoryRouter(router.routes, {
          basename: '/admin',
          initialEntries: [duongDan],
        })}
      />
    </QueryClientProvider>,
  );
}

describe('định tuyến trang Admin', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      // So khớp theo ĐƯỜNG DẪN: '/v1/admin/metrics'.includes('/v1/admin/me') là TRUE vì "metrics"
      // bắt đầu bằng "me". Từ pha 6, `/admin` là Tổng quan và có gọi /v1/admin/metrics, nên kiểu
      // so khớp cũ sẽ trả hồ sơ người dùng cho lời gọi số liệu và làm trắng trang.
      vi.fn(async (input: RequestInfo | URL) => {
        const duongDan = new URL(String(input), 'https://admin.test').pathname;
        if (duongDan === '/v1/admin/me') return new Response(JSON.stringify(ME));
        if (duongDan === '/v1/admin/health') return new Response(JSON.stringify(HEALTH));
        if (duongDan === '/v1/admin/metrics') return new Response(JSON.stringify(METRICS));
        if (duongDan === '/v1/admin/quota-summary') return new Response(JSON.stringify(QUOTA));
        return new Response(JSON.stringify({ pending: 0, items: [], total: 0 }));
      }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  // Đường dẫn gõ sai phải ra trang "không có màn hình này" của mình. Trước 17/09/2026 nó rơi vào
  // trang lỗi mặc định của react-router: "Unexpected Application Error! 404 Not Found 💿 Hey
  // developer 👋", tiếng Anh, khuyên lập trình viên, và đã chạy như thế trên production.
  it('đường dẫn lạ → trang "không có màn hình này", không phải trang lỗi của react-router', async () => {
    mo('/admin/khong-co-that');
    expect(await screen.findByText('Không có màn hình này')).toBeVisible();
    expect(document.body.textContent).not.toContain('Unexpected Application Error');
    // Sidebar vẫn còn để đi tiếp, không phải ngõ cụt.
    expect(screen.getByRole('navigation', { name: 'Điều hướng chính' })).toBeVisible();
  });

  it('/admin/audit có màn hình thật từ pha 4, không còn rơi vào 404', async () => {
    mo('/admin/audit');
    expect(await screen.findByLabelText('Lọc theo người thực hiện')).toBeVisible();
    expect(document.body.textContent).not.toContain('Không có màn hình này');
  });

  it('/admin/health có màn hình thật từ pha 5, không còn rơi vào 404', async () => {
    mo('/admin/health');
    expect(await screen.findByRole('button', { name: '24 giờ' })).toBeVisible();
    expect(document.body.textContent).not.toContain('Không có màn hình này');
  });

  it('/admin và /admin/edits hiện cùng một màn hình — Tổng quan (pha 6) chưa làm', async () => {
    mo('/admin');
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeVisible());
    const goc = screen.getByRole('main').textContent;
    cleanup();

    mo('/admin/edits');
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeVisible());
    expect(screen.getByRole('main').textContent).toBe(goc);
  });
});
