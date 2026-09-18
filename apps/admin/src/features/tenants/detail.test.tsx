// @vitest-environment jsdom

import { DelayedActionProvider } from '@mapslibvn/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    // Response chỉ đọc được MỘT lần: chia sẻ một instance cho mọi lần fetch làm lần sau ném
    // "Body is unusable". Dựng mới mỗi lần gọi.
    vi.fn().mockImplementation(
      async () =>
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

/**
 * `shouldAdvanceTime: true` là bắt buộc, y như delayed-action.test.tsx: thiếu nó thì `findBy…`
 * của Testing Library chờ trên timer đã bị đóng băng và test treo tới khi hết hạn, chứ không
 * phải hỏng logic.
 */
const stubDetailFetch = () => {
  const fetchMock = vi.fn().mockImplementation(
    async () =>
      new Response(JSON.stringify(detailBody), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};
const daGoiThuHoi = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.some(([path]) => String(path).includes('revocation'));

/**
 * Cha thật giữ id trong state và bỏ nó khi ngăn đóng. Truyền `onClose` rỗng sẽ để ngăn mở mãi —
 * và vì ngăn là dialog modal, toast đếm ngược khi đó bị aria-hidden lẫn pointer-events: none,
 * tức test sẽ kiểm một màn hình mà người dùng thật không bấm được.
 */
function Harness() {
  const [id, setId] = useState<string | null>('t1');
  return <TenantDetailPanel id={id} onClose={() => setId(null)} />;
}

const renderHarness = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DelayedActionProvider>
        <Harness />
      </DelayedActionProvider>
    </QueryClientProvider>,
  );

describe('TenantDetailPanel — thao tác ghi', () => {
  afterEach(() => vi.useRealTimers());

  it('thu hồi đi qua toast đếm ngược 5 giây, chưa gửi gì trong lúc đếm', async () => {
    // Thu hồi làm chết ngay ứng dụng đang dùng khoá đó. 5 giây là khoảng để nhận ra bấm nhầm
    // dòng — sau khi request đã đi thì khách đã mất dịch vụ rồi, dù có khôi phục sau đó.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = stubDetailFetch();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderHarness();

    await user.click(await screen.findByRole('button', { name: 'Thu hồi' }));
    expect(screen.getByRole('status').textContent).toMatch(/Đã thu hồi/);
    expect(daGoiThuHoi(fetchMock)).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(daGoiThuHoi(fetchMock)).toBe(true);
  });

  it('bấm Huỷ trong lúc đếm thì không request nào rời trình duyệt', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = stubDetailFetch();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderHarness();

    await user.click(await screen.findByRole('button', { name: 'Thu hồi' }));
    // Bấm được nút này là điều kiện sống của cả cơ chế hoãn: nếu ngăn chi tiết còn mở, Radix đặt
    // pointer-events: none cho mọi thứ ngoài nó và cú bấm không bao giờ tới.
    await user.click(screen.getByRole('button', { name: 'Huỷ' }));
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(daGoiThuHoi(fetchMock)).toBe(false);
  });

  it('nút đổi sang chế độ thương mại có mặt và nói rõ hệ quả', async () => {
    stubFetch(detailBody);
    renderPanel('t1');
    expect(await screen.findByRole('button', { name: /Chuyển sang thương mại/ })).toBeVisible();
    expect(screen.getByText(/bật chặn theo hạn mức ngay/)).toBeVisible();
  });
});
