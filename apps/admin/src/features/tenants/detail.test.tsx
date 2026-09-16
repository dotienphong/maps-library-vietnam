// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DelayedActionProvider } from '@/components/delayed-action';
import { TenantDetailPanel } from './detail';

const detailBody = {
  tenant: {
    id: 't1',
    name: 'Công ty Thử Nghiệm',
    plan: 'free',
    quota_mode: 'legacy',
    created_at: new Date('2026-09-01T00:00:00.000Z').toISOString(),
    active_keys: 1,
  },
  keys: [
    {
      key_hash: 'a'.repeat(64),
      key_prefix: 'mlv_live_ABCD1234',
      label: 'trang nhúng khách',
      kind: 'web',
      scopes: ['places:read'],
      allowed_origins: ['https://khach.example.com'],
      allowed_bundle_ids: [],
      quota_places_per_day: null,
      quota_directions_per_day: 500,
      active: true,
      created_at: new Date('2026-09-10T00:00:00.000Z').toISOString(),
      revoked_at: null,
    },
    {
      key_hash: 'b'.repeat(64),
      key_prefix: 'mlv_live_ZZZZ9999',
      label: 'khoá cũ',
      kind: 'server',
      scopes: ['places:read', 'edits:write'],
      allowed_origins: [],
      allowed_bundle_ids: [],
      quota_places_per_day: null,
      quota_directions_per_day: null,
      active: false,
      created_at: new Date('2026-08-01T00:00:00.000Z').toISOString(),
      revoked_at: new Date('2026-09-05T00:00:00.000Z').toISOString(),
    },
  ],
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

const renderPanel = (id: string | null) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DelayedActionProvider>
        <TenantDetailPanel id={id} onClose={vi.fn()} />
      </DelayedActionProvider>
    </QueryClientProvider>,
  );

afterEach(() => vi.unstubAllGlobals());

describe('TenantDetailPanel', () => {
  it('id = null → không dựng gì', () => {
    const { container } = renderPanel(null);
    expect(container).toBeEmptyDOMElement();
  });

  it('hiện tên tenant, gói và từng khoá kèm tiền tố', async () => {
    stubFetch(detailBody);
    renderPanel('t1');
    expect(await screen.findByText('Công ty Thử Nghiệm')).toBeVisible();
    expect(screen.getByText('mlv_live_ABCD1234')).toBeVisible();
    expect(screen.getByText('mlv_live_ZZZZ9999')).toBeVisible();
  });

  it('khoá còn hiệu lực có nút Thu hồi; khoá đã thu hồi có nút Khôi phục', async () => {
    stubFetch(detailBody);
    renderPanel('t1');
    expect(await screen.findByRole('button', { name: 'Thu hồi' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Khôi phục' })).toBeVisible();
  });

  it('không bao giờ hiện khoá dạng rõ — chỉ tiền tố 17 ký tự', async () => {
    stubFetch(detailBody);
    renderPanel('t1');
    await screen.findByText('mlv_live_ABCD1234');
    // DB không giữ khoá rõ, nên bất kỳ chuỗi 24 ký tự nào xuất hiện ở đây đều là lỗi logic.
    expect(document.body.textContent).not.toMatch(/mlv_live_[0-9A-Za-z]{24}/);
  });

  it('hiện origin cho phép của khoá web', async () => {
    stubFetch(detailBody);
    renderPanel('t1');
    expect(await screen.findByText(/https:\/\/khach\.example\.com/)).toBeVisible();
  });

  it('tenant chưa có khoá nào → trạng thái rỗng', async () => {
    stubFetch({ ...detailBody, keys: [] });
    renderPanel('t1');
    expect(await screen.findByText(/Tenant này chưa có khoá nào/)).toBeVisible();
  });
});
