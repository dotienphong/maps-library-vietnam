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
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes('/v1/admin/me')
          ? new Response(JSON.stringify(ME))
          : new Response(JSON.stringify({ pending: 0, items: [], total: 0 })),
      ),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  // Hai mục này có trong sidebar (quyền `health.read`/`audit.read` được cấp cho mọi người qua được
  // Access) nhưng chưa có route — pha 4 và 5 chưa làm. Trước 17/09/2026 chúng rơi vào trang lỗi
  // mặc định của react-router: "Unexpected Application Error! 404 Not Found 💿 Hey developer 👋",
  // tiếng Anh, khuyên lập trình viên, và đã chạy như thế trên production.
  for (const duongDan of ['/admin/health', '/admin/khong-co-that']) {
    it(`${duongDan} → trang "không có màn hình này", không phải trang lỗi của react-router`, async () => {
      mo(duongDan);
      expect(await screen.findByText('Không có màn hình này')).toBeVisible();
      expect(document.body.textContent).not.toContain('Unexpected Application Error');
      // Sidebar vẫn còn để đi tiếp, không phải ngõ cụt.
      expect(screen.getByRole('navigation', { name: 'Điều hướng chính' })).toBeVisible();
    });
  }

  it('/admin/audit có màn hình thật từ pha 4, không còn rơi vào 404', async () => {
    mo('/admin/audit');
    expect(await screen.findByLabelText('Lọc theo người thực hiện')).toBeVisible();
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
