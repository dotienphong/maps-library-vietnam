// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DelayedActionProvider } from '@/components/delayed-action';
import { BillingPage } from './page';

const TENANT = '00000000-0000-4000-8000-0000000000cc';

const tenant = (quotaMode: 'legacy' | 'commercial') => ({
  tenant: {
    id: TENANT,
    name: 'Công ty Thử Nghiệm',
    plan: 'paid',
    quota_mode: quotaMode,
    created_at: '2026-09-01T00:00:00.000Z',
    active_keys: 1,
  },
  keys: [],
});

const usage = {
  tenantId: TENANT,
  status: 'active',
  tier: 'starter',
  revision: 5,
  periodId: 'p-1',
  startsAt: '2026-09-01T00:00:00.000Z',
  endsAt: '2026-10-01T00:00:00.000Z',
  trialUsedOnce: false,
  maintenance: false,
  missingAcks: { count: 0, limit: 3, locked: false, opensAt: null },
  places: { limit: 30_000, used: 100, reserved: 0, credits: 0, available: 29_900 },
  directions: { limit: 3_000, used: 0, reserved: 0, credits: 0, available: 3_000 },
};

const legacyUsage = {
  day: '2026-09-16',
  quotaEnabled: true,
  plan: 'paid',
  counted: true,
  blockAtMultiple: 2,
  keys: [],
  total: { places: { used: 0, limit: 0 }, directions: { used: 0, limit: 0 } },
};

/** Trả JSON theo đường dẫn, và ghi lại mọi lời gọi để khẳng định cái gì KHÔNG được gọi. */
const batFetch = (quotaMode: 'legacy' | 'commercial', ghiDe: Record<string, unknown> = {}) => {
  const mock = vi.fn().mockImplementation(async (path: string, init?: RequestInit) => {
    const duong = String(path);
    const tra = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (duong in ghiDe) return tra(ghiDe[duong], 409);
    if (duong.includes('/v1/admin/tenants/')) return tra(tenant(quotaMode));
    if (duong.includes('/legacy-usage')) return tra(legacyUsage);
    if (duong.includes('/usage')) return tra(usage);
    if (duong.includes('/periods')) return tra({ periods: [], credits: [] });
    if (duong.includes('/plan-catalog')) {
      return tra({
        tiers: [],
        addOns: [],
        legacyDefaults: { places: 0, directions: 0, blockAtMultiple: 2 },
      });
    }
    if (init?.method === 'POST') {
      return tra({
        operationId: 'op',
        revision: 6,
        status: 'active',
        tier: 'trial',
        appliedAt: '2026-09-16T10:00:00.000Z',
      });
    }
    return tra({ items: [], nextCursor: null });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
};

const dungTrang = () =>
  render(
    <MemoryRouter initialEntries={[`/billing?tenant=${TENANT}`]}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <DelayedActionProvider>
          <BillingPage />
        </DelayedActionProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('BillingPage', () => {
  it('tenant thương mại: đọc sổ quota, KHÔNG đọc bộ đếm legacy', async () => {
    const mock = batFetch('commercial');
    dungTrang();
    expect(await screen.findByText('Đang hoạt động')).toBeVisible();
    const duong = mock.mock.calls.map(([path]) => String(path));
    expect(duong.some((path) => path.endsWith('/usage'))).toBe(true);
    expect(duong.some((path) => path.includes('/legacy-usage'))).toBe(false);
  });

  it('tenant legacy: đọc bộ đếm KV và KHÔNG chạm /usage — gọi nó sẽ tạo sổ Durable Object', async () => {
    const mock = batFetch('legacy');
    dungTrang();
    expect(await screen.findByText(/Hôm nay/)).toBeVisible();
    const duong = mock.mock.calls.map(([path]) => String(path));
    expect(duong.some((path) => path.includes('/legacy-usage'))).toBe(true);
    expect(duong.some((path) => path.endsWith('/usage'))).toBe(false);
  });

  it('tenant legacy có nút chuyển sang thương mại, gọi đúng route đổi chế độ', async () => {
    const mock = batFetch('legacy');
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    dungTrang();
    await user.click(await screen.findByRole('button', { name: 'Chuyển sang thương mại' }));
    await act(async () => {
      vi.advanceTimersByTime(6_000);
    });
    expect(
      mock.mock.calls.some(
        ([path, init]) =>
          String(path).endsWith('/mode') && (init as RequestInit | undefined)?.method === 'POST',
      ),
    ).toBe(true);
  });

  it('huỷ trong 5 giây → KHÔNG có POST nào rời trình duyệt', async () => {
    const mock = batFetch('commercial');
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    dungTrang();
    await user.click(await screen.findByRole('button', { name: /Bật dùng thử/ }));
    await user.type(screen.getByLabelText(/Lý do/), 'khách xin dùng thử');
    await user.click(screen.getByRole('button', { name: /Gửi lệnh/ }));
    await user.click(await screen.findByRole('button', { name: 'Huỷ' }));
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(
      mock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST'),
    ).toHaveLength(0);
  });

  it('hết 5 giây → gửi thật và hiện biên lai kèm mã thao tác', async () => {
    const mock = batFetch('commercial');
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    dungTrang();
    await user.click(await screen.findByRole('button', { name: /Bật dùng thử/ }));
    await user.type(screen.getByLabelText(/Lý do/), 'khách xin dùng thử');
    await user.click(screen.getByRole('button', { name: /Gửi lệnh/ }));
    await act(async () => {
      vi.advanceTimersByTime(6_000);
    });
    expect(
      mock.mock.calls.some(
        ([path, init]) =>
          String(path).includes('/commands') && (init as RequestInit).method === 'POST',
      ),
    ).toBe(true);
    expect(await screen.findByText(/Đã gửi/)).toBeVisible();
  });

  it('lệnh trượt sau khi hộp thoại đã đóng: hiện mã lỗi và câu tiếng Việt, KHÔNG im lặng', async () => {
    // Đây là kịch bản tệ nhất của cả pha: delayed-action gọi run() bằng `void`, nên không bắt lỗi
    // thì người vận hành đóng máy với niềm tin là khách đã có gói.
    batFetch('commercial', {
      [`/v1/admin/billing/${TENANT}/commands`]: {
        error: { code: 'revision_conflict', message: 'x' },
      },
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    dungTrang();
    await user.click(await screen.findByRole('button', { name: /Bật dùng thử/ }));
    await user.type(screen.getByLabelText(/Lý do/), 'khách xin dùng thử');
    await user.click(screen.getByRole('button', { name: /Gửi lệnh/ }));
    await act(async () => {
      vi.advanceTimersByTime(6_000);
    });
    expect(await screen.findByText(/revision_conflict/)).toBeVisible();
    expect(screen.getByText(/Bấm Tải lại rồi gửi lại/)).toBeVisible();
  });
});
