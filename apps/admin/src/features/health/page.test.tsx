// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HealthPage } from './page';

const HEALTH = {
  checked_at: '2026-09-18T10:00:00.000Z',
  db: {
    ok: true,
    ms: 120,
    user: 'api',
    version: 'PostgreSQL 16.3',
    word_similarity_threshold: 0.3,
    schema_migration: '0019_poi_admin',
  },
  routing: { ok: false, ms: 6001, error: 'Dịch vụ chỉ đường không phản hồi' },
  data: { ok: true, ms: 12, tiles: 'vn-20260901', poi: 'poi-20260901', updated_at: null },
  watcher: null,
};

const METRICS = {
  computed_at: '2026-09-18T09:58:00.000Z',
  routes: [
    { route: '/v1/autocomplete', requests: 127, errors_5xx: 0, quota_429: 3, p95_ms: 1182 },
    { route: '', requests: 40, errors_5xx: 2, quota_429: 0, p95_ms: 300 },
  ],
  tenants: [
    {
      tenant_id: 'de65cfba-2834-43da-bb81-78033d1b32b8',
      ten: 'Phong_Admin',
      requests: 1267,
      errors_5xx: 0,
      quota_429: 43,
      p95_ms: 900,
    },
  ],
};

let duocGoi: string[] = [];

function mo(health: object = HEALTH) {
  duocGoi = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      duocGoi.push(url);
      return new Response(JSON.stringify(url.includes('/v1/admin/health') ? health : METRICS));
    }),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <HealthPage />
    </QueryClientProvider>,
  );
}

describe('HealthPage', () => {
  beforeEach(() => vi.stubGlobal('matchMedia', undefined));
  afterEach(() => vi.unstubAllGlobals());

  it('một phép đo hỏng không giấu hai phép đo còn lại', async () => {
    // Đây là hình dạng thật của sự cố: máy chủ định tuyến ngủ, DB vẫn chạy. Màn hình phải chỉ
    // đúng cái hỏng chứ không đỏ toàn bộ.
    mo();
    expect(await screen.findByText(/Dịch vụ chỉ đường không phản hồi/)).toBeVisible();
    expect(screen.getByText('0019_poi_admin')).toBeVisible();
    expect(screen.getByText('vn-20260901')).toBeVisible();
  });

  it('dòng số liệu trước 18/09 không có mẫu route, hiện nhãn thay vì ô trống', async () => {
    mo();
    expect(await screen.findByText('/v1/autocomplete')).toBeVisible();
    expect(screen.getByText(/trước 18\/09/)).toBeVisible();
  });

  it('đổi cửa sổ thì gọi lại đúng tham số window', async () => {
    mo();
    await screen.findByText('/v1/autocomplete');
    expect(duocGoi.some((u) => u.includes('window=24h'))).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: '1 giờ' }));
    await waitFor(() => expect(duocGoi.some((u) => u.includes('window=1h'))).toBe(true));
  });

  it('hiện giờ tính số liệu để không ai tưởng đó là số của lúc này', async () => {
    mo();
    expect(await screen.findByText(/tính đến/)).toBeVisible();
  });

  it('tỉ lệ lỗi tính theo phần trăm của chính dòng đó, không phải số tuyệt đối', async () => {
    // 2 lỗi trên 40 lượt là 5%; hiện "2" thì người trực không biết 2 đó lớn hay nhỏ.
    // matchMedia bị stub undefined ở beforeEach → RecordView vẽ dạng THẺ, mọi số nằm chung một
    // dòng văn bản, nên phải khớp bằng regex chứ không phải một nút văn bản riêng.
    mo();
    await screen.findByText('/v1/autocomplete');
    expect(screen.getByText(/5xx 5\.0%/)).toBeVisible();
    // Dòng không có lượt 429 nào phải là 0.0%, còn mẫu số 0 mới là "—".
    expect(screen.getByText(/429 0\.0%/)).toBeVisible();
  });

  it('cron chưa chạy lần nào → nói thẳng, không giả vờ đang giám sát', async () => {
    mo();
    expect(await screen.findByText(/Giám sát tự động chưa chạy lần nào/)).toBeVisible();
  });

  it('cron vừa đo → hiện giờ đo cuối và số thư hôm nay', async () => {
    const vuaRoi = new Date(Date.now() - 4 * 60_000).toISOString();
    mo({ ...HEALTH, watcher: { kiem_luc: vuaRoi, gui_trong_ngay: 1 } });
    const dong = await screen.findByText(/Giám sát tự động: đo lần cuối/);
    expect(dong).toBeVisible();
    expect(dong.textContent).toContain('1 cảnh báo hôm nay');
    expect(screen.queryByText(/cron có thể đang không chạy/)).toBeNull();
  });

  it('lần đo cuối cũ hơn 60 phút → cảnh báo cron có thể đang không chạy', async () => {
    // Nhịp ghi KV là 30 phút, nên 29 phút cũ vẫn bình thường; 3 giờ thì không còn cách giải thích
    // nào khác ngoài cron không chạy.
    const baGioTruoc = new Date(Date.now() - 3 * 3_600_000).toISOString();
    mo({ ...HEALTH, watcher: { kiem_luc: baGioTruoc, gui_trong_ngay: 0 } });
    expect(await screen.findByText(/cron có thể đang không chạy/)).toBeVisible();
  });
});
