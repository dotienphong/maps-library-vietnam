// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditDetailPanel } from './detail';

const detailBody = {
  edit: {
    id: 7,
    poi_id: 'poi_1',
    poi_name: 'Cà phê Chiều Thứ Bảy',
    poi_status: 'active',
    poi_ward: 'Phường Bến Nghé',
    poi_province: 'TP.HCM',
    kind: 'update',
    changes: { street: 'Nguyễn Huệ' },
    photo_url: null,
    note: 'Đổi tên đường',
    status: 'pending',
    reviewer: null,
    created_at: new Date().toISOString(),
    tenant_id: 't1',
    distance_m: null,
  },
  poi_hien_tai: {
    id: 'poi_1',
    name: 'Cà phê Chiều Thứ Bảy',
    category: 'cafe',
    status: 'active',
    housenumber: '12',
    street: 'Lê Lợi',
    ward: 'Phường Bến Nghé',
    province: 'TP.HCM',
    address_text: '12 Lê Lợi',
    contact: null,
    hours: null,
    lat: 10.7721,
    lng: 106.7012,
  },
  distance_m: null,
  nearby: [],
};

const stubFetch = (body: unknown, status = 200) =>
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );

const renderPanel = (id: number | null, onReview = vi.fn(), onClose = vi.fn()) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <EditDetailPanel id={id} onClose={onClose} onReview={onReview} />
    </QueryClientProvider>,
  );

afterEach(() => vi.unstubAllGlobals());

describe('EditDetailPanel', () => {
  it('id = null → không dựng gì', () => {
    const { container } = renderPanel(null);
    expect(container).toBeEmptyDOMElement();
  });

  it('tải xong → hiện tên, ghi chú và bảng so sánh trường', async () => {
    stubFetch(detailBody);
    renderPanel(7);
    expect(await screen.findByText('Cà phê Chiều Thứ Bảy')).toBeVisible();
    expect(screen.getByText('Đổi tên đường')).toBeVisible();
    expect(screen.getByText('Lê Lợi')).toBeVisible();
    expect(screen.getByText('Nguyễn Huệ')).toBeVisible();
  });

  it('bấm Duyệt gọi onReview với approve', async () => {
    stubFetch(detailBody);
    const onReview = vi.fn();
    renderPanel(7, onReview);
    await userEvent.click(await screen.findByRole('button', { name: 'Duyệt' }));
    expect(onReview).toHaveBeenCalledWith(7, 'approve');
  });

  it('API lỗi → hiện mã lỗi thật', async () => {
    stubFetch({ error: { code: 'not_found', message: 'Không có' } }, 404);
    renderPanel(7);
    await waitFor(() => expect(screen.getByText(/not_found/)).toBeVisible());
  });
});
